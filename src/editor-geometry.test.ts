import { describe, it, expect } from "vitest";
import {
  nearestCorner,
  nearestAreaSnapPoint,
  pointInPolygon,
  areaContainingPoint,
  layoutPointsInPolygon,
  snapWallEnd,
  elementsInRect,
  applyDelta,
  attachedCorners,
} from "./editor-geometry";
import type { OrigPos } from "./editor-geometry";
import type { Area, Floor, Wall } from "./types";

const walls = [{ x1: 0, y1: 0, x2: 100, y2: 0 }];

describe("nearestCorner", () => {
  it("finds an endpoint within range", () => {
    expect(nearestCorner(walls, 3, 4, 26)).toEqual({ x: 0, y: 0 });
  });

  it("returns null when out of range", () => {
    expect(nearestCorner(walls, 50, 50, 26)).toBeNull();
  });

  it("prefers the closest endpoint", () => {
    expect(nearestCorner(walls, 95, 2, 26)).toEqual({ x: 100, y: 0 });
  });
});

describe("snapWallEnd", () => {
  const snap = (v: number) => Math.round(v / 10) * 10;

  it("snaps flat to horizontal within the axis-gravity angle", () => {
    expect(snapWallEnd(walls, 0, 50, 80, 53, snap, false, 10)).toEqual({ x: 80, y: 50 });
  });

  it("snaps flat to vertical within the axis-gravity angle", () => {
    expect(snapWallEnd(walls, 0, 50, 3, 120, snap, false, 10)).toEqual({ x: 0, y: 120 });
  });

  it("keeps the free angle outside the gravity zone", () => {
    expect(snapWallEnd(walls, 0, 0, 52, 48, snap, false, 10)).toEqual({ x: 50, y: 50 });
  });

  it("an existing corner beats axis gravity", () => {
    expect(snapWallEnd(walls, 0, 50, 98, 3, snap, false, 10)).toEqual({ x: 100, y: 0 });
  });

  it("free mode only grid-snaps (corners and axes ignored)", () => {
    expect(snapWallEnd(walls, 0, 0, 52, 48, snap, true, 10)).toEqual({ x: 50, y: 50 });
    // (95, 12) is within corner-snap range of (100, 0): free mode must ignore
    // the corner and yield the plain grid snap instead.
    expect(snapWallEnd(walls, 0, 50, 95, 12, snap, true, 10)).toEqual({ x: 100, y: 10 });
  });
});

const floor = {
  id: "f",
  name: "F",
  walls: [{ id: "w", x1: 0, y1: 0, x2: 100, y2: 0 }],
  openings: [{ id: "o", type: "door", x: 10, y: 10 }],
  items: [{ id: "i", kind: "light", x: 200, y: 200, entity: "light.a" }],
  texts: [],
  furniture: [],
  trackers: [{ id: "t", x: 0, y: 0, w: 20, h: 20 }],
} as unknown as Floor;

describe("elementsInRect", () => {
  it("selects wall by midpoint, tracker by center, point elements by anchor", () => {
    const hits = elementsInRect(floor, { x0: 0, y0: 0, x1: 60, y1: 60 });
    expect(hits).toEqual([
      { kind: "wall", id: "w" },
      { kind: "opening", id: "o" },
      { kind: "tracker", id: "t" },
    ]);
  });

  it("handles inverted rects", () => {
    const hits = elementsInRect(floor, { x0: 60, y0: 60, x1: 0, y1: 0 });
    expect(hits.length).toBe(3);
  });
});

describe("applyDelta", () => {
  it("translates only snapshotted elements; walls by all four coords", () => {
    const f = {
      id: "f",
      name: "F",
      walls: [
        { id: "w", x1: 0, y1: 0, x2: 100, y2: 0 },
        { id: "w2", x1: 5, y1: 5, x2: 6, y2: 6 },
      ],
      openings: [],
      items: [],
      texts: [],
      furniture: [],
      trackers: [],
    } as unknown as Floor;
    const orig = new Map<string, OrigPos>([
      ["wall:w", { kind: "wall", x1: 0, y1: 0, x2: 100, y2: 0 }],
    ]);
    const out = applyDelta(f, 10, 20, orig);
    expect(out.walls![0]).toMatchObject({ x1: 10, y1: 20, x2: 110, y2: 20 });
    expect(out.walls![1]).toMatchObject({ x1: 5, y1: 5 });
  });

  it("translates point elements from their snapshot, not their current position", () => {
    const f = {
      ...floor,
      openings: [{ id: "o", type: "door", x: 999, y: 999 }],
    } as unknown as Floor;
    const orig = new Map<string, OrigPos>([["opening:o", { kind: "pt", x: 10, y: 10 }]]);
    const out = applyDelta(f, 5, 5, orig);
    expect(out.openings![0]).toMatchObject({ x: 15, y: 15 });
  });
});

