import { describe, it, expect } from "vitest";
import { renderOpening, renderSunlight } from "./render";
import type { OpeningStyle } from "./render";
import type { Opening } from "./types";
import { nothing } from "lit";

/**
 * Serialize a Lit SVGTemplateResult (and its nested templates/arrays) back into
 * markup so we can assert on the structural invariants of renderOpening — the
 * scale wrapper, swing angle, slider panels and partial-open transforms — which
 * are otherwise only exercised in a browser.
 */
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

const base = { id: "x", x: 100, y: 60, length: 90, angle: 0 } as const;
const svgOf = (o: Partial<Opening>, style: Partial<OpeningStyle> = {}) =>
  serialize(renderOpening({ ...base, ...o } as Opening, { color: "#000", ...style }));

describe("renderSunlight — the markup, not just the geometry", () => {
  // The geometry is covered in render.test.ts. This is here because none of
  // that caught a `<rect …` opened in one lit template and closed in the next:
  // templates are parsed one at a time, so the tag never closed, both masks
  // lost their white ground, and the whole layer rendered invisible while
  // every pure function still returned exactly the right numbers.
  const wall = { id: "w", x1: 0, y1: 100, x2: 400, y2: 100 };
  const win = {
    id: "o",
    type: "window",
    x: 200,
    y: 100,
    length: 60,
    angle: 0,
  } as Opening;
  const sun = { x: 0, y: 1 };
  const walls = [wall];
  const light = (openings: Opening[] = [win], walls = [wall]) =>
    serialize(renderSunlight(walls, openings, 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined }));

  it("gives both masks a ground to subtract from, in one piece", () => {
    const s = light();
    expect(s.match(/<mask /g)?.length).toBe(2);
    // Three rects — a ground in each mask, and the shade itself — and every
    // one of them closes. That count is the whole point: a `<rect` with no `>`
    // is exactly the bug this describe exists for, and it leaves the masks
    // black, which hides what they were meant to shape.
    expect(s.match(/<rect[^>]*>/g)?.length).toBe(3);
    // The white grounds specifically — the shade mask also paints its wall
    // shadows white, which is a different thing wearing the same colour.
    expect(s.match(/<rect[^>]*fill=#fff[^>]*>/g)?.length).toBe(2);
  });

  it("draws a patch per opening that admits light, and a shadow per wall piece", () => {
    const s = light();
    // The window splits its wall in two, so two shadow pieces — and they
    // appear in both masks, while the one beam appears in the shade mask and
    // again as the warm patch itself.
    expect(s.match(/<polygon/g)?.length).toBe(6);
    expect(s).toContain("fp-sunbeam");
    // Two windows in the same wall: a patch each.
    const two = light([win, { ...win, id: "o2", x: 320 } as Opening]);
    expect(two.match(/fp-sunbeam/g)?.length).toBe(2);
  });

  it("stays away entirely when nothing lets light in", () => {
    // A shut door is opaque: no patches, so no layer at all rather than a
    // full-canvas shade sitting over the plan for nothing.
    const shut = { ...win, type: "door" } as Opening;
    expect(renderSunlight([wall], [shut], 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined })).toBe(nothing);
    expect(renderSunlight([wall], [], 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined })).toBe(nothing);
    // …but the same door, open, does let it in.
    expect(renderSunlight([wall], [shut], 400, 400, "sun", { dir: sun, openAmount: () => 1, shutterOpen: () => undefined })).not.toBe(nothing);
  });

  it("an opening standing in a wall's shadow lets nothing in", () => {
    // Every opening used to be a source in its own right, so an interior door
    // on the dark side of the house lit the room beyond it out of nothing.
    // Here a second wall sits upstream of the window, across the light.
    const upstream = { id: "up", x1: 0, y1: 40, x2: 400, y2: 40 };
    expect(renderSunlight([wall, upstream], [win], 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined })).toBe(nothing);
    // Move that wall out of the way (downstream of the window) and the same
    // window lights the room again.
    const downstream = { ...upstream, y1: 300, y2: 300 };
    const s = serialize(renderSunlight([wall, downstream], [win], 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined }));
    expect(s).toContain("fp-sunbeam");
  });

  it("paints with the colours it is given", () => {
    const s = serialize(
      renderSunlight([wall], [win], 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined, light: "#ff0000", shade: "#0000ff" })
    );
    expect(s).toContain("fill:#ff0000");
    expect(s).toContain("fill:#0000ff");
    // …and refuses one that isn't a colour (#64), falling back rather than
    // letting it into a style attribute.
    const nasty = serialize(
      renderSunlight([wall], [win], 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined, light: "red;position:fixed", shade: "#000" })
    );
    expect(nasty).not.toContain("position:fixed");
  });

  it("can draw the light without darkening anything else", () => {
    const s = serialize(
      renderSunlight([wall], [win], 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined, light: "#ff0", shade: null })
    );
    // The patches stay; the shade rect and the mask it needed are simply not
    // built, rather than emitted at zero opacity.
    expect(s).toContain("fp-sunbeam");
    expect(s.match(/<mask /g)?.length).toBe(1);
    expect(s.match(/<rect /g)?.length).toBe(1); // the surviving mask's ground
  });

  it("draws nothing once the sun is below the horizon", () => {
    const night = renderSunlight(walls, [win], 400, 400, "sun", {
      dir: sun,
      openAmount: () => 0,
      shutterOpen: () => undefined,
      strength: 0,
    });
    // Nothing at all, rather than a layer at zero opacity that still costs
    // every polygon on every render.
    expect(night).toBe(nothing);
    // A low sun still lights the room, only more faintly.
    const dusk = serialize(
      renderSunlight(walls, [win], 400, 400, "sun", {
        dir: sun,
        openAmount: () => 0,
        shutterOpen: () => undefined,
        strength: 0.25,
      })
    );
    expect(dusk).toContain("fp-sunbeam");
    const noon = serialize(
      renderSunlight(walls, [win], 400, 400, "sun", {
        dir: sun,
        openAmount: () => 0,
        shutterOpen: () => undefined,
      })
    );
    const op = (s: string) => Number(s.match(/opacity=([0-9.]+)/)![1]);
    expect(op(dusk)).toBeLessThan(op(noon));
  });

  it("takes no pointer events — the plan underneath stays pressable", () => {
    // It spans the whole canvas; the lesson from #108.
    expect(light()).toContain("fp-sunlight");
  });
});

