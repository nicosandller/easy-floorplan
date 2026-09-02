import { describe, expect, it } from "vitest";
import type { Area } from "./types";
import type { AmbientDaylightPatch } from "./ambient-daylight";
import { buildAmbientDaylightRenderModel } from "./ambient-daylight-render";

const area: Area = {
  id: "bedroom",
  points: [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 0, y: 300 },
  ],
};

const patch: AmbientDaylightPatch = {
  openingId: "north-window",
  areaId: "bedroom",
  points: [
    { x: 150, y: 0 },
    { x: 250, y: 0 },
    { x: 430, y: 250 },
    { x: -30, y: 250 },
  ],
  gradientStart: { x: 200, y: 0 },
  gradientEnd: { x: 200, y: 250 },
  opacity: 0.28,
};

describe("ambient daylight SVG instance isolation", () => {
  it("uses idPrefix to prevent clip/filter/gradient collisions across two cards", () => {
    const first = buildAmbientDaylightRenderModel(area, [patch], { idPrefix: "card-instance-a" });
    const second = buildAmbientDaylightRenderModel(area, [patch], { idPrefix: "card-instance-b" });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.clipId).not.toBe(second?.clipId);
    expect(first?.filterId).not.toBe(second?.filterId);
    expect(first?.patches[0]?.gradientId).not.toBe(second?.patches[0]?.gradientId);
  });
});
