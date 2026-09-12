/**
 * What the card actually renders into a badge, in a real browser.
 *
 * This exists because of the bug it is named for: a device set to show its
 * reading rendered the reading in the editor and the icon on the card. The
 * card's own render path was never covered — the node suite cannot import
 * `floorplan-card.ts` at all, since defining a custom element needs a DOM —
 * so every test of "value or icon" was a test of the pure helper that decides
 * the text, and the helper was right the whole time. What was wrong was the
 * wiring around it, which only a mounted card can see (issue #254).
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import { badgeValue } from "./render";
import type { FloorItem, FloorplanCardConfig } from "./types";

function config(item: Partial<FloorItem>): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 600,
    floors: [
      {
        id: "f1",
        name: "Floor 1",
        walls: [],
        openings: [],
        items: [
          { id: "s1", kind: "sensor", entity: "sensor.temp", x: 500, y: 300, ...item } as FloorItem,
        ],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      },
    ],
  };
}

const hass = {
  states: {
    "sensor.temp": {
      entity_id: "sensor.temp",
      state: "21.5",
      attributes: { unit_of_measurement: "°C" },
    },
  },
  entities: {},
  formatEntityState: (st: { state: string }) => st.state,
} as unknown as FloorplanCard["hass"];

async function mountCard(item: Partial<FloorItem>) {
  const host = document.createElement("div");
  host.style.width = "900px";
  host.style.height = "540px";
  document.body.appendChild(host);

  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config(item));
  card.hass = hass;
  host.appendChild(card);
  await card.updateComplete;

  const root = card.shadowRoot!;
  return {
    card,
    badgeValue: () => root.querySelector(".badge .badge-value")?.textContent?.trim(),
    badgeIcon: () => root.querySelector(".badge ha-icon")?.getAttribute("icon") ?? undefined,
  };
}

describe("badge contents on the rendered card", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // What the helper says this device's badge should read. Asserting against
  // it rather than a literal keeps these about the *wiring* — whether the card
  // renders the answer at all — which is what broke. How a reading is worded
  // is `badgeValue`'s own business and has its own tests.
  const expected = badgeValue(hass as never, {
    entity: "sensor.temp",
  } as never);

  it("shows the reading when the badge is set to Value (issue #254)", async () => {
    const t = await mountCard({ badgeContent: "value" });
    expect(expected).toBeTruthy(); // the fixture has something to show
    expect(t.badgeValue()).toBe(expected);
    // …and the glyph it replaces is not also drawn.
    expect(t.badgeIcon()).toBeUndefined();
  });

  it("still shows the icon when the badge is set to Icon", async () => {
    const t = await mountCard({ badgeContent: "icon" });
    expect(t.badgeValue()).toBeUndefined();
    expect(t.badgeIcon()).toBeTruthy();
  });

  it("shows the reading through a ripple too, which is the path that kept working", async () => {
    // Both branches of the same `if` call the badge renderer, and the merge
    // that broke this one left the other correct — so a test of either alone
    // would have missed it.
    const t = await mountCard({ badgeContent: "value", display: "iconRipple" });
    expect(t.badgeValue()).toBe(expected);
  });

  it("falls back to the icon when the entity has nothing numeric to show", async () => {
    const t = await mountCard({ badgeContent: "value", entity: "sensor.missing" });
    expect(t.badgeValue()).toBeUndefined();
    expect(t.badgeIcon()).toBeTruthy();
  });
});

describe("an attribute reading is worded by HA, on the card too (issue #260)", () => {
  // A cover's position is a bare number on the state object; the "%" comes
  // from HA's own attribute formatter. The editor hands the real `hass` to the
  // helper that asks for it, the card hands it a RenderHass built from that —
  // and the build did not carry the formatter, so the same cover read "50%"
  // while you were editing it and "50" once you saved.
  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function mountCover() {
    const host = document.createElement("div");
    host.style.width = "900px";
    host.style.height = "540px";
    document.body.appendChild(host);

    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    card.setConfig({
      type: "custom:easy-floorplan-card",
      width: 1000,
      height: 600,
      floors: [{
        id: "f1", name: "Floor 1", walls: [], openings: [], texts: [], furniture: [], trackers: [], areas: [],
        items: [{
          id: "c1", kind: "cover", entity: "cover.blind", x: 500, y: 300,
          name: "Blind", showName: true, showState: true, attribute: "current_position",
        } as unknown as FloorItem],
      }],
    } as FloorplanCardConfig);
    card.hass = {
      states: {
        "cover.blind": {
          entity_id: "cover.blind",
          state: "open",
          attributes: { current_position: 50, device_class: "shutter" },
        },
      },
      entities: {},
      formatEntityState: (st: { state: string }) => st.state,
      formatEntityAttributeValue: (_st: unknown, attribute: string) =>
        attribute === "current_position" ? "50%" : "?",
    } as unknown as FloorplanCard["hass"];
    host.appendChild(card);
    await card.updateComplete;
    return card;
  }

  it("keeps the unit HA put on the position", async () => {
    const card = await mountCover();
    expect(card.shadowRoot?.querySelector(".label")?.textContent?.trim()).toContain("50%");
  });
});

describe("a device is drawn from one instant, not two", () => {
  // Replay renders the plan from `renderHass` — history at the playback head.
  // Anything in a device that still read `this.hass` disagreed with the rest
  // of the same device the moment the head moved: a motion sensor pulsing
  // because something is happening *now*, on a plan showing an hour ago.
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const motion = {
    id: "m1",
    kind: "binary_sensor",
    entity: "binary_sensor.motion",
    x: 500,
    y: 300,
    display: "iconRipple",
    iconAnimation: "pulse",
  } as unknown as FloorItem;

  async function mountWithReplayAt(state: string) {
    const host = document.createElement("div");
    host.style.width = "900px";
    host.style.height = "540px";
    document.body.appendChild(host);

    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    card.setConfig({
      type: "custom:easy-floorplan-card",
      width: 1000,
      height: 600,
      // Replay only reaches the plan from a panel that is on screen, which
      // takes the config as well as the open flag set below.
      historyReplay: { enabled: true, lookbackSeconds: 3600 },
      floors: [
        {
          id: "f1", name: "Floor 1", walls: [], openings: [], items: [motion],
          texts: [], furniture: [], trackers: [], areas: [],
        },
      ],
    } as FloorplanCardConfig);
    // Live says the sensor is clear; the replayed instant says it detected
    // something. The plan is drawing the replayed instant.
    card.hass = {
      states: {
        "binary_sensor.motion": {
          entity_id: "binary_sensor.motion",
          state: "off",
          attributes: { device_class: "motion" },
        },
      },
      entities: {},
      formatEntityState: (st: { state: string }) => st.state,
    } as unknown as FloorplanCard["hass"];
    host.appendChild(card);
    await card.updateComplete;

    const controller = (card as unknown as { _replayController: {
      state: { enabled: boolean; historyVisible: boolean };
      historyService: () => { getStateAt: (t: number) => Map<string, unknown> };
    } })._replayController;
    // Both, because both are required: replay has been started, and the panel
    // is open. A closed panel draws live no matter what history is loaded.
    controller.state.enabled = true;
    controller.state.historyVisible = true;
    controller.historyService().getStateAt = () =>
      new Map([[
        "binary_sensor.motion",
        { entity_id: "binary_sensor.motion", state, attributes: { device_class: "motion" } },
      ]]);
    card.requestUpdate();
    await card.updateComplete;
    return card;
  }

  it("animates the icon from the replayed state, not the live one", async () => {
    const card = await mountWithReplayAt("on");
    // Live is "off"; the replayed instant is "on", and the badge follows it.
    expect(card.shadowRoot?.querySelector("ha-icon.anim-pulse")).toBeTruthy();
    // …and the ring beside it agrees, which it always did.
    expect(card.shadowRoot?.querySelector(".ripple.active")).toBeTruthy();
  });

  it("leaves both still when the replayed instant is clear", async () => {
    const card = await mountWithReplayAt("off");
    expect(card.shadowRoot?.querySelector("ha-icon.anim-pulse")).toBeFalsy();
    expect(card.shadowRoot?.querySelector(".ripple.active")).toBeFalsy();
  });
});