describe("attachedCorners (issue #30: stretch-drag shared room corners)", () => {
  // A closed rectangle drawn as four walls sharing corners.
  const room: Wall[] = [
    { id: "n", x1: 0, y1: 0, x2: 100, y2: 0 },
    { id: "e", x1: 100, y1: 0, x2: 100, y2: 80 },
    { id: "s", x1: 100, y1: 80, x2: 0, y2: 80 },
    { id: "w", x1: 0, y1: 80, x2: 0, y2: 0 },
  ];

  it("endpoint drag: finds only the walls sharing the grabbed corner", () => {
    // Grabbing the north wall's second endpoint (100, 0) — shared with east's first.
    const out = attachedCorners(room, "n", 2);
    expect(out).toEqual([{ id: "e", end: 1, which: 2, x0: 100, y0: 0 }]);
  });

  it("whole-wall drag: finds neighbors at both corners, tagged per corner", () => {
    const out = attachedCorners(room, "n");
    expect(out).toEqual([
      { id: "e", end: 1, which: 2, x0: 100, y0: 0 },
      { id: "w", end: 2, which: 1, x0: 0, y0: 0 },
    ]);
  });

  it("tolerates near-coincident corners within the epsilon only", () => {
    const sloppy: Wall[] = [
      { id: "a", x1: 0, y1: 0, x2: 100, y2: 0 },
      { id: "b", x1: 100.5, y1: 0.5, x2: 100, y2: 80 }, // ~0.7 away — attached
      { id: "c", x1: 103, y1: 0, x2: 100, y2: 80 }, // 3 away — separate wall
    ];
    const out = attachedCorners(sloppy, "a", 2);
    expect(out).toEqual([{ id: "b", end: 1, which: 2, x0: 100.5, y0: 0.5 }]);
  });

  it("returns undefined for a free-standing wall or unknown id", () => {
    expect(attachedCorners(room, "missing")).toBeUndefined();
    const lone: Wall[] = [
      { id: "a", x1: 0, y1: 0, x2: 100, y2: 0 },
      { id: "b", x1: 500, y1: 500, x2: 600, y2: 500 },
    ];
    expect(attachedCorners(lone, "a")).toBeUndefined();
  });

  it("can attach both endpoints of the same neighbor (duplicated wall)", () => {
    const doubled: Wall[] = [
      { id: "a", x1: 0, y1: 0, x2: 100, y2: 0 },
      { id: "b", x1: 0, y1: 0, x2: 100, y2: 0 },
    ];
    expect(attachedCorners(doubled, "a")).toEqual([
      { id: "b", end: 1, which: 1, x0: 0, y0: 0 },
      { id: "b", end: 2, which: 2, x0: 100, y0: 0 },
    ]);
  });
});

describe("pointInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("detects points inside/outside a convex quad", () => {
    expect(pointInPolygon(square, 5, 5)).toBe(true);
    expect(pointInPolygon(square, 50, 50)).toBe(false);
  });

  it("handles a concave (L-shaped) polygon", () => {
    // An L: a 10x10 square with its top-right 5x5 quadrant notched out.
    const L = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon(L, 2, 2)).toBe(true); // main body
    expect(pointInPolygon(L, 8, 8)).toBe(false); // inside the notched-out corner
    expect(pointInPolygon(L, 8, 2)).toBe(true); // the lower-right arm
  });

  it("rejects a point clearly outside the bounding box", () => {
    expect(pointInPolygon(square, -100, -100)).toBe(false);
  });
});

