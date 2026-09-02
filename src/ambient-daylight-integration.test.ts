import { nothing } from "lit";
import { describe, expect, it } from "vitest";
import type { Floor, FloorplanCardConfig, HomeAssistant } from "./types";
import { ambientDaylightEnabled, renderAmbientDaylightLayer } from "./ambient-daylight-integration";
import { collectWatchedEntities } from "./render";

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

function floor(): Floor {
  return {
    id: "ground",
    name: "Ground",
    walls: [],
    openings: [
      { id: "north-window", type: "window", x: 50, y: 0, length: 30, angle: 0 },
    ],
    items: [],
    texts: [],
    furniture: [],
    trackers: [],
    areas: [
      {
        id: "bedroom",
        name: "Bedroom",
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      },
    ],
  };
}

const openingState = {
  amount: () => 0,
  secondAmount: () => undefined,
};

function hassWithElevation(elevation: unknown): HomeAssistant {
  return {
    states: {
      "sun.sun": {
        state: "above_horizon",
        attributes: { elevation },
      },
    },
  } as unknown as HomeAssistant;
}

describe("ambient daylight host integration", () => {
  it("is a strict opt-in and registers its sun input in the central watcher set", () => {
    expect(ambientDaylightEnabled(config())).toBe(false);
    expect(ambientDaylightEnabled(config({ ambientDaylight: false }))).toBe(false);
    expect(ambientDaylightEnabled(config({ ambientDaylight: true }))).toBe(true);
    expect(collectWatchedEntities(config())).not.toContain("sun.sun");
    expect(collectWatchedEntities(config({ ambientDaylight: true }))).toContain("sun.sun");
  });

  it("returns no layer while disabled or without Area geometry", () => {
    expect(renderAmbientDaylightLayer(floor(), config(), undefined, "card-a", openingState)).toBe(nothing);

    const noAreas = floor();
    noAreas.areas = [];
    expect(
      renderAmbientDaylightLayer(noAreas, config({ ambientDaylight: true }), undefined, "card-a", openingState),
    ).toBe(nothing);
  });

  it("builds a daytime layer from an exterior window without direct sunlight", () => {
    expect(
      renderAmbientDaylightLayer(
        floor(),
        config({ ambientDaylight: true, sunlight: false }),
        hassWithElevation(25),
        "card-a",
        openingState,
      ),
    ).not.toBe(nothing);
  });

  it("fails dark while sun elevation is missing or unreadable", () => {
    expect(
      renderAmbientDaylightLayer(floor(), config({ ambientDaylight: true }), undefined, "card-a", openingState),
    ).toBe(nothing);
    expect(
      renderAmbientDaylightLayer(
        floor(),
        config({ ambientDaylight: true }),
        hassWithElevation("unavailable"),
        "card-a",
        openingState,
      ),
    ).toBe(nothing);
  });
});
