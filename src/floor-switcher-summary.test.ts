// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig, HomeAssistant } from "./types";
import { makeFloor } from "./types";

afterEach(() => {
  document.body.innerHTML = "";
});

function createMockHass(states: Record<string, any> = {}): HomeAssistant {
  return {
    states,
    entities: {},
    devices: {},
    areas: {},
    floors: {},
    formatEntityState: (stateObj: any) => {
      const u = stateObj.attributes?.unit_of_measurement;
      return u ? `${stateObj.state} ${u}` : stateObj.state;
    },
    formatEntityAttributeValue: (stateObj: any, attr: string) => String(stateObj.attributes?.[attr] ?? ""),
  } as unknown as HomeAssistant;
}

async function mountCard(config: Partial<FloorplanCardConfig>, hassStates: Record<string, any> = {}) {
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig({
    type: "custom:easy-floorplan-card",
    width: 600,
    height: 400,
    ...config,
  } as FloorplanCardConfig);
  card.hass = createMockHass(hassStates);
  document.body.appendChild(card);
  await card.updateComplete;
  return { card, root: card.shadowRoot! };
}

describe("Floor switcher button summary integration (Phase 2)", () => {
  it("renders plain buttons without summary when floorSummary is disabled or omitted", async () => {
    const f1 = { ...makeFloor("Ground Floor"), short: "GF" };
    const f2 = { ...makeFloor("First Floor"), short: "1F" };
    const { root } = await mountCard({
      floors: [f1, f2],
    });

    const buttons = root.querySelectorAll<HTMLButtonElement>(".floor-switcher button");
    expect(buttons.length).toBe(2);
    expect(buttons[0]?.classList.contains("has-summary")).toBe(false);
    expect(buttons[0]?.querySelector(".floor-button-summary")).toBeNull();
    expect(buttons[0]?.textContent?.trim()).toBe("GF");
    expect(buttons[0]?.getAttribute("title")).toBe("Ground Floor");
  });

  it("renders summary badge line and tooltip when floorSummary is enabled", async () => {
    const f1 = {
      ...makeFloor("Ground Floor"),
      short: "GF",
      items: [
        { id: "i1", kind: "sensor" as const, entity: "sensor.gf_temp", x: 10, y: 10 },
        { id: "i2", kind: "sensor" as const, entity: "sensor.gf_humidity", x: 20, y: 20 },
      ],
    };
    const f2 = {
      ...makeFloor("First Floor"),
      short: "1F",
      items: [
        { id: "i3", kind: "sensor" as const, entity: "sensor.1f_temp", x: 30, y: 30 },
      ],
    };

    const hassStates = {
      "sensor.gf_temp": { state: "21.5", attributes: { device_class: "temperature", unit_of_measurement: "°C" } },
      "sensor.gf_humidity": { state: "48", attributes: { device_class: "humidity", unit_of_measurement: "%" } },
      "sensor.1f_temp": { state: "20.0", attributes: { device_class: "temperature", unit_of_measurement: "°C" } },
    };

    const { root } = await mountCard(
      {
        floors: [f1, f2],
        floorSummary: {
          enabled: true,
          metrics: ["temperature", "humidity"],
        },
      },
      hassStates
    );

    const buttons = root.querySelectorAll<HTMLButtonElement>(".floor-switcher button");
    expect(buttons.length).toBe(2);

    // Floor 1
    expect(buttons[0]?.classList.contains("has-summary")).toBe(true);
    const title0 = buttons[0]?.querySelector(".floor-button-title");
    const summary0 = buttons[0]?.querySelector(".floor-button-summary");
    expect(title0?.textContent?.trim()).toBe("GF");
    expect(summary0?.textContent?.trim()).toBe("21.5°C · 48%");
    expect(buttons[0]?.getAttribute("title")).toContain("Ground Floor: Average Temp 21.5°C, Humidity 48%");
    expect(buttons[0]?.getAttribute("aria-label")).toContain("Ground Floor: Average Temp 21.5°C, Humidity 48%");

    // Floor 2
    expect(buttons[1]?.classList.contains("has-summary")).toBe(true);
    const summary1 = buttons[1]?.querySelector(".floor-button-summary");
    expect(summary1?.textContent?.trim()).toBe("20.0°C");
  });

  it("respects per-floor enabled: false override", async () => {
    const f1 = {
      ...makeFloor("Ground Floor"),
      short: "GF",
      items: [{ id: "i1", kind: "sensor" as const, entity: "sensor.gf_temp", x: 10, y: 10 }],
    };
    const f2 = {
      ...makeFloor("Attic"),
      short: "AT",
      summary: { enabled: false },
      items: [{ id: "i2", kind: "sensor" as const, entity: "sensor.attic_temp", x: 20, y: 20 }],
    };

    const hassStates = {
      "sensor.gf_temp": { state: "21.0", attributes: { device_class: "temperature", unit_of_measurement: "°C" } },
      "sensor.attic_temp": { state: "17.0", attributes: { device_class: "temperature", unit_of_measurement: "°C" } },
    };

    const { root } = await mountCard(
      {
        floors: [f1, f2],
        floorSummary: { enabled: true },
      },
      hassStates
    );

    const buttons = root.querySelectorAll<HTMLButtonElement>(".floor-switcher button");
    expect(buttons[0]?.classList.contains("has-summary")).toBe(true);
    expect(buttons[1]?.classList.contains("has-summary")).toBe(false);
    expect(buttons[1]?.textContent?.trim()).toBe("AT");
  });

  it("renders custom badge text template when floor customText is provided", async () => {
    const f1 = {
      ...makeFloor("Ground Floor"),
      short: "GF",
      summary: {
        customText: "{temp} | ECO",
      },
      items: [{ id: "i1", kind: "sensor" as const, entity: "sensor.gf_temp", x: 10, y: 10 }],
    };
    const f2 = { ...makeFloor("Attic") };

    const hassStates = {
      "sensor.gf_temp": { state: "21.2", attributes: { device_class: "temperature", unit_of_measurement: "°C" } },
    };

    const { root } = await mountCard(
      {
        floors: [f1, f2],
        floorSummary: { enabled: true },
      },
      hassStates
    );

    const buttons = root.querySelectorAll<HTMLButtonElement>(".floor-switcher button");
    const summary0 = buttons[0]?.querySelector(".floor-button-summary");
    expect(summary0?.textContent?.trim()).toBe("21.2°C | ECO");
  });
});
