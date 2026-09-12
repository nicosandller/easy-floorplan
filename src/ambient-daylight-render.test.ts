import { describe, expect, it } from "vitest";
import type { Area } from "./types";
import type { AmbientDaylightPatch } from "./ambient-daylight";
import {
  DEFAULT_AMBIENT_DAYLIGHT_BLUR,
  DEFAULT_AMBIENT_DAYLIGHT_COLOR,
  ambientDaylightPolygonPoints,
  ambientDaylightSvgId,
  buildAmbientDaylightRenderModel,
  renderAmbientDaylight,
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

/**
 * Serialize a Lit SVGTemplateResult (and its nested templates/arrays) back into
 * markup, the same way `render.opening.test.ts` does, so the composition can be
 * asserted without a browser.
 */
function serialize(node: unknown): string {
  if (node == null || node === false) return "";
  if (Array.isArray(node)) return node.map(serialize).join("");
  if (typeof node === "object" && "strings" in (node as Record<string, unknown>)) {
    const { strings, values } = node as { strings: string[]; values: unknown[] };
    let out = strings[0]!;
    for (let i = 0; i < values.length; i++) out += serialize(values[i]) + strings[i + 1]!;
    return out;
  }
  return String(node);
}

/**
 * The model tests above assert on numbers and ids. None of them looks at the
 * markup those ids end up in, which is the half that actually broke for the
 * sunbeam: a layer can compute a perfect gradient and still render a flat slab
 * if the `fill` never references it, or leak through a wall if the clip lands
 * on the wrong group. This is that half.
 */
describe("ambient daylight SVG composition", () => {
  const markup = () => serialize(renderAmbientDaylight(room(), [patch()], { idPrefix: "card-a" }));

  it("points the patch fill at the gradient it just built", () => {
    const svg = markup();
    const gradientId = svg.match(/<linearGradient id=([\w-]+)/)?.[1];
    expect(gradientId).toBeTruthy();
    expect(svg).toContain(`fill=url(#${gradientId})`);
  });

  it("hangs the blur on the patch and the clip on the group above it", () => {
    const svg = markup();
    const filterId = svg.match(/<filter id=([\w-]+)/)?.[1];
    const clipId = svg.match(/<clipPath id=([\w-]+)/)?.[1];
    expect(filterId).toBeTruthy();
    expect(clipId).toBeTruthy();
    expect(svg).toContain(`filter=url(#${filterId})`);
    // Blur first, clip second. The other order feathers the room boundary
    // itself and lets the wash bleed through the wall into the next room,
    // which is the one thing the Area polygon is here to prevent.
    const clippedGroup = svg.indexOf(`<g clip-path=url(#${clipId})`);
    expect(clippedGroup).toBeGreaterThan(-1);
    expect(clippedGroup).toBeLessThan(svg.indexOf("fp-ambient-daylight-patch"));
  });

  it("carries the class the stylesheet guard protects, and stays inert to pointers", () => {
    const svg = markup();
    expect(svg).toContain('class="fp-ambient-daylight-patch"');
    expect(svg).toContain('pointer-events="none"');
    expect(svg).toContain('aria-hidden="true"');
  });

  it("closes every tag it opens", () => {
    const svg = markup();
    for (const tag of ["g", "defs", "clipPath", "filter", "linearGradient", "polygon"]) {
      const open = svg.match(new RegExp(`<${tag}[\\s>]`, "g"))?.length ?? 0;
      const close = svg.match(new RegExp(`</${tag}>`, "g"))?.length ?? 0;
      expect({ tag, open, close }).toEqual({ tag, open: close, close });
    }
  });

  it("renders nothing at all for a room it cannot clip", () => {
    expect(serialize(renderAmbientDaylight({ id: "bedroom", points: [] }, [patch()]))).toBe("");
  });
});
