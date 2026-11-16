/**
 * The icon fill on a mounted card (issue #421): the badge draws its glyph
 * twice, a dim copy and a copy clipped to the reading, and falls back to the
 * plain icon whenever there is no number to fill to.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import { badgeFillClipTop } from "./render";
import type { FloorItem, FloorplanCardConfig } from "./types";

function config(item: Partial<FloorItem>): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 600,
    floors: [
      {
        id: "f1",
        name: "Floor 1",
        walls: [],
        openings: [],
        items: [
          { id: "h1", kind: "sensor", entity: "sensor.humidity", icon: "mdi:water", x: 500, y: 300, ...item } as FloorItem,
        ],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      },
    ],
  };
}

function hassWith(state: string, attributes: Record<string, unknown> = {}) {
  return {
    states: {
      "sensor.humidity": {
        entity_id: "sensor.humidity",
        state,
        attributes: { unit_of_measurement: "%", ...attributes },
      },
    },
    entities: {},
    formatEntityState: (st: { state: string }) => st.state,
  } as unknown as FloorplanCard["hass"];
}

async function mount(item: Partial<FloorItem>, state = "60", attributes?: Record<string, unknown>) {
  const host = document.createElement("div");
  host.style.width = "900px";
  host.style.height = "540px";
  document.body.appendChild(host);
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config(item));
  card.hass = hassWith(state, attributes);
  host.appendChild(card);
  await card.updateComplete;
  const root = card.shadowRoot!;
  return {
    card,
    fill: () => root.querySelector<HTMLElement>(".badge .badge-fill"),
    level: () => root.querySelector<HTMLElement>(".badge .badge-fill-level"),
    icons: () => [...root.querySelectorAll(".badge ha-icon")].map((i) => i.getAttribute("icon")),
  };
}

describe("a filling badge on the rendered card (issue #421)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("draws the icon twice, the full copy clipped to the reading", async () => {
    const c = await mount({ fill: true }, "60");
    expect(c.fill()?.dataset.fill).toBe("60");
    expect(c.icons()).toEqual(["mdi:water", "mdi:water"]);
    expect(c.level()?.style.clipPath).toBe(`inset(${badgeFillClipTop(0.6)}% 0px 0px)`);
  });

  it("reads against a custom range and clamps past its ends", async () => {
    expect((await mount({ fill: { min: 0, max: 12 } }, "3")).fill()?.dataset.fill).toBe("25");
    document.body.innerHTML = "";
    expect((await mount({ fill: { min: 0, max: 12 } }, "20")).fill()?.dataset.fill).toBe("100");
  });

  it("reads the chosen attribute, like the colour rules", async () => {
    const c = await mount({ fill: true, attribute: "battery" }, "on", { battery: 40 });
    expect(c.fill()?.dataset.fill).toBe("40");
  });

  it("keeps the plain icon when there is no number to fill to", async () => {
    const c = await mount({ fill: true }, "unavailable");
    expect(c.fill()).toBeNull();
    expect(c.icons()).toEqual(["mdi:water"]);
  });

  it("leaves a badge without fill exactly as it was", async () => {
    const c = await mount({}, "60");
    expect(c.fill()).toBeNull();
    expect(c.icons()).toEqual(["mdi:water"]);
  });

  it("shows the number, not a fill, on a value badge", async () => {
    const c = await mount({ fill: true, badgeContent: "value" }, "60");
    expect(c.fill()).toBeNull();
    expect(c.card.shadowRoot!.querySelector(".badge .badge-value")).not.toBeNull();
  });
});
