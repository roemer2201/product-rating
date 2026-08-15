import { useEffect, useState } from 'react';

/**
 * Stands in for `virtual:pwa-register/react` in the tests.
 *
 * That module only exists while `vite-plugin-pwa` is part of the build, and the
 * test run deliberately does not include the plugin — a service worker in jsdom
 * would test Workbox, not this app. `vitest.config.ts` therefore points the
 * import at this file.
 *
 * What is worth testing about `UpdatePrompt` is what happens once a new version
 * is waiting, so that is what this stub can be told to report.
 */

export interface RegisterSWOptions {
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
}

interface RegisterSWMock {
  /** Whether a waiting worker is reported right from the first render. */
  needRefresh: boolean;
  /** Handed to `onRegisteredSW`; a test uses it to watch `update()` calls. */
  registration: ServiceWorkerRegistration | undefined;
  /** Stands in for the reload; a test asserts that it was called. */
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
}

const defaults: RegisterSWMock = {
  needRefresh: false,
  registration: undefined,
  updateServiceWorker: () => Promise.resolve(),
};

export const registerSWMock: RegisterSWMock = { ...defaults };

/** Back to the defaults; belongs in an `afterEach` of every test that sets it. */
export function resetRegisterSWMock(): void {
  Object.assign(registerSWMock, defaults);
}

export function useRegisterSW(options: RegisterSWOptions = {}) {
  const [needRefresh, setNeedRefresh] = useState(registerSWMock.needRefresh);
  const onRegisteredSW = options.onRegisteredSW;

  useEffect(() => {
    onRegisteredSW?.('/sw.js', registerSWMock.registration);
  }, [onRegisteredSW]);

  return {
    needRefresh: [needRefresh, setNeedRefresh] as const,
    offlineReady: [false, () => {}] as const,
    updateServiceWorker: registerSWMock.updateServiceWorker,
  };
}
