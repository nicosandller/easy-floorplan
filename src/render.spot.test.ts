import { describe, it, expect } from "vitest";
import { conePoints, renderGlow, renderSunDimMask, spotCone } from "./render";
import { MIN_SPOT_WIDTH, type FloorItem, type HassEntity } from "./types";

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

const lamp = (extra: Partial<FloorItem> = {}): FloorItem =>
  ({ id: "spot", kind: "light", entity: "light.spot", x: 300, y: 200, glow: true, ...extra }) as FloorItem;
const on = { entity_id: "light.spot", state: "on", attributes: {} } as unknown as HassEntity;
const paint = { color: "#ffd9a0", opacity: 0.5, radius: 140 };

describe("spot cone (issue #388)", () => {
  it("is the ordinary pool unless the width is under 360°", () => {
    expect(spotCone(lamp())).toBeUndefined();
    expect(spotCone(lamp({ glowWidth: 360 }))).toBeUndefined();
    expect(spotCone(lamp({ glowWidth: 400 }))).toBeUndefined();
    expect(spotCone(lamp({ glowWidth: 60, glowDirection: 135 }))).toEqual({ bearing: 135, width: 60 });
  });

  it("reads the direction as a bearing and keeps the width above its floor", () => {
    expect(spotCone(lamp({ glowWidth: 60, glowDirection: -90 }))!.bearing).toBe(270);
    expect(spotCone(lamp({ glowWidth: 60, glowDirection: 450 }))!.bearing).toBe(90);
    expect(spotCone(lamp({ glowWidth: 1 }))!.width).toBe(MIN_SPOT_WIDTH);
    expect(spotCone(lamp({ glowWidth: 60 }))!.bearing).toBe(0);
  });

  it("leaves a strip alone, which already has a direction", () => {
    expect(spotCone(lamp({ glowWidth: 60, stripLength: 200 }))).toBeUndefined();
  });

  it("points 0° up and 90° right, like a ripple", () => {
    const up = conePoints(0, 0, 100, 0, 10);
    const right = conePoints(0, 0, 100, 90, 10);
    const mid = (pts: Array<{ x: number; y: number }>) => pts[Math.floor(pts.length / 2)]!;
    expect(up[0]).toEqual({ x: 0, y: 0 });
    expect(mid(up).x).toBeCloseTo(0, 0);
    expect(mid(up).y).toBeCloseTo(-100, 0);
    expect(mid(right).x).toBeCloseTo(100, 0);
    expect(mid(right).y).toBeCloseTo(0, 0);
    // Every arc point sits on the radius and inside the half-angle.
    for (const p of up.slice(1)) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(100, 0);
      expect(Math.abs((Math.atan2(p.x, -p.y) * 180) / Math.PI)).toBeLessThanOrEqual(10.01);
    }
  });

  it("masks the pool with the cone, and only for a spot", () => {
    expect(serialize(renderGlow(lamp(), paint, "g"))).not.toContain("cone");
    const out = serialize(renderGlow(lamp({ glowWidth: 60, glowDirection: 90 }), paint, "g"));
    expect(out).toContain('<mask id=g-cone');
    expect(out).toContain('mask=url(#g-cone)');
  });

  it("clears the night only inside the cone too", () => {
    const states = { "light.spot": on };
    const out = serialize(renderSunDimMask([lamp({ glowWidth: 60 })], states, 600, 400, "dim"));
    expect(out).toContain('<mask id=dim-0-cone');
    expect(out).toContain('mask=url(#dim-0-cone)');
    expect(serialize(renderSunDimMask([lamp()], states, 600, 400, "dim"))).not.toContain("cone");
  });
});
