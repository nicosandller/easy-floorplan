import { describe, expect, it } from "vitest";
import { RotationTween, ROTATION_MS } from "./rotation";
import type { TweenFrames } from "./opening-tween";
import { areaZoomTransform, rotatePlanPoint, rotatedCanvasSize, shutterMarkNormal } from "./render";
import { elevationShift, projectPlanPoint, projectedCanvasSize } from "./projection";

function clock() {
  let now = 1000, id = 0;
  const queue = new Map<number, () => void>();
  const frames: TweenFrames = {
    now: () => now,
    request: (cb) => { queue.set(++id, cb); return id; },
    cancel: (key) => { queue.delete(key); },
  };
  return { frames, queue, tick(ms: number) {
    now += ms;
    const due = [...queue.values()];
    queue.clear();
    due.forEach((cb) => cb());
  } };
}

describe("quarter-turn animation", () => {
  it("moves through intermediate angles, lands exactly and stops scheduling", () => {
    const c = clock(), t = new RotationTween(c.frames, () => {});
    t.turn(90, true);
    expect(t.value).toBe(0);
    expect(t.target).toBe(90);
    let previous = t.value;
    for (let i = 0; i < 8; i++) {
      c.tick(ROTATION_MS / 10);
      expect(t.value).toBeGreaterThan(previous);
      expect(t.value).toBeLessThan(90);
      previous = t.value;
    }
    c.tick(ROTATION_MS);
    expect(t.value).toBe(90);
    expect(t.running).toBe(false);
    expect(c.queue.size).toBe(0);
  });

  it.each([-90, 90] as const)("crosses zero in the requested direction (%s)", (step) => {
    const c = clock(), t = new RotationTween(c.frames, () => {});
    t.jump(step === 90 ? 270 : 0);
    const start = t.value;
    t.turn(step, true);
    c.tick(120);
    expect(Math.sign(t.value - start)).toBe(Math.sign(step));
    expect(Math.abs(t.value - start)).toBeLessThan(90);
    c.tick(ROTATION_MS);
    expect(t.value).toBe(step === 90 ? 0 : 270);
  });

  it("retargets repeated and reversed clicks without teleporting or queuing RAFs", () => {
    const c = clock(), t = new RotationTween(c.frames, () => {});
    t.turn(90, true);
    c.tick(120);
    const midway = t.value;
    t.turn(90, true);
    expect(t.value).toBe(midway);
    expect(t.target).toBe(180);
    t.turn(-90, true);
    t.turn(-90, true);
    expect(t.value).toBe(midway);
    expect(t.target).toBe(0);
    expect(c.queue.size).toBe(1);
    c.tick(50);
    expect(t.value).toBeLessThan(midway);
    c.tick(ROTATION_MS * 2);
    expect(t.value).toBe(0);
    expect(c.queue.size).toBe(0);
  });

  it("can finish or reset an in-flight turn and supports instantaneous turns", () => {
    const c = clock(), t = new RotationTween(c.frames, () => {});
    t.turn(90, true);
    c.tick(90);
    t.finish();
    expect(t.value).toBe(90);
    expect(c.queue.size).toBe(0);
    t.turn(-90, false);
    expect(t.value).toBe(0);
    expect(c.queue.size).toBe(0);
    t.turn(-90, true);
    c.tick(90);
    t.jump(0);
    c.tick(1000);
    expect(t.value).toBe(0);
    expect(c.queue.size).toBe(0);
  });
});

describe("continuous isometric projection", () => {
  it.each([[700, 480], [800, 120]])("keeps a %s by %s floor centred, inside a fixed frame at every angle", (w, h) => {
    let first: { w: number; h: number } | undefined;
    for (let angle = -90; angle <= 450; angle += 5) {
      const frame = { ...rotatedCanvasSize(w, h, angle), projection: "iso" as const,
        wallHeight: 60, padding: 10, orbitSpan: Math.SQRT2 * Math.hypot(w, h) };
      const d = projectedCanvasSize(frame);
      first ??= d;
      expect(d).toEqual(first);
      const centre = rotatePlanPoint(w / 2, h / 2, w, h, angle);
      const pc = projectPlanPoint(centre.x, centre.y, frame, 30);
      expect(pc.x).toBeCloseTo(d.w / 2, 8);
      expect(pc.y).toBeCloseTo(d.h / 2, 8);
      for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h]]) {
        const p = rotatePlanPoint(x, y, w, h, angle);
        expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeCloseTo(Math.hypot(w, h) / 2, 8);
        for (const z of [0, 60]) {
          const onScreen = projectPlanPoint(p.x, p.y, frame, z);
          expect(onScreen.x).toBeGreaterThanOrEqual(0);
          expect(onScreen.x).toBeLessThanOrEqual(d.w);
          expect(onScreen.y).toBeGreaterThanOrEqual(0);
          expect(onScreen.y).toBeLessThanOrEqual(d.h);
        }
      }
    }
  });

  it("keeps raised furniture and opening badge bearings on their geometry between corners", () => {
    for (const angle of [-17, 22.5, 90, 149, 225, 359, 407]) {
      const p = rotatePlanPoint(140, 180, 600, 400, angle);
      const lift = elevationShift(24, angle);
      const top = rotatePlanPoint(140 + lift.x, 180 + lift.y, 600, 400, angle);
      expect(top.x - p.x).toBeCloseTo(-24, 8);
      expect(top.y - p.y).toBeCloseTo(-24, 8);
      const normal = shutterMarkNormal({ angle: 0 }, angle);
      const end = rotatePlanPoint(140, 181, 600, 400, angle);
      expect(normal.x).toBeCloseTo(end.x - p.x, 8);
      expect(normal.y).toBeCloseTo(end.y - p.y, 8);
    }
  });

  it("keeps a focused room at one scale throughout a complete turn", () => {
    const points = [{ x: 80, y: 60 }, { x: 240, y: 60 }, { x: 240, y: 170 }, { x: 80, y: 170 }];
    const scales: number[] = [];
    for (let angle = 0; angle <= 360; angle += 15) {
      const frame = { ...rotatedCanvasSize(700, 480, angle), projection: "iso" as const,
        wallHeight: 60, orbitSpan: Math.SQRT2 * Math.hypot(700, 480) };
      const zoom = areaZoomTransform(points, 700, 480, angle, undefined, undefined, undefined, frame);
      scales.push(zoom.scale);
      expect(Number.isFinite(zoom.txPercent)).toBe(true);
      expect(Number.isFinite(zoom.tyPercent)).toBe(true);
    }
    expect(scales[0]).toBeGreaterThan(1);
    scales.forEach((s) => expect(s).toBeCloseTo(scales[0], 8));
  });
});
