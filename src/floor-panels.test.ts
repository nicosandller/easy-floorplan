// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { Floor, FloorInfoPanel, FloorplanCardConfig, HomeAssistant } from "./types";
import { makeFloor } from "./types";
import {
  computeLeaderLinePath,
  resolvePanelAnchor,
  resolvePanelMetrics,
} from "./floor-panels";

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

describe("resolvePanelMetrics", () => {
  it("resolves panel metrics with entity states, units, and friendly names", () => {
    const panel: FloorInfoPanel = {
      id: "panel_hud",
      x: 100,
      y: 100,
      metrics: [
        { entity: "sensor.workstation_power", label: "Power Draw", icon: "mdi:flash" },
        { entity: "sensor.workstation_temp" },
        { entity: "sensor.offline_device" },
      ],
    };

    const hass = createMockHass({
      "sensor.workstation_power": {
        state: "285",
        attributes: { unit_of_measurement: "W", friendly_name: "Workstation Power" },
      },
      "sensor.workstation_temp": {
        state: "23.2",
        attributes: { unit_of_measurement: "°C", friendly_name: "Workstation Ambient", icon: "mdi:thermometer" },
      },
      "sensor.offline_device": {
        state: "unavailable",
        attributes: {},
      },
    });

    const metrics = resolvePanelMetrics(panel, hass);
    expect(metrics.length).toBe(3);

    expect(metrics[0]!).toEqual({
      entity: "sensor.workstation_power",
      label: "Power Draw",
      state: "285",
      value: "285 W",
      unit: "W",
      icon: "mdi:flash",
      unavailable: false,
    });

    expect(metrics[1]!).toEqual({
      entity: "sensor.workstation_temp",
      label: "Workstation Ambient",
      state: "23.2",
      value: "23.2 °C",
      unit: "°C",
      icon: "mdi:thermometer",
      unavailable: false,
    });

    expect(metrics[2]!.unavailable).toBe(true);
    expect(metrics[2]!.value).toBe("unavailable");
  });

  it("leaves out a metric row that has no entity yet", () => {
    const panel: FloorInfoPanel = {
      id: "p1",
      x: 0,
      y: 0,
      metrics: [{ entity: "sensor.a" }, { entity: "" }],
    };
    const hass = createMockHass({ "sensor.a": { state: "1", attributes: {} } });
    const rows = resolvePanelMetrics(panel, hass);
    expect(rows.map((r) => r.entity)).toEqual(["sensor.a"]);
  });

  it("reads custom attributes when attribute is configured", () => {
    const panel: FloorInfoPanel = {
      id: "panel_ac",
      x: 100,
      y: 100,
      metrics: [
        { entity: "climate.ac", attribute: "current_temperature", label: "Current Temp", unit: "°C" },
      ],
    };

    const hass = createMockHass({
      "climate.ac": {
        state: "cool",
        attributes: { current_temperature: 22.5 },
      },
    });

    const metrics = resolvePanelMetrics(panel, hass);
    expect(metrics[0]!.value).toBe("22.5");
    expect(metrics[0]!.unit).toBe("°C");
  });
});

