import { describe, expect, it } from "vitest";
import type { FloorplanCardConfig } from "./types";
import { projectReliefForm } from "./editor-forms";

function config(extra: Partial<FloorplanCardConfig> = {}): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 100,
    height: 100,
    walls: [],
    openings: [],
    items: [],
    texts: [],
    furniture: [],
    trackers: [],
    areas: [],
    ...extra,
  };
}

describe("ambient daylight editor contract", () => {
  it("shows ambient daylight independently of direct sunlight", () => {
    const form = projectReliefForm(config());
    expect(form.fields.map((field) => field.name)).toEqual(["ambientDaylight", "sunlight"]);
    expect(form.data.ambientDaylight).toBe(false);
  });

  it("stores only an explicit enabled ambient option", () => {
    const form = projectReliefForm(config());
    expect(form.toPatch({ ambientDaylight: true })).toEqual({ ambientDaylight: true });
    expect(form.toPatch({ ambientDaylight: false })).toEqual({ ambientDaylight: undefined });
  });

  it("keeps ambient daylight enabled when direct sunlight is switched off", () => {
    const form = projectReliefForm(config({ ambientDaylight: true, sunlight: true }));
    const patch = form.toPatch({ ambientDaylight: true, sunlight: false });
    expect(patch.ambientDaylight).toBe(true);
    expect(patch.sunlight).toBeUndefined();
  });
});
