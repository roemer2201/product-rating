import { useSyncExternalStore } from 'react';

/**
 * Whether the browser thinks it has a network connection.
 *
 * `navigator.onLine` answers a narrow question: is there *a* network. A phone
 * on a hotel Wi-Fi that swallows every request is online by this measure, and a
 * server that is down does not change it at all. So the value is good enough to
 * explain a failure that has already happened, and to warn before a write is
 * attempted — it is never used to decide whether a request is worth sending.
 *
 * `useSyncExternalStore` instead of state plus an effect: the value is read
 * during render and can change between the render and the subscription, which
 * is exactly the tear this hook exists to avoid.
 */

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('online', onStoreChange);
  window.addEventListener('offline', onStoreChange);

  return () => {
    window.removeEventListener('online', onStoreChange);
    window.removeEventListener('offline', onStoreChange);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

export function useOnlineStatus(): boolean {
  // There is no server rendering here; the third argument only exists because
  // the signature demands one. "Online" is the right guess either way.
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
