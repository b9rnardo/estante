// Builds dist/altstore/ (npm run source -- <owner/repo>, after npm run ipa): an AltStore/SideStore
// source with the .ipa and its icon, all to be attached to the release v<version> of a public
// GitHub repo. AltStore then reads the source at
// https://github.com/<owner/repo>/releases/latest/download/source.json.
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const repo = process.argv[2];
if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) {
  console.error('Uso: npm run source -- <dono/repositório>');
  process.exit(1);
}
const { version, productName, description } = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const ipa = path.join(ROOT, 'dist', `${productName}-${version}.ipa`);
const app = path.join(ROOT, 'dist/ios-build/Build/Products/Release-iphoneos/App.app');
const out = path.join(ROOT, 'dist', 'altstore');
const releases = `https://github.com/${repo}/releases`;

const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Info.plist')], { encoding: 'utf8' }));
if (info.CFBundleShortVersionString !== version) throw new Error(`O .ipa é da versão ${info.CFBundleShortVersionString}, não ${version}: rode npm run ipa`);
// AltStore refuses an app whose permissions differ from the ones listed here. The .ipa goes out
// unsigned, so it has no entitlements; the privacy ones are its Info.plist usage descriptions.
const privacy = Object.fromEntries(Object.entries(info).filter(([k]) => /^NS\w+UsageDescription$/.test(k)));

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await copyFile(ipa, path.join(out, path.basename(ipa)));
await copyFile(path.join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'), path.join(out, 'icon.png'));

const source = {
  name: productName,
  // AltStore 2 knows a source by its URL; older AltStore and SideStore versions still ask for this.
  identifier: `io.github.${repo.split('/')[0].toLowerCase()}.estante`,
  subtitle: description,
  iconURL: `${releases}/latest/download/icon.png`,
  website: `https://github.com/${repo}`,
  tintColor: '#b0532c',
  nsfw: false,
  apps: [{
    name: productName,
    bundleIdentifier: info.CFBundleIdentifier,
    developerName: repo.split('/')[0],
    subtitle: description,
    localizedDescription: 'Leitor de EPUB e PDF que busca livros em acervos abertos (Project Gutenberg, Internet Archive, catálogos OPDS), com destaques, notas e dicionário. Fontes externas podem ser adicionadas por link ou arquivo.',
    iconURL: `${releases}/download/v${version}/icon.png`,
    tintColor: '#b0532c',
    category: 'entertainment',
    versions: [{
      version,
      buildVersion: info.CFBundleVersion,
      date: new Date().toISOString(),
      downloadURL: `${releases}/download/v${version}/${path.basename(ipa)}`,
      size: (await stat(ipa)).size,
      minOSVersion: info.MinimumOSVersion,
    }],
    appPermissions: { entitlements: [], privacy },
  }],
  news: [],
};
await writeFile(path.join(out, 'source.json'), `${JSON.stringify(source, null, 2)}\n`);
console.log(`Pronto: ${path.relative(ROOT, out)}/ (anexe tudo à release v${version} de ${repo})`);
console.log(`Source: ${releases}/latest/download/source.json`);
