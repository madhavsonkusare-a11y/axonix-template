/**
 * Chrome's `window.chrome`, for the social apps' sign-in providers.
 *
 * Registered as a session preload on every social session (main.ts,
 * `prepareSessions`), so it runs at document start in each app's page and in
 * the sign-in popups those pages open — the Google popup included, which gets
 * no other preload. Electron leaves `window.chrome` a bare `{}`; Google's
 * sign-in checks read that as an embedded browser and refuse ("This browser or
 * app may not be secure"). Chrome's own shape — `app`, `csi()`, `loadTimes()` —
 * is filled in, in the page's world, before any of its scripts run. Members a
 * page already has are never replaced, and nothing is exposed to the page.
 *
 * After the fix Zenium shipped for the same problem (github.com/BenItBuhner/Zenium, PR 142).
 */
import { contextBridge } from 'electron';

try {
  contextBridge.executeInMainWorld({
    func: () => {
      const w = window as unknown as { chrome?: Record<string, unknown> };
      if (!w.chrome || typeof w.chrome !== 'object') w.chrome = {};
      const chrome = w.chrome;
      if (!('app' in chrome)) {
        chrome.app = {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
          getDetails: () => null,
          getIsInstalled: () => false,
          runningState: () => 'cannot_run',
        };
      }
      if (!('csi' in chrome)) {
        chrome.csi = () => ({ onloadT: Date.now(), pageT: performance.now(), startE: performance.timeOrigin, tran: 15 });
      }
      if (!('loadTimes' in chrome)) {
        chrome.loadTimes = () => {
          const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
          const at = (ms?: number) => (performance.timeOrigin + (ms ?? 0)) / 1000;
          const protocol = nav?.nextHopProtocol || 'h2';
          return {
            requestTime: at(nav?.requestStart),
            startLoadTime: at(nav?.startTime),
            commitLoadTime: at(nav?.responseStart),
            finishDocumentLoadTime: at(nav?.domContentLoadedEventEnd),
            finishLoadTime: at(nav?.loadEventEnd),
            firstPaintTime: at(nav?.responseEnd),
            firstPaintAfterLoadTime: 0,
            navigationType: 'Other',
            wasFetchedViaSpdy: protocol === 'h2' || protocol === 'h3',
            wasNpnNegotiated: true,
            npnNegotiatedProtocol: protocol,
            wasAlternateProtocolAvailable: false,
            connectionInfo: protocol,
          };
        };
      }
    },
  });
} catch {
  // A page that can't take it signs in as it did before.
}
