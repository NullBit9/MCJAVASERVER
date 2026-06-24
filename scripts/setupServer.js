#!/usr/bin/env node
// Download latest PaperMC build for 1.26.2 if no jar exists.
// Creates ./minecraft directory and eula.txt
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const version = process.env.MC_VERSION || '1.26.2';
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
  if (!res.ok) throw new Error('Download failed ' + res.status);
  const tmp = dest + '.tmp';
  const fileStream = fs.createWriteStream(tmp);
  await new Promise((resP, rej) => {
    res.body.pipe(fileStream);
    res.body.on('error', rej);
    fileStream.on('finish', resP);
  });
  await fs.promises.rename(tmp, dest);
}

async function downloadPaper() {
  // Query PaperMC API for builds
  const buildsUrl = `https://api.papermc.io/v2/projects/paper/versions/${version}`;
  const r = await fetch(buildsUrl);
  if (!r.ok) {
    console.warn('PaperMC API not available; skipping automatic jar download. You can place a server jar at ./minecraft/server.jar');
    return;
  }
  const info = await r.json(); // contains builds array
  const builds = info.builds;
  if (!builds || builds.length === 0) {
    console.warn('No builds found for version', version);
    return;
  }
  const latest = builds[builds.length - 1];
  const jarName = `paper-${version}-${latest}.jar`;
  const downloadUrl = `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${latest}/downloads/${jarName}`;
  const dest = path.join(outDir, 'server.jar');
  if (await fileExists(dest)) {
    console.log('server.jar already exists, skipping download');
    return;
  }
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
  } catch (err) {
    console.error('Setup failed:', err);
    process.exitCode = 1;
  }
})();
