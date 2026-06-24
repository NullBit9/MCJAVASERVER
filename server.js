// Simple Express server with first-visitor registration and websocket console
const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'data', 'db.sqlite');
if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new sqlite3.Database(DB_PATH);

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-to-secure-secret';
const JWT_COOKIE_NAME = 'mcjsess';

let serverProcess = null;
let wsServer; // set later
const clients = new Set();

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
}
initDb().catch(console.error);

app.get('/api/first', async (req, res) => {
  const row = await dbGet('SELECT COUNT(1) AS c FROM users');
  res.json({ allowRegister: (row && row.c === 0) });
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username+password required' });
    const row = await dbGet('SELECT COUNT(1) AS c FROM users');
    if (row && row.c > 0) return res.status(403).json({ error: 'Registration closed' });
    const hash = await bcrypt.hash(password, 10);
    await dbRun('INSERT INTO users(username,password_hash) VALUES(?,?)', [username, hash]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server error' }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return res.status(401).json({ error: 'invalid' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid' });
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie = (() => {}); // placeholder for frameworks that set cookies; we'll set header
    // set cookie in header
    res.setHeader('Set-Cookie', `${JWT_COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${7*24*3600}`);
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

app.post('/api/start', async (req, res) => {
  const user = authenticateFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  try {
    startServer();
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'start failed' }); }
});

app.post('/api/stop', async (req, res) => {
  const user = authenticateFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  try {
    stopServer();
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'stop failed' }); }
});

app.post('/api/cmd', async (req, res) => {
  const user = authenticateFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  const { cmd } = req.body;
  if (!cmd) return res.status(400).json({ error: 'cmd required' });
  if (!serverProcess) return res.status(400).json({ error: 'server not running' });
  serverProcess.stdin.write(cmd + '\n');
  res.json({ ok: true });
});

app.post('/api/seed', async (req, res) => {
  const user = authenticateFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  if (!serverProcess) return res.status(400).json({ error: 'server not running' });
  // We'll send "seed" command and listen for a response line that contains the seed
  const token = Math.random().toString(36).slice(2, 9);
  const marker = `[SEED-${token}]`;
  // server console prints seed to stdout; we inject a tellraw marker before and after if needed
  // Simpler: send 'seed' and capture next few output lines for "Seed:" phrase
  let responded = false;
  const onLine = (line) => {
    if (line.toLowerCase().includes('seed')) {
      responded = true;
      cleanup();
      res.json({ ok: true, seed: line });
    }
  };
  const cleanup = () => {
    serverProcess.stdout.removeListener('data', stdoutHandler);
    setTimeout(()=>{}, 0);
  };
  function stdoutHandler(chunk) {
    const s = chunk.toString();
    s.split(/\r?\n/).forEach(l => onLine(l));
  }
  serverProcess.stdout.on('data', stdoutHandler);
  serverProcess.stdin.write('seed\n');
  // fallback timeout
  setTimeout(() => {
    if (!responded) {
      try { serverProcess.stdout.removeListener('data', stdoutHandler); } catch {}
      res.status(504).json({ error: 'no response' });
    }
  }, 4000);
});

// WebSocket server for live console
const server = require('http').createServer(app);
wsServer = new WebSocket.Server({ server, path: '/ws/console' });

wsServer.on('connection', (socket, req) => {
  // Basic token auth via query param or cookie
  const url = new URL(req.url, `http://${req.headers.host}`);
  let token = url.searchParams.get('token');
  if (!token && req.headers.cookie) {
    const m = req.headers.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith(JWT_COOKIE_NAME+'='));
    if (m) token = m.split('=')[1];
  }
  let user = null;
  if (!token) {
    socket.close(1008, 'no auth');
    return;
  }
  try { user = jwt.verify(token, JWT_SECRET); } catch (e) { socket.close(1008, 'invalid token'); return; }
  socket.user = user;
  clients.add(socket);
  socket.send(JSON.stringify({ type: 'info', msg: 'connected' }));
  socket.on('message', (data) => {
    try {
      const obj = JSON.parse(data.toString());
      if (obj.type === 'cmd') {
        if (!serverProcess) socket.send(JSON.stringify({ type: 'error', msg: 'server not running' }));
        else serverProcess.stdin.write(obj.cmd + '\n');
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
  // Spawn java
  serverProcess = spawn('java', ['-Xmx1G', '-jar', jar, 'nogui'], { cwd: path.join(__dirname, 'minecraft') });
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
  });
  broadcastConsole('[server started]');
}

function stopServer() {
  if (!serverProcess) return;
  // attempt graceful stop
  serverProcess.stdin.write('stop\n');
  // kill after 8s if still running
  setTimeout(() => {
    if (serverProcess) {
      try { serverProcess.kill('SIGKILL'); } catch (e) {}
    }
  }, 8000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
