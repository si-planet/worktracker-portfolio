import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
const deps = process.env.WT_DEMO_DEPENDENCIES;
const require = createRequire(path.join(deps ? path.resolve(deps, '..') : root, 'package.json'));
const { build } = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const result = await build({
  absWorkingDir: root, entryPoints: ['demo/month-schedule-create.tsx'],
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node24', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' },
  nodePaths: deps ? [path.resolve(deps)] : [],
  plugins: [{ name: 'isolate-dialog-capabilities', setup(builder) {
    builder.onResolve({ filter: /^\.\.\/web\/work-entries$/ }, () => ({ path: 'work-form', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'tsx', contents: `
      export function WorkEntriesPanel(props) {
        return <form aria-label="one-time-fixture" data-date={props.creationContext.date}
          data-year={props.year} data-project={props.selectedProjectId} data-day={props.dayView} />;
      }
    ` }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
const { MonthScheduleCreate } = module.exports;
let checks = 0;
const check = (name, fn) => {
  try { fn(); checks++; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
};
const base = {
  companyId: 'synthetic-company', userId: 'synthetic-user',
  projects: [{ id: 'synthetic-project', code: 'WEB-01' }], tags: [],
  onClose() {}, onChanged() {}, onDateChange() {},
};
for (const [date, projectId] of [['2026-10-07', 'synthetic-project'], ['2027-01-01', '']]) {
  const html = renderToStaticMarkup(React.createElement(MonthScheduleCreate, { ...base, date, projectId }));
  check(`${date}: single supported creation form`, () => {
    assert.equal((html.match(/<form /g) || []).length, 1);
    assert.match(html, /aria-label="one-time-fixture"/);
  });
  check(`${date}: unsupported recurrence is explained without a mode button`, () => {
    assert.match(html, /반복 일정은 공개 데모에 포함되지 않습니다/);
    assert.equal((html.match(/<button /g) || []).length, 1);
    assert.doesNotMatch(html, /aria-pressed|month-schedule-modes|반복 규칙/);
  });
  check(`${date}: selected context reaches one-time editor`, () => {
    assert.ok(html.includes(`data-date="${date}"`));
    assert.ok(html.includes(`data-year="${date.slice(0, 4)}"`));
    assert.ok(html.includes(`data-project="${projectId}"`));
    assert.match(html, /data-day="true"/);
  });
  check(`${date}: accessible dialog and close action remain`, () => {
    assert.match(html, /aria-labelledby="month-schedule-title"/);
    assert.match(html, /닫기 · 초안 보관/);
    assert.ok(html.includes(projectId ? 'WEB-01' : '프로젝트 선택 없음'));
  });
}
console.log(JSON.stringify({ status: 'passed', checks,
  scope: 'public dialog rendering and one-time editor context; child form isolated, browser behavior checked separately' }));
