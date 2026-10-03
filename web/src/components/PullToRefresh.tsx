import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { RefreshIcon } from '@/components/icons';
import { strings } from '@/lib/strings';

/**
 * Pull down at the top of the list to reload it.
 *
 * The gesture every phone list has: standing at the very top and dragging
 * further brings up a small symbol, and past a certain distance letting go
 * reloads. It is the shortest way to ask "is this still current?" without
 * hunting for a button, and on a list that is opened, scrolled and left again
 * it is also the only one anybody looks for.
 *
 * The page itself is the scroll container here - the shell is only as tall as
 * the screen and the document scrolls - so the gesture hangs on `window` and
 * starts inside the catalogue only while `scrollY` is at zero. Everything
 * below that is ordinary scrolling and stays untouched.
 *
 * The indicator sits above the content and the content moves down with the
 * finger, so the drag has something to hold on to. The distance is damped: the
 * finger travels twice as far as the page, which keeps an accidental flick from
 * turning into a reload and makes the threshold something one has to mean.
 */

interface PullToRefreshProps {
  /**
   * Reloads. The indicator keeps spinning until the promise settles, so this
   * has to be the whole refresh, not the start of it.
   */
  onRefresh: () => Promise<unknown>;
  /**
   * Switches the gesture off, for as long as there is nothing to refresh - the
   * first load of the list, for instance, which is showing its own skeleton.
   */
  disabled?: boolean;
  children: ReactNode;
}

/** How much of the finger's travel the page follows. */
const RESISTANCE = 0.5;

/** How far the content can be dragged down, in pixels. */
const MAX_PULL = 96;

/** From here on letting go reloads. */
const THRESHOLD = 64;

/** Where the indicator waits while the refresh runs. */
const REST = 56;

/**
 * Below this a drag is not yet a direction. Both the browser and this gesture
 * would otherwise claim the first pixel of every touch.
 */
const SLOP = 8;

/**
 * How long the running indicator stays visible at the very least. A refresh
 * against a warm cache answers in a few milliseconds, and a symbol that only
 * flashes reads as "nothing happened" rather than "nothing has changed".
 */
const MIN_VISIBLE_MS = 400;

type Phase = 'idle' | 'pulling' | 'refreshing';

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** The position the page is at, tolerating the negative values of rubber-band. */
function atTop(): boolean {
  return window.scrollY <= 0;
}

