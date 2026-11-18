/**
 * Free zoom and pan (issue #446), in the real card.
 *
 * The maths (steps, clamps, pan bounds) is unit-tested in plan-zoom.test.ts.
 * What needs a browser is the gesture path: a drag that starts on a device
 * must move the plan and must not reach the device, while a press that does
 * not move must still be the tap it always was. The mouse cases use real
 * input (Playwright through `userEvent`), so pointer capture and the click
 * Chromium sends after a drag are the browser's own. Touch is dispatched from
 * the page — the events the action handler and the pan both listen to — since
 * headless Chromium has no touchscreen to drive.
 */
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "@vitest/browser/context";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig } from "./types";

let seq = 0;
const calls: string[] = [];

function config(extra: Partial<FloorplanCardConfig> = {}): FloorplanCardConfig {
  const n = seq++;
  const floor = (id: string, name: string) => ({
    id: `${id}-${n}`, name, walls: [], openings: [], texts: [], furniture: [], trackers: [],
    // A device at the centre of the plan, so a zoom about the centre leaves it
    // under the same point on screen.
    items: [{ id: `${id}-lamp`, entity: "light.lamp", x: 200, y: 100, tap_action: { action: "toggle" } }],
    areas: [
      { id: `${id}-room`, name: "Room",
        points: [{ x: 20, y: 20 }, { x: 120, y: 20 }, { x: 120, y: 80 }, { x: 20, y: 80 }] },
      { id: `${id}-den`, name: "Den",
        points: [{ x: 280, y: 120 }, { x: 380, y: 120 }, { x: 380, y: 180 }, { x: 280, y: 180 }] },
    ],
  });
  return {
    type: "custom:easy-floorplan-card", width: 400, height: 200, zoomControls: true,
    ...extra,
    floors: [floor("ground", "Ground"), floor("upper", "Upper")],
  } as unknown as FloorplanCardConfig;
}

