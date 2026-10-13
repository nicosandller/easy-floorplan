import { easeCss, type TweenFrames } from "./opening-tween";

/** Exact quarter turns keep the existing SVG geometry and tests unchanged. */
export function rotationBasis(angle: number): { cos: number; sin: number } {
  const a = ((angle % 360) + 360) % 360;
  switch (a) {
    case 0: return { cos: 1, sin: 0 };
    case 90: return { cos: 0, sin: 1 };
    case 180: return { cos: -1, sin: 0 };
    case 270: return { cos: 0, sin: -1 };
    default: return { cos: Math.cos(a * Math.PI / 180), sin: Math.sin(a * Math.PI / 180) };
  }
}

export const ROTATION_MS = 450;
const wrap = (angle: number) => ((angle % 360) + 360) % 360;

/**
 * Viewer rotation, independent of saved config. Targets stay unwrapped while
 * moving: 270 -> 360 travels right through 90 degrees, not left through 270.
 * Retarget from the current position so rapid/reversed clicks never teleport.
 */
export class RotationTween {
  private _value = 0;
  private _from = 0;
  private _target = 0;
  private _start = 0;
  private _duration = ROTATION_MS;
  private _handle: number | undefined;

  constructor(private readonly frames: TweenFrames, private readonly changed: () => void) {}

  get value(): number { return this._value; }
  get target(): number { return wrap(this._target); }
  get running(): boolean { return this._handle !== undefined; }

  turn(step: -90 | 90, animate: boolean): void {
    const now = this.frames.now();
    this._sample(now);
    const target = this._target + step;
    if (!animate) { this.jump(target); return; }
    this._from = this._value;
    this._target = target;
    this._start = now;
    // Extra clicks add turns, without leaving a long animation queue behind.
    this._duration = ROTATION_MS * Math.min(2, Math.abs(target - this._from) / 90);
    if (this._duration === 0) { this.finish(); return; }
    this._schedule();
    this.changed();
  }

  /** Reset, reduced motion, a changed projection or teardown cancels the RAF. */
  jump(angle: number): void {
    if (this._handle !== undefined) this.frames.cancel(this._handle);
    this._handle = undefined;
    this._value = this._from = this._target = wrap(angle);
    this.changed();
  }

  finish(): void { this.jump(this._target); }

  private _sample(now: number): void {
    if (!this.running) return;
    const progress = Math.min(1, Math.max(0, (now - this._start) / this._duration));
    this._value = this._from + (this._target - this._from) * easeCss(progress);
  }

  private _schedule(): void {
    if (this._handle !== undefined) return;
    this._handle = this.frames.request(() => {
      this._sample(this.frames.now());
      this._handle = undefined;
      if (this.frames.now() - this._start >= this._duration) {
        this._value = this._from = this._target = wrap(this._target);
      } else {
        this._schedule();
      }
      this.changed();
    });
  }
}
