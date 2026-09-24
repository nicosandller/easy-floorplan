/**
 * Walking the zoom from room to room (issue #261), in the real card.
 *
 * The order and the wrap-around are unit-tested in room-focus.test.ts. What
 * needs the real card is the part that made the feature worth having: the
 * controls, the arrow keys reaching rooms that are not tab stops, and a dwell
 * that gets out of the way as soon as somebody touches the card.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig } from "./types";

// Rooms smaller than the plan in both directions, so framing one is a zoom
// rather than the identity transform a full-height room would fit into.
const room = (id: string, x: number) => ({
  id,
  name: id,
  points: [
    { x: x + 20, y: 20 },
    { x: x + 260, y: 20 },
    { x: x + 260, y: 180 },
    { x: x + 20, y: 180 },
  ],
});

function config(roomFocus: FloorplanCardConfig["roomFocus"]): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card", width: 900, height: 300, roomFocus,
    floors: [{
      id: "gf", name: "Ground", walls: [], openings: [], items: [], texts: [], furniture: [],
      trackers: [], areas: [room("hall", 0), room("living", 300), room("kitchen", 600)],
    }],
  } as unknown as FloorplanCardConfig;
}

async function mount(roomFocus: FloorplanCardConfig["roomFocus"]) {
  const host = document.createElement("div");
  host.style.width = "600px";
  document.body.append(host);
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config(roomFocus));
  card.hass = { states: {}, entities: {} } as FloorplanCard["hass"];
  host.append(card);
  await card.updateComplete;
  const root = card.shadowRoot!;
  return {
    card,
    root,
    focused: () => (card as unknown as { _zoomedAreaId?: string })._zoomedAreaId,
    plan: () => root.querySelector<HTMLElement>(".plan")!,
    steps: () => [...root.querySelectorAll<HTMLButtonElement>(".room-focus button")],
    zoomScale: () =>
      root.querySelector<HTMLElement>(".plan-zoom")!.style.transform.match(/scale\(([\d.]+)\)/)?.[1],
    async press(key: string) {
      root.querySelector(".plan")!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      await card.updateComplete;
    },
  };
}

afterEach(() => { document.body.innerHTML = ""; });

describe("stepping the focus between rooms", () => {
  it("stays out of the way until it is asked for", async () => {
    const t = await mount(undefined);
    expect(t.steps()).toHaveLength(0);
    // And the plan is not a tab stop it has no use for.
    expect(t.plan().getAttribute("tabindex")).toBeNull();
  });

  it("walks the rooms with the controls, wrapping round the end", async () => {
    const t = await mount(true);
    const [prev, next] = t.steps();
    expect(t.focused()).toBeUndefined();

    next.click();
    await t.card.updateComplete;
    expect(t.focused()).toBe("hall");
    // It really is a zoom, not just a bit of state.
    expect(Number(t.zoomScale())).toBeGreaterThan(1);

    next.click();
    await t.card.updateComplete;
    expect(t.focused()).toBe("living");

    prev.click();
    await t.card.updateComplete;
    expect(t.focused()).toBe("hall");

    // Backwards from the first room is the last one, not a dead end.
    prev.click();
    await t.card.updateComplete;
    expect(t.focused()).toBe("kitchen");
  });

  it("reaches rooms from the keyboard, which a pointer-less viewer could not do", async () => {
    const t = await mount(true);
    expect(t.plan().getAttribute("tabindex")).toBe("0");
    await t.press("ArrowRight");
    expect(t.focused()).toBe("hall");
    await t.press("ArrowRight");
    expect(t.focused()).toBe("living");
    await t.press("ArrowLeft");
    expect(t.focused()).toBe("hall");
    await t.press("Escape");
    expect(t.focused()).toBeUndefined();
    expect(Number(t.zoomScale())).toBe(1);
  });

  it("cycles on its own, and defers to anyone using the card", async () => {
    const t = await mount({ controls: false, interval: 2 });
    // No controls asked for, but the dwell still runs.
    expect(t.steps()).toHaveLength(0);
    expect(t.focused()).toBeUndefined();

    await new Promise((r) => setTimeout(r, 2300));
    await t.card.updateComplete;
    const first = t.focused();
    expect(first).toBe("hall");

    // Touching the card restarts the dwell, so the view does not move out
    // from under the tap that is still in progress.
    await new Promise((r) => setTimeout(r, 1500));
    t.root.querySelector(".plan")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1000));
    expect(t.focused()).toBe(first);

    await new Promise((r) => setTimeout(r, 1500));
    await t.card.updateComplete;
    expect(t.focused()).toBe("living");
  });

  it("takes up a new interval straight away rather than after the old dwell", async () => {
    const t = await mount({ controls: false, interval: 60 });
    t.card.setConfig(config({ controls: false, interval: 2 }));
    await t.card.updateComplete;
    await new Promise((r) => setTimeout(r, 2300));
    await t.card.updateComplete;
    expect(t.focused()).toBe("hall");
  });
});
