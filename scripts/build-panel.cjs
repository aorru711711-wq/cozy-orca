/* Inlines the scene scripts into panel/index.html. Orca panels run under a strict CSP,
   so everything must live in one file. Run after editing src/scene.js or src/life/*. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/<\/script/gi, '<\/script');
const life = ['birds', 'sparkles', 'night'].map(name => read(`src/life/${name}.js`)).join('\n');
const html = read('panel/template.html')
  .replace('/*__LIFE__*/', () => life)
  .replace('/*__SCENE__*/', () => read('src/scene.js'));
fs.writeFileSync(path.join(root, 'panel/index.html'), html);
console.log(`panel/index.html ${html.length} bytes`);
