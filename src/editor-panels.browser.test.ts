import { afterEach, describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import type { FloorplanCardConfig, FloorInfoPanel } from "./types";
import { floorPanels } from "./types";

function baseConfig(): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 800,
    height: 600,
    grid: 20,
    snap: 0,
    floors: [
      {
        id: "f1",
        name: "Main Floor",
        walls: [],
        openings: [],
        items: [],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [
          {
            id: "living_room",
            name: "Living Room",
            points: [
              { x: 100, y: 100 },
              { x: 500, y: 100 },
              { x: 500, y: 500 },
              { x: 100, y: 500 },
            ],
          },
        ],
        panels: [
          {
            id: "panel-init",
            x: 300,
            y: 300,
            title: "Climate HUD",
            targetType: "area",
            targetId: "living_room",
            style: "tech",
            metrics: [
              { entity: "sensor.temp", label: "Temp", unit: "°C" },
            ],
          },
        ],
      },
    ],
  };
}

function pointer(target: Element, type: string, clientX: number, clientY: number): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      clientX,
      clientY,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      bubbles: true,
      composed: true,
      cancelable: true,
    })
  );
}

async function mountEditor(initialConfig: FloorplanCardConfig = baseConfig()) {
  const host = document.createElement("div");
  host.style.width = "900px";
  host.style.height = "700px";
  document.body.appendChild(host);

  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  ed.hass = {
    states: {
      "sensor.temp": { state: "21.5", attributes: { unit_of_measurement: "°C", friendly_name: "Room Temp" } },
      "sensor.humidity": { state: "45", attributes: { unit_of_measurement: "%", friendly_name: "Room Humidity" } },
    },
    entities: {},
  } as unknown as FloorplanCardEditor["hass"];
  ed.setConfig(initialConfig);
  host.appendChild(ed);
  await ed.updateComplete;

  const root = ed.shadowRoot!;
  const emitted: FloorplanCardConfig[] = [];
  ed.addEventListener("config-changed", (ev) => {
    emitted.push((ev as CustomEvent<{ config: FloorplanCardConfig }>).detail.config);
  });

  return {
    ed,
    root,
    emitted,
    latestConfig(): FloorplanCardConfig {
      return emitted.length ? emitted[emitted.length - 1] : initialConfig;
    },
    panels(): FloorInfoPanel[] {
      const cfg = emitted.length ? emitted[emitted.length - 1] : initialConfig;
      return floorPanels(cfg.floors![0]);
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Visual Editor - Callout Panels (issue #234)", () => {
  it("renders existing panels on canvas overlay and SVG leader lines", async () => {
    const { root } = await mountEditor();

    // Check overlay element
    const panelEl = root.querySelector<HTMLElement>(".edit-panel");
    expect(panelEl).not.toBeNull();
    expect(panelEl?.textContent).toContain("Climate HUD");
    expect(panelEl?.textContent).toContain("1 metric");

    // Check SVG leader line group
    const leaderLine = root.querySelector(".panel-leader-sel");
    expect(leaderLine).not.toBeNull();
  });

  it("adds a new panel via '+ Add' popover menu", async () => {
    const { root, ed, panels } = await mountEditor();
    const initialCount = panels().length;

    // Open '+ Add' popover
    const addBtn = root.querySelector<HTMLButtonElement>(".insert-menu > button");
    expect(addBtn).not.toBeNull();
    addBtn?.click();
    await ed.updateComplete;

    // Click 'Panel' button
    const panelAddBtn = Array.from(root.querySelectorAll<HTMLButtonElement>("button.add-entry")).find(
      (b) => b.textContent?.includes("Panel")
    );
    expect(panelAddBtn).toBeDefined();
    panelAddBtn?.click();
    await ed.updateComplete;

    // Verified panel was added at canvas center
    const currentPanels = panels();
    expect(currentPanels.length).toBe(initialCount + 1);
    const newPanel = currentPanels[currentPanels.length - 1];
    expect(newPanel.title).toBe("Panel");
    expect(newPanel.x).toBe(400); // 800 / 2
    expect(newPanel.y).toBe(300); // 600 / 2
  });

  it("gives a panel added from '+ Add' a leader line to its room", async () => {
    const { root, ed, panels } = await mountEditor();
    expect(root.querySelectorAll(".panel-leader-sel").length).toBe(1);

    root.querySelector<HTMLButtonElement>(".insert-menu > button")!.click();
    await ed.updateComplete;
    Array.from(root.querySelectorAll<HTMLButtonElement>("button.add-entry"))
      .find((b) => b.textContent?.includes("Panel"))!
      .click();
    await ed.updateComplete;

    const added = panels()[panels().length - 1];
    expect(added.targetType).toBe("area");
    expect(root.querySelectorAll(".edit-panel").length).toBe(2);
    expect(root.querySelectorAll(".panel-leader-sel").length).toBe(2);
  });

  it("shows a saved target in the inspector's room and furniture selects", async () => {
    const cfg = baseConfig();
    const floor = cfg.floors![0];
    floor.furniture = [{ id: "sofa", type: "sofa", x: 200, y: 200, w: 80, h: 40, angle: 0 } as never];
    floor.panels = [
      ...floorPanels(floor),
      { id: "panel-sofa", x: 600, y: 120, title: "Sofa", targetType: "furniture", targetId: "sofa" },
    ];
    const { root, ed } = await mountEditor(cfg);

    async function select(id: string): Promise<HTMLSelectElement | undefined> {
      const el = root.querySelector<HTMLElement>(`.edit-panel[data-panel-id="${id}"]`) ??
        Array.from(root.querySelectorAll<HTMLElement>(".edit-panel")).find((e) =>
          e.textContent?.includes(id === "panel-init" ? "Climate HUD" : "Sofa"))!;
      const r = el.getBoundingClientRect();
      pointer(el, "pointerdown", r.left + r.width / 2, r.top + r.height / 2);
      pointer(el, "pointerup", r.left + r.width / 2, r.top + r.height / 2);
      await ed.updateComplete;
      return Array.from(root.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
        Array.from(s.options).some((o) => o.value === "living_room" || o.value === "sofa"));
    }

    const room = await select("panel-init");
    expect(room?.value).toBe("living_room");
    expect(room?.selectedOptions[0]?.textContent?.trim()).toBe("Living Room");

    const item = await select("panel-sofa");
    expect(item?.value).toBe("sofa");
  });

  it("selects panel and shows inspector form with title, style, and metrics", async () => {
    const { root, ed, latestConfig } = await mountEditor();

    // Click on the existing panel in the overlay
    const panelEl = root.querySelector<HTMLElement>(".edit-panel");
    expect(panelEl).not.toBeNull();
    const r = panelEl!.getBoundingClientRect();
    pointer(panelEl!, "pointerdown", r.left + r.width / 2, r.top + r.height / 2);
    pointer(panelEl!, "pointerup", r.left + r.width / 2, r.top + r.height / 2);
    await ed.updateComplete;

    // Inspector should show panel properties
    const titleInput = root.querySelector<HTMLInputElement>("input[placeholder*='Living Room, Climate']");
    expect(titleInput).not.toBeNull();
    expect(titleInput?.value).toBe("Climate HUD");

    // Change title
    titleInput!.value = "Main Climate";
    titleInput!.dispatchEvent(new Event("change"));
    await ed.updateComplete;

    const updated = floorPanels(latestConfig().floors![0]).find((p) => p.id === "panel-init");
    expect(updated?.title).toBe("Main Climate");

    // Add metric button
    const addMetricBtn = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Add metric")
    );
    expect(addMetricBtn).toBeDefined();
    addMetricBtn?.click();
    await ed.updateComplete;

    const afterMetric = floorPanels(latestConfig().floors![0]).find((p) => p.id === "panel-init");
    expect(afterMetric?.metrics?.length).toBe(2);
  });

  it("drags a panel across the canvas to a new coordinate", async () => {
    const { root, ed, latestConfig } = await mountEditor();

    const panelEl = root.querySelector<HTMLElement>(".edit-panel")!;
    const r = panelEl.getBoundingClientRect();
    const startX = r.left + r.width / 2;
    const startY = r.top + r.height / 2;

    pointer(panelEl, "pointerdown", startX, startY);
    await ed.updateComplete;

    // Drag by +40px X and +40px Y
    pointer(panelEl, "pointermove", startX + 40, startY + 40);
    await ed.updateComplete;

    pointer(panelEl, "pointerup", startX + 40, startY + 40);
    await ed.updateComplete;

    const moved = floorPanels(latestConfig().floors![0]).find((p) => p.id === "panel-init");
    expect(moved?.x).toBeGreaterThan(300);
    expect(moved?.y).toBeGreaterThan(300);
  });

  it("edits fixed anchor coordinates when targetType is fixed", async () => {
    const { root, ed, latestConfig } = await mountEditor();

    const panelEl = root.querySelector<HTMLElement>(".edit-panel")!;
    const r = panelEl.getBoundingClientRect();
    pointer(panelEl, "pointerdown", r.left + r.width / 2, r.top + r.height / 2);
    pointer(panelEl, "pointerup", r.left + r.width / 2, r.top + r.height / 2);
    await ed.updateComplete;

    // Switch target to fixed
    const targetSelect = Array.from(root.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
      Array.from(s.options).some((o) => o.value === "fixed")
    )!;
    targetSelect.value = "fixed";
    targetSelect.dispatchEvent(new Event("change"));
    await ed.updateComplete;

    expect(latestConfig().floors![0].panels![0].targetType).toBe("fixed");
    expect(latestConfig().floors![0].panels![0].anchor).toEqual({ x: 300, y: 300 });

    // Find anchor X input
    const anchorXInput = root.querySelector<HTMLInputElement>("input[title='Anchor X coordinate']")!;
    expect(anchorXInput).not.toBeNull();
    anchorXInput.value = "450";
    anchorXInput.dispatchEvent(new Event("change"));
    await ed.updateComplete;

    const anchorYInput = root.querySelector<HTMLInputElement>("input[title='Anchor Y coordinate']")!;
    expect(anchorYInput).not.toBeNull();
    anchorYInput.value = "250";
    anchorYInput.dispatchEvent(new Event("change"));
    await ed.updateComplete;

    const p = latestConfig().floors![0].panels![0];
    expect(p.anchor).toEqual({ x: 450, y: 250 });
  });
});

