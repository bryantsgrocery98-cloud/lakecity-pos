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
  tender?: 'cash' | 'card';
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
