#!/usr/bin/env node
// Download Mojang (vanilla) Minecraft server JAR for the requested version.
// Accepts new-style strings like "26.2" or legacy "1.26.2" and tries sensible variants.
// Uses Node's global fetch (Node 18+).
const fs = require('fs');
const path = require('path');
const stream = require('stream');

const rawVersion = process.env.MC_VERSION || '';
const defaultVersion = '1.26.2';
const outDir = path.resolve(__dirname, '..', 'minecraft');

async function ensureDir() {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
}

async function fileExists(p) {
  try { await fs.promises.access(p); return true; } catch { return false; }
}

async function writeResponseToFile(res, dest) {
  // Handle both Node.js _stream.Readable_ and WHATWG ReadableStream (fetch in Node 18+)
  const tmp = dest + '.tmp';

  // If res.body has pipe (Node stream), use pipe
  if (res.body && typeof res.body.pipe === 'function') {
    const fileStream = fs.createWriteStream(tmp);
    await new Promise((resolve, reject) => {
      res.body.pipe(fileStream);
      res.body.on('error', reject);
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });
    await fs.promises.rename(tmp, dest);
    return;
  }

  // If WHATWG ReadableStream: convert to Node stream (Readable.fromWeb)
  if (res.body && typeof res.body.getReader === 'function' && stream.Readable && typeof stream.Readable.fromWeb === 'function') {
    const nodeStream = stream.Readable.fromWeb(res.body);
    const fileStream = fs.createWriteStream(tmp);
    await new Promise((resolve, reject) => {
      nodeStream.pipe(fileStream);
      nodeStream.on('error', reject);
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });
    await fs.promises.rename(tmp, dest);
    return;
  }

  // Fallback: read into memory via arrayBuffer and write
  const arr = await res.arrayBuffer();
  await fs.promises.writeFile(tmp, Buffer.from(arr));
  await fs.promises.rename(tmp, dest);
}

async function download(url, dest) {
  console.log('Downloading', url);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Download failed ' + res.status + ' ' + res.statusText);
      await writeResponseToFile(res, dest);
      return;
    } catch (err) {
      console.warn(`Attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

function buildCandidates(raw) {
  const seen = new Set();
  const candidates = [];
  const push = v => { if (!v) return; if (!seen.has(v)) { seen.add(v); candidates.push(v); } };
  if (!raw) { push(defaultVersion); return candidates; }
  if (/^\d+\.\d+$/.test(raw)) {
    push('1.' + raw);
    push(raw);
    return candidates;
  }
  if (/^1\.\d+\.\d+$/.test(raw)) {
    push(raw);
    push(raw.replace(/^1\./, ''));
    return candidates;
  }
  push(raw);
  push(defaultVersion);
  return candidates;
}

async function findVanillaVersion() {
  const manifestUrl = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
  const resp = await fetch(manifestUrl);
  if (!resp.ok) throw new Error('Failed to fetch Mojang version manifest: ' + resp.status);
  const manifest = await resp.json();

  const candidates = buildCandidates(rawVersion);
  console.log('Version candidates to try:', candidates.join(', '));
  for (const c of candidates) {
    const entry = manifest.versions.find(v => v.id === c);
    if (entry) return entry;
  }
  return null;
}

async function downloadVanillaServer() {
  const dest = path.join(outDir, 'server.jar');
  if (await fileExists(dest)) { console.log('server.jar already exists, skipping download'); return; }

  const entry = await findVanillaVersion();
  if (!entry) {
    console.warn(`Could not find a vanilla version for MC_VERSION="${rawVersion}". Tried sensible variants.\nPlace a server.jar at ./minecraft/server.jar manually or set MC_VERSION to a valid version (e.g., 1.26.2 or 26.2).`);
    return;
  }

  console.log('Found manifest entry for version', entry.id);
  const verRes = await fetch(entry.url);
  if (!verRes.ok) throw new Error('Failed to fetch version metadata: ' + verRes.status);
  const verMeta = await verRes.json();
  if (!verMeta.downloads || !verMeta.downloads.server || !verMeta.downloads.server.url) {
    throw new Error('Server download URL not available for version ' + entry.id);
  }
  const downloadUrl = verMeta.downloads.server.url;
  await download(downloadUrl, dest);
  console.log('Downloaded vanilla server jar to', dest);
}

async function ensureEula() {
  const e = path.join(outDir, 'eula.txt');
  if (!fs.existsSync(e)) {
    fs.writeFileSync(e, 'eula=true\n', { encoding: 'utf8' });
    console.log('Wrote eula.txt (you accepted eula=true).');
  }
}

(async () => {
  try {
    await ensureDir();
    await downloadVanillaServer();
    await ensureEula();
    console.log('Setup complete. Start server with `npm start` and then use the web UI to start the Minecraft server process.');
    if (rawVersion) console.log(`Requested MC_VERSION=${rawVersion}`);
  } catch (err) {
    console.error('Setup failed:', err && err.message ? err.message : err);
    process.exitCode = 1;
  }
})();
