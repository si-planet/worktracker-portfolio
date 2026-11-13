import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
const deps = process.env.WT_DEMO_DEPENDENCIES;
const require = createRequire(path.join(deps ? path.resolve(deps, '..') : root, 'package.json'));
const { build } = require('esbuild');
const bundled = await build({
  stdin: { contents: `
    export {workspaceCalendarHref as productHref} from './shared/workspace-calendar-navigation';
    export {workspaceCalendarHref as demoHref} from './demo/workspace-calendar-navigation';
    export {demoURL,routeURL,demoLocation} from './demo/route';
  `, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24',
  nodePaths: deps ? [path.resolve(deps)] : [],
});
const company = '019950d3-b800-7000-8000-000000000001';
const project = '019950d3-b800-7000-8000-000000000010';
let checks = 0;
const check = (name, fn) => {
  try { fn(); checks++; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
};
for (const documentPath of ['/', '/portfolio/', '/repo.with-dots/', '/nested/repository/', '/portfolio/index.html']) {
  let current = new URL('https://demo.invalid' + documentPath);
  globalThis.window = { location: {
    get href() { return current.href; }, get pathname() { return current.pathname; },
    get origin() { return current.origin; },
  } };
  // A separate module instance captures each supported document base path.
  const source = bundled.outputFiles[0].text + '\n// ' + documentPath;
  const { productHref, demoHref, demoURL, routeURL, demoLocation } =
    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const base = new URL('.', current).pathname;
  for (const view of ['week', 'month']) {
    current = demoURL(`/c/${company}/day?date=2027-01-01&year=2026&projectId=${project}&status=canceled`);
    check(`${documentPath} ${view}: physical hash URL preserves selected period and project`, () => {
      const target = new URL(demoHref(company, view, current.href));
      assert.equal(target.pathname, base);
      assert.equal(target.search, '');
      assert.deepEqual(Object.fromEntries(routeURL(target).searchParams), {
        year: '2027', date: '2027-01-01', ...(view === 'month' ? { month: '2027-01' } : {}), projectId: project,
      });
    });
    check(`${documentPath} ${view}: capture then React click keeps Pages document path`, () => {
      let href = demoHref(company, view, demoLocation.href);
      href = demoURL(href).href; // Existing document capture handler.
      href = demoHref(company, view, demoLocation.href); // Product React bubble handler.
      assert.equal(new URL(href).pathname, base);
      assert.equal(routeURL(href).pathname, `/c/${company}/${view}`);
      assert.equal(routeURL(href).searchParams.get('date'), '2027-01-01');
      assert.equal(routeURL(href).searchParams.get('projectId'), project);
    });
  }
  check(`${documentPath}: changed date is read again at activation`, () => {
    current = demoURL(`/c/${company}/month?month=2026-11&date=2026-11-18&projectId=${project}`);
    const href = demoHref(company, 'week', demoLocation.href);
    assert.equal(routeURL(href).searchParams.get('date'), '2026-11-18');
  });
  const logical = query => `https://demo.invalid/c/${company}/day?${query}`;
  check(`${documentPath}: leap month fallback uses first day`, () => {
    assert.equal(productHref(company, 'week', logical('month=2024-02')), `/c/${company}/week?year=2024&date=2024-02-01`);
  });
  check(`${documentPath}: company and non-calendar links do not inherit filters`, () => {
    assert.equal(demoHref('other-company', 'month', current.href), '/c/other-company/month');
    assert.equal(demoHref(company, 'settings/projects', current.href), `/c/${company}/settings/projects`);
  });
  for (const query of ['date=2026-02-30', 'month=2026-13', '']) {
    check(`${documentPath}: invalid period is not propagated (${query})`, () => {
      assert.equal(productHref(company, 'month', logical(query)), `/c/${company}/month`);
    });
  }
  check(`${documentPath}: invalid project and unrelated filter are omitted`, () => {
    assert.equal(productHref(company, 'month', logical('date=2026-10-01&projectId=invalid&status=canceled')),
      `/c/${company}/month?year=2026&date=2026-10-01&month=2026-10`);
  });
  check(`${documentPath}: external current URL is rejected by demo boundary`, () => {
    assert.throws(() => demoHref(company, 'week', `https://external.invalid/c/${company}/day?date=2026-10-01`));
  });
}
console.log(JSON.stringify({ status: 'passed', checks, documentPaths: 5,
  scope: 'calendar context and static-host navigation event ordering; no browser or production API' }));
