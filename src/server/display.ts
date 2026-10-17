// Customer-facing display. The register pushes what the customer should see; the
// customer page (at /customer) listens over a server-sent event stream.
// Also opens the customer window on the second monitor (Windows).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';

export type DisplayLine = { name: string; qty: number; cents: number };
export type DisplayState = {
  mode: 'idle' | 'ticket' | 'paid';
  lines: DisplayLine[];
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  /** After a sale. */
  tender?: 'cash' | 'card' | 'check';
  tenderedCents?: number;
  changeCents?: number;
  at: number;
};

const EMPTY: DisplayState = { mode: 'idle', lines: [], subtotalCents: 0, taxCents: 0, discountCents: 0, totalCents: 0, at: 0 };

export function createDisplay() {
  let state: DisplayState = { ...EMPTY, at: Date.now() };
  const clients = new Set<Response>();

  function send(res: Response) { res.write(`data: ${JSON.stringify(state)}\n\n`); }

  return {
    get: () => state,
    set(next: Partial<DisplayState>) {
      state = { ...EMPTY, ...next, at: Date.now() };
      for (const c of clients) { try { send(c); } catch { clients.delete(c); } }
    },
    subscribe(res: Response) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      clients.add(res);
      send(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 15000);
      res.on('close', () => { clearInterval(ping); clients.delete(res); });
    },
    clientCount: () => clients.size,
  };
}

// ---------- opening the customer window (Windows) ----------

function findBrowser(): string | null {
  if (process.platform !== 'win32') return null;
  const c = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  return c.find((p) => p && fs.existsSync(p)) ?? null;
}

export type ScreenInfo = { x: number; y: number; width: number; height: number; primary: boolean };

/** Monitors attached right now (Windows only). */
export function listScreens(): Promise<ScreenInfo[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { "$($_.Bounds.X),$($_.Bounds.Y),$($_.Bounds.Width),$($_.Bounds.Height),$($_.Primary)" }'],
      { windowsHide: true });
    let out = '';
    ps.stdout.on('data', (d) => { out += d; });
    const done = () => resolve(out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [x, y, w, h, p] = l.split(',');
      return { x: Number(x), y: Number(y), width: Number(w), height: Number(h), primary: /true/i.test(p ?? '') };
    }));
    ps.on('close', done); ps.on('error', done);
    setTimeout(done, 8000);
  });
}

/**
 * Opens the customer page full screen on the second monitor. Returns a message for the UI.
 * Uses its own browser profile so it is a separate window from the register.
 */
export async function openCustomerWindow(root: string, url: string): Promise<string> {
  const exe = findBrowser();
  if (!exe) return 'Could not find Microsoft Edge or Chrome on this computer.';
  const screens = await listScreens();
  const second = screens.find((s) => !s.primary);
  if (!second) return 'Only one screen is connected. Plug in the customer screen and try again.';
  const profile = path.join(root, 'data', 'customer-profile');
  spawn(exe, [`--app=${url}`, `--window-position=${second.x},${second.y}`, `--window-size=${second.width},${second.height}`, '--start-fullscreen',
    '--no-first-run', '--disable-session-crashed-bubble', `--user-data-dir=${profile}`], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  return `Customer screen opened on the ${second.width}x${second.height} monitor.`;
}

/** Closes the register and customer windows (the browser windows we opened with our own profiles). Windows only. */
export function closeOurWindows(root: string): Promise<void> {
  if (process.platform !== 'win32') return Promise.resolve();
  const marker = path.join(root, 'data'); // both of our browser profiles live under data\
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*user-data-dir=${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
      { windowsHide: true });
    ps.on('close', () => resolve()); ps.on('error', () => resolve());
    setTimeout(resolve, 8000);
  });
}

/** Restart or shut down the computer (Windows). */
export function powerOffComputer(reboot: boolean): void {
  if (process.platform !== 'win32') return;
  spawn('shutdown.exe', [reboot ? '/r' : '/s', '/t', '3', '/f'], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
}

/** Brings the register window (title "Bryants Grocery POS" / the register page) to the front. Returns true if one was found. */
export function focusRegisterWindow(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    const script = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }
"@
$p = Get-Process msedge, chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*Grocery POS*' } | Select-Object -First 1
if ($p) { [W]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; [W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; "FOUND" } else { "NONE" }`;
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    let out = '';
    ps.stdout.on('data', (d) => { out += d; });
    const done = () => resolve(out.includes('FOUND'));
    ps.on('close', done); ps.on('error', done);
    setTimeout(done, 8000);
  });
}

/** Opens the register window (app mode, full screen) with its own browser profile. */
export function openRegisterWindow(root: string, url: string, windowed = false): string {
  const exe = findBrowser();
  const profile = path.join(root, 'data', 'browser-profile');
  if (!exe) {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
    return 'Opened in the default browser.';
  }
  spawn(exe, [`--app=${url}`, windowed ? '--start-maximized' : '--start-fullscreen', '--no-first-run', '--disable-session-crashed-bubble', '--disable-features=TranslateUI', `--user-data-dir=${profile}`],
    { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  return 'Register screen opened.';
}