describe("resolvePanelAnchor", () => {
  const floor: Floor = {
    ...makeFloor("Test Floor"),
    areas: [
      {
        id: "living_room",
        name: "Living Room",
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      },
    ],
    furniture: [
      {
        id: "sofa_1",
        type: "sofa",
        x: 50,
        y: 60,
        w: 40,
        h: 20,
        angle: 0,
      },
    ],
    roofs: [
      {
        id: "roof_main",
        type: "gable",
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        height: 35,
      },
    ],
  };

  it("returns explicit anchor coordinate when specified", () => {
    const panel: FloorInfoPanel = {
      id: "p1",
      x: 150,
      y: 150,
      anchor: { x: 42, y: 77 },
    };
    expect(resolvePanelAnchor(panel, floor)).toEqual({ x: 42, y: 77 });
  });

  it("resolves area centroid when targetId points to an area", () => {
    const panel: FloorInfoPanel = {
      id: "p1",
      x: 150,
      y: 150,
      targetId: "living_room",
    };
    const anchor = resolvePanelAnchor(panel, floor);
    expect(anchor).toBeDefined();
    expect(anchor?.x).toBe(50);
    expect(anchor?.y).toBe(50);
  });

  it("resolves furniture position when targetId points to a furniture item", () => {
    const panel: FloorInfoPanel = {
      id: "p1",
      x: 150,
      y: 150,
      targetId: "sofa_1",
    };
    const anchor = resolvePanelAnchor(panel, floor);
    expect(anchor).toEqual({ x: 50, y: 60 });
  });

  it("resolves enclosing area centroid when targetType is area", () => {
    const panel: FloorInfoPanel = {
      id: "p1",
      x: 30,
      y: 40,
      targetType: "area",
    };
    const anchor = resolvePanelAnchor(panel, floor);
    expect(anchor).toBeDefined();
    expect(anchor?.x).toBe(50);
    expect(anchor?.y).toBe(50);
  });

  it("falls back to the nearest room when an area panel sits outside every room", () => {
    const twoRooms: Floor = {
      ...floor,
      areas: [
        ...(floor.areas ?? []),
        { id: "study", name: "Study", points: [{ x: 300, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 100 }, { x: 300, y: 100 }] },
      ],
    };
    const panel: FloorInfoPanel = { id: "p1", x: 280, y: 160, targetType: "area" };
    expect(resolvePanelAnchor(panel, twoRooms)).toEqual({ x: 350, y: 50 });
    expect(resolvePanelAnchor(panel, { ...twoRooms, areas: [] })).toBeUndefined();
  });

  it("resolves roof centroid when targetId points to a roof", () => {
    const panel: FloorInfoPanel = {
      id: "p1",
      x: 150,
      y: 150,
      targetId: "roof_main",
    };
    const anchor = resolvePanelAnchor(panel, floor);
    expect(anchor).toBeDefined();
    expect(anchor?.x).toBe(50);
    expect(anchor?.y).toBe(50);
  });

  it("resolves enclosing roof centroid when targetType is roof", () => {
    const panel: FloorInfoPanel = {
      id: "p1",
      x: 30,
      y: 40,
      targetType: "roof",
    };
    const anchor = resolvePanelAnchor(panel, floor);
    expect(anchor).toBeDefined();
    expect(anchor?.x).toBe(50);
    expect(anchor?.y).toBe(50);
  });

  it("returns undefined when no target or anchor exists", () => {
    const panel: FloorInfoPanel = {
      id: "p1",
      x: 200,
      y: 200,
    };
    expect(resolvePanelAnchor(panel, floor)).toBeUndefined();
  });
});

describe("computeLeaderLinePath", () => {
  it("draws straight line for nearly coincident points", () => {
    expect(computeLeaderLinePath({ x: 10, y: 10 }, { x: 11, y: 11 })).toBe("M 10 10 L 11 11");
  });

  it("computes stepped angled path from anchor to panel", () => {
    const path = computeLeaderLinePath({ x: 100, y: 100 }, { x: 200, y: 150 });
    expect(path.startsWith("M 100 100 L ")).toBe(true);
    expect(path.endsWith(" L 200 150")).toBe(true);
  });
});

