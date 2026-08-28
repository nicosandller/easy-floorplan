// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaybackController } from "./playback-controller";
import { HistoryService, type HistoryEventInput } from "./history-service";
import { HistoryStateProvider, LiveStateProvider } from "./state-provider";
import { HistoryTimeline } from "./history-timeline";
import { FloorplanCard } from "../floorplan-card";
import type { HomeAssistant, HassEntity } from "../types";
import {
  getReplaySpeedForRange,
  getReplayWatchedEntities,
  replaySpeedToSliderValue,
  sliderValueToReplaySpeed,
} from "./replay-utils";

import "./history-timeline";
import "../floorplan-card";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function getReplayPanelShadowRoot(card: FloorplanCard): ShadowRoot | null {
  return card.shadowRoot?.querySelector("easy-floorplan-replay-panel")?.shadowRoot ?? card.shadowRoot;
}

function makeTimelineRect(width = 200): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: 0,
    width,
    height: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function makeState(entityId: string, state: string): HassEntity {
  return {
    entity_id: entityId,
    state,
    attributes: { friendly_name: entityId },
    last_changed: "2024-01-01T00:00:00.000Z",
    last_updated: "2024-01-01T00:00:00.000Z",
    context: { id: "0", parent_id: null, user_id: null },
  } as HassEntity;
}

describe("PlaybackController", () => {
  it("plays forward and pauses without losing the current time", () => {
    const controller = new PlaybackController({ startTime: 0, endTime: 100 });
    controller.play();
    controller.tick(1000);
    expect(controller.currentTime).toBe(1);

    controller.pause();
    controller.tick(2000);
    expect(controller.currentTime).toBe(1);
  });

  it("supports rewind, fast-forward and speed changes", () => {
    const controller = new PlaybackController({ startTime: 0, endTime: 100 });
    controller.seek(20);
    controller.setPlaybackSpeed(2);
    controller.fastForward(5);
    expect(controller.currentTime).toBe(25);
    controller.rewind(10);
    expect(controller.currentTime).toBe(15);
  });

  it("clamps replay speed to a safe low/high range", () => {
    const controller = new PlaybackController({ startTime: 0, endTime: 100 });
    controller.setPlaybackSpeed(0.0001);
    expect(controller.speed).toBe(0.01);

    controller.setPlaybackSpeed(5000);
    expect(controller.speed).toBe(1000);
  });

  it("validates the initial speed through the same clamp logic as runtime updates", () => {
    const controller = new PlaybackController({ startTime: 0, endTime: 100, initialSpeed: Number.POSITIVE_INFINITY });
    expect(controller.speed).toBe(1000);

    const controller2 = new PlaybackController({ startTime: 0, endTime: 100, initialSpeed: 0.0001 });
    expect(controller2.speed).toBe(0.01);
  });
});

