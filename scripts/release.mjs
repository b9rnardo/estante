// Builds every platform from one version (npm run release -- <version> [--notes notes.md] [--publish]):
// the .ipa and the AltStore/SideStore source for b9rnardo/estante-ios, and the Mac and Windows
// installers for b9rnardo/estante. It prints the gh release create command for each repo, and
// runs them only with --publish. The newest estante-ios release is the update AltStore shows.
import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(import.meta.dirname, '..');
const IOS_REPO = 'b9rnardo/estante-ios';
const DESKTOP_REPO = 'b9rnardo/estante';

const { positionals: [arg], values } = parseArgs({
  allowPositionals: true,
  options: { notes: { type: 'string' }, publish: { type: 'boolean' } },
});
const version = arg?.replace(/^v/, '');
// iOS takes up to three numbers as the app version, and nothing else.
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Uso: npm run release -- <versão> [--notes arquivo.md] [--publish]');
  process.exit(1);
}
// npm runs scripts from the project folder; the notes path is relative to where it was typed.
const notes = values.notes && path.resolve(process.env.INIT_CWD ?? '.', values.notes);
if (notes) await readFile(notes);

// The builds must match a commit. The notes file may sit uncommitted in the project.
const notesEntry = notes && path.relative(ROOT, notes);
const changes = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter((entry) => entry && entry.slice(3) !== notesEntry);
if (changes.length) {
  console.error(`Há mudanças sem commit; faça commit antes de lançar:\n${changes.join('\n')}`);
  process.exit(1);
}

const pkg = path.join(ROOT, 'package.json');
const { version: previous, productName } = JSON.parse(await readFile(pkg, 'utf8'));
const setVersion = (v) => execFileSync('npm', ['version', v, '--no-git-tag-version', '--allow-same-version'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
const run = (...args) => execFileSync('npm', ['run', ...args], { cwd: ROOT, stdio: 'inherit' });

setVersion(version); // package.json and package-lock.json
try {
  run('ipa');
  run('source', '--', IOS_REPO, ...(notes ? ['--notes', notes] : []));
  // electron-builder publishes on its own when the npm script is named "release".
  run('dist', '--', '--publish', 'never');
  run('dist:win');
} catch {
  setVersion(previous); // back to a clean tree, so the release can run again
  console.error(`\nO build falhou; a versão voltou para ${previous}.`);
  process.exit(1);
}

const dist = path.join(ROOT, 'dist');
const altstore = (await readdir(path.join(dist, 'altstore'))).filter((f) => !f.startsWith('.')).map((f) => `dist/altstore/${f}`);
// electron-builder adds the architecture to the name: Estante-<version>-arm64.dmg.
const dmgs = (await readdir(dist)).filter((f) => f.replace(/-(arm64|x64|universal)\.dmg$/, '.dmg') === `${productName}-${version}.dmg`).map((f) => `dist/${f}`);
const exe = `dist/${productName} Setup ${version}.exe`;
await stat(path.join(ROOT, exe));
if (!dmgs.length) throw new Error(`Nenhum .dmg da versão ${version} em dist/`);

const shown = (file) => (path.relative(ROOT, file).startsWith('..') ? file : path.relative(ROOT, file));
const releaseNotes = notes ? ['--notes-file', shown(notes)] : ['--notes', ''];
const releases = [[IOS_REPO, altstore], [DESKTOP_REPO, [...dmgs, exe]]].map(([repo, files]) => [
  'release', 'create', `v${version}`, '--repo', repo, '--title', `${productName} ${version}`, ...releaseNotes, ...files,
]);
const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`);

console.log(`\nPronto: versão ${version} em dist/. Faça commit de package.json e package-lock.json.`);
console.log(values.publish ? '\nPublicando:' : '\nPara publicar, na pasta do projeto:');
for (const args of releases) console.log(`  gh ${args.map(quote).join(' ')}`);
if (values.publish) for (const args of releases) execFileSync('gh', args, { cwd: ROOT, stdio: 'inherit' });
