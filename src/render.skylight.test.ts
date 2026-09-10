import { describe, it, expect } from "vitest";
import {
  SKYLIGHT_DROP,
  SKYLIGHT_SPREAD,
  SKYLIGHT_WIDTH_RATIO,
  SHUTTER_MARK_OFFSET,
  openingDefaultOpen,
  openingHitSize,
  openingIsGlazed,
  openingIsSkylight,
  openingMarkOffset,
  openingMotion,
  openingSunFraction,
  renderOpening,
  renderSunlight,
  renderWallMask,
  skylightCeilingHeight,
  skylightDropFraction,
  skylightPatchCenter,
  skylightPatchHalfSides,
  skylightPatchPolygon,
  skylightWidth,
  wallsLightPassesThrough,
} from "./render";
import { deadSpaces } from "./dead-space";
import type { Opening, Wall } from "./types";
import { nothing } from "lit";

/** As render.opening.test.ts — lit templates back into markup. */
function serialize(node: unknown): string {
  if (node == null || node === false) return "";
  if (Array.isArray(node)) return node.map(serialize).join("");
  if (typeof node === "object" && "strings" in (node as Record<string, unknown>)) {
    const { strings, values } = node as { strings: string[]; values: unknown[] };
    let out = strings[0];
    for (let i = 0; i < values.length; i++) out += serialize(values[i]) + strings[i + 1];
    return out;
  }
  return String(node);
}

const sky = (o: Partial<Opening> = {}): Opening =>
  ({ id: "sk", type: "skylight", x: 200, y: 200, length: 100, width: 60, angle: 0, ...o }) as Opening;
const win = (o: Partial<Opening> = {}): Opening =>
  ({ id: "w", type: "window", x: 200, y: 100, length: 60, angle: 0, ...o }) as Opening;

/** Light travelling straight down the canvas — the sun due "north" of it. */
const down = { x: 0, y: 1 };

describe("what a skylight is", () => {
  it("is the one opening that is not in a wall", () => {
    expect(openingIsSkylight(sky())).toBe(true);
    expect(openingIsSkylight(win())).toBe(false);
    expect(openingIsSkylight({ type: "door" })).toBe(false);
  });

  it("has a second side, defaulting to portrait proportions", () => {
    expect(skylightWidth(sky())).toBe(60);
    expect(skylightWidth(sky({ width: undefined }))).toBeCloseTo(100 * SKYLIGHT_WIDTH_RATIO);
    // A wall opening has no such side, and says so rather than inventing one
    // from its length — every caller of this is skylight-only, and a caller
    // that asks anyway must not get a plausible wrong number.
    expect(skylightWidth(win())).toBe(0);
    // Nothing a hand-written plan can put here becomes a coordinate: a
    // rectangle with no width is invisible, which on screen is
    // indistinguishable from the feature being broken.
    for (const bad of [0, -40, NaN, Infinity, "wide" as unknown as number])
      expect(skylightWidth(sky({ width: bad as number }))).toBeGreaterThan(0);
  });

  it("is glass by default, and can be told it is a hatch instead", () => {
    expect(openingIsGlazed(sky())).toBe(true);
    expect(openingIsGlazed(sky({ glazed: false }))).toBe(false);
    // The other two are unchanged by that default moving.
    expect(openingIsGlazed(win())).toBe(true);
    expect(openingIsGlazed({ type: "door" })).toBe(false);
    expect(openingIsGlazed({ type: "door", glazed: true })).toBe(true);
  });

  it("is top-hung and cannot be told otherwise", () => {
    // Nothing a hole in a ceiling does is described by swing, slide, roll or
    // fixed, and inheriting the `swing` default would have carried a hinge
    // jamb and a quarter-circle arc across the floor into every piece of
    // arithmetic that reads the motion.
    expect(openingMotion(sky())).toBe("awning");
    expect(openingMotion(sky({ motion: "slide" }))).toBe("awning");
    // Drawn shut with no sensor, like a window — only a swing door is drawn
    // open by the static floor-plan convention.
    expect(openingDefaultOpen(sky())).toBe(false);
  });

  it("keeps badges and taps clear of a rectangle rather than of a wall", () => {
    // Both are sized off the wall band for a wall opening, and off the roof
    // light's own width for a skylight: a badge 22 units off the centre of a
    // 60-wide velux sits on the glass it is reporting on.
    expect(openingMarkOffset(win())).toBe(SHUTTER_MARK_OFFSET);
    expect(openingMarkOffset(sky())).toBe(SHUTTER_MARK_OFFSET + 30);
    expect(openingHitSize(sky())).toEqual({ width: 100, height: 60 });
    expect(openingHitSize(win()).height).toBeLessThan(20);
  });
});

