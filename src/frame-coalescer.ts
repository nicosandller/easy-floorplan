/**
 * Collapses a burst of values into one delivery per animation frame.
 *
 * Pointer events arrive faster than a browser can render — a 1000Hz mouse
 * against a 60Hz display is 16 events per frame. Handling every one of them
 * does not make the drag smoother, it makes it *later*: the work queues up and
 * the gap between the cursor and what it is dragging grows for as long as the
 * gesture lasts. Delivering only the newest value each frame bounds that queue
 * at one event, so the drag can fall at most one frame behind however fast the
 * pointer moves.
 *
 * The scheduler is injected so tests can drive frames by hand.
 */
export interface FrameScheduler {
  request(cb: () => void): number;
  cancel(handle: number): void;
}

export const rafScheduler: FrameScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export class FrameCoalescer<T> {
  private _pending: T | null = null;
  /**
   * Whether `_pending` holds a value. A separate flag rather than a `null`
   * check: `T` may itself include `null`, and a queued `null` has to be
   * delivered like any other value instead of being read as "nothing queued".
   */
  private _hasPending = false;
  private _handle: number | null = null;

  constructor(
    private readonly frames: FrameScheduler,
    private readonly deliver: (value: T) => void,
  ) {}

  /** True while a value is queued for delivery. */
  get pending(): boolean {
    return this._hasPending;
  }

  /** The most recent queued value, if one is awaiting delivery. */
  get last(): T | null {
    return this._hasPending ? (this._pending as T) : null;
  }

  /** Queue a value, replacing any still waiting for this frame. */
  push(value: T): void {
    this._pending = value;
    this._hasPending = true;
    if (this._handle !== null) return;
    this._handle = this.frames.request(() => {
      this._handle = null;
      this._deliverPending();
    });
  }

  /**
   * Deliver the newest queued value now. For the end of a gesture: pointerup
   * must land on the last position the pointer actually reported, not on
   * whatever the previous frame happened to catch.
   */
  settle(): void {
    this._cancelFrame();
    this._deliverPending();
  }

  /** Drop anything queued without delivering it (the gesture was canceled). */
  cancel(): void {
    this._cancelFrame();
    this._pending = null;
    this._hasPending = false;
  }

  private _cancelFrame(): void {
    if (this._handle === null) return;
    this.frames.cancel(this._handle);
    this._handle = null;
  }

  private _deliverPending(): void {
    if (!this._hasPending) return;
    const value = this._pending as T;
    this._pending = null;
    this._hasPending = false;
    this.deliver(value);
  }
}
