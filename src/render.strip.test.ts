import { describe, it, expect } from "vitest";
import { nothing } from "lit";
import {
  renderGlow,
  renderStripLine,
  renderStripPool,
  renderSunDimMask,
  stripFromEnds,
  stripOutline,
  stripReach,
  stripRun,
  type StripReachPart,
} from "./render";
import { DEFAULT_GLOW_RADIUS, type FloorItem, type HassEntity, type Wall } from "./types";

/** As render.test.ts — lit templates back into markup, `nothing` as nothing. */
function serialize(node: unknown): string {
  if (node == null || typeof node === "boolean" || typeof node === "symbol") return "";
  if (Array.isArray(node)) return node.map(serialize).join("");
  if (typeof node === "object" && "strings" in (node as Record<string, unknown>)) {
    const { strings, values } = node as { strings: string[]; values: unknown[] };
    return strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? serialize(values[i]) : ""),
      "",
    );
  }
  return String(node);
}

const wall = (x1: number, y1: number, x2: number, y2: number, id = "w"): Wall => ({ id, x1, y1, x2, y2 });

// Even-odd point-in-polygon, as the glowReach tests use.
const insidePoly = (poly: Array<{ x: number; y: number }>, x: number, y: number) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};
/** Whether a strip's reach — the union of its parts — lights a point. */
const lit = (parts: readonly StripReachPart[], x: number, y: number) =>
  parts.some((p) => ("points" in p ? insidePoly(p.points, x, y) : Math.hypot(x - p.cx, y - p.cy) <= p.r));

const strip = (extra: Partial<FloorItem> = {}): FloorItem =>
  ({
    id: "s",
    kind: "light",
    entity: "light.strip",
    x: 500,
    y: 300,
    glow: true,
    stripLength: 200,
    stripAngle: 0,
    ...extra,
  }) as FloorItem;

const on = (attributes: Record<string, unknown> = {}): HassEntity =>
  ({ entity_id: "light.strip", state: "on", attributes }) as HassEntity;

describe("stripRun — a light with a length (issue #298)", () => {
  it("is centred on the device and runs along its angle", () => {
    expect(stripRun(strip())).toMatchObject({ x1: 400, y1: 300, x2: 600, y2: 300, side: "both" });
    // 90° runs straight down the plan: y grows downward.
    expect(stripRun(strip({ stripAngle: 90 }))).toMatchObject({ x1: 500, y1: 200, x2: 500, y2: 400 });
  });

  it("is a point lamp with no length, or one too short to have a direction", () => {
    expect(stripRun(strip({ stripLength: undefined }))).toBeUndefined();
    expect(stripRun(strip({ stripLength: 0 }))).toBeUndefined();
    expect(stripRun(strip({ stripLength: 2 }))).toBeUndefined();
    // Hand-edited YAML: garbage is no strip rather than NaN on the plan.
    expect(stripRun(strip({ stripLength: "long" as unknown as number }))).toBeUndefined();
  });

  it("reads only the sides it knows, and both for anything else", () => {
    expect(stripRun(strip({ stripSide: "left" }))?.side).toBe("left");
    expect(stripRun(strip({ stripSide: "right" }))?.side).toBe("right");
    expect(stripRun(strip({ stripSide: "up" as never }))?.side).toBe("both");
  });

  it("round-trips through the ends the editor drags", () => {
    for (const [x1, y1, x2, y2] of [
      [400, 300, 600, 300],
      [600, 300, 400, 300],
      [100, 100, 160, 180],
      [300, 500, 300, 200],
    ] as const) {
      const run = stripRun({ ...strip(), ...stripFromEnds(x1, y1, x2, y2) })!;
      expect([run.x1, run.y1, run.x2, run.y2]).toEqual([x1, y1, x2, y2]);
    }
  });

  it("writes its angle in [0, 360)", () => {
    expect(stripFromEnds(0, 0, 0, -10).stripAngle).toBe(270);
    expect(stripFromEnds(0, 0, 10, 0).stripAngle).toBe(0);
  });
});

describe("stripReach — walls stop a strip as they stop a lamp", () => {
  const r = 100;

  it("no wall in reach: undefined, so the pool stays unclipped", () => {
    expect(stripReach(stripRun(strip())!, r, [])).toBeUndefined();
    expect(stripReach(stripRun(strip())!, r, [wall(0, 900, 1000, 900)])).toBeUndefined();
  });

  it("a wall alongside casts a shadow along the whole run, not just its middle", () => {
    // A wall 40 below the run, longer than it.
    const parts = stripReach(stripRun(strip())!, r, [wall(300, 340, 700, 340)])!;
    expect(parts).toBeDefined();
    for (const x of [410, 500, 590]) {
      expect(lit(parts, x, 320)).toBe(true); // between the strip and the wall
      expect(lit(parts, x, 360)).toBe(false); // behind it
    }
  });

  it("a one-sided strip on a wall still sees the walls at its ends", () => {
    // A room 400..600 wide below y=300; the strip runs along its top wall,
    // corner to corner, lighting into the room (its right, walking east).
    const room = [
      wall(400, 300, 600, 300, "n"),
      wall(600, 300, 600, 500, "e"),
      wall(400, 500, 400, 300, "w"),
    ];
    const run = stripRun(strip({ stripSide: "right" }))!;
    const parts = stripReach(run, r, room)!;
    expect(parts).toBeDefined();
    expect(lit(parts, 500, 350)).toBe(true); // the room
    expect(lit(parts, 410, 380)).toBe(true); // its corners too
    // Past the side walls: the rooms next door stay dark, though the strip's
    // ends sit right on top of those walls.
    expect(lit(parts, 640, 340)).toBe(false);
    expect(lit(parts, 360, 340)).toBe(false);
  });
});

