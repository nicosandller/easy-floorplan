import { describe, expect, it } from "vitest";
import type { FloorplanCardConfig } from "./types";
import { SUN_ELEVATION_NIGHT } from "./types";
import {
  CLOUD_DIRECT_MIN,
  MOON_STRENGTH,
  collectWatchedEntities,
  moonNightFactor,
  moonlightOf,
  moonlightOn,
  renderSunDimMask,
} from "./render";
import { projectReliefForm } from "./editor-forms";
import { getReplayWatchedEntities } from "./replay-history/replay-utils";
import { nothing, svg } from "lit";

function config(extra: Partial<FloorplanCardConfig> = {}): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 100,
    height: 100,
    walls: [],
    openings: [],
    items: [],
    texts: [],
    furniture: [],
    trackers: [],
    areas: [],
    ...extra,
  };
}

const LONDON = { latitude: 51.5074, longitude: -0.1278 };
/** Full moon, 65° up in the south. The sun is 60° down. */
const FULL_MOON_MIDNIGHT = Date.parse("2025-12-04T23:30:00Z");
/** A 10% crescent, 21° up in the west an hour and a half after sunset. */
const CRESCENT_EVENING = Date.parse("2026-03-21T19:30:00Z");
/** 85% lit, 20° up due south. */
const GIBBOUS_SOUTH = Date.parse("2026-09-22T21:00:00Z");
const NIGHT = -30;

