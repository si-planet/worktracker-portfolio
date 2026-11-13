// Portfolio-only hash adapter. Product source bytes remain separately verifiable.
// Relative assets and the document directory support any GitHub Pages repo path.
export const basePath = new URL('.', window.location.href).pathname;
const prefix = basePath === '/' ? '' : basePath.slice(0, -1);
export function logicalPath(path: string = routeURL().pathname) {
  return prefix && path.startsWith(prefix + '/') ? path.slice(prefix.length) : path === prefix ? '/' : path;
}
export function routeURL(value: string | URL = window.location.href) {
  const u = new URL(String(value), window.location.href);
  if (u.origin !== window.location.origin) throw Error('External navigation disabled in demo');
  if (u.hash.startsWith('#/')) {
    const route = new URL(u.hash.slice(1), u.origin);
    if (route.origin !== u.origin) throw Error('External route disabled in demo');
    return route;
  }
  u.pathname = logicalPath(u.pathname);
  if (u.pathname === '/index.html') u.pathname = '/';
  return u;
}
export function allowedDemoPath(path: string) {
  return path === '/' || /^\/c\/019950d3-b800-7000-8000-000000000001\/(month|week|day)$/.test(path);
}
export function demoURL(value: string | URL) {
  const u = routeURL(value);
  if (!allowedDemoPath(u.pathname)) throw Error('Unsupported route in demo');
  if (u.pathname !== '/') {
    if (!u.searchParams.has('year')) u.searchParams.set('year', '2026');
    if (!u.searchParams.has('date')) u.searchParams.set('date', '2026-10-01');
    if (u.pathname.endsWith('/month') && !u.searchParams.has('month')) u.searchParams.set('month', '2026-10');
  }
  const target = new URL(basePath, window.location.origin);
  target.hash = u.pathname + u.search + u.hash;
  return target;
}
const navigate = (value: string | URL, replace = false) => {
  let target: URL;
  try { target = demoURL(value); }
  catch { alert('계정·관리·서버·WBS 가져오기는 이 공개 데모에 연결하지 않았습니다.'); return; }
  // Explicit navigation remounts this document-oriented UI. In-page history
  // replacements preserve React state; back/forward is handled by hashchange.
  window.history[replace ? 'replaceState' : 'pushState'](null, '', target);
  window.location.reload();
};
export const demoLocation = {
  get pathname() { return routeURL().pathname; },
  get search() { return routeURL().search; },
  get hash() { return routeURL().hash; },
  get href() { return routeURL().href; },
  assign: (value: string) => navigate(value),
  replace: (value: string) => navigate(value, true),
};
export const demoHistory = {
  pushState: (data: unknown, unused: string, url?: string | URL | null) => window.history.pushState(data, unused, url == null ? url : demoURL(url)),
  replaceState: (data: unknown, unused: string, url?: string | URL | null) => window.history.replaceState(data, unused, url == null ? url : demoURL(url)),
};
