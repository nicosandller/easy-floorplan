import { describe, it, expect } from "vitest";
import {
  glowClearSpan,
  openingClearFraction,
  openingDefaultOpen,
  openingDeviceClassPatch,
  openingHasTwoLeaves,
  openingIsGlazed,
  openingIsPassage,
  openingMarkIcon,
  openingSunFraction,
  renderOpening,
  renderSunlight,
  renderWallMask,
  resolveOpeningAmount,
  wallsLightPassesThrough,
} from "./render";
import { ambientOpeningTransmission } from "./ambient-daylight";
import { deadSpaces } from "./dead-space";
import type { Opening, Wall } from "./types";

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

const gap = (o: Partial<Opening> = {}): Opening =>
  ({ id: "p", type: "passage", x: 200, y: 200, length: 80, angle: 0, ...o }) as Opening;
const door = (o: Partial<Opening> = {}): Opening =>
  ({ id: "d", type: "door", x: 200, y: 200, length: 80, angle: 0, ...o }) as Opening;

/** Light travelling straight down the canvas. */
const down = { x: 0, y: 1 };

describe("what a passage is (issue #309)", () => {
  it("is its own type, and only a passage is one", () => {
    expect(openingIsPassage(gap())).toBe(true);
    expect(openingIsPassage(door())).toBe(false);
    expect(openingIsPassage({ type: "window" })).toBe(false);
    expect(openingIsPassage({ type: "skylight" })).toBe(false);
  });

  it("is open with nothing bound, and invert cannot shut it", () => {
    expect(openingDefaultOpen(gap())).toBe(true);
    expect(openingDefaultOpen(gap({ invert: true }))).toBe(true);
    expect(resolveOpeningAmount(gap(), undefined)).toBe(1);
    // The door it replaces is the one that invert does reach.
    expect(openingDefaultOpen(door({ invert: true }))).toBe(false);
  });

  it("is never glass, whatever it says", () => {
    expect(openingIsGlazed(gap())).toBe(false);
    expect(openingIsGlazed(gap({ glazed: true }))).toBe(false);
  });

  it("has no leaves, so a second sensor has nothing to drive", () => {
    expect(openingHasTwoLeaves(gap())).toBe(false);
    // Not even when a plan hand-writes the fields a double door would have.
    expect(openingHasTwoLeaves(gap({ sash: "double", secondaryEntity: "binary_sensor.x" }))).toBe(false);
    expect(
      openingHasTwoLeaves(gap({ motion: "slide", sliderStyle: "biparting" }))
    ).toBe(false);
  });

  it("keeps its type when an entity is bound, whatever the device class says", () => {
    // A door's type follows the class of what is bound to it. A passage's must
    // not: a motion sensor in an archway would otherwise hang a swing door in
    // it, and a window contact would glaze it.
    for (const dc of ["door", "window", "garage", "motion", "occupancy", "blind"])
      expect(openingDeviceClassPatch(gap(), dc)).toEqual({});
    expect(openingDeviceClassPatch(door(), "garage")).toEqual({ type: "door", motion: "roll" });
  });

  it("badges with one glyph, since it has no shut state to show", () => {
    const icon = (open: boolean) =>
      openingMarkIcon(gap({ entity: "binary_sensor.hall_motion" }), { state: open ? "on" : "off" }, open);
    expect(icon(true)).toBe(icon(false));
  });
});

