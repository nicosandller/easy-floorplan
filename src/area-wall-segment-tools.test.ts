import { describe, expect, it } from "vitest";
import {
  MIN_WALL_SEGMENT_SPAN,
  applyAreaWallSegmentDrag,
  removeAreaWallSegment,
  type AreaWallSegmentDrag,
} from "./area-wall-segment-tools";
import { rectAreaSideWallSegments } from "./editor-geometry";
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

function baseDrag(overrides: Partial<AreaWallSegmentDrag> = {}): AreaWallSegmentDrag {
  return {
    areaId: "room1",
    side: "top",
    segmentIndex: 0,
    mode: "segment",
    start: 0.2,
    end: 0.5,
    state: "wall",
    ...overrides,
  };
}

describe("applyAreaWallSegmentDrag", () => {
  it("slides a whole segment by the move fraction of the side's length", () => {
    const area = rectangleArea();
    area.sideWalls = { top: [{ start: 0.2, end: 0.5, state: "wall" }] };

    // Top side spans x 100-300 (length 200); moving 20 units is a 10% shift.
    const updated = applyAreaWallSegmentDrag(area, baseDrag(), 20, 0);
    expect(updated).toBeDefined();
    const segment = (updated!.sideWalls!.top as Array<{ start: number; end: number }>)[0]!;
    expect(segment.start).toBeCloseTo(0.3);
    expect(segment.end).toBeCloseTo(0.6);
  });

  it("clamps a dragged segment at the start of the side, preserving its width", () => {
    const area = rectangleArea();
    area.sideWalls = { top: [{ start: 0.2, end: 0.5, state: "wall" }] };

    const updated = applyAreaWallSegmentDrag(area, baseDrag(), -100, 0);
    const segment = (updated!.sideWalls!.top as Array<{ start: number; end: number }>)[0]!;
    expect(segment.start).toBeCloseTo(0);
    expect(segment.end).toBeCloseTo(0.3);
  });

  it("clamps a dragged segment at the end of the side, preserving its width", () => {
    const area = rectangleArea();
    area.sideWalls = { top: [{ start: 0.2, end: 0.5, state: "wall" }] };

    const updated = applyAreaWallSegmentDrag(area, baseDrag(), 100, 0);
    const segment = (updated!.sideWalls!.top as Array<{ start: number; end: number }>)[0]!;
    expect(segment.start).toBeCloseTo(0.7);
    expect(segment.end).toBeCloseTo(1);
  });

  it("clamps a divider at a neighboring wall instead of overwriting it after sorting", () => {
    const area = {
      ...rectangleArea(),
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      sideWalls: {
        top: [
          { start: 0.1, end: 0.3, state: "wall" as const },
          { start: 0.6, end: 0.8, state: "divider" as const },
        ],
      },
    } as Area;

    const moved = applyAreaWallSegmentDrag(
      area,
      baseDrag({ segmentIndex: 1, start: 0.6, end: 0.8, state: "divider" }),
      -55,
      0
    )!;
    const sorted = rectAreaSideWallSegments(moved.sideWalls?.top);
    expect(sorted).toEqual([
      { start: 0.1, end: 0.3, state: "wall" },
      { start: 0.3, end: 0.5, state: "divider" },
    ]);

    const movedAgain = applyAreaWallSegmentDrag(
      moved,
      baseDrag({ segmentIndex: 1, start: 0.3, end: 0.5, state: "divider" }),
      -1,
      0
    )!;
    expect(rectAreaSideWallSegments(movedAgain.sideWalls?.top)).toEqual(sorted);
  });

  it("drags only the start edge, never crossing the end minus the minimum span", () => {
    const area = rectangleArea();
    area.sideWalls = { top: [{ start: 0.2, end: 0.5, state: "wall" }] };

    const updated = applyAreaWallSegmentDrag(area, baseDrag({ mode: "start" }), 100, 0);
    const segment = (updated!.sideWalls!.top as Array<{ start: number; end: number }>)[0]!;
    expect(segment.start).toBeCloseTo(0.5 - MIN_WALL_SEGMENT_SPAN);
    expect(segment.end).toBe(0.5);
  });

  it("drags only the end edge, never crossing the start plus the minimum span", () => {
    const area = rectangleArea();
    area.sideWalls = { top: [{ start: 0.2, end: 0.5, state: "wall" }] };

    const updated = applyAreaWallSegmentDrag(area, baseDrag({ mode: "end" }), -100, 0);
    const segment = (updated!.sideWalls!.top as Array<{ start: number; end: number }>)[0]!;
    expect(segment.start).toBe(0.2);
    expect(segment.end).toBeCloseTo(0.2 + MIN_WALL_SEGMENT_SPAN);
  });

  it("returns undefined when the segment index doesn't exist", () => {
    const area = rectangleArea();
    area.sideWalls = { top: [{ start: 0.2, end: 0.5, state: "wall" }] };

    expect(applyAreaWallSegmentDrag(area, baseDrag({ segmentIndex: 3 }), 20, 0)).toBeUndefined();
  });

  it("returns undefined when the side has no length to drag along", () => {
    const area = { ...rectangleArea(), points: [] };
    expect(applyAreaWallSegmentDrag(area, baseDrag(), 20, 0)).toBeUndefined();
  });
});

describe("removeAreaWallSegment", () => {
  it("drops one segment but keeps the rest as a segment array", () => {
    const area = rectangleArea();
    area.sideWalls = {
      top: [
        { start: 0.1, end: 0.3, state: "wall" },
        { start: 0.6, end: 0.8, state: "divider" },
      ],
    };

    const updated = removeAreaWallSegment(area, "top", 0);
    expect(updated).toBeDefined();
    expect(updated!.sideWalls?.top).toEqual([{ start: 0.6, end: 0.8, state: "divider" }]);
  });

  it("collapses to a plain string when the one remaining segment spans the full side", () => {
    const area = rectangleArea();
    area.sideWalls = {
      top: [
        { start: 0, end: 1, state: "wall" },
        { start: 0.4, end: 0.6, state: "divider" },
      ],
    };

    const updated = removeAreaWallSegment(area, "top", 1);
    expect(updated!.sideWalls?.top).toBe("wall");
  });

  it("deletes the side entirely once its last segment is removed", () => {
    const area = rectangleArea();
    area.sideWalls = { top: [{ start: 0.2, end: 0.5, state: "wall" }] };

    const updated = removeAreaWallSegment(area, "top", 0);
    expect(updated!.sideWalls?.top).toBeUndefined();
  });

  it("returns undefined when the side has no segments to remove", () => {
    const area = rectangleArea();
    expect(removeAreaWallSegment(area, "top", 0)).toBeUndefined();
  });
});
