/**
 * Putting the floor switcher where the plan has room for it (issue #281).
 *
 * "Currently, they are located at the top right, which unfortunately means they
 * often end up right in the middle of the floor plan on smaller screens."
 *
 * Both halves need a browser. On the card the position is a percentage of the
 * plan box resolved by the layout, so only a real one can say where the block
 * actually landed. In the editor the whole feature *is* a pointer drag.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import "./editor";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardEditor } from "./editor";
import type { FloorplanCardConfig } from "./types";
import type { PlanRotation } from "./render";

/**
 * Fresh floor ids per mount: the card remembers the last floor you were on in
 * a module-level map that outlives any one card, so reused ids let one test
 * start on the floor another had switched to.
 */
let seq = 0;

function config(extra: Partial<FloorplanCardConfig> = {}): FloorplanCardConfig {
  const s = seq++;
  return {
    type: "custom:easy-floorplan-card",
    width: 400,
    height: 200,
    ...extra,
    floors: [
      {
        id: `g${s}`,
        name: "Ground",
        short: "G",
        walls: [{ id: "w1", x1: 20, y1: 20, x2: 380, y2: 20 }],
        openings: [],
        items: [],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      },
      {
        id: `u${s}`,
        name: "Upstairs",
        short: "U",
        walls: [],
        openings: [],
        items: [],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      },
    ],
  } as unknown as FloorplanCardConfig;
}

const hass = {
  states: {},
  entities: {},
  formatEntityState: (st: { state: string }) => st.state,
} as unknown as FloorplanCard["hass"];

async function mountCard(extra: Partial<FloorplanCardConfig> = {}) {
  const host = document.createElement("div");
  host.style.width = "600px";
  host.style.height = "380px";
  document.body.appendChild(host);

  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config(extra));
  card.hass = hass;
  host.appendChild(card);
  await card.updateComplete;

  const root = card.shadowRoot!;
  const sw = () => root.querySelector(".floor-switcher") as HTMLElement;
  const plan = () => root.querySelector(".plan") as HTMLElement;
  /** The switcher's centre as a percentage of the plan box. */
  const centre = () => {
    const s = sw().getBoundingClientRect();
    const p = plan().getBoundingClientRect();
    return {
      x: Math.round(((s.x + s.width / 2 - p.x) / p.width) * 100),
      y: Math.round(((s.y + s.height / 2 - p.y) / p.height) * 100),
    };
  };
  return { sw, centre, style: () => sw().getAttribute("style") };
}

describe("the card draws the switcher where the plan says", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("leaves an unplaced plan exactly as it was", async () => {
    // Every existing plan is on this path. No inline style at all, so the CSS
    // corner is untouched rather than re-stated.
    const t = await mountCard();
    expect(t.style()).toBeNull();
    expect(t.sw().className).not.toContain("placed");
  });

  it("centres the block on the point it was given", async () => {
    // (60, 100) on a 400×200 canvas is 15% across and halfway down.
    const t = await mountCard({ floorSwitcher: { x: 60, y: 100 } });
    expect(t.centre()).toEqual({ x: 15, y: 50 });
  });

  it("keeps it on the same part of the house when the card is rotated", async () => {
    // The anchor goes through the same mapping every other overlay anchor
    // does, so a plan turned for a wall tablet does not leave the switcher
    // behind on a different wall.
    const t = await mountCard({ floorSwitcher: { x: 60, y: 100 }, rotation: 90 as PlanRotation });
    expect(t.centre()).toEqual({ x: 50, y: 15 });
  });

  it("honours a point outside the canvas", async () => {
    // Deliberately not clamped: a plan with margin around its walls has real
    // empty space to park it in.
    const t = await mountCard({ floorSwitcher: { x: 400, y: 0 } });
    expect(t.centre()).toEqual({ x: 100, y: 0 });
  });

  it("measures against the plan, not the stage it is centred in", async () => {
    // A card whose box is not the canvas's ratio letterboxes .plan inside
    // .stage — here 600 wide inside a 900 stage, so the two disagree by 150px
    // a side. The anchor has to resolve against the drawing: (0,0) is the
    // plan's top-left corner, not the card's.
    const host = document.createElement("div");
    host.style.width = "900px";
    host.style.height = "300px";
    document.body.appendChild(host);
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    card.setConfig(config({ floorSwitcher: { x: 0, y: 0 } }));
    card.hass = hass;
    host.appendChild(card);
    await card.updateComplete;

    const root = card.shadowRoot!;
    const sw = root.querySelector(".floor-switcher")!.getBoundingClientRect();
    const plan = root.querySelector(".plan")!.getBoundingClientRect();
    const stage = root.querySelector(".stage")!.getBoundingClientRect();
    // The fixture is only meaningful if the two really are different boxes.
    expect(Math.round(plan.width)).toBeLessThan(Math.round(stage.width));
    expect(Math.round(sw.x + sw.width / 2)).toBe(Math.round(plan.x));
    expect(Math.round(sw.y + sw.height / 2)).toBe(Math.round(plan.y));
  });

  it("ignores half a position rather than jumping to a corner", async () => {
    const t = await mountCard({ floorSwitcher: { x: 100 } as never });
    expect(t.style()).toBeNull();
  });
});

