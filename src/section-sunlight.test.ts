import { describe, it, expect } from "vitest";
import { floorSunLight, moonlightOf, sectionFacingOf, sectionLightDirection, SUN_REACH_REF } from "./render";
import { floorImageForm } from "./editor-forms";

const deg = (v: { x: number; y: number }) => (Math.atan2(v.y, Math.abs(v.x)) * 180) / Math.PI;

describe("vertical section sunlight (issue #414)", () => {
  it("comes down at the sun's elevation when the sun is square to the cut", () => {
    // Looking north; the sun due east is to the right, so light travels left.
    const noon = sectionLightDirection(0, 90, 60);
    expect(noon.x).toBeLessThan(0);
    expect(noon.y).toBeGreaterThan(0);
    expect(deg(noon)).toBeCloseTo(60, 6);
    const evening = sectionLightDirection(0, 90, 10);
    expect(deg(evening)).toBeCloseTo(10, 6);
  });

  it("comes from the left when the sun is on the viewer's left", () => {
    const d = sectionLightDirection(0, 270, 30);
    expect(d.x).toBeGreaterThan(0);
  });

  it("falls straight down for a sun in front of or behind the viewer", () => {
    for (const az of [0, 180]) {
      const d = sectionLightDirection(0, az, 30);
      expect(Math.abs(d.x)).toBeLessThan(1e-9);
      expect(d.y).toBeCloseTo(1, 9);
    }
  });

  it("looks steeper when the sun is oblique to the cut", () => {
    expect(deg(sectionLightDirection(0, 135, 30))).toBeGreaterThan(30);
  });

  it("turns with the facing", () => {
    const a = sectionLightDirection(0, 90, 40);
    const b = sectionLightDirection(90, 180, 40);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
  });

  it("is always a unit vector, even at the horizon and zenith", () => {
    for (const e of [-20, 0, 1, 45, 89, 90, 120]) {
      const d = sectionLightDirection(10, 200, e);
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 9);
      expect(d.y).toBeGreaterThan(0);
    }
  });

  it("leaves a plan floor exactly as before", () => {
    const r = floorSunLight({ north: 0 }, { }, 90, 40);
    expect(r.scaleReach).toBe(true);
    expect(r.dir.x).toBeCloseTo(-1, 9);
    expect(r.dir.y).toBeCloseTo(0, 9);
  });

  it("aims a section by elevation and stops scaling its reach", () => {
    const r = floorSunLight({}, { sectionFacing: 0 }, 90, 50);
    expect(r.scaleReach).toBe(false);
    expect(deg(r.dir)).toBeCloseTo(50, 6);
  });

  it("gives a pinned or unreadable sun the reference height", () => {
    const pinned = floorSunLight({ sunBearing: 90 }, { sectionFacing: 0 }, 270, 70);
    expect(pinned.dir.x).toBeLessThan(0);
    expect(deg(pinned.dir)).toBeCloseTo(SUN_REACH_REF, 6);
    const dead = floorSunLight({}, { sectionFacing: 0 }, 90, "unavailable");
    expect(deg(dead.dir)).toBeCloseTo(SUN_REACH_REF, 6);
  });

  it("treats north (0) as a real facing and junk as a plan", () => {
    expect(sectionFacingOf({ sectionFacing: 0 })).toBe(0);
    expect(sectionFacingOf({ sectionFacing: Number.NaN })).toBeUndefined();
    expect(sectionFacingOf({ sectionFacing: "90" as never })).toBeUndefined();
    expect(sectionFacingOf(undefined)).toBeUndefined();
  });

  it("aims the moon on a section by its altitude", () => {
    const loc = { latitude: 51.5, longitude: -0.1 };
    // Search a month of nights for a moment the moon is up after dark.
    const start = Date.UTC(2026, 0, 1);
    for (let h = 0; h < 24 * 30; h++) {
      const t = start + h * 3600_000;
      const plan = moonlightOf({ north: 0 }, t, loc, -20);
      if (!plan) continue;
      const section = moonlightOf({ north: 0, sectionFacing: 0 }, t, loc, -20)!;
      expect(section.dir.y).toBeGreaterThan(0);
      expect(Math.hypot(section.dir.x, section.dir.y)).toBeCloseTo(1, 9);
      return;
    }
    throw new Error("no moonlit hour found");
  });
});

describe("floor form: vertical section", () => {
  it("shows the facing only on a section", () => {
    const plan = floorImageForm({ id: "f", name: "GF" } as never);
    expect(plan.fields.some((f) => f.name === "sectionFacing")).toBe(false);
    expect(plan.data.isSection).toBe(false);
    const section = floorImageForm({ id: "f", name: "S", sectionFacing: 0 } as never);
    expect(section.fields.some((f) => f.name === "sectionFacing")).toBe(true);
    expect(section.data.isSection).toBe(true);
  });

  it("switches on at north, keeps an existing facing, and clears when off", () => {
    const plan = floorImageForm({ id: "f", name: "GF" } as never);
    expect(plan.toPatch({ isSection: true })).toEqual({ sectionFacing: 0 });
    const section = floorImageForm({ id: "f", name: "S", sectionFacing: 135 } as never);
    expect(section.toPatch({ isSection: true })).toEqual({ sectionFacing: 135 });
    expect(section.toPatch({ isSection: false })).toEqual({ sectionFacing: undefined });
    expect(section.toPatch({ sectionFacing: 370 })).toEqual({ sectionFacing: 10 });
  });
});
