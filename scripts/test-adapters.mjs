import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createCategoryApi} from '../demo/category-api.mjs';
let count = 0;
const check = (name, fn) => { try { fn(); count++; } catch (error) { error.message = name + ': ' + error.message; throw error; } };
const company = '019950d3-b800-7000-8000-000000000001';
const route = `/c/${company}`;
for (const documentPath of ['/', '/portfolio/', '/repo.with-dots/', '/nested/repository/', '/portfolio/index.html']) {
  const calls = [], alerts = [];
  let current = new URL('https://demo.invalid' + documentPath);
  const record = (method, data, title, url) => { calls.push({method, data, url}); if (url != null) current = new URL(String(url), current); };
  globalThis.window = {
    location: {get href() {return current.href;}, get pathname() {return current.pathname;}, get search() {return current.search;},
      get hash() {return current.hash;}, get origin() {return current.origin;}, reload: () => calls.push({method: 'reload'})},
    history: {pushState: (...args) => record('push', ...args), replaceState: (...args) => record('replace', ...args)},
  };
  globalThis.alert = value => alerts.push(value);
  const r = await import(`../demo/route.ts?document=${encodeURIComponent(documentPath)}`);
  const base = new URL('.', current).pathname;
  check('base follows document directory', () => assert.equal(r.basePath, base));
  check('new page starts at logical root', () => assert.equal(r.logicalPath(), '/'));
  check('prefix is stripped once', () => assert.equal(r.logicalPath(base + route.slice(1) + '/day'), route + '/day'));
  check('unrelated prefix remains', () => assert.equal(r.logicalPath('/unrelated/day'), '/unrelated/day'));
  const day = r.demoURL(route + '/day?date=2026-10-08&entryId=example');
  check('server path stays at index directory', () => assert.equal(day.pathname, base));
  check('query belongs to hash route', () => {assert.equal(day.search, ''); assert.equal(r.routeURL(day).searchParams.get('date'), '2026-10-08');});
  check('additional query is preserved', () => assert.equal(r.routeURL(day).searchParams.get('entryId'), 'example'));
  check('adapting a link is idempotent', () => assert.equal(r.demoURL(day).href, day.href));
  check('month defaults to synthetic period', () => assert.equal(r.routeURL(r.demoURL(route + '/month')).searchParams.get('month'), '2026-10'));
  check('foreign origin is refused', () => assert.throws(() => r.demoURL('https://external.invalid/')));
  check('encoded external hash is refused', () => assert.throws(() => r.demoURL(base + '#//external.invalid/path')));
  check('unsupported account route is refused', () => assert.throws(() => r.demoURL('/login')));
  check('other company is refused', () => assert.equal(r.allowedDemoPath('/c/other/day'), false));
  check('navigation refuses unsupported route', () => {r.demoLocation.assign('/login'); assert.equal(calls.length, 0); assert.equal(alerts.length, 1);});
  check('history replacement keeps document path', () => {r.demoHistory.replaceState({selected: true}, '', day); assert.equal(current.pathname, base); assert.equal(current.hash, day.hash);});
  check('virtual location reads hash pathname', () => assert.equal(r.demoLocation.pathname, route + '/day'));
  check('virtual location reads hash query', () => assert.equal(new URLSearchParams(r.demoLocation.search).get('date'), '2026-10-08'));
  check('virtual href serves product URL parsing', () => assert.equal(new URL(r.demoLocation.href).pathname, route + '/day'));
  check('route fragment does not leak as product hash', () => assert.equal(r.demoLocation.hash, ''));
  check('history without URL preserves route', () => {const before = current.href; r.demoHistory.replaceState(null, ''); assert.equal(current.href, before);});
  check('explicit navigation remounts UI', () => {r.demoLocation.assign(route + '/week'); assert.equal(r.demoLocation.pathname, route + '/week'); assert.equal(calls.at(-1).method, 'reload');});
  check('replace navigation replaces history', () => {r.demoLocation.replace(route + '/month'); assert.equal(calls.at(-2).method, 'replace');});
}
const cat = createCategoryApi({companyId: 'synthetic', projects: [{id: 'p'}], tags: [{id: 't'}]});
check('category scope enforced', () => assert.equal(cat.handle('/api/companies/other/category-colors', 'GET'), null));
check('category write valid', () => assert.equal(cat.handle('/api/companies/synthetic/category-colors/project/p', 'PUT', {color: '#123456', version: null}).status, 200));
check('category version enforced', () => assert.equal(cat.handle('/api/companies/synthetic/category-colors/project/p', 'PUT', {color: '#123456', version: null}).status, 409));
check('category unknown refused', () => assert.equal(cat.handle('/api/companies/synthetic/category-colors/project/unknown', 'PUT', {color: null, version: null}).status, 404));
check('category invalid color refused', () => assert.equal(cat.handle('/api/companies/synthetic/category-colors/tag/t', 'PUT', {color: 'url(https://external.invalid)', version: null}).status, 400));
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url));
const html = String(read('docs/index.html')), boot = String(read('demo/bootstrap.ts'));
check('network and worker capabilities are blocked', () => assert.ok(html.includes("connect-src 'none'") && html.includes("worker-src 'none'")));
check('assets remain relative', () => {assert.ok(html.includes('src="./app.js"') && html.includes('href="./app.css"')); assert.ok(!html.includes('{{BASE}}'));});
check('deployment does not depend on fallback', () => assert.ok(!fs.existsSync(new URL('../docs/404.html', import.meta.url)) && !fs.existsSync(new URL('../docs/_redirects', import.meta.url))));
check('no original network fallback', () => assert.equal(boot.includes('originalFetch'), false));
check('importance excluded from demo export', () => assert.ok(boot.includes('entries:state.entries,colors},null,2)')));
check('source hashes match the reviewed snapshot and explicit adaptations', () => {
  const manifest = JSON.parse(read('verification/source-manifest.json'));
  assert.equal(manifest.files.length, 208);
  const adapted = new Map(manifest.adaptedFiles.map(item => [item.file, item.sha256]));
  for (const item of manifest.files) assert.equal(createHash('sha256').update(read(item.file)).digest('hex'), adapted.get(item.file) || item.sha256, item.file);
});
check('deployed asset hashes match the build record', () => {
  const build = JSON.parse(read('verification/build.json'));
  assert.equal(build.routing, 'hash'); assert.equal(build.output, 'docs');
  for (const item of build.assets) assert.equal(createHash('sha256').update(read('docs/' + item.file)).digest('hex'), item.sha256, item.file);
});
console.log(JSON.stringify({status: 'passed', checks: count, documentPaths: 5, scope: 'routing, adapters, source and deployed assets; no browser or production API'}));
