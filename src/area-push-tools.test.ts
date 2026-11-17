import { describe, expect, it } from "vitest";
import {
  coupleRectAreaSharedEdges,
  coupleSharedBoundarySegment,
  coupledEdgeResize,
  moveAreaBoundary,
  rectAreasOverlap,
} from "./area-push-tools";
import type { Area } from "./types";

function area(id: string, points: Array<{ x: number; y: number }>): Area {
  return { id, points } as Area;
}

describe("rectAreasOverlap", () => {
  it("does not treat pure shared boundaries as overlap", () => {
    const left = area("left", [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ]);
    const right = area("right", [
      { x: 20, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 20, y: 20 },
    ]);
    expect(rectAreasOverlap(left, right)).toBe(false);
  });

  it("does not treat an L-shape notch occupant as overlapping", () => {
    const lShape = area("l", [
      { x: 500, y: 100 },
      { x: 620, y: 100 },
      { x: 620, y: 160 },
      { x: 560, y: 160 },
      { x: 560, y: 300 },
      { x: 500, y: 300 },
    ]);
    const notchOccupant = area("notch", [
      { x: 580, y: 210 },
      { x: 610, y: 210 },
      { x: 610, y: 260 },
      { x: 580, y: 260 },
    ]);
    expect(rectAreasOverlap(lShape, notchOccupant)).toBe(false);
  });

  it("still detects true interior overlap for concave polygons", () => {
    const lShape = area("l", [
      { x: 500, y: 100 },
      { x: 620, y: 100 },
      { x: 620, y: 160 },
      { x: 560, y: 160 },
      { x: 560, y: 300 },
      { x: 500, y: 300 },
    ]);
    const intruding = area("intruding", [
      { x: 520, y: 240 },
      { x: 550, y: 240 },
      { x: 550, y: 280 },
      { x: 520, y: 280 },
    ]);
    expect(rectAreasOverlap(lShape, intruding)).toBe(true);
  });

  it("detects overlap when a rectangle intersects only part of an L arm", () => {
    const movedL = area("l", [
      { x: 544.5, y: 120 },
      { x: 744.5, y: 120 },
      { x: 744.5, y: 180 },
      { x: 624.5, y: 180 },
      { x: 624.5, y: 340 },
      { x: 544.5, y: 340 },
    ]);
    const blocker = area("blocker", [
      { x: 590, y: 220 },
      { x: 630, y: 220 },
      { x: 630, y: 300 },
      { x: 590, y: 300 },
    ]);
    expect(rectAreasOverlap(movedL, blocker)).toBe(true);
  });
});

describe("moveAreaBoundary", () => {
  it("moves only the vertices on the given side's boundary", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ];
    const moved = moveAreaBoundary(points, { dx: 5, dy: 0 }, "right");
    expect(moved).toEqual([
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 25, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  it("returns undefined when there is no moving side", () => {
    const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
    expect(moveAreaBoundary(points, { dx: 5, dy: 0 })).toBeUndefined();
  });

  it("moves only the later copy of a coincident vertex pair, leaving the earlier one in place", () => {
    // The editor inserts a duplicate vertex at a boundary split point. Only
    // one copy should travel with the moved boundary — the earlier one (by
    // backward scan) stays put so an adjacent, unrelated run of the same
    // boundary keeps its own position.
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ];
    const moved = moveAreaBoundary(points, { dx: 0, dy: 5 }, "top", 0);
    expect(moved).toEqual([
      { x: 0, y: 5 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 5 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ]);
  });
});

describe("coupleSharedBoundarySegment", () => {
  it("carries a neighbor's coincident edge along with the moving one", () => {
    const primary = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ];
    const other = [
      { x: 20, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 10 },
      { x: 20, y: 10 },
    ];
    const coupled = coupleSharedBoundarySegment(primary, other, { dx: 5, dy: 0 }, "right");
    expect(coupled).toEqual([
      { x: 25, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 10 },
      { x: 25, y: 10 },
    ]);
  });

  it("returns undefined when the two areas don't share the moving boundary", () => {
    const primary = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
    const farAway = [{ x: 100, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 10 }, { x: 100, y: 10 }];
    expect(coupleSharedBoundarySegment(primary, farAway, { dx: 5, dy: 0 }, "right")).toBeUndefined();
  });

  it("returns undefined for a zero delta", () => {
    const primary = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
    const other = [{ x: 20, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 20, y: 10 }];
    expect(coupleSharedBoundarySegment(primary, other, { dx: 0, dy: 0 }, "right")).toBeUndefined();
  });
});

describe("coupleRectAreaSharedEdges", () => {
  it("moves the primary area and couples its neighbor's shared edge", () => {
    const primary = area("primary", [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ]);
    const neighbor = area("neighbor", [
      { x: 20, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 10 },
      { x: 20, y: 10 },
    ]);

    const result = coupleRectAreaSharedEdges(
      "primary",
      primary.points,
      { dx: 5, dy: 0 },
      [primary, neighbor],
      "right"
    );

    expect(result.coupledIds).toEqual(new Set(["neighbor"]));
    const updatedPrimary = result.areas.find((a) => a.id === "primary")!;
    const updatedNeighbor = result.areas.find((a) => a.id === "neighbor")!;
    expect(updatedPrimary.points.map((p) => p.x)).toEqual([0, 25, 25, 0]);
    expect(updatedNeighbor.points.map((p) => p.x)).toEqual([25, 40, 40, 25]);
  });

  it("leaves unrelated areas untouched", () => {
    const primary = area("primary", [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }]);
    const unrelated = area("unrelated", [{ x: 100, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 10 }, { x: 100, y: 10 }]);

    const result = coupleRectAreaSharedEdges("primary", primary.points, { dx: 5, dy: 0 }, [primary, unrelated], "right");

    expect(result.coupledIds.size).toBe(0);
    expect(result.areas.find((a) => a.id === "unrelated")).toEqual(unrelated);
  });
});

describe("coupledEdgeResize", () => {
  it("applies the full delta when nothing blocks the coupled pair", () => {
    const primary = area("primary", [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }]);
    const neighbor = area("neighbor", [{ x: 20, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 20, y: 10 }]);

    const result = coupledEdgeResize("primary", primary, { dx: 5, dy: 0 }, [primary, neighbor], "right");

    expect(result.delta).toEqual({ dx: 5, dy: 0 });
    const updatedNeighbor = result.areas.find((a) => a.id === "neighbor")!;
    expect(Math.min(...updatedNeighbor.points.map((p) => p.x))).toBeCloseTo(25);
  });

  it("collapses to no movement when the coupled pair would overlap an obstacle at any scale", () => {
    const primary = area("primary", [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }]);
    const neighbor = area("neighbor", [{ x: 20, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 20, y: 10 }]);
    // Sits inside the primary/neighbor pair's combined footprint, which is
    // invariant under this move (the shared edge just slides between them) —
    // so it overlaps one of the two at every scale, and the safe fraction
    // the binary search converges on is ~0.
    const obstacle = area("obstacle", [{ x: 25, y: 0 }, { x: 35, y: 0 }, { x: 35, y: 10 }, { x: 25, y: 10 }]);

    const result = coupledEdgeResize(
      "primary",
      primary,
      { dx: 10, dy: 0 },
      [primary, neighbor, obstacle],
      "right"
    );

    expect(Math.abs(result.delta.dx)).toBeLessThan(0.01);
  });
});