describe("Callout Info-Panels & Leader Lines DOM Rendering", () => {
  it("renders tech info-panel and SVG leader line connected to anchor", async () => {
    const panel: FloorInfoPanel = {
      id: "panel_living",
      x: 350,
      y: 120,
      title: "Living Room Telemetry",
      style: "tech",
      color: "#00e5ff",
      anchor: { x: 200, y: 150 },
      showLeaderLine: true,
      metrics: [
        { entity: "sensor.living_temp", label: "Temperature" },
        { entity: "sensor.living_humidity", label: "Humidity", unit: "%" },
      ],
    };

    const floor: Floor = {
      ...makeFloor("Main Floor"),
      panels: [panel],
    };

    const { root } = await mountCard(
      {
        floors: [floor],
      },
      {
        "sensor.living_temp": { state: "22.4", attributes: { unit_of_measurement: "°C" } },
        "sensor.living_humidity": { state: "48", attributes: { unit_of_measurement: "%" } },
      }
    );

    // Verify SVG Leader line
    const leaderLine = root.querySelector<SVGPathElement>(".fp-panel-leader-line");
    expect(leaderLine).not.toBeNull();
    const d = leaderLine?.getAttribute("d");
    expect(d?.startsWith("M 200 150")).toBe(true);
    expect(d?.endsWith("350 120")).toBe(true);

    const anchorDot = root.querySelector<SVGCircleElement>(".fp-panel-anchor-dot");
    expect(anchorDot?.getAttribute("cx")).toBe("200");
    expect(anchorDot?.getAttribute("cy")).toBe("150");

    // Verify HTML Overlay Panel
    const panelEl = root.querySelector<HTMLElement>(".fp-info-panel");
    expect(panelEl).not.toBeNull();
    expect(panelEl?.classList.contains("tech")).toBe(true);
    expect(panelEl?.getAttribute("data-panel-id")).toBe("panel_living");

    const titleEl = panelEl?.querySelector(".fp-panel-title");
    expect(titleEl?.textContent?.trim()).toBe("Living Room Telemetry");

    const metricRows = panelEl?.querySelectorAll(".fp-panel-metric-row");
    expect(metricRows?.length).toBe(2);

    expect(metricRows?.[0]?.querySelector(".fp-panel-metric-label")?.textContent).toBe("Temperature");
    expect(metricRows?.[0]?.querySelector(".fp-panel-metric-value")?.textContent).toContain("22.4");

    expect(metricRows?.[1]?.querySelector(".fp-panel-metric-label")?.textContent).toBe("Humidity");
    expect(metricRows?.[1]?.querySelector(".fp-panel-metric-value")?.textContent).toContain("48");
  });

  it("renders minimal and pill styled panels properly", async () => {
    const minimalPanel: FloorInfoPanel = {
      id: "p_min",
      x: 100,
      y: 100,
      title: "Compact",
      style: "minimal",
      showLeaderLine: false,
      metrics: [{ entity: "sensor.temp", label: "T" }],
    };
    const pillPanel: FloorInfoPanel = {
      id: "p_pill",
      x: 200,
      y: 200,
      title: "Pill",
      style: "pill",
      showLeaderLine: false,
      metrics: [{ entity: "sensor.temp", label: "T" }],
    };

    const floor: Floor = {
      ...makeFloor("Main Floor"),
      panels: [minimalPanel, pillPanel],
    };

    const { root } = await mountCard(
      { floors: [floor] },
      { "sensor.temp": { state: "21", attributes: { unit_of_measurement: "°C" } } }
    );

    const minEl = root.querySelector<HTMLElement>('.fp-info-panel[data-panel-id="p_min"]');
    expect(minEl?.classList.contains("minimal")).toBe(true);

    const pillEl = root.querySelector<HTMLElement>('.fp-info-panel[data-panel-id="p_pill"]');
    expect(pillEl?.classList.contains("pill")).toBe(true);

    // No leader lines rendered since showLeaderLine is false
    const leaders = root.querySelectorAll(".fp-panel-leader");
    expect(leaders.length).toBe(0);
  });

  it("links panel to room zoom when linked to an area", async () => {
    const panel: FloorInfoPanel = {
      id: "panel_bed",
      x: 250,
      y: 250,
      targetId: "bedroom",
      metrics: [],
    };

    const floor: Floor = {
      ...makeFloor("Main Floor"),
      areas: [
        {
          id: "bedroom",
          name: "Bedroom",
          points: [
            { x: 200, y: 200 },
            { x: 300, y: 200 },
            { x: 300, y: 300 },
            { x: 200, y: 300 },
          ],
        },
      ],
      panels: [panel],
    };

    const { card, root } = await mountCard({ floors: [floor] });

    const panelEl = root.querySelector<HTMLElement>(".fp-info-panel");
    expect(panelEl?.classList.contains("clickable")).toBe(true);

    // Clicking panel zooms into the linked area
    panelEl?.click();
    await card.updateComplete;

    // Zoom-out button should now appear
    const zoomOut = root.querySelector(".zoom-out");
    expect(zoomOut).not.toBeNull();
  });

  it("respects showOnlyWhenZoomed filter", async () => {
    const zoomedOnlyPanel: FloorInfoPanel = {
      id: "panel_detail",
      x: 250,
      y: 250,
      targetId: "bedroom",
      showOnlyWhenZoomed: true,
      metrics: [],
    };

    const floor: Floor = {
      ...makeFloor("Main Floor"),
      areas: [
        {
          id: "bedroom",
          name: "Bedroom",
          points: [
            { x: 200, y: 200 },
            { x: 300, y: 200 },
            { x: 300, y: 300 },
            { x: 200, y: 300 },
          ],
        },
      ],
      panels: [zoomedOnlyPanel],
    };

    const { card, root } = await mountCard({ floors: [floor] });

    // Initially not zoomed: panel should be hidden
    expect(root.querySelector('.fp-info-panel[data-panel-id="panel_detail"]')).toBeNull();

    // Tap the room to zoom in
    const areaTarget = root.querySelector<SVGElement>(".area-tap-target");
    areaTarget?.dispatchEvent(new CustomEvent("action", { detail: { action: "tap" } }));
    await card.updateComplete;

    // Now zoomed in: panel should be visible
    expect(root.querySelector('.fp-info-panel[data-panel-id="panel_detail"]')).not.toBeNull();
  });

  it("never renders a roof panel in 2D or indoor 3D view, only in outside 3D house view when roof is visible", async () => {
    const roofPanel: FloorInfoPanel = {
      id: "panel_solar",
      x: 250,
      y: 250,
      title: "Solar Inverter",
      targetType: "roof",
      targetId: "roof_main",
      metrics: [{ entity: "sensor.temp", label: "T" }],
    };

    const indoorFloor: Floor = {
      ...makeFloor("First Floor"),
      id: "floor_1",
      roofs: [
        {
          id: "roof_main",
          type: "gable",
          points: [
            { x: 100, y: 100 },
            { x: 400, y: 100 },
            { x: 400, y: 400 },
            { x: 100, y: 400 },
          ],
          height: 30,
        },
      ],
      areas: [
        {
          id: "living",
          name: "Living Room",
          points: [
            { x: 100, y: 100 },
            { x: 400, y: 100 },
            { x: 400, y: 400 },
            { x: 100, y: 400 },
          ],
        },
      ],
      panels: [roofPanel],
    };

    const outdoorFloor: Floor = {
      ...makeFloor("Outdoor"),
      id: "floor_outdoor",
      isOutdoor: true,
      areas: [],
      walls: [],
      panels: [],
    };

    // 1. In indoor 2D view: roof panel must NOT be visible
    const t1 = await mountCard({ floors: [indoorFloor], view: "2d" });
    expect(t1.root.querySelector('.fp-info-panel[data-panel-id="panel_solar"]')).toBeNull();

    // 2. In indoor 3D view: roof panel must NOT be visible
    const t2 = await mountCard({ floors: [indoorFloor], view: "3d" });
    expect(t2.root.querySelector('.fp-info-panel[data-panel-id="panel_solar"]')).toBeNull();

    // 3. In outdoor 2D view: roof panel must NOT be visible
    const t3 = await mountCard({ floors: [outdoorFloor, indoorFloor], defaultFloor: "floor_outdoor", view: "2d" });
    expect(t3.root.querySelector('.fp-info-panel[data-panel-id="panel_solar"]')).toBeNull();

    // 4. In outdoor 3D house view: roof panel IS visible when roof is visible!
    const t4 = await mountCard({ floors: [outdoorFloor, indoorFloor], defaultFloor: "floor_outdoor", view: "3d" });
    expect(t4.root.querySelector('.fp-info-panel[data-panel-id="panel_solar"]')).not.toBeNull();

    // 5. When zoomed into the room beneath the roof: roof cuts away, so roof panel must hide!
    const panelEl = t4.root.querySelector<HTMLElement>('.fp-info-panel[data-panel-id="panel_solar"]');
    panelEl?.click(); // zooms into the room underneath the roof
    await t4.card.updateComplete;
    expect(t4.root.querySelector('.fp-info-panel[data-panel-id="panel_solar"]')).toBeNull();

    // 6. When zoomed back out: roof panel reappears!
    const zoomOut = t4.root.querySelector<HTMLButtonElement>(".zoom-out");
    zoomOut?.click();
    await t4.card.updateComplete;
    expect(t4.root.querySelector('.fp-info-panel[data-panel-id="panel_solar"]')).not.toBeNull();
  });
});
