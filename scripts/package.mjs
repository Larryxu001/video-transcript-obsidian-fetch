import { readFile, mkdir, copyFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.version !== pkg.version || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Package and manifest versions must agree.');
const destination = `release/${manifest.version}`;
await mkdir(destination, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) await copyFile(name, `${destination}/${name}`);
console.log(`Development candidate prepared in ${destination}. See ACCEPTANCE.md before installation or publication.`);
