import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorItem, FloorplanCardConfig } from "./types";

// Devices take the same Home Assistant visibility conditions as furniture
// (issue #407). These run on the mounted card, so they also cover the
// render filter and the hass the card hands it (user conditions need it).

afterEach(() => {
  document.body.innerHTML = "";
});

const entity = (id: string, state: string) => ({
  entity_id: id,
  state,
  attributes: {},
  last_changed: "",
  last_updated: "",
  context: { id: "", parent_id: null, user_id: null },
});

function makeCard(device: Partial<FloorItem>, states: Record<string, string>, userId?: string) {
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.style.display = "block";
  card.style.width = "500px";
  card.style.height = "400px";
  card.setConfig({
    type: "custom:easy-floorplan-card",
    width: 600,
    height: 400,
    floors: [
      {
        id: "f1",
        name: "Ground",
        walls: [],
        openings: [],
        texts: [],
        trackers: [],
        furniture: [],
        items: [
          { id: "lamp", entity: "light.lamp", x: 200, y: 200, ...device },
          { id: "fan", entity: "fan.fan", x: 400, y: 200 },
        ],
      },
    ],
  } as unknown as FloorplanCardConfig);
  card.hass = {
    states: Object.fromEntries(Object.entries(states).map(([id, s]) => [id, entity(id, s)])),
    entities: {},
    user: userId ? { id: userId } : undefined,
    formatEntityState: (s: { state: string }) => s.state,
  } as unknown as FloorplanCard["hass"];
  return card;
}

const shownIds = (card: FloorplanCard) =>
  [...card.shadowRoot!.querySelectorAll(".fp-item")].map((e) => e.getAttribute("data-id")).sort();

describe("device visibility conditions on the mounted card", () => {
  it("hides a device for the wrong user and shows it for the right one", async () => {
    const visibility = [{ condition: "user" as const, users: ["u1"] }];
    const states = { "light.lamp": "on", "fan.fan": "off" };

    const other = makeCard({ visibility }, states, "u2");
    document.body.append(other);
    await other.updateComplete;
    expect(shownIds(other)).toEqual(["fan"]);
    other.remove();

    const owner = makeCard({ visibility }, states, "u1");
    document.body.append(owner);
    await owner.updateComplete;
    expect(shownIds(owner)).toEqual(["fan", "lamp"]);
  });

  it("follows a state condition on another entity as it changes", async () => {
    const card = makeCard(
      { visibility: [{ condition: "state", entity: "input_boolean.guest", state: "on" }] },
      { "light.lamp": "on", "fan.fan": "off", "input_boolean.guest": "off" }
    );
    document.body.append(card);
    await card.updateComplete;
    expect(shownIds(card)).toEqual(["fan"]);

    card.hass = {
      ...card.hass!,
      states: { ...card.hass!.states, "input_boolean.guest": entity("input_boolean.guest", "on") },
    };
    await card.updateComplete;
    expect(shownIds(card)).toEqual(["fan", "lamp"]);
  });
});
