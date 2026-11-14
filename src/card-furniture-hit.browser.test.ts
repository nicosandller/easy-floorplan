import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "@vitest/browser/context";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig, Furniture } from "./types";
import { FURNITURE_ICON_GLYPH, FURNITURE_ICON_SIZE, MIN_TOUCH_TARGET } from "./types";

afterEach(() => { document.body.innerHTML = ""; });

async function mount(
  view: "2d" | "3d",
  piece: Partial<Furniture>,
  rotation = 0,
  extra: Partial<FloorplanCardConfig> = {},
) {
  const card = document.createElement("easy-floorplan-card");
  card.style.display = "block";
  card.style.width = "400px";
  card.setConfig({
    type: "custom:easy-floorplan-card", width: 500, height: 400, view, rotation,
    wallHeight: 60, ...extra, walls: [], openings: [], items: [], texts: [], trackers: [],
    furniture: [{ id: "table", type: "table", x: 220, y: 170, w: 130, h: 90, ...piece }],
    areas: [{ id: "room", points: [{ x: 120, y: 80 }, { x: 340, y: 80 },
      { x: 340, y: 280 }, { x: 120, y: 280 }] }],
  } as FloorplanCardConfig);
  card.hass = { states: {}, entities: {} } as FloorplanCard["hass"];
  document.body.append(card);
  await card.updateComplete;
  // The assertions inspect settled room geometry, independent of motion preferences.
  const style = document.createElement("style");
  style.textContent = ".plan-zoom, .fp-furniture-link { transition: none !important; }";
  card.shadowRoot!.append(style);
  await new Promise(requestAnimationFrame);
  return card;
}

function surfacePoint(card: FloorplanCard, x = 0) {
  const glyph = card.shadowRoot!.querySelector<SVGGElement>(".fp-furniture")!;
  return new DOMPoint(x, 0).matrixTransform(glyph.getScreenCTM()!);
}

async function clickSurface(card: FloorplanCard, x = 0) {
  const p = surfacePoint(card, x);
  // Chromium chooses the target; dispatching directly to the Area would hide
  // a furniture surface or an oversized invisible badge swallowing the tap.
  const target = card.shadowRoot!.elementFromPoint(p.x, p.y)!;
  expect(target).not.toBeNull();
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: p.x, clientY: p.y }));
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: p.x, clientY: p.y }));
  await card.updateComplete;
  return target;
}

function icon(card: FloorplanCard) {
  return card.shadowRoot!.querySelector<HTMLElement>(".fp-furniture-link")!;
}

function recordActions(card: FloorplanCard) {
  const actions: Event[] = [];
  card.addEventListener("ll-custom", e => actions.push(e));
  return actions;
}

const fire = { action: "fire-dom-event" } as const;

