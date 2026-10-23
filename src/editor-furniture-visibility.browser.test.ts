import { afterEach, describe, expect, it } from "vitest";
import { LitElement } from "lit";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import type { FloorplanCardConfig, Furniture, VisibilityCondition } from "./types";

// Mock ha-selector for browser tests if not defined by HA frontend
if (!customElements.get("ha-selector")) {
  class MockHaSelector extends LitElement {
    static properties = {
      hass: { type: Object },
      selector: { type: Object },
      value: { type: Array },
    };
    hass: unknown;
    selector: unknown;
    value: unknown;

    emitChange(val: unknown) {
      this.dispatchEvent(
        new CustomEvent("value-changed", {
          detail: { value: val },
          bubbles: true,
          composed: true,
        })
      );
    }
  }
  customElements.define("ha-selector", MockHaSelector);
}

type Internals = { _selection: unknown[]; _selectionPage: string };

const root = (editor: FloorplanCardEditor) => editor.shadowRoot!;

async function mount(piece: Furniture, state = "home") {
  const editor = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  editor.style.width = "1300px";
  editor.hass = {
    states: {
      "device_tracker.car": {
        state,
        attributes: {},
      },
    },
    entities: {},
  } as unknown as FloorplanCardEditor["hass"];

  const config: FloorplanCardConfig = {
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 720,
    floors: [
      {
        id: "ground",
        name: "Ground",
        walls: [],
        openings: [],
        texts: [],
        trackers: [],
        areas: [],
        items: [],
        furniture: [piece],
      },
    ],
  };

  editor.setConfig(config);
  document.body.append(editor);
  await editor.updateComplete;

  const saved: FloorplanCardConfig[] = [];
  editor.addEventListener("config-changed", (event) =>
    saved.push((event as CustomEvent).detail.config)
  );

  return {
    editor,
    saved,
    latestFurniture: () => saved[saved.length - 1]?.floors![0]?.furniture?.[0],
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Editor Furniture Visibility (Issue #310)", () => {
  it("renders hidden furniture dimmed on canvas with .card-hidden and 0.35 opacity", async () => {
    const piece: Furniture = {
      id: "car_1",
      type: "car",
      x: 300,
      y: 200,
      w: 80,
      h: 160,
      visibility: [
        {
          condition: "state",
          entity: "device_tracker.car",
          state: "home",
        },
      ],
    };

    // 1. Mounted with entity state = "not_home" -> hidden condition
    const { editor } = await mount(piece, "not_home");
    const furnHit = root(editor).querySelector(".furn-hit") as SVGGElement;
    expect(furnHit).not.toBeNull();
    expect(furnHit.classList.contains("card-hidden")).toBe(true);
    expect(window.getComputedStyle(furnHit).opacity).toBe("0.35");

    // 2. Update state to "home" -> conditions met -> card-hidden removed
    editor.hass = {
      states: {
        "device_tracker.car": { state: "home", attributes: {} },
      },
      entities: {},
    } as unknown as FloorplanCardEditor["hass"];
    await editor.updateComplete;

    expect(furnHit.classList.contains("card-hidden")).toBe(false);
  });

  it("allows selecting and interacting with hidden furniture on canvas", async () => {
    const piece: Furniture = {
      id: "car_1",
      type: "car",
      x: 300,
      y: 200,
      w: 80,
      h: 160,
      visibility: [
        {
          condition: "state",
          entity: "device_tracker.car",
          state: "home",
        },
      ],
    };

    const { editor } = await mount(piece, "not_home");
    const furnHit = root(editor).querySelector(".furn-hit") as SVGGElement;
    expect(furnHit.classList.contains("card-hidden")).toBe(true);

    // Simulate clicking to select
    (editor as unknown as Internals)._selection = [{ kind: "furniture", id: "car_1" }];
    await editor.updateComplete;

    expect(furnHit.classList.contains("selected")).toBe(true);
    expect(furnHit.classList.contains("card-hidden")).toBe(true);
  });

  it("displays real-time condition status badges in the visibility inspector", async () => {
    const pieceWithCond: Furniture = {
      id: "car_1",
      type: "car",
      x: 300,
      y: 200,
      w: 80,
      h: 160,
      visibility: [
        {
          condition: "state",
          entity: "device_tracker.car",
          state: "home",
        },
      ],
    };

    // Unmet condition
    const { editor } = await mount(pieceWithCond, "not_home");
    (editor as unknown as Internals)._selection = [{ kind: "furniture", id: "car_1" }];
    await editor.updateComplete;

    // Click the Visibility tab
    const visTab = root(editor).querySelector<HTMLButtonElement>("#object-category-visibility");
    expect(visTab).not.toBeNull();
    visTab!.click();
    await editor.updateComplete;

    let badge = root(editor).querySelector(".visibility-status-badge") as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.classList.contains("status-unmet")).toBe(true);
    expect(badge.textContent).toContain("Hidden on floorplan");

    // Met condition
    editor.hass = {
      states: {
        "device_tracker.car": { state: "home", attributes: {} },
      },
      entities: {},
    } as unknown as FloorplanCardEditor["hass"];
    await editor.updateComplete;

    badge = root(editor).querySelector(".visibility-status-badge") as HTMLElement;
    expect(badge.classList.contains("status-met")).toBe(true);
    expect(badge.textContent).toContain("Visible on floorplan");

    // Unconfigured (neutral)
    const plainPiece: Furniture = {
      id: "sofa_1",
      type: "sofa",
      x: 100,
      y: 100,
      w: 60,
      h: 60,
    };
    const { editor: editor2 } = await mount(plainPiece);
    (editor2 as unknown as Internals)._selection = [{ kind: "furniture", id: "sofa_1" }];
    await editor2.updateComplete;
    root(editor2).querySelector<HTMLButtonElement>("#object-category-visibility")!.click();
    await editor2.updateComplete;

    const neutralBadge = root(editor2).querySelector(".visibility-status-badge") as HTMLElement;
    expect(neutralBadge).not.toBeNull();
    expect(neutralBadge.classList.contains("status-neutral")).toBe(true);
    expect(neutralBadge.textContent).toContain("Always visible");
  });

  it("updates furniture visibility when ha-selector emits value-changed", async () => {
    const piece: Furniture = {
      id: "car_1",
      type: "car",
      x: 300,
      y: 200,
      w: 80,
      h: 160,
    };

    const { editor, saved } = await mount(piece, "home");
    (editor as unknown as Internals)._selection = [{ kind: "furniture", id: "car_1" }];
    await editor.updateComplete;
    root(editor).querySelector<HTMLButtonElement>("#object-category-visibility")!.click();
    await editor.updateComplete;

    const haSelector = root(editor).querySelector("ha-selector") as HTMLElement & {
      emitChange?: (val: unknown) => void;
    };
    expect(haSelector).not.toBeNull();

    const newConditions: VisibilityCondition[] = [
      {
        condition: "state",
        entity: "device_tracker.car",
        state: "home",
      },
    ];

    if (typeof haSelector.emitChange === "function") {
      haSelector.emitChange(newConditions);
    } else {
      haSelector.dispatchEvent(
        new CustomEvent("value-changed", {
          detail: { value: newConditions },
          bubbles: true,
          composed: true,
        })
      );
    }
    await editor.updateComplete;

    expect(saved.length).toBeGreaterThan(0);
    const updated = saved[saved.length - 1].floors![0].furniture[0];
    expect(updated.visibility).toEqual(newConditions);
  });

  it("displays correct status for garage_door.is_open / garage_door.is_closed", async () => {
    const ladder: Furniture = {
      id: "furn_vqvojun",
      type: "ladderShelf",
      x: 1040,
      y: 266,
      w: 370,
      h: 40,
      visibility: [
        {
          condition: "garage_door.is_open",
          target: { entity_id: "cover.garage_door" },
          options: { behavior: "any", for: "00:00:00" },
        },
      ],
    };

    const { editor } = await mount(ladder, "closed");
    editor.hass = {
      states: {
        "cover.garage_door": { state: "closed", attributes: {} },
      },
      entities: {},
    } as unknown as FloorplanCardEditor["hass"];
    (editor as unknown as Internals)._selection = [{ kind: "furniture", id: "furn_vqvojun" }];
    await editor.updateComplete;

    root(editor).querySelector<HTMLButtonElement>("#object-category-visibility")!.click();
    await editor.updateComplete;

    const badge = root(editor).querySelector(".visibility-status-badge") as HTMLElement;
    expect(badge.classList.contains("status-unmet")).toBe(true);
    expect(badge.textContent).toContain("Hidden on floorplan");

    // Change garage door to open
    editor.hass = {
      states: {
        "cover.garage_door": { state: "open", attributes: {} },
      },
      entities: {},
    } as unknown as FloorplanCardEditor["hass"];
    await editor.updateComplete;

    expect(badge.classList.contains("status-met")).toBe(true);
    expect(badge.textContent).toContain("Visible on floorplan");
  });
});

