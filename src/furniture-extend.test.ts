import { describe, it, expect } from "vitest";
import { shownFurniture, shownPieces } from "./render";
import { BUILTIN_SYMBOLS, normalizeSymbol } from "./symbols";
import { furnitureForm } from "./editor-forms";
import { furnitureSolid } from "./projection";
import type { Furniture } from "./types";

const cover = (pos: number) => ({ state: pos > 0 ? "open" : "closed", attributes: { current_position: pos } });
const awning: Furniture = { id: "a", type: "awning", x: 500, y: 300, w: 300, h: 200, entity: "cover.awning" };
const curtain: Furniture = { id: "c", type: "curtain", x: 500, y: 300, w: 160, h: 12, entity: "cover.curtain" };

describe("awning and curtain follow their cover (issue #196)", () => {
  it("ships both symbols with their extend and elevation", () => {
    expect(BUILTIN_SYMBOLS.awning.extend).toEqual({ axis: "h", min: 0.06, open: "extended" });
    expect(BUILTIN_SYMBOLS.curtain.extend).toEqual({ axis: "w", min: 0.14, open: "retracted" });
    expect(BUILTIN_SYMBOLS.awning.elevation).toEqual({ from: 0.74, to: 0.78 });
  });

  it("draws an awning at full size when fully extended, and from the wall edge when not", () => {
    expect(shownFurniture(awning, cover(100))).toBe(awning);
    const half = shownFurniture(awning, cover(50));
    expect(half.h).toBeCloseTo(200 * (0.06 + 0.94 * 0.5));
    // The top edge (the wall) stays where it was.
    expect(half.y - half.h / 2).toBeCloseTo(300 - 100);
    expect(half.x).toBeCloseTo(500);
    const closed = shownFurniture(awning, cover(0));
    expect(closed.h).toBeCloseTo(12);
    expect(closed.y - closed.h / 2).toBeCloseTo(200);
  });

  it("keeps the wall edge put when the piece is rotated", () => {
    const turned = { ...awning, angle: 90 };
    const half = shownFurniture(turned, cover(50));
    // Rotated 90°, the piece's top edge is its right side in plan.
    expect(half.x + half.h / 2).toBeCloseTo(500 + 100);
    expect(half.y).toBeCloseTo(300);
  });

  it("draws a curtain across when the cover is closed, gathered when open", () => {
    expect(shownFurniture(curtain, cover(0))).toBe(curtain);
    const open = shownFurniture(curtain, cover(100));
    expect(open.w).toBeCloseTo(160 * 0.14);
    expect(open.x - open.w / 2).toBeCloseTo(500 - 80);
    const right = shownFurniture({ ...curtain, hand: "left" }, cover(100));
    expect(right.x + right.w / 2).toBeCloseTo(500 + 80);
  });

  it("splits a center curtain into two halves that gather at both ends", () => {
    const pair = { ...curtain, hand: "center" as const };
    const [l, r] = shownPieces(pair, cover(0));
    // Closed: the two halves meet in the middle and cover the whole width.
    expect(l!.w).toBeCloseTo(80);
    expect(l!.x - l!.w / 2).toBeCloseTo(420);
    expect(l!.x + l!.w / 2).toBeCloseTo(500);
    expect(r!.x - r!.w / 2).toBeCloseTo(500);
    expect(r!.x + r!.w / 2).toBeCloseTo(580);
    expect([l!.hand, r!.hand]).toEqual(["right", "left"]);
    // Open: each half bunched at its own end.
    const [lo, ro] = shownPieces(pair, cover(100));
    expect(lo!.w).toBeCloseTo(80 * 0.14);
    expect(lo!.x - lo!.w / 2).toBeCloseTo(420);
    expect(ro!.x + ro!.w / 2).toBeCloseTo(580);
    expect(lo!.id).toBe("c");
    expect(ro!.id).toBe("c");
  });

  it("splits a rotated center curtain along its own width", () => {
    const [l, r] = shownPieces({ ...curtain, hand: "center", angle: 90 }, cover(0));
    expect(l!.x).toBeCloseTo(500);
    expect(l!.y).toBeCloseTo(260);
    expect(r!.y).toBeCloseTo(340);
  });

  it("gives one piece for anything that is not a center curtain", () => {
    expect(shownPieces(curtain, cover(0))).toEqual([curtain]);
    expect(shownPieces({ ...awning, hand: "center" }, cover(100))).toHaveLength(1);
  });

  it("fails to retracted on an outage, and leaves an unbound piece or ordinary furniture alone", () => {
    expect(shownFurniture(awning, { state: "unavailable" }).h).toBeCloseTo(12);
    const unbound = { ...awning, entity: undefined };
    expect(shownFurniture(unbound, cover(0))).toBe(unbound);
    const sofa: Furniture = { id: "s", type: "sofa", x: 0, y: 0, w: 100, h: 50, entity: "cover.x" };
    expect(shownFurniture(sofa, cover(0))).toBe(sofa);
  });

  it("draws a curtain fully across on an outage, like a closed cover", () => {
    expect(shownFurniture(curtain, { state: "unavailable" })).toBe(curtain);
    expect(shownFurniture(curtain, undefined)).toBe(curtain);
    const [l, r] = shownPieces({ ...curtain, hand: "center" }, { state: "unavailable" });
    expect(l!.w + r!.w).toBeCloseTo(160);
  });

  it("raises a hanging piece's 3D block between its two heights", () => {
    const flat = (x: number, y: number) => ({ x, y });
    const block = furnitureSolid(awning, flat, 60 * 0.78, "#888", undefined, 60 * 0.74);
    expect(block.z0).toBeCloseTo(44.4);
    expect(block.z1).toBeCloseTo(46.8);
    // The footprint is unchanged by the lift: the piece's own rectangle.
    expect(block.base[0]).toEqual({ x: 350, y: 200 });
    expect(block.base[2]).toEqual({ x: 650, y: 400 });
    // A standing piece still starts on the floor.
    expect(furnitureSolid(awning, flat, 20, "#888").z0).toBe(0);
  });

  it("reads open/closed when a cover has no position", () => {
    expect(shownFurniture(awning, { state: "open" })).toBe(awning);
    expect(shownFurniture(awning, { state: "closed" }).h).toBeCloseTo(12);
  });

  it("parses extend and elevation from a custom symbol, dropping bad ones whole", () => {
    const base = { id: "x", parts: [{ rect: [0, 0, 100, 100] }] };
    expect(normalizeSymbol({ ...base, extend: { axis: "w", min: 0.2, open: "retracted" } })!.extend)
      .toEqual({ axis: "w", min: 0.2, open: "retracted" });
    expect(normalizeSymbol({ ...base, extend: { axis: "z" } })!.extend).toBeUndefined();
    expect(normalizeSymbol({ ...base, extend: { axis: "h", min: 5 } })!.extend).toEqual({ axis: "h", min: 0, open: "extended" });
    expect(normalizeSymbol({ ...base, elevation: { from: 0.8, to: 0.2 } })!.elevation).toBeUndefined();
    expect(normalizeSymbol({ ...base, elevation: { from: 0.2, to: 0.4 } })!.elevation).toEqual({ from: 0.2, to: 0.4 });
  });

  it("offers the gathering side on a curtain only", () => {
    const names = (f: Furniture) => furnitureForm(f).fields.map((x) => x.name);
    expect(names(curtain)).toContain("hand");
    expect(names(awning)).not.toContain("hand");
    expect(furnitureForm(curtain).data.hand).toBe("right");
  });
});
