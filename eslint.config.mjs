import obsidian from 'eslint-plugin-obsidianmd';
export default [
  { ignores: ['main.js', 'node_modules/**', 'release/**', 'test/**', 'scripts/**'] },
  ...obsidian.configs.recommended.map(rule => ({ ...rule, files: rule.files?.includes('package.json') ? ['package.json'] : ['src/**/*.ts'] })),
  { files: ['src/**/*.ts'], rules: { 'obsidianmd/ui/sentence-case': ['warn', { brands: ['Bilibili', 'YouTube', 'Groq', 'OpenAI'], acronyms: ['QR', 'API', 'UID', 'URL'] }] } },
  { files: ['src/**/*.ts'], languageOptions: { parserOptions: { project: './tsconfig.json' } } },
];
