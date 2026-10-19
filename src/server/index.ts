import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { getSetting, openDb } from './db.js';
import { seedIfEmpty } from './seed.js';
import { createDisplay, listScreens, openCustomerWindow } from './display.js';
import { applyDealPresets, clearWrongAgeFlags, linkButtonsToItems } from './deal-presets.js';
import { createUpdater } from './updater.js';
import { autoCloseWorkdays } from './reports.js';
import { zReportBytes } from './escpos.js';
import { sendToPrinter } from './printer.js';
import { workdayFor } from '../core/workday.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dbFile = process.env.POS_DB ?? path.join(root, 'data', 'pos.db');
const port = Number(process.env.PORT ?? 3000);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string; posUpdateSource?: string };
const version = pkg.version;

const db = openDb(dbFile);
if (seedIfEmpty(db)) console.log('Loaded demo products. Demo PINs: cashier 1111, manager 2222, owner 3333.');
const presetDeals = applyDealPresets(db);
if (presetDeals) console.log(`[deals] set shelf deals on ${presetDeals} items`);
const cleared = clearWrongAgeFlags(db);
if (cleared) console.log(`[id] cleared the ID flag on ${cleared} items/buttons that are not alcohol or tobacco`);
const linked = linkButtonsToItems(db);
if (linked) console.log(`[buttons] linked ${linked} quick buttons to their inventory items`);

// Where new builds are published. A Google Drive folder id, or a URL to latest.json.
const updateSource = process.env.POS_UPDATE_SOURCE ?? getSetting(db, 'update_source', pkg.posUpdateSource ?? '');
const updater = createUpdater({ root, currentVersion: version, source: updateSource, log: (m) => console.log(`[update] ${m}`) });

const display = createDisplay();
const app = createApp(db, path.join(root, 'dist', 'web'), { updater, version, imagesDir: path.join(path.dirname(dbFile), 'images'), root, display });
// Listen on this computer only. Nothing else on the network can reach the register.
app.listen(port, '127.0.0.1', () => {
  console.log(`POS ${version} running at http://localhost:${port}`);
  if (updateSource && process.env.POS_NO_UPDATE !== '1') updater.start();
  else console.log('[update] no update source set; auto-update is off.');
  // End of day: once the workday rolls over (midnight, or the workday start time in Settings), any day still open is
  // closed with a Z report automatically and printed if the printer is on. The next day then starts from zero.
  const autoClose = () => {
    if (getSetting(db, 'auto_close', 'true') !== 'true') return;
    try {
      const today = workdayFor(new Date(), getSetting(db, 'timezone', 'America/New_York'), getSetting(db, 'workday_start', '00:00'));
      for (const report of autoCloseWorkdays(db, today)) {
        console.log(`[z] closed ${report.workday} automatically`);
        const target = getSetting(db, 'printer_target', '');
        if (target && getSetting(db, 'auto_close_print', 'true') === 'true') {
          sendToPrinter({ target }, zReportBytes(report, getSetting(db, 'store_name', 'POS'), { items: true })).catch((e) => console.log(`[z] print: ${(e as Error).message}`));
        }
      }
    } catch (e) { console.log(`[z] auto close: ${(e as Error).message}`); }
  };
  autoClose();
  setInterval(autoClose, 60_000).unref();
  // Customer screen: the launcher opens it at start; this watcher also opens it whenever a second monitor shows up later
  // (plugged in, woken up, after a reboot) and no customer window is showing.
  if (process.platform === 'win32' && !process.env.POS_NO_BROWSER) {
    let lastTry = 0;
    setInterval(async () => {
      if (display.clientCount() > 0 || getSetting(db, 'customer_display', 'true') !== 'true') return;
      if (Date.now() - lastTry < 25_000) return;
      lastTry = Date.now();
      try {
        const screens = await listScreens();
        if (screens.some((sc) => !sc.primary)) console.log(`[display] ${await openCustomerWindow(root, `http://localhost:${port}/customer`)}`);
      } catch { /* try again next time */ }
    }, 30_000).unref();
  }
});
