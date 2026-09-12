// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaybackController } from "./playback-controller";
import { HistoryService, type HistoryEventInput } from "./history-service";
import { HistoryStateProvider, LiveStateProvider } from "./state-provider";
import { HistoryTimeline } from "./history-timeline";
import { createReplayPanelProps } from "./replay-panel";
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

    expect(panel.shadowRoot).not.toBeNull();
    expect(panel.shadowRoot?.querySelector("style")?.textContent).toContain(".replay-panel");
  });
});

describe("the moment the panel is reporting", () => {
  // With the panel open the plan is always showing the past, so "where in time
  // am I" is the only question the header has left to answer. It used to be
  // buried in a row of grey text beside a Live/Replay chip that said which mode
  // you were in — a question that no longer exists, because the panel being
  // open *is* the mode.
  const header = async () => {
    const panel = document.createElement("easy-floorplan-replay-panel") as HTMLElement & {
      visible: boolean; currentTimeLabel: string; updateComplete: Promise<unknown>;
    };
    panel.visible = true;
    panel.currentTimeLabel = "3/14/25, 1:59:26 PM";
    document.body.appendChild(panel);
    await panel.updateComplete;
    return panel.shadowRoot!;
  };

  it("shows the head's timestamp", async () => {
    const root = await header();
    expect(root.querySelector(".replay-time")?.textContent?.trim()).toBe("3/14/25, 1:59:26 PM");
  });

  it("paints it rather than leaving it as running text", async () => {
    // The user-visible ask: make where-we-are-in-time obvious at a glance.
    const root = await header();
    const styles = root.querySelector("style")!.textContent!;
    const rule = styles.slice(styles.indexOf(".replay-time {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("background:");
  });

  it("no longer carries a mode chip", async () => {
    const root = await header();
    expect(root.querySelector(".replay-chip")).toBeNull();
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

describe("timeline cost during playback", () => {
  const T0 = 1_760_000_000_000;
  const WINDOW = 7_200_000;
  const busy = () =>
    Array.from({ length: 400 }, (_, i) => ({
      timestamp: T0 + Math.round((i / 400) * WINDOW),
      entityId: i % 2 ? "sensor.temp" : "light.kitchen",
      oldState: "a",
      newState: i % 2 ? String(20 + (i % 9)) : i % 4 ? "on" : "off",
      attributes: {},
    }));

  it("does not rebuild the markers when only the playhead moves", async () => {
    // The markers used to carry a `passed` class computed from currentTime, so
    // every one of them re-rendered on every frame of playback. Holding an
    // element identity across a seek is what proves they no longer do.
    const el = document.createElement("easy-floorplan-history-timeline") as HistoryTimeline;
    el.startTime = T0;
    el.endTime = T0 + WINDOW;
    el.currentTime = T0;
    el.events = busy();
    document.body.appendChild(el);
    await el.updateComplete;

    const markersBefore = [...(el.shadowRoot?.querySelectorAll(".marker") ?? [])];
    expect(markersBefore.length).toBeGreaterThan(100);

    el.currentTime = T0 + WINDOW * 0.75;
    await el.updateComplete;

    const markersAfter = [...(el.shadowRoot?.querySelectorAll(".marker") ?? [])];
    expect(markersAfter.length).toBe(markersBefore.length);
    // Same nodes, not replacements.
    expect(markersAfter.every((m, i) => m === markersBefore[i])).toBe(true);
  });

  it("publishes the playhead position for the markers to compare against", async () => {
    // The whole "passed" effect is now one custom property on the container,
    // which is why moving it costs nothing.
    const el = document.createElement("easy-floorplan-history-timeline") as HistoryTimeline;
    el.startTime = T0;
    el.endTime = T0 + WINDOW;
    el.currentTime = T0 + WINDOW / 4;
    el.events = busy();
    document.body.appendChild(el);
    await el.updateComplete;

    const track = el.shadowRoot?.querySelector(".timeline") as HTMLElement;
    expect(track.style.getPropertyValue("--playhead-pct")).toBe("25");

    el.currentTime = T0 + WINDOW / 2;
    await el.updateComplete;
    expect(track.style.getPropertyValue("--playhead-pct")).toBe("50");

    const marker = el.shadowRoot?.querySelector(".marker") as HTMLElement;
    expect(marker.style.getPropertyValue("--marker-pct")).not.toBe("");
  });

  it("caps a numeric lane but draws every discrete change", async () => {
    // A solid white bar tells you nothing: past ~150 markers a lane stops
    // showing individual events, so the numeric lanes get a budget while the
    // lights keep all of theirs.
    const events = [
      ...Array.from({ length: 1200 }, (_, i) => ({
        timestamp: T0 + Math.round((i / 1200) * WINDOW),
        entityId: "sensor.tracker_distance_x",
        oldState: "0", newState: String(i % 90), attributes: {},
      })),
      ...Array.from({ length: 400 }, (_, i) => ({
        timestamp: T0 + Math.round((i / 400) * WINDOW),
        entityId: "light.kitchen",
        oldState: "off", newState: i % 2 ? "on" : "off", attributes: {},
      })),
    ].sort((a, b) => a.timestamp - b.timestamp);

    const el = document.createElement("easy-floorplan-history-timeline") as HistoryTimeline;
    el.startTime = T0; el.endTime = T0 + WINDOW; el.currentTime = T0;
    el.expanded = true;
    el.events = events;
    document.body.appendChild(el);
    await el.updateComplete;

    const lanes = [...(el.shadowRoot?.querySelectorAll(".lane-track") ?? [])];
    const counts = lanes.map((l) => l.querySelectorAll(".marker").length).sort((a, b) => a - b);
    expect(counts).toEqual([150, 400]);
  });

  it("shows the time the playhead is sitting on, and moves it", async () => {
    const el = document.createElement("easy-floorplan-history-timeline") as HistoryTimeline;
    el.startTime = T0; el.endTime = T0 + WINDOW; el.currentTime = T0;
    el.events = busy();
    document.body.appendChild(el);
    await el.updateComplete;

    const label = () => el.shadowRoot?.querySelector(".playhead-time")?.textContent?.trim();
    const first = label();
    expect(first).toBeTruthy();
    expect(first).not.toBe("—");

    el.currentTime = T0 + WINDOW / 2;
    await el.updateComplete;
    expect(label()).not.toBe(first);
  });

  it("switches a lane off by clicking its label, summary bar included", async () => {
    const events = [
      ...Array.from({ length: 60 }, (_, i) => ({
        timestamp: T0 + Math.round((i / 60) * WINDOW),
        entityId: "sensor.noisy", oldState: "0", newState: String(i % 40), attributes: {},
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        timestamp: T0 + Math.round((i / 20) * WINDOW) + 7,
        entityId: "light.kitchen", oldState: "off", newState: i % 2 ? "on" : "off", attributes: {},
      })),
    ].sort((a, b) => a.timestamp - b.timestamp);

    const el = document.createElement("easy-floorplan-history-timeline") as HistoryTimeline;
    el.startTime = T0; el.endTime = T0 + WINDOW; el.currentTime = T0;
    el.expanded = true;
    el.events = events;
    document.body.appendChild(el);
    await el.updateComplete;

    const labels = [...(el.shadowRoot?.querySelectorAll(".lane-label") ?? [])] as HTMLButtonElement[];
    expect(labels).toHaveLength(2);
    expect(labels.every((l) => l.tagName === "BUTTON")).toBe(true);

    const noisy = labels.find((l) => l.textContent?.includes("noisy"))!;
    expect(noisy.getAttribute("aria-pressed")).toBe("true");
    noisy.click();
    await el.updateComplete;

    // The row stays, so it can be switched back on — but it draws nothing.
    const after = [...(el.shadowRoot?.querySelectorAll(".lane-label") ?? [])] as HTMLButtonElement[];
    expect(after).toHaveLength(2);
    const offLabel = after.find((l) => l.textContent?.includes("noisy"))!;
    expect(offLabel.classList.contains("lane-off")).toBe(true);
    expect(offLabel.getAttribute("aria-pressed")).toBe("false");
    const lanes = [...(el.shadowRoot?.querySelectorAll(".lane-track") ?? [])];
    const offLane = lanes.find((l) => l.classList.contains("lane-off"))!;
    expect(offLane.querySelectorAll(".marker")).toHaveLength(0);

    // And it is gone from the summary bar too, which is the point.
    el.expanded = false;
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll(".marker")).toHaveLength(20);
  });

  it("offers a way back once a lane is hidden", async () => {
    // Hiding a lane and then collapsing would otherwise strand it: the summary
    // bar has no labels to click.
    const el = document.createElement("easy-floorplan-history-timeline") as HistoryTimeline;
    el.startTime = T0; el.endTime = T0 + WINDOW; el.expanded = true;
    el.events = busy();
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".lanes-hidden")).toBeNull();

    (el.shadowRoot?.querySelector(".lane-label") as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".lanes-hidden")?.textContent).toContain("1 lane hidden");

    el.expanded = false;
    await el.updateComplete;
    const showAll = el.shadowRoot?.querySelector(".lanes-hidden-show") as HTMLButtonElement;
    expect(showAll).not.toBeNull();
    showAll.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".lanes-hidden")).toBeNull();
  });

  it("rebuilds when the events themselves change", async () => {
    const el = document.createElement("easy-floorplan-history-timeline") as HistoryTimeline;
    el.startTime = T0;
    el.endTime = T0 + WINDOW;
    el.events = busy();
    document.body.appendChild(el);
    await el.updateComplete;
    const before = (el.shadowRoot?.querySelectorAll(".marker") ?? []).length;

    el.events = busy().slice(0, 50);
    await el.updateComplete;
    const after = (el.shadowRoot?.querySelectorAll(".marker") ?? []).length;
    // The guard is keyed on the events, so a new list does redraw. (lit reuses
    // the leading DOM nodes when it diffs, so the count is the honest signal
    // here, not element identity.)
    expect(after).toBeLessThan(before);
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

  describe("enabled means the control is offered, not taken (issue #256)", () => {
    const replayConfig = {
      type: "easy-floorplan-card",
      width: 1000,
      height: 600,
      historyReplay: { enabled: true, lookbackSeconds: 3600 },
      floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], texts: [], furniture: [], trackers: [], areas: [],
        items: [{ id: "a", entity: "light.kitchen", x: 10, y: 10, kind: "light" }] }],
    };
    const hass = {
      states: { "light.kitchen": { entity_id: "light.kitchen", state: "on", attributes: {} } },
      entities: {}, callApi: vi.fn(async () => []), callService: vi.fn(),
      formatEntityState: (st: HassEntity) => st.state,
    } as unknown as HomeAssistant;

    const configured = () => {
      const card = document.createElement("easy-floorplan-card") as FloorplanCard;
      document.body.appendChild(card);
      card.hass = hass;
      card.setConfig(replayConfig as never);
      return { card, controller: (card as any)._replayController };
    };

    it("does not switch replay on by itself", () => {
      const { controller } = configured();
      expect(controller.state.enabled).toBe(false);
      // …so the plan is drawing live state, which is the whole point.
      expect(controller.getRenderState().enabled).toBe(false);
    });

    it("still offers the panel, so there is something to switch on with", async () => {
      const { card } = configured();
      await card.updateComplete;
      expect(card.shadowRoot?.querySelector("easy-floorplan-replay-panel")).toBeTruthy();
    });

    it("shows the window it would load rather than 1970", () => {
      // The unstarted panel used to be unreachable, so its placeholder window
      // (0..MAX) had never been seen. It reads the clock now, which is what
      // makes this test worth writing carefully: the window comes from
      // `Date.now()` at the moment it is asked for, so there is no second
      // reading of the clock that agrees with it. Bracketing the call is the
      // only assertion that holds however long the machine stalls in the
      // middle — a tolerance is just a guess about how slow is too slow.
      const { controller } = configured();
      const before = Date.now() / 1000;
      const props = createReplayPanelProps(controller);
      const after = Date.now() / 1000;
      expect(props.endTime).toBeGreaterThanOrEqual(before);
      expect(props.endTime).toBeLessThanOrEqual(after);
      // Both ends come from one reading, so the span is exact whatever the
      // clock did around it.
      expect(props.endTime - props.startTime).toBe(3600);
      expect(props.currentTime).toBe(props.endTime);
      expect(props.startInputValue).not.toContain("1970");
      expect(props.endInputValue).not.toContain("1970");
    });

    it("hands the window back to the panel once replay is running", async () => {
      const { controller } = configured();
      await controller.startReplay();
      const props = createReplayPanelProps(controller);
      expect(props.startTime).toBe(controller.state.playbackController.startTime);
      expect(props.endTime).toBe(controller.state.playbackController.endTime);
    });
  });

  describe("closing the panel is the way back to now", () => {
    const opened = async () => {
      const card = document.createElement("easy-floorplan-card") as FloorplanCard;
      card.setConfig({
        type: "easy-floorplan-card", width: 1000, height: 600,
        historyReplay: { enabled: true, lookbackSeconds: 3600 },
        floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [] }],
      } as never);
      const controller = (card as any)._replayController;
      controller.state.enabled = true;
      controller.state.historyVisible = true;
      controller.state.startTime = 1000;
      controller.state.endTime = 2000;
      controller.state.playbackController = new PlaybackController({ startTime: 1000, endTime: 2000 });
      controller.state.playbackController.seek(1200);
      controller.state.playbackController.play();
      controller.state.historyEvents = [{ entityId: "light.a", timestamp: 1300, state: "on" }];
      return controller;
    };

    it("stops the clock and hands the plan back to Home Assistant", async () => {
      const controller = await opened();
      controller.toggleHistoryVisible(false);
      expect(controller.state.playbackController.playing).toBe(false);
      expect(controller.getRenderState().enabled).toBe(false);
    });

    it("keeps what it loaded, so reopening costs no second fetch", async () => {
      const controller = await opened();
      controller.toggleHistoryVisible(false);
      expect(controller.state.enabled).toBe(true);
      expect(controller.state.historyEvents).toHaveLength(1);
    });

    it("offers no separate button back, because closing is the button", async () => {
      const controller = await opened();
      const panel = document.createElement("easy-floorplan-replay-panel") as HTMLElement & {
        visible: boolean; updateComplete: Promise<unknown>;
      };
      panel.visible = true;
      document.body.appendChild(panel);
      await panel.updateComplete;
      expect(panel.shadowRoot!.querySelector(".replay-live-button")).toBeNull();
      expect("onReturnLive" in createReplayPanelProps(controller)).toBe(false);
    });
  });

  describe("what the plan draws from (issue #256)", () => {
    // One rule: the panel is open, or the plan is live. Replay used to be able
    // to reach the plan through any path that started it — switching floors was
    // enough — and the symptom was silent, because a closed panel says nothing
    // about the head sitting an hour back. Lights that were on drew off and a
    // tripping presence sensor drew still, while toggling that light from the
    // plan really switched it, since the service call is live either way.
    const replayCard = () => {
      const card = document.createElement("easy-floorplan-card") as FloorplanCard;
      card.setConfig({
        type: "easy-floorplan-card",
        width: 1000,
        height: 600,
        historyReplay: { enabled: true, lookbackSeconds: 3600 },
        floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [] }],
      } as never);
      const controller = (card as any)._replayController;
      controller.state.enabled = true;
      controller.state.playbackController = new PlaybackController({ startTime: 1000, endTime: 2000 });
      return { card, controller };
    };

    it("draws live while the panel is closed, wherever the head is", () => {
      const { controller } = replayCard();
      for (const at of [1000, 1500, 2000]) {
        controller.state.playbackController.seek(at);
        expect(controller.getRenderState().enabled).toBe(false);
      }
    });

    it("draws live while the panel is closed, even mid-playback", () => {
      // The loaded-and-running case, which is what a floor switch used to leave
      // behind: a clock ticking against a plan nobody had asked to rewind.
      const { controller } = replayCard();
      controller.state.playbackController.seek(1500);
      controller.state.playbackController.play();
      expect(controller.getRenderState().enabled).toBe(false);
    });

    it("draws history once the panel is open", () => {
      const { controller } = replayCard();
      controller.state.historyVisible = true;
      controller.state.playbackController.seek(1500);
      const render = controller.getRenderState();
      expect(render.enabled).toBe(true);
      // …and reports where the head is, so the plan draws that moment.
      expect(render.currentTime).toBe(1500);
    });

    it("stays live when replay has never been started", () => {
      const { controller } = replayCard();
      controller.state.historyVisible = true;
      controller.state.enabled = false;
      controller.state.playbackController.seek(1500);
      expect(controller.getRenderState().enabled).toBe(false);
    });
  });

  describe("switching the feature off while the panel is open", () => {
    // The panel is only rendered while `historyReplay.enabled` is set, so
    // turning it off takes the control off screen. Left alone, that took the
    // way out without taking replay with it: the plan went on drawing an hour
    // ago with nothing anywhere to stop it.
    const openedThenDisabled = () => {
      const card = document.createElement("easy-floorplan-card") as FloorplanCard;
      const config = (replay: boolean) => ({
        type: "easy-floorplan-card", width: 1000, height: 600,
        historyReplay: { enabled: replay, lookbackSeconds: 3600 },
        floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [] }],
      });
      card.setConfig(config(true) as never);
      const controller = (card as any)._replayController;
      controller.state.enabled = true;
      controller.state.historyVisible = true;
      controller.state.playbackController = new PlaybackController({ startTime: 1000, endTime: 2000 });
      controller.state.playbackController.seek(1500);
      controller.state.playbackController.play();
      card.setConfig(config(false) as never);
      return controller;
    };

    it("puts the plan back to live", () => {
      expect(openedThenDisabled().getRenderState().enabled).toBe(false);
    });

    it("stops the clock and shuts the panel", () => {
      const controller = openedThenDisabled();
      expect(controller.state.playbackController.playing).toBe(false);
      expect(controller.state.historyVisible).toBe(false);
    });

    it("will not open replay a config does not offer", async () => {
      const card = document.createElement("easy-floorplan-card") as FloorplanCard;
      card.setConfig({
        type: "easy-floorplan-card", width: 1000, height: 600,
        historyReplay: { enabled: false, lookbackSeconds: 3600 },
        floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [] }],
      } as never);
      card.hass = {
        states: {}, entities: {}, callApi: vi.fn(async () => []), callService: vi.fn(),
        formatEntityState: (st: HassEntity) => st.state,
      } as unknown as HomeAssistant;
      const controller = (card as any)._replayController;
      const startSpy = vi.spyOn(controller, "startReplay");

      controller.toggleHistoryVisible(true);
      expect(startSpy).not.toHaveBeenCalled();
      expect(controller.getRenderState().enabled).toBe(false);
      // And it does not record the panel as open either: the flag means "on
      // screen", so leaving it set against a config that draws no panel would
      // have the two halves of that disagree.
      expect(controller.isHistoryVisible()).toBe(false);
      expect(controller.isReplayShowing()).toBe(false);
    });

    it("does not reopen already-open when the feature comes back", () => {
      const card = document.createElement("easy-floorplan-card") as FloorplanCard;
      const config = (replay: boolean) => ({
        type: "easy-floorplan-card", width: 1000, height: 600,
        historyReplay: { enabled: replay, lookbackSeconds: 3600 },
        floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [] }],
      });
      card.setConfig(config(false) as never);
      const controller = (card as any)._replayController;

      controller.toggleHistoryVisible(true);
      card.setConfig(config(true) as never);

      // A panel that comes back open would come back unstarted, because
      // nothing ever ran startReplay behind it.
      expect(controller.isHistoryVisible()).toBe(false);
    });
  });

  describe("a closed panel draws nothing from history (issue #256)", () => {
    // The reported symptom, on the rendered plan rather than in the controller:
    // a light that is on drew off, and a presence ripple that should have been
    // pulsing sat still, on a plan whose replay panel was shut. Replay had been
    // started by something that was not a person opening the panel, and there
    // was nothing on screen to say the plan had stopped being live.
    const rippleCard = () => {
      const card = document.createElement("easy-floorplan-card") as FloorplanCard;
      document.body.appendChild(card);
      card.setConfig({
        type: "easy-floorplan-card",
        width: 1000,
        height: 600,
        historyReplay: { enabled: true, lookbackSeconds: 3600 },
        floors: [{
          id: "f1", name: "Floor 1", walls: [], openings: [], texts: [], furniture: [], trackers: [], areas: [],
          items: [{ id: "a", entity: "binary_sensor.hall", x: 500, y: 300, kind: "sensor", display: "ripple" }],
        }],
      } as never);
      // On now; off an hour ago. The two disagree, so what gets drawn says
      // which one the plan is reading.
      card.hass = {
        states: { "binary_sensor.hall": { entity_id: "binary_sensor.hall", state: "on", attributes: {} } },
        entities: {}, callApi: vi.fn(async () => []), callService: vi.fn(),
        formatEntityState: (st: HassEntity) => st.state,
      } as unknown as HomeAssistant;

      const controller = (card as any)._replayController;
      controller.state.enabled = true;
      controller.state.ready = true;
      controller.state.playbackController = new PlaybackController({ startTime: 1000, endTime: 2000 });
      controller.state.playbackController.seek(1500);
      vi.spyOn(controller.historyService(), "getStateAt").mockReturnValue(
        new Map([["binary_sensor.hall", { entity_id: "binary_sensor.hall", state: "off", attributes: {} }]]),
      );
      return { card, controller };
    };

    const rippleIsPulsing = (card: FloorplanCard) =>
      card.shadowRoot!.querySelector(".ripple")?.classList.contains("active");

    it("keeps pulsing for a sensor that is tripping now, whatever history loaded", async () => {
      const { card } = rippleCard();
      await card.updateComplete;
      expect(rippleIsPulsing(card)).toBe(true);
    });

    it("shows the past only once the panel is open", async () => {
      const { card, controller } = rippleCard();
      await card.updateComplete;
      controller.state.historyVisible = true;
      card.requestUpdate();
      await card.updateComplete;
      expect(rippleIsPulsing(card)).toBe(false);
    });

    it("goes back to now when the panel is closed again", async () => {
      const { card, controller } = rippleCard();
      controller.state.historyVisible = true;
      card.requestUpdate();
      await card.updateComplete;

      controller.toggleHistoryVisible(false);
      await card.updateComplete;
      expect(rippleIsPulsing(card)).toBe(true);
    });
  });

  describe("the history cache survives an unrelated setConfig", () => {
    // HA calls setConfig on every keystroke in the config box. Clearing the
    // cache there meant one history query per character typed.
    const floor = (items: { id: string; x: number; y: number; entity?: string }[] = []) => ({
      id: "f1", name: "Floor 1",
      walls: [], openings: [], items, texts: [], furniture: [], trackers: [], areas: [],
    });
    const config = (over: Record<string, unknown> = {}, items?: Parameters<typeof floor>[0]) => ({
      type: "easy-floorplan-card",
      width: 1000,
      height: 600,
      historyReplay: { enabled: true, lookbackSeconds: 3600 },
      floors: [floor(items ?? [{ id: "a", x: 10, y: 10, entity: "sensor.a" }])],
      ...over,
    });

    const cardWithSpy = () => {
      const card = document.createElement("easy-floorplan-card") as FloorplanCard;
      card.setConfig(config() as never);
      const spy = vi.spyOn((card as any)._replayController.historyService(), "clearCache");
      return { card, spy };
    };

    it("keeps what it loaded when nothing replay depends on changed", () => {
      const { card, spy } = cardWithSpy();
      // Same config again, then an edit to a field replay does not read.
      card.setConfig(config() as never);
      card.setConfig(config({ title: "Downstairs" }) as never);
      card.setConfig(config({ width: 1200 }) as never);
      expect(spy).not.toHaveBeenCalled();
    });

    it("drops it when the replay window changes", () => {
      const { card, spy } = cardWithSpy();
      card.setConfig(config({ historyReplay: { enabled: true, lookbackSeconds: 7200 } }) as never);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("drops it when replay is switched off", () => {
      const { card, spy } = cardWithSpy();
      card.setConfig(config({ historyReplay: { enabled: false, lookbackSeconds: 3600 } }) as never);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("drops it when the entities a window is fetched for change", () => {
      const { card, spy } = cardWithSpy();
      card.setConfig(config({}, [
        { id: "a", x: 10, y: 10, entity: "sensor.a" },
        { id: "b", x: 20, y: 20, entity: "sensor.b" },
      ]) as never);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("ignores the order the same entities are written in", () => {
      const { card, spy } = cardWithSpy();
      card.setConfig(config({}, [
        { id: "b", x: 20, y: 20, entity: "sensor.b" },
        { id: "a", x: 10, y: 10, entity: "sensor.a" },
      ]) as never);
      // sensor.b is new, so this one does clear.
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockClear();
      card.setConfig(config({}, [
        { id: "a", x: 10, y: 10, entity: "sensor.a" },
        { id: "b", x: 20, y: 20, entity: "sensor.b" },
      ]) as never);
      // Same set, written the other way round: nothing to drop.
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it("logs replay lifecycle only when historyReplay.debug is set", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const base = {
      type: "easy-floorplan-card", width: 1000, height: 600,
      floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [] }],
    };

    const quiet = document.createElement("easy-floorplan-card") as FloorplanCard;
    quiet.setConfig({ ...base, historyReplay: { enabled: true } } as never);
    // seek is the one that fires per frame while the playhead is dragged.
    (quiet as any)._replayController.seekReplay(1000);
    expect(log).not.toHaveBeenCalled();

    const loud = document.createElement("easy-floorplan-card") as FloorplanCard;
    loud.setConfig({ ...base, historyReplay: { enabled: true, debug: true } } as never);
    (loud as any)._replayController.seekReplay(1000);
    expect(log).toHaveBeenCalled();
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

  it("reloads replay when the visible floor changes, but only while the panel is open", async () => {
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
      callApi: vi.fn(async () => {
        const older = new Date(Date.now() - 20 * 60 * 1000).toISOString();
        const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        return [
          { entity_id: "light.kitchen", states: [{ state: "off", last_updated: older }, { state: "on", last_updated: recent }] },
          { entity_id: "switch.lounge", states: [{ state: "off", last_updated: older }, { state: "on", last_updated: recent }] },
        ];
      }),
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

    // Closed: a floor switch is not a request to rewind, and reloading here is
    // how replay used to turn itself on behind a shut panel (issue #256).
    (card as any)._goToFloor(floors, "floor-2");
    expect(startSpy).not.toHaveBeenCalled();
    expect(getReplayWatchedEntities((card as any)._config, (card as any)._activeFloorId)).toEqual(["switch.lounge"]);

    // Open: the window on screen has to follow the floor on screen.
    (card as any)._replayController.state.historyVisible = true;
    (card as any)._goToFloor(floors, "floor-1");
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(getReplayWatchedEntities((card as any)._config, (card as any)._activeFloorId)).toEqual(["light.kitchen"]);
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

  it("loads history when replay is switched on, not merely offered (issue #256)", async () => {
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

    // Configuring replay offers the control; it does not take the plan over,
    // so nothing has been fetched yet and the plan is still drawing live.
    expect(callApi).not.toHaveBeenCalled();

    const showButton = getReplayPanelShadowRoot(card)?.querySelector(".replay-show-toggle") as HTMLButtonElement | null;
    showButton?.click();
    await card.updateComplete;

    // Switching it on is what loads the history behind the timeline.
    await (card as any)._replayController.startReplay();
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
      callApi: vi.fn(async () => {
        const older = new Date(Date.now() - 20 * 60 * 1000).toISOString();
        const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        return [{
          entity_id: "light.kitchen",
          states: [
            { state: "off", attributes: {}, last_updated: older },
            { state: "on", attributes: { color: "#ffcc00" }, last_updated: recent },
          ],
        }];
      }),
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
      callApi: vi.fn(async () => {
        const older = new Date(Date.now() - 20 * 60 * 1000).toISOString();
        const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        return [{ entity_id: "light.kitchen", states: [{ state: "off", last_updated: older }, { state: "on", last_updated: recent }] }];
      }),
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
      callApi: vi.fn(async () => {
        const older = new Date(Date.now() - 20 * 60 * 1000).toISOString();
        const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        return [
          { entity_id: "light.kitchen", states: [{ state: "off", last_updated: older }, { state: "on", last_updated: recent }] },
          { entity_id: "light.lounge", states: [{ state: "off", last_updated: older }, { state: "on", last_updated: recent }] },
        ];
      }),
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
    // Short visible label so the button matches the floor buttons beside it;
    // the full description stays for screen readers.
    expect(showButton?.textContent?.trim()).toBe("Replay");
    expect(showButton?.getAttribute("aria-label")).toBe("Show replay history");
    expect(getReplayPanelShadowRoot(card)?.querySelector(".replay-hide-toggle")).toBeNull();

    showButton?.click();
    await card.updateComplete;

    const hideButton = getReplayPanelShadowRoot(card)?.querySelector(".replay-hide-toggle") as HTMLButtonElement | null;
    expect(hideButton).not.toBeNull();
    // Closing is what returns the plan to now, so the button says what it does
    // rather than what it does to the panel.
    expect(hideButton?.textContent?.trim()).toBe("live");
    expect(hideButton?.getAttribute("aria-label")).toBe("Close replay and return to live");
  });

  it("filters replay history to entities mapped on the active floor only", async () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;

    card.hass = {
      states: {
        "light.kitchen": { entity_id: "light.kitchen", state: "off", attributes: { friendly_name: "Kitchen" } },
        "light.lounge": { entity_id: "light.lounge", state: "off", attributes: { friendly_name: "Lounge" } },
      },
      callApi: vi.fn(async () => []),
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

    // Replay is offered, not started (issue #256), so ask for it — the point
    // of this test is *which* entities the request covers, not when it fires.
    await (card as any)._replayController.startReplay();

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