describe("when there is moonlight (issue #201)", () => {
  it("is an add-on to sunlight that follows the real sun", () => {
    expect(moonlightOn(config({ moonlight: true, sunlight: true }))).toBe(true);
    // No sunlight, no moonlight: it is the same light through the same openings.
    expect(moonlightOn(config({ moonlight: true }))).toBe(false);
    // A pinned sun never sets, so there is no night for the moon.
    expect(moonlightOn(config({ moonlight: true, sunlight: true, sunBearing: 180 }))).toBe(false);
    expect(moonlightOn(config({ sunlight: true }))).toBe(false);
  });

  it("starts where the sun's light ends, and is all there by the plan's night", () => {
    expect(moonNightFactor(10)).toBe(0);
    // The sun's patches are gone at the horizon; the moon's begin there.
    expect(moonNightFactor(0)).toBe(0);
    const mid = moonNightFactor(SUN_ELEVATION_NIGHT / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(moonNightFactor(SUN_ELEVATION_NIGHT)).toBe(1);
    expect(moonNightFactor(-40)).toBe(1);
    // The same numeric-string readings every sun layer accepts.
    expect(moonNightFactor("-40")).toBe(1);
  });

  it("draws no moon over an unreadable sun", () => {
    // The direct sun fails bright, so an outage already looks like day.
    for (const e of [undefined, null, "", "unavailable", false]) expect(moonNightFactor(e)).toBe(0);
  });
});

describe("the moon's light", () => {
  it("comes from where the moon is, and travels away from it", () => {
    // Due south, on a plan with north up: the light goes up the canvas.
    const m = moonlightOf(config(), GIBBOUS_SOUTH, LONDON, NIGHT)!;
    expect(m.dir.x).toBeCloseTo(0, 1);
    expect(m.dir.y).toBeCloseTo(-1, 1);
    // …and turns with the plan's north like the sun's does.
    const east = moonlightOf(config({ north: 90 }), GIBBOUS_SOUTH, LONDON, NIGHT)!;
    expect(east.dir.x).toBeCloseTo(1, 1);
    expect(east.dir.y).toBeCloseTo(0, 1);
  });

  it("is as bright as the moon is full", () => {
    const full = moonlightOf(config(), FULL_MOON_MIDNIGHT, LONDON, NIGHT)!;
    expect(full.strength).toBeCloseTo(MOON_STRENGTH, 2);
    const crescent = moonlightOf(config(), CRESCENT_EVENING, LONDON, NIGHT)!;
    expect(crescent.strength).toBeGreaterThan(0);
    expect(crescent.strength).toBeLessThan(MOON_STRENGTH * 0.15);
  });

  it("carries the moon's altitude for the reach", () => {
    const m = moonlightOf(config(), FULL_MOON_MIDNIGHT, LONDON, NIGHT)!;
    expect(m.altitude).toBeGreaterThan(60);
    expect(m.altitude).toBeLessThan(70);
  });

  it("thins under cloud as the sun's does", () => {
    const clear = moonlightOf(config(), FULL_MOON_MIDNIGHT, LONDON, NIGHT, 0)!;
    const overcast = moonlightOf(config(), FULL_MOON_MIDNIGHT, LONDON, NIGHT, 1)!;
    expect(overcast.strength).toBeCloseTo(clear.strength * CLOUD_DIRECT_MIN, 6);
  });

  it("is not there by day, below the horizon, or without a place to find it from", () => {
    expect(moonlightOf(config(), FULL_MOON_MIDNIGHT, LONDON, 20)).toBeUndefined();
    // Same moment from Sydney, where that full moon has not risen.
    expect(
      moonlightOf(config(), FULL_MOON_MIDNIGHT, { latitude: -33.87, longitude: 151.21 }, NIGHT),
    ).toBeUndefined();
    expect(moonlightOf(config(), FULL_MOON_MIDNIGHT, undefined, NIGHT)).toBeUndefined();
    expect(moonlightOf(config(), FULL_MOON_MIDNIGHT, { latitude: "51", longitude: 0 }, NIGHT)).toBeUndefined();
    expect(moonlightOf(config(), Number.NaN, LONDON, NIGHT)).toBeUndefined();
  });
});

describe("moonlight and the night", () => {
  it("builds the sun-dim mask for its clearing even with no lamp lit", () => {
    const clearing = svg`<polygon class="moon" points="0,0 1,0 1,1" />`;
    expect(renderSunDimMask([], {}, 100, 100, "dim")).toBe(nothing);
    const mask = renderSunDimMask([], {}, 100, 100, "dim", undefined, clearing);
    expect(mask).not.toBe(nothing);
    expect(serialize(mask)).toContain('class="moon"');
  });
});

describe("moonlight's inputs", () => {
  const on = config({ sunlight: true, moonlight: true });

  it("watches the sun it waits on, and the clouds", () => {
    expect(collectWatchedEntities(on)).toContain("sun.sun");
    expect(collectWatchedEntities({ ...on, cloudCoverEntity: "weather.home" })).toContain("weather.home");
  });

  // The moon itself comes from the replayed time. Whether it is night enough
  // for it comes from sun.sun, so that has to be replayed too — left live, a
  // replayed midnight viewed at noon has no moon.
  it("puts the sun and the clouds in the replay scope", () => {
    const scope = getReplayWatchedEntities({ ...on, cloudCoverEntity: "weather.home" });
    expect(scope).toContain("sun.sun");
    expect(scope).toContain("weather.home");
    expect(getReplayWatchedEntities(config({ sunlight: true }))).not.toContain("sun.sun");
  });
});

describe("the Moonlight switch in the editor", () => {
  const names = (c: FloorplanCardConfig) => projectReliefForm(c).fields.map((f) => f.name);

  it("appears only under a sun that sets", () => {
    expect(names(config())).not.toContain("moonlight");
    expect(names(config({ sunlight: true }))).toContain("moonlight");
    expect(names(config({ sunlight: true, sunBearing: 120 }))).not.toContain("moonlight");
  });

  it("stores only an explicit on, and goes with the sunlight", () => {
    const form = projectReliefForm(config({ sunlight: true }));
    expect(form.data.moonlight).toBe(false);
    expect(form.toPatch({ moonlight: true })).toStrictEqual({ moonlight: true });
    expect(form.toPatch({ moonlight: false })).toStrictEqual({ moonlight: undefined });
    const lit = projectReliefForm(config({ sunlight: true, moonlight: true }));
    expect("moonlight" in lit.toPatch({ sunlight: false })).toBe(true);
    expect(lit.toPatch({ sunlight: false }).moonlight).toBeUndefined();
  });
});

/** Flatten a Lit template the way `render.opening.test.ts` does. */
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