describe("a passage lets everything through", () => {
  it("is all clear, whatever a bound sensor reads", () => {
    // The mirror of a fixed pane, which is never clear however open its
    // contact says it is.
    for (const amount of [0, 0.3, 1]) {
      expect(openingClearFraction(gap(), amount)).toBe(1);
      expect(openingClearFraction(gap({ sash: "double" }), amount, 0)).toBe(1);
      expect(openingClearFraction(gap({ motion: "fixed" }), amount)).toBe(1);
    }
    expect(openingClearFraction(door(), 0)).toBe(0);
  });

  it("passes a lamp's pool across its whole width", () => {
    expect(glowClearSpan(gap(), 0)).toEqual([0, 1]);
    // A shutter hung over the gap still stops it — that is what one is for.
    expect(glowClearSpan(gap({ shutterEntity: "cover.grille" }), 0, undefined, 0)).toEqual([0, 0]);
  });

  it("opens the wall to light at its full length", () => {
    const wall: Wall = { id: "w", x1: 0, y1: 200, x2: 400, y2: 200 };
    const cut = wallsLightPassesThrough([wall], [gap()], (o) => openingClearFraction(o, 0));
    expect(cut.length).toBe(2);
    const opened = 400 - cut.reduce((s, w) => s + Math.hypot(w.x2 - w.x1, w.y2 - w.y1), 0);
    expect(opened).toBeCloseTo(80);
  });

  it("lets the sun and the sky through as far as it is clear", () => {
    const clear = openingClearFraction(gap(), 0);
    expect(openingSunFraction(gap(), clear)).toBe(1);
    expect(ambientOpeningTransmission(gap(), clear)).toBe(1);
    // …and still answers to the one switch every opening has.
    expect(openingSunFraction(gap({ sunlight: false }), clear)).toBe(0);
  });

  it("throws a beam through the wall it is cut into", () => {
    const wall: Wall = { id: "w", x1: 0, y1: 100, x2: 400, y2: 100 };
    const beam = (o: Opening) =>
      serialize(
        renderSunlight([wall], [o], 400, 400, "sun", {
          dir: down,
          // What the card hands it: the clear fraction of the resolved amount,
          // here a contact that reads shut.
          openAmount: (x) => openingClearFraction(x, 0),
          shutterOpen: () => undefined,
        })
      );
    expect(beam(gap({ y: 100, entity: "binary_sensor.x" }))).toMatch(/<polygon /);
    expect(beam(door({ y: 100, entity: "binary_sensor.x" }))).not.toMatch(/<polygon /);
  });

  it("is the way into a region, as a door is", () => {
    const box: Wall[] = [
      { id: "a", x1: 0, y1: 0, x2: 100, y2: 0 },
      { id: "b", x1: 100, y1: 0, x2: 100, y2: 100 },
      { id: "c", x1: 100, y1: 100, x2: 0, y2: 100 },
      { id: "d", x1: 0, y1: 100, x2: 0, y2: 0 },
    ];
    expect(deadSpaces(box, []).length).toBe(1);
    expect(deadSpaces(box, [gap({ x: 50, y: 0, length: 40 })]).length).toBe(0);
  });
});

describe("the passage symbol", () => {
  const svgOf = (o: Opening) => serialize(renderOpening(o, { color: "#000", accent: "#f00" }));

  it("cuts the wall band like any wall opening", () => {
    const s = serialize(renderWallMask([gap()], 400, 400, "m"));
    // The mask's white ground, and the gap in black over it.
    expect(s.match(/<rect /g)?.length).toBe(2);
    expect(s).toMatch(/width="?80"?[^>]*fill="black"/);
  });

  it("draws no leaf, no arc and no jambs", () => {
    const s = svgOf(gap());
    expect(s).not.toMatch(/<(rect|line|path|polygon|circle)\b/);
    // Whatever the plan says about the door it used to be.
    const was = svgOf(
      gap({ entity: "binary_sensor.x", sash: "double", motion: "slide", flipH: true, sashSpan: 0.5 })
    );
    expect(was).not.toMatch(/<(rect|line|path|polygon|circle)\b/);
  });

  it("keeps its group, so CSS can still find it", () => {
    const s = svgOf(gap({ id: "hall_arch" }));
    expect(s).toContain("fp-opening fp-opening-passage");
    expect(s).toContain("data-id=hall_arch");
    expect(s).toMatch(/translate\(200 200\) rotate\(0\)/);
  });

  it("still draws a shutter hung over the gap", () => {
    const s = serialize(
      renderOpening(gap({ shutterEntity: "cover.grille" }), {
        color: "#000",
        shutter: { amount: 0, style: "roll" },
      })
    );
    expect(s).toMatch(/<(rect|line)\b/);
  });
});
