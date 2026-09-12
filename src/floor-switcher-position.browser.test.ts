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

/** The room the zoom test zooms into. */
const ZOOM_AREA = "living";

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
        // A real room, so the zoom test has something the card will actually
        // zoom into. A polygon in one corner, small enough that fitting it
        // scales the plan up noticeably rather than by a rounding error.
        areas: [
          { id: ZOOM_AREA, name: "Living", points: [
            { x: 20, y: 20 }, { x: 140, y: 20 }, { x: 140, y: 90 }, { x: 20, y: 90 },
          ] },
        ],
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
  const planZoom = () => root.querySelector(".plan-zoom") as HTMLElement;
  /** The switcher's centre as a percentage of the plan box. */
  const centre = () => {
    const s = sw().getBoundingClientRect();
    const p = plan().getBoundingClientRect();
    return {
      x: Math.round(((s.x + s.width / 2 - p.x) / p.width) * 100),
      y: Math.round(((s.y + s.height / 2 - p.y) / p.height) * 100),
    };
  };
  return {
    card,
    sw,
    centre,
    planZoom,
    /** Wait out the `.plan-zoom` transition, so a measurement is of the end state. */
    zoomSettled: () =>
      new Promise<void>((resolve) => {
        const el = planZoom();
        const done = () => resolve();
        el.addEventListener("transitionend", done, { once: true });
        // A browser that coalesces the transition away fires nothing at all.
        setTimeout(done, 800);
      }),
    /** Where the drawing itself sits, to tell a real zoom from no zoom at all. */
    planBox: () => {
      const b = planZoom().getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width) };
    },
    style: () => sw().getAttribute("style"),
  };
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
    //
    // Genuinely past the edge, not on it: x === width lands at 100%, which is
    // exactly where a clamping implementation would put it too, so it would
    // prove nothing about the promise being made here.
    const t = await mountCard({ floorSwitcher: { x: 440, y: -40 } });
    expect(t.centre()).toEqual({ x: 110, y: -20 });
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

  it("holds its place in the card when a room is zoomed into", async () => {
    // Deliberate: the buttons are how you change floor, and a zoom can scale
    // the plan well past the card — carried along, a switcher placed in the
    // hall would leave the viewport the moment you tapped a room at the far
    // end, with no way to change floor until you zoomed back out.
    const t = await mountCard({ floorSwitcher: { x: 60, y: 100 } });
    const before = t.centre();
    const planBefore = t.planBox();
    // Zoom the card into a room the way a tap does. It has to be a room the
    // plan actually has: an id nothing matches leaves the identity transform
    // in place, and the test would pass without ever entering the state it
    // claims to be about.
    (t.card as unknown as { _zoomedAreaId?: string })._zoomedAreaId = ZOOM_AREA;
    await t.card.updateComplete;
    // `.plan-zoom` eases its transform over 0.4s, so measuring on the next
    // frame catches the drawing before it has gone anywhere — which looks
    // exactly like a zoom that never happened.
    await t.zoomSettled();

    // The drawing really did move and scale…
    const planAfter = t.planBox();
    expect(planAfter.w).toBeGreaterThan(planBefore.w);
    expect(planAfter).not.toEqual(planBefore);
    // …and the switcher did not go with it.
    expect(t.centre()).toEqual(before);
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
    /** The canvas itself — where events land when pointer capture never took. */
    svg: () => root().querySelector("svg") as SVGSVGElement,
    /** What the editor is holding locally, which a live drag writes to. */
    anchor: () =>
      (ed as unknown as { _config: FloorplanCardConfig })._config.floorSwitcher,
    frame: () => new Promise<void>((r) => requestAnimationFrame(() => r())),
  };
}

/** The coordinate fields sit behind the Project section and its own group. */
async function openSwitcherPanel(ed: FloorplanCardEditor): Promise<HTMLInputElement[]> {
  const root = ed.shadowRoot!;
  root.querySelector<HTMLButtonElement>("button.section-toggle")?.click();
  await ed.updateComplete;
  [...root.querySelectorAll<HTMLButtonElement>(".cfg-group-title")]
    .find((b) => b.textContent?.includes("Floor switcher"))
    ?.click();
  await ed.updateComplete;
  return [...root.querySelectorAll<HTMLInputElement>("input[type=number]")];
}

