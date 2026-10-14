// Launcher: starts the register and restarts it after an update.
// Exit code 75 from the server means "an update was installed, start me again".
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';
const npx = isWin ? 'npx.cmd' : 'npx';
const npm = isWin ? 'npm.cmd' : 'npm';
let opened = false;

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.log(`This POS needs Node.js 22.13 or newer (you have ${process.versions.node}). Install the LTS from https://nodejs.org and start again.`);
  process.exit(1);
}

function openBrowser() {
  if (opened || process.env.POS_NO_BROWSER) return;
  opened = true;
  const url = `http://localhost:${process.env.PORT ?? 3000}`;
  const cmd = isWin ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* fine */ }
}

function applyPending() {
  const p = path.join(root, 'updates', 'pending.json');
  if (!fs.existsSync(p)) return;
  let info = {};
  try { info = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* ignore */ }
  fs.rmSync(p, { force: true });
  if (info.npmInstall) {
    console.log(`Finishing update to version ${info.version}: installing parts…`);
    const r = spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit', shell: isWin });
    if (r.status !== 0) console.log('npm install had a problem. The register will still try to start.');
  }
}

function run() {
  applyPending();
  const child = spawn(npx, ['tsx', 'src/server/index.ts'], { cwd: root, stdio: 'inherit', shell: isWin, env: { ...process.env, POS_LAUNCHER: '1' } });
  child.on('exit', (code) => {
    if (code === 75) { console.log('Restarting after update…'); setTimeout(run, 500); }
    else { console.log(`Register stopped (${code ?? 'signal'}).`); process.exit(code ?? 0); }
  });
  setTimeout(openBrowser, 2500);
}

run();
