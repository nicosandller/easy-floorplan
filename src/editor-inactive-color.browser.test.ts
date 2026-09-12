/**
 * The editor's badge preview agrees with the card about the off colour
 * (issue #228).
 *
 * The preview exists so that setting a colour changes something you can see
 * without leaving the editor. That only helps if it shows what the card will
 * actually draw — a preview that disagrees is worse than no preview, because
 * you tune the plan against it and the dashboard comes out different.
 *
 * The case this was written for is the offline one. `inactiveColor` stands down
 * for an entity that has dropped out, so "we have no reading" is never told as
 * "the reading is closed" (issue #162) — and the editor has to stand down with
 * it, or a dead sensor previews in the loudest colour on the plan.
 *
 * In a browser because it is a painted colour: the class, the custom property
 * and the CSS rule all have to line up, and a node test of the helper would
 * pass with any of the three missing.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import type { FloorItem, FloorplanCardConfig } from "./types";

const OFF_RED = "rgb(198, 40, 40)";

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
        items: [{ id: "i1", x: 500, y: 300, ...item } as FloorItem],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      },
    ],
  } as unknown as FloorplanCardConfig;
}

/** One entity per reading we care about, including the two outage states. */
const states = {
  "switch.off": { entity_id: "switch.off", state: "off", attributes: {} },
  "switch.on": { entity_id: "switch.on", state: "on", attributes: {} },
  "switch.dead": { entity_id: "switch.dead", state: "unavailable", attributes: {} },
  "switch.unknown": { entity_id: "switch.unknown", state: "unknown", attributes: {} },
};

async function mount(item: Partial<FloorItem>) {
  const host = document.createElement("div");
  host.style.width = "900px";
  document.body.appendChild(host);
  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  ed.hass = { states, entities: {} } as unknown as FloorplanCardEditor["hass"];
  ed.setConfig(config(item));
  host.appendChild(ed);
  await ed.updateComplete;

  const badge = ed.shadowRoot!.querySelector(".edit-item .badge") as HTMLElement;
  return {
    exists: () => !!badge,
    background: () => getComputedStyle(badge).backgroundColor,
    classes: () => badge.className,
  };
}

describe("the editor previews the off colour the way the card paints it", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("finds a badge to look at", async () => {
    // Guards every assertion below: if the selector stopped matching, they
    // would all throw rather than quietly pass, but this says so plainly.
    const t = await mount({ entity: "switch.off", inactiveColor: "#c62828" });
    expect(t.exists()).toBe(true);
  });

  it("paints a device that is genuinely off", async () => {
    const t = await mount({ entity: "switch.off", inactiveColor: "#c62828" });
    expect(t.background()).toBe(OFF_RED);
  });

  it("does not paint one that is on", async () => {
    const t = await mount({ entity: "switch.on", inactiveColor: "#c62828" });
    expect(t.background()).not.toBe(OFF_RED);
  });

  it("stands down for an entity that has dropped out, as the card does", async () => {
    // The card excludes offline explicitly. Without the same test here the
    // editor drew a dead sensor in the same confident red as one that is
    // genuinely shut — and under `offlineStyle: none` the two were identical.
    for (const entity of ["switch.dead", "switch.unknown"]) {
      const t = await mount({ entity, inactiveColor: "#c62828" });
      expect(t.background(), `${entity} should not wear the off colour`).not.toBe(OFF_RED);
      expect(t.classes()).not.toContain("inactive-colored");
      document.body.innerHTML = "";
    }
  });

  it("stands down for an entity that is not in hass at all", async () => {
    // A renamed entity, or an integration that is down: no state object, which
    // `itemIsOffline` reads as offline exactly as it reads `unavailable`.
    const t = await mount({ entity: "switch.renamed_away", inactiveColor: "#c62828" });
    expect(t.background()).not.toBe(OFF_RED);
  });

  it("still paints a device with no entity bound, which is not offline", async () => {
    // Issue #39's plain markers. A shut window drawn with no sensor is a
    // statement about the plan, not a missing reading.
    const t = await mount({ inactiveColor: "#c62828" });
    expect(t.background()).toBe(OFF_RED);
  });
});
