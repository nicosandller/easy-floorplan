import { describe, expect, it } from "vitest";
import {
  mergeRectAreaSide,
  rectAreaEdgeModifierClass,
  rectAreaUnionPoints,
  splitRectAreaSide,
  toggleRectAreaSide,
} from "./area-tools";
import { rectAreaSideWallSegments, RECT_AREA_EPSILON } from "./editor-geometry";
import { signedArea } from "./dead-space";
import type { Area } from "./types";

function rectangleArea(): Area {
  return {
    id: "room1",
    points: [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 240 },
      { x: 100, y: 240 },
    ],
    showName: true,
  } as Area;
}

describe("toggleRectAreaSide interval targeting", () => {
  it("uses the full target interval for a fresh full-edge toggle", () => {
    const base = rectangleArea();

    const wall = toggleRectAreaSide(base, 2, 0.82, { start: 0, end: 1 });
    expect(wall).toBeDefined();
    expect(wall!.sideWalls?.bottom).toBe("wall");

    const divider = toggleRectAreaSide(wall!, 2, 0.82, { start: 0, end: 1 });
    expect(divider).toBeDefined();
    expect(divider!.sideWalls?.bottom).toBe("divider");

    const none = toggleRectAreaSide(divider!, 2, 0.82, { start: 0, end: 1 });
    expect(none).toBeDefined();
    expect(none!.sideWalls?.bottom).toBeUndefined();
  });

  it("fills the full interval when toggling an uncovered region on a segmented side", () => {
    const base = rectangleArea();
    base.sideWalls = {
      top: [{ start: 0.4, end: 0.6, state: "wall" }],
    };

    const updated = toggleRectAreaSide(base, 0, 0.1, { start: 0, end: 1 });
    expect(updated).toBeDefined();
    expect(updated!.sideWalls?.top).toBe("wall");
  });

  it("cycles the full interval when clicking inside an existing segment", () => {
    const base = rectangleArea();
    base.sideWalls = {
      top: [
        { start: 0.1, end: 0.3, state: "wall" },
        { start: 0.6, end: 0.8, state: "wall" },
      ],
    };

    const updated = toggleRectAreaSide(base, 0, 0.2, { start: 0, end: 1 });
    expect(updated).toBeDefined();
    expect(updated!.sideWalls?.top).toBe("wall");
  });
});

describe("toggleRectAreaSide without a target interval", () => {
  it("cycles the clicked segment's state when current is a segment array", () => {
    const base = rectangleArea();
    base.sideWalls = {
      top: [{ start: 0.1, end: 0.3, state: "wall" }],
    };

    const divider = toggleRectAreaSide(base, 0, 0.2);
    expect(divider).toBeDefined();
    expect(rectAreaSideWallSegments(divider!.sideWalls?.top)).toEqual([
      { start: 0.1, end: 0.3, state: "divider" },
    ]);

    const none = toggleRectAreaSide(divider!, 0, 0.2);
    expect(none).toBeDefined();
    expect(rectAreaSideWallSegments(none!.sideWalls?.top)).toEqual([]);
  });

  it("adds a new windowed segment when the click misses every existing segment", () => {
    const base = rectangleArea();
    base.sideWalls = {
      top: [{ start: 0.1, end: 0.3, state: "wall" }],
    };

    const updated = toggleRectAreaSide(base, 0, 0.7);
    expect(updated).toBeDefined();
    const segments = rectAreaSideWallSegments(updated!.sideWalls?.top);
    expect(segments).toHaveLength(2);
    expect(segments[1]!.state).toBe("wall");
    expect(segments[1]!.start).toBeCloseTo(0.55);
    expect(segments[1]!.end).toBeCloseTo(0.85);
  });

  it("cycles none -> wall -> divider -> none when current is a plain string", () => {
    const base = rectangleArea();

    const wall = toggleRectAreaSide(base, 2, 0.5);
    expect(wall).toBeDefined();
    expect(wall!.sideWalls?.bottom).toBe("wall");

    const divider = toggleRectAreaSide(wall!, 2, 0.5);
    expect(divider).toBeDefined();
    expect(divider!.sideWalls?.bottom).toBe("divider");

    const none = toggleRectAreaSide(divider!, 2, 0.5);
    expect(none).toBeDefined();
    expect(none!.sideWalls?.bottom).toBeUndefined();
  });
});