describe("a skylight is a gap in no wall", () => {
  const wall: Wall = { id: "w1", x1: 0, y1: 200, x2: 400, y2: 200 };

  it("never opens the wall it happens to be drawn over", () => {
    // Its centre sits exactly on the wall, which is the whole test
    // wallsLightPassesThrough applies — so a velux hanging above a partition
    // used to saw that partition in half for every lamp and every beam.
    const out = wallsLightPassesThrough([wall], [sky({ x: 200, y: 200 })], () => 1);
    expect(out).toEqual([wall]);
    // …where a window in the same place does open it.
    const cut = wallsLightPassesThrough([wall], [win({ x: 200, y: 200 })], () => 1);
    expect(cut.length).toBe(2);
  });

  it("cuts nothing out of the drawn wall band either", () => {
    const s = serialize(renderWallMask([sky({ x: 200, y: 200 })], 400, 400, "m"));
    // One rect: the mask's own white ground, and no black one over it.
    expect(s.match(/<rect /g)?.length).toBe(1);
    expect(serialize(renderWallMask([win({ x: 200, y: 200 })], 400, 400, "m")).match(/<rect /g)?.length).toBe(2);
  });

  it("does not count as the way into a sealed region (issue #88)", () => {
    // A boxed-in shaft with a roof light over it is still a shaft: you cannot
    // walk into it. The test dead-space applies is "an opening's centre sits
    // on this ring's edge", which a skylight near a wall passes by accident.
    const box: Wall[] = [
      { id: "a", x1: 0, y1: 0, x2: 100, y2: 0 },
      { id: "b", x1: 100, y1: 0, x2: 100, y2: 100 },
      { id: "c", x1: 100, y1: 100, x2: 0, y2: 100 },
      { id: "d", x1: 0, y1: 100, x2: 0, y2: 0 },
    ];
    expect(deadSpaces(box, []).length).toBe(1);
    expect(deadSpaces(box, [sky({ x: 50, y: 0, length: 40, width: 30 })]).length).toBe(1);
    // A door in the same place is a way in, and the region stops being dead.
    expect(deadSpaces(box, [{ ...win({ x: 50, y: 0, length: 40 }), type: "door" } as Opening]).length).toBe(0);
  });
});

describe("how much light a skylight lets in", () => {
  it("is glass, so the sash makes no difference — the blind does", () => {
    // The thing about a velux that surprises people, and the reason `glazed`
    // is offered on a skylight at all.
    expect(openingSunFraction(sky(), 0)).toBe(1);
    expect(openingSunFraction(sky(), 1)).toBe(1);
    expect(openingSunFraction(sky(), 1, 0)).toBe(0);
  });

  it("counts a half-drawn blind, where a wall opening's shutter cannot", () => {
    // A wall opening's shutter is edge-on in plan: the drawing can only say up
    // or down, so the light says the same. A roof light's is drawn across the
    // glass at the fraction the cover reports, and the light has to agree with
    // a picture the viewer is looking straight at.
    expect(openingSunFraction(sky(), 1, 0.4)).toBeCloseTo(0.4);
    expect(openingSunFraction(win(), 1, 0.4)).toBe(1);
  });

  it("lets a roof hatch behave the way its owner expects", () => {
    // `glazed: false` is the loft door, the smoke vent, the lantern with a
    // solid flap: light only while it is actually open.
    const hatch = sky({ glazed: false });
    expect(openingSunFraction(hatch, 0)).toBe(0);
    expect(openingSunFraction(hatch, 0.5)).toBeCloseTo(0.5);
    expect(openingSunFraction(hatch, 1)).toBe(1);
  });

  it("still answers to the switch every opening has", () => {
    expect(openingSunFraction(sky({ sunlight: false }), 1)).toBe(0);
  });
});

