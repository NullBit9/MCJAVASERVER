// Express server with atomic registration, RCON-based command handling, rate limiting and improved security defaults
const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { Rcon } = require('rcon-client');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'data', 'db.sqlite');
if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new sqlite3.Database(DB_PATH);

const JWT_SECRET = process.env.JWT_SECRET || '';
if (!JWT_SECRET) console.warn('Warning: JWT_SECRET not set. Set a strong secret via environment variable in production.');
const JWT_COOKIE_NAME = 'mcjsess';

let serverProcess = null;
let wsServer; // set later
const clients = new Set();
let rconClient = null;
let rconInfo = null;

function dbRun(sql, params=[]) {
  return new Promise((res, rej) => db.run(sql, params, function(err) {
    if (err) rej(err); else res(this);
  }));
}
function dbGet(sql, params=[]) {
  return new Promise((res, rej) => db.get(sql, params, (err,row)=> err?rej(err):res(row)));
}
function dbAll(sql, params=[]) {
  return new Promise((res, rej) => db.all(sql, params, (err,rows)=> err?rej(err):res(rows)));
}

async function initDb() {
  await dbRun(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE,
    password_hash TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  // Ensure default site settings exist
  const row = await dbGet('SELECT value FROM settings WHERE key = ?', ['site_config']);
  if (!row) {
    const defaultConfig = { siteName: 'MCJAVASERVER', infoBoxes: [] };
    await dbRun('INSERT INTO settings(key,value) VALUES(?,?)', ['site_config', JSON.stringify(defaultConfig)]);
  }
}
initDb().catch(console.error);

// Rate limiter for auth endpoints
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, message: { error: 'Too many requests, please try again later.' } });

app.get('/api/first', async (req, res) => {
  const row = await dbGet('SELECT COUNT(1) AS c FROM users');
  res.json({ allowRegister: (row && row.c === 0) });
});

app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username+password required' });
    if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
    // Atomic insert: only insert if no users exist
    const hash = await bcrypt.hash(password, 10);
    const result = await dbRun(`INSERT INTO users(username,password_hash)
      SELECT ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM users)`, [username, hash]);
    // result.changes tells us if row was inserted
    if (result && result.changes === 1) {
      res.json({ ok: true });
    } else {
      return res.status(403).json({ error: 'Registration closed' });
    }
  } catch (err) {
    if (err && err.message && err.message.includes('UNIQUE constraint failed')) return res.status(400).json({ error: 'username taken' });
    console.error(err); res.status(500).json({ error: 'server error' }); }
});

app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return res.status(401).json({ error: 'invalid' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid' });
    if (!JWT_SECRET) return res.status(500).json({ error: 'JWT secret not configured' });
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    // Build cookie flags
    const cookieFlags = ['HttpOnly', 'Path=/', `Max-Age=${7*24*3600}`, 'SameSite=Strict'];
    if (process.env.NODE_ENV === 'production') cookieFlags.push('Secure');
    res.setHeader('Set-Cookie', `${JWT_COOKIE_NAME}=${token}; ${cookieFlags.join('; ')}`);
    res.json({ ok: true, username: user.username, token });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server error' }); }
});

function authenticateFromReq(req) {
  // Try Authorization header first, then cookie
  const auth = req.headers['authorization'];
  let token = null;
  if (auth && auth.startsWith('Bearer ')) token = auth.slice('Bearer '.length);
  else if (req.headers.cookie) {
    const m = req.headers.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith(JWT_COOKIE_NAME+'='));
    if (m) token = m.split('=')[1];
  }
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

app.get('/api/me', (req, res) => {
  const user = authenticateFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  res.json({ username: user.username, id: user.id });
});

// Settings helpers
async function getSiteConfig() {
  const row = await dbGet('SELECT value FROM settings WHERE key = ?', ['site_config']);
  if (!row) return { siteName: 'MCJAVASERVER', infoBoxes: [] };
  try { return JSON.parse(row.value); } catch (e) { return { siteName: 'MCJAVASERVER', infoBoxes: [] }; }
}
async function setSiteConfig(obj) {
  const value = JSON.stringify(obj);
  await dbRun('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', ['site_config', value]);
}

// Public settings returned to any visitor
app.get('/api/public-settings', async (req, res) => {
  const config = await getSiteConfig();
  // Only return fields intended for public consumption
  const publicConfig = { siteName: config.siteName || 'MCJAVASERVER', infoBoxes: config.infoBoxes || [] };
  res.json(publicConfig);
});

// Admin endpoints to view and update settings
app.get('/api/settings', async (req, res) => {
  const user = authenticateFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  const config = await getSiteConfig();
  res.json(config);
});

app.post('/api/settings', async (req, res) => {
  const user = authenticateFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  const { siteName, infoBoxes } = req.body;
  if (typeof siteName !== 'string' || siteName.length === 0) return res.status(400).json({ error: 'siteName required' });
  if (!Array.isArray(infoBoxes)) return res.status(400).json({ error: 'infoBoxes must be array' });
  // Basic validation: each box has title and content
  for (const b of infoBoxes) {
    if (typeof b.title !== 'string' || typeof b.content !== 'string') return res.status(400).json({ error: 'invalid infoBoxes format' });
  }
  const config = { siteName, infoBoxes };
  try {
    await setSiteConfig(config);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'save failed' }); }
});

