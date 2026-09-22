import { afterEach, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig } from "./types";
import { CLOUD_DIRECT_MIN, SUN_PATCH_OPACITY } from "./render";

afterEach(() => { document.body.innerHTML = ""; });

// A west sun high enough to be at full strength, so the only thing left to
// thin the light is the weather.
const sun = { entity_id: "sun.sun", state: "above_horizon", attributes: { azimuth: 270, elevation: 40 } };
const sky = (cloud_coverage: unknown) => ({
  "sun.sun": sun,
  "weather.forecast_home": { entity_id: "weather.forecast_home", state: "cloudy", attributes: { cloud_coverage } },
});

function mount(config: Partial<FloorplanCardConfig>, states: Record<string, unknown>): FloorplanCard {
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig({
    type: "custom:easy-floorplan-card", width: 200, height: 200, sunlight: true,
    floors: [{ id: "ground", name: "Ground", walls: [], items: [], texts: [], furniture: [], trackers: [], areas: [],
      openings: [{ id: "win", type: "window", x: 10, y: 100, length: 20, angle: 90 }] }],
    ...config,
  } as FloorplanCardConfig);
  card.hass = { states, entities: {} } as unknown as FloorplanCard["hass"];
  document.body.append(card);
  return card;
}

/** The opacity the card put on its sun patches, or null when it drew none. */
async function patchOpacity(card: FloorplanCard): Promise<number | null> {
  await card.updateComplete;
  const beam = card.shadowRoot!.querySelector(".fp-sunbeam");
  return beam ? Number(beam.parentElement!.getAttribute("opacity")) : null;
}

it("thins the sun patches under cloud (issue #201)", async () => {
  const cloud = { cloudCoverEntity: "weather.forecast_home" };
  expect(await patchOpacity(mount(cloud, sky(0)))).toBeCloseTo(SUN_PATCH_OPACITY, 6);
  expect(await patchOpacity(mount(cloud, sky(100)))).toBeCloseTo(SUN_PATCH_OPACITY * CLOUD_DIRECT_MIN, 6);
});

// The sun is the same state object throughout, so only the weather moves: the
// card has to be watching it for the change to land at all.
it("follows the weather as it changes, without waiting on another entity", async () => {
  const card = mount({ cloudCoverEntity: "weather.forecast_home" }, sky(0));
  expect(await patchOpacity(card)).toBeCloseTo(SUN_PATCH_OPACITY, 6);
  card.hass = { states: sky(100), entities: {} } as unknown as FloorplanCard["hass"];
  expect(await patchOpacity(card)).toBeCloseTo(SUN_PATCH_OPACITY * CLOUD_DIRECT_MIN, 6);
});

it("leaves the light alone without a cloud entity, an unreadable one, or a pinned sun", async () => {
  expect(await patchOpacity(mount({}, sky(100)))).toBeCloseTo(SUN_PATCH_OPACITY, 6);
  expect(await patchOpacity(mount({ cloudCoverEntity: "weather.forecast_home" }, sky(null)))).toBeCloseTo(
    SUN_PATCH_OPACITY,
    6,
  );
  expect(
    await patchOpacity(mount({ cloudCoverEntity: "weather.forecast_home", sunBearing: 270 }, sky(100))),
  ).toBeCloseTo(SUN_PATCH_OPACITY, 6);
});
