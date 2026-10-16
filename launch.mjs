// Launcher: starts the register and restarts it after an update.
// Exit code 75 from the server means "an update was installed, start me again".
// With POS_HIDDEN=1 (the desktop icon and auto-start), output goes to data/logs instead of a console window.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';
const npx = isWin ? 'npx.cmd' : 'npx';
const npm = isWin ? 'npm.cmd' : 'npm';
const port = Number(process.env.PORT ?? 3000);
const url = `http://localhost:${port}`;
let opened = false;

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.log(`This POS needs Node.js 22.13 or newer (you have ${process.versions.node}). Install the LTS from https://nodejs.org and start again.`);
  process.exit(1);
}

// ----- logging -----
const logDir = path.join(root, 'data', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'pos.log');
try { if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5_000_000) fs.renameSync(logFile, path.join(logDir, 'pos.old.log')); } catch { /* fine */ }
const logStream = fs.createWriteStream(logFile, { flags: 'a' });
const log = (msg) => { const line = `${new Date().toISOString()} ${msg}`; logStream.write(line + '\n'); if (!process.env.POS_HIDDEN) console.log(msg); };

// ----- browser -----
function findBrowser() {
  if (!isWin) return null;
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) ?? null;
}

function openBrowser() {
  if (opened || process.env.POS_NO_BROWSER) return;
  opened = true;
  try {
    const exe = findBrowser();
    if (exe) {
      // App mode: no tabs or address bar, opens full screen on its own. F11 leaves full screen if ever needed.
      // Set POS_WINDOWED=1 to open as a normal window instead.
      const profile = path.join(root, 'data', 'browser-profile');
      const size = process.env.POS_WINDOWED ? ['--start-maximized'] : ['--start-fullscreen'];
      spawn(exe, [`--app=${url}`, ...size, '--no-first-run', '--disable-session-crashed-bubble', '--disable-features=TranslateUI', `--user-data-dir=${profile}`], { stdio: 'ignore', detached: true }).unref();
    } else {
      const cmd = isWin ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
      spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
    }
  } catch (e) { log(`Could not open the browser: ${e}`); }
}

// Ask the register to put the customer screen on the second monitor (it does nothing if that window is already open).
function openCustomerScreen() {
  if (process.env.POS_NO_BROWSER) return;
  const req = http.request(`${url}/api/display/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, timeout: 15000 }, (res) => {
    let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => { try { log(`Customer screen: ${JSON.parse(body).message}`); } catch { /* fine */ } });
  });
  req.on('error', () => {}); req.on('timeout', () => req.destroy());
  req.end('{}');
}

function alreadyRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/version`, { timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function applyPending() {
  const p = path.join(root, 'updates', 'pending.json');
  if (!fs.existsSync(p)) return;
  let info = {};
  try { info = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* ignore */ }
  fs.rmSync(p, { force: true });
  if (info.npmInstall) {
    log(`Finishing update to version ${info.version}: installing parts…`);
    const r = spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: root, stdio: process.env.POS_HIDDEN ? 'ignore' : 'inherit', shell: isWin, windowsHide: true });
    if (r.status !== 0) log('npm install had a problem. The register will still try to start.');
  }
}

function run() {
  applyPending();
  const child = spawn(npx, ['tsx', 'src/server/index.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: isWin, windowsHide: true, env: { ...process.env, POS_LAUNCHER: '1' } });
  child.stdout.on('data', (d) => log(String(d).trimEnd()));
  child.stderr.on('data', (d) => { const s = String(d).trimEnd(); if (!/ExperimentalWarning|trace-warnings|DeprecationWarning|trace-deprecation/.test(s)) log(s); });
  child.on('exit', (code) => {
    if (code === 75) { log('Restarting after update…'); setTimeout(run, 500); }
    else if (code !== 0 && code !== null) { log(`Register stopped unexpectedly (${code}); restarting in 5s.`); setTimeout(run, 5000); }
    else { log(`Register stopped (${code ?? 'signal'}).`); process.exit(code ?? 0); }
  });
  setTimeout(openBrowser, 2500);
  setTimeout(openCustomerScreen, 6000);
}

alreadyRunning().then((running) => {
  if (running) { log('Register is already running; opening the screens.'); openBrowser(); openCustomerScreen(); setTimeout(() => process.exit(0), 4000); }
  else run();
});
