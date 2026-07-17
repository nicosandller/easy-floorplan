import { describe, it, expect } from "vitest";
import {
  nearestCorner,
  snapWallEnd,
  elementsInRect,
  applyDelta,
  attachedCorners,
} from "./editor-geometry";
import type { OrigPos } from "./editor-geometry";
import type { Floor, Wall } from "./types";

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
