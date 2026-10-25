// Builds dist/Estante-<version>.ipa for sideloading (npm run ipa, after npm run ios). It goes out
// unsigned: AltStore and SideStore sign it with the user's own Apple ID when they install it.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const work = path.join(ROOT, 'dist', 'ios-build');
const out = path.join(ROOT, 'dist', `Estante-${version}.ipa`);

execFileSync('xcodebuild', [
  '-project', path.join(ROOT, 'ios/App/App.xcodeproj'),
  '-scheme', 'App',
  '-configuration', 'Release',
  '-destination', 'generic/platform=iOS',
  '-derivedDataPath', work,
  'CODE_SIGNING_ALLOWED=NO',
  'CODE_SIGNING_REQUIRED=NO',
  'CODE_SIGN_IDENTITY=',
  `MARKETING_VERSION=${version}`, // the version AltStore and Settings show
  'build',
], { stdio: ['ignore', 'ignore', 'inherit'] });

// An .ipa is a zip with the app in Payload/.
const payload = path.join(work, 'ipa');
await rm(payload, { recursive: true, force: true });
await mkdir(path.join(payload, 'Payload'), { recursive: true });
await cp(path.join(work, 'Build/Products/Release-iphoneos/App.app'), path.join(payload, 'Payload/App.app'), { recursive: true, verbatimSymlinks: true });
await rm(out, { force: true });
execFileSync('zip', ['-qry', out, 'Payload'], { cwd: payload });
console.log(`Pronto: ${path.relative(ROOT, out)}`);
