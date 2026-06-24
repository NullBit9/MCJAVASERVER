#!/usr/bin/env node
// Download PaperMC build for the requested version (default: 1.26.2).
// Accepts new Mojang-style version strings like "26.2" and legacy "1.26.2".
// Uses Node's global fetch (Node 18+).
const fs = require('fs');
const path = require('path');

const rawVersion = process.env.MC_VERSION || '';
const defaultVersion = '1.26.2';
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

function buildCandidates(raw) {
  const seen = new Set();
  const push = v => { if (!v) return; if (!seen.has(v)) { seen.add(v); candidates.push(v); } };
  const candidates = [];
  if (!raw) {
    push(defaultVersion);
    return candidates;
  }
  // If user provided "26.2" (two-part), try legacy "1.26.2" first, then the raw.
  if (/^\d+\.\d+$/.test(raw)) {
    push('1.' + raw); // 26.2 -> 1.26.2
    push(raw);
    return candidates;
  }
  // If user provided legacy "1.26.2", try that and the short form
  if (/^1\.\d+\.\d+$/.test(raw)) {
    push(raw);
    push(raw.replace(/^1\./, ''));
    return candidates;
  }
  // Otherwise use raw and default
  push(raw);
  push(defaultVersion);
  return candidates;
}

async function findPaperVersion() {
  const candidates = buildCandidates(rawVersion);
  for (const v of candidates) {
    const url = `https://api.papermc.io/v2/projects/paper/versions/${v}`;
    try {
      const r = await fetch(url);
      if (r.ok) {
        console.log('Using Paper version:', v);
        return v;
      }
    } catch (e) {
      // ignore and try next
    }
  }
  return null;
}

async function downloadPaper() {
  const dest = path.join(outDir, 'server.jar');
  if (await fileExists(dest)) {
    console.log('server.jar already exists, skipping download');
    return;
  }

  const found = await findPaperVersion();
  if (!found) {
    console.warn(`Could not find a Paper version for MC_VERSION="${rawVersion}". Tried sensible variants.\nPlace a server.jar at ./minecraft/server.jar manually or set MC_VERSION to a valid Paper version (e.g., 1.26.2 or 26.2).`);
    return;
  }

  // Fetch builds for the found version
  const buildsUrl = `https://api.papermc.io/v2/projects/paper/versions/${found}`;
  const r = await fetch(buildsUrl);
  if (!r.ok) { console.warn('PaperMC API not available; skipping automatic jar download.'); return; }
  const info = await r.json();
  const builds = info.builds;
  if (!builds || builds.length === 0) { console.warn('No builds found for version', found); return; }
  const latest = builds[builds.length - 1];
  const jarName = `paper-${found}-${latest}.jar`;
  const downloadUrl = `https://api.papermc.io/v2/projects/paper/versions/${found}/builds/${latest}/downloads/${jarName}`;

  try {
    await download(downloadUrl, dest);
    console.log('Downloaded Paper jar to', dest);
  } catch (err) {
    console.warn('Failed to download Paper jar:', err.message);
    console.warn('You can manually place a server jar at ./minecraft/server.jar');
  }
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
    await downloadPaper();
    await ensureEula();
    console.log('Setup complete. Start server with `npm start` and then use the web UI to start the Minecraft server process.');
    if (rawVersion) console.log(`Requested MC_VERSION=${rawVersion}`);
  } catch (err) {
    console.error('Setup failed:', err);
    process.exitCode = 1;
  }
})();