describe("renderStripPool — one light along the run", () => {
  const markup = (side: "both" | "left" | "right") =>
    serialize(renderStripPool(stripRun(strip({ stripSide: side }))!, 100, "#f00", 0.5, "g", undefined, "fp-glow"));

  it("is one fill in the light's colour, shaped by a falloff mask", () => {
    const out = markup("both");
    expect(out).toContain("<linearGradient id=g-run");
    expect(out).toContain("<radialGradient id=g-a");
    expect(out).toContain("<radialGradient id=g-b");
    expect(out).toContain("<mask id=g-fall");
    // The colour and strength are on the single rect, not on the pieces —
    // the pieces are an opaque grey mask, so their joins cannot show (#372).
    expect(out).toContain("fill=#f00 fill-opacity=0.5 mask=url(#g-fall)");
    expect(out.match(/fill=#f00/g)).toHaveLength(1);
    expect(out).not.toContain("stop-opacity");
    expect(out).toContain("class=fp-glow");
    // No wall in the way: nothing to clip to.
    expect(out).not.toContain("g-clip");
  });

  it("paints the caps first and the band over their join", () => {
    const out = markup("both");
    const mask = out.slice(out.indexOf("<mask id=g-fall"));
    expect(mask.indexOf("url(#g-a)")).toBeLessThan(mask.indexOf("url(#g-run)"));
    expect(mask.indexOf("url(#g-b)")).toBeLessThan(mask.indexOf("url(#g-run)"));
    // Each cap keeps to its own half of the run, from the middle (x=500) out.
    expect(out).toContain("<clipPath id=g-ca><polygon points=500,400 500,200 300,200 300,400");
  });

  it("fades to nothing on both edges of a free strip, from the run on a one-sided one", () => {
    const both = markup("both");
    expect(both).toContain('<stop offset="0" stop-color="#000"');
    expect(both).toContain('<stop offset="0.5" stop-color="#fff"');
    // Running east, "left" is up the plan: the band stops at the run (y=300)
    // and reaches to y=200.
    const left = markup("left");
    expect(left).not.toContain('offset="0.5"');
    expect(left).toContain("points=400,300 600,300 600,200 400,200");
    expect(markup("right")).toContain("points=400,300 600,300 600,400 400,400");
  });

  it("clips to the reach when a wall is in the way", () => {
    const run = stripRun(strip())!;
    const reach = stripReach(run, 100, [wall(300, 340, 700, 340)]);
    const out = serialize(renderStripPool(run, 100, "#f00", 0.5, "g", reach));
    expect(out).toContain("<clipPath id=g-clip");
    expect(out).toContain("clip-path=url(#g-clip)");
  });
});

describe("a strip through the existing light paths", () => {
  it("renderGlow casts a strip's pool instead of a circle", () => {
    const paint = { color: "#0f0", opacity: 0.5, radius: 120 };
    const out = serialize(renderGlow(strip(), paint, "glow-1"));
    expect(out).toContain("glow-1-run");
    expect(out).not.toContain("<circle class=\"fp-glow\"");
    // A point lamp is untouched.
    const point = serialize(renderGlow(strip({ stripLength: undefined }), paint, "glow-2"));
    expect(point).toContain("<circle class=\"fp-glow\"");
  });

  it("the night clears along the strip, the same shape as its pool", () => {
    const out = serialize(
      renderSunDimMask([strip()], { "light.strip": on() }, 1000, 600, "dim")
    );
    expect(out).toContain("dim-0-run");
    expect(out).toContain("fill=#000 fill-opacity=1 mask=url(#dim-0-fall)");
  });

  it("an off strip casts nothing but still shows where it runs", () => {
    expect(renderSunDimMask([strip()], { "light.strip": { ...on(), state: "off" } }, 1000, 600, "dim")).toBe(nothing);
    const off = serialize(renderStripLine(stripRun(strip())!, undefined));
    expect(off).toContain("class=fp-strip");
    expect(off).not.toContain("stroke:");
    const lit = serialize(renderStripLine(stripRun(strip())!, "rgb(1, 2, 3)"));
    expect(lit).toContain("fp-strip on");
    expect(lit).toContain("stroke: rgb(1, 2, 3)");
  });
});

describe("renderStripLine — where the strip itself is drawn", () => {
  const line = (side?: "left" | "right") =>
    serialize(renderStripLine(stripRun(strip({ stripSide: side }))!, undefined)).replace(/\s+/g, " ");

  it("runs down the middle of a free strip, and on its wall's lit face otherwise", () => {
    expect(line()).toContain("x1=400 y1=300 x2=600 y2=300");
    // A wall's width (8) out: up the plan for "left" running east…
    expect(line("left")).toContain("x1=400 y1=292 x2=600 y2=292");
    // …down it for "right".
    expect(line("right")).toContain("x1=400 y1=308 x2=600 y2=308");
  });
});

describe("stripOutline — the editor's guide", () => {
  it("traces a capsule for a free strip and half of one on a wall", () => {
    const r = DEFAULT_GLOW_RADIUS;
    expect(stripOutline(stripRun(strip())!, r)).toBe(
      `M 400 ${300 - r} L 600 ${300 - r} A ${r} ${r} 0 0 1 600 ${300 + r} L 400 ${300 + r} A ${r} ${r} 0 0 1 400 ${300 - r} Z`
    );
    expect(stripOutline(stripRun(strip({ stripSide: "right" }))!, r)).toBe(
      `M ${400 - r} 300 A ${r} ${r} 0 0 0 400 ${300 + r} L 600 ${300 + r} A ${r} ${r} 0 0 0 ${600 + r} 300 Z`
    );
  });
});
