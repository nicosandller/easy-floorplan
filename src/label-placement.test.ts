import { describe, expect, it } from "vitest";
import {
  AUTO_LABEL_ORDER,
  LABEL_STICKINESS,
  areaOutside,
  autoLabelKey,
  boxOverlap,
  chooseLabelSide,
  intersectBoxes,
  labelCandidates,
  placeAutoLabels,
  scoreLabelBox,
  segmentOverlap,
  type Box,
  type LabelObstacles,
} from "./label-placement";

const none: LabelObstacles = { walls: [], openings: [], badges: [], labels: [] };
const badge: Box = { x: 100, y: 100, w: 30, h: 30 };
const label = { w: 60, h: 14 };
const gap = { below: 2, side: 4 };

describe("labelCandidates", () => {
  it("hangs each side off the badge with the stylesheet's gaps", () => {
    const c = labelCandidates(badge, label, gap);
    expect(c.below).toEqual({ x: 85, y: 132, w: 60, h: 14 });
    expect(c.above).toEqual({ x: 85, y: 84, w: 60, h: 14 });
    expect(c.right).toEqual({ x: 134, y: 108, w: 60, h: 14 });
    expect(c.left).toEqual({ x: 36, y: 108, w: 60, h: 14 });
  });

  it("centres a label-only device's below on its point", () => {
    expect(labelCandidates(badge, label, gap, true).below).toEqual({ x: 85, y: 108, w: 60, h: 14 });
  });
});

