/**
 * Lets a test decide whether the browser is online.
 *
 * `navigator.onLine` is a getter on the prototype and jsdom always answers
 * `true`. Defining an own property on the navigator shadows it, and deleting
 * that property afterwards puts everything back — which `setup.ts` does after
 * every test, so no test has to remember it.
 *
 * The matching event is dispatched as well: `useOnlineStatus` subscribes to it
 * rather than polling, so without it a mounted component would keep showing the
 * old state.
 */

export function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });

  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

export function restoreOnline(): void {
  Reflect.deleteProperty(window.navigator, 'onLine');
}
