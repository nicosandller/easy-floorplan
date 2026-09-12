/**
 * The badge colour of a device that is *off* (issue #228).
 *
 * In a real browser because the whole feature is a painted colour: the class,
 * the custom property and the CSS rule have to line up, and a node test of the
 * helper that picks the colour would pass with any of the three missing.
 *
 * The domain cases are the reason this is a first-class option rather than a
 * `stateColor` rule. `state: "off"` is right for a switch and silently wrong
 * for a lock, a cover or a vacuum, which say `locked`, `closed` and `docked`.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorItem, FloorplanCardConfig } from "./types";

const OFF_RED = "rgb(198, 40, 40)";
const ON_GREEN = "rgb(46, 125, 50)";

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
        items: [{ id: "s1", x: 500, y: 300, ...item } as FloorItem],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      },
    ],
  } as FloorplanCardConfig;
}

/** One entity per domain, each in that domain's own word for "off". */
const states: Record<string, { entity_id: string; state: string; attributes: object }> = {
  "switch.a": { entity_id: "switch.a", state: "off", attributes: {} },
  "switch.on": { entity_id: "switch.on", state: "on", attributes: {} },
  "lock.a": { entity_id: "lock.a", state: "locked", attributes: {} },
  "cover.a": { entity_id: "cover.a", state: "closed", attributes: {} },
  "vacuum.a": { entity_id: "vacuum.a", state: "docked", attributes: {} },
  "sensor.a": { entity_id: "sensor.a", state: "21.5", attributes: {} },
  // Issue #162's three ways of having dropped out. `cover.gone` is deliberately
  // absent from this table — an entity id nothing answers to is the third.
  "cover.dead": { entity_id: "cover.dead", state: "unavailable", attributes: {} },
  "cover.blank": { entity_id: "cover.blank", state: "unknown", attributes: {} },
};

const hass = {
  states,
  entities: {},
  formatEntityState: (st: { state: string }) => st.state,
} as unknown as FloorplanCard["hass"];

async function mount(item: Partial<FloorItem>) {
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
  const badge = root.querySelector(".badge") as HTMLElement;
  return {
    background: () => getComputedStyle(badge).backgroundColor,
    ink: () => getComputedStyle(badge).color,
    classes: () => (root.querySelector(".fp-item") as HTMLElement).className,
  };
}

describe("a device can say what colour it is when off", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("paints the badge while the device is off", async () => {
    const t = await mount({ entity: "switch.a", inactiveColor: "#c62828" });
    expect(t.background()).toBe(OFF_RED);
  });

  it("does not paint it while the device is on", async () => {
    const t = await mount({
      entity: "switch.on",
      inactiveColor: "#c62828",
      activeColor: "#2e7d32",
    });
    expect(t.background()).toBe(ON_GREEN);
  });

  it("means off for every domain, not just the ones that say 'off'", async () => {
    // The reason this is not a `stateColor` rule. Each of these is inactive in
    // its own vocabulary, and a rule written as `state: "off"` matches none of
    // them.
    for (const entity of ["lock.a", "cover.a", "vacuum.a"]) {
      const t = await mount({ entity, inactiveColor: "#c62828" });
      expect(t.background(), `${entity} should read as inactive`).toBe(OFF_RED);
      document.body.innerHTML = "";
    }
  });

  it("yields to a state rule, which is the more specific statement", async () => {
    const t = await mount({
      entity: "switch.a",
      inactiveColor: "#c62828",
      stateColor: [{ state: "off", color: "#2e7d32" }],
    });
    expect(t.background()).toBe(ON_GREEN);
  });

  it("picks ink that can be read on it", async () => {
    // #c62828 is dark, so the icon must go light — the same contrast pass the
    // active colour gets. Before this, an off badge was always the theme's
    // pale card background and never needed one.
    const t = await mount({ entity: "switch.a", inactiveColor: "#c62828" });
    expect(t.ink()).toBe("rgb(255, 255, 255)");

    document.body.innerHTML = "";
    const pale = await mount({ entity: "switch.a", inactiveColor: "#ffffff" });
    expect(pale.ink()).toBe("rgb(33, 33, 33)");
  });

  it("leaves a device that sets no off colour exactly as it was", async () => {
    // Every existing plan is on this path, so it has to be untouched: no
    // class, no custom property, and the neutral badge it always had.
    const t = await mount({ entity: "switch.a" });
    expect(t.classes()).not.toContain("inactive-colored");
    expect(t.background()).not.toBe(OFF_RED);
  });

  it("stands down for an entity that has dropped out", async () => {
    // The one case where "not active" must not be read as "off" (issue #162):
    // unavailable, unknown, and an entity id nothing answers to. Painting them
    // would tell "we have no reading" as "the reading is closed" — and under
    // `offlineStyle: none`, in a colour indistinguishable from the real thing.
    for (const entity of ["cover.dead", "cover.blank", "cover.gone"]) {
      const t = await mount({ entity, inactiveColor: "#c62828" });
      expect(t.background(), `${entity} should keep the resting badge`).not.toBe(OFF_RED);
      expect(t.classes(), entity).not.toContain("inactive-colored");
      document.body.innerHTML = "";
    }
  });

  it("still paints a device with no entity at all", async () => {
    // Not the same thing as offline: issue #39's plain markers have nothing
    // that could be wrong, and a shut window drawn without a sensor is still
    // shut. `itemIsOffline` says so, and this pins that it keeps saying so.
    const t = await mount({ inactiveColor: "#c62828" });
    expect(t.background()).toBe(OFF_RED);
  });

  it("paints a sensor too, which is the case most likely to surprise", async () => {
    // entityIsActive is what decides, and a numeric sensor reads inactive, so
    // a reading of 21.5 wears the off colour. Pinned rather than argued with:
    // thresholds are the right tool for a sensor, and `stateColor` rules win
    // over this anyway.
    const t = await mount({ entity: "sensor.a", inactiveColor: "#c62828" });
    expect(t.background()).toBe(OFF_RED);
  });
});

