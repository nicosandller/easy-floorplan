import { describe, expect, it } from "vitest";
import type { Floor, FloorplanCardConfig, RenderHass } from "./types";
import {
  CLOUD_DIFFUSE_MIN,
  CLOUD_DIRECT_MIN,
  cloudCover,
  cloudCoverEntityOf,
  cloudFactor,
  collectWatchedEntities,
  sunlightStrengthOf,
} from "./render";
import { renderAmbientDaylightLayer } from "./ambient-daylight-integration";
import { DEFAULT_AMBIENT_DAYLIGHT_STRENGTH } from "./ambient-daylight";
import { projectReliefForm } from "./editor-forms";
import { getReplayWatchedEntities } from "./replay-history/replay-utils";

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

const states = (s: Record<string, { state: string; attributes?: Record<string, unknown> }>) =>
  ({ states: s }) as unknown as Pick<RenderHass, "states">;

/** Met.no's own weather entity, as a fresh Home Assistant install names it. */
const metno = (cloud_coverage: unknown, extra: Record<string, unknown> = {}) =>
  states({
    "weather.forecast_home": { state: "rainy", attributes: { cloud_coverage } },
    ...extra,
  });

describe("reading the cloud cover (issue #201)", () => {
  it("reads a weather entity's cloud_coverage attribute, not its condition", () => {
    expect(cloudCover("weather.forecast_home", metno(100))).toBe(1);
    expect(cloudCover("weather.forecast_home", metno(25))).toBe(0.25);
    // HA hands attributes over as numbers or numeric strings depending on the
    // path they came by; a real number in a string is a real reading.
    expect(cloudCover("weather.forecast_home", metno("40"))).toBe(0.4);
  });

  it("reads anything else from its state, as a percentage", () => {
    const hass = states({ "sensor.cloud_coverage": { state: "60" } });
    expect(cloudCover("sensor.cloud_coverage", hass)).toBe(0.6);
  });

  it("clamps a reading outside 0-100 rather than inverting the light", () => {
    const hass = states({
      "sensor.over": { state: "140" },
      "sensor.under": { state: "-5" },
    });
    expect(cloudCover("sensor.over", hass)).toBe(1);
    expect(cloudCover("sensor.under", hass)).toBe(0);
  });

  it("has no reading rather than a confident clear sky when there is none", () => {
    // Number(null) is 0, and 0 here would be a cloudless sky nobody measured.
    expect(cloudCover("weather.forecast_home", metno(null))).toBeUndefined();
    expect(cloudCover("weather.forecast_home", metno(undefined))).toBeUndefined();
    expect(cloudCover("weather.forecast_home", metno(""))).toBeUndefined();
    expect(cloudCover("sensor.c", states({ "sensor.c": { state: "unavailable" } }))).toBeUndefined();
    expect(cloudCover("sensor.missing", states({}))).toBeUndefined();
    expect(cloudCover(undefined, metno(100))).toBeUndefined();
    expect(cloudCover("weather.forecast_home", undefined)).toBeUndefined();
  });
});

describe("how much light the clouds leave", () => {
  it("runs linearly from all of it to the layer's minimum", () => {
    expect(cloudFactor(0, CLOUD_DIRECT_MIN)).toBe(1);
    expect(cloudFactor(1, CLOUD_DIRECT_MIN)).toBe(CLOUD_DIRECT_MIN);
    expect(cloudFactor(0.5, CLOUD_DIRECT_MIN)).toBeCloseTo((1 + CLOUD_DIRECT_MIN) / 2, 10);
  });

  it("dims nothing without a reading", () => {
    expect(cloudFactor(undefined, CLOUD_DIRECT_MIN)).toBe(1);
  });

  it("thins the sky light far less than the sun", () => {
    // Clouds hide the sun, not the sky.
    expect(CLOUD_DIFFUSE_MIN).toBeGreaterThan(CLOUD_DIRECT_MIN);
    // And neither goes to zero: a cover reading cannot tell thick overcast
    // from high cirrus the sun still throws a patch through.
    expect(CLOUD_DIRECT_MIN).toBeGreaterThan(0);
  });

  it("thins direct sunlight that follows the real sun", () => {
    expect(sunlightStrengthOf({}, 50, 1)).toBe(CLOUD_DIRECT_MIN);
    expect(sunlightStrengthOf({}, 50, 0)).toBe(1);
    expect(sunlightStrengthOf({}, 50)).toBe(1);
    // Night is still night, cloud or no cloud.
    expect(sunlightStrengthOf({}, -40, 0)).toBe(0);
  });

  it("leaves a pinned sun alone, as it leaves the sun's height alone", () => {
    expect(sunlightStrengthOf({ sunBearing: 225 }, 50, 1)).toBe(1);
  });
});