describe("where a skylight's light lands", () => {
  it("moves the patch downwind, and keeps it the same rectangle", () => {
    // Parallel light projects a horizontal rectangle onto a horizontal floor
    // unchanged — congruent, whatever the sun's angle. So the only question a
    // skylight's patch asks is *where*, never *what shape*.
    const o = sky();
    expect(skylightPatchCenter(o, down, 120)).toEqual({ x: 200, y: 320 });
    const half = skylightPatchHalfSides(o);
    expect(half).toEqual({ along: 50, across: 30 });
    // …and a blind narrows it across, the way the blind itself travels.
    expect(skylightPatchHalfSides(o, 0.5)).toEqual({ along: 50, across: 15 });
  });

  it("slides further from a higher ceiling", () => {
    expect(skylightPatchCenter(sky({ ceilingHeight: 2 }), down, 100).y).toBe(400);
    expect(skylightPatchCenter(sky({ ceilingHeight: 0.5 }), down, 100).y).toBe(250);
    // Clamped, and not at zero: a ceiling of no height puts the patch exactly
    // on top of the symbol, which reads as the drawing having gone wrong.
    expect(skylightCeilingHeight({ ceilingHeight: 0 })).toBeGreaterThan(0);
    expect(skylightCeilingHeight({ ceilingHeight: NaN })).toBe(1);
    expect(skylightCeilingHeight({ ceilingHeight: 500 })).toBeLessThan(20);
  });

  it("slides, rather than swinging round, as the sun moves", () => {
    // The patch is turned by the skylight's own angle, never by the light's.
    // Aligned to the sun it swung through the afternoon like a searchlight,
    // where what a roof light's patch actually does is slide.
    const o = sky();
    const size = (dir: { x: number; y: number }) => {
      const p = skylightPatchPolygon(o, dir, 100);
      return [Math.hypot(p[1]!.x - p[0]!.x, p[1]!.y - p[0]!.y), Math.hypot(p[2]!.x - p[1]!.x, p[2]!.y - p[1]!.y)];
    };
    const expected = [100 * SKYLIGHT_SPREAD, 60 * SKYLIGHT_SPREAD];
    for (const dir of [down, { x: 1, y: 0 }, { x: 0.6, y: 0.8 }]) {
      const [a, b] = size(dir);
      expect(a).toBeCloseTo(expected[0]!);
      expect(b).toBeCloseTo(expected[1]!);
    }
  });

  it("bounds the drop rather than letting a typo throw it off the plan", () => {
    expect(skylightDropFraction(undefined)).toBe(SKYLIGHT_DROP);
    expect(skylightDropFraction("far")).toBe(SKYLIGHT_DROP);
    // Zero is allowed and means something: a sun directly overhead drops the
    // patch straight down the shaft.
    expect(skylightDropFraction(0)).toBe(0);
    expect(skylightDropFraction(-2)).toBe(0);
    expect(skylightDropFraction(99)).toBeLessThan(10);
  });
});

