import { nothing } from "lit";
import { describe, expect, it } from "vitest";
import type { Floor, FloorplanCardConfig, HomeAssistant, RenderHass } from "./types";
import { ambientDaylightEnabled, renderAmbientDaylightLayer } from "./ambient-daylight-integration";
import { collectWatchedEntities } from "./render";
import { getReplayWatchedEntities } from "./replay-history/replay-utils";

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

  // Area ids are hand-authored and can collide. Keyed on the id alone, a window
  // in the first room painted a patch into the second and the second resolved
  // its clip to the first room's polygon — daylight in a room with no opening
  // at all, shaped like a room somewhere else.
  it("keeps two rooms that share an id from lighting each other", () => {
    const twoRooms = floor();
    twoRooms.areas = [
      twoRooms.areas[0]!,
      // Same id, far away, and with no opening of its own.
      { id: "bedroom", name: "Other", points: [
        { x: 1000, y: 0 },
        { x: 1100, y: 0 },
        { x: 1100, y: 100 },
        { x: 1000, y: 100 },
      ] },
    ];

    const layer = renderAmbientDaylightLayer(
      twoRooms,
      config({ ambientDaylight: true }),
      hassWithElevation(25),
      "card-a",
      openingState,
    );
    const svg = serialize(layer);

    // The windowed room is lit, and it is the only one: exactly one clip, one
    // blur and one patch across the whole layer.
    expect(svg.match(/<clipPath/g)?.length).toBe(1);
    expect(svg.match(/fp-ambient-daylight-patch/g)?.length).toBe(1);
    // And the far room contributed no geometry of its own.
    expect(svg).not.toContain("1000,0");
  });

  // Subscribing to `sun.sun` is only half the contract. During replay the card
  // builds its state from the replay scope, and history is fetched for exactly
  // the entities in it; anything absent falls back to the live entity instead.
  // With the sun left out, every opening in the room replayed correctly while
  // the daylight over them stayed stuck on tonight.
  it("puts its sun in the replay scope so history is actually fetched for it", () => {
    expect(getReplayWatchedEntities(config())).not.toContain("sun.sun");
    expect(getReplayWatchedEntities(config({ ambientDaylight: true }))).toContain("sun.sun");
  });

  // The card renders every light layer through `renderHass`, which is the live
  // `hass` normally and the reconstructed past while replay history is running
  // (PR #204 merged after that feature landed). Reading `this.hass` here instead
  // would have shown tonight's darkness over a replayed midday plan.
  it("reads its sun through the replay-aware state source, not the live one", () => {
    const replayedNoon: Pick<RenderHass, "states"> = {
      states: {
        "sun.sun": {
          state: "above_horizon",
          attributes: { elevation: 40 },
        },
      },
    } as unknown as Pick<RenderHass, "states">;

    expect(
      renderAmbientDaylightLayer(
        floor(),
        config({ ambientDaylight: true }),
        replayedNoon,
        "card-a",
        openingState,
      ),
    ).not.toBe(nothing);

    const replayedNight: Pick<RenderHass, "states"> = {
      states: {
        "sun.sun": { state: "below_horizon", attributes: { elevation: -20 } },
      },
    } as unknown as Pick<RenderHass, "states">;

    expect(
      renderAmbientDaylightLayer(
        floor(),
        config({ ambientDaylight: true }),
        replayedNight,
        "card-a",
        openingState,
      ),
    ).toBe(nothing);
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

/** Flatten a Lit template the way `render.opening.test.ts` does. */
function serialize(node: unknown): string {
  if (node == null || node === false) return "";
  if (Array.isArray(node)) return node.map(serialize).join("");
  if (typeof node === "object" && "strings" in (node as Record<string, unknown>)) {
    const { strings, values } = node as { strings: string[]; values: unknown[] };
    let out = strings[0]!;
    for (let i = 0; i < values.length; i++) out += serialize(values[i]) + strings[i + 1]!;
    return out;
  }
  return String(node);
}
