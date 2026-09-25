import { describe, expect, it } from "vitest";
import { openingSolids } from "./projection-openings";
import { rotatePlanPoint, type OpeningStyle, type PlanRotation } from "./render";
import type { Opening } from "./types";

const door: Opening = { id: "door", type: "door", x: 100, y: 100, length: 80, angle: 0 };
const identity = (x: number, y: number) => ({ x, y });
const panels = (o: Partial<Opening> = {}, style: Partial<OpeningStyle> = {}) =>
  openingSolids({ ...door, ...o }, { color: "#333333", amount: 0, ...style }, identity, 60)
    .filter((s) => s.kind === "panel");

describe("standing openings", () => {
  it("keeps the hinge fixed and swings a full-length leaf off the wall", () => {
    expect(panels()[0].base).toEqual([{ x: 60, y: 100 }, { x: 140, y: 100 }]);
    const open = panels({}, { amount: 1 })[0];
    expect(open.base[0]).toEqual({ x: 60, y: 100 });
    expect(open.base[1].x).toBeCloseTo(60);
    expect(open.base[1].y).toBeCloseTo(20);
    const partial = panels({}, { amount: 0.5 })[0];
    expect(Math.hypot(partial.base[1].x - 60, partial.base[1].y - 100)).toBeCloseTo(80);
    expect(partial.z0).toBe(0);
    expect(partial.z1).toBe(51);
  });

  it.each([0, 90, 180, 270] as PlanRotation[])("applies hinge/swing mirrors before display rotation %s", (rotation) => {
    const solids = openingSolids({ ...door, flipH: true, flipV: true }, { color: "#333", amount: 1 },
      (x, y) => rotatePlanPoint(x, y, 400, 300, rotation), 60);
    const panel = solids.find((s) => s.kind === "panel")!;
    expect(panel.base[0]).toEqual(rotatePlanPoint(140, 100, 400, 300, rotation));
    const end = rotatePlanPoint(140, 180, 400, 300, rotation);
    expect(panel.base[1].x).toBeCloseTo(end.x);
    expect(panel.base[1].y).toBeCloseTo(end.y);
  });

  it("reads each window contact independently and raises the sashes above the sill", () => {
    const [left, right] = panels({ type: "window" }, {
      amount: 1, active: true, accent: "#00ff00", inactive: "#ff0000", second: { amount: 0 },
    });
    expect(left.base[1].y).toBeCloseTo(60);
    expect(right.base[1]).toEqual({ x: 100, y: 100 });
    expect(left.z0).toBe(21);
    expect(left.glazed).toBe(true);
    expect(left.color).toBe("#00ff00");
    expect(right.color).toBe("#ff0000");
  });

  it("keeps the fixed part of a narrow sash glazed and in its frame", () => {
    const [leaf, fixed] = panels({ sash: "single", sashSpan: 0.5 }, { amount: 1 });
    expect(leaf.base[1].y).toBeCloseTo(60);
    expect(fixed.base).toEqual([{ x: 100, y: 100 }, { x: 140, y: 100 }]);
    expect(fixed.glazed).toBe(true);
  });

  it("rolls upward and leaves a standing hit target when fully open", () => {
    expect(panels({ motion: "roll" }, { amount: 0.5 })[0].z0).toBe(25.5);
    expect(panels({ motion: "roll" }, { amount: 1 })).toEqual([]);
    expect(openingSolids({ ...door, motion: "roll" }, { color: "#333", amount: 1 }, identity, 60))
      .toMatchObject([{ kind: "opening-hit", z0: 0, z1: 51 }]);
  });

  it("tilts an awning about its head while retaining panel height", () => {
    const panel = panels({ type: "window", motion: "awning" }, { amount: 0.5 })[0];
    const [bottom, , , top] = panel.vertices!;
    expect(top).toEqual({ x: 60, y: 100, z: 51 });
    expect(Math.hypot(bottom.y - top.y, bottom.z - top.z)).toBeCloseTo(30);
    expect(bottom.y).toBeLessThan(100);
  });

  it.each([
    ["single", 1], ["bypass", 2], ["biparting", 2], ["biparting-bypass", 4], ["converging", 2],
  ] as const)("draws all %s sliding panels", (sliderStyle, count) => {
    const shut = panels({ motion: "slide", sliderStyle });
    const open = panels({ motion: "slide", sliderStyle }, { amount: 1, second: { amount: 0 } });
    expect(open).toHaveLength(count);
    expect(open).not.toEqual(shut);
    expect(open.every((s) => s.base[0].y === s.base[1].y)).toBe(true);
  });

  it("keeps fixed glazing still and uses a shutter's independent position", () => {
    const [glass, shutter] = panels({ type: "window", motion: "fixed" }, {
      amount: 1, active: true, accent: "#00ff00", shutter: { amount: 0.5 },
    });
    expect(glass.base).toEqual([{ x: 60, y: 100 }, { x: 140, y: 100 }]);
    expect(glass.color).toBe("#333333");
    expect(shutter.z0).toBe(36);
    expect(shutter.glazed).toBe(false);
  });

  it("uses the same safe accent fallback as the flat symbol", () => {
    const panel = panels({}, { amount: 1, active: true, accent: "red;opacity:0" })[0];
    expect(panel.color).toBe("var(--fp-skin-accent, var(--primary-color, #03a9f4))");
  });

  describe("roof windows", () => {
    const velux: Partial<Opening> = { type: "skylight", length: 80, width: 40 };
    const solids = (o: Partial<Opening> = {}, style: Partial<OpeningStyle> = {}) =>
      openingSolids({ ...door, ...velux, ...o }, { color: "#333333", amount: 0, ...style }, identity, 60);

    it("lies flat in the roof plane at the wall tops when shut", () => {
      const [sash] = panels(velux);
      expect(sash.glazed).toBe(true);
      expect(sash.vertices!.map((v) => v.z)).toEqual([60, 60, 60, 60]);
      // The rectangle it is: length along x, width across y, centred on it.
      expect(sash.vertices!.map(({ x, y }) => [x, y])).toEqual([[60, 80], [140, 80], [140, 120], [60, 120]]);
    });

    it("tilts about its head, to 60° out of the roof when fully open", () => {
      const [sash] = panels(velux, { amount: 1 });
      const [hingeA, hingeB, freeB, freeA] = sash.vertices!;
      expect(hingeA).toEqual({ x: 60, y: 80, z: 60 });
      expect(hingeB).toEqual({ x: 140, y: 80, z: 60 });
      expect(freeA.z).toBeCloseTo(60 + 40 * Math.sin(Math.PI / 3));
      expect(freeA.y).toBeCloseTo(80 + 40 * Math.cos(Math.PI / 3));
      expect(freeB.x).toBeCloseTo(140);
      // Half open, the free edge is still the width away from the hinge.
      const [half] = panels(velux, { amount: 0.5 });
      const free = half.vertices![3];
      expect(Math.hypot(free.y - 80, free.z - 60)).toBeCloseTo(40);
      expect(free.z).toBeGreaterThan(60);
      expect(free.y).toBeLessThan(120);
    });

    it("hangs from the other edge under flipV", () => {
      const [sash] = panels({ ...velux, flipV: true }, { amount: 1 });
      expect(sash.vertices![0]).toEqual({ x: 60, y: 120, z: 60 });
      expect(sash.vertices![3].z).toBeCloseTo(60 + 40 * Math.sin(Math.PI / 3));
      expect(sash.vertices![3].y).toBeCloseTo(120 - 40 * Math.cos(Math.PI / 3));
    });

    it("keeps the whole aperture as a target and draws the blind as far as it has come down", () => {
      const all = solids({}, { shutter: { amount: 0.25, style: "roll" } });
      const hit = all.find((s) => s.kind === "opening-hit")!;
      expect(hit.vertices!.map((v) => v.z)).toEqual([60, 60, 60, 60]);
      const [blind, sash] = all.filter((s) => s.kind === "panel");
      expect(blind.glazed).toBe(false);
      // Three quarters closed: covers three quarters of the width from the hinge.
      expect(blind.vertices!.map((v) => v.y)).toEqual([80, 80, 110, 110]);
      expect(sash.glazed).toBe(true);
      // The blind is fully up: nothing to draw.
      expect(solids({}, { shutter: { amount: 1, style: "roll" } }).filter((s) => s.kind === "panel")).toHaveLength(1);
    });

    it("is not a panel in the wall plane at any rotation", () => {
      for (const rotation of [0, 90, 180, 270] as PlanRotation[]) {
        const [sash] = openingSolids({ ...door, ...velux } as Opening, { color: "#333", amount: 0 },
          (x, y) => rotatePlanPoint(x, y, 400, 300, rotation), 60).filter((s) => s.kind === "panel");
        expect(sash.vertices).toHaveLength(4);
        expect(sash.vertices![0]).toEqual({ ...rotatePlanPoint(60, 80, 400, 300, rotation), z: 60 });
      }
    });
  });

  it("stands nothing in a passage but its shutter (issue #309)", () => {
    // Not even when a hand-written plan says how its leaf would move.
    for (const motion of [undefined, "swing", "slide", "fixed", "roll", "awning"] as const) {
      expect(panels({ type: "passage", motion }, { amount: 1 })).toEqual([]);
    }
    // The gap is still what a tap lands on, at a doorway's height.
    const solids = openingSolids({ ...door, type: "passage" }, { color: "#333" }, identity, 60);
    expect(solids.map((s) => s.kind)).toEqual(["opening-hit"]);
    expect(solids[0].z0).toBe(0);
    // A grille over the gap is the one thing that does stand in it.
    const [grille] = panels({ type: "passage" }, { shutter: { amount: 0.5 } });
    expect(grille.base).toEqual([{ x: 60, y: 102 }, { x: 140, y: 102 }]);
    expect(grille.glazed).toBe(false);
  });

  it("does not emit standing geometry for zero-height relief", () => {
    expect(openingSolids(door, { color: "#333" }, identity, 0)).toEqual([]);
  });
});
