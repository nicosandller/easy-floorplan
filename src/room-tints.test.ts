import { describe, it, expect } from "vitest";
import type { AreaPoint } from "./types";
import {
  ROOM_TINTS,
  ROOM_TINT_OPACITY,
  areasAdjacent,
  assignRoomTints,
  roomTintFill,
  roomTintPaints,
  roomTintScheme,
  roomTintsOf,
} from "./room-tints";

const rect = (x: number, y: number, w: number, h: number): AreaPoint[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** Every adjacent pair of tinted rooms, as [i, j]. */
function adjacentPairs(areas: { points: AreaPoint[] }[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < areas.length; i++)
    for (let j = i + 1; j < areas.length; j++)
      if (areasAdjacent(areas[i]!.points, areas[j]!.points)) out.push([i, j]);
  return out;
}

/** A w×h grid of square rooms on shared centreline walls, ids r0…rN. */
function grid(w: number, h: number, size = 100) {
  const out: { id: string; points: AreaPoint[] }[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) out.push({ id: `r${y * w + x}`, points: rect(x * size, y * size, size, size) });
  return out;
}

describe("roomTintsOf", () => {
  it("is off unless the config says auto", () => {
    expect(roomTintsOf(undefined)).toBe("off");
    expect(roomTintsOf({})).toBe("off");
    expect(roomTintsOf({ roomTints: "off" })).toBe("off");
    expect(roomTintsOf({ roomTints: "auto" })).toBe("auto");
  });

  it("reads anything it does not know as off, which is how it renders", () => {
    for (const v of [true, "AUTO", "on", 1, null]) expect(roomTintsOf({ roomTints: v })).toBe("off");
  });
});

describe("roomTintScheme", () => {
  it("follows Home Assistant's dark mode on the default skin", () => {
    expect(roomTintScheme({ themes: { darkMode: true } }, undefined)).toBe("dark");
    expect(roomTintScheme({ themes: { darkMode: false } }, undefined)).toBe("light");
    expect(roomTintScheme({ themes: {} }, "default")).toBe("light");
    expect(roomTintScheme(undefined, undefined)).toBe("light");
  });

  it("lets a skin with fixed paper decide", () => {
    expect(roomTintScheme({ themes: { darkMode: false } }, "tron")).toBe("dark");
    expect(roomTintScheme({ themes: { darkMode: true } }, "pastel")).toBe("light");
    expect(roomTintScheme({ themes: { darkMode: true } }, "odnetnin")).toBe("light");
    // An unknown skin renders as the default, so it follows HA too.
    expect(roomTintScheme({ themes: { darkMode: true } }, "nintendo")).toBe("dark");
  });
});

describe("ROOM_TINTS and roomTintFill", () => {
  it("is a short palette of distinct names with a light and a dark value each", () => {
    expect(ROOM_TINTS.length).toBeGreaterThanOrEqual(6);
    expect(ROOM_TINTS.length).toBeLessThanOrEqual(8);
    expect(new Set(ROOM_TINTS.map((t) => t.name)).size).toBe(ROOM_TINTS.length);
    for (const t of ROOM_TINTS) {
      expect(t.light).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.dark).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.light).not.toBe(t.dark);
    }
  });

  it("is overridable by a theme variable, then a palette entry, then falls back", () => {
    expect(roomTintFill(0, "light")).toBe(
      `var(--fp-room-tint-1, var(--fp-color-room-tint-1, ${ROOM_TINTS[0]!.light}))`
    );
    expect(roomTintFill(1, "dark")).toBe(
      `var(--fp-room-tint-2, var(--fp-color-room-tint-2, ${ROOM_TINTS[1]!.dark}))`
    );
  });

  it("wraps an out-of-range index rather than drawing nothing", () => {
    expect(roomTintFill(ROOM_TINTS.length, "light")).toBe(roomTintFill(0, "light"));
    expect(roomTintFill(-1, "light")).toBe(roomTintFill(ROOM_TINTS.length - 1, "light"));
  });
});

