import { describe, expect, it } from "vitest";
import { AmountTween, OPENING_TWEEN_MS, easeCss, type TweenFrames } from "./opening-tween";

/** A hand-driven clock: frames run only when the test says so. */
function clock() {
  let now = 1000;
  let next = 1;
  const queue = new Map<number, () => void>();
  const frames: TweenFrames = {
    now: () => now,
    request: (cb) => {
      const handle = next++;
      queue.set(handle, cb);
      return handle;
    },
    cancel: (handle) => queue.delete(handle),
  };
  return {
    frames,
    advance(ms: number) {
      now += ms;
    },
    /** Run whatever was queued, as a browser would at the next frame. */
    flush() {
      const due = [...queue.values()];
      queue.clear();
      for (const cb of due) cb();
      return due.length;
    },
    get pending() {
      return queue.size;
    },
  };
}

describe("easeCss — the curve CSS `ease` draws", () => {
  it("pins both ends and stays inside them", () => {
    expect(easeCss(0)).toBe(0);
    expect(easeCss(1)).toBe(1);
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(easeCss(x)).toBeGreaterThan(0);
      expect(easeCss(x)).toBeLessThan(1);
    }
  });

  it("rises without ever turning back", () => {
    let last = 0;
    for (let x = 0; x <= 1.0001; x += 0.01) {
      const y = easeCss(x);
      expect(y).toBeGreaterThanOrEqual(last - 1e-9);
      last = y;
    }
  });

  it("is past halfway at the halfway point, which is what `ease` looks like", () => {
    // cubic-bezier(.25,.1,.25,1) at x=0.5 is ~0.8 — the fast middle that makes
    // a door leave its frame promptly and settle gently.
    expect(easeCss(0.5)).toBeGreaterThan(0.75);
    expect(easeCss(0.5)).toBeLessThan(0.85);
  });
});

describe("AmountTween", () => {
  it("takes the first value it sees outright, so a fresh card does not play every door", () => {
    const c = clock();
    const tween = new AmountTween(c.frames, () => {});
    expect(tween.value("door", 1)).toBe(1);
    expect(c.pending).toBe(0);
    expect(tween.running).toBe(false);
  });

  it("eases to a new target and asks for frames until it arrives", () => {
    const c = clock();
    let renders = 0;
    const tween = new AmountTween(c.frames, () => renders++);
    tween.value("door", 0);

    // The state flips: still shut this frame, and a frame is requested.
    expect(tween.value("door", 1)).toBe(0);
    expect(tween.running).toBe(true);

    c.advance(OPENING_TWEEN_MS / 2);
    c.flush();
    expect(renders).toBe(1);
    const middle = tween.value("door", 1);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);

    c.advance(OPENING_TWEEN_MS);
    c.flush();
    expect(tween.value("door", 1)).toBe(1);
    // Arrived: nothing more to draw, so it stops asking for frames.
    c.flush();
    expect(c.pending).toBe(0);
  });

  it("turns around from wherever it had got to", () => {
    const c = clock();
    const tween = new AmountTween(c.frames, () => {});
    tween.value("door", 0);
    tween.value("door", 1);
    c.advance(OPENING_TWEEN_MS / 2);
    const middle = tween.value("door", 1);

    // Shut again mid-swing: it starts back from here, not from wide open.
    expect(tween.value("door", 0)).toBeCloseTo(middle, 6);
    c.advance(OPENING_TWEEN_MS / 4);
    const back = tween.value("door", 0);
    expect(back).toBeLessThan(middle);
    expect(back).toBeGreaterThan(0);
  });

  it("keeps every panel on its own clock", () => {
    const c = clock();
    const tween = new AmountTween(c.frames, () => {});
    tween.value("left", 0);
    tween.value("right", 0);
    tween.value("left", 1);
    c.advance(OPENING_TWEEN_MS / 2);
    tween.value("right", 1);
    expect(tween.value("left", 1)).toBeGreaterThan(tween.value("right", 1));
  });

  it("jumps straight there when asked for no animation at all", () => {
    const c = clock();
    const tween = new AmountTween(c.frames, () => {}, 0);
    tween.value("door", 0);
    expect(tween.value("door", 1)).toBe(1);
    expect(tween.running).toBe(false);
  });

  it("stops asking for frames once it is told to stop", () => {
    const c = clock();
    let renders = 0;
    const tween = new AmountTween(c.frames, () => renders++);
    tween.value("door", 0);
    tween.value("door", 1);
    expect(tween.running).toBe(true);
    tween.stop();
    expect(tween.running).toBe(false);
    c.flush();
    expect(renders).toBe(0);
  });

  it("re-reads the duration for the panels still to come", () => {
    const c = clock();
    const tween = new AmountTween(c.frames, () => {});
    tween.value("door", 0);
    tween.setDuration(0);
    expect(tween.value("door", 1)).toBe(1);
  });
});
