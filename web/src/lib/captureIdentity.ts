import { useSyncExternalStore } from 'react';

const KEY = 'product-rating-capture-owner';
const EVENT = 'product-rating-identity';
let fallback: string | null = null;

/** Last identity confirmed by the server, retained for offline cold starts. */
export function captureOwner(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return fallback;
  }
}

export function confirmCaptureOwner(id: string | null): void {
  fallback = id;
  try {
    if (id === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, id);
  } catch {
    /* Storage may be disabled. */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(notify: () => void): () => void {
  window.addEventListener(EVENT, notify);
  window.addEventListener('storage', notify);
  return () => {
    window.removeEventListener(EVENT, notify);
    window.removeEventListener('storage', notify);
  };
}

export function useCaptureOwner(): string | null {
  return useSyncExternalStore(subscribe, captureOwner, () => null);
}