describe("areasAdjacent", () => {
  it("counts a shared wall", () => {
    expect(areasAdjacent(rect(0, 0, 100, 100), rect(100, 0, 100, 100))).toBe(true);
  });

  it("counts a partly shared wall", () => {
    expect(areasAdjacent(rect(0, 0, 100, 100), rect(100, 60, 100, 100))).toBe(true);
  });

  it("does not count rooms meeting only at a corner", () => {
    expect(areasAdjacent(rect(0, 0, 100, 100), rect(100, 100, 100, 100))).toBe(false);
  });

  it("does not count an overlap shorter than a few units", () => {
    expect(areasAdjacent(rect(0, 0, 100, 100), rect(100, 98, 100, 100))).toBe(false);
  });

  it("counts rooms drawn to the inside faces, a wall apart", () => {
    expect(areasAdjacent(rect(0, 0, 96, 100), rect(104, 0, 96, 100))).toBe(true);
  });

  it("does not count rooms across a corridor", () => {
    expect(areasAdjacent(rect(0, 0, 100, 100), rect(140, 0, 100, 100))).toBe(false);
  });

  it("counts a room drawn inside another", () => {
    expect(areasAdjacent(rect(0, 0, 300, 300), rect(100, 100, 50, 50))).toBe(true);
  });

  it("does not count parallel edges that are on the same line but apart", () => {
    // Both top edges lie on y=0, but the rooms are 100 units apart.
    expect(areasAdjacent(rect(0, 0, 100, 100), rect(200, 0, 100, 100))).toBe(false);
  });

  it("follows a shared edge between non-rectangular rooms (an L and its notch)", () => {
    const L: AreaPoint[] = [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 },
      { x: 100, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 200 },
    ];
    expect(areasAdjacent(L, rect(100, 100, 100, 100))).toBe(true);
  });

  it("ignores degenerate polygons", () => {
    expect(areasAdjacent([], rect(0, 0, 10, 10))).toBe(false);
    expect(areasAdjacent([{ x: 0, y: 0 }], rect(0, 0, 10, 10))).toBe(false);
  });
});