describe("furniture hit testing (#323)", () => {
  for (const view of ["2d", "3d"] as const) {
    for (const rotation of [0, 90, 180, 270]) {
      it(`${view}, rotation ${rotation}: decorative furniture has no icon and passes taps to the Area`, async () => {
        const card = await mount(view, {}, rotation);
        expect(icon(card)).toBeNull();
        const target = await clickSurface(card);
        expect(target.closest(".area-tap-target")).not.toBeNull();
        expect(card.shadowRoot!.querySelector(".zoom-out")).not.toBeNull();
      });

      it(`${view}, rotation ${rotation}: actionable surfaces pass through beside an aligned icon`, async () => {
        for (const piece of [{ tap_action: fire }, { hold_action: fire }, { double_tap_action: fire }]) {
          const card = await mount(view, piece, rotation);
          const actions = recordActions(card);
          const box = icon(card).getBoundingClientRect();
          const centre = surfacePoint(card);
          expect(box.x + box.width / 2).toBeCloseTo(centre.x, 1);
          expect(box.y + box.height / 2).toBeCloseTo(centre.y, 1);
          expect(box.width).toBeCloseTo(MIN_TOUCH_TARGET, 1);
          const target = await clickSurface(card, 55);
          expect(target.closest(".area-tap-target")).not.toBeNull();
          expect(card.shadowRoot!.querySelector(".zoom-out")).not.toBeNull();
          expect(actions).toHaveLength(0);
          card.remove();
        }
      });
    }

    it(`${view}: explicit none and unusable gestures have no icon and pass through`, async () => {
      for (const gesture of ["tap_action", "hold_action", "double_tap_action"]) {
        for (const action of ["none", "more-info", "navigate", "call-service"]) {
          const card = await mount(view, { [gesture]: { action } });
          expect(icon(card)).toBeNull();
          await clickSurface(card);
          expect(card.shadowRoot!.querySelector(".zoom-out")).not.toBeNull();
          card.remove();
        }
      }
    });

    it(`${view}: clicking the visible icon runs the action without zooming`, async () => {
      const card = await mount(view, { tap_action: fire });
      const actions = recordActions(card);
      const p = surfacePoint(card);
      expect(card.shadowRoot!.elementFromPoint(p.x, p.y)?.closest(".fp-furniture-link")).toBe(icon(card));
      await userEvent.click(icon(card));
      expect(actions).toHaveLength(1);
      expect(card.shadowRoot!.querySelector(".zoom-out")).toBeNull();
    });

    it(`${view}: hold and double-tap icons run only their configured pointer gesture`, async () => {
      for (const gesture of ["hold_action", "double_tap_action"] as const) {
        const card = await mount(view, { [gesture]: fire });
        const actions = recordActions(card);
        expect(icon(card).getAttribute("title")).toContain(gesture === "hold_action" ? "Hold" : "Double-tap");
        expect(icon(card).querySelector("ha-icon")?.getAttribute("icon")).toBe(
          gesture === "hold_action" ? "mdi:gesture-tap-hold" : "mdi:gesture-double-tap");
        await userEvent.click(icon(card));
        await new Promise(resolve => setTimeout(resolve, 280));
        expect(actions).toHaveLength(0);
        if (gesture === "hold_action") await userEvent.click(icon(card), { delay: 550 });
        else await userEvent.dblClick(icon(card));
        expect(actions).toHaveLength(1);
        expect(card.shadowRoot!.querySelector(".zoom-out")).toBeNull();
        card.remove();
      }
    });

    it(`${view}: keyboard activation stays a single tap even when other gestures exist`, async () => {
      const card = await mount(view, {
        tap_action: fire,
        hold_action: { action: "more-info", entity: "light.held" },
        double_tap_action: { action: "more-info", entity: "light.double" },
      });
      const actions = recordActions(card);
      const unexpected: Event[] = [];
      card.addEventListener("hass-more-info", event => unexpected.push(event));
      icon(card).focus();
      expect(card.shadowRoot!.activeElement).toBe(icon(card));
      await userEvent.keyboard("{Enter} ");
      await new Promise(resolve => setTimeout(resolve, 280));
      expect(actions).toHaveLength(2);
      expect(unexpected).toEqual([]);
      expect(card.shadowRoot!.querySelector(".zoom-out")).toBeNull();
    });

    it(`${view}: the visible target stays finger-sized after resizing and room zoom`, async () => {
      const card = await mount(view, { tap_action: fire });
      card.style.width = "320px";
      expect(icon(card).getBoundingClientRect().width).toBeCloseTo(MIN_TOUCH_TARGET, 1);
      await clickSurface(card, 60);
      expect(card.shadowRoot!.querySelector(".zoom-out")).not.toBeNull();
      expect(icon(card).getBoundingClientRect().width).toBeCloseTo(MIN_TOUCH_TARGET, 1);
      const actions = recordActions(card);
      await userEvent.click(icon(card));
      expect(actions).toHaveLength(1);
      expect(card.shadowRoot!.querySelector(".zoom-out")).not.toBeNull();
    });
  }
});