describe("splitRectAreaSide places the new segment at the clicked point", () => {
  it("splits a full-edge wall into three wall ranges without removing the rest", () => {
    const base = rectangleArea();
    base.sideWalls = { top: "wall" };

    const updated = splitRectAreaSide(base, 0, 0.5);
    expect(rectAreaSideWallSegments(updated!.sideWalls?.top)).toEqual([
      { start: 0, end: 0.35, state: "wall" },
      { start: 0.35, end: 0.65, state: "wall" },
      { start: 0.65, end: 1, state: "wall" },
    ]);
  });

  it("creates a segment containing the clicked point on a side with no existing wall", () => {
    const base = rectangleArea();

    const updated = splitRectAreaSide(base, 0, 0.2);
    expect(updated).toBeDefined();
    const segments = rectAreaSideWallSegments(updated!.sideWalls?.top);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.start).toBeLessThanOrEqual(0.2);
    expect(segments[0]!.end).toBeGreaterThanOrEqual(0.2);
  });

  it("creates a segment containing the clicked point near the end of the edge, not mirrored to the other end", () => {
    const base = rectangleArea();

    // A click near t=0.9 must produce a segment around t=0.9 — not one
    // mirrored across the midpoint to sit around t=0.1 (issue: a reversed
    // click-fraction bug did exactly that on some edges).
    const updated = splitRectAreaSide(base, 0, 0.9);
    const segments = rectAreaSideWallSegments(updated!.sideWalls?.top);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.start).toBeGreaterThan(0.5);
    expect(segments[0]!.end).toBeGreaterThan(0.5);
    expect(segments[0]!.start).toBeLessThanOrEqual(0.9);
    expect(segments[0]!.end).toBeGreaterThanOrEqual(0.9);
  });

  it("extends the clicked segment in place when the click lands inside an existing one", () => {
    const base = rectangleArea();
    base.sideWalls = { top: [{ start: 0.5, end: 0.7, state: "wall" }] };

    const updated = splitRectAreaSide(base, 0, 0.6);
    const segments = rectAreaSideWallSegments(updated!.sideWalls?.top);
    // Same state, overlapping window: normalizes back down to one segment
    // that still covers the clicked point, rather than a second one on top
    // of the first.
    expect(segments).toHaveLength(1);
    expect(segments[0]!.state).toBe("wall");
    expect(segments[0]!.start).toBeLessThanOrEqual(0.6);
    expect(segments[0]!.end).toBeGreaterThanOrEqual(0.6);
  });

  it("does not overlap or merge with an existing wall segment when clicking in the gap after it", () => {
    const base = rectangleArea();
    base.sideWalls = { top: [{ start: 0.5, end: 0.7, state: "wall" }] };

    // Default split span is 0.3, so an unclamped window centered on 0.75
    // would run from 0.6 to 0.9 — reaching back into the existing segment.
    const updated = splitRectAreaSide(base, 0, 0.75);
    const segments = rectAreaSideWallSegments(updated!.sideWalls?.top);
    expect(segments).toHaveLength(2);
    const [first, second] = segments;
    expect(first!.start).toBeCloseTo(0.5, 6);
    expect(first!.end).toBeCloseTo(0.7, 6);
    // The new segment must start at or after the existing one's end — never
    // inside it.
    expect(second!.start).toBeGreaterThanOrEqual(first!.end - RECT_AREA_EPSILON);
    expect(second!.end).toBeGreaterThanOrEqual(0.75);
  });

  it("does not overlap or merge with an existing divider segment when clicking in the gap before it", () => {
    const base = rectangleArea();
    base.sideWalls = { top: [{ start: 0.5, end: 0.7, state: "divider" }] };

    // Default span centered on 0.45 would run 0.3 to 0.6 — reaching into the
    // divider segment that follows.
    const updated = splitRectAreaSide(base, 0, 0.45);
    const segments = rectAreaSideWallSegments(updated!.sideWalls?.top);
    expect(segments).toHaveLength(2);
    const [first, second] = segments;
    expect(first!.state).toBe("wall");
    expect(first!.start).toBeLessThanOrEqual(0.45);
    expect(first!.end).toBeLessThanOrEqual(0.5);
    expect(second!.state).toBe("divider");
    expect(second!.start).toBeCloseTo(0.5, 6);
    expect(second!.end).toBeCloseTo(0.7, 6);
  });

  it("collapses to a sliver rather than overlapping either neighbor when clicking in a narrow gap", () => {
    const base = rectangleArea();
    base.sideWalls = {
      top: [
        { start: 0.4, end: 0.5, state: "wall" },
        { start: 0.55, end: 0.65, state: "divider" },
      ],
    };

    const updated = splitRectAreaSide(base, 0, 0.52);
    const segments = rectAreaSideWallSegments(updated!.sideWalls?.top);
    // The gap between the two neighbors (0.5 to 0.55) is narrower than the
    // default split span: the new segment must still not overlap either one.
    const newSegment = segments.find((segment) => segment.start >= 0.5 - RECT_AREA_EPSILON && segment.end <= 0.55 + RECT_AREA_EPSILON);
    expect(newSegment).toBeDefined();
    expect(newSegment!.start).toBeGreaterThanOrEqual(0.5 - RECT_AREA_EPSILON);
    expect(newSegment!.end).toBeLessThanOrEqual(0.55 + RECT_AREA_EPSILON);
  });
});

