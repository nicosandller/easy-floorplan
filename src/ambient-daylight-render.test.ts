import { describe, expect, it } from "vitest";
import type { Area } from "./types";
import type { AmbientDaylightPatch } from "./ambient-daylight";
import {
  DEFAULT_AMBIENT_DAYLIGHT_BLUR,
  DEFAULT_AMBIENT_DAYLIGHT_COLOR,
  ambientDaylightPolygonPoints,
  ambientDaylightSvgId,
  buildAmbientDaylightRenderModel,
} from "./ambient-daylight-render";

function room(): Area {
  return {
    id: "bedroom",
    points: [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ],
  };
}

function patch(overrides: Partial<AmbientDaylightPatch> = {}): AmbientDaylightPatch {
  return {
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
    ...overrides,
  };
}

describe("ambient daylight SVG render model", () => {
  it("keeps the room polygon as the hard clipping boundary", () => {
    const model = buildAmbientDaylightRenderModel(room(), [patch()]);
    expect(model).not.toBeNull();
    expect(model?.clipPoints).toBe("0,0 400,0 400,300 0,300");
    // The light patch deliberately extends outside the room. The SVG clip is
    // therefore essential rather than cosmetic.
    expect(model?.patches[0]?.points).toContain("430,250");
    expect(model?.patches[0]?.points).toContain("-30,250");
  });

  it("preserves the opening-to-room gradient axis and normalized opacity", () => {
    const model = buildAmbientDaylightRenderModel(room(), [patch({ opacity: 4 })]);
    const p = model?.patches[0];
    expect(p?.gradientStart).toEqual({ x: 200, y: 0 });
    expect(p?.gradientEnd).toEqual({ x: 200, y: 250 });
    expect(p?.opacity).toBe(1);
  });

  it("filters patches belonging to another room", () => {
    expect(buildAmbientDaylightRenderModel(room(), [patch({ areaId: "kitchen" })])).toBeNull();
  });

  it("drops non-positive and non-finite patches instead of emitting broken SVG", () => {
    expect(buildAmbientDaylightRenderModel(room(), [patch({ opacity: 0 })])).toBeNull();
    expect(buildAmbientDaylightRenderModel(room(), [patch({ opacity: Number.NaN })])).toBeNull();
    expect(
      buildAmbientDaylightRenderModel(room(), [
        patch({
          gradientEnd: { x: Number.POSITIVE_INFINITY, y: 250 },
        }),
      ]),
    ).toBeNull();
  });

  it("rejects an invalid room polygon", () => {
    expect(
      buildAmbientDaylightRenderModel(
        { id: "broken", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        [patch({ areaId: "broken" })],
      ),
    ).toBeNull();
    expect(ambientDaylightPolygonPoints([{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }, { x: 1, y: 0 }])).toBe("");
  });

  it("uses safe prototype defaults and bounds blur", () => {
    const normal = buildAmbientDaylightRenderModel(room(), [patch()]);
    expect(normal?.blur).toBe(DEFAULT_AMBIENT_DAYLIGHT_BLUR);
    expect(normal?.color).toBe(DEFAULT_AMBIENT_DAYLIGHT_COLOR);

    expect(buildAmbientDaylightRenderModel(room(), [patch()], { blur: -8 })?.blur).toBe(0);
    expect(buildAmbientDaylightRenderModel(room(), [patch()], { blur: 500 })?.blur).toBe(40);
    expect(buildAmbientDaylightRenderModel(room(), [patch()], { blur: Number.NaN })?.blur).toBe(
      DEFAULT_AMBIENT_DAYLIGHT_BLUR,
    );
  });

  it("generates deterministic unique SVG ids even after visible sanitization", () => {
    const a1 = ambientDaylightSvgId("room A/window 1");
    const a2 = ambientDaylightSvgId("room A/window 1");
    const b = ambientDaylightSvgId("room A@window 1");
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).toMatch(/^[a-z0-9_-]+$/);
    expect(b).toMatch(/^[a-z0-9_-]+$/);
  });

  it("keeps two openings in one room as separate gradient patches", () => {
    const second = patch({
      openingId: "east-window",
      points: [
        { x: 400, y: 80 },
        { x: 400, y: 160 },
        { x: 150, y: 300 },
        { x: 150, y: -60 },
      ],
      gradientStart: { x: 400, y: 120 },
      gradientEnd: { x: 150, y: 120 },
      opacity: 0.2,
    });
    const model = buildAmbientDaylightRenderModel(room(), [patch(), second]);
    expect(model?.patches).toHaveLength(2);
    expect(model?.patches[0]?.gradientId).not.toBe(model?.patches[1]?.gradientId);
  });
});