/**
 * The same rule on an opening. Node tests cover what `renderOpening` draws for
 * a given `inactive` tone; what they cannot see is the card deciding whether to
 * hand it one at all, which is where the offline case lives.
 */
describe("an opening can say what colour it is when shut", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function mountOpening(entity: string | undefined, type = "door") {
    const host = document.createElement("div");
    host.style.width = "900px";
    host.style.height = "540px";
    document.body.appendChild(host);
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    card.setConfig({
      type: "custom:easy-floorplan-card",
      width: 1000,
      height: 600,
      floors: [
        {
          id: "f1",
          name: "Floor 1",
          walls: [{ id: "w1", x1: 100, y1: 300, x2: 900, y2: 300 }],
          openings: [
            { id: "o1", type, x: 500, y: 300, length: 120, angle: 0, entity,
              inactiveColor: "#c62828" },
          ],
          items: [],
          texts: [],
          furniture: [],
          trackers: [],
          areas: [],
        },
      ],
    } as unknown as FloorplanCardConfig);
    card.hass = hass;
    host.appendChild(card);
    await card.updateComplete;
    return { paintsShut: () => card.shadowRoot!.querySelector("svg")!.outerHTML.includes("#c62828") };
  }

  it("paints the leaf while the opening is shut", async () => {
    expect((await mountOpening("cover.a")).paintsShut()).toBe(true);
  });

  it("stands down for a contact that has dropped out", async () => {
    // A dead sensor drew the same emphatic red as a door that really is shut,
    // and under `offlineStyle: none` the two were the same picture (#162).
    expect((await mountOpening("cover.dead")).paintsShut()).toBe(false);
    document.body.innerHTML = "";
    expect((await mountOpening("cover.gone")).paintsShut()).toBe(false);
  });

  it("still paints a window drawn without a sensor, which renders shut", async () => {
    // A hand-drawn shut window has nothing about it that could be wrong: it is
    // a statement about the plan rather than a missing reading.
    expect((await mountOpening(undefined, "window")).paintsShut()).toBe(true);
  });

  it("does not paint an unbound door, which the plan convention draws open", async () => {
    // The case that showed "not active" and "shut" are not the same question.
    // A swing door with no sensor is drawn *open* (openingDefaultOpen) and is
    // never active, so reading one as the other painted a wide-open door in
    // the colour documented to mean closed.
    expect((await mountOpening(undefined, "door")).paintsShut()).toBe(false);
  });

});