// RCON helpers and command endpoints
async function ensureRconInfo() {
  if (rconInfo) return rconInfo;
  const propsPath = path.join(__dirname, 'minecraft', 'server.properties');
  if (!fs.existsSync(propsPath)) throw new Error('server.properties missing; run npm install or create one with RCON enabled');
  const txt = fs.readFileSync(propsPath, 'utf8');
  const lines = txt.split(/\r?\n/);
  const map = {};
  for (const l of lines) {
    const idx = l.indexOf('=');
    if (idx > 0) map[l.slice(0, idx).trim()] = l.slice(idx+1).trim();
  }
  const host = '127.0.0.1';
  const port = parseInt(map['rcon.port'] || '25575', 10);
  const password = map['rcon.password'];
  if (!password) throw new Error('rcon.password missing in server.properties');
  rconInfo = { host, port, password };
  return rconInfo;
}

async function connectRconWithRetries(retries = 10, delayMs = 2000) {
  const info = await ensureRconInfo();
  for (let i = 0; i < retries; i++) {
    try {
      if (rconClient) {
        try { await rconClient.end(); } catch (e) {}
        rconClient = null;
      }
      rconClient = await Rcon.connect({ host: info.host, port: info.port, password: info.password });
      console.log('RCON connected');
      return rconClient;
    } catch (err) {
      console.log(`RCON connect attempt ${i+1} failed: ${err.message}`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('Unable to connect to RCON after retries');
}

async function sendRconCommand(cmd) {
  if (!rconClient) {
    try {
      await connectRconWithRetries();
    } catch (e) {
      throw new Error('RCON not available');
    }
  }
  try {
    const res = await rconClient.send(cmd);
    return res;
  } catch (err) {
    // Try to reconnect once
    try {
      await connectRconWithRetries(3, 1000);
      const res = await rconClient.send(cmd);
      return res;
    } catch (e) {
      throw err;
    }
  }
}

app.post('/api/start', async (req, res) => {
  const user = authenticateFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  try {
    startServer();
    // try to connect RCON in background
    (async () => {
      try { await connectRconWithRetries(); } catch (e) { console.warn('RCON connect failed: ' + e.message); }
    })();
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'start failed' }); }
});

app.post('/api/stop', async (req, res) => {
  const user = authenticateFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  try {
    // Send stop via RCON if available otherwise attempt stdin
    try {
      await sendRconCommand('stop');
    } catch (_) {
      if (serverProcess) serverProcess.stdin.write('stop\n');
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'stop failed' }); }
});

app.post('/api/cmd', async (req, res) => {
  const user = authenticateFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  const { cmd } = req.body;
  if (!cmd) return res.status(400).json({ error: 'cmd required' });
  try {
    const out = await sendRconCommand(cmd);
    res.json({ ok: true, response: out });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'command failed' });
  }
});

app.post('/api/seed', async (req, res) => {
  const user = authenticateFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  try {
    const out = await sendRconCommand('seed');
    res.json({ ok: true, seed: out });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'seed failed' });
  }
});

// WebSocket server for live console
const server = require('http').createServer(app);
wsServer = new WebSocket.Server({ server, path: '/ws/console' });

wsServer.on('connection', (socket, req) => {
  // Authenticate via cookie or Authorization header. We DO NOT accept token in query string any more.
  const user = authenticateFromReq(req);
  if (!user) { socket.close(1008, 'unauthenticated'); return; }
  socket.user = user;
  clients.add(socket);
  socket.send(JSON.stringify({ type: 'info', msg: 'connected' }));
  socket.on('message', async (data) => {
    try {
      const obj = JSON.parse(data.toString());
      if (obj.type === 'cmd') {
        try {
          const out = await sendRconCommand(obj.cmd);
          socket.send(JSON.stringify({ type: 'cmdResponse', cmd: obj.cmd, response: out }));
        } catch (e) {
          socket.send(JSON.stringify({ type: 'error', msg: 'command failed' }));
        }
      }
    } catch (e) {
      // ignore
    }
  });
  socket.on('close', ()=> clients.delete(socket));
});

function broadcastConsole(line) {
  const msg = JSON.stringify({ type: 'console', line });
  for (const c of clients) {
    try { c.send(msg); } catch (e) {}
  }
}

function startServer() {
  if (serverProcess) return;
  const jar = path.join(__dirname, 'minecraft', 'server.jar');
  if (!fs.existsSync(jar)) throw new Error('server.jar not found at ./minecraft/server.jar — run npm install or place one there');
  // Spawn java (allow memory via env var JAVA_XMX)
  const mem = process.env.MC_XMX || '1G';
  serverProcess = spawn('java', [`-Xmx${mem}`, '-jar', jar, 'nogui'], { cwd: path.join(__dirname, 'minecraft') });
  serverProcess.stdout.on('data', (chunk) => {
    const s = chunk.toString();
    s.split(/\r?\n/).forEach(line => {
      if (line && line.trim()) broadcastConsole(line);
    });
  });
  serverProcess.stderr.on('data', (chunk) => {
    const s = chunk.toString();
    s.split(/\r?\n/).forEach(line => {
      if (line && line.trim()) broadcastConsole('[ERR] ' + line);
    });
  });
  serverProcess.on('exit', (code, sig) => {
    broadcastConsole(`[server exited code=${code} sig=${sig}]`);
    serverProcess = null;
    // close RCON if open
    if (rconClient) {
      try { rconClient.end(); } catch (e) {}
      rconClient = null;
    }
  });
  broadcastConsole('[server started]');
}

function stopServer() {
  if (!serverProcess) return;
  // attempt graceful stop via RCON
  (async () => {
    try { await sendRconCommand('stop'); } catch (e) { try { serverProcess.stdin.write('stop\n'); } catch (e) {} }
  })();
  // kill after 12s if still running
  setTimeout(() => {
    if (serverProcess) {
      try { serverProcess.kill('SIGKILL'); } catch (e) {}
    }
  }, 12000);
}

// Clean up on exit
process.on('SIGINT', () => { try { stopServer(); } catch (e) {} process.exit(); });
process.on('SIGTERM', () => { try { stopServer(); } catch (e) {} process.exit(); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
