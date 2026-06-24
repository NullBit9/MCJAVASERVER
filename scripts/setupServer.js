#!/usr/bin/env node
// Download vanilla Minecraft server jar for the requested version (default: latest release from manifest).
// Supports new Mojang version strings like "26.2" as well as legacy "1.26.2".
// Uses Mojang's version manifest to locate the server download and writes ./minecraft/eula.txt
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

let version = process.env.MC_VERSION || '';
const outDir = path.resolve(__dirname, '..', 'minecraft');

async function ensureDir() {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
}

async function fileExists(p) {
  try { await fs.promises.access(p); return true; } catch { return false; }
}

async function download(url, dest) {
  console.log('Downloading', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download failed ' + res.status + ' ' + res.statusText);
  const tmp = dest + '.tmp';
  const fileStream = fs.createWriteStream(tmp);
  await new Promise((resP, rej) => {
    res.body.pipe(fileStream);
    res.body.on('error', rej);
    fileStream.on('finish', resP);
  });
  await fs.promises.rename(tmp, dest);
}

async function downloadVanillaServer() {
  const dest = path.join(outDir, 'server.jar');
  if (await fileExists(dest)) {
    console.log('server.jar already exists, skipping download');
    return;
  }

  const manifestUrl = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
  console.log('Fetching version manifest...');
  const manRes = await fetch(manifestUrl);
  if (!manRes.ok) throw new Error('Failed to fetch version manifest: ' + manRes.status);
  const manifest = await manRes.json();

  // If no explicit version provided, use the manifest latest release
  if (!version) {
    version = manifest.latest && manifest.latest.release;
    console.log('No MC_VERSION specified — using latest release from manifest:', version);
  }

  // Try matching the provided version intelligently. Mojang may have switched to versions like "26.2".
  const candidates = [version];
  if (!version.startsWith('1.') && !version.startsWith('snapshot')) {
    // also try with leading "1." for older-style entries
    candidates.push('1.' + version);
  }
  if (version.startsWith('1.')) {
    // also try without leading "1." if present
    candidates.push(version.replace(/^1\./, ''));
  }

  // Deduplicate candidates while preserving order
  const seen = new Set();
  const uniq = candidates.filter(c => { if (!c || seen.has(c)) return false; seen.add(c); return true; });

  let verEntry = null;
  for (const c of uniq) {
    verEntry = manifest.versions.find(v => v.id === c);
    if (verEntry) { version = c; break; }
  }

  if (!verEntry) {
    throw new Error(`Version ${version} not found in manifest. Available latest: ${manifest.latest && manifest.latest.release}`);
  }

  console.log(`Found version entry for ${version}, fetching metadata...`);
  const verRes = await fetch(verEntry.url);
  if (!verRes.ok) throw new Error('Failed to fetch version metadata: ' + verRes.status);
  const verMeta = await verRes.json();

  if (!verMeta.downloads || !verMeta.downloads.server || !verMeta.downloads.server.url) {
    throw new Error('Server download URL not available for version ' + version);
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
  } catch (err) {
    console.error('Setup failed:', err && err.message ? err.message : err);
    process.exitCode = 1;
  }
})();
