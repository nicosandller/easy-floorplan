import { describe, it, expect } from "vitest";
import {
  defaultItemAction,
  hasAction,
  actionForGesture,
  serviceFromAction,
  executeAction,
} from "./actions";
import type { FloorItem, HomeAssistant } from "./types";

/** Minimal EventTarget stand-in (vitest runs without a DOM). */
const makeNode = () => {
  const events: { type: string; detail?: unknown }[] = [];
  return {
    events,
    dispatchEvent(ev: Event) {
      events.push({ type: ev.type, detail: (ev as CustomEvent).detail });
      return true;
    },
  } as unknown as HTMLElement & { events: { type: string; detail?: unknown }[] };
};

const makeHass = () => {
  const calls: unknown[][] = [];
  return {
    calls,
    callService: (...a: unknown[]) => calls.push(a),
  } as unknown as HomeAssistant & { calls: unknown[][] };
};

describe("defaultItemAction", () => {
  it("toggles controllable domains, more-info otherwise", () => {
    for (const e of ["light.a", "switch.a", "cover.a", "fan.a", "input_boolean.a"]) {
      expect(defaultItemAction(e)).toEqual({ action: "toggle" });
    }
    expect(defaultItemAction("sensor.a")).toEqual({ action: "more-info" });
    expect(defaultItemAction("binary_sensor.a")).toEqual({ action: "more-info" });
    expect(defaultItemAction(undefined)).toEqual({ action: "more-info" });
  });
});

describe("hasAction", () => {
  it("false for undefined and none", () => {
    expect(hasAction(undefined)).toBe(false);
    expect(hasAction({ action: "none" })).toBe(false);
    expect(hasAction({ action: "toggle" })).toBe(true);
  });
});

describe("actionForGesture", () => {
  const item = { entity: "light.a" } as FloorItem;

  it("tap falls back to the behavioral default; hold/double default to nothing", () => {
    expect(actionForGesture(item, "tap")).toEqual({ action: "toggle" });
    expect(actionForGesture(item, "hold")).toBeUndefined();
    expect(actionForGesture(item, "double_tap")).toBeUndefined();
  });

  it("configured actions win", () => {
    const it2 = {
      ...item,
      tap_action: { action: "none" },
      hold_action: { action: "more-info" },
    } as FloorItem;
    expect(actionForGesture(it2, "tap")).toEqual({ action: "none" });
    expect(actionForGesture(it2, "hold")).toEqual({ action: "more-info" });
  });
});

describe("serviceFromAction", () => {
  it("accepts both perform-action and legacy call-service spellings", () => {
    expect(
      serviceFromAction({
        action: "perform-action",
        perform_action: "light.turn_on",
        data: { brightness: 10 },
      })
    ).toEqual({ domain: "light", service: "turn_on", data: { brightness: 10 }, target: undefined });
    expect(
      serviceFromAction({ action: "call-service", service: "fan.toggle", service_data: { x: 1 } })
    ).toEqual({ domain: "fan", service: "toggle", data: { x: 1 }, target: undefined });
  });

  it("rejects missing or malformed service strings", () => {
    expect(serviceFromAction({ action: "perform-action" })).toBeNull();
    expect(serviceFromAction({ action: "call-service", service: "nodot" })).toBeNull();
  });
});

describe("executeAction", () => {
  it("toggle calls homeassistant.toggle on the item entity", () => {
    const hass = makeHass();
    executeAction(makeNode(), hass, { entity: "light.a" }, { action: "toggle" });
    expect(hass.calls[0]).toEqual(["homeassistant", "toggle", { entity_id: "light.a" }]);
  });

  it("perform-action and call-service both invoke callService with data and target", () => {
    const hass = makeHass();
    executeAction(makeNode(), hass, {}, {
      action: "perform-action",
      perform_action: "light.turn_on",
      data: { brightness: 5 },
      target: { area_id: "kitchen" },
    });
    executeAction(makeNode(), hass, {}, { action: "call-service", service: "light.turn_off" });
    expect(hass.calls).toEqual([
      ["light", "turn_on", { brightness: 5 }, { area_id: "kitchen" }],
      ["light", "turn_off", undefined, undefined],
    ]);
  });

  it("more-info fires hass-more-info with the override or item entity", () => {
    const n = makeNode();
    executeAction(n, makeHass(), { entity: "light.a" }, { action: "more-info" });
    expect(n.events).toEqual([{ type: "hass-more-info", detail: { entityId: "light.a" } }]);
    const n2 = makeNode();
    executeAction(n2, makeHass(), { entity: "light.a" }, { action: "more-info", entity: "sensor.b" });
    expect(n2.events[0].detail).toEqual({ entityId: "sensor.b" });
  });

  it("fire-dom-event dispatches ll-custom with the whole config", () => {
    const n = makeNode();
    const cfg = { action: "fire-dom-event", custom: 1 };
    executeAction(n, makeHass(), {}, cfg);
    expect(n.events[0]).toEqual({ type: "ll-custom", detail: cfg });
  });

  it("none and undefined do nothing", () => {
    const hass = makeHass();
    const n = makeNode();
    executeAction(n, hass, { entity: "light.a" }, undefined);
    executeAction(n, hass, { entity: "light.a" }, { action: "none" });
    expect(hass.calls.length).toBe(0);
    expect(n.events.length).toBe(0);
  });
});
