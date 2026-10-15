// Auto-updater. Checks a public Google Drive folder (or any plain URL) for a
// newer build, downloads it, verifies the checksum, swaps the program files
// in place, and asks the launcher to restart. The data/ folder is never touched.

import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RESTART_EXIT_CODE = 75;

export type Manifest = { version: string; file: string; sha256: string; notes?: string; fileId?: string };
export type UpdateStatus = {
  current: string; latest: string | null; state: 'idle' | 'checking' | 'downloading' | 'installing' | 'restarting' | 'error' | 'up-to-date';
  message: string; checkedAt: string | null; source: string;
};

export type UpdaterOptions = {
  root: string;                 // the app folder (holds src/, dist/, package.json)
  currentVersion: string;
  /** Either a Google Drive folder id, or a full URL to latest.json. */
  source: string;
  log?: (msg: string) => void;
};

const KEEP = new Set(['data', 'node_modules', 'updates', '.git']); // never replaced or deleted
const REPLACE = ['src', 'dist', 'package.json', 'package-lock.json', 'start-pos.bat', 'start-pos.command', 'start-pos-hidden.vbs', 'setup-windows.bat', 'setup-windows.ps1', 'pos.ico', 'launch.mjs', 'README.md', 'HARDWARE.md', 'scripts'];

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0); }
  return 0;
}

function driveDownloadUrl(id: string): string {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
}

