/** The picker's sample plan (issue #434): when it applies and what it draws. */
import { describe, expect, it } from "vitest";
import { isBlankPlan, pickerPreviewConfig, pickerPreviewHass, PICKER_PREVIEW_LAMP } from "./picker-preview";
import { newPlanConfig } from "./types";
import type { FloorplanCardConfig, HomeAssistant } from "./types";

describe("isBlankPlan", () => {
  it("is true for the config a new card starts from", () => {
    expect(isBlankPlan({ type: "custom:easy-floorplan-card", ...newPlanConfig() } as FloorplanCardConfig)).toBe(true);
    expect(isBlankPlan({ walls: [], items: [], floors: [] } as unknown as FloorplanCardConfig)).toBe(true);
  });
  it("is false once anything is drawn, or with no config", () => {
    expect(isBlankPlan({ walls: [{ id: "w", x1: 0, y1: 0, x2: 1, y2: 0 }] } as FloorplanCardConfig)).toBe(false);
    expect(isBlankPlan({ floors: [{ id: "f" }] } as unknown as FloorplanCardConfig)).toBe(false);
    expect(isBlankPlan(undefined)).toBe(false);
  });
});

describe("pickerPreviewConfig", () => {
  it("draws a room with a door, a window, a sofa and the sample lamp", () => {
    const c = pickerPreviewConfig();
    expect(c.walls).toHaveLength(4);
    expect(c.openings!.map((o) => o.type)).toEqual(["door", "window"]);
    expect(c.furniture!.map((f) => f.type)).toEqual(["sofa"]);
    expect(c.items![0]!.entity).toBe(PICKER_PREVIEW_LAMP);
    expect(isBlankPlan(c)).toBe(false);
  });
  it("keeps the stub's own settings and type", () => {
    const c = pickerPreviewConfig({ type: "custom:easy-floorplan-card", overlayScale: "plan" } as FloorplanCardConfig);
    expect(c.type).toBe("custom:easy-floorplan-card");
    expect(c.overlayScale).toBe("plan");
  });
});

describe("pickerPreviewHass", () => {
  const hass = { states: { "sun.sun": { state: "above_horizon" } } } as unknown as HomeAssistant;
  it("adds the lamp, switched on, without touching the rest", () => {
    const h = pickerPreviewHass(hass);
    expect(h.states[PICKER_PREVIEW_LAMP]!.state).toBe("on");
    expect(h.states["sun.sun"]).toBe(hass.states["sun.sun"]);
    expect(hass.states[PICKER_PREVIEW_LAMP]).toBeUndefined();
  });
  it("returns the same object once the lamp is there", () => {
    const h = pickerPreviewHass(hass);
    expect(pickerPreviewHass(h)).toBe(h);
  });
});
