import { describe, it, expect } from "vitest";
import {
  deadSpaces,
  deadSpacesCached,
  signedArea,
  splitSegments,
  traceFaces,
  MIN_DEAD_AREA,
} from "./dead-space";
import type { Opening, Wall } from "./types";

let n = 0;
const wall = (x1: number, y1: number, x2: number, y2: number): Wall => ({
  id: `w${n++}`,
  x1,
  y1,
  x2,
  y2,
});

/** A closed rectangle of four walls. */
const box = (x: number, y: number, w: number, h: number): Wall[] => [
  wall(x, y, x + w, y),
  wall(x + w, y, x + w, y + h),
  wall(x + w, y + h, x, y + h),
  wall(x, y + h, x, y),
];

const door = (x: number, y: number, angle = 0): Opening => ({
  id: `o${n++}`,
  type: "door",
  x,
  y,
  length: 40,
  angle,
});

/** Ring corners as a sorted "x,y" list, so winding/start point don't matter. */
const corners = (ring: { x: number; y: number }[]): string[] =>
  ring.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).sort();

describe("signedArea", () => {
  it("is opposite for the two windings", () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(signedArea(ring)).toBe(100);
    expect(signedArea([...ring].reverse())).toBe(-100);
  });
});

describe("splitSegments", () => {
  it("cuts a wall where another one runs into its middle", () => {
    const out = splitSegments(
      [
        { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
        { a: { x: 50, y: 0 }, b: { x: 50, y: 80 } },
      ],
      0.75
    );
    // The horizontal run becomes two pieces; the partition stays whole.
    expect(out).toHaveLength(3);
    expect(out.filter((s) => s.a.y === 0 && s.b.y === 0)).toHaveLength(2);
  });

  it("cuts both walls where they cross", () => {
    const out = splitSegments(
      [
        { a: { x: 0, y: 50 }, b: { x: 100, y: 50 } },
        { a: { x: 50, y: 0 }, b: { x: 50, y: 100 } },
      ],
      0.75
    );
    expect(out).toHaveLength(4);
  });

  it("leaves walls that only share a corner alone", () => {
    const out = splitSegments(
      [
        { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
        { a: { x: 100, y: 0 }, b: { x: 100, y: 100 } },
      ],
      0.75
    );
    expect(out).toHaveLength(2);
  });

  it("splits a wall drawn over the top of another (collinear overlap)", () => {
    const out = splitSegments(
      [
        { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
        { a: { x: 40, y: 0 }, b: { x: 160, y: 0 } },
      ],
      0.75
    );
    // 0-40, 40-100, 40-100 again and 100-160. The point is that the shared
    // stretch comes out as one *identical* pair rather than two segments
    // overlapping partway — the graph then dedupes it into a single edge,
    // which a partial overlap could never be reduced to.
    expect(out).toHaveLength(4);
    expect(out.map((s) => `${s.a.x}-${s.b.x}`).sort()).toEqual([
      "0-40",
      "100-160",
      "40-100",
      "40-100",
    ]);
  });

  it("still finds one room when a wall is drawn twice over itself", () => {
    const walls = [...box(0, 0, 100, 100), wall(0, 0, 100, 0)];
    expect(deadSpaces(walls, [])).toHaveLength(1);
  });
});

describe("traceFaces", () => {
  it("finds the one bounded face of a closed box", () => {
    const segs = box(0, 0, 100, 100).map((w) => ({
      a: { x: w.x1, y: w.y1 },
      b: { x: w.x2, y: w.y2 },
    }));
    const bounded = traceFaces(segs, 0.75).filter((f) => signedArea(f) > 0);
    expect(bounded).toHaveLength(1);
    expect(Math.abs(signedArea(bounded[0]!))).toBe(10000);
  });

  it("finds both rooms when a partition splits a box", () => {
    const walls = [...box(0, 0, 200, 100), wall(100, 0, 100, 100)];
    const segs = splitSegments(
      walls.map((w) => ({ a: { x: w.x1, y: w.y1 }, b: { x: w.x2, y: w.y2 } })),
      0.75
    );
    const bounded = traceFaces(segs, 0.75).filter((f) => signedArea(f) > 0);
    expect(bounded).toHaveLength(2);
    expect(bounded.map((f) => signedArea(f))).toEqual([10000, 10000]);
  });

  it("closes every face it emits, even with stubs and separate components", () => {
    // Only a walk that returns to the edge it started from is a face. The
    // awkward shapes are the ones that would expose a walk falling out of its
    // bound instead: a dead-end stub inside a room (walked out and back), and
    // a second component with no vertex in common with the first.
    const walls = [
      ...box(0, 0, 100, 100),
      wall(50, 0, 50, 40), // stub hanging into the room
      ...box(300, 0, 100, 100), // separate component
      wall(300, 200, 400, 200), // free-floating edge, part of no cycle
    ];
    const segs = splitSegments(
      walls.map((w) => ({ a: { x: w.x1, y: w.y1 }, b: { x: w.x2, y: w.y2 } })),
      0.75
    );
    for (const face of traceFaces(segs, 0.75)) {
      // A closed ring's first and last vertices are adjacent, not equal — the
      // walk records each vertex once. What must hold is that it is a ring at
      // all: at least a triangle's worth of vertices, and a real signed area
      // for the two bounded faces.
      expect(face.length).toBeGreaterThanOrEqual(3);
      expect(Number.isFinite(signedArea(face))).toBe(true);
    }
    expect(traceFaces(segs, 0.75).filter((f) => signedArea(f) > 0)).toHaveLength(2);
  });

  it("does not close a room whose wall has a gap", () => {
    const walls = [
      wall(0, 0, 100, 0),
      wall(100, 0, 100, 100),
      wall(100, 100, 0, 100),
      // Left wall stops 30 short of the top-left corner.
      wall(0, 100, 0, 30),
    ];
    const segs = walls.map((w) => ({ a: { x: w.x1, y: w.y1 }, b: { x: w.x2, y: w.y2 } }));
    expect(traceFaces(segs, 0.75).filter((f) => signedArea(f) > 0)).toEqual([]);
  });
});

describe("deadSpaces", () => {
  it("hatches a sealed box", () => {
    const out = deadSpaces(box(0, 0, 100, 100), []);
    expect(out).toHaveLength(1);
    expect(corners(out[0]!)).toEqual(["0,0", "0,100", "100,0", "100,100"]);
  });

  it("leaves a box with a door alone", () => {
    expect(deadSpaces(box(0, 0, 100, 100), [door(50, 0)])).toEqual([]);
  });

  it("leaves a box with a window alone", () => {
    const window: Opening = { ...door(50, 0), type: "window" };
    expect(deadSpaces(box(0, 0, 100, 100), [window])).toEqual([]);
  });

  it("hatches only the room the door does not reach", () => {
    // Two rooms side by side sharing a partition; the left one has the door.
    const walls = [...box(0, 0, 200, 100), wall(100, 0, 100, 100)];
    const out = deadSpaces(walls, [door(50, 0)]);
    expect(out).toHaveLength(1);
    expect(corners(out[0]!)).toEqual(["100,0", "100,100", "200,0", "200,100"]);
  });

  it("counts a door on the shared partition for both rooms", () => {
    const walls = [...box(0, 0, 200, 100), wall(100, 0, 100, 100)];
    // A door in the partition plus one to the outside: both rooms reachable.
    expect(deadSpaces(walls, [door(50, 0), door(100, 50, 90)])).toEqual([]);
  });

  it("ignores a door that sits on a different room's stretch of wall", () => {
    // One long outer wall serves both rooms; the door is over the left room
    // only, so the right room is still sealed.
    const walls = [...box(0, 0, 200, 100), wall(100, 0, 100, 100)];
    const out = deadSpaces(walls, [door(30, 100)]);
    expect(out).toHaveLength(1);
    expect(corners(out[0]!)).toEqual(["100,0", "100,100", "200,0", "200,100"]);
  });

  it("does not hatch a room left open by a gap in its walls", () => {
    const walls = [
      wall(0, 0, 100, 0),
      wall(100, 0, 100, 100),
      wall(100, 100, 0, 100),
      wall(0, 100, 0, 30),
    ];
    expect(deadSpaces(walls, [])).toEqual([]);
  });

  it("welds corners that are a rounding error apart", () => {
    const walls = [
      wall(0, 0, 100, 0),
      wall(100.0001, 0, 100, 100),
      wall(100, 100, 0, 100),
      wall(0, 100, 0, -0.0002),
    ];
    expect(deadSpaces(walls, [])).toHaveLength(1);
  });

  it("welds a corner whose two halves land in different spatial-hash cells", () => {
    // The weld buckets points into eps-sized cells and searches the nine around
    // one. 75 is a multiple of the 0.75 tolerance, so these two coordinates sit
    // either side of a cell boundary — the case a same-cell-only lookup would
    // miss, leaving the corner torn open and the room undetected.
    const walls = [
      wall(0, 0, 74.9999, 0),
      wall(75.0001, 0, 75, 100),
      wall(75, 100, 0, 100),
      wall(0, 100, 0, 0),
    ];
    expect(deadSpaces(walls, [])).toHaveLength(1);
  });

  it("skips a sliver smaller than one grid cell", () => {
    const out = deadSpaces(box(0, 0, 10, 10), []);
    expect(10 * 10).toBeLessThan(MIN_DEAD_AREA);
    expect(out).toEqual([]);
  });

  it("returns the larger region first", () => {
    const walls = [...box(0, 0, 300, 100), wall(100, 0, 100, 100)];
    const out = deadSpaces(walls, []);
    expect(out).toHaveLength(2);
    expect(Math.abs(signedArea(out[0]!))).toBe(20000);
    expect(Math.abs(signedArea(out[1]!))).toBe(10000);
  });

  it("finds a shaft boxed inside a room that has a door", () => {
    const walls = [
      ...box(0, 0, 300, 200),
      // A sealed closet in the corner, sharing the room's own walls.
      wall(0, 60, 80, 60),
      wall(80, 60, 80, 0),
    ];
    const out = deadSpaces(walls, [door(150, 200)]);
    expect(out).toHaveLength(1);
    expect(corners(out[0]!)).toEqual(["0,0", "0,60", "80,0", "80,60"]);
  });

  it("ignores an unenclosed stub wall", () => {
    expect(deadSpaces([wall(0, 0, 100, 0), wall(100, 0, 100, 100)], [])).toEqual([]);
  });

  it("handles a plan with no walls at all", () => {
    expect(deadSpaces([], [])).toEqual([]);
  });
});

describe("deadSpaces tolerances", () => {
  it("honours a tolerance that is actually usable", () => {
    // A 4-unit gap at one corner: sealed under a tolerance wide enough to weld
    // it, open under the default. Proves the options are read at all, so the
    // fallback tests below are not vacuous.
    const walls = [
      wall(0, 0, 100, 0),
      wall(104, 0, 100, 100),
      wall(100, 100, 0, 100),
      wall(0, 100, 0, 0),
    ];
    expect(deadSpaces(walls, [])).toEqual([]);
    expect(deadSpaces(walls, [], { weldEps: 5 })).toHaveLength(1);
  });

  it("falls back to the defaults for a tolerance that is not a usable number", () => {
    // Left alone, each of these makes every comparison in the file false and
    // the whole plan comes back with no dead spaces — silent, total, and
    // indistinguishable from a plan that has none.
    for (const bad of [0, -1, NaN, Infinity, undefined]) {
      expect(deadSpaces(box(0, 0, 100, 100), [], { weldEps: bad })).toHaveLength(1);
      expect(deadSpaces(box(0, 0, 100, 100), [], { minArea: bad })).toHaveLength(1);
      expect(
        deadSpaces(box(0, 0, 100, 100), [door(50, 0)], { openingEps: bad })
      ).toEqual([]);
    }
  });
});

describe("deadSpacesCached", () => {
  it("reuses the result while the inputs are the same arrays", () => {
    const walls = box(0, 0, 100, 100);
    const openings: Opening[] = [];
    expect(deadSpacesCached(walls, openings)).toBe(deadSpacesCached(walls, openings));
  });

  it("recomputes when the openings change", () => {
    const walls = box(0, 0, 100, 100);
    expect(deadSpacesCached(walls, [])).toHaveLength(1);
    expect(deadSpacesCached(walls, [door(50, 0)])).toEqual([]);
  });
});
