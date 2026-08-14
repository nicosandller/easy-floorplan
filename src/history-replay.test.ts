import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaybackController } from "./playback-controller";
import { HistoryService, type HistoryEventInput } from "./history-service";
import { HistoryStateProvider, LiveStateProvider } from "./state-provider";
import { HistoryTimeline } from "./history-timeline";
import { FloorplanCard } from "./floorplan-card";
import type { HomeAssistant, HassEntity } from "./types";

import "./history-timeline";
import "./floorplan-card";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

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
});

describe("FloorplanCard replay", () => {
  it("derives a 30-second default playback speed from the selected replay window", () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    card.setConfig({
      type: "easy-floorplan-card",
      width: 1000,
      height: 600,
      historyReplay: { enabled: true, lookbackSeconds: 3600, defaultSpeed: 1 },
      floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [] }],
    });

    const replaySpeed = (card as unknown as { _getReplaySpeedForRange(start: number, end: number): number })._getReplaySpeedForRange(1000, 3700);
    expect(replaySpeed).toBe(90);
  });

  it("maps logarithmic slider values to replay speed and back", () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    const sliderToSpeed = (card as unknown as { _sliderValueToReplaySpeed(value: number): number })._sliderValueToReplaySpeed.bind(card);
    const speedToSlider = (card as unknown as { _replaySpeedToSliderValue(speed: number): number })._replaySpeedToSliderValue.bind(card);

    expect(sliderToSpeed(-2)).toBe(0.01);
    expect(sliderToSpeed(0)).toBe(1);
    expect(sliderToSpeed(3)).toBe(1000);

    expect(speedToSlider(0.01)).toBeCloseTo(-2, 3);
    expect(speedToSlider(1)).toBeCloseTo(0, 3);
    expect(speedToSlider(1000)).toBeCloseTo(3, 3);
  });

  it("renders a ripple fallback for active items without an explicit display setting", async () => {
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
    expect(card.shadowRoot?.querySelector(".item .ripple")).not.toBeNull();
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

    expect(card.shadowRoot?.querySelector(".replay-event-log")).not.toBeNull();
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
      floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [] }],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callApi).toHaveBeenCalled();
    const timelines = card.shadowRoot?.querySelectorAll("easy-floorplan-history-timeline");
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
      floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [] }],
    });

    (card as unknown as { _historyEvents: Array<{ timestamp: number; entityId: string; oldState: string; newState: string; attributes?: Record<string, unknown> }> })._historyEvents = [
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

    const logToggle = card.shadowRoot?.querySelector(".replay-log-toggle") as HTMLButtonElement | null;
    logToggle?.click();
    await card.updateComplete;

    const dot = card.shadowRoot?.querySelector(".replay-event-dot") as HTMLElement | null;
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
      floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [] }],
    });

    (card as unknown as { _historyEvents: Array<{ timestamp: number; entityId: string; oldState: string; newState: string; attributes?: Record<string, unknown> }> })._historyEvents = [
      {
        timestamp: 1000,
        entityId: "light.kitchen",
        oldState: "off",
        newState: "on",
        attributes: {},
      },
    ];
    (card as unknown as { _replayReady: boolean })._replayReady = true;
    card.requestUpdate();
    await card.updateComplete;

    expect(card.shadowRoot?.querySelector(".replay-event-log.collapsed")).not.toBeNull();
    const toggle = card.shadowRoot?.querySelector(".replay-log-toggle") as HTMLButtonElement | null;
    toggle?.click();
    await card.updateComplete;
    expect(card.shadowRoot?.querySelector(".replay-event-log.expanded")).not.toBeNull();
    expect(card.shadowRoot?.querySelector(".replay-event-list")).not.toBeNull();
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