describe("renderOpening — orientation mirror", () => {
  it("wraps the body in an identity scale by default (unchanged output)", () => {
    expect(svgOf({ type: "door" })).toContain("scale(1 1)");
  });
  it("mirrors via flipH / flipV", () => {
    expect(svgOf({ type: "door", flipH: true })).toContain("scale(-1 1)");
    expect(svgOf({ type: "door", flipV: true })).toContain("scale(1 -1)");
    expect(svgOf({ type: "door", flipH: true, flipV: true })).toContain("scale(-1 -1)");
  });
});

describe("renderOpening — swing door", () => {
  it("swings the leaf fully open / closed with the binary open flag", () => {
    expect(svgOf({ type: "door" }, { open: true })).toContain("rotate(-90deg)");
    expect(svgOf({ type: "door" }, { open: false })).toContain("rotate(0deg)");
  });
  it("swings partway for a fractional amount and clamps out-of-range", () => {
    expect(svgOf({ type: "door" }, { amount: 0.5 })).toContain("rotate(-45deg)");
    expect(svgOf({ type: "door" }, { amount: 2 })).toContain("rotate(-90deg)"); // clamp high
    expect(svgOf({ type: "door" }, { amount: -1 })).toContain("rotate(0deg)"); // clamp low
  });
});

describe("renderOpening — double door", () => {
  const dbl = { type: "door", sash: "double" } as Partial<Opening>;

  it("splits the opening into two leaves hinged at opposite jambs", () => {
    const s = svgOf(dbl, { open: false });
    // length 90 → two 45-wide leaves, one per jamb, meeting in the middle.
    expect(s.match(/width=45/g)?.length).toBe(2);
    expect(s).toContain("fp-door-leaf");
    expect(s).toContain("fp-leaf-r");
    expect(s).not.toContain("width=90"); // no full-width leaf left
  });

  it("swings them apart, each its own way", () => {
    const open = svgOf(dbl, { open: true });
    expect(open).toContain("rotate(-90deg)");
    expect(open).toContain("rotate(90deg)");
    const half = svgOf(dbl, { amount: 0.5 });
    expect(half).toContain("rotate(-45deg)");
    expect(half).toContain("rotate(45deg)");
  });

  it("gives each leaf its own arc, sized to that leaf", () => {
    const s = svgOf(dbl, { open: true });
    expect(s.match(/fp-door-arc/g)?.length).toBe(2);
    // Radius = half the opening, the distance that leaf's tip actually sweeps.
    expect(s).toContain("A 45 45");
    expect(s).not.toContain("A 90 90");
  });

  it("stays a door: no jambs, unlike the casement window it mirrors", () => {
    const door = svgOf(dbl, { open: false });
    const window = svgOf({ type: "window" }, { open: false });
    expect(door).not.toContain('stroke-width="2"'); // jamb lines
    expect(window).toContain('stroke-width="2"');
    // Both draw two leaves and two arcs — the jambs are the whole difference.
    expect(door.match(/fp-door-arc/g)?.length).toBe(window.match(/fp-door-arc/g)?.length);
  });

  it("a plain door is untouched — one leaf across the whole opening", () => {
    const single = svgOf({ type: "door" }, { open: true });
    expect(single).toContain("width=90");
    expect(single).not.toContain("fp-leaf-r");
    expect(single.match(/fp-door-arc/g)?.length).toBe(1);
    expect(single).toContain("A 90 90"); // arc radius = the full opening
  });

  it("only swings: a sliding or rolling door ignores the leaf count", () => {
    const slide = svgOf({ type: "door", motion: "slide", sash: "double" } as Partial<Opening>);
    expect(slide).toContain("fp-slide-panel");
    expect(slide).not.toContain("fp-door-arc");
    const roll = svgOf({ type: "door", motion: "roll", sash: "double" } as Partial<Opening>);
    expect(roll).toContain("fp-roll-curtain");
    expect(roll).not.toContain("fp-door-arc");
  });

  it("mirrors as one piece, so flipV opens both leaves into the other room", () => {
    expect(svgOf({ ...dbl, flipV: true })).toContain("scale(1 -1)");
  });
});