describe("which layers read the clouds", () => {
  const cloud = "weather.forecast_home";

  it("is read by sunlight that follows the real sun, and by ambient daylight", () => {
    expect(cloudCoverEntityOf(config({ cloudCoverEntity: cloud, sunlight: true }))).toBe(cloud);
    expect(cloudCoverEntityOf(config({ cloudCoverEntity: cloud, ambientDaylight: true }))).toBe(cloud);
    // Ambient daylight never pins, so it keeps reading them under a pinned sun.
    expect(
      cloudCoverEntityOf(config({ cloudCoverEntity: cloud, sunlight: true, sunBearing: 90, ambientDaylight: true })),
    ).toBe(cloud);
  });

  it("is read by nothing on a pinned sun alone, or with both layers off", () => {
    expect(cloudCoverEntityOf(config({ cloudCoverEntity: cloud, sunlight: true, sunBearing: 90 }))).toBeUndefined();
    expect(cloudCoverEntityOf(config({ cloudCoverEntity: cloud }))).toBeUndefined();
    expect(cloudCoverEntityOf(config({ cloudCoverEntity: "  ", sunlight: true }))).toBeUndefined();
  });

  // The same trap every other watched input names: unsubscribed, the plan is
  // not frozen but catches up only when some other entity happens to move.
  it("is watched exactly while something reads it", () => {
    expect(collectWatchedEntities(config({ cloudCoverEntity: cloud, sunlight: true }))).toContain(cloud);
    expect(collectWatchedEntities(config({ cloudCoverEntity: cloud, ambientDaylight: true }))).toContain(cloud);
    expect(collectWatchedEntities(config({ cloudCoverEntity: cloud, sunlight: true, sunBearing: 90 }))).not.toContain(
      cloud,
    );
    expect(collectWatchedEntities(config({ cloudCoverEntity: cloud }))).not.toContain(cloud);
  });

  it("joins the replay scope with the replay-aware ambient layer's sun", () => {
    expect(getReplayWatchedEntities(config({ cloudCoverEntity: cloud, ambientDaylight: true }))).toContain(cloud);
    expect(getReplayWatchedEntities(config({ cloudCoverEntity: cloud, sunlight: true }))).not.toContain(cloud);
  });
});

describe("ambient daylight under cloud", () => {
  const room: Floor = {
    id: "ground",
    name: "Ground",
    walls: [],
    openings: [{ id: "north-window", type: "window", x: 50, y: 0, length: 30, angle: 0 }],
    items: [],
    texts: [],
    furniture: [],
    trackers: [],
    areas: [
      {
        id: "bedroom",
        name: "Bedroom",
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      },
    ],
  };
  const openingState = { amount: () => 0, secondAmount: () => undefined };
  const noon = (cover: unknown) =>
    metno(cover, { "sun.sun": { state: "above_horizon", attributes: { elevation: 40 } } });
  const patchOpacity = (hass: Pick<RenderHass, "states">): number => {
    const svg = serialize(
      renderAmbientDaylightLayer(
        room,
        config({ ambientDaylight: true, cloudCoverEntity: "weather.forecast_home" }),
        hass,
        "card-a",
        openingState,
      ),
    );
    const m = /class="fp-ambient-daylight-patch"[\s\S]*?opacity="?([\d.]+)/.exec(svg);
    expect(m, svg).toBeTruthy();
    return Number(m![1]);
  };

  it("keeps most of its light under full cover, and all of it without a reading", () => {
    expect(patchOpacity(noon(0))).toBeCloseTo(DEFAULT_AMBIENT_DAYLIGHT_STRENGTH, 6);
    expect(patchOpacity(noon(100))).toBeCloseTo(DEFAULT_AMBIENT_DAYLIGHT_STRENGTH * CLOUD_DIFFUSE_MIN, 6);
    expect(patchOpacity(noon("unavailable"))).toBeCloseTo(DEFAULT_AMBIENT_DAYLIGHT_STRENGTH, 6);
  });
});

describe("the Clouds row in the editor", () => {
  const names = (c: FloorplanCardConfig) => projectReliefForm(c).fields.map((f) => f.name);

  it("appears only while some layer reads the real sky", () => {
    expect(names(config())).not.toContain("cloudCoverEntity");
    expect(names(config({ sunlight: true }))).toContain("cloudCoverEntity");
    expect(names(config({ ambientDaylight: true }))).toContain("cloudCoverEntity");
    // A pinned sun reads no sky, so the row would be a dead control.
    expect(names(config({ sunlight: true, sunBearing: 90 }))).not.toContain("cloudCoverEntity");
  });

  it("goes from the YAML once neither layer is left to read it", () => {
    const both = projectReliefForm(
      config({ sunlight: true, ambientDaylight: true, cloudCoverEntity: "weather.forecast_home" }),
    );
    // One layer off keeps it for the other.
    expect(both.toPatch({ sunlight: false })).not.toHaveProperty("cloudCoverEntity");
    expect(both.toPatch({ ambientDaylight: false })).not.toHaveProperty("cloudCoverEntity");

    const sunOnly = projectReliefForm(config({ sunlight: true, cloudCoverEntity: "weather.forecast_home" }));
    const off = sunOnly.toPatch({ sunlight: false });
    expect("cloudCoverEntity" in off && off.cloudCoverEntity === undefined).toBe(true);
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