describe("HistoryService", () => {
  it("normalizes events and reconstructs state at a timestamp", async () => {
    const loader = vi.fn(async (): Promise<HistoryEventInput[]> => [
      {
        timestamp: 1000,
        entityId: "light.kitchen",
        oldState: "off",
        newState: "on",
        attributes: { friendly_name: "Kitchen Light" },
      },
      {
        timestamp: 2000,
        entityId: "binary_sensor.front_door",
        oldState: "closed",
        newState: "open",
        attributes: { friendly_name: "Front Door" },
      },
    ]);

    const service = new HistoryService({ loader });
    await service.loadHistory(0, 3000);

    const stateAt = service.getStateAt(1500);
    expect(stateAt.get("light.kitchen")?.state).toBe("on");
    expect(stateAt.get("binary_sensor.front_door")?.state).toBe("closed");
    expect(service.getEvents()).toHaveLength(2);
  });

  it("reuses cached history for repeated loads", async () => {
    const loader = vi.fn(async (): Promise<HistoryEventInput[]> => [
      {
        timestamp: 1000,
        entityId: "sensor.temp",
        oldState: "20",
        newState: "21",
        attributes: { friendly_name: "Temperature" },
      },
    ]);

    const service = new HistoryService({ loader });
    await service.loadHistory(0, 2000);
    await service.loadHistory(0, 2000);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("keeps cache entries separated by scope key", async () => {
    const loader = vi.fn(async (): Promise<HistoryEventInput[]> => [
      {
        timestamp: 1000,
        entityId: "sensor.temp",
        oldState: "20",
        newState: "21",
        attributes: { friendly_name: "Temperature" },
      },
    ]);

    const service = new HistoryService({ loader });
    await service.loadHistory(0, 2000, { scopeKey: "light.kitchen" });
    await service.loadHistory(0, 2000, { scopeKey: "binary_sensor.front_door" });

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("supports explicit cache clearing", async () => {
    const loader = vi.fn(async (): Promise<HistoryEventInput[]> => [
      {
        timestamp: 1000,
        entityId: "sensor.temp",
        oldState: "20",
        newState: "21",
        attributes: { friendly_name: "Temperature" },
      },
    ]);

    const service = new HistoryService({ loader });
    await service.loadHistory(0, 2000, { scopeKey: "scope-a" });
    service.clearCache();
    await service.loadHistory(0, 2000, { scopeKey: "scope-a" });

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("retains a historical baseline for entities with no transitions in the selected window", async () => {
    const loader = vi.fn(async (): Promise<HistoryEventInput[]> => [
      {
        timestamp: 1500,
        entityId: "light.kitchen",
        oldState: "off",
        newState: "on",
        attributes: { friendly_name: "Kitchen Light" },
      },
    ]);

    const service = new HistoryService({ loader });
    await service.loadHistory(0, 3000);
    const stateAt = service.getStateAt(1000);

    expect(stateAt.get("light.kitchen")?.state).toBe("off");
    expect(stateAt.get("light.kitchen")?.attributes.friendly_name).toBe("Kitchen Light");
  });

  it("reconstructs the latest state for each entity from that entity's ordered history", async () => {
    const loader = vi.fn(async (): Promise<HistoryEventInput[]> => [
      {
        timestamp: 1000,
        entityId: "light.kitchen",
        oldState: "off",
        newState: "on",
        attributes: { friendly_name: "Kitchen Light" },
      },
      {
        timestamp: 1500,
        entityId: "light.kitchen",
        oldState: "on",
        newState: "off",
        attributes: { friendly_name: "Kitchen Light" },
      },
      {
        timestamp: 2000,
        entityId: "binary_sensor.front_door",
        oldState: "closed",
        newState: "open",
        attributes: { friendly_name: "Front Door" },
      },
      {
        timestamp: 2500,
        entityId: "light.kitchen",
        oldState: "off",
        newState: "on",
        attributes: { friendly_name: "Kitchen Light" },
      },
    ]);

    const service = new HistoryService({ loader });
    await service.loadHistory(0, 3000);

    expect(service.getStateAt(1750).get("light.kitchen")?.state).toBe("off");
    expect(service.getStateAt(1750).get("binary_sensor.front_door")?.state).toBe("closed");
    expect(service.getStateAt(2600).get("light.kitchen")?.state).toBe("on");
  });

  it("steps to the nearest event on either side of a timestamp", async () => {
    const loader = vi.fn(async (): Promise<HistoryEventInput[]> => [
      {
        timestamp: 1000,
        entityId: "light.kitchen",
        oldState: "off",
        newState: "on",
        attributes: {},
      },
      {
        timestamp: 2000,
        entityId: "binary_sensor.front_door",
        oldState: "closed",
        newState: "open",
        attributes: {},
      },
    ]);

    const service = new HistoryService({ loader });
    await service.loadHistory(0, 3000);

    expect(service.getEventBefore(1500)?.entityId).toBe("light.kitchen");
    expect(service.getEventAfter(1500)?.entityId).toBe("binary_sensor.front_door");
  });
});

describe("ReplayPanel", () => {
  it("keeps its styles in a shadow root so replay CSS is applied", async () => {
    const panel = document.createElement("easy-floorplan-replay-panel") as HTMLElement & { visible: boolean };
    panel.visible = true;
    document.body.appendChild(panel);
    await panel.updateComplete;

    expect(panel.shadowRoot).not.toBeNull();
    expect(panel.shadowRoot?.querySelector("style")?.textContent).toContain(".replay-panel");
  });
});

describe("HistoryTimeline", () => {
  it("emits a seek event for click scrubbing", async () => {
    const timeline = document.createElement("easy-floorplan-history-timeline") as HistoryTimeline;
    timeline.events = [
      {
        timestamp: 1000,
        entityId: "light.kitchen",
        oldState: "off",
        newState: "on",
        attributes: {},
      },
    ];
    timeline.startTime = 0;
    timeline.endTime = 2000;
    timeline.currentTime = 0;
    document.body.appendChild(timeline);

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(makeTimelineRect());

    const handler = vi.fn();
    timeline.addEventListener("seek", handler as EventListener);
    await Promise.resolve();
    const track = timeline.shadowRoot!.querySelector(".timeline") as HTMLElement;
    track.dispatchEvent(new MouseEvent("click", { clientX: 100, bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail.timestamp).toBe(1000);
  });

  it("emits seek updates while dragging", async () => {
    const timeline = document.createElement("easy-floorplan-history-timeline") as HistoryTimeline;
    timeline.events = [
      {
        timestamp: 1000,
        entityId: "light.kitchen",
        oldState: "off",
        newState: "on",
        attributes: {},
      },
      {
        timestamp: 2000,
        entityId: "binary_sensor.front_door",
        oldState: "closed",
        newState: "open",
        attributes: {},
      },
    ];
    timeline.startTime = 0;
    timeline.endTime = 2000;
    timeline.currentTime = 0;
    document.body.appendChild(timeline);

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(makeTimelineRect());

    const handler = vi.fn();
    timeline.addEventListener("seek", handler as EventListener);
    await Promise.resolve();
    const track = timeline.shadowRoot!.querySelector(".timeline") as HTMLElement;
    track.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, bubbles: true }));
    track.dispatchEvent(new PointerEvent("pointermove", { clientX: 150, bubbles: true }));
    track.dispatchEvent(new PointerEvent("pointerup", { clientX: 150, bubbles: true }));

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[handler.mock.calls.length - 1][0].detail.timestamp).toBe(1500);
  });

  it("uses the event transition color for timeline markers", async () => {
    const timeline = document.createElement("easy-floorplan-history-timeline") as HistoryTimeline;
    timeline.events = [
      {
        timestamp: 1000,
        entityId: "light.kitchen",
        oldState: "off",
        newState: "on",
        attributes: { color: "#ffcc00" },
      },
    ];
    timeline.startTime = 0;
    timeline.endTime = 2000;
    timeline.currentTime = 1000;
    document.body.appendChild(timeline);

    await Promise.resolve();
    const marker = timeline.shadowRoot!.querySelector(".marker") as HTMLElement | null;
    expect(marker?.getAttribute("style") ?? "").toContain("background:#ffcc00");
  });

  it("stacks simultaneous events and exposes all hover details at that timestamp", async () => {
    const timeline = document.createElement("easy-floorplan-history-timeline") as HistoryTimeline;
    timeline.events = [
      {
        timestamp: 1000,
        entityId: "light.kitchen",
        oldState: "off",
        newState: "on",
        attributes: {},
      },
      {
        timestamp: 1000,
        entityId: "binary_sensor.front_door",
        oldState: "closed",
        newState: "open",
        attributes: {},
      },
    ];
    timeline.startTime = 0;
    timeline.endTime = 2000;
    timeline.currentTime = 1000;
    document.body.appendChild(timeline);

    await Promise.resolve();
    const cluster = timeline.shadowRoot!.querySelector(".marker-cluster") as HTMLElement | null;
    expect(cluster).not.toBeNull();
    const title = cluster?.getAttribute("title") ?? "";
    expect(title).toContain("light.kitchen");
    expect(title).toContain("binary_sensor.front_door");
    expect(timeline.shadowRoot!.querySelectorAll(".marker")).toHaveLength(2);
  });

  it("renders entity lanes when expanded", async () => {
    const timeline = document.createElement("easy-floorplan-history-timeline") as HistoryTimeline;
    timeline.events = [
      {
        timestamp: 1000,
        entityId: "light.kitchen",
        oldState: "off",
        newState: "on",
        attributes: { friendly_name: "Kitchen Light" },
      },
      {
        timestamp: 1500,
        entityId: "sensor.temperature",
        oldState: "20",
        newState: "21",
        attributes: { friendly_name: "Temperature" },
      },
    ];
    timeline.startTime = 0;
    timeline.endTime = 2000;
    timeline.currentTime = 1000;
    timeline.expanded = true;
    document.body.appendChild(timeline);

    await Promise.resolve();
    expect(timeline.shadowRoot!.querySelector(".lane")).not.toBeNull();
    expect(timeline.shadowRoot!.textContent).toContain("Kitchen Light");
    expect(timeline.shadowRoot!.textContent).toContain("Temperature");
  });

  it("supports drag seek in expanded mode and renders a full-lane playhead", async () => {
    const timeline = document.createElement("easy-floorplan-history-timeline") as HistoryTimeline;
    timeline.events = [
      {
        timestamp: 1000,
        entityId: "light.kitchen",
        oldState: "off",
        newState: "on",
        attributes: { friendly_name: "Kitchen Light" },
      },
      {
        timestamp: 1500,
        entityId: "sensor.temperature",
        oldState: "20",
        newState: "21",
        attributes: { friendly_name: "Temperature" },
      },
    ];
    timeline.startTime = 0;
    timeline.endTime = 2000;
    timeline.currentTime = 1000;
    timeline.expanded = true;
    document.body.appendChild(timeline);

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(makeTimelineRect());

    const handler = vi.fn();
    timeline.addEventListener("seek", handler as EventListener);
    await Promise.resolve();

    const expanded = timeline.shadowRoot!.querySelector(".timeline-expanded") as HTMLElement;
    expanded.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, bubbles: true }));
    expanded.dispatchEvent(new PointerEvent("pointermove", { clientX: 150, bubbles: true }));
    expanded.dispatchEvent(new PointerEvent("pointerup", { clientX: 150, bubbles: true }));

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[handler.mock.calls.length - 1][0].detail.timestamp).toBe(1500);
    expect(timeline.shadowRoot!.querySelector(".playhead-expanded")).not.toBeNull();
    const overlay = timeline.shadowRoot!.querySelector(".timeline-track-overlay") as HTMLElement | null;
    expect(overlay?.getAttribute("style") ?? "").toContain("grid-row:1 / span 2");
  });

  it("ignores events outside the active replay window when rendering the timeline", async () => {
    const timeline = document.createElement("easy-floorplan-history-timeline") as HistoryTimeline;
    timeline.events = [
      {
        timestamp: 200,
        entityId: "light.kitchen",
        oldState: "off",
        newState: "on",
        attributes: { friendly_name: "Kitchen Light" },
      },
      {
        timestamp: 1200,
        entityId: "light.kitchen",
        oldState: "on",
        newState: "off",
        attributes: { friendly_name: "Kitchen Light" },
      },
      {
        timestamp: 3500,
        entityId: "sensor.temperature",
        oldState: "20",
        newState: "21",
        attributes: { friendly_name: "Temperature" },
      },
    ];
    timeline.startTime = 1000;
    timeline.endTime = 2000;
    timeline.currentTime = 1500;
    timeline.expanded = true;
    document.body.appendChild(timeline);

    await Promise.resolve();

    expect(timeline.shadowRoot!.querySelectorAll(".marker")).toHaveLength(1);
    expect(timeline.shadowRoot!.textContent).toContain("Kitchen Light");
    expect(timeline.shadowRoot!.textContent).not.toContain("Temperature");
  });
});