describe("areaContainingPoint", () => {
  const a1: Area = {
    id: "a1",
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  };
  const a2: Area = {
    id: "a2",
    points: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }],
  };

  it("finds the area containing a point, else undefined", () => {
    expect(areaContainingPoint({ areas: [a1] }, 3, 3)?.id).toBe("a1");
    expect(areaContainingPoint({ areas: [a1] }, 50, 50)).toBeUndefined();
  });

  it("overlapping areas: last-drawn (array order) wins", () => {
    expect(areaContainingPoint({ areas: [a1, a2] }, 7, 7)?.id).toBe("a2");
    expect(areaContainingPoint({ areas: [a2, a1] }, 7, 7)?.id).toBe("a1");
  });
});

describe("nearestAreaSnapPoint", () => {
  it("matches a wall corner", () => {
    expect(nearestAreaSnapPoint({ walls, areas: [] }, 3, 4, 26)).toEqual({ x: 0, y: 0 });
  });

  it("matches another area's vertex", () => {
    const areas: Area[] = [{ id: "a1", points: [{ x: 50, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 60 }] }];
    expect(nearestAreaSnapPoint({ walls: [], areas }, 52, 51, 26)).toEqual({ x: 50, y: 50 });
  });

  it("ignores the excluded vertex, falling back to the next-closest candidate", () => {
    const a: Area = { id: "a1", points: [{ x: 50, y: 50 }, { x: 53, y: 50 }] };
    const f = { walls: [], areas: [a] };
    expect(nearestAreaSnapPoint(f, 51, 50, 26)).toEqual({ x: 50, y: 50 });
    expect(nearestAreaSnapPoint(f, 51, 50, 26, { areaId: "a1", vertexIndex: 0 })).toEqual({
      x: 53,
      y: 50,
    });
  });

  it("returns null when nothing is within range", () => {
    expect(nearestAreaSnapPoint({ walls: [], areas: [] }, 500, 500, 26)).toBeNull();
  });
});

describe("layoutPointsInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it("returns [] for a non-positive count", () => {
    expect(layoutPointsInPolygon(square, 0)).toEqual([]);
    expect(layoutPointsInPolygon(square, -1)).toEqual([]);
  });

  it("places a single point at the centroid", () => {
    expect(layoutPointsInPolygon(square, 1)).toEqual([{ x: 50, y: 50 }]);
  });

  it("returns exactly `count` distinct points, all inside the polygon", () => {
    const pts = layoutPointsInPolygon(square, 6);
    expect(pts).toHaveLength(6);
    for (const p of pts) expect(pointInPolygon(square, p.x, p.y)).toBe(true);
    // Distinct positions — the whole point is to not stack them.
    const uniq = new Set(pts.map((p) => `${p.x},${p.y}`));
    expect(uniq.size).toBe(6);
  });

  it("spreads points out rather than clumping in one corner", () => {
    const pts = layoutPointsInPolygon(square, 4);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    // A 4-point spread across a square should use a meaningful fraction of
    // both axes, not huddle in a small sub-region.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(20);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20);
  });

  it("keeps every point inside a concave (L-shaped) polygon, avoiding the notch", () => {
    const L = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
    ];
    const pts = layoutPointsInPolygon(L, 8);
    expect(pts).toHaveLength(8);
    for (const p of pts) expect(pointInPolygon(L, p.x, p.y)).toBe(true);
  });

  it("still returns exactly `count` points when far more are requested than the room can grid-fit", () => {
    const tiny = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const pts = layoutPointsInPolygon(tiny, 20);
    expect(pts).toHaveLength(20);
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe("elementsInRect (area case)", () => {
  it("selects an Area by its centroid", () => {
    const f = {
      ...floor,
      areas: [
        { id: "a1", points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] },
      ],
    } as unknown as Floor;
    const hits = elementsInRect(f, { x0: 0, y0: 0, x1: 60, y1: 60 });
    expect(hits).toContainEqual({ kind: "area", id: "a1" });
  });
});

describe("applyDelta (area case)", () => {
  it("translates every vertex of a snapshotted area", () => {
    const f = {
      ...floor,
      areas: [{ id: "a1", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }],
    } as unknown as Floor;
    const orig = new Map<string, OrigPos>([
      [
        "area:a1",
        { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
      ],
    ]);
    const out = applyDelta(f, 5, 5, orig);
    expect(out.areas![0]).toMatchObject({
      points: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }],
    });
  });
});
