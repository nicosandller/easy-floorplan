/**
 * What a gesture on a piece of furniture actually reaches (issue #284).
 *
 * `furnitureActionForGesture` is covered in the node suite; none of that can
 * see the part that broke people's plans if it were wrong — whether the piece
 * becomes a button at all, and which of the two behaviours a tap ends up in
 * when both a floor change and an action are configured.
 *
 * The gestures are dispatched as `action` events directly, which is what the
 * card's own handler listens for. That deliberately does not exercise
 * `actionHandler`'s press/hold recognition — a separate thing with its own
 * tests — only the routing underneath it.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { Furniture, FloorplanCardConfig } from "./types";

/**
 * A fresh pair of floor ids per mount.
 *
 * The card remembers the last floor you were on, keyed by the plan's floor ids
 * and held in a module-level map that outlives any one card. Reusing "ground"
 * and "upstairs" across tests meant a test that navigated up left the next one
 * mounting on a floor with no furniture on it at all — which looked like the
 * feature not working rather than like the fixture leaking.
 */
let planSeq = 0;

function config(piece: Partial<Furniture>): FloorplanCardConfig {
  const seq = planSeq++;
  const floor = (id: string, name: string, extra: Partial<Furniture>[]) => ({
    id,
    name,
    walls: [],
    openings: [],
    items: [],
    // A per-floor label, so which floor is showing is readable from the DOM.
    texts: [{ id: `t-${id}`, x: 50, y: 50, text: name }],
    furniture: extra.map((f, i) => ({
      id: `${id}-f${i}`,
      type: "stairs",
      x: 200,
      y: 100,
      w: 60,
      h: 40,
      ...f,
    })),
    trackers: [],
    areas: [],
  });
  return {
    type: "custom:easy-floorplan-card",
    width: 400,
    height: 200,
    floors: [floor(`ground-${seq}`, "Ground", [piece]), floor(`upstairs-${seq}`, "Upstairs", [])],
  } as unknown as FloorplanCardConfig;
}

const hass = {
  states: { "light.shelf": { entity_id: "light.shelf", state: "off", attributes: {} } },
  entities: {},
  formatEntityState: (st: { state: string }) => st.state,
} as unknown as FloorplanCard["hass"];

async function mount(piece: Partial<Furniture>) {
  const host = document.createElement("div");
  host.style.width = "800px";
  host.style.height = "400px";
  document.body.appendChild(host);

  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config(piece));
  card.hass = hass;
  host.appendChild(card);
  await card.updateComplete;

  const root = () => card.shadowRoot!;
  const link = () => root().querySelector(".fp-furniture-link");
  return {
    link,
    role: () => link()?.getAttribute("role") ?? undefined,
    title: () => link()?.querySelector("title")?.textContent?.trim(),
    /** Which floor is on screen, read off its label. */
    floor: () =>
      [...root().querySelectorAll(".fp-text")].map((e) => e.textContent?.trim()).join(""),
    async gesture(action: "tap" | "hold" | "double_tap") {
      link()?.dispatchEvent(new CustomEvent("action", { detail: { action } }));
      await card.updateComplete;
    },
  };
}

describe("a piece of furniture answers the gestures it was given", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("leaves an ordinary piece inert", async () => {
    // No role, no tab stop, no listeners. A gray diagram that announces itself
    // as a button and then does nothing is worse than one that says nothing.
    const t = await mount({ type: "table" });
    expect(t.link()).toBeNull();
  });

  it("still changes floor on tap when that is all it was told to do", async () => {
    // Issue #121's staircase, unchanged.
    const t = await mount({ goToFloor: "up" });
    expect(t.role()).toBe("button");
    expect(t.title()).toBe("Go to Upstairs");
    expect(t.floor()).toBe("Ground");
    await t.gesture("tap");
    expect(t.floor()).toBe("Upstairs");
  });

  it("becomes a button for an action alone, with no floor to go to", async () => {
    const t = await mount({ tap_action: { action: "more-info", entity: "light.shelf" } as never });
    expect(t.role()).toBe("button");
  });

  it("lets a configured tap replace the floor change", async () => {
    // The case the issue asks for: "either a floor or the tap actions".
    const t = await mount({
      goToFloor: "up",
      tap_action: { action: "more-info", entity: "light.shelf" } as never,
    });
    expect(t.floor()).toBe("Ground");
    await t.gesture("tap");
    expect(t.floor()).toBe("Ground");
  });

  it("stops promising a floor it will no longer go to", async () => {
    // The tooltip is the only thing on screen that says what a tap does, so it
    // must not still read "Go to Upstairs" once a tap opens more-info instead.
    const t = await mount({
      goToFloor: "up",
      tap_action: { action: "more-info", entity: "light.shelf" } as never,
    });
    expect(t.title()).toBeUndefined();
  });

  it("keeps both when the action is on hold instead", async () => {
    // A staircase can change floor on tap and still open more-info on hold.
    const t = await mount({
      goToFloor: "up",
      hold_action: { action: "more-info", entity: "light.shelf" } as never,
    });
    expect(t.title()).toBe("Go to Upstairs");
    await t.gesture("tap");
    expect(t.floor()).toBe("Upstairs");
  });

  it("reads `none` on the tap as 'stop changing floor'", async () => {
    // `none` is a configured action, not an absent one — the difference is the
    // only way to say "this staircase should not move me".
    const t = await mount({ goToFloor: "up", tap_action: { action: "none" } });
    await t.gesture("tap");
    expect(t.floor()).toBe("Ground");
  });

  it("does nothing on a gesture it was never given", async () => {
    const t = await mount({ goToFloor: "up" });
    await t.gesture("hold");
    expect(t.floor()).toBe("Ground");
    await t.gesture("double_tap");
    expect(t.floor()).toBe("Ground");
  });
});