const sliding = (extra: Partial<Opening> = {}) =>
  ({ type: "door", motion: "slide", ...extra }) as Partial<Opening>;

describe("renderOpening — sliding door", () => {
  it("draws a single panel that slides the full length when open", () => {
    const closed = svgOf(sliding(), { open: false });
    const open = svgOf(sliding(), { open: true });
    expect(closed).toContain("fp-slide-panel");
    expect(closed).toContain("translateX(0px)");
    expect(open).toContain("translateX(90px)"); // length 90
  });
  it("slides partway for a fractional amount", () => {
    expect(svgOf(sliding(), { amount: 0.5 })).toContain("translateX(45px)");
  });
  it("draws two panels for a bypass slider that stack to one side", () => {
    const bypass = svgOf(sliding({ sliderStyle: "bypass" }), { open: true });
    // two half-width (45) panels + moving panel stacks by -half when open
    expect(bypass.match(/width=45/g)?.length).toBe(2);
    expect(bypass).toContain("translateX(-45px)");
  });
  it("parts two panels in opposite directions for a biparting slider", () => {
    const closed = svgOf(sliding({ sliderStyle: "biparting" }), { open: false });
    const open = svgOf(sliding({ sliderStyle: "biparting" }), { open: true });
    expect(closed.match(/width=45/g)?.length).toBe(2);
    expect(closed).toContain("translateX(0px)"); // meet in the middle when closed
    // one panel recesses left, the other right, by half (45) each when open
    expect(open).toContain("translateX(-45px)");
    expect(open).toContain("translateX(45px)");
  });
  it("draws solid door panels (thickness 2.5)", () => {
    expect(svgOf(sliding(), { open: false })).toContain("height=2.5");
  });
});

