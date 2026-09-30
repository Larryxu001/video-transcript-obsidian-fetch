import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const notice = await readFile('THIRD-PARTY-NOTICES.md', 'utf8');
await build({ entryPoints: ['src/main.ts'], outfile: 'main.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'es2022',
  external: ['obsidian', 'node:https', 'node:crypto'], sourcemap: false, minify: false,
  banner: { js: `/*!\n${notice}\n*/` } });