/** Type into a field and commit it, the way a keyboard user would. */
async function typeInto(ed: FloorplanCardEditor, field: HTMLInputElement, value: string) {
  field.value = value;
  field.dispatchEvent(new Event("change", { bubbles: true }));
  await ed.updateComplete;
}

describe("the coordinate fields are a real way to place it", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("places an unplaced switcher from one axis, keeping the other where it is drawn", async () => {
    // Typing one number has to invent the other half, and the only honest
    // answer is where the handle is actually shown — which is what the field's
    // placeholder has been saying all along.
    const t = await mountEditor();
    const [x, y] = await openSwitcherPanel(t.ed);
    // Unplaced, so both fields are empty and show the handle's home as their
    // placeholder. That Y is the half typing an X has to invent.
    expect(x.value).toBe("");
    const homeY = Number(y.placeholder);
    expect(Number.isFinite(homeY)).toBe(true);

    await typeInto(t.ed, x, "120");
    expect(t.emitted[t.emitted.length - 1]?.floorSwitcher).toEqual({ x: 120, y: homeY });
  });

  it("moves an already-placed switcher on one axis without disturbing the other", async () => {
    const t = await mountEditor({ floorSwitcher: { x: 60, y: 100 } });
    const [, y] = await openSwitcherPanel(t.ed);
    await typeInto(t.ed, y, "40");
    expect(t.emitted[t.emitted.length - 1]?.floorSwitcher).toEqual({ x: 60, y: 40 });
  });

  it("returns to the corner when a field is emptied", async () => {
    // `floorSwitcher` is a point or it is nothing — storing half of one is the
    // state `floorSwitcherAnchor` refuses at the other end, so clearing a
    // field has to mean "unset", not "x with no y".
    const t = await mountEditor({ floorSwitcher: { x: 60, y: 100 } });
    const [x] = await openSwitcherPanel(t.ed);
    await typeInto(t.ed, x, "");
    expect(t.emitted[t.emitted.length - 1]?.floorSwitcher).toBeUndefined();
  });

  it("treats an unusable entry as clearing it rather than storing NaN", async () => {
    const t = await mountEditor({ floorSwitcher: { x: 60, y: 100 } });
    const [x] = await openSwitcherPanel(t.ed);
    await typeInto(t.ed, x, "nonsense");
    expect(t.emitted[t.emitted.length - 1]?.floorSwitcher).toBeUndefined();
  });

  it("shows a fractional anchor as it really is, not rounded to the nearest unit", async () => {
    // With Snap off, a drag stores whatever point the pointer landed on, and
    // hand-written YAML can say anything. A field that rounded 60.4 to 60
    // would misreport the position — and the next nudge of the spinner would
    // write that rounding back as a real edit.
    const t = await mountEditor({ floorSwitcher: { x: 60.4, y: 100.25 } });
    const [x, y] = await openSwitcherPanel(t.ed);
    expect(x.value).toBe("60.4");
    expect(y.value).toBe("100.25");

    // And editing one axis leaves the other's precision alone.
    await typeInto(t.ed, y, "40");
    expect(t.emitted[t.emitted.length - 1]?.floorSwitcher).toEqual({ x: 60.4, y: 40 });
  });

  it("takes a negative coordinate, which is off-canvas margin", async () => {
    const t = await mountEditor({ floorSwitcher: { x: 60, y: 100 } });
    const [x] = await openSwitcherPanel(t.ed);
    await typeInto(t.ed, x, "-30");
    expect(t.emitted[t.emitted.length - 1]?.floorSwitcher).toEqual({ x: -30, y: 100 });
  });
});

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

  it("costs no undo step when it is canceled on a full history stack", async () => {
    // The push at first movement is `slice(-HISTORY_MAX)`, so once the stack is
    // full it evicts the oldest entry as well as adding a new one. Dropping
    // just the added entry would leave that eviction standing, and a canceled
    // drag would quietly cost the user their oldest undo — which is not the
    // "complete no-op" this gesture promises.
    const t = await mountEditor({ floorSwitcher: { x: 60, y: 100 } });
    const [xField] = await openSwitcherPanel(t.ed);
    const history = () =>
      (t.ed as unknown as { _history: FloorplanCardConfig[] })._history;

    // Fill it by editing, rather than naming HISTORY_MAX here: the stack is
    // full the first time an edit stops making it longer.
    let capped = false;
    let len = history().length;
    for (let i = 1; i <= 500 && !capped; i++) {
      await typeInto(t.ed, xField, String(i));
      capped = history().length === len;
      len = history().length;
    }
    expect(capped).toBe(true);
    const depth = history().length;
    const oldest = history()[0];

    await t.dragThenCancel(200, 150);

    expect(history().length).toBe(depth);
    expect(history()[0]).toBe(oldest);
  });

  it("finishes even when pointer capture never took", async () => {
    // `_capturePointer` is best-effort and swallows failures. Without capture
    // the moment the cursor leaves the handle every event lands on the canvas
    // instead — and the canvas handlers know nothing about this drag, so the
    // handle would follow the pointer with no way to let go and the move would
    // never be emitted.
    const t = await mountEditor();
    const h = t.handle();
    h.dispatchEvent(t.ptr("pointerdown", t.handleCentre()));
    // Everything from here on goes to the canvas, as it would with no capture.
    const to = t.canvasPoint(120, 160);
    t.svg().dispatchEvent(t.ptr("pointermove", to));
    await t.frame();
    t.svg().dispatchEvent(t.ptr("pointerup", to, 0));
    await t.ed.updateComplete;

    expect(t.emitted[t.emitted.length - 1]?.floorSwitcher).toEqual({ x: 120, y: 160 });
    // The gesture really is over: the handle is not still being dragged, and
    // the gate it holds is open for the next one.
    expect(
      (t.ed as unknown as { _switcherDrag?: unknown; _gesturePointer: number | null })
        ._switcherDrag,
    ).toBeUndefined();
    expect(
      (t.ed as unknown as { _gesturePointer: number | null })._gesturePointer,
    ).toBeNull();
  });

  it("applies one move a frame, not one an event", async () => {
    // `_config` is reactive, so writing it per raw pointermove re-renders the
    // whole editor at pointer rate and the handle falls behind the cursor.
    const t = await mountEditor();
    const h = t.handle();
    h.dispatchEvent(t.ptr("pointerdown", t.handleCentre()));
    for (const [x, y] of [
      [80, 40],
      [100, 60],
      [140, 160],
    ]) {
      h.dispatchEvent(t.ptr("pointermove", t.canvasPoint(x, y)));
    }
    // Still nothing written: three events, no frame yet.
    expect(t.anchor()).toBeUndefined();
    await t.frame();
    // …and one write when the frame comes, carrying the newest point rather
    // than replaying the three.
    expect(t.anchor()).toEqual({ x: 140, y: 160 });

    // A release still lands on the last point the pointer reported, even one
    // that arrived after the last frame.
    h.dispatchEvent(t.ptr("pointermove", t.canvasPoint(200, 100)));
    h.dispatchEvent(t.ptr("pointerup", t.canvasPoint(200, 100), 0));
    await t.ed.updateComplete;
    expect(t.emitted[t.emitted.length - 1]?.floorSwitcher).toEqual({ x: 200, y: 100 });
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

  it("ignores a press that is not the primary button", async () => {
    // A right-drag reports `buttons === 2`, which the no-buttons guard does
    // not catch — so without a button check it repositioned the switcher
    // instead of opening the context menu.
    const t = await mountEditor();
    const at = t.handleCentre();
    t.handle().dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        button: 2,
        buttons: 2,
        clientX: at.x,
        clientY: at.y,
        bubbles: true,
        cancelable: true,
      }),
    );
    t.handle().dispatchEvent(t.ptr("pointermove", t.canvasPoint(100, 120), 2));
    t.handle().dispatchEvent(t.ptr("pointerup", t.canvasPoint(100, 120), 0));
    await t.ed.updateComplete;
    expect(t.emitted).toEqual([]);
  });

  it("treats exactly the slop as a click, like every other drag", async () => {
    // `_applyDrag` calls 4 units a click; this used `<` and called it a drag,
    // so one control disagreed with the rest of the editor about where a click
    // stops being a click.
    const t = await mountEditor();
    const at = t.handleCentre();
    const sb = (t.ed.shadowRoot!.querySelector("svg") as SVGElement).getBoundingClientRect();
    // Exactly 4 canvas units along x, in screen pixels.
    const fourUnits = (sb.width / 400) * 4;
    t.handle().dispatchEvent(t.ptr("pointerdown", at));
    t.handle().dispatchEvent(t.ptr("pointermove", { x: at.x + fourUnits, y: at.y }));
    t.handle().dispatchEvent(t.ptr("pointerup", { x: at.x + fourUnits, y: at.y }, 0));
    await t.ed.updateComplete;
    expect(t.emitted).toEqual([]);
  });

  it("takes focus off a text field so Escape can still cancel", async () => {
    // Starting the drag from the X/Y inputs left focus in a text input, where
    // `isTypingPath` rejects Escape — so the drag could not be canceled at all
    // and a partial position was committed on release.
    const t = await mountEditor();
    const root = t.ed.shadowRoot!;
    root.querySelector<HTMLButtonElement>("button.section-toggle")?.click();
    await t.ed.updateComplete;
    [...root.querySelectorAll<HTMLButtonElement>(".cfg-group-title")]
      .find((b) => b.textContent?.includes("Floor switcher"))
      ?.click();
    await t.ed.updateComplete;
    const field = root.querySelector("input[type=number]") as HTMLInputElement | null;
    expect(field, "a coordinate field to focus").toBeTruthy();
    field!.focus();
    const at = t.handleCentre();
    t.handle().dispatchEvent(t.ptr("pointerdown", at));
    t.handle().dispatchEvent(t.ptr("pointermove", t.canvasPoint(100, 120)));
    await t.ed.updateComplete;
    // Dispatched from whatever holds focus, which is where a real key press
    // comes from — and the whole point: `isTypingPath` reads the event's
    // composed path, so an Escape originating in a text field is rejected.
    // Sending it from the handle instead would dodge the very condition this
    // test exists for.
    (root.activeElement ?? field!).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );
    await t.ed.updateComplete;
    // The release has to happen for this to mean anything: without it nothing
    // would have been emitted whether Escape cancelled or not, and the test
    // would pass against the very bug it is for.
    t.handle().dispatchEvent(t.ptr("pointerup", t.canvasPoint(100, 120), 0));
    await t.ed.updateComplete;
    expect(t.emitted).toEqual([]);
  });

  it("names both coordinate fields for a screen reader", async () => {
    // The visible labels are siblings, so they name nothing: unlabelled, these
    // are two spinbuttons with no way to tell which axis each edits.
    const t = await mountEditor({ floorSwitcher: { x: 60, y: 100 } });
    // The fields sit behind two collapses — the Project section, then the
    // "Floor switcher" group inside it — and neither is open on mount.
    const root = t.ed.shadowRoot!;
    root.querySelector<HTMLButtonElement>("button.section-toggle")?.click();
    await t.ed.updateComplete;
    [...root.querySelectorAll<HTMLButtonElement>(".cfg-group-title")]
      .find((b) => b.textContent?.includes("Floor switcher"))
      ?.click();
    await t.ed.updateComplete;

    const names = [...root.querySelectorAll("input[type=number]")]
      .map((i) => i.getAttribute("aria-label"))
      .filter((n): n is string => !!n);
    expect(names.some((n) => /switcher x/i.test(n))).toBe(true);
    expect(names.some((n) => /switcher y/i.test(n))).toBe(true);
  });

  it("ignores an undo that arrives mid-drag", async () => {
    // Every other gesture bails on keyboard mutation while live, because an
    // undo landing between the history snapshot and the emit interleaves with
    // both.
    const t = await mountEditor();
    const at = t.handleCentre();
    t.handle().dispatchEvent(t.ptr("pointerdown", at));
    t.handle().dispatchEvent(t.ptr("pointermove", t.canvasPoint(100, 120)));
    await t.ed.updateComplete;
    const before = t.emitted.length;
    t.handle().dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, composed: true }),
    );
    await t.ed.updateComplete;
    expect(t.emitted).toHaveLength(before);
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
