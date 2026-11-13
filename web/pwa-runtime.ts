import { registerSW } from 'virtual:pwa-register';

type PwaState = {
  online: boolean;
  startupOffline: boolean;
  reconnected: boolean;
  updateAvailable: boolean;
  reloadRequired: boolean;
  registrationFailed: boolean;
};
// Memory only: auth URL fragments must never enter app storage or service-worker caches.
const startupLocation = window.location.pathname + window.location.search + window.location.hash;
let state: PwaState = {
  online: navigator.onLine,
  startupOffline: !navigator.onLine || window.location.pathname === '/offline',
  reconnected: false,
  updateAvailable: false,
  reloadRequired: false,
  registrationFailed: false,
};
const listeners = new Set<() => void>();
let started = false;
let restartAuthorized = false;
let reloading = false;
let updateWorker: (() => Promise<void>) | undefined;
let registration: ServiceWorkerRegistration | undefined;
const startupReloadKey = 'wt:pwa-startup-reload-until';
const startupTimeoutMs = 2500;
let startupDeadline = 0;
let startupReady: Promise<void> | undefined;
let finishStartup = () => {};
const startupCleanups = new Set<() => void>();

function canRestartAtStartup() {
  return startupDeadline > Date.now() && navigator.onLine && document.visibilityState === 'visible';
}
function prepareStartup() {
  // Only a phone-sized installed app opts into this mobile startup improvement.
  // iOS standalone is separate from the display-mode media query on older Safari versions.
  const installed =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!installed || !window.matchMedia('(max-width: 600px)').matches) return;
  // A first visit has no stale controller. Background resumes keep their current page.
  if (
    !navigator.serviceWorker?.controller ||
    !navigator.onLine ||
    document.visibilityState !== 'visible'
  )
    return;
  try {
    if (Number(sessionStorage.getItem(startupReloadKey)) > Date.now()) return;
    // If storage is unavailable, keep the explicit update flow rather than risk a reload loop.
    sessionStorage.setItem(startupReloadKey, '0');
  } catch {
    return;
  }
  startupDeadline = Date.now() + startupTimeoutMs;
  startupReady = new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => finishStartup(), startupTimeoutMs);
    finishStartup = () => {
      startupDeadline = 0;
      window.clearTimeout(timeout);
      for (const cleanup of startupCleanups) cleanup();
      startupCleanups.clear();
      if (!reloading) resolve();
    };
  });
}
function handleNewController() {
  if (restartAuthorized) reloadOnce();
  else if (canRestartAtStartup()) {
    try {
      // One automatic reload per 30 seconds, even if an update remains broken or changes again.
      sessionStorage.setItem(startupReloadKey, String(Date.now() + 30_000));
      reloadOnce();
    } catch {
      finishStartup();
      update({ updateAvailable: true, reloadRequired: true });
    }
  } else update({ updateAvailable: true, reloadRequired: true });
}
async function checkStartupUpdate(value: ServiceWorkerRegistration) {
  if (!canRestartAtStartup()) return;
  try {
    await value.update();
    if (!canRestartAtStartup()) return;
    const installing = value.installing;
    if (installing && installing.state !== 'installed' && installing.state !== 'redundant') {
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          installing.removeEventListener('statechange', changed);
          startupCleanups.delete(cleanup);
          resolve();
        };
        const changed = () => {
          if (installing.state === 'installed' || installing.state === 'redundant') cleanup();
        };
        startupCleanups.add(cleanup);
        installing.addEventListener('statechange', changed);
        changed();
      });
    }
    if (!canRestartAtStartup()) return;
    if (!value.waiting) {
      finishStartup();
      return;
    }
    update({ updateAvailable: true });
    const channel = new MessageChannel();
    const close = () => {
      channel.port1.close();
      startupCleanups.delete(close);
    };
    startupCleanups.add(close);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      close();
      if (event.data !== 'WT_STARTUP_ACCEPTED') finishStartup();
    };
    // The waiting worker, not a tab-local guess, checks for ALL other same-scope windows.
    value.waiting.postMessage({ type: 'WT_STARTUP_UPDATE', deadline: startupDeadline }, [
      channel.port2,
    ]);
  } catch {
    // Offline, failed installation and old workers without the protocol must not block login.
    finishStartup();
  }
}
function update(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
function reloadOnce() {
  if (!reloading) {
    reloading = true;
    window.location.reload();
  }
}
export const pwaSnapshot = () => state;
export function subscribePwa(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Installed once before any app effect; offline commands never reach the network. */
export function initializePwa() {
  if (started) return startupReady;
  started = true;
  const fetchOnline = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    if (!navigator.onLine && !['GET', 'HEAD', 'OPTIONS'].includes(method))
      return Promise.reject(new TypeError('OFFLINE_WRITE_BLOCKED'));
    return fetchOnline(input, init);
  };
  window.addEventListener('offline', () => update({ online: false, reconnected: false }));
  window.addEventListener('online', () => update({ online: true, reconnected: true }));
  const authLink = ['/reset-password', '/confirm-email-change'].includes(window.location.pathname);
  // Do not consume or replace a token-bearing link while offline. Its screen is still withheld.
  if (state.startupOffline && !authLink && window.location.pathname !== '/offline')
    window.history.replaceState(null, '', '/offline');
  if (!import.meta.env.PROD) return startupReady;
  prepareStartup();
  let controller = navigator.serviceWorker?.controller;
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    const next = navigator.serviceWorker.controller;
    if (controller && next && controller !== next) {
      handleNewController();
    }
    controller = next;
  });
  updateWorker = registerSW({
    immediate: true,
    onNeedRefresh: () => update({ updateAvailable: true }),
    onNeedReload: () => {
      // Another tab can activate a new worker. This tab still requires its own consent.
      handleNewController();
    },
    onRegisteredSW: (_url, value) => {
      registration = value;
      if (value) void checkStartupUpdate(value);
      else finishStartup();
    },
    onRegisterError: () => {
      finishStartup();
      update({ registrationFailed: true });
    },
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') finishStartup();
    if (document.visibilityState === 'visible' && navigator.onLine)
      void registration?.update().catch(() => {
        /* Keep the current version usable. */
      });
  });
  return startupReady;
}
export async function restartForUpdate() {
  if (!navigator.onLine || !state.updateAvailable) return;
  restartAuthorized = true;
  if (state.reloadRequired || (registration?.active && !registration.waiting)) reloadOnce();
  else {
    try {
      await updateWorker?.();
    } catch {
      restartAuthorized = false;
      update({ registrationFailed: true });
    }
  }
}
export function reloadFromOffline() {
  if (!navigator.onLine) return;
  const destination = startupLocation.startsWith('/offline') ? '/' : startupLocation;
  const currentLocation = window.location.pathname + window.location.search + window.location.hash;
  // Assigning an unchanged fragment URL is only a same-document navigation.
  if (state.startupOffline && destination !== currentLocation) window.location.assign(destination);
  else window.location.reload();
}