async function mountEditor(extra: Partial<FloorplanCardConfig> = {}) {
  const host = document.createElement("div");
  host.style.width = "700px";
  document.body.appendChild(host);
  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
  ed.setConfig(config(extra));
  host.appendChild(ed);
  await ed.updateComplete;

  const emitted: FloorplanCardConfig[] = [];
  ed.addEventListener("config-changed", (ev) => {
    const next = (ev as CustomEvent<{ config: FloorplanCardConfig }>).detail.config;
    emitted.push(next);
    ed.setConfig(next);
  });

  const root = () => ed.shadowRoot!;
  const handle = () => root().querySelector(".switcher-handle") as HTMLElement;
  /** Drag the handle to a canvas point, through real pointer events. */
  async function dragTo(x: number, y: number) {
    const h = handle();
    const hb = h.getBoundingClientRect();
    const sb = root().querySelector("svg")!.getBoundingClientRect();
    const from = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    const to = { x: sb.x + sb.width * (x / 400), y: sb.y + sb.height * (y / 200) };
    const ev = (type: string, at: { x: number; y: number }) =>
      new PointerEvent(type, {
        pointerId: 1,
        clientX: at.x,
        clientY: at.y,
        // A real drag holds a button down. Left unset this is 0, which the
        // editor reads as "the release never reached us" and cancels.
        buttons: type === "pointerup" ? 0 : 1,
        bubbles: true,
        cancelable: true,
      });
    h.dispatchEvent(ev("pointerdown", from));
    // Several frames, not one: a drag that moved once cannot tell "emits per
    // frame" apart from "emits on release", and that difference is the point
    // of the batching.
    for (let i = 1; i <= 4; i++) {
      h.dispatchEvent(
        ev("pointermove", {
          x: from.x + ((to.x - from.x) * i) / 4,
          y: from.y + ((to.y - from.y) * i) / 4,
        }),
      );
    }
    h.dispatchEvent(ev("pointerup", to));
    await ed.updateComplete;
  }
  async function clickWithoutMoving() {
    const h = handle();
    const hb = h.getBoundingClientRect();
    const at = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    const ev = (type: string) =>
      new PointerEvent(type, {
        pointerId: 1,
        clientX: at.x,
        clientY: at.y,
        buttons: type === "pointerup" ? 0 : 1,
        bubbles: true,
        cancelable: true,
      });
    h.dispatchEvent(ev("pointerdown"));
    h.dispatchEvent(ev("pointerup"));
    await ed.updateComplete;
  }
  /** Start a drag, move, then have the pointer taken away instead of released. */
  async function dragThenCancel(x: number, y: number) {
    const h = handle();
    const hb = h.getBoundingClientRect();
    const sb = root().querySelector("svg")!.getBoundingClientRect();
    const from = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    const to = { x: sb.x + sb.width * (x / 400), y: sb.y + sb.height * (y / 200) };
    const ev = (type: string, at: { x: number; y: number }) =>
      new PointerEvent(type, {
        pointerId: 1,
        clientX: at.x,
        clientY: at.y,
        // A real drag holds a button down. Left unset this is 0, which the
        // editor reads as "the release never reached us" and cancels.
        buttons: type === "pointerup" ? 0 : 1,
        bubbles: true,
        cancelable: true,
      });
    h.dispatchEvent(ev("pointerdown", from));
    h.dispatchEvent(ev("pointermove", to));
    h.dispatchEvent(ev("pointercancel", to));
    await ed.updateComplete;
  }
  const ptr = (type: string, at: { x: number; y: number }, buttons = 1) =>
    new PointerEvent(type, {
      pointerId: 1,
      clientX: at.x,
      clientY: at.y,
      buttons,
      bubbles: true,
      cancelable: true,
    });
  const handleCentre = () => {
    const hb = handle().getBoundingClientRect();
    return { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  };
  const canvasPoint = (x: number, y: number) => {
    const sb = root().querySelector("svg")!.getBoundingClientRect();
    return { x: sb.x + sb.width * (x / 400), y: sb.y + sb.height * (y / 200) };
  };
  return {
    ed,
    handle,
    dragTo,
    dragThenCancel,
    clickWithoutMoving,
    emitted,
    ptr,
    handleCentre,
    canvasPoint,
  };
}

describe("the editor lets you drag the switcher anywhere on the canvas", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("offers a handle, dimmed until it has been placed", async () => {
    const t = await mountEditor();
    expect(t.handle()).toBeTruthy();
    // The dim says "no position is stored"; claiming otherwise would make the
    // canvas disagree with the config.
    expect(t.handle().className).toContain("default");
  });

  it("writes the point it was dropped on", async () => {
    const t = await mountEditor();
    await t.dragTo(100, 120);
    expect(t.emitted[t.emitted.length - 1]?.floorSwitcher).toEqual({ x: 100, y: 120 });
    expect(t.handle().className).not.toContain("default");
  });

  it("does not place it on a click that never moved", async () => {
    // Otherwise a stray tap pins the switcher to wherever the corner happened
    // to be, turning a misclick into an edit.
    const t = await mountEditor();
    await t.clickWithoutMoving();
    expect(t.emitted).toEqual([]);
  });

  it("moves an already-placed switcher too", async () => {
    const t = await mountEditor({ floorSwitcher: { x: 20, y: 20 } });
    await t.dragTo(300, 160);
    expect(t.emitted[t.emitted.length - 1]?.floorSwitcher).toEqual({ x: 300, y: 160 });
  });

  it("emits once, on release, not on every frame", async () => {
    // Every other drag in this editor writes locally while it is live and
    // emits when it ends. Emitting per pointermove would hand Home Assistant a
    // config-changed — and a card-stack re-render — for each frame of a drag.
    const t = await mountEditor();
    await t.dragTo(100, 120);
    expect(t.emitted).toHaveLength(1);
  });

  it("rolls back when the pointer is taken away mid-drag", async () => {
    // A touch interrupted, a dialog stealing the pointer, capture lost. The
    // other canvas gestures cancel rather than saving wherever the pointer
    // happened to be, and this one has to agree.
    const t = await mountEditor();
    await t.dragThenCancel(100, 120);
    expect(t.emitted).toEqual([]);
    // …and the handle is back in its unplaced corner, not stranded mid-plan.
    expect(t.handle().className).toContain("default");
  });

  it("leaves exactly one history entry, so one undo puts it back", async () => {
    // Pushing at first movement *and* committing at the end would leave two:
    // the first undo would restore the config already on screen, and only the
    // second would move the switcher.
    const t = await mountEditor();
    await t.dragTo(100, 120);
    expect(t.emitted[t.emitted.length - 1]?.floorSwitcher).toEqual({ x: 100, y: 120 });

    (t.ed as unknown as { _undo(): void })._undo();
    await t.ed.updateComplete;
    expect(t.emitted[t.emitted.length - 1]?.floorSwitcher).toBeUndefined();
  });

  it("refuses to start while another gesture owns the pointer", async () => {
    // The gate every other pointer path honours. Without it a second touch
    // could start this on top of a live element drag or marquee.
    const t = await mountEditor();
    (t.ed as unknown as { _gesturePointer: number | null })._gesturePointer = 7;
    const at = t.handleCentre();
    t.handle().dispatchEvent(t.ptr("pointerdown", at));
    t.handle().dispatchEvent(t.ptr("pointermove", t.canvasPoint(100, 120)));
    t.handle().dispatchEvent(t.ptr("pointerup", t.canvasPoint(100, 120)));
    await t.ed.updateComplete;
    expect(t.emitted).toEqual([]);
  });

  it("ignores a jitter too small to be a drag", async () => {
    // A browser delivering a one-pixel move on an ordinary click must not
    // push history and store a position — that is the whole "a click does not
    // place it" promise, and a zero-move test does not cover it.
    const t = await mountEditor();
    const at = t.handleCentre();
    t.handle().dispatchEvent(t.ptr("pointerdown", at));
    t.handle().dispatchEvent(t.ptr("pointermove", { x: at.x + 1, y: at.y + 1 }));
    t.handle().dispatchEvent(t.ptr("pointerup", { x: at.x + 1, y: at.y + 1 }));
    await t.ed.updateComplete;
    expect(t.emitted).toEqual([]);
  });

  it("cancels when a move arrives with nothing held down", async () => {
    // The release never reached us — alt-tab, a dialog taking the pointer.
    // The other drags treat that as a cancel rather than letting the thing
    // chase the hovering cursor.
    const t = await mountEditor();
    const at = t.handleCentre();
    t.handle().dispatchEvent(t.ptr("pointerdown", at));
    t.handle().dispatchEvent(t.ptr("pointermove", t.canvasPoint(100, 120)));
    t.handle().dispatchEvent(t.ptr("pointermove", t.canvasPoint(140, 140), 0));
    await t.ed.updateComplete;
    expect(t.emitted).toEqual([]);
    expect(t.handle().className).toContain("default");
  });

  it("rolls back on Escape, like every other canvas gesture", async () => {
    // Free, because the rollback runs through `_cancelGesture` — the Escape
    // cascade never has to name this drag.
    const t = await mountEditor();
    const at = t.handleCentre();
    t.handle().dispatchEvent(t.ptr("pointerdown", at));
    t.handle().dispatchEvent(t.ptr("pointermove", t.canvasPoint(100, 120)));
    await t.ed.updateComplete;
    // Dispatched from inside the editor, not on `window`: the keydown listener
    // is window-level but ignores anything whose composed path does not run
    // through the editor, so a stray key in HA's UI above cannot reach it.
    t.handle().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );
    await t.ed.updateComplete;
    expect(t.emitted).toEqual([]);
    expect(t.handle().className).toContain("default");
  });

  it("hands the position over if the editor is torn down mid-drag", async () => {
    // HA's dialog reparents the editor, and `_config` is the host's only copy
    // of the edit — so a teardown emits rather than silently undoing it.
    const t = await mountEditor();
    const at = t.handleCentre();
    t.handle().dispatchEvent(t.ptr("pointerdown", at));
    t.handle().dispatchEvent(t.ptr("pointermove", t.canvasPoint(100, 120)));
    await t.ed.updateComplete;
    t.ed.remove();
    expect(t.emitted[t.emitted.length - 1]?.floorSwitcher).toEqual({ x: 100, y: 120 });
  });

  it("draws no handle on a plan with one floor, which has no switcher", async () => {
    const one = config();
    one.floors = [one.floors![0]];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig(one);
    host.appendChild(ed);
    await ed.updateComplete;
    expect(ed.shadowRoot!.querySelector(".switcher-handle")).toBeNull();
  });
});
