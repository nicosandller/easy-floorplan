import { describe, expect, it } from "vitest";
import {
  clampView,
  isWholePlan,
  MAX_PLAN_ZOOM,
  panBy,
  pastPanThreshold,
  stepZoom,
  wheelZoomFactor,
  ZOOM_STEP,
  zoomAt,
} from "./plan-zoom";
import { areaZoomTransform, IDENTITY_ZOOM } from "./render";

/** The plan point (percent of the plan) shown at fraction f of the box. */
const under = (t: number, scale: number, f: number) => (f * 100 - t) / scale;

describe("stepZoom", () => {
  it("steps in by a fixed factor about the centre", () => {
    const v = stepZoom(IDENTITY_ZOOM, 1);
    expect(v.scale).toBe(ZOOM_STEP);
    // The centre of the plan stays in the centre of the view.
    expect(under(v.txPercent, v.scale, 0.5)).toBeCloseTo(50);
    expect(under(v.tyPercent, v.scale, 0.5)).toBeCloseTo(50);
  });

  it("stays where it was put: another step builds on the last", () => {
    const two = stepZoom(stepZoom(IDENTITY_ZOOM, 1), 1);
    expect(two.scale).toBeCloseTo(ZOOM_STEP * ZOOM_STEP);
  });

  it("stops at the ceiling", () => {
    let v = IDENTITY_ZOOM;
    for (let i = 0; i < 20; i++) v = stepZoom(v, 1);
    expect(v.scale).toBe(MAX_PLAN_ZOOM);
    expect(stepZoom(v, 1).scale).toBe(MAX_PLAN_ZOOM);
  });

  it("zooming out to 1 is the whole plan, exactly", () => {
    let v = stepZoom(stepZoom(IDENTITY_ZOOM, 1), 1);
    v = stepZoom(stepZoom(v, -1), -1);
    expect(v).toEqual(IDENTITY_ZOOM);
    expect(isWholePlan(v)).toBe(true);
    // And never past it.
    expect(stepZoom(IDENTITY_ZOOM, -1)).toEqual(IDENTITY_ZOOM);
  });

  it("composes with a room's framing: the room stays centred as it steps", () => {
    // A small room near the top-left of a 1000x600 plan.
    const room = areaZoomTransform(
      [{ x: 300, y: 200 }, { x: 400, y: 200 }, { x: 400, y: 300 }, { x: 300, y: 300 }],
      1000, 600, 0
    );
    expect(room.scale).toBeGreaterThan(1);
    const centreX = under(room.txPercent, room.scale, 0.5);
    const centreY = under(room.tyPercent, room.scale, 0.5);
    const v = stepZoom(room, 1);
    expect(v.scale).toBeCloseTo(room.scale * ZOOM_STEP);
    expect(under(v.txPercent, v.scale, 0.5)).toBeCloseTo(centreX);
    expect(under(v.tyPercent, v.scale, 0.5)).toBeCloseTo(centreY);
    // A room fitted at less than one step out goes straight to the whole plan.
    expect(stepZoom({ scale: 1.3, txPercent: -10, tyPercent: -5 }, -1)).toEqual(IDENTITY_ZOOM);
  });
});

describe("clampView", () => {
  it("keeps the plan's edge outside the visible box", () => {
    expect(clampView({ scale: 2, txPercent: 30, tyPercent: -500 })).toEqual({
      scale: 2,
      txPercent: 0,
      tyPercent: -100,
    });
  });

  it("collapses the pan to nothing at the whole plan", () => {
    expect(clampView({ scale: 1, txPercent: -20, tyPercent: 10 })).toEqual(IDENTITY_ZOOM);
    expect(clampView({ scale: 0.5, txPercent: -20, tyPercent: 10 })).toEqual(IDENTITY_ZOOM);
  });

  it("never lets a non-finite value through to the style", () => {
    expect(clampView({ scale: NaN, txPercent: 0, tyPercent: 0 })).toEqual(IDENTITY_ZOOM);
    expect(clampView({ scale: 2, txPercent: Infinity, tyPercent: 0 })).toEqual(IDENTITY_ZOOM);
  });
});

describe("zoomAt", () => {
  it("keeps the point under the cursor still", () => {
    const from = { scale: 2, txPercent: -40, tyPercent: -30 };
    const v = zoomAt(from, 1.25, 0.2, 0.7);
    expect(under(v.txPercent, v.scale, 0.2)).toBeCloseTo(under(from.txPercent, from.scale, 0.2));
    expect(under(v.tyPercent, v.scale, 0.7)).toBeCloseTo(under(from.tyPercent, from.scale, 0.7));
  });

  it("ignores a nonsense factor", () => {
    const from = { scale: 2, txPercent: -40, tyPercent: -30 };
    expect(zoomAt(from, 0)).toEqual(from);
    expect(zoomAt(from, NaN)).toEqual(from);
  });
});

describe("panBy", () => {
  const view = { scale: 2, txPercent: -50, tyPercent: -50 };

  it("follows the pointer, in percent of the visible box", () => {
    // 40px right on a 400px-wide box is 10% of it.
    expect(panBy(view, 40, -30, 400, 300)).toEqual({ scale: 2, txPercent: -40, tyPercent: -60 });
  });

  it("stops at the plan's edge rather than dragging it off the card", () => {
    expect(panBy(view, 10_000, 10_000, 400, 300)).toEqual({ scale: 2, txPercent: 0, tyPercent: 0 });
    expect(panBy(view, -10_000, -10_000, 400, 300)).toEqual({ scale: 2, txPercent: -100, tyPercent: -100 });
  });

  it("does nothing at the whole plan or with no box to measure", () => {
    expect(panBy(IDENTITY_ZOOM, 50, 50, 400, 300)).toEqual(IDENTITY_ZOOM);
    expect(panBy(view, 50, 50, 0, 300)).toEqual(view);
  });

  it("needs no rotation term: the transform is already in display space", () => {
    // A room framed on a plan turned 90° comes back as a display-space
    // translate, so the same screen delta moves it the same way.
    const pts = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }];
    const turned = areaZoomTransform(pts, 1000, 600, 90);
    const moved = panBy(turned, 20, 0, 400, 300);
    expect(moved.txPercent - turned.txPercent).toBeCloseTo(5);
    expect(moved.tyPercent).toBeCloseTo(turned.tyPercent);
  });
});

describe("pastPanThreshold", () => {
  it("leaves a small wobble a tap", () => {
    expect(pastPanThreshold(3, 4)).toBe(false); // 5px
    expect(pastPanThreshold(0, 6)).toBe(true);
  });
});

describe("wheelZoomFactor", () => {
  it("zooms in on a wheel up and out on a wheel down", () => {
    expect(wheelZoomFactor(-50)).toBeGreaterThan(1);
    expect(wheelZoomFactor(50)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
  });

  it("caps one event at one button step", () => {
    expect(wheelZoomFactor(-10_000)).toBe(ZOOM_STEP);
    expect(wheelZoomFactor(10_000)).toBeCloseTo(1 / ZOOM_STEP);
    expect(wheelZoomFactor(-3, 1)).toBeGreaterThan(wheelZoomFactor(-3, 0));
    expect(wheelZoomFactor(NaN)).toBe(1);
  });
});
