/** Builds grid-shift.html: one offline file with every module, style and icon inlined.
 * Each module is wrapped in its own function scope (in dependency order), so modules may reuse names. */
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, 'dist', name), 'utf8');
const IMPORT = /import\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+\.mjs)';?\n?/g;
const ident = file => `__${file.replace(/\W/g, '_')}`;

const order = [], seen = new Set();
function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  for (const [, , dep] of read(file).matchAll(IMPORT)) visit(dep);
  order.push(file);
}
visit('app.mjs');

const modules = order.map(file => {
  let code = read(file);
  const imports = [...code.matchAll(IMPORT)].map(([, names, dep]) =>
    `const {${names.split(',').map(n => n.trim()).filter(Boolean).map(n => n.replace(/\s+as\s+/, ': ')).join(', ')}} = ${ident(dep)};`);
  code = code.replace(IMPORT, '');
  const exported = [];
  code = code.replace(/^export\s+(async\s+function|function|const|let|class)\s+([\w$]+)/gm, (_, kind, name) => { exported.push(name); return `${kind} ${name}`; });
  if (/^\s*(import|export)\b/m.test(code)) throw Error(`${file}: unsupported import/export form`);
  return `const ${ident(file)} = (() => {\n${imports.join('\n')}\n${code}\nreturn {${exported.join(', ')}};\n})();`;
});
const bundle = modules.join('\n\n');
if (/<\/script/i.test(bundle)) throw Error('Unsafe embedded script closing tag');

const icon = 'data:image/svg+xml,' + encodeURIComponent(read('favicon.svg'));
const html = read('index.html')
  .replace('href="favicon.svg"', `href="${icon}"`)
  .replace('<link rel="stylesheet" href="styles.css">', `<style>\n${read('styles.css')}\n</style>`)
  .replace('<script type="module" src="app.mjs"></script>', `<script type="module">\n${bundle}\n</script>`);
if (/(?:src|href)="[\w-]+\.(?:mjs|css|svg)"/.test(html)) throw Error('A required asset was not inlined');
writeFileSync(resolve(root, 'grid-shift.html'), html);
console.log(JSON.stringify({output: resolve(root, 'grid-shift.html'), modules: order, bytes: Buffer.byteLength(html), externalAssets: 0}));