export function PullToRefresh({ onRefresh, disabled = false, children }: PullToRefreshProps) {
  const [pull, setPull] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');

  // The gesture lives in refs, not in state: `touchmove` fires far more often
  // than the screen is painted, and every one of these values is read inside
  // the handler rather than rendered.
  const rootRef = useRef<HTMLDivElement>(null);
  const startTouch = useRef<{ x: number; y: number; id: number } | null>(null);
  const active = useRef(false);
  const distance = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const disabledRef = useRef(disabled);
  const onRefreshRef = useRef(onRefresh);

  // Updated after the commit rather than during the render: the handlers below
  // only ever run on a touch, which is long after React is done painting.
  useEffect(() => {
    disabledRef.current = disabled;
    onRefreshRef.current = onRefresh;
  });

  // Touch events can arrive before React commits the next render. Keep the
  // imperative lock current immediately rather than waiting for an effect.
  const changePhase = useCallback((next: Phase): void => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const resetGesture = useCallback((): void => {
    startTouch.current = null;
    active.current = false;
    distance.current = 0;
  }, []);

  const cancelGesture = useCallback((): void => {
    resetGesture();
    if (phaseRef.current === 'pulling') {
      setPull(0);
      changePhase('idle');
    }
  }, [changePhase, resetGesture]);

  const runRefresh = useCallback(async (): Promise<void> => {
    changePhase('refreshing');
    setPull(REST);

    const started = Date.now();
    try {
      await onRefreshRef.current();
    } catch {
      // Whatever went wrong is the caller's to report - the list has its own
      // error notice. The gesture only owes the indicator an end.
    }

    const remaining = MIN_VISIBLE_MS - (Date.now() - started);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }

    setPull(0);
    changePhase('idle');
  }, [changePhase]);

  useEffect(() => {
    const onTouchStart = (event: TouchEvent): void => {
      // A second finger cancels both the visual pull and its release action.
      cancelGesture();
      if (disabledRef.current || phaseRef.current === 'refreshing') return;
      if (event.touches.length !== 1 || !atTop()) return;
      // The document scrolls, but header/navigation gestures are not catalogue
      // gestures. Only starts inside this component may claim later moves.
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) return;

      const touch = event.touches[0];
      if (touch !== undefined) {
        startTouch.current = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
      }
    };

    const onTouchMove = (event: TouchEvent): void => {
      const start = startTouch.current;
      if (start === null) return;
      const touch = event.touches[0];
      if (
        disabledRef.current ||
        event.touches.length !== 1 ||
        touch === undefined ||
        touch.identifier !== start.id ||
        !event.cancelable ||
        !atTop()
      ) {
        cancelGesture();
        return;
      }

      const delta = touch.clientY - start.y;
      const horizontal = Math.abs(touch.clientX - start.x);

      // Once this is an upward scroll or horizontal swipe, leave it to the
      // browser until release, even if the finger changes direction later.
      if (delta <= 0) {
        cancelGesture();
        return;
      }

      if (!active.current) {
        if (Math.max(delta, horizontal) < SLOP) return;
        if (horizontal >= delta) {
          cancelGesture();
          return;
        }
        active.current = true;
        changePhase('pulling');
      }

      // Only claim a cancellable downward drag; otherwise the browser is
      // already handling it and moving the content too would fight its scroll.
      event.preventDefault();
      distance.current = Math.min((delta - SLOP) * RESISTANCE, MAX_PULL);
      setPull(distance.current);
    };

    const onTouchEnd = (event: TouchEvent): void => {
      const reached =
        !disabledRef.current &&
        event.touches.length === 0 &&
        atTop() &&
        active.current &&
        distance.current >= THRESHOLD;
      cancelGesture();
      if (reached) void runRefresh();
    };

    const onTouchCancel = (): void => {
      cancelGesture();
    };

    // `touchmove` has to be able to cancel the browser's own scrolling, which a
    // passive listener may not do. The other three never call `preventDefault`.
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [cancelGesture, changePhase, runRefresh]);

  // Disabling cancels the stored gesture too: re-enabling before release must
  // never revive a pull which the interface already returned to rest.
  useEffect(() => {
    if (disabled) cancelGesture();
  }, [cancelGesture, disabled]);

  const ready = phase === 'pulling' && pull >= THRESHOLD;
  const refreshing = phase === 'refreshing';
  const progress = Math.min(pull / THRESHOLD, 1);

  const label = refreshing
    ? strings.pullRefresh.refreshing
    : ready
      ? strings.pullRefresh.ready
      : strings.pullRefresh.idle;

  // While the finger is down the indicator follows it without a transition -
  // it is being dragged, and a transition would make it lag behind. The way
  // back, and the way to the resting position, is animated.
  const animate = phase !== 'pulling' && !prefersReducedMotion();

  return (
    <div
      ref={rootRef}
      className="pull-refresh"
      style={
        {
          '--pull-distance': `${pull}px`,
          '--pull-progress': String(progress),
        } as CSSProperties
      }
      data-phase={phase}
      data-ready={ready ? 'true' : undefined}
    >
      <div
        className={`pull-refresh__indicator${animate ? ' pull-refresh__indicator--animated' : ''}`}
        aria-hidden
      >
        <RefreshIcon
          className={`pull-refresh__icon${refreshing ? ' pull-refresh__icon--spinning' : ''}`}
        />
      </div>

      {/*
        The commentary for assistive technology. It is only rendered while
        something is happening: an empty live region is silent, but a permanent
        "pull to refresh" would be read out on every visit to the list.
      */}
      <p className="visually-hidden" role="status">
        {phase === 'idle' ? '' : label}
      </p>

      <div className={`pull-refresh__content${animate ? ' pull-refresh__content--animated' : ''}`}>
        {children}
      </div>
    </div>
  );
}