describe("rectAreaUnionPoints", () => {
  it("merges two edge-adjacent rectangles into their bounding rectangle", () => {
    const a = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
    const b = [{ x: 20, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 20, y: 10 }];

    const merged = rectAreaUnionPoints(a, b);
    expect(merged).toBeDefined();
    expect(merged).toHaveLength(4);
    expect(Math.abs(signedArea(merged!))).toBeCloseTo(400);
    const xs = merged!.map((p) => p.x);
    const ys = merged!.map((p) => p.y);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(40);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(10);
  });

  it("returns undefined when the combined points don't span at least two x or y values", () => {
    const point = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    expect(rectAreaUnionPoints(point, point)).toBeUndefined();
  });
});

describe("mergeRectAreaSide", () => {
  const roomA: Area = {
    id: "a",
    haArea: "living-room",
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    sideWalls: { top: "wall", right: "divider" },
  } as Area;
  const roomB: Area = {
    id: "b",
    haArea: "living-room",
    points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }],
    sideWalls: { left: "wall", right: "wall", bottom: "divider" },
  } as Area;

  it("preserves and reprojects both rooms' exterior walls/dividers while dropping the shared side", () => {
    const merged = mergeRectAreaSide(roomA, 1, [roomA, roomB]);
    expect(merged).toHaveLength(1);
    expect(merged![0]!.sideWalls).toEqual({
      top: [{ start: 0, end: 0.5, state: "wall" }],
      right: "wall",
      bottom: [{ start: 0.5, end: 1, state: "divider" }],
    });
    expect(merged![0]!.points).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ]);
  });

  it("does not join through a different edge than the one clicked", () => {
    expect(mergeRectAreaSide(roomA, 2, [roomA, roomB])).toBeUndefined();
    expect(mergeRectAreaSide(roomA, 3, [roomA, roomB])).toBeUndefined();
    expect(rectAreaEdgeModifierClass(roomA, 2, [roomA, roomB], "join")).toBe("modifier-invalid");
    expect(rectAreaEdgeModifierClass(roomA, 3, [roomA, roomB], "join")).toBe("modifier-invalid");
  });

  it("allows joining adjacent rooms when neither is linked to a Home Assistant area", () => {
    const unlinkedA = { ...roomA, haArea: undefined, sideWalls: undefined };
    const unlinkedB = { ...roomB, haArea: undefined, sideWalls: undefined };
    expect(mergeRectAreaSide(unlinkedA, 1, [unlinkedA, unlinkedB])).toHaveLength(1);
  });

  it("does not join rooms linked to different Home Assistant areas", () => {
    const otherArea = { ...roomB, haArea: "kitchen" };
    expect(mergeRectAreaSide(roomA, 1, [roomA, otherArea])).toBeUndefined();
  });

  it("keeps exterior segments on partial-overlap L-shaped merges by side orientation", () => {
    const a: Area = {
      id: "a",
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      sideWalls: { right: "divider", bottom: "wall" },
    } as Area;
    const b: Area = {
      id: "b",
      points: [{ x: 100, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 150 }, { x: 100, y: 150 }],
      sideWalls: { left: "wall", top: "wall", right: "wall", bottom: "divider" },
    } as Area;

    const merged = mergeRectAreaSide(a, 1, [a, b]);
    expect(merged).toHaveLength(1);
    expect(merged![0]!.sideWalls).toEqual({
      top: [{ start: 0.5, end: 1, state: "wall" }],
      right: [{ start: 1 / 3, end: 1, state: "wall" }],
      bottom: [
        { start: 0, end: 0.5, state: "wall" },
        { start: 0.5, end: 1, state: "divider" },
      ],
    });
  });

  it("does not advertise polygon joins that mergeRectAreaSide cannot perform", () => {
    const polygon: Area = {
      id: "polygon",
      haArea: "living-room",
      points: [
        { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 },
        { x: 150, y: 100 }, { x: 150, y: 50 }, { x: 100, y: 50 },
      ],
    } as Area;
    const areas = [roomA, polygon];
    expect(rectAreaEdgeModifierClass(roomA, 1, areas, "join")).toBe("modifier-invalid");
    expect(mergeRectAreaSide(roomA, 1, areas)).toBeUndefined();
  });
});
