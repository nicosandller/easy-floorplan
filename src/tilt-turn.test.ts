import { describe, it, expect } from "vitest";
import {
  DEFAULT_TILT_THRESHOLD,
  openingCanTilt,
  openingIsActive,
  renderOpening,
  resolveOpeningTilted,
  tiltReading,
  type OpeningStyle,
} from "./render";
import { openingSolids, TILT_VIEW_ANGLE } from "./projection-openings";
import { openingForm } from "./editor-forms";
import { collectWatchedEntities } from "./render";
import type { Opening } from "./types";

// Tilt-and-turn windows (issue #409), with the readings the reporter's Shelly
// BLU Door/Window gives: contact off / rotation 0 shut, on / 5 tilted, on / 0
// swung open.
const win: Opening = {
  id: "w", type: "window", x: 100, y: 100, length: 80, angle: 0, sash: "single",
  entity: "binary_sensor.window", tiltEntity: "sensor.rotation",
};
const st = (state: string) => ({ state });

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
const svgOf = (o: Partial<Opening>, style: Partial<OpeningStyle> = {}) =>
  serialize(renderOpening({ ...win, ...o } as Opening, { color: "#000", ...style }));

describe("tilt-and-turn windows (issue #409)", () => {
  it("reads an angle against the threshold and anything else as on/off", () => {
    expect(tiltReading("0.0")).toBe(false);
    expect(tiltReading("5.0")).toBe(true);
    expect(tiltReading("-5")).toBe(true);
    expect(tiltReading(String(DEFAULT_TILT_THRESHOLD))).toBe(true);
    expect(tiltReading("1.5")).toBe(false);
    expect(tiltReading("5", 8)).toBe(false);
    expect(tiltReading("on")).toBe(true);
    expect(tiltReading("tilted")).toBe(true);
    expect(tiltReading("off")).toBe(false);
    expect(tiltReading("unavailable")).toBe(false);
    expect(tiltReading("")).toBe(false);
    expect(tiltReading(undefined)).toBe(false);
  });

  it("tells shut, tilted and swung apart from the Shelly's two entities", () => {
    expect(resolveOpeningTilted(win, st("off"), st("0.0"))).toBe(false);
    expect(resolveOpeningTilted(win, st("on"), st("5.0"))).toBe(true);
    expect(resolveOpeningTilted(win, st("on"), st("0.0"))).toBe(false);
  });

  it("lets the contact have the first word, and fails closed on an outage", () => {
    // Shut is shut, whatever a drifting angle says.
    expect(resolveOpeningTilted(win, st("off"), st("5.0"))).toBe(false);
    expect(resolveOpeningTilted(win, st("unavailable"), st("5.0"))).toBe(false);
    expect(resolveOpeningTilted(win, undefined, st("5.0"))).toBe(false);
    expect(resolveOpeningTilted(win, st("on"), st("unavailable"))).toBe(false);
    expect(resolveOpeningTilted(win, st("on"), undefined)).toBe(false);
    // An inverted contact is read the way the window is drawn.
    expect(resolveOpeningTilted({ ...win, invert: true }, st("off"), st("5.0"))).toBe(true);
  });

  it("takes a handle sensor's own tilted, with or without a tilt sensor", () => {
    const handle = { ...win, tiltEntity: undefined };
    expect(resolveOpeningTilted(handle, st("tilted"), undefined)).toBe(true);
    expect(resolveOpeningTilted(handle, st("open"), undefined)).toBe(false);
    expect(openingIsActive(handle, st("tilted"))).toBe(true);
    expect(openingIsActive(handle, st("closed"))).toBe(false);
  });

  it("uses the tilt sensor alone when there is no contact", () => {
    const alone = { ...win, entity: undefined };
    expect(resolveOpeningTilted(alone, undefined, st("5"))).toBe(true);
    expect(resolveOpeningTilted(alone, undefined, st("0"))).toBe(false);
  });

  it("honours a custom threshold and ignores a nonsense one", () => {
    expect(resolveOpeningTilted({ ...win, tiltThreshold: 8 }, st("on"), st("5"))).toBe(false);
    expect(resolveOpeningTilted({ ...win, tiltThreshold: -1 }, st("on"), st("5"))).toBe(true);
  });

  it("only tilts a hinged window", () => {
    expect(openingCanTilt(win)).toBe(true);
    expect(openingCanTilt({ ...win, motion: "slide" })).toBe(false);
    expect(openingCanTilt({ ...win, motion: "awning" })).toBe(false);
    expect(openingCanTilt({ ...win, type: "door" })).toBe(false);
    expect(openingCanTilt({ ...win, type: "skylight" })).toBe(false);
    expect(resolveOpeningTilted({ ...win, type: "door" }, st("on"), st("5"))).toBe(false);
    expect(openingIsActive({ ...win, type: "door", tiltEntity: undefined }, st("tilted"))).toBe(false);
  });

  it("draws the leaning head and dashed V only while tilted, with the leaf shut", () => {
    expect(svgOf({}, { amount: 0 })).not.toContain("fp-tilt");
    const tilted = svgOf({}, { amount: 0, tilt: 1, active: true, accent: "#ff0000" });
    expect(tilted).toContain("fp-tilt");
    expect(tilted).toContain("stroke-dasharray=\"4 3\"");
    expect(tilted).toContain("rotate(0deg)");
    expect(tilted).toContain("stroke:#ff0000");
    // Eased: half-way through, half the depth and half the opacity.
    expect(svgOf({}, { amount: 0, tilt: 0.5 })).toContain("opacity:0.5");
    // A door never tilts, whatever the style says.
    expect(svgOf({ type: "door" }, { amount: 0, tilt: 1 })).not.toContain("fp-tilt");
  });

  it("tilts the first leaf of a double and leaves the second on its own state", () => {
    const pair = svgOf({ sash: "double" }, { amount: 0, tilt: 1, second: { amount: 1, active: true } });
    expect(pair).toContain("fp-tilt");
    expect(pair).toContain("rotate(90deg)");
  });

  it("leans the sash in from its sill in 3D", () => {
    const panels = (style: Partial<OpeningStyle>) =>
      openingSolids(win, { color: "#333", amount: 0, ...style }, (x, y) => ({ x, y }), 60)
        .filter((s) => s.kind === "panel");
    expect(panels({})[0].vertices).toBeUndefined();
    const [p] = panels({ tilt: 1 });
    const v = p.vertices!;
    // Sill on the wall line at the sill height, head leaning toward −y.
    expect(v[0]).toMatchObject({ x: 60, y: 100 });
    expect(v[1]).toMatchObject({ x: 140, y: 100 });
    expect(v[2].y).toBeLessThan(100);
    expect(v[0].z).toBeCloseTo(p.z0);
    expect(v[2].z).toBeCloseTo(p.z1);
    // The head swings on a sash of fixed height: reach = rise × tan(angle).
    expect(100 - v[2].y).toBeCloseTo((p.z1 - p.z0) * Math.tan(TILT_VIEW_ANGLE));
  });
});