describe("FloorplanCard replay", () => {
  it("treats historyReplay.defaultSpeed as a real-time multiplier", () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    card.setConfig({
      type: "easy-floorplan-card",
      width: 1000,
      height: 600,
      historyReplay: { enabled: true, lookbackSeconds: 3600, defaultSpeed: 1 },
      floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [] }],
    });

    const replaySpeed = getReplaySpeedForRange((card as any)._config, 1000, 3700);
    expect(replaySpeed).toBe(1);
  });

  it("maps logarithmic slider values to replay speed and back", () => {
    const sliderToSpeed = sliderValueToReplaySpeed;
    const speedToSlider = replaySpeedToSliderValue;

    expect(sliderToSpeed(-2)).toBe(0.01);
    expect(sliderToSpeed(0)).toBe(1);
    expect(sliderToSpeed(3)).toBe(1000);

    expect(speedToSlider(0.01)).toBeCloseTo(-2, 3);
    expect(speedToSlider(1)).toBeCloseTo(0, 3);
    expect(speedToSlider(1000)).toBeCloseTo(3, 3);
  });

  it("reloads replay when the visible floor changes", async () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    const floors = [
      { id: "floor-1", name: "Floor 1", walls: [], openings: [], items: [{ id: "item-1", entity: "light.kitchen", x: 0, y: 0, kind: "light" as const, icon: "mdi:lightbulb" }], texts: [], furniture: [], trackers: [], areas: [] },
      { id: "floor-2", name: "Floor 2", walls: [], openings: [], items: [{ id: "item-2", entity: "switch.lounge", x: 0, y: 0, kind: "switch" as const, icon: "mdi:toggle-switch" }], texts: [], furniture: [], trackers: [], areas: [] },
    ];
    card.setConfig({
      type: "easy-floorplan-card",
      width: 1000,
      height: 600,
      historyReplay: { enabled: true, lookbackSeconds: 3600, defaultSpeed: 1 },
      floors,
    });
    card.hass = {
      states: {
        "light.kitchen": { entity_id: "light.kitchen", state: "on", attributes: { friendly_name: "Kitchen" } },
        "switch.lounge": { entity_id: "switch.lounge", state: "off", attributes: { friendly_name: "Lounge" } },
      },
      callApi: vi.fn(),
      callService: vi.fn(),
      formatEntityState: (state: HassEntity) => state.state,
      entities: {},
      devices: {},
      locale: { language: "en" },
      themes: { darkMode: false },
      floors: {},
      areas: {},
      localize: (k: string) => k,
    } as unknown as HomeAssistant;

    const startSpy = vi.spyOn((card as any)._replayController, "startReplay");
    (card as any)._goToFloor(floors, "floor-2");

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(getReplayWatchedEntities((card as any)._config, (card as any)._activeFloorId)).toEqual(["switch.lounge"]);
  });

  it("keeps badge as the default item display when display is unset", async () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    const hass = {
      states: {
        "light.kitchen": {
          entity_id: "light.kitchen",
          state: "on",
          attributes: { friendly_name: "Kitchen" },
        },
      },
      callApi: vi.fn(),
      callService: vi.fn(),
      formatEntityState: (state: HassEntity) => state.state,
      entities: {},
      devices: {},
      locale: { language: "en" },
      themes: { darkMode: false },
      floors: {},
      areas: {},
      localize: (k: string) => k,
    } as unknown as HomeAssistant;

    document.body.appendChild(card);
    card.hass = hass;
    card.setConfig({
      type: "easy-floorplan-card",
      width: 1000,
      height: 600,
      floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [{ id: "it1", entity: "light.kitchen", kind: "light", x: 200, y: 200 }], texts: [], furniture: [], trackers: [], areas: [] }],
    });

    await Promise.resolve();
    expect(card.shadowRoot?.querySelector(".item .badge")).not.toBeNull();
  });

  it("renders an event log when replay history is loaded", async () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    const now = new Date();
    const recent = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const older = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
    const callApi = vi.fn(async () => [
      {
        entity_id: "light.kitchen",
        states: [
          { state: "off", last_updated: older },
          { state: "on", last_updated: recent },
        ],
      },
    ]);
    const hass = {
      states: {
        "light.kitchen": {
          entity_id: "light.kitchen",
          state: "off",
          attributes: { friendly_name: "Kitchen" },
        },
      },
      callApi,
      callService: vi.fn(),
      formatEntityState: (state: HassEntity) => state.state,
      entities: {},
      devices: {},
      locale: { language: "en" },
      themes: { darkMode: false },
      floors: {},
      areas: {},
      localize: (k: string) => k,
    } as unknown as HomeAssistant;

    document.body.appendChild(card);
    card.hass = hass;
    card.setConfig({
      type: "easy-floorplan-card",
      width: 1000,
      height: 600,
      historyReplay: { enabled: true, lookbackSeconds: 3600, defaultSpeed: 1 },
      floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [] }],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const showButton = getReplayPanelShadowRoot(card)?.querySelector(".replay-show-toggle") as HTMLButtonElement | null;
    showButton?.click();
    await card.updateComplete;

    expect(getReplayPanelShadowRoot(card)?.querySelector(".replay-event-log")).not.toBeNull();
  });

  it("accepts Home Assistant history_during_period array payloads", async () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    const now = new Date();
    const recent = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const older = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
    const hass = {
      states: {
        "light.kitchen": {
          entity_id: "light.kitchen",
          state: "off",
          attributes: { friendly_name: "Kitchen" },
        },
      },
      callApi: vi.fn(async () => [
        {
          entity_id: "light.kitchen",
          states: [
            { state: "off", last_updated: older },
            { state: "on", last_updated: recent },
          ],
        },
      ]),
      callService: vi.fn(),
      formatEntityState: (state: HassEntity) => state.state,
      entities: {},
      devices: {},
      locale: { language: "en" },
      themes: { darkMode: false },
      floors: {},
      areas: {},
      localize: (k: string) => k,
    } as unknown as HomeAssistant;

    card.hass = hass;
    card.setConfig({
      type: "easy-floorplan-card",
      width: 1000,
      height: 600,
      floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [{ id: "kitchen-light", entity: "light.kitchen", kind: "light", x: 20, y: 20 }], texts: [], furniture: [], trackers: [], areas: [] }],
    });

    const start = Math.floor((Date.now() - 3 * 60 * 60 * 1000) / 1000);
    const end = Math.floor(Date.now() / 1000);
    const service = new HistoryService();
    const events = await service.loadFromHass(hass, start, end, ["light.kitchen"]);

    expect(events.some((event: { entityId: string }) => event.entityId === "light.kitchen")).toBe(true);
  });

  it("accepts compact Home Assistant history rows with s/a/lu/lc keys", async () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    const now = new Date();
    const recent = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const older = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
    const hass = {
      states: {
        "binary_sensor.front_door": {
          entity_id: "binary_sensor.front_door",
          state: "off",
          attributes: { friendly_name: "Front door" },
        },
      },
      callApi: vi.fn(async () => [{
        entity_id: "binary_sensor.front_door",
        states: [
          { s: "off", a: { friendly_name: "Front door" }, lu: older },
          { s: "on", a: { friendly_name: "Front door" }, lu: recent },
        ],
      }]),
      callService: vi.fn(),
      formatEntityState: (state: HassEntity) => state.state,
      entities: {},
      devices: {},
      locale: { language: "en" },
      themes: { darkMode: false },
      floors: {},
      areas: {},
      localize: (k: string) => k,
    } as unknown as HomeAssistant;

    card.hass = hass;
    card.setConfig({
      type: "easy-floorplan-card",
      width: 1000,
      height: 600,
      floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [{ id: "door", entity: "binary_sensor.front_door", kind: "sensor", x: 20, y: 20 }], texts: [], furniture: [], trackers: [], areas: [] }],
    });

    const start = Math.floor((Date.now() - 3 * 60 * 60 * 1000) / 1000);
    const end = Math.floor(Date.now() / 1000);
    const service = new HistoryService();
    const events = await service.loadFromHass(hass, start, end, ["binary_sensor.front_door"]);

    expect(events.some((event: { entityId: string; oldState: string; newState: string }) => event.entityId === "binary_sensor.front_door" && event.oldState === "off" && event.newState === "on")).toBe(true);
  });

  it("starts loading history automatically when replay is enabled", async () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    const now = new Date();
    const recent = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const older = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
    const callApi = vi.fn(async () => [
      {
        entity_id: "light.kitchen",
        states: [
          { state: "off", last_updated: older },
          { state: "on", last_updated: recent },
        ],
      },
    ]);
    const hass = {
      states: {
        "light.kitchen": {
          entity_id: "light.kitchen",
          state: "off",
          attributes: { friendly_name: "Kitchen" },
        },
      },
      callApi,
      callService: vi.fn(),
      formatEntityState: (state: HassEntity) => state.state,
      entities: {},
      devices: {},
      locale: { language: "en" },
      themes: { darkMode: false },
      floors: {},
      areas: {},
      localize: (k: string) => k,
    } as unknown as HomeAssistant;

    document.body.appendChild(card);
    card.hass = hass;
    card.setConfig({
      type: "easy-floorplan-card",
      width: 1000,
      height: 600,
      historyReplay: { enabled: true, lookbackSeconds: 3600, defaultSpeed: 1 },
      floors: [{
        id: "f1",
        name: "Floor 1",
        walls: [],
        openings: [],
        items: [{ id: "kitchen-light", entity: "light.kitchen", x: 20, y: 20, kind: "light", icon: "mdi:lightbulb" }],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      }],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const showButton = getReplayPanelShadowRoot(card)?.querySelector(".replay-show-toggle") as HTMLButtonElement | null;
    showButton?.click();
    await card.updateComplete;

    expect(callApi).toHaveBeenCalled();
    const timelines = getReplayPanelShadowRoot(card)?.querySelectorAll("easy-floorplan-history-timeline");
    expect(timelines?.length).toBeGreaterThan(0);
    const timeline = timelines?.[0] as HistoryTimeline | null;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timeline?.events.length).toBeGreaterThan(0);
  });

  it("uses the event transition color for replay log dots", async () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    const hass = {
      states: {
        "light.kitchen": {
          entity_id: "light.kitchen",
          state: "off",
          attributes: { friendly_name: "Kitchen" },
        },
      },
      callApi: vi.fn(),
      callService: vi.fn(),
      formatEntityState: (state: HassEntity) => state.state,
      entities: {},
      devices: {},
      locale: { language: "en" },
      themes: { darkMode: false },
      floors: {},
      areas: {},
      localize: (k: string) => k,
    } as unknown as HomeAssistant;

    document.body.appendChild(card);
    card.hass = hass;
    card.setConfig({
      type: "easy-floorplan-card",
      width: 1000,
      height: 600,
      historyReplay: { enabled: true, lookbackSeconds: 3600, defaultSpeed: 1 },
      floors: [{
        id: "f1",
        name: "Floor 1",
        walls: [],
        openings: [],
        items: [{ id: "kitchen-light", entity: "light.kitchen", x: 20, y: 20, kind: "light", icon: "mdi:lightbulb" }],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      }],
    });

    (card as any)._replayController.state.historyEvents = [
      {
        timestamp: 1000,
        entityId: "light.kitchen",
        oldState: "off",
        newState: "on",
        attributes: { color: "#ffcc00" },
      },
    ];
    const playback = new PlaybackController({ startTime: 0, endTime: 2000, initialSpeed: 1 });
    playback.seek(1000);
    (card as unknown as { _playbackController: PlaybackController })._playbackController = playback;
    card.requestUpdate();
    await card.updateComplete;

    const showButton = getReplayPanelShadowRoot(card)?.querySelector(".replay-show-toggle") as HTMLButtonElement | null;
    showButton?.click();
    await card.updateComplete;

    const logToggle = getReplayPanelShadowRoot(card)?.querySelector(".replay-log-toggle") as HTMLButtonElement | null;
    logToggle?.click();
    await card.updateComplete;

    const dot = getReplayPanelShadowRoot(card)?.querySelector(".replay-event-dot") as HTMLElement | null;
    expect(dot?.getAttribute("style") ?? "").toContain("background:#ffcc00");
  });

  it("collapses the replay log by default and expands it when toggled", async () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    const hass = {
      states: {},
      callApi: vi.fn(),
      callService: vi.fn(),
      formatEntityState: (state: HassEntity) => state.state,
      entities: {},
      devices: {},
      locale: { language: "en" },
      themes: { darkMode: false },
      floors: {},
      areas: {},
      localize: (k: string) => k,
    } as unknown as HomeAssistant;

    document.body.appendChild(card);
    card.hass = hass;
    card.setConfig({
      type: "easy-floorplan-card",
      width: 1000,
      height: 600,
      historyReplay: { enabled: true, lookbackSeconds: 3600, defaultSpeed: 1 },
      floors: [{
        id: "f1",
        name: "Floor 1",
        walls: [],
        openings: [],
        items: [{ id: "kitchen-light", entity: "light.kitchen", x: 20, y: 20, kind: "light", icon: "mdi:lightbulb" }],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      }],
    });

    (card as any)._replayController.state.historyEvents = [
      {
        timestamp: 1000,
        entityId: "light.kitchen",
        oldState: "off",
        newState: "on",
        attributes: {},
      },
    ];
    (card as any)._replayController.state.ready = true;
    card.requestUpdate();
    await card.updateComplete;

    const showButton = getReplayPanelShadowRoot(card)?.querySelector(".replay-show-toggle") as HTMLButtonElement | null;
    showButton?.click();
    await card.updateComplete;

    expect(getReplayPanelShadowRoot(card)?.querySelector(".replay-event-log.collapsed")).not.toBeNull();
    const toggle = getReplayPanelShadowRoot(card)?.querySelector(".replay-log-toggle") as HTMLButtonElement | null;
    toggle?.click();
    await card.updateComplete;
    expect(getReplayPanelShadowRoot(card)?.querySelector(".replay-event-log.expanded")).not.toBeNull();
    expect(getReplayPanelShadowRoot(card)?.querySelector(".replay-event-list")).not.toBeNull();
  });

  it("starts with the replay panel hidden and shows a dedicated button to reopen it", async () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    const hass = {
      states: {},
      callApi: vi.fn(),
      callService: vi.fn(),
      formatEntityState: (state: HassEntity) => state.state,
      entities: {},
      devices: {},
      locale: { language: "en" },
      themes: { darkMode: false },
      floors: {},
      areas: {},
      localize: (k: string) => k,
    } as unknown as HomeAssistant;

    document.body.appendChild(card);
    card.hass = hass;
    card.setConfig({
      type: "easy-floorplan-card",
      width: 1000,
      height: 600,
      historyReplay: { enabled: true, lookbackSeconds: 3600, defaultSpeed: 1 },
      floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [] }],
    });
    await card.updateComplete;

    (card as any)._replayController.state.ready = true;
    (card as any)._replayController.state.historyEvents = [];
    card.requestUpdate();
    await card.updateComplete;

    const showButton = getReplayPanelShadowRoot(card)?.querySelector(".replay-show-toggle") as HTMLButtonElement | null;
    expect(showButton).not.toBeNull();
    expect(showButton?.textContent).toContain("Show replay history");
    expect(getReplayPanelShadowRoot(card)?.querySelector(".replay-hide-toggle")).toBeNull();

    showButton?.click();
    await card.updateComplete;

    const hideButton = getReplayPanelShadowRoot(card)?.querySelector(".replay-hide-toggle") as HTMLButtonElement | null;
    expect(hideButton).not.toBeNull();
    expect(hideButton?.textContent).toContain("hide");
  });

  it("filters replay history to entities mapped on the active floor only", async () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;

    card.hass = {
      states: {
        "light.kitchen": { entity_id: "light.kitchen", state: "off", attributes: { friendly_name: "Kitchen" } },
        "light.lounge": { entity_id: "light.lounge", state: "off", attributes: { friendly_name: "Lounge" } },
      },
      callApi: vi.fn(),
      callService: vi.fn(),
      formatEntityState: (state: HassEntity) => state.state,
      entities: {},
      devices: {},
      locale: { language: "en" },
      themes: { darkMode: false },
      floors: {},
      areas: {},
      localize: (k: string) => k,
    } as unknown as HomeAssistant;

    card.setConfig({
      type: "easy-floorplan-card",
      width: 1000,
      height: 600,
      historyReplay: { enabled: true, lookbackSeconds: 3600, defaultSpeed: 1 },
      floors: [
        {
          id: "floor-1",
          name: "Floor 1",
          walls: [],
          openings: [],
          items: [{ id: "kitchen-light", entity: "light.kitchen", x: 20, y: 20, kind: "light", icon: "mdi:lightbulb" }],
          texts: [],
          furniture: [],
          trackers: [],
          areas: [],
        },
        {
          id: "floor-2",
          name: "Floor 2",
          walls: [],
          openings: [],
          items: [{ id: "lounge-light", entity: "light.lounge", x: 30, y: 30, kind: "light", icon: "mdi:lightbulb" }],
          texts: [],
          furniture: [],
          trackers: [],
          areas: [],
        },
      ],
    });
    (card as any)._activeFloorId = "floor-2";

    expect(getReplayWatchedEntities((card as any)._config, (card as any)._activeFloorId)).toEqual(["light.lounge"]);
  });

  it("filters replay history to entities that are mapped on the floorplan", async () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    const now = new Date();
    const older = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
    const recent = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const callApi = vi.fn(async () => [
      {
        entity_id: "light.kitchen",
        states: [
          { state: "off", last_updated: older },
          { state: "on", last_updated: recent },
        ],
      },
      {
        entity_id: "sensor.unmapped",
        states: [
          { state: "0", last_updated: older },
          { state: "1", last_updated: recent },
        ],
      },
    ]);
    const hass = {
      states: {
        "light.kitchen": {
          entity_id: "light.kitchen",
          state: "off",
          attributes: { friendly_name: "Kitchen" },
        },
      },
      callApi,
      callService: vi.fn(),
      formatEntityState: (state: HassEntity) => state.state,
      entities: {},
      devices: {},
      locale: { language: "en" },
      themes: { darkMode: false },
      floors: {},
      areas: {},
      localize: (k: string) => k,
    } as unknown as HomeAssistant;

    document.body.appendChild(card);
    card.hass = hass;
    card.setConfig({
      type: "easy-floorplan-card",
      width: 1000,
      height: 600,
      historyReplay: { enabled: true, lookbackSeconds: 3600, defaultSpeed: 1 },
      floors: [{
        id: "f1",
        name: "Floor 1",
        walls: [],
        openings: [],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
        items: [
          {
            id: "kitchen-light",
            entity: "light.kitchen",
            x: 20,
            y: 20,
            kind: "light",
            icon: "mdi:lightbulb",
          },
        ],
      }],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const showButton = getReplayPanelShadowRoot(card)?.querySelector(".replay-show-toggle") as HTMLButtonElement | null;
    showButton?.click();
    await card.updateComplete;

    const logToggle = getReplayPanelShadowRoot(card)?.querySelector(".replay-log-toggle") as HTMLButtonElement | null;
    logToggle?.click();
    await card.updateComplete;

    const entityLabels = Array.from(getReplayPanelShadowRoot(card)?.querySelectorAll(".replay-event-entity") ?? []).map((el) => el.textContent?.trim());
    expect(entityLabels).toContain("light.kitchen");
    expect(entityLabels).not.toContain("sensor.unmapped");
  });
});

describe("HistoryStateProvider", () => {
  it("falls back to live state when there is no historical state", () => {
    const live = new LiveStateProvider({
      states: {
        "light.kitchen": makeState("light.kitchen", "off"),
      },
      formatEntityState: () => "",
    } as unknown as HomeAssistant);
    const service = new HistoryService({ loader: async () => [] });
    const provider = new HistoryStateProvider(service, live, 1500);

    expect(provider.getEntityState("light.kitchen")?.state).toBe("off");
  });
});
