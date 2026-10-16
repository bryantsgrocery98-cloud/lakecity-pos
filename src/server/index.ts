import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { getSetting, openDb } from './db.js';
import { seedIfEmpty } from './seed.js';
import { createDisplay } from './display.js';
import { createUpdater } from './updater.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dbFile = process.env.POS_DB ?? path.join(root, 'data', 'pos.db');
const port = Number(process.env.PORT ?? 3000);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string; posUpdateSource?: string };
const version = pkg.version;

const db = openDb(dbFile);
if (seedIfEmpty(db)) console.log('Loaded demo products. Demo PINs: cashier 1111, manager 2222, owner 3333.');

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
  // The customer screen is opened by the launcher (launch.mjs) once the register is up, so a desktop icon brings up both screens.
});
