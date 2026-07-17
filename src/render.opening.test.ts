import { describe, it, expect } from "vitest";
import { renderOpening } from "./render";
import type { OpeningStyle } from "./render";
import type { Opening } from "./types";

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
