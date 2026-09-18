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
 * starts only while `scrollY` is at zero. Everything below that is ordinary
 * scrolling and stays untouched.
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
  const startY = useRef<number | null>(null);
  const active = useRef(false);
  const distance = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const disabledRef = useRef(disabled);
  const onRefreshRef = useRef(onRefresh);

  // Updated after the commit rather than during the render: the handlers below
  // only ever run on a touch, which is long after React is done painting.
  useEffect(() => {
    phaseRef.current = phase;
    disabledRef.current = disabled;
    onRefreshRef.current = onRefresh;
  });

  const runRefresh = useCallback(async (): Promise<void> => {
    setPhase('refreshing');
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
    setPhase('idle');
  }, []);

  useEffect(() => {
    const reset = (): void => {
      startY.current = null;
      active.current = false;
      distance.current = 0;
    };

    const onTouchStart = (event: TouchEvent): void => {
      reset();
      if (disabledRef.current || phaseRef.current === 'refreshing') return;
      // Two fingers are a zoom, not a pull.
      if (event.touches.length !== 1 || !atTop()) return;

      startY.current = event.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (event: TouchEvent): void => {
      const start = startY.current;
      if (start === null || event.touches.length !== 1) return;

      const touch = event.touches[0];
      if (touch === undefined) return;

      const delta = touch.clientY - start;

      // Upwards, or no longer at the top because the page moved underneath:
      // this is a scroll, and it stays one until the finger is lifted.
      if (delta <= 0 || !atTop()) {
        if (active.current) {
          setPull(0);
          setPhase('idle');
        }
        reset();
        return;
      }

      if (!active.current) {
        if (delta < SLOP) return;
        active.current = true;
        setPhase('pulling');
      }

      // Taking over the gesture: without this the page rubber-bands, and in a
      // browser tab iOS would start its own reload on top of this one.
      if (event.cancelable) event.preventDefault();

      distance.current = Math.min((delta - SLOP) * RESISTANCE, MAX_PULL);
      setPull(distance.current);
    };

    const onTouchEnd = (): void => {
      const reached = active.current && distance.current >= THRESHOLD;
      reset();
      if (!reached) {
        if (phaseRef.current === 'pulling') {
          setPull(0);
          setPhase('idle');
        }
        return;
      }

      void runRefresh();
    };

    const onTouchCancel = (): void => {
      reset();
      if (phaseRef.current === 'pulling') {
        setPull(0);
        setPhase('idle');
      }
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
  }, [runRefresh]);

  // A gesture that is switched off mid-pull still has to put the page back.
  useEffect(() => {
    if (disabled && phase === 'pulling') {
      setPull(0);
      setPhase('idle');
    }
  }, [disabled, phase]);

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