describe("renderSunlight with a roof light in the plan", () => {
  const wall: Wall = { id: "w1", x1: 0, y1: 100, x2: 400, y2: 100 };
  const light = (openings: Opening[], walls: Wall[] = [wall]) =>
    serialize(
      renderSunlight(walls, openings, 400, 400, "sun", {
        dir: down,
        openAmount: () => 0,
        shutterOpen: () => undefined,
      })
    );

  it("is a source without being asked which façade the sun is on", () => {
    // sunReachesOpening traces back along the light and refuses any opening
    // standing behind a wall. A roof light stands behind none of them — there
    // is nothing in a floor plan between a roof and the sky — and a skylight
    // south of the wall above would otherwise never be lit at all.
    const s = light([sky({ x: 200, y: 300 })]);
    expect(s).toContain("fp-skylight-patch");
  });

  it("is not shaded by the walls upwind of it", () => {
    // The whole reason a skylight needs a mask of its own. At an upwind wall's
    // position the ray was still outside the building, over the roof, so it
    // cannot have been blocked there — and with the plan's global shadows
    // applied instead, a velux with a partition a couple of metres upwind
    // lost its patch entirely, which is the arrangement most roof lights
    // are in.
    const near = light([sky({ x: 200, y: 140 })]);
    // Its mask carries a ground and nothing to subtract from it.
    const mask = near.match(/<mask id=sun-k0[\s\S]*?<\/mask>/)![0];
    expect(mask).toContain("<rect");
    expect(mask).not.toContain("<polygon");
  });

  it("is shaded by the walls downwind of it", () => {
    // Past the glass the ray is below ceiling height, so a full-height wall
    // blocks it completely — and the wall's own shadow is exactly as long as
    // the patch's drop, so "downwind" is the whole answer.
    const beyond = light([sky({ x: 200, y: 40 })]);
    const mask = beyond.match(/<mask id=sun-k0[\s\S]*?<\/mask>/)![0];
    expect(mask).toContain("<polygon");
  });

  it("draws nothing at all for a skylight behind a closed blind", () => {
    // Nothing at all, rather than a layer at zero opacity: the whole point of
    // the blind is that a roof light behind a shut one is as dark as ceiling.
    expect(
      renderSunlight([wall], [sky({ x: 200, y: 300 })], 400, 400, "sun", {
        dir: down,
        openAmount: () => 0,
        shutterOpen: () => 0,
      })
    ).toBe(nothing);
  });

  it("puts no NaN in a coordinate, whatever the plan says", () => {
    for (const bad of [NaN, "high" as unknown as number, -5, 400, null]) {
      const s = serialize(
        renderSunlight([wall], [sky({ x: 200, y: 300, ceilingHeight: bad as number })], 400, 400, "sun", {
          dir: down,
          openAmount: () => 1,
          shutterOpen: () => undefined,
          drop: bad as number,
        })
      );
      expect(s).not.toContain("NaN");
      expect(s).not.toContain("Infinity");
    }
  });

  it("keeps its gradient ids stable when a door beside it opens (issue #119)", () => {
    // The lesson the beams already learned: filtering to the lit openings
    // renumbers every later one, which rewrites an id the browser has already
    // cached a paint server under. A skylight is in the same array.
    const many = [win({ id: "a", x: 60 }), sky({ id: "sk", x: 200, y: 300 })];
    const ids = (doorOpen: number) => {
      const s = serialize(
        renderSunlight([wall], many, 400, 400, "sun", {
          dir: down,
          openAmount: (o) => (o.id === "a" ? doorOpen : 0),
          shutterOpen: () => undefined,
        })
      );
      return s.match(/<polygon class="fp-sunbeam fp-skylight-patch"[^>]*fill=url\(#(sun-b\d+)\)/)![1];
    };
    expect(ids(0)).toBe(ids(1));
  });
});

describe("the skylight symbol", () => {
  const draw = (o: Partial<Opening>, style: Record<string, unknown> = {}) =>
    serialize(renderOpening(sky(o), { color: "#000", ...style } as never));

  it("says it is overhead, and says which way it opens", () => {
    const s = draw({});
    expect(s).toContain("fp-opening-skylight");
    // The kerb, plus the two dashed diagonals that are the plan convention
    // for anything above the cut plane — and the only thing that tells a roof
    // light from a rectangular piece of furniture at a glance.
    expect(s.match(/stroke-dasharray="4 4"/g)?.length).toBe(2);
  });

  it("foreshortens the sash instead of sweeping it anywhere", () => {
    // From directly below, a top-hung sash does not swing across anything —
    // it gets shorter. Wide open it is the edge-on sliver beside its own
    // hinge, which is a sliver and not nothing: a pane that vanished read as
    // a skylight that had been deleted.
    const height = (amount: number) =>
      Number(draw({}, { amount, open: amount > 0 }).match(/<rect x=-\d+(?:\.\d+)? y=-\d+(?:\.\d+)? width=\d+(?:\.\d+)? height=([\d.]+)\s+fill="none" stroke=#000 stroke-width="1.5"/)![1]);
    expect(height(1)).toBeLessThan(height(0.5));
    expect(height(0.5)).toBeLessThan(height(0));
    expect(height(1)).toBeGreaterThan(0);
  });

  it("draws its blind across the glass rather than along a wall line", () => {
    // The one shutter in the plan you see face-on. A roll curtain on the wall
    // line would have been a band through the middle of the rectangle.
    const shut = draw({}, { shutter: { amount: 0 } });
    expect(shut).toContain("fp-skylight-blind");
    expect(shut).not.toContain("fp-roll-curtain");
    // Fully up it is gone, not a zero-height rect that still strokes a hard
    // line across the head of the glass.
    expect(draw({}, { shutter: { amount: 1 } })).not.toContain("fp-skylight-blind");
  });
});
