/**
 * Eased travel for the standing opening panels (issue #261).
 *
 * The flat view animates its door leaf with a CSS transform transition, and
 * the projected panels cannot do the same: their shape is recomputed from the
 * opening's travel every render, so there is no single property for CSS to
 * interpolate between.
 *
 * What makes this cheap is that every motion the projection draws — a swing,
 * each slider, a roll-up curtain, an awning, a shutter — is a function of one
 * number between 0 and 1. Easing that number and re-rendering animates all of
 * them without any of them knowing there is an animation, and a shape added
 * later is animated the day it is drawn.
 *
 * The clock is injected the way {@link FrameCoalescer}'s scheduler is, so the
 * tests drive time by hand instead of waiting for real frames.
 */

/** Matches the 0.5s leaf transition the flat view uses, so the views agree. */
export const OPENING_TWEEN_MS = 500;

export interface TweenFrames {
  now(): number;
  request(cb: () => void): number;
  cancel(handle: number): void;
}

export const rafTweenFrames: TweenFrames = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(cb),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * CSS `ease` — cubic-bezier(0.25, 0.1, 0.25, 1) — so a panel and the flat
 * view's leaf accelerate alike. x is solved for t by Newton's method, which
 * converges in a few steps on a curve this gentle, with bisection as the
 * fallback for the rare step that leaves the interval.
 */
export function easeCss(x: number): number {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  const P1X = 0.25;
  const P1Y = 0.1;
  const P2X = 0.25;
  const P2Y = 1;
  const curve = (t: number, a: number, b: number) =>
    ((1 - t) * (1 - t) * 3 * a + (1 - t) * t * 3 * b + t * t) * t;
  const slope = (t: number, a: number, b: number) =>
    3 * (1 - t) * (1 - t) * a + 6 * (1 - t) * t * (b - a) + 3 * t * t * (1 - b);
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = curve(t, P1X, P2X) - x;
    if (Math.abs(err) < 1e-6) break;
    if (err > 0) hi = t;
    else lo = t;
    const d = slope(t, P1X, P2X);
    const next = d > 1e-6 ? t - err / d : (lo + hi) / 2;
    t = next > lo && next < hi ? next : (lo + hi) / 2;
  }
  return curve(t, P1Y, P2Y);
}

interface Travel {
  from: number;
  to: number;
  start: number;
}

/**
 * The animated value of each opening's travel, keyed by whatever the caller
 * calls it — one key per panel that moves on its own, so a double door's two
 * leaves and a shutter over them each ease independently.
 */
export class AmountTween {
  private readonly _travels = new Map<string, Travel>();
  private _handle: number | null = null;
  private _duration: number;

  constructor(
    private readonly frames: TweenFrames,
    private readonly onFrame: () => void,
    duration: number = OPENING_TWEEN_MS
  ) {
    this._duration = duration;
  }

  /** Zero animates nothing, which is what prefers-reduced-motion asks for. */
  setDuration(ms: number): void {
    this._duration = Math.max(0, ms);
  }

  /**
   * What to draw for `key` right now, easing toward `target` and asking for
   * another frame while it has not arrived.
   *
   * A key seen for the first time takes its target outright: a card that has
   * just loaded shows the house as it is, rather than playing every door open
   * at once.
   */
  value(key: string, target: number): number {
    const now = this.frames.now();
    const travel = this._travels.get(key);
    if (!travel) {
      this._travels.set(key, { from: target, to: target, start: now });
      return target;
    }
    if (travel.to !== target) {
      travel.from = this._at(travel, now);
      travel.to = target;
      travel.start = now;
    }
    const value = this._at(travel, now);
    if (value !== travel.to) this._schedule();
    return value;
  }

  /** Stop asking for frames — the card is going away, or the view is flat. */
  stop(): void {
    if (this._handle !== null) this.frames.cancel(this._handle);
    this._handle = null;
  }

  /** True while at least one panel is still travelling. */
  get running(): boolean {
    return this._handle !== null;
  }

  private _at(travel: Travel, now: number): number {
    if (this._duration <= 0) return travel.to;
    const elapsed = now - travel.start;
    if (!(elapsed > 0)) return travel.from;
    if (elapsed >= this._duration) return travel.to;
    return travel.from + (travel.to - travel.from) * easeCss(elapsed / this._duration);
  }

  private _schedule(): void {
    if (this._handle !== null) return;
    this._handle = this.frames.request(() => {
      this._handle = null;
      this.onFrame();
    });
  }
}
