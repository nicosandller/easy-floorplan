import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig, Furniture } from "./types";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeCard(view: "2d" | "3d", piece: Partial<Furniture>, states: Record<string, string>) {
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.style.display = "block";
  card.style.width = "500px";
  card.style.height = "400px";

  const cfg: FloorplanCardConfig = {
    type: "custom:easy-floorplan-card",
    width: 600,
    height: 400,
    view,
    wallHeight: 60,
    walls: [],
    openings: [],
    items: [],
    texts: [],
    trackers: [],
    floors: [
      {
        id: "f1",
        name: "Ground",
        walls: [],
        openings: [],
        items: [],
        texts: [],
        trackers: [],
        furniture: [
          {
            id: "garage_car",
            type: "car",
            x: 300,
            y: 200,
            w: 90,
            h: 180,
            ...piece,
          },
        ],
      },
    ],
  } as unknown as FloorplanCardConfig;

  card.setConfig(cfg);
  card.hass = {
    states: Object.fromEntries(
      Object.entries(states).map(([id, state]) => [
        id,
        {
          entity_id: id,
          state,
          attributes: {},
          last_changed: "",
          last_updated: "",
          context: { id: "", parent_id: null, user_id: null },
        },
      ])
    ),
    entities: {},
    formatEntityState: (s: { state: string }) => s.state,
  } as unknown as FloorplanCard["hass"];

  return card;
}

describe("furniture visibility on mounted card", () => {
  it("shows furniture when state condition is met and hides when unmet (2D)", async () => {
    const card = makeCard(
      "2d",
      {
        visibility: [{ condition: "state", entity: "device_tracker.car", state: "home" }],
      },
      { "device_tracker.car": "home" }
    );
    document.body.append(card);
    await card.updateComplete;

    // 1. Visible when home
    expect(card.shadowRoot!.querySelector(".fp-furniture-car")).not.toBeNull();

    // 2. Hide when car leaves
    card.hass = {
      ...card.hass!,
      states: {
        ...card.hass!.states,
        "device_tracker.car": {
          entity_id: "device_tracker.car",
          state: "away",
          attributes: {},
          last_changed: "",
          last_updated: "",
          context: { id: "", parent_id: null, user_id: null },
        },
      },
    };
    await card.updateComplete;

    expect(card.shadowRoot!.querySelector(".fp-furniture-car")).toBeNull();

    // 3. Re-appears when car returns
    card.hass = {
      ...card.hass!,
      states: {
        ...card.hass!.states,
        "device_tracker.car": {
          entity_id: "device_tracker.car",
          state: "home",
          attributes: {},
          last_changed: "",
          last_updated: "",
          context: { id: "", parent_id: null, user_id: null },
        },
      },
    };
    await card.updateComplete;

    expect(card.shadowRoot!.querySelector(".fp-furniture-car")).not.toBeNull();
  });

  it("filters 3D isometric solids when condition is unmet", async () => {
    const card = makeCard(
      "3d",
      {
        visibility: [{ condition: "state", entity: "device_tracker.car", state: "home" }],
      },
      { "device_tracker.car": "away" }
    );
    document.body.append(card);
    await card.updateComplete;

    // In 3D, the furniture top glyph or solid has .fp-furniture-car inside the iso layers
    expect(card.shadowRoot!.querySelector(".fp-furniture-car")).toBeNull();

    card.hass = {
      ...card.hass!,
      states: {
        ...card.hass!.states,
        "device_tracker.car": {
          entity_id: "device_tracker.car",
          state: "home",
          attributes: {},
          last_changed: "",
          last_updated: "",
          context: { id: "", parent_id: null, user_id: null },
        },
      },
    };
    await card.updateComplete;

    expect(card.shadowRoot!.querySelector(".fp-furniture-car")).not.toBeNull();
  });

  it("conditionally toggles furniture visibility with garage_door.is_open and garage_door.is_closed", async () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    const cfg: FloorplanCardConfig = {
      type: "custom:easy-floorplan-card",
      width: 600,
      height: 400,
      walls: [],
      openings: [],
      items: [],
      texts: [],
      trackers: [],
      floors: [
        {
          id: "f1",
          name: "Ground",
          walls: [],
          openings: [],
          items: [],
          texts: [],
          trackers: [],
          furniture: [
            {
              id: "furn_vqvojun",
              type: "ladderShelf",
              x: 100,
              y: 100,
              w: 50,
              h: 50,
              visibility: [
                {
                  condition: "garage_door.is_open",
                  target: { entity_id: "cover.garage_door" },
                  options: { behavior: "any", for: "00:00:00" },
                },
              ],
            },
            {
              id: "furn_1gdbc5q",
              type: "car_ev",
              x: 200,
              y: 200,
              w: 50,
              h: 50,
              visibility: [
                {
                  condition: "garage_door.is_closed",
                  target: { entity_id: "cover.garage_door" },
                  options: { behavior: "any", for: "00:00:00" },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as FloorplanCardConfig;

    card.setConfig(cfg);
    card.hass = {
      states: {
        "cover.garage_door": {
          entity_id: "cover.garage_door",
          state: "closed",
          attributes: {},
          last_changed: "",
          last_updated: "",
          context: { id: "", parent_id: null, user_id: null },
        },
      },
      entities: {},
      formatEntityState: (s: { state: string }) => s.state,
    } as unknown as FloorplanCard["hass"];

    document.body.append(card);
    await card.updateComplete;

    // Closed: furn_1gdbc5q (car_ev) is visible, furn_vqvojun (ladderShelf) is hidden
    expect(card.shadowRoot!.querySelector(".fp-furniture-ladderShelf")).toBeNull();
    expect(card.shadowRoot!.querySelector(".fp-furniture-car_ev")).not.toBeNull();

    // Open the garage door:
    card.hass = {
      ...card.hass!,
      states: {
        ...card.hass!.states,
        "cover.garage_door": {
          entity_id: "cover.garage_door",
          state: "open",
          attributes: {},
          last_changed: "",
          last_updated: "",
          context: { id: "", parent_id: null, user_id: null },
        },
      },
    };
    await card.updateComplete;

    // Open: furn_vqvojun (ladderShelf) is visible, furn_1gdbc5q (car_ev) is hidden
    expect(card.shadowRoot!.querySelector(".fp-furniture-ladderShelf")).not.toBeNull();
    expect(card.shadowRoot!.querySelector(".fp-furniture-car_ev")).toBeNull();
  });
});

