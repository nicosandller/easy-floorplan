import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { Floor, FloorplanCardConfig } from "./types";
import { makeFloor } from "./types";

// The floor summary's auto-discovery reads the HA registries (entities,
// devices, areas), which the card's render-time hass does not carry. These
// mount the real card so that path is exercised end to end (issue #234).

const room = (id: string, name: string, x: number, haArea?: string) => ({
  id,
  name,
  haArea,
  points: [
    { x, y: 40 },
    { x: x + 160, y: 40 },
    { x: x + 160, y: 240 },
    { x, y: 240 },
  ],
});

const registries = {
  entities: {
    "sensor.living_temperature": { entity_id: "sensor.living_temperature", area_id: "living" },
    "light.living": { entity_id: "light.living", device_id: "dev_lamp" },
    "switch.living_fan": { entity_id: "switch.living_fan", area_id: "living" },
    "sensor.bedroom_temperature": { entity_id: "sensor.bedroom_temperature", area_id: "bedroom" },
  },
  devices: { dev_lamp: { id: "dev_lamp", area_id: "living" } },
  areas: {
    living: { area_id: "living", name: "Living", floor_id: "ground" },
    bedroom: { area_id: "bedroom", name: "Bedroom", floor_id: "upper" },
  },
};

function states(livingTemp: string, lamp: string) {
  return {
    "sensor.living_temperature": {
      entity_id: "sensor.living_temperature",
      state: livingTemp,
      attributes: { device_class: "temperature", unit_of_measurement: "°C" },
    },
    "light.living": { entity_id: "light.living", state: lamp, attributes: {} },
    "switch.living_fan": { entity_id: "switch.living_fan", state: "on", attributes: {} },
    "sensor.bedroom_temperature": {
      entity_id: "sensor.bedroom_temperature",
      state: "18.5",
      attributes: { device_class: "temperature", unit_of_measurement: "°C" },
    },
  };
}

function hassWith(s: Record<string, unknown>, reg: Record<string, unknown> = registries) {
  return { formatEntityState: (o: { state: string }) => o.state, ...reg, states: s } as unknown as FloorplanCard["hass"];
}

async function mount(floors: Floor[], hass: FloorplanCard["hass"], extra: Partial<FloorplanCardConfig> = {}) {
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig({
    type: "custom:easy-floorplan-card",
    width: 600,
    height: 400,
    floors,
    floorSummary: { enabled: true },
    ...extra,
  } as FloorplanCardConfig);
  card.hass = hass;
  document.body.append(card);
  await card.updateComplete;
  return card;
}

const badge = (card: FloorplanCard, floorId: string) =>
  card.shadowRoot!.querySelector<HTMLElement>(`.floor-button[data-floor-id="${floorId}"] .floor-button-summary`)
    ?.textContent?.trim();

afterEach(() => document.body.replaceChildren());

describe("floor summary discovery in the real card", () => {
  it("summarises a room's linked HA area, including a device-assigned light", async () => {
    const ground: Floor = { ...makeFloor("Ground"), id: "g", areas: [room("lr", "Living", 40, "living")] as Floor["areas"] };
    const upper: Floor = { ...makeFloor("Upper"), id: "u" };
    const card = await mount([ground, upper], hassWith(states("21", "on")));
    expect(badge(card, "g")).toBe("21.0°C · 💡 1");
    // Nothing is linked on the upper floor, so nothing leaks over from the bedroom.
    expect(badge(card, "u")).toBeUndefined();
  });

  it("summarises a floor linked to an HA floor", async () => {
    const ground: Floor = { ...makeFloor("Ground"), id: "g" };
    const upper: Floor = { ...makeFloor("Upper"), id: "u", haFloor: "upper" };
    const card = await mount([ground, upper], hassWith(states("21", "off")));
    expect(badge(card, "u")).toBe("18.5°C");
  });

  it("updates the badge when a discovered entity changes state", async () => {
    const ground: Floor = { ...makeFloor("Ground"), id: "g", areas: [room("lr", "Living", 40, "living")] as Floor["areas"] };
    const upper: Floor = { ...makeFloor("Upper"), id: "u" };
    const card = await mount([ground, upper], hassWith(states("21", "on")));
    // Same registries, new states: a plain HA state tick.
    card.hass = hassWith(states("23.4", "off"));
    await card.updateComplete;
    expect(badge(card, "g")).toBe("23.4°C");
  });

  it("picks up entities that join the area after the first render", async () => {
    const ground: Floor = { ...makeFloor("Ground"), id: "g", areas: [room("lr", "Living", 40, "living")] as Floor["areas"] };
    const upper: Floor = { ...makeFloor("Upper"), id: "u" };
    const empty = { entities: {}, devices: {}, areas: registries.areas };
    const card = await mount([ground, upper], hassWith(states("21", "on"), empty));
    expect(badge(card, "g")).toBeUndefined();
    card.hass = hassWith(states("21", "on"));
    await card.updateComplete;
    expect(badge(card, "g")).toBe("21.0°C · 💡 1");
  });

  it("prefers the floor's helper entity over discovered sensors", async () => {
    const ground: Floor = {
      ...makeFloor("Ground"),
      id: "g",
      areas: [room("lr", "Living", 40, "living")] as Floor["areas"],
      summary: { temperatureEntity: "sensor.bedroom_temperature" },
    };
    const upper: Floor = { ...makeFloor("Upper"), id: "u" };
    const card = await mount([ground, upper], hassWith(states("21", "off")));
    expect(badge(card, "g")).toBe("18.5°C");
  });

  it("summarises a single-floor plan when summaries are enabled", async () => {
    const ground: Floor = {
      ...makeFloor("Ground"),
      id: "g",
      areas: [room("lr", "Living", 40, "living")] as Floor["areas"],
    };
    const card = await mount([ground], hassWith(states("21", "on")));
    expect(badge(card, "g")).toBe("21.0°C · 💡 1");
  });
});
