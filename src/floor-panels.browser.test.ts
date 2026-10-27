import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { Floor, FloorInfoPanel, FloorplanCardConfig } from "./types";
import { makeFloor } from "./types";

let seq = 0;
async function mount(floor: Partial<Floor>, extraConfig: Partial<FloorplanCardConfig> = {}) {
  const host = document.createElement("div");
  // HA's default light theme: dark text on a light card. The panels bring
  // their own dark background, so they must not inherit this text colour.
  host.style.cssText = `width:600px;height:400px;--primary-color:#03a9f4;
    --primary-text-color:#212121;--card-background-color:#ffffff;--text-primary-color:#ffffff;`;
  document.body.append(host);

  const fullFloor: Floor = {
    ...makeFloor(`Floor-${seq++}`),
    ...floor,
  };

  const config: FloorplanCardConfig = {
    type: "custom:easy-floorplan-card",
    width: 600,
    height: 400,
    floors: [fullFloor],
    ...extraConfig,
  };

  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config);
  card.hass = {
    states: {
      "sensor.temp": { state: "21.8", attributes: { unit_of_measurement: "°C", friendly_name: "Temperature" } },
      "sensor.power": { state: "145", attributes: { unit_of_measurement: "W", friendly_name: "Power Draw" } },
    },
    entities: {},
    formatEntityState: (s: any) => `${s.state} ${s.attributes?.unit_of_measurement ?? ""}`.trim(),
  } as unknown as FloorplanCard["hass"];

  host.append(card);
  await card.updateComplete;
  return { host, card, root: card.shadowRoot! };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("floor callout panels in real chromium", () => {
  it("renders hud callout panel with HUD styling and leader line", async () => {
    const panel: FloorInfoPanel = {
      id: "panel_1",
      x: 350,
      y: 120,
      title: "Climate Zone",
      style: "hud",
      color: "#00e5ff",
      anchor: { x: 180, y: 200 },
      showLeaderLine: true,
      metrics: [
        { entity: "sensor.temp", label: "Temperature" },
        { entity: "sensor.power", label: "Power Draw" },
      ],
    };

    const { root } = await mount({ panels: [panel] });

    const panelEl = root.querySelector<HTMLElement>(".fp-info-panel.hud");
    expect(panelEl).not.toBeNull();

    // Verify computed styles in real browser layout
    const cs = getComputedStyle(panelEl!);
    expect(cs.position).toBe("absolute");
    expect(cs.userSelect).toBe("none");

    const leaderLine = root.querySelector<SVGPathElement>(".fp-panel-leader-line");
    expect(leaderLine).not.toBeNull();
    expect(leaderLine?.getAttribute("d")).toContain("M 180 200");

    const rows = root.querySelectorAll(".fp-panel-metric-row");
    expect(rows.length).toBe(2);

    const tempVal = rows[0]?.querySelector(".fp-panel-metric-value")?.textContent;
    expect(tempVal).toContain("21.8");
    expect(tempVal).not.toContain("°C °C");
    expect(rows[0]?.querySelector(".fp-panel-metric-unit")?.textContent).toBe("°C");

    const powerVal = rows[1]?.querySelector(".fp-panel-metric-value")?.textContent;
    expect(powerVal).toContain("145");
    expect(powerVal).not.toContain("W W");
    expect(rows[1]?.querySelector(".fp-panel-metric-unit")?.textContent).toBe("W");
  });

  it("keeps light text on every dark panel style under a light HA theme", async () => {
    const darkStyles = ["hud", "minimal", "pill"] as const;
    const panels: FloorInfoPanel[] = darkStyles.map((style, i) => ({
      id: `panel_${style}`,
      x: 150 + i * 150,
      y: 150,
      title: style,
      style,
      metrics: [{ entity: "sensor.temp", label: "Temperature" }],
    }));

    const { root } = await mount({ panels }, { skin: "pastel" });

    for (const style of darkStyles) {
      const title = root.querySelector<HTMLElement>(`.fp-info-panel.${style} .fp-panel-title`)!;
      const value = root.querySelector<HTMLElement>(`.fp-info-panel.${style} .fp-panel-metric-value`)!;
      expect(getComputedStyle(title).color, style).toBe("rgb(255, 255, 255)");
      expect(getComputedStyle(value).color, style).toBe("rgb(255, 255, 255)");
    }
  });

  it("adapts card styled panel to native HA theme variables", async () => {
    const panel: FloorInfoPanel = {
      id: "p_card",
      x: 300,
      y: 150,
      title: "Card Panel",
      style: "card",
      metrics: [{ entity: "sensor.temp", label: "Temperature" }],
    };
    const { root } = await mount({ panels: [panel] });
    const cardEl = root.querySelector<HTMLElement>(".fp-info-panel.card")!;
    expect(cardEl).not.toBeNull();
    const cs = getComputedStyle(cardEl);
    expect(cs.backgroundColor).toBe("rgb(255, 255, 255)");
  });

  it("lets --fp-panel-text and --fp-panel-bg restyle a panel together", async () => {
    const panel: FloorInfoPanel = { id: "p", x: 300, y: 150, title: "Hall", style: "minimal" };
    const { root, host } = await mount({ panels: [panel] });
    host.style.setProperty("--fp-panel-bg", "#ffffff");
    host.style.setProperty("--fp-panel-text", "#102030");
    const el = root.querySelector<HTMLElement>(".fp-info-panel.minimal")!;
    expect(getComputedStyle(el).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(el.querySelector(".fp-panel-title")!).color).toBe("rgb(16, 32, 48)");
  });

  it("renders readable light background and dark ink text in line-art mode", async () => {
    const panel: FloorInfoPanel = {
      id: "panel_line_art",
      x: 300,
      y: 150,
      title: "Solar Inverter",
      style: "hud",
      metrics: [{ entity: "sensor.power", label: "Solar Output" }],
    };

    const { root } = await mount({ panels: [panel] }, { appearance: "line-art" });

    const panelEl = root.querySelector<HTMLElement>(".fp-info-panel.hud");
    expect(panelEl).not.toBeNull();

    const cs = getComputedStyle(panelEl!);
    // Background must be crisp white and text must be ink dark
    expect(cs.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(cs.color).toBe("rgb(40, 52, 62)");

    const titleEl = root.querySelector<HTMLElement>(".fp-panel-title");
    expect(getComputedStyle(titleEl!).color).toBe("rgb(40, 52, 62)");
  });

  it("provides button role, tabindex and Enter/Space keyboard interaction when clickable", async () => {
    const area = {
      id: "living_room",
      name: "Living Room",
      points: [
        { x: 100, y: 100 },
        { x: 400, y: 100 },
        { x: 400, y: 400 },
        { x: 100, y: 400 },
      ],
    };
    const panel: FloorInfoPanel = {
      id: "panel_tap",
      x: 250,
      y: 250,
      targetType: "area",
      targetId: "living_room",
      metrics: [{ entity: "sensor.temp", label: "Temp" }],
    };

    const { card, root } = await mount({ areas: [area], panels: [panel] });
    const panelEl = root.querySelector<HTMLElement>(".fp-info-panel.clickable")!;
    expect(panelEl).not.toBeNull();
    expect(panelEl.getAttribute("role")).toBe("button");
    expect(panelEl.getAttribute("tabindex")).toBe("0");

    // Press Enter to zoom into room
    panelEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await card.updateComplete;
    expect((card as any)._zoomedAreaId).toBe("living_room");

    // Press Space to zoom back out
    panelEl.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await card.updateComplete;
    expect((card as any)._zoomedAreaId).toBeUndefined();
  });

  it("fits multi-metric pill panels horizontally without cropping text values", async () => {
    const panel: FloorInfoPanel = {
      id: "panel_f5nvbzi",
      x: 300,
      y: 160,
      title: "Fixed pill",
      style: "pill",
      showLeaderLine: true,
      metrics: [
        { entity: "cover.garage_door" },
        { entity: "cover.hall_window" },
        { entity: "sensor.outside_temperature" },
        { entity: "sensor.outside_humidity" },
      ],
      targetType: "fixed",
    };

    const { card, root } = await mount({ panels: [panel] });
    card.hass = {
      ...card.hass,
      states: {
        ...(card.hass?.states ?? {}),
        "cover.garage_door": { state: "closed", attributes: { friendly_name: "Garage Door" } },
        "cover.hall_window": { state: "open", attributes: { friendly_name: "Hall Window" } },
        "sensor.outside_temperature": { state: "15.6", attributes: { unit_of_measurement: "°C", friendly_name: "Outside Temperature" } },
        "sensor.outside_humidity": { state: "54", attributes: { unit_of_measurement: "%", friendly_name: "Outside Humidity" } },
      },
    } as any;
    await card.updateComplete;

    const pillEl = root.querySelector<HTMLElement>(".fp-info-panel.pill")!;
    expect(pillEl).not.toBeNull();

    // Pill width must comfortably fit all metrics without being clamped to 220px or 280px
    expect(pillEl.clientWidth).toBeGreaterThan(280);

    // No internal clipping: scrollWidth matches clientWidth
    expect(pillEl.scrollWidth).toBeLessThanOrEqual(pillEl.clientWidth + 1);

    // Check all metric values are present and not truncated
    const rows = Array.from(pillEl.querySelectorAll<HTMLElement>(".fp-panel-metric-row"));
    expect(rows.length).toBe(4);

    const values = rows.map((r) => r.querySelector(".fp-panel-metric-value")?.textContent?.trim());
    expect(values[0]).toBe("closed");
    expect(values[1]).toBe("open");
    expect(values[2]).toContain("15.6");
    expect(values[3]).toContain("54");

    // Every value element must have its full text visible without scroll truncation
    for (const row of rows) {
      const valEl = row.querySelector<HTMLElement>(".fp-panel-metric-value")!;
      expect(valEl.scrollWidth).toBeLessThanOrEqual(valEl.clientWidth + 1);
    }
  });
});