describe("the card watches the tilt sensor (issue #409)", () => {
  it("re-renders when only the tilt sensor moves", () => {
    const ids = collectWatchedEntities({
      type: "custom:easy-floorplan-card", width: 600, height: 400,
      walls: [], items: [], openings: [win], texts: [], furniture: [], areas: [],
    } as never);
    expect(ids.has("sensor.rotation")).toBe(true);
    expect(ids.has("binary_sensor.window")).toBe(true);
  });
});

describe("tilt fields in the editor (issue #409)", () => {
  const names = (o: Opening) => openingForm(o).fields.map((f) => f.name);

  it("offers the tilt sensor on a hinged window, and the threshold only for an angle", () => {
    expect(names(win)).toContain("tiltEntity");
    expect(names(win)).toContain("tiltThreshold");
    expect(names({ ...win, tiltEntity: "binary_sensor.tilt" })).not.toContain("tiltThreshold");
    expect(names({ ...win, tiltEntity: undefined })).not.toContain("tiltThreshold");
    expect(names({ ...win, type: "door" })).not.toContain("tiltEntity");
    expect(names({ ...win, motion: "slide" })).not.toContain("tiltEntity");
    expect(openingForm(win).data.tiltThreshold).toBe(DEFAULT_TILT_THRESHOLD);
  });

  it("writes only what differs from the default", () => {
    const f = openingForm(win);
    expect(f.toPatch({ tiltThreshold: DEFAULT_TILT_THRESHOLD })).toEqual({ tiltThreshold: undefined });
    expect(f.toPatch({ tiltThreshold: 4 })).toEqual({ tiltThreshold: 4 });
    expect(f.toPatch({ tiltEntity: "" })).toEqual({ tiltEntity: undefined, tiltThreshold: undefined });
    expect(f.toPatch({ tiltEntity: "binary_sensor.tilt" })).toEqual({
      tiltEntity: "binary_sensor.tilt", tiltThreshold: undefined,
    });
  });

  it("drops the tilt sensor when the window stops being hinged", () => {
    const f = openingForm({ ...win, tiltThreshold: 4 });
    expect(f.toPatch({ motion: "slide" })).toMatchObject({ tiltEntity: undefined, tiltThreshold: undefined });
    expect(f.toPatch({ type: "door" })).toMatchObject({ tiltEntity: undefined, tiltThreshold: undefined });
    expect(f.toPatch({ motion: "swing" })).not.toHaveProperty("tiltEntity");
  });
});
