// Builds a release: dist/web, then release/lakecity-pos-<version>.zip and release/latest.json.
// Upload both files to the "Lake City POS Updates" Drive folder; registers update themselves.
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const notes = process.argv.slice(2).join(' ');

execSync('npx vite build', { cwd: root, stdio: 'inherit' });

const include = ['src', 'dist', 'package.json', 'package-lock.json', 'start-pos.bat', 'start-pos.command', 'launch.mjs', 'README.md', 'HARDWARE.md', 'scripts'];
const zip = new AdmZip();
for (const name of include) {
  const p = path.join(root, name);
  if (!fs.existsSync(p)) continue;
  if (fs.statSync(p).isDirectory()) zip.addLocalFolder(p, name, (f) => !f.includes('node_modules'));
  else zip.addLocalFile(p);
}
const outDir = path.join(root, 'release');
fs.mkdirSync(outDir, { recursive: true });
const file = `lakecity-pos-${pkg.version}.zip`;
const buf = zip.toBuffer();
fs.writeFileSync(path.join(outDir, file), buf);
const sha256 = createHash('sha256').update(buf).digest('hex');
const manifest = { version: pkg.version, file, sha256, notes, builtAt: new Date().toISOString() };
fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(manifest, null, 2));
console.log(`Built ${file} (${(buf.length / 1024).toFixed(0)} KB)\nsha256 ${sha256}`);

// Publish: copy the build onto the `updates` branch and push it. Registers pick it up within the hour.
if (process.env.PUBLISH !== '0') {
  const wt = path.join(root, '.updates-worktree');
  const git = (args) => execSync(`git ${args}`, { cwd: wt, stdio: 'pipe' }).toString();
  if (!fs.existsSync(wt)) execSync(`git worktree add ${wt} updates`, { cwd: root, stdio: 'inherit' });
  git('pull -q --ff-only origin updates');
  for (const old of fs.readdirSync(wt).filter((f) => f.endsWith('.zip') && f !== file)) fs.rmSync(path.join(wt, old));
  fs.copyFileSync(path.join(outDir, file), path.join(wt, file));
  fs.copyFileSync(path.join(outDir, 'latest.json'), path.join(wt, 'latest.json'));
  git('add -A');
  git(`-c user.name=Claude -c user.email=noreply@anthropic.com commit -qm "Publish ${pkg.version}"`);
  git('push -q origin updates');
  console.log(`Published ${pkg.version} to the updates branch. Registers will update themselves.`);
}
