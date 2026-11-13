import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
const deps = process.env.WT_DEMO_DEPENDENCIES;
const require = createRequire(path.join(deps ? path.resolve(deps, '..') : root, 'package.json'));
const { build } = require('esbuild');
const result = await build({
  stdin: { contents: `
    export * from './demo/fixture';
    export {createMonthSeed,restoreMonthSeed} from './demo/month-seed';
    export {restoreImportance} from './demo/importance-state';
  `, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24',
  nodePaths: deps ? [path.resolve(deps)] : [],
});
const { fixture, createMonthSeed, restoreMonthSeed, restoreImportance, at, companyId, projectId } =
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
let checks = 0;
const check = async (name, fn) => {
  try { await fn(); checks++; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
};
const seed = createMonthSeed();
const defaults = restoreImportance(seed.entries, null);
await check('default importance is attached to the two original identities', () => {
  assert.deepEqual(Object.keys(defaults), [seed.entries[0].id, seed.entries[5].id]);
});
await check('deleting first important example does not mark another record', () => {
  assert.deepEqual(Object.keys(restoreImportance(seed.entries.slice(1), null)), [seed.entries[5].id]);
});
await check('reordering records cannot move default importance', () => {
  assert.deepEqual(restoreImportance([...seed.entries].reverse(), null), defaults);
});
await check('deleting both defaults leaves every other record unmarked', () => {
  assert.deepEqual(restoreImportance(seed.entries.filter(e => !defaults[e.id]), null), {});
});
const saved = {
  [seed.entries[0].id]: { workEntryId: seed.entries[0].id, importance: false, version: 2 },
  [seed.entries[5].id]: { workEntryId: seed.entries[5].id, importance: null, version: 3 },
  [seed.entries[6].id]: { workEntryId: seed.entries[6].id, importance: true, version: 4 },
};
await check('saved true, false and cleared choices survive reload', () => {
  assert.deepEqual(restoreImportance(seed.entries, JSON.parse(JSON.stringify(saved))), saved);
});
await check('deleted saved ID is omitted without changing surviving choices', () => {
  const remaining = seed.entries.filter(e => e.id !== seed.entries[0].id);
  const { [seed.entries[0].id]: removed, ...expected } = saved;
  assert.deepEqual(restoreImportance(remaining, saved), expected);
  assert.equal(removed.importance, false);
});
await check('saved empty preferences stay empty', () => {
  assert.deepEqual(restoreImportance(seed.entries, {}), {});
});
await check('invalid or mismatched saved items never affect another ID', () => {
  const invalid = { ...saved,
    [seed.entries[7].id]: { workEntryId: seed.entries[6].id, importance: true, version: 1 },
    [seed.entries[8].id]: { workEntryId: seed.entries[8].id, importance: 'yes', version: 1 },
  };
  assert.deepEqual(restoreImportance(seed.entries, invalid), saved);
});
await check('reset with no saved state restores the original identities', () => {
  assert.deepEqual(restoreImportance(restoreMonthSeed(null).entries, null), defaults);
});

async function createRuntime(options) {
  let handler;
  const api = await fixture({ route: async (_, fn) => { handler = fn; } }, options);
  const request = async (method, suffix, body) => {
    let response;
    await handler({ request: () => ({ url: () => `https://demo.invalid/api/${suffix}`,
      method: () => method, postDataJSON: () => body }),
    fulfill: async value => { response = structuredClone(value); } });
    return response;
  };
  return { ...api, request };
}
let now = Date.parse('2026-11-13T12:00:00Z');
const runtime = await createRuntime({ now: () => now });
const id = '019950d3-b800-7000-8000-000000008888';
const body = { id, projectId, kind: 'task', title: '가상 시계 검수',
  plannedDate: '2026-10-07', dueDate: '2026-10-06', tagIds: [] };
let row = (await runtime.request('POST', `companies/${companyId}/work-entries`, body)).json;
await check('runtime creation uses injected time without changing chosen dates', () => {
  assert.equal(row.createdAt, now); assert.equal(row.updatedAt, now);
  assert.equal(row.plannedDate, body.plannedDate); assert.equal(row.dueDate, body.dueDate);
  assert.equal(row.completedAt, null);
});
const createdAt = now;
now += 60_000;
row = (await runtime.request('PATCH', `work-entries/${id}`, { version: row.version, title: '가상 시계 수정' })).json;
await check('runtime edit updates time but preserves creation time', () => {
  assert.equal(row.createdAt, createdAt); assert.equal(row.updatedAt, now);
});
now += 60_000;
row = (await runtime.request('PATCH', `work-entries/${id}/status`, { version: row.version, status: 'done' })).json;
const firstCompletion = now;
await check('completion time is the current injected time', () => {
  assert.equal(row.completedAt, now); assert.equal(row.updatedAt, now);
});
now += 60_000;
row = (await runtime.request('PATCH', `work-entries/${id}`, { version: row.version, content: '가상 내용' })).json;
await check('editing a completed record preserves its completion timestamp', () => {
  assert.equal(row.completedAt, firstCompletion); assert.equal(row.updatedAt, now);
});
now += 60_000;
row = (await runtime.request('PATCH', `work-entries/${id}/status`, { version: row.version, status: 'todo' })).json;
await check('reopening clears completion while preserving creation', () => {
  assert.equal(row.completedAt, null); assert.equal(row.createdAt, createdAt);
});
now += 60_000;
row = (await runtime.request('PATCH', `work-entries/${id}/status`, { version: row.version, status: 'done' })).json;
await check('later completion records the later time', () => {
  assert.equal(row.completedAt, now); assert.notEqual(row.completedAt, firstCompletion);
});
await check('history timestamps follow individual mutations', async () => {
  const history = (await runtime.request('GET', `work-entries/${id}/changes`)).json.items;
  assert.deepEqual(history.map(item => item.changedAt), Array.from({ length: 6 }, (_, i) => createdAt + i * 60_000));
});
await check('reloading saved records does not rewrite existing times', async () => {
  const reloaded = await createRuntime({ now: () => now + 60_000 });
  reloaded.state.entries = [structuredClone(row)];
  assert.deepEqual((await reloaded.request('GET', `work-entries/${id}`)).json, row);
});
await check('fixture without runtime clock retains historical default behavior', async () => {
  const legacy = await createRuntime();
  let entry = (await legacy.request('POST', `companies/${companyId}/work-entries`, body)).json;
  assert.equal(entry.createdAt, at); assert.equal(entry.updatedAt, at);
  legacy.state.now = at + 5000;
  entry = (await legacy.request('PATCH', `work-entries/${id}/status`, { version: entry.version, status: 'done' })).json;
  assert.equal(entry.completedAt, at + 5000); assert.equal(entry.updatedAt, at + 1);
});
await check('initial 24 examples retain their original timestamps', () => {
  assert.deepEqual(createMonthSeed(), seed);
});
console.log(JSON.stringify({ status: 'passed', checks,
  scope: 'importance identity, stored preferences, opt-in mutation clock and preserved fixed seed; no browser or production API' }));
