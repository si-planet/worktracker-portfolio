import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Reuse the build's dependencies, including the optional existing dependency directory.
const root = fileURLToPath(new URL('..', import.meta.url));
const deps = process.env.WT_DEMO_DEPENDENCIES;
const require = createRequire(path.join(deps ? path.resolve(deps, '..') : root, 'package.json'));
const { build } = require('esbuild');
const bundled = await build({
  stdin: { contents: `
    export * from './demo/month-seed';
    export {fixture, task} from './demo/fixture';
    export {zWorkEntryFinal} from './shared/schema/work-entry';
    export {isoWeekForDate, weekCalendar} from './shared/week-calendar';
    export {entryDatesInWeek} from './shared/week-placement';
  `, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24',
  nodePaths: deps ? [path.resolve(deps)] : [],
});
const { createMonthSeed, restoreMonthSeed, MONTH_SEED_VERSION, fixture, task,
  zWorkEntryFinal, isoWeekForDate, weekCalendar, entryDatesInWeek } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
let checks = 0;
const check = async (name, fn) => {
  try { await fn(); checks++; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
};
const seed = createMonthSeed();
await check('24 unique schema-valid fictional records', () => {
  assert.equal(seed.entries.length, 24);
  assert.equal(new Set(seed.entries.map(entry => entry.id)).size, 24);
  for (const entry of seed.entries) {
    zWorkEntryFinal.parse(entry);
    assert.match(entry.content, /가상 업무/);
    assert.match(entry.plannedDate, /^2026-10-/);
    if (entry.endDate) assert.match(entry.endDate, /^2026-10-/);
  }
});
await check('original ten IDs remain stable', () => {
  assert.deepEqual(seed.entries.slice(0, 10).map(entry => entry.id),
    Array.from({ length: 10 }, (_, index) => `019950d3-b800-7000-8000-${String(900 + index).padStart(12, '0')}`));
});
await check('every October calendar week has examples', () => {
  assert.deepEqual([40, 41, 42, 43, 44].map(week => seed.entries.filter(entry =>
    entryDatesInWeek(entry, weekCalendar(2026, week)).length > 0).length), [3, 7, 5, 5, 4]);
  assert.equal(isoWeekForDate(seed.entries.at(-1).plannedDate).isoWeek, 44);
});
await check('multi-day spans and status variants are present', () => {
  assert.equal(seed.entries.filter(entry => entry.endDate > entry.plannedDate).length, 9);
  assert.deepEqual([...new Set(seed.entries.map(entry => entry.status))].sort(), ['doing', 'done', 'planned', 'todo']);
  assert.ok(seed.entries.filter(entry => entry.status === 'planned').every(entry => entry.kind !== 'task'));
});
await check('fresh startup requests immediate version persistence', () => {
  const fresh = restoreMonthSeed(null);
  assert.equal(fresh.shouldPersist, true);
  assert.equal(fresh.seedVersion, MONTH_SEED_VERSION);
  assert.deepEqual(fresh.entries, seed.entries);
});
const originalEdited = { ...seed.entries[1], title: '방문자가 수정한 가상 예시', version: 4 };
const custom = task({ id: '019950d3-b800-7000-8000-000000008888', title: '방문자의 가상 업무' });
const existingNew = { ...seed.entries[10], title: '이미 저장된 가상 업무', version: 2 };
const oldEntries = [originalEdited, ...seed.entries.slice(2, 10), custom, existingNew];
const oldColors = { [originalEdited.id]: { workEntryId: originalEdited.id, color: null, version: 4 } };
const old = { entries: oldEntries, colors: oldColors };
const migrated = restoreMonthSeed(old);
await check('migration preserves edits, deletions, custom entries and colors', () => {
  assert.deepEqual(migrated.entries.slice(0, oldEntries.length), oldEntries);
  assert.equal(migrated.entries.some(entry => entry.id === seed.entries[0].id), false);
  assert.deepEqual(migrated.colors[originalEdited.id], oldColors[originalEdited.id]);
  assert.equal(migrated.entries.length, 24);
  assert.equal(migrated.shouldPersist, true);
  assert.equal(migrated.seedVersion, MONTH_SEED_VERSION);
});
await check('migration only colors newly added entries', () => {
  assert.equal(migrated.colors[existingNew.id], undefined);
  assert.deepEqual(migrated.colors[seed.entries[11].id], seed.colors[seed.entries[11].id]);
  assert.deepEqual(old, { entries: oldEntries, colors: oldColors });
});
await check('reload after migration never restores a deleted new example', () => {
  const afterDelete = { ...migrated, entries: migrated.entries.filter(entry => entry.id !== seed.entries[11].id) };
  const reloaded = restoreMonthSeed(JSON.parse(JSON.stringify(afterDelete)));
  assert.equal(reloaded.shouldPersist, false);
  assert.deepEqual(reloaded.entries, afterDelete.entries);
});
await check('valid large visitor collections are preserved', () => {
  const entries = Array.from({ length: 1000 }, (_, index) => task({
    id: `019950d3-b800-7000-8000-${String(10000 + index).padStart(12, '0')}`,
  }));
  const restored = restoreMonthSeed({ entries });
  assert.equal(restored.entries.length, 1014);
  assert.deepEqual(restored.entries.slice(0, 1000), entries);
});
await check('future markers and unreadable saved payloads are not overwritten on load', () => {
  const future = restoreMonthSeed({ entries: [custom], seedVersion: MONTH_SEED_VERSION + 1 });
  assert.deepEqual(future.entries, [custom]);
  assert.equal(future.seedVersion, MONTH_SEED_VERSION + 1);
  assert.equal(future.shouldPersist, false);
  assert.equal(restoreMonthSeed({ entries: [{ title: 'invalid' }] }).shouldPersist, false);
  assert.equal(restoreMonthSeed(undefined).shouldPersist, false);
});
await check('reset creates a fresh complete month without shared mutation', () => {
  const changed = createMonthSeed();
  changed.entries.pop();
  changed.entries[0].title = 'changed';
  const reset = restoreMonthSeed(null);
  assert.deepEqual(reset.entries, seed.entries);
});
let handler;
const { state } = await fixture({ route: async (_pattern, fn) => { handler = fn; } });
state.entries = seed.entries;
const get = async url => {
  let response;
  await handler({ request: () => ({ url: () => url, method: () => 'GET' }),
    fulfill: async value => { response = value; } });
  return response;
};
await check('fixture list includes a multi-day entry on its middle and final days', async () => {
  const base = `https://demo.invalid/api/companies/${seed.entries[0].companyId}/work-entries`;
  for (const day of ['13', '14']) {
    const response = await get(`${base}?from=2026-10-${day}&to=2026-10-${day}`);
    assert.ok(response.json.items.some(entry => entry.id === seed.entries[10].id));
  }
  const response = await get(`${base}?from=2026-10-15&to=2026-10-15`);
  assert.equal(response.json.items.some(entry => entry.id === seed.entries[10].id), false);
});
await check('fixture weekly response exposes every spanned day', async () => {
  const response = await get(`https://demo.invalid/api/companies/${seed.entries[0].companyId}/weeks/2026/44`);
  assert.deepEqual(response.json.days.filter(day => day.entries.some(entry => entry.id === seed.entries[20].id))
    .map(day => day.date), ['2026-10-26', '2026-10-27', '2026-10-28']);
});
console.log(JSON.stringify({ status: 'passed', checks, entries: seed.entries.length, calendarWeeks: 5,
  multiDayEntries: 9, scope: 'schema, calendar placement, fixture API, saved-data migration and reset seed' }));
