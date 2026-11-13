import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const deps = process.env.WT_DEMO_DEPENDENCIES;
const require = createRequire(path.join(deps ? path.resolve(deps, '..') : root, 'package.json'));
const {build} = require('esbuild');
const out = path.resolve(root, process.env.DEMO_OUTPUT || 'docs');
if (!out.startsWith(root + path.sep) || ['web', 'shared', 'demo', 'scripts', 'public', 'verification'].includes(path.relative(root, out).split(path.sep)[0])) throw Error('Use docs or a separate output directory inside this repository.');
const adapted = [];
const routeAdapter = {name: 'portfolio-routing', setup(build) {
  build.onResolve({filter: /^\.\.\/shared\/workspace-calendar-navigation$/}, args => {
    if (args.importer === path.join(root, 'web/workspace-shell.tsx')) return {path: path.join(root, 'demo/workspace-calendar-navigation.ts')};
  });
  build.onResolve({filter: /^\.\/wbs-excel-import-model$/}, () => ({path: path.join(root, 'demo/wbs-import-stub.ts')}));
  build.onLoad({filter: /\.(?:ts|tsx)$/}, args => {
    if (!args.path.startsWith(path.join(root, 'web') + path.sep)) return;
    let code = fs.readFileSync(args.path, 'utf8');
    const before = code;
    code = code.replace(/\b(?:window\.)?location\.(pathname|search|hash|href|assign|replace)\b/g, '__demoLocation.$1')
      .replace(/\b(?:window\.)?history\.(pushState|replaceState)\b/g, '__demoHistory.$1');
    if (code !== before) {
      adapted.push(path.relative(root, args.path));
      code = `import {demoLocation as __demoLocation,demoHistory as __demoHistory} from ${JSON.stringify(path.join(root, 'demo/route.ts'))};\n` + code;
    }
    return {contents: code, loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts'};
  });
}};
const result = await build({absWorkingDir: root, entryPoints: ['demo/bootstrap.ts'], bundle: true, format: 'esm', splitting: false,
  outfile: path.join(out, 'app.js'), platform: 'browser', target: 'es2022', jsx: 'automatic', minify: true, legalComments: 'eof',
  alias: {'virtual:pwa-register': './demo/pwa-stub.ts'}, define: {'import.meta.env.PROD': 'false', 'process.env.NODE_ENV': '"production"'},
  plugins: [routeAdapter], nodePaths: deps ? [path.resolve(deps)] : [], metafile: true, write: false});
// Replace generated assets only. Repeat builds work in a fresh clone or locally.
fs.mkdirSync(out, {recursive: true});
for (const file of result.outputFiles) fs.writeFileSync(file.path, file.contents);
fs.mkdirSync(path.join(out, 'demo'), {recursive: true});
fs.copyFileSync(path.join(root, 'demo/banner.css'), path.join(out, 'demo/banner.css'));
fs.cpSync(path.join(root, 'public/icons'), path.join(out, 'icons'), {recursive: true});
fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
for (const obsolete of ['_redirects', '404.html']) fs.rmSync(path.join(out, obsolete), {force: true});
const assets = ['.nojekyll', 'index.html', 'app.js', 'app.css', 'demo/banner.css', ...fs.readdirSync(path.join(out, 'icons')).sort().map(p => 'icons/' + p)];
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.mkdirSync(path.join(root, 'verification'), {recursive: true});
fs.writeFileSync(path.join(root, 'verification/build.json'), JSON.stringify({routing: 'hash', basePath: 'document-relative', output: path.relative(root, out),
  sourceTransforms: adapted.sort(), sourceMaps: false, assets: assets.map(file => ({file, sha256: hash(path.join(out, file))}))}, null, 2) + '\n');
console.log(JSON.stringify({output: path.relative(root, out), routing: 'hash', adaptedFiles: adapted.length, bytes: fs.statSync(path.join(out, 'app.js')).size}));