describe("assignRoomTints", () => {
  it("never gives two neighbouring rooms the same tint", () => {
    const areas = grid(5, 4);
    const tints = assignRoomTints(areas);
    const pairs = adjacentPairs(areas);
    expect(pairs.length).toBe(31);
    for (const [i, j] of pairs) expect(tints[i]).not.toBe(tints[j]);
    for (const t of tints) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(ROOM_TINTS.length);
    }
  });

  it("is the same whatever order the rooms are listed in", () => {
    const areas = grid(4, 3);
    const byId = new Map<string, number | undefined>();
    assignRoomTints(areas).forEach((t, i) => byId.set(areas[i]!.id, t));
    const shuffled = [...areas].reverse();
    shuffled.push(shuffled.splice(3, 1)[0]!);
    assignRoomTints(shuffled).forEach((t, i) => expect(t).toBe(byId.get(shuffled[i]!.id)));
  });

  it("is the same on every call", () => {
    expect(assignRoomTints(grid(3, 3))).toEqual(assignRoomTints(grid(3, 3)));
  });

  it("leaves a room with its own colour alone, and lets its neighbours use any tint", () => {
    const areas = [
      { id: "a", points: rect(0, 0, 100, 100) },
      { id: "b", points: rect(100, 0, 100, 100), color: "#ff0000" },
    ];
    const tints = assignRoomTints(areas);
    expect(tints[1]).toBeUndefined();
    // "a" alone gets exactly what it would get with no neighbour at all.
    expect(tints[0]).toBe(assignRoomTints([areas[0]!])[0]);
  });

  it("treats an empty colour as no colour", () => {
    expect(assignRoomTints([{ id: "a", points: rect(0, 0, 1, 1), color: "  " }])[0]).toBeDefined();
  });

  it("does not move existing rooms when one is added elsewhere on the plan", () => {
    const areas = grid(3, 3);
    const before = assignRoomTints(areas);
    // "a0" sorts before every existing id, so a plain lowest-free greedy would
    // reshuffle the lot.
    const after = assignRoomTints([...areas, { id: "a0", points: rect(1000, 1000, 50, 50) }]);
    expect(after.slice(0, areas.length)).toEqual(before);
  });

  it("can only move rooms downstream of a new neighbour", () => {
    const areas = grid(3, 3);
    const before = assignRoomTints(areas);
    const extra = { id: "a0", points: rect(300, 0, 100, 100) }; // beside r2 only
    const all = [...areas, extra];
    const after = assignRoomTints(all);
    // A room's tint depends on its own id and on neighbours visited before
    // it, so only rooms reachable from the new one through ever-later ids
    // can change.
    const reach = new Set([areas.length]);
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = 0; i < areas.length; i++) {
        if (reach.has(i)) continue;
        if ([...reach].some((r) => all[r]!.id < all[i]!.id && areasAdjacent(all[r]!.points, all[i]!.points))) {
          reach.add(i);
          grew = true;
        }
      }
    }
    expect(reach.size).toBeLessThan(all.length);
    areas.forEach((_, i) => {
      if (!reach.has(i)) expect(after[i]).toBe(before[i]);
    });
    for (const [i, j] of adjacentPairs(all)) expect(after[i]).not.toBe(after[j]);
  });

  it("copes with missing ids and points", () => {
    const tints = assignRoomTints([{ points: rect(0, 0, 10, 10) }, { id: "x" }, {}]);
    expect(tints.every((t) => typeof t === "number")).toBe(true);
  });

  it("keeps a real seven-room flat's neighbours apart", () => {
    // The rooms of a real plan (bedrooms, kitchen with a notch, hall, bath,
    // wardrobe, storage), drawn on wall centrelines.
    const areas = [
      { id: "area_0n1518k", points: rect(512.5, 25, 322.5, 277.5) },
      { id: "area_lj9en3j", points: rect(512.5, 302.5, 322.5, 202.5) },
      {
        id: "area_kitchen_a1",
        points: [
          { x: 25, y: 25 }, { x: 392.5, y: 25 }, { x: 392.5, y: 183.2 }, { x: 362.5, y: 183.2 },
          { x: 362.5, y: 208.8 }, { x: 310, y: 208.8 }, { x: 310, y: 291.2 }, { x: 25, y: 291.2 },
        ],
      },
      {
        id: "area_hall_b2",
        points: [
          { x: 310, y: 208.8 }, { x: 362.5, y: 208.8 }, { x: 362.5, y: 183.2 },
          { x: 512.5, y: 183.2 }, { x: 512.5, y: 422.5 }, { x: 310, y: 422.5 },
        ],
      },
      { id: "area_bathroom_c3", points: rect(25, 291.2, 285, 131.3) },
      { id: "area_wardrobe_d4", points: rect(392.5, 25, 120, 158.2) },
      { id: "area_storage_e5", points: rect(422.5, 422.5, 90, 82.5) },
    ];
    const tints = assignRoomTints(areas);
    const pairs = adjacentPairs(areas);
    // Hall touches kitchen, bath, wardrobe, both bedrooms and the storage.
    expect(pairs.length).toBeGreaterThanOrEqual(9);
    for (const [i, j] of pairs) expect(tints[i]).not.toBe(tints[j]);
  });
});

describe("roomTintPaints", () => {
  const areas = [
    { id: "a", points: rect(0, 0, 100, 100) },
    { id: "b", points: rect(100, 0, 100, 100), opacity: 0.4 },
    { id: "c", points: rect(200, 0, 100, 100), color: "#123456" },
  ];

  it("paints nothing while off, so the plan renders as before", () => {
    expect(roomTintPaints(areas, "off", "light")).toEqual([undefined, undefined, undefined]);
  });

  it("tints uncoloured rooms at the default tint opacity, or their own", () => {
    const [a, b, c] = roomTintPaints(areas, "auto", "dark");
    expect(a!.opacity).toBe(ROOM_TINT_OPACITY);
    expect(b!.opacity).toBe(0.4);
    expect(c).toBeUndefined();
    expect(a!.color).toMatch(/^var\(--fp-room-tint-\d/);
    expect(a!.color).not.toBe(b!.color);
  });

  it("draws the dark side of the same tint in dark mode", () => {
    const light = roomTintPaints(areas, "auto", "light")[0]!.color;
    const dark = roomTintPaints(areas, "auto", "dark")[0]!.color;
    expect(light.replace(/#[0-9a-f]{6}/, "")).toBe(dark.replace(/#[0-9a-f]{6}/, ""));
    expect(light).not.toBe(dark);
  });
});
