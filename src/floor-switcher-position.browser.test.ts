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
        bubbles: true,
        cancelable: true,
      });
    h.dispatchEvent(ev("pointerdown", from));
    h.dispatchEvent(ev("pointermove", to));
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
        bubbles: true,
        cancelable: true,
      });
    h.dispatchEvent(ev("pointerdown"));
    h.dispatchEvent(ev("pointerup"));
    await ed.updateComplete;
  }
  return { ed, handle, dragTo, clickWithoutMoving, emitted };
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