describe("overlap measures", () => {
  it("boxOverlap and areaOutside", () => {
    expect(boxOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(25);
    expect(boxOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(0);
    expect(areaOutside({ x: -5, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 100, h: 100 })).toBe(50);
    expect(intersectBoxes({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 })).toEqual({ x: 20, y: 0, w: 0, h: 5 });
  });

  it("segmentOverlap is the band's area inside the box, exactly", () => {
    const r = { x: 0, y: 0, w: 100, h: 20 };
    // A horizontal wall 8 wide straight through the box.
    expect(segmentOverlap(r, { x1: -50, y1: 10, x2: 150, y2: 10, half: 4 })).toBeCloseTo(800);
    // Butt ends: a wall stopping half way covers half as much.
    expect(segmentOverlap(r, { x1: -50, y1: 10, x2: 50, y2: 10, half: 4 })).toBeCloseTo(400);
    // A diagonal costs what it covers, not its bounding box.
    const diag = segmentOverlap({ x: 0, y: 0, w: 100, h: 100 }, { x1: 0, y1: 0, x2: 100, y2: 100, half: 2 });
    expect(diag).toBeGreaterThan(4 * Math.SQRT2 * 100 * 0.9);
    expect(diag).toBeLessThan(4 * Math.SQRT2 * 100);
    expect(segmentOverlap(r, { x1: 0, y1: 50, x2: 100, y2: 50, half: 4 })).toBe(0);
    expect(segmentOverlap(r, { x1: 0, y1: 10, x2: 0, y2: 10, half: 4 })).toBe(0);
  });
});

describe("chooseLabelSide", () => {
  const scores = (below: number, right: number, left: number, above: number) => ({ below, right, left, above });

  it("takes the cheapest side", () => {
    expect(chooseLabelSide(scores(50, 10, 0, 0))).toBe("left");
    expect(chooseLabelSide(scores(50, 10, 20, 5))).toBe("above");
  });

  it("breaks ties below → right → left → above", () => {
    expect(AUTO_LABEL_ORDER).toEqual(["below", "right", "left", "above"]);
    expect(chooseLabelSide(scores(0, 0, 0, 0))).toBe("below");
    expect(chooseLabelSide(scores(9, 3, 3, 3))).toBe("right");
    expect(chooseLabelSide(scores(9, 9, 3, 3))).toBe("left");
  });

  it("keeps the current side unless another is better by the margin", () => {
    expect(chooseLabelSide(scores(10, 5, 50, 50), "below", 6)).toBe("below");
    expect(chooseLabelSide(scores(10, 3, 50, 50), "below", 6)).toBe("right");
    // An equal score never moves it, even with no margin at all.
    expect(chooseLabelSide(scores(5, 5, 50, 50), "right", 0)).toBe("right");
  });
});

describe("scoreLabelBox", () => {
  const box = { x: 0, y: 0, w: 10, h: 10 };

  it("weighs a badge or label over a wall, and the plan edge over both", () => {
    const wall = scoreLabelBox(box, { ...none, walls: [{ x1: -10, y1: 5, x2: 20, y2: 5, half: 5 }] });
    const badgeCost = scoreLabelBox(box, { ...none, badges: [box] });
    const labelCost = scoreLabelBox(box, { ...none, labels: [box] });
    const outside = scoreLabelBox(box, { ...none, bounds: { x: 100, y: 100, w: 10, h: 10 } });
    expect(wall).toBeCloseTo(100);
    expect(badgeCost).toBeGreaterThan(wall);
    expect(labelCost).toBe(badgeCost);
    expect(outside).toBeGreaterThan(badgeCost);
    expect(scoreLabelBox(box, { ...none, bounds: { x: -1, y: -1, w: 20, h: 20 } })).toBe(0);
  });
});

describe("placeAutoLabels", () => {
  const entry = (key: string, b: Box, current?: "below" | "right" | "left" | "above") => ({
    key, badge: b, label, gap, current,
  });

  it("moves a label off a wall it would cover below", () => {
    // A wall 8 thick running just under the badge.
    const walls = [{ x1: 0, y1: 140, x2: 400, y2: 140, half: 4 }];
    const out = placeAutoLabels([entry("a", badge)], [{ key: "a", box: badge }], { walls, openings: [], labels: [] });
    expect(out.get("a")).toBe("right");
  });

  it("stays below on an open plan, and never counts its own badge", () => {
    const out = placeAutoLabels([entry("a", badge)], [{ key: "a", box: badge }], { walls: [], openings: [], labels: [] });
    expect(out.get("a")).toBe("below");
  });

  it("treats labels placed earlier as obstacles, in plan order", () => {
    // Two badges side by side, walls just above and below both, and the plan
    // ending just right of the second.
    const a = { x: 100, y: 100, w: 30, h: 30 };
    const b = { x: 240, y: 100, w: 30, h: 30 };
    const fixed = {
      walls: [
        { x1: 0, y1: 140, x2: 400, y2: 140, half: 4 },
        { x1: 0, y1: 90, x2: 400, y2: 90, half: 4 },
      ],
      openings: [],
      labels: [],
      bounds: { x: 0, y: 0, w: 300, h: 300 },
    };
    const badges = [{ key: "a", box: a }, { key: "b", box: b }];
    // Alone, b's clear side is left…
    expect(placeAutoLabels([entry("b", b)], badges, fixed).get("b")).toBe("left");
    // …but a goes first and takes right, which is where b's left would land.
    const out = placeAutoLabels([entry("a", a), entry("b", b)], badges, fixed);
    expect(out.get("a")).toBe("right");
    expect(out.get("b")).toBe("below");
  });

  it("is deterministic and sticky", () => {
    const walls = [{ x1: 0, y1: 140, x2: 400, y2: 140, half: 4 }];
    const fixed = { walls, openings: [], labels: [] };
    const run = () => placeAutoLabels([entry("a", badge)], [{ key: "a", box: badge }], fixed).get("a");
    expect(run()).toBe(run());
    // A label already above, where right is free too: equal cost, so it stays.
    const stay = placeAutoLabels([entry("a", badge, "above")], [{ key: "a", box: badge }], fixed);
    expect(stay.get("a")).toBe("above");
    // Below on the wall costs far more than the stickiness margin, so it moves.
    expect(LABEL_STICKINESS * label.w * label.h).toBeLessThan(label.w * 8);
    const move = placeAutoLabels([entry("a", badge, "below")], [{ key: "a", box: badge }], fixed);
    expect(move.get("a")).toBe("right");
  });

  it("stays inside the visible plan", () => {
    // A badge on the right edge with a wall under it: right would leave the plan.
    const edge = { x: 370, y: 100, w: 30, h: 30 };
    const walls = [{ x1: 0, y1: 140, x2: 400, y2: 140, half: 4 }];
    const out = placeAutoLabels([entry("a", edge)], [{ key: "a", box: edge }], {
      walls, openings: [], labels: [], bounds: { x: 0, y: 0, w: 400, h: 300 },
    });
    expect(out.get("a")).toBe("left");
  });
});

describe("autoLabelKey", () => {
  it("is the id, or what an id-less item is bound to and where", () => {
    expect(autoLabelKey({ id: "lamp", x: 1, y: 2 })).toBe("lamp");
    expect(autoLabelKey({ id: "", entity: "light.a", x: 1, y: 2 })).toBe("light.a@1,2");
  });
});