// Issue #145: a patio slider whose panels stack over fixed side panels rather
// than recessing into the walls, and one contact sensor per moving panel.
describe("renderOpening — biparting over fixed panels", () => {
  const bipartingBypass = (extra: Partial<Opening> = {}) =>
    sliding({ sliderStyle: "biparting-bypass", ...extra });

  it("splits the opening into four quarter panels", () => {
    const closed = svgOf(bipartingBypass(), { open: false });
    // length 90 → four 22.5 panels: two fixed at the jambs, two moving.
    expect(closed.match(/width=22\.5/g)?.length).toBe(4);
    expect(closed.match(/fp-slide-panel/g)?.length).toBe(2);
    expect(closed).toContain("translateX(0px)"); // meet in the middle when closed
  });
  it("travels a quarter of the opening, so the panels stay inside it", () => {
    const open = svgOf(bipartingBypass(), { open: true });
    // A quarter (22.5) each way — half of what `biparting` travels, because
    // these park over the fixed panels instead of disappearing into the wall.
    expect(open).toContain("translateX(-22.5px)");
    expect(open).toContain("translateX(22.5px)");
    expect(open).not.toContain("translateX(-45px)");
  });
  it("keeps both panels on parallel tracks, like a bypass slider", () => {
    const s = svgOf(bipartingBypass(), { open: false });
    expect(s).toContain("y1=1.75"); // two tracks drawn, as in bypass
    expect(s).toContain("y1=-1.75");
    expect(s).toContain("y=0.5"); // fixed panels ride the front track
    expect(s).toContain("y=-3"); // the moving ones the back track, clear of them
  });
  it("never accents the fixed panels, however open the slider is", () => {
    const open = svgOf(bipartingBypass(), { open: true, active: true, accent: "#f00" });
    // Two moving panels take the accent; the two fixed ones keep the base color.
    expect(open.match(/fill:#f00/g)?.length).toBe(2);
    expect(open.match(/fill=#000/g)?.length).toBe(2);
  });
});

// Issue #145: the two-operable-leaf slider. No fixed panels at all — both
// leaves move, toward each other, and stack over the middle.
describe("renderOpening — converging", () => {
  const converging = (extra: Partial<Opening> = {}) =>
    sliding({ sliderStyle: "converging", ...extra });

  it("draws two half-width moving panels and nothing fixed", () => {
    const closed = svgOf(converging(), { open: false });
    // length 90 → two 45 panels, both of them on a slide group. Contrast with
    // biparting-bypass, which splits the same opening into four quarters.
    expect(closed.match(/width=45/g)?.length).toBe(2);
    expect(closed.match(/fp-slide-panel/g)?.length).toBe(2);
    expect(closed).not.toContain("width=22.5");
    expect(closed).toContain("translateX(0px)"); // meet in the middle when shut
  });

  it("runs the panels toward each other, not apart", () => {
    const open = svgOf(converging(), { open: true });
    // First panel (at the −x jamb) travels +, second −: the opposite of every
    // biparting style, and the whole point of this one.
    expect(open).toContain("translateX(22.5px)");
    expect(open).toContain("translateX(-22.5px)");
  });

  it("stacks over the middle half, clearing a quarter at each jamb", () => {
    const open = svgOf(converging(), { open: true });
    // Panel one spans −45..0 and shifts +22.5 → −22.5..22.5; panel two spans
    // 0..45 and shifts −22.5 → the same. Both land on the middle half, so the
    // outer quarters (−45..−22.5 and 22.5..45) are what actually clears.
    expect(open).toContain("x=-45");
    expect(open).toContain('x="0"');
    expect(open).toContain("width=45");
  });

  it("keeps the panels on parallel tracks so neither blocks the other", () => {
    const s = svgOf(converging(), { open: false });
    expect(s).toContain("y1=1.75"); // two tracks, as in bypass
    expect(s).toContain("y1=-1.75");
    expect(s).toContain("y=0.5"); // first panel on the front track
    expect(s).toContain("y=-3"); // second on the back track, clear of it
  });

  it("accents both panels when both are open — neither one is fixed", () => {
    const open = svgOf(converging(), { open: true, active: true, accent: "#f00" });
    expect(open.match(/fill:#f00/g)?.length).toBe(2);
    expect(open).not.toContain("fill=#000"); // no fixed panel to keep the base color
  });
});

describe("renderOpening — a two-panel slider's second panel (issue #145)", () => {
  // Travel per panel, and which way the *first* one goes. The biparting styles
  // part outward from the centre; `converging` runs the other way, so the same
  // per-panel rules have to hold with both signs.
  const TWO_PANEL = [
    { sliderStyle: "biparting", travel: 45, out: -1 },
    { sliderStyle: "biparting-bypass", travel: 22.5, out: -1 },
    { sliderStyle: "converging", travel: 22.5, out: 1 },
  ] as const;
  for (const { sliderStyle, travel, out } of TWO_PANEL) {
    // Signed travel: `first` is what panel one shows fully open, `second` its
    // opposite number — the panels always move against each other.
    const first = `translateX(${out * travel}px)`;
    const second = `translateX(${-out * travel}px)`;
    describe(sliderStyle, () => {
      it("moves both panels together when no second state is given", () => {
        const open = svgOf(sliding({ sliderStyle }), { amount: 1 });
        expect(open).toContain(first);
        expect(open).toContain(second);
      });
      it("opens one panel while the other stays shut", () => {
        const s = svgOf(sliding({ sliderStyle }), { amount: 1, second: { amount: 0 } });
        expect(s).toContain(first); // first panel open
        expect(s).toContain("translateX(0px)"); // second still closed
        expect(s).not.toContain(second);
      });
      it("opens the second panel while the first stays shut", () => {
        const s = svgOf(sliding({ sliderStyle }), { amount: 0, second: { amount: 1 } });
        expect(s).toContain(second);
        expect(s).toContain("translateX(0px)");
        expect(s).not.toContain(first);
      });
      it("gives each panel its own travel for two position-aware covers", () => {
        const s = svgOf(sliding({ sliderStyle }), { amount: 0.5, second: { amount: 1 } });
        expect(s).toContain(`translateX(${(out * travel) / 2}px)`);
        expect(s).toContain(second);
      });
      it("clamps a second panel's out-of-range amount", () => {
        const s = svgOf(sliding({ sliderStyle }), { amount: 0, second: { amount: 4 } });
        expect(s).toContain(second);
      });
      it("accents only the panel whose own sensor reads open", () => {
        const s = svgOf(sliding({ sliderStyle }), {
          amount: 1,
          active: true,
          accent: "#f00",
          second: { amount: 0, active: false },
        });
        expect(s.match(/fill:#f00/g)?.length).toBe(1); // the open panel only
        expect(s).toContain("fill:#000"); // the shut one keeps the base color
      });
    });
  }
  it("is ignored by the styles that only move one panel", () => {
    for (const sliderStyle of ["single", "bypass"] as const) {
      const s = svgOf(sliding({ sliderStyle }), { amount: 1, second: { amount: 0 } });
      const withoutSecond = svgOf(sliding({ sliderStyle }), { amount: 1 });
      expect(s).toBe(withoutSecond);
    }
  });
});

describe("renderOpening — a hinged double's second leaf (issue #159)", () => {
  // Both shapes with two hinged leaves: a window's casement pair (the type's
  // own default) and the double door #168 added.
  const DOUBLES = [
    { what: "casement window", o: { type: "window" } as Partial<Opening> },
    { what: "double door", o: { type: "door", sash: "double" } as Partial<Opening> },
  ] as const;

  for (const { what, o } of DOUBLES) {
    describe(what, () => {
      it("swings both leaves together when no second state is given", () => {
        const open = svgOf(o, { amount: 1 });
        expect(open).toContain("rotate(-90deg)"); // left leaf
        expect(open).toContain("rotate(90deg)"); // right leaf
      });

      it("opens one leaf while the other stays shut", () => {
        const s = svgOf(o, { amount: 1, second: { amount: 0 } });
        expect(s).toContain("rotate(-90deg)"); // the left one swung
        expect(s).toContain("rotate(0deg)"); // the right one still shut
        expect(s).not.toContain("rotate(90deg)");
      });

      it("opens the second leaf while the first stays shut", () => {
        const s = svgOf(o, { amount: 0, second: { amount: 1 } });
        expect(s).toContain("rotate(90deg)");
        expect(s).toContain("rotate(0deg)");
        expect(s).not.toContain("rotate(-90deg)");
      });

      it("gives each leaf its own travel for two position-aware covers", () => {
        const s = svgOf(o, { amount: 0.5, second: { amount: 1 } });
        expect(s).toContain("rotate(-45deg)");
        expect(s).toContain("rotate(90deg)");
      });

      it("clamps a second leaf's out-of-range amount", () => {
        expect(svgOf(o, { amount: 0, second: { amount: 4 } })).toContain("rotate(90deg)");
        expect(svgOf(o, { amount: 0, second: { amount: -2 } })).not.toContain("rotate(90deg)");
      });

      it("draws each arc from its own leaf's state", () => {
        // arcLen = (pi/2) * 45; the shut leaf's arc is fully offset, the open
        // one's not at all — so a half-open pair shows two different offsets.
        const arcLen = (Math.PI / 2) * 45;
        const s = svgOf(o, { amount: 1, second: { amount: 0 } });
        expect(s).toContain(`stroke-dashoffset:0;`); // the open leaf's arc, drawn on
        expect(s).toContain(`stroke-dashoffset:${arcLen};`); // the shut one's, hidden
      });

      it("accents only the leaf whose own sensor reads open", () => {
        const s = svgOf(o, {
          amount: 1,
          active: true,
          accent: "#f00",
          second: { amount: 0, active: false },
        });
        // The open leaf and its arc take the accent; the shut leaf and arc
        // keep the base colour.
        expect(s.match(/#f00/g)?.length).toBe(2);
        expect(s).toContain("fill:#000");
      });
    });
  }

  it("is ignored where there is only one leaf", () => {
    for (const o of [
      { type: "door" } as Partial<Opening>, // a plain swing door
      { type: "window", sash: "single" } as Partial<Opening>, // a single sash (issue #73)
      { type: "door", motion: "roll" } as Partial<Opening>, // a roll-up curtain
    ]) {
      expect(svgOf(o, { amount: 1, second: { amount: 0 } })).toBe(svgOf(o, { amount: 1 }));
    }
  });
});

describe("renderOpening — sliding window", () => {
  it("slides like a slider but with thin glass panels (thickness 1.5)", () => {
    const win = svgOf({ type: "window", motion: "slide" }, { open: true });
    expect(win).toContain("fp-slide-panel");
    expect(win).toContain("translateX(90px)"); // same slide as a single-panel door
    expect(win).toContain("height=1.5"); // thinner glass panel
    expect(win).not.toContain("height=2.5"); // not a solid door panel
  });
});

describe("renderOpening — roll-up cover (issue #45)", () => {
  it("closed: full-thickness slatted curtain on the track", () => {
    const closed = svgOf({ type: "door", motion: "roll" }, { open: false });
    expect(closed).toContain("fp-roll-curtain");
    expect(closed).toContain("scaleY(1)");
    expect(closed).toContain("height=5"); // curtain band, thicker than any panel
  });

  it("open: the curtain collapses onto the track line", () => {
    expect(svgOf({ type: "door", motion: "roll" }, { open: true })).toContain("scaleY(0)");
  });

  it("partial position thins the curtain proportionally", () => {
    expect(svgOf({ type: "door", motion: "roll" }, { amount: 0.6 })).toContain("scaleY(0.4)");
  });

  it("draws slat ticks so it reads as a shutter, not a slab", () => {
    // length 90 → ~8 slats → 7 interior ticks.
    const closed = svgOf({ type: "door", motion: "roll" }, { open: false });
    expect(closed.match(/var\(--card-background-color, #fff\)/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("nothing travels along the wall — no slide panels, no swing arc", () => {
    const s = svgOf({ type: "door", motion: "roll" }, { amount: 0.5 });
    expect(s).not.toContain("fp-slide-panel");
    expect(s).not.toContain("fp-door-arc");
    expect(s).not.toContain("fp-door-leaf");
  });
});

describe("renderOpening — an open roll-up reads as open (issue #154)", () => {
  const roll = { type: "door", motion: "roll" } as Partial<Opening>;

  it("accents the track, the only mark a wide-open garage leaves behind", () => {
    // The curtain has scaled to nothing at amount 1, so a base-coloured track
    // is indistinguishable from a shut garage — the bug this fixes.
    const open = svgOf(roll, { open: true, active: true, accent: "#ff0000" });
    expect(open).toContain('stroke=#ff0000 stroke-width="0.75"');
    expect(open).toContain('opacity=1'); // full strength: a 0.6 accent reads as neither colour
  });

  it("still accents it half-open, where curtain and track are both on screen", () => {
    const half = svgOf(roll, { amount: 0.5, active: true, accent: "#ff0000" });
    expect(half).toContain('stroke=#ff0000 stroke-width="0.75"');
    expect(half).toContain("scaleY(0.5)");
  });

  it("leaves a shut garage exactly as it was — dimmed track in the base colour", () => {
    const shut = svgOf(roll, { open: false, accent: "#ff0000" });
    expect(shut).toContain('stroke=#000 stroke-width="0.75"');
    expect(shut).toContain('opacity=0.6');
    expect(shut).not.toContain("#ff0000");
  });

  it("keeps the jambs structural: they are wall, not cover, so they never accent", () => {
    const open = svgOf(roll, { open: true, active: true, accent: "#ff0000" });
    expect(open.match(/stroke=#000 stroke-width="2"/g)?.length).toBe(2);
  });
});

describe("renderOpening — single-sash window (issue #73)", () => {
  const single = { type: "window", sash: "single" } as Partial<Opening>;

  it("draws one full-width sash and one arc instead of two casement leaves", () => {
    const s = svgOf(single, { open: true });
    expect(s.match(/fp-door-leaf/g)?.length).toBe(1);
    expect(s).not.toContain("fp-leaf-r");
    expect(s.match(/fp-door-arc/g)?.length).toBe(1);
    expect(s).toContain("width=90"); // sash spans the full opening
  });

  it("double stays the historic two-leaf look (default unchanged)", () => {
    const d = svgOf({ type: "window" }, { open: true });
    expect(d).toContain("fp-door-leaf");
    expect(d).toContain("fp-leaf-r");
    expect(svgOf({ type: "window", sash: "double" } as Partial<Opening>, { open: true })).toContain(
      "fp-leaf-r",
    );
  });

  it("hinge follows flipH via the mirror wrapper", () => {
    expect(svgOf({ ...single, flipH: true })).toContain("scale(-1 1)");
  });
});

describe("renderOpening — external shutter layer (issue #74)", () => {
  it("layers the roll curtain over the window body", () => {
    const s = svgOf({ type: "window" }, { open: true, shutter: { amount: 0.25 } });
    expect(s).toContain("fp-roll-curtain");
    expect(s).toContain("scaleY(0.75)"); // 1 - amount
    expect(s).toContain("fp-leaf-r"); // the window itself still renders
  });

  it("no shutter style, no curtain (existing windows unchanged)", () => {
    expect(svgOf({ type: "window" }, { open: true })).not.toContain("fp-roll-curtain");
  });

  it("shutter accent is independent of the window's active state", () => {
    const s = svgOf({ type: "window" }, {
      open: false,
      active: false,
      accent: "#ff0000",
      shutter: { amount: 0.5, active: true },
    });
    expect(s).toContain("#ff0000"); // curtain wears the accent while the sash doesn't
  });
});

describe("renderOpening — hinged external shutter (issue #74)", () => {
  const win = { type: "window" } as Partial<Opening>;

  it("closed: two louvered panels lying across the opening, outside the wall", () => {
    const s = svgOf(win, { open: false, shutter: { amount: 0, style: "swing" } });
    // One panel hinged at each jamb, neither rotated while shut.
    expect(s).toContain("rotate(0deg)");
    expect(s).toContain("fp-door-leaf");
    expect(s).toContain("fp-leaf-r");
    // Panels sit beyond the wall band (positive y), clear of the casement sashes.
    expect(s).toMatch(/translate\(-45 [0-9.]+\)/);
    // Louver ticks are drawn in the background colour.
    expect(s).toContain("var(--card-background-color, #fff)");
  });

  it("open: both panels fold back to the wall, in opposite directions", () => {
    const s = svgOf(win, { open: false, shutter: { amount: 1, style: "swing" } });
    expect(s).toContain("rotate(90deg)");
    expect(s).toContain("rotate(-90deg)");
  });

  it("partial: panels swing proportionally", () => {
    const s = svgOf(win, { open: false, shutter: { amount: 0.5, style: "swing" } });
    expect(s).toContain("rotate(45deg)");
    expect(s).toContain("rotate(-45deg)");
  });

  it("swing draws no roll curtain, and roll draws no hinged panels", () => {
    const swing = svgOf(win, { open: false, shutter: { amount: 0.5, style: "swing" } });
    expect(swing).not.toContain("fp-roll-curtain");
    const roll = svgOf(win, { open: false, shutter: { amount: 0.5, style: "roll" } });
    expect(roll).toContain("fp-roll-curtain");
  });

  it("the window underneath still renders its own sashes", () => {
    const s = svgOf(win, { open: true, shutter: { amount: 0, style: "swing" } });
    // Casement leaves swung open behind a shut shutter — both are true at once.
    expect(s).toContain("rotate(-90deg)");
    expect(s).toContain("rotate(0deg)");
  });
});

describe("renderOpening — which side the shutter hangs on (issue #74 follow-up)", () => {
  const win = { type: "window" } as Partial<Opening>;
  // cutH/2 + t/2 = (8 + 4)/2 + 3/2
  const OFFSET = 7.5;

  it("hangs the panels on the far side of the wall by default", () => {
    const s = svgOf(win, { open: false, shutter: { amount: 0.5, style: "swing" } });
    expect(s).toContain(`translate(-45 ${OFFSET})`);
    expect(s).toContain(`translate(45 ${OFFSET})`);
  });

  it("flip moves them to the sash's own side, offset and all", () => {
    const s = svgOf(win, { open: false, shutter: { amount: 0.5, style: "swing", flip: true } });
    expect(s).toContain(`translate(-45 ${-OFFSET})`);
    expect(s).toContain(`translate(45 ${-OFFSET})`);
    expect(s).not.toContain(`translate(-45 ${OFFSET})`);
  });

  it("flipped panels still fold away from the wall, not through it", () => {
    // Same two angles either way — what changes is which panel takes which,
    // so that both still swing outward from their own jamb.
    const far = svgOf(win, { open: false, shutter: { amount: 0.5, style: "swing" } });
    expect(far).toMatch(/translate\(-45 7\.5\)[\s\S]*?fp-door-leaf" style="transform:rotate\(45deg\)/);
    expect(far).toMatch(/translate\(45 7\.5\)[\s\S]*?fp-leaf-r" style="transform:rotate\(-45deg\)/);
    const near = svgOf(win, { open: false, shutter: { amount: 0.5, style: "swing", flip: true } });
    expect(near).toMatch(/translate\(-45 -7\.5\)[\s\S]*?fp-door-leaf" style="transform:rotate\(-45deg\)/);
    expect(near).toMatch(/translate\(45 -7\.5\)[\s\S]*?fp-leaf-r" style="transform:rotate\(45deg\)/);
  });

  it("shut is shut on either side — the panels still cover the opening", () => {
    const near = svgOf(win, { open: false, shutter: { amount: 0, style: "swing", flip: true } });
    expect(near).toContain("rotate(0deg)");
    expect(near).toContain(`translate(-45 ${-OFFSET})`);
  });

  it("the roll curtain ignores the side — it is symmetric about the wall line", () => {
    const plain = svgOf(win, { open: false, shutter: { amount: 0.4, style: "roll" } });
    const flipped = svgOf(win, { open: false, shutter: { amount: 0.4, style: "roll", flip: true } });
    expect(flipped).toBe(plain);
  });
});

describe("renderOpening — a hinged shutter's second panel (issue #159)", () => {
  // A window with a single sash, so the only leaves in the markup are the
  // shutter's own pair — the sash's own second-leaf plumbing is tested above,
  // and this keeps the two from being confused for each other.
  const win = { type: "window", sash: "single" } as Partial<Opening>;
  const shut = { amount: 0, style: "swing" } as const;

  it("folds both panels together when no second state is given", () => {
    const s = svgOf(win, { open: false, shutter: { ...shut, amount: 1 } });
    expect(s).toContain("rotate(90deg)");
    expect(s).toContain("rotate(-90deg)");
  });

  it("folds one panel back while the other stays across the glass", () => {
    const s = svgOf(win, {
      open: false,
      shutter: { ...shut, amount: 1, second: { amount: 0 } },
    });
    expect(s).toContain("rotate(90deg)"); // the folded panel
    expect(s).toContain("rotate(0deg)"); // the one still shut
    expect(s).not.toContain("rotate(-90deg)");
  });

  it("folds the second panel while the first stays shut", () => {
    const s = svgOf(win, { open: false, shutter: { ...shut, second: { amount: 1 } } });
    expect(s).toContain("rotate(-90deg)");
    expect(s).toContain("rotate(0deg)");
    expect(s).not.toContain("rotate(90deg)");
  });

  it("gives each panel its own travel, and clamps a junk reading", () => {
    expect(
      svgOf(win, { open: false, shutter: { ...shut, amount: 0.5, second: { amount: 1 } } })
    ).toContain("rotate(45deg)");
    expect(svgOf(win, { open: false, shutter: { ...shut, second: { amount: 9 } } })).toContain(
      "rotate(-90deg)"
    );
  });

  it("still swings away from the wall on the near side", () => {
    // flip mirrors both panels, so the second one's angle flips with it.
    const s = svgOf(win, {
      open: false,
      shutter: { ...shut, flip: true, second: { amount: 1 } },
    });
    expect(s).toMatch(/fp-leaf-r" style="transform:rotate\(90deg\)/);
  });

  it("accents only the panel whose own contact reads open", () => {
    const s = svgOf(win, {
      open: false,
      shutter: { ...shut, amount: 1, active: true, accent: "#0f0", second: { amount: 0 } },
    });
    expect(s.match(/fill:#0f0/g)?.length).toBe(1); // the folded panel only
    expect(s).toContain("fill:#000"); // the shut one keeps the base colour
  });

  it("the roll curtain ignores it — a slat band is one piece", () => {
    const plain = svgOf(win, { open: false, shutter: { amount: 0.4, style: "roll" } });
    const withSecond = svgOf(win, {
      open: false,
      shutter: { amount: 0.4, style: "roll", second: { amount: 1 } },
    });
    expect(withSecond).toBe(plain);
  });
});

describe("renderOpening — the symbol stays a symbol (issue #74 follow-up)", () => {
  const bound = { entity: "binary_sensor.win", shutterEntity: "cover.tapparella" };

  it("draws no badge of its own for the second entity", () => {
    // The shutter badge is HTML in the overlay, not SVG: it carries a real
    // ha-icon and is sized in screen pixels. See shutterMarkPoint / the card.
    const s = svgOf({ type: "window", ...bound }, { shutter: { amount: 0.5 } });
    expect(s).not.toContain("<circle");
    expect(s).not.toContain("<title>");
    // …and binding the second entity adds nothing to the symbol: the shutter
    // is drawn from `style.shutter`, which the host resolves either way.
    expect(s).toBe(
      svgOf({ type: "window", entity: "binary_sensor.win" }, { shutter: { amount: 0.5 } })
    );
  });
});

describe("renderOpening — the shutter's own accent (issue #74 follow-up)", () => {
  const win = { type: "window" } as Partial<Opening>;

  it("an open shutter wears its own accent, not the opening's", () => {
    const s = svgOf(win, {
      open: true,
      active: true,
      accent: "#ff0000",
      shutter: { amount: 0.5, active: true, accent: "#00ff00" },
    });
    expect(s).toContain("#00ff00"); // the curtain
    expect(s).toContain("#ff0000"); // the sash it covers, unchanged
  });

  it("falls back to the opening's accent when it has none of its own", () => {
    const s = svgOf(win, {
      open: false,
      accent: "#ff0000",
      shutter: { amount: 0.5, active: true },
    });
    expect(s).toContain("#ff0000");
    expect(s).not.toContain("#00ff00");
  });

  it("an accent it isn't wearing yet paints nothing — a shut shutter is base colour", () => {
    const s = svgOf(win, {
      open: false,
      shutter: { amount: 0, active: false, accent: "#00ff00", style: "swing" },
    });
    expect(s).not.toContain("#00ff00");
    expect(s).toContain("#000"); // the base colour passed as `color`
  });

  it("applies to the hinged panels as well as the roll curtain", () => {
    const swing = svgOf(win, {
      open: false,
      shutter: { amount: 0.5, active: true, accent: "#00ff00", style: "swing" },
    });
    expect(swing).toContain("fill:#00ff00");
  });
});