const hass = {
  states: { "light.lamp": { entity_id: "light.lamp", state: "off", attributes: { friendly_name: "Lamp" } } },
  entities: {},
  callService: (domain: string, service: string) => { calls.push(`${domain}.${service}`); },
  formatEntityState: (st: { state: string }) => st.state,
} as unknown as FloorplanCard["hass"];

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mount(extra: Partial<FloorplanCardConfig> = {}) {
  const host = document.createElement("div");
  host.style.width = "800px";
  host.style.height = "400px";
  document.body.append(host);
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config(extra));
  card.hass = hass;
  host.append(card);
  await card.updateComplete;
  const root = card.shadowRoot!;
  // The zoom eases over 0.4s; the geometry checks read where it lands.
  const still = new CSSStyleSheet();
  still.replaceSync(".plan-zoom { transition: none !important; }");
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, still];
  const t = {
    card,
    root,
    plan: () => root.querySelector<HTMLElement>(".plan")!,
    lamp: () => root.querySelector<HTMLElement>(".item")!,
    button: (label: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`),
    transform() {
      const m = root.querySelector<HTMLElement>(".plan-zoom")!.style.transform
        .match(/translate\(([-\d.e]+)%, ([-\d.e]+)%\) scale\(([\d.e]+)\)/);
      return { tx: Number(m?.[1]), ty: Number(m?.[2]), scale: Number(m?.[3]) };
    },
    async press(label: string) {
      await userEvent.click(t.button(label)!);
      await card.updateComplete;
    },
    /** A touch press on the lamp, dispatched the way a finger produces it. */
    async touch(moves: [number, number][]) {
      const el = t.lamp();
      const r = el.getBoundingClientRect();
      const x0 = r.left + r.width / 2;
      const y0 = r.top + r.height / 2;
      const touchAt = (x: number, y: number) =>
        new Touch({ identifier: 7, target: el, clientX: x, clientY: y });
      const pointer = (type: string, x: number, y: number) =>
        el.dispatchEvent(new PointerEvent(type, {
          pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y,
          bubbles: true, composed: true, cancelable: true,
        }));
      const touch = (type: string, x: number, y: number) => {
        const tc = touchAt(x, y);
        el.dispatchEvent(new TouchEvent(type, {
          touches: type === "touchend" ? [] : [tc], targetTouches: type === "touchend" ? [] : [tc],
          changedTouches: [tc], bubbles: true, composed: true, cancelable: true,
        }));
      };
      pointer("pointerdown", x0, y0);
      touch("touchstart", x0, y0);
      let [x, y] = [x0, y0];
      for (const [dx, dy] of moves) {
        [x, y] = [x0 + dx, y0 + dy];
        pointer("pointermove", x, y);
        touch("touchmove", x, y);
        await frame();
      }
      pointer("pointerup", x, y);
      touch("touchend", x, y);
      await card.updateComplete;
    },
  };
  return t;
}

afterEach(() => {
  document.body.innerHTML = "";
  calls.length = 0;
});

describe("zoom buttons", () => {
  it("are not there unless asked for, and an unzoomed plan claims no gesture", async () => {
    const off = await mount({ zoomControls: undefined });
    expect(off.button("Zoom in")).toBeNull();
    expect(getComputedStyle(off.plan()).touchAction).toBe("auto");
    document.body.innerHTML = "";
    const on = await mount();
    expect(on.button("Zoom in")).not.toBeNull();
    // Unzoomed, a finger on the plan still scrolls the dashboard.
    expect(getComputedStyle(on.plan()).touchAction).toBe("auto");
    expect(on.button("Zoom out a step")!.disabled).toBe(true);
  });

  it("step in, hold the level, and step back out to the whole plan", async () => {
    const t = await mount();
    await t.press("Zoom in");
    expect(t.transform().scale).toBeCloseTo(1.5);
    // The zoomed plan now owns the gesture.
    expect(getComputedStyle(t.plan()).touchAction).toBe("none");
    // It stays there: an unrelated state update does not undo it.
    t.card.hass = { ...hass } as FloorplanCard["hass"];
    await t.card.updateComplete;
    expect(t.transform().scale).toBeCloseTo(1.5);
    await t.press("Zoom in");
    expect(t.transform().scale).toBeCloseTo(2.25);
    await t.press("Zoom out a step");
    await t.press("Zoom out a step");
    expect(t.transform()).toEqual({ tx: 0, ty: 0, scale: 1 });
    expect(t.button("Zoom out")).toBeNull();
  });

  it("step on from a room's framing rather than from the whole plan", async () => {
    // The room arrows are the plainest way to zoom a room from a test.
    const t = await mount({ roomFocus: true });
    t.button("Next room")!.click();
    await t.card.updateComplete;
    const room = t.transform().scale;
    expect(room).toBeGreaterThan(1);
    await t.press("Zoom in");
    expect(t.transform().scale).toBeCloseTo(room * 1.5);
  });
});

describe("dragging the zoomed plan", () => {
  it("a mouse drag that starts on a device pans the plan and does not press the device", async () => {
    const t = await mount();
    await t.press("Zoom in");
    await t.press("Zoom in");
    const before = t.transform();
    const r = t.plan().getBoundingClientRect();
    const lamp = t.lamp().getBoundingClientRect();
    // Real mouse: down on the lamp, across the plan, up.
    await userEvent.dragAndDrop(t.lamp(), t.plan(), {
      targetPosition: { x: lamp.left - r.left + lamp.width / 2 + 80, y: lamp.top - r.top + lamp.height / 2 + 40 },
    } as never);
    await t.card.updateComplete;
    await wait(300); // past the action handler's double-tap window, had it started one
    const after = t.transform();
    expect(after.tx).toBeGreaterThan(before.tx);
    expect(after.ty).toBeGreaterThan(before.ty);
    expect(calls).toEqual([]);
  });

  it("a click that does not move still presses the device, zoomed or not", async () => {
    const t = await mount();
    await userEvent.click(t.lamp());
    expect(calls).toHaveLength(1);
    await t.press("Zoom in");
    await userEvent.click(t.lamp());
    expect(calls).toHaveLength(2);
  });

  it("a finger drag pans and does not tap; a finger that stays put still taps", async () => {
    const t = await mount();
    await t.press("Zoom in");
    await t.press("Zoom in");
    const before = t.transform();
    await t.touch([[3, 0], [20, 10], [60, 30]]);
    await wait(300);
    expect(t.transform().tx).toBeGreaterThan(before.tx);
    expect(calls).toEqual([]);

    await t.touch([]);
    expect(calls).toHaveLength(1);
  });

  it("follows the pointer on a rotated plan", async () => {
    const t = await mount({ rotation: 90 });
    await t.press("Zoom in");
    await t.press("Zoom in");
    const lamp = t.lamp().getBoundingClientRect();
    const plan = t.plan();
    const at = (type: string, x: number, y: number) =>
      plan.dispatchEvent(new PointerEvent(type, {
        pointerId: 3, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1,
        clientX: x, clientY: y,
        bubbles: true, composed: true,
      }));
    at("pointerdown", 400, 200);
    at("pointermove", 420, 200);
    at("pointermove", 440, 190);
    at("pointerup", 440, 190);
    await t.card.updateComplete;
    await frame();
    const moved = t.lamp().getBoundingClientRect();
    // Right by 40px and up by 10px on screen, as the pointer went. Centres,
    // because the badge's own counter-scale may still be easing from the zoom.
    const cx = (b: DOMRect) => b.left + b.width / 2;
    const cy = (b: DOMRect) => b.top + b.height / 2;
    expect(cx(moved) - cx(lamp)).toBeCloseTo(40, 0);
    expect(cy(moved) - cy(lamp)).toBeCloseTo(-10, 0);
  });

  it("moves the plan while the drag is still going, with the easing off", async () => {
    const t = await mount();
    await t.press("Zoom in");
    const before = t.transform();
    const plan = t.plan();
    const at = (type: string, x: number, buttons: number) =>
      plan.dispatchEvent(new PointerEvent(type, {
        pointerId: 5, pointerType: "mouse", isPrimary: true, button: 0, buttons,
        clientX: x, clientY: 100, bubbles: true, composed: true,
      }));
    at("pointerdown", 100, 1);
    at("pointermove", 150, 1);
    await frame();
    await t.card.updateComplete;
    expect(plan.classList.contains("panning")).toBe(true);
    expect(t.transform().tx).toBeGreaterThan(before.tx);
    at("pointerup", 150, 0);
    await t.card.updateComplete;
    expect(plan.classList.contains("panning")).toBe(false);
  });

  it("a press released off the plan does not leave hovering dragging it, or eat the next tap", async () => {
    const t = await mount();
    await t.press("Zoom in");
    const before = t.transform();
    const plan = t.plan();
    // Down on the plan, released somewhere the plan never hears about.
    plan.dispatchEvent(new PointerEvent("pointerdown", {
      pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1,
      clientX: 100, clientY: 100, bubbles: true, composed: true,
    }));
    // Later, the mouse merely passes over the plan with no button held.
    plan.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 0,
      clientX: 300, clientY: 200, bubbles: true, composed: true,
    }));
    await frame();
    await t.card.updateComplete;
    expect(t.transform()).toEqual(before);
    await userEvent.click(t.lamp());
    expect(calls).toHaveLength(1);
  });

  it("stops at the plan's edge rather than dragging it off the card", async () => {
    const t = await mount();
    await t.press("Zoom in");
    const plan = t.plan();
    const at = (type: string, x: number, y: number) =>
      plan.dispatchEvent(new PointerEvent(type, {
        pointerId: 4, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1,
        clientX: x, clientY: y,
        bubbles: true, composed: true,
      }));
    at("pointerdown", 100, 100);
    at("pointermove", 3000, 3000);
    at("pointerup", 3000, 3000);
    await t.card.updateComplete;
    expect(t.transform()).toEqual({ tx: 0, ty: 0, scale: 1.5 });
  });
});

describe("getting back to the whole plan", () => {
  async function zoomedAndPanned() {
    const t = await mount();
    await t.press("Zoom in");
    await t.press("Zoom in");
    await t.touch([[40, 0], [80, 0]]);
    expect(t.transform().scale).toBeGreaterThan(1);
    return t;
  }

  it("the zoom-out button resets the zoom and the pan", async () => {
    const t = await zoomedAndPanned();
    await t.press("Zoom out");
    expect(t.transform()).toEqual({ tx: 0, ty: 0, scale: 1 });
  });

  it("Escape resets the zoom and the pan", async () => {
    const t = await zoomedAndPanned();
    t.plan().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await t.card.updateComplete;
    expect(t.transform()).toEqual({ tx: 0, ty: 0, scale: 1 });
  });

  it("changing floor starts from the whole plan", async () => {
    const t = await zoomedAndPanned();
    await userEvent.click(t.root.querySelector<HTMLButtonElement>('button[title="Upper"]')!);
    await t.card.updateComplete;
    expect(t.transform()).toEqual({ tx: 0, ty: 0, scale: 1 });
  });
});

describe("the wheel", () => {
  const wheel = (el: HTMLElement, ctrlKey: boolean) => {
    const r = el.getBoundingClientRect();
    const ev = new WheelEvent("wheel", {
      deltaY: -100, ctrlKey, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      bubbles: true, composed: true, cancelable: true,
    });
    el.dispatchEvent(ev);
    return ev;
  };

  it("a plain wheel is left to scroll the page", async () => {
    const t = await mount();
    expect(wheel(t.plan(), false).defaultPrevented).toBe(false);
    await frame();
    await t.card.updateComplete;
    expect(t.transform().scale).toBe(1);
  });

  it("Ctrl+wheel zooms", async () => {
    const t = await mount();
    expect(wheel(t.plan(), true).defaultPrevented).toBe(true);
    await frame();
    await t.card.updateComplete;
    expect(t.transform().scale).toBeGreaterThan(1);
  });
});