/** Lists a public Drive folder without an API key by reading its embedded folder view. */
export async function listDriveFolder(folderId: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`);
  if (!res.ok) throw new Error(`Drive folder not reachable (${res.status}). Is it shared as "Anyone with the link"?`);
  const html = await res.text();
  const out: { id: string; name: string }[] = [];
  // Entries look like: <div class="flip-entry" id="entry-FILEID" ...> ... <div class="flip-entry-title">name</div>
  const re = /id="entry-([\w-]+)"[\s\S]*?flip-entry-title">([^<]+)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push({ id: m[1]!, name: m[2]!.trim() });
  return out;
}

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const ct = res.headers.get('content-type') ?? '';
  const buf = Buffer.from(await res.arrayBuffer());
  // Drive shows an HTML "can't scan for viruses" page for big files; ours are small, so HTML means something is wrong.
  if (ct.includes('text/html') && !url.endsWith('.json')) throw new Error('Drive returned a web page instead of the file. Check the sharing setting.');
  return buf;
}

export function createUpdater(opts: UpdaterOptions) {
  const log = opts.log ?? (() => {});
  const status: UpdateStatus = { current: opts.currentVersion, latest: null, state: 'idle', message: '', checkedAt: null, source: opts.source };
  let running = false;
  let onRestart: (() => void) | null = null;
  let busyUntil = 0; // while a ticket is open on the register, hold off restarting
  let installed: string | null = null; // a version already unpacked and waiting for the restart
  let restartTimer: NodeJS.Timeout | null = null;
  let installedAt = 0;

  function restartNow() {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    status.state = 'restarting'; status.message = `Restarting into version ${installed ?? status.latest ?? ''}…`;
    log(status.message);
    onRestart?.(); process.exit(RESTART_EXIT_CODE);
  }
  function restartWhenIdle() {
    if (Date.now() < busyUntil) {
      // A ticket is open. Wait, but never longer than 30 minutes: then the register screen offers an "install now" button instead.
      status.message = `Version ${installed} is ready. Waiting for the ticket to finish…`;
      restartTimer = setTimeout(restartWhenIdle, 5000);
      return;
    }
    restartNow();
  }

  async function readManifest(): Promise<Manifest> {
    if (/^https?:\/\//.test(opts.source)) {
      const m = JSON.parse((await fetchBytes(opts.source)).toString('utf8')) as Manifest;
      return m;
    }
    const files = await listDriveFolder(opts.source);
    const manifestFile = files.find((f) => f.name === 'latest.json');
    if (!manifestFile) throw new Error('No latest.json in the update folder yet.');
    const m = JSON.parse((await fetchBytes(driveDownloadUrl(manifestFile.id))).toString('utf8')) as Manifest;
    const zip = files.find((f) => f.name === m.file);
    if (!zip) throw new Error(`The update folder has no file named ${m.file}.`);
    m.fileId = zip.id;
    return m;
  }

  async function downloadZip(m: Manifest): Promise<Buffer> {
    const url = m.fileId ? driveDownloadUrl(m.fileId) : new URL(m.file, opts.source).toString();
    const buf = await fetchBytes(url);
    const sum = createHash('sha256').update(buf).digest('hex');
    if (sum !== m.sha256) throw new Error('The downloaded update did not match its checksum, so it was not installed.');
    return buf;
  }

  function install(buf: Buffer, version: string): boolean {
    const stage = path.join(opts.root, 'updates', version);
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    const zip = new AdmZip(buf);
    zip.extractAllTo(stage, true);
    // The zip may wrap everything in one top-level folder.
    let src = stage;
    const entries = fs.readdirSync(stage);
    if (entries.length === 1 && fs.statSync(path.join(stage, entries[0]!)).isDirectory()) src = path.join(stage, entries[0]!);
    if (!fs.existsSync(path.join(src, 'package.json'))) throw new Error('The update file does not look like a POS build.');

    const oldLock = readIfExists(path.join(opts.root, 'package-lock.json'));
    for (const name of REPLACE) {
      if (KEEP.has(name)) continue;
      const from = path.join(src, name);
      const to = path.join(opts.root, name);
      if (!fs.existsSync(from)) continue;
      fs.rmSync(to, { recursive: true, force: true });
      fs.cpSync(from, to, { recursive: true });
    }
    const newLock = readIfExists(path.join(opts.root, 'package-lock.json'));
    fs.rmSync(stage, { recursive: true, force: true });
    return oldLock !== newLock; // tells the launcher to run npm install
  }

  async function check(apply = true): Promise<UpdateStatus> {
    if (running) return status;
    running = true;
    try {
      status.state = 'checking'; status.message = 'Checking for updates…';
      const m = await readManifest();
      status.latest = m.version; status.checkedAt = new Date().toISOString();
      if (compareVersions(m.version, opts.currentVersion) <= 0) {
        status.state = 'up-to-date'; status.message = `Up to date (version ${opts.currentVersion}).`;
        log(status.message);
        return status;
      }
      if (!apply) { status.state = 'idle'; status.message = `Version ${m.version} is available.`; return status; }
      if (installed === m.version) {
        // Already unpacked earlier; just try the restart again.
        status.state = 'restarting';
        if (!restartTimer) restartTimer = setTimeout(restartWhenIdle, 500);
        return status;
      }
      status.state = 'downloading'; status.message = `Downloading version ${m.version}…`;
      log(status.message);
      const buf = await downloadZip(m);
      status.state = 'installing'; status.message = `Installing version ${m.version}…`;
      log(status.message);
      const needInstall = install(buf, m.version);
      fs.writeFileSync(path.join(opts.root, 'updates', 'pending.json'), JSON.stringify({ version: m.version, npmInstall: needInstall, at: new Date().toISOString() }));
      installed = m.version; installedAt = Date.now();
      status.state = 'restarting'; status.message = `Version ${m.version} installed. Restarting the register…`;
      log(status.message);
      restartTimer = setTimeout(restartWhenIdle, 1500);
      return status;
    } catch (e) {
      status.state = 'error'; status.message = (e as Error).message;
      log(`Update check failed: ${status.message}`);
      return status;
    } finally { running = false; }
  }

  function start(intervalMs = 10 * 60 * 1000) {
    setTimeout(() => { check(); }, 5000);
    setInterval(() => { check(); }, intervalMs).unref();
  }

  return { check, start, status: () => ({ ...status, pending: installed, pendingSince: installedAt || null }), onRestart: (fn: () => void) => { onRestart = fn; },
    /** Called by the register screen; a ticket in progress keeps restarts on hold for a couple of minutes. */
    setBusy: (open: boolean) => { busyUntil = open ? Date.now() + 120_000 : 0; },
    /** Restart into the installed version right now, ticket or not (the cashier asked). */
    restartNow: () => { if (!installed) throw new Error('No update is waiting.'); busyUntil = 0; restartNow(); },
    pending: () => installed };
}

function readIfExists(p: string): string | null {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