describe("hiding the furniture action icon (#362)", () => {
  const glyph = (card: FloorplanCard) => card.shadowRoot!.querySelector<SVGGElement>(".fp-furniture-hit");

  for (const view of ["2d", "3d"] as const) {
    for (const rotation of [0, 90]) {
      it(`${view}, rotation ${rotation}: no icon, and tapping the drawing runs its action`, async () => {
        const card = await mount(view, { tap_action: fire, showIcon: false }, rotation);
        const actions = recordActions(card);
        expect(icon(card)).toBeNull();
        const target = await clickSurface(card);
        expect(target.closest(".fp-furniture-hit")).toBe(glyph(card));
        expect(actions).toHaveLength(1);
        expect(card.shadowRoot!.querySelector(".zoom-out")).toBeNull();
      });
    }

    it(`${view}: the space around the drawing still reaches the Area`, async () => {
      const card = await mount(view, { tap_action: fire, showIcon: false });
      const actions = recordActions(card);
      // Past the table's 130-unit width, still inside the room.
      const target = await clickSurface(card, 90);
      expect(target.closest(".area-tap-target")).not.toBeNull();
      expect(actions).toHaveLength(0);
      expect(card.shadowRoot!.querySelector(".zoom-out")).not.toBeNull();
    });

    it(`${view}: a decorative piece is unaffected by the option`, async () => {
      const card = await mount(view, { showIcon: false });
      expect(glyph(card)).toBeNull();
      const target = await clickSurface(card);
      expect(target.closest(".area-tap-target")).not.toBeNull();
    });
  }

  it("the hidden piece keeps its name, gestures and keyboard tap", async () => {
    const card = await mount("2d", {
      tap_action: fire,
      hold_action: { action: "more-info", entity: "light.held" },
      showIcon: false,
    });
    const actions = recordActions(card);
    const g = glyph(card)!;
    expect(g.getAttribute("role")).toBe("button");
    expect(g.getAttribute("tabindex")).toBe("0");
    expect(g.getAttribute("aria-label")).toBeTruthy();
    expect(g.querySelector("title")?.textContent).toContain("Tap, Hold");
    g.focus();
    await userEvent.keyboard("{Enter}");
    expect(actions).toHaveLength(1);
  });

  it("keyboard focus draws a ring around the hidden piece", async () => {
    const card = await mount("2d", { tap_action: fire, showIcon: false, angle: 30 });
    const g = glyph(card)!;
    const ring = g.querySelector<SVGRectElement>(".fp-furniture-focus")!;
    expect(getComputedStyle(ring).display).toBe("none");
    g.focus();
    await userEvent.keyboard("{Shift}");
    expect(getComputedStyle(ring).display).not.toBe("none");
    expect(getComputedStyle(ring).stroke).not.toBe("none");
    // Around the drawing, not under it: the ring encloses the piece.
    const box = ring.getBoundingClientRect();
    const drawn = g.querySelector(".fp-furniture")!.getBoundingClientRect();
    expect(box.left).toBeLessThanOrEqual(drawn.left);
    expect(box.right).toBeGreaterThanOrEqual(drawn.right);
    expect(getComputedStyle(ring).pointerEvents).toBe("none");
  });

  it("a hidden hold-only piece is not a tab stop", async () => {
    const card = await mount("2d", { hold_action: fire, showIcon: false });
    const g = glyph(card)!;
    expect(g.getAttribute("role")).toBe("group");
    expect(g.hasAttribute("tabindex")).toBe(false);
  });

  it("3D house view: roofs and the house beside a hidden piece leave its drawing tappable", async () => {
    const card = document.createElement("easy-floorplan-card");
    card.style.display = "block";
    card.style.width = "400px";
    const seq = Math.random().toString(36).slice(2);
    const box = (x0: number, y0: number, x1: number, y1: number) =>
      [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    const empty = { openings: [], items: [], trackers: [], texts: [] };
    card.setConfig({
      type: "custom:easy-floorplan-card", width: 500, height: 400, view: "3d", wallHeight: 60,
      defaultFloor: `garden-${seq}`,
      floors: [
        {
          // An indoor storey behind the piece, with its own roof.
          id: `house-${seq}`, name: "House", level: 0, ...empty, furniture: [],
          walls: [
            { id: "w1", x1: 20, y1: 20, x2: 180, y2: 20 }, { id: "w2", x1: 180, y1: 20, x2: 180, y2: 120 },
            { id: "w3", x1: 180, y1: 120, x2: 20, y2: 120 }, { id: "w4", x1: 20, y1: 120, x2: 20, y2: 20 },
          ],
          areas: [{ id: "hall", points: box(20, 20, 180, 120) }],
          roofs: [{ id: "house-roof", type: "gable", points: box(20, 20, 180, 120) }],
        },
        {
          id: `garden-${seq}`, name: "Garden", isOutdoor: true, ...empty, walls: [],
          areas: [{ id: "lawn", points: box(0, 0, 500, 400) }],
          // A shed roof beside the piece.
          roofs: [{ id: "shed", type: "shed", points: box(380, 40, 480, 140) }],
          furniture: [{ id: "table", type: "table", x: 220, y: 260, w: 130, h: 90, tap_action: fire, showIcon: false }],
        },
      ],
    } as unknown as FloorplanCardConfig);
    card.hass = { states: {}, entities: {} } as FloorplanCard["hass"];
    document.body.append(card);
    await card.updateComplete;
    await new Promise(requestAnimationFrame);
    expect(card.shadowRoot!.querySelector(".fp-iso-roof")).not.toBeNull();
    const actions = recordActions(card);
    expect(icon(card)).toBeNull();
    const target = await clickSurface(card);
    expect(target.closest(".fp-furniture-hit")).toBe(glyph(card));
    expect(actions).toHaveLength(1);
  });

  it("a hidden staircase still changes floor when tapped", async () => {
    const card = document.createElement("easy-floorplan-card");
    card.style.display = "block";
    card.style.width = "400px";
    const floor = (id: string, furniture: Partial<Furniture>[]) => ({
      id, name: id, walls: [], openings: [], items: [], trackers: [], areas: [],
      texts: [{ id: `t-${id}`, x: 50, y: 50, text: id }],
      furniture: furniture.map((f, i) => ({ id: `${id}-${i}`, type: "stairs", x: 220, y: 170, w: 130, h: 90, ...f })),
    });
    // Fresh floor ids: the card remembers the last floor per set of ids.
    const seq = Math.random().toString(36).slice(2);
    card.setConfig({
      type: "custom:easy-floorplan-card", width: 500, height: 400,
      floors: [floor(`g-${seq}`, [{ goToFloor: "up", showIcon: false }]), floor(`u-${seq}`, [])],
    } as unknown as FloorplanCardConfig);
    card.hass = { states: {}, entities: {} } as FloorplanCard["hass"];
    document.body.append(card);
    await card.updateComplete;
    expect(icon(card)).toBeNull();
    await clickSurface(card);
    expect(card.shadowRoot!.querySelector(".fp-text")?.textContent?.trim()).toBe(`u-${seq}`);
  });
});

describe("the furniture action icon follows overlayScale (#362)", () => {
  it("fixed: screen pixels, whatever the card's width", async () => {
    const card = await mount("2d", { tap_action: fire }, 0, { overlayScale: "fixed" });
    expect(icon(card).getBoundingClientRect().width).toBeCloseTo(MIN_TOUCH_TARGET, 1);
  });

  it("plan: canvas units, so it shrinks with the drawing like a badge", async () => {
    // 500 canvas units shown 400px wide: 0.8px per unit.
    const card = await mount("2d", { tap_action: fire }, 0, { overlayScale: "plan" });
    expect(icon(card).getBoundingClientRect().width).toBeCloseTo(FURNITURE_ICON_SIZE * 0.8, 0);
    card.style.width = "250px";
    await new Promise(requestAnimationFrame);
    expect(icon(card).getBoundingClientRect().width).toBeCloseTo(FURNITURE_ICON_SIZE * 0.5, 0);
  });

  it("the glyph is sized on the ha-icon itself, so the card-wide ha-icon rule cannot override it", async () => {
    const glyph = (card: FloorplanCard) =>
      getComputedStyle(icon(card).querySelector("ha-icon")!).getPropertyValue("--mdc-icon-size").trim();
    expect(glyph(await mount("2d", { tap_action: fire }, 0, { overlayScale: "fixed" }))).toBe(`${FURNITURE_ICON_GLYPH}px`);
    expect(glyph(await mount("2d", { tap_action: fire }, 0, { overlayScale: "plan" }))).toMatch(
      new RegExp(`^calc\\(${FURNITURE_ICON_GLYPH} \\*`),
    );
  });
});
