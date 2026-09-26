import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig, Furniture } from "./types";

afterEach(() => { document.body.innerHTML = ""; });

async function mount(view: "2d" | "3d", piece: Partial<Furniture>, rotation = 0) {
  const card = document.createElement("easy-floorplan-card");
  card.style.display = "block";
  card.style.width = "400px";
  card.setConfig({
    type: "custom:easy-floorplan-card", width: 500, height: 400, view, rotation,
    wallHeight: 60, walls: [], openings: [], items: [], texts: [], trackers: [],
    furniture: [{ id: "table", type: "table", x: 220, y: 170, w: 130, h: 90, ...piece }],
    areas: [{ id: "room", points: [{ x: 120, y: 80 }, { x: 340, y: 80 },
      { x: 340, y: 280 }, { x: 120, y: 280 }] }],
  } as FloorplanCardConfig);
  card.hass = { states: {}, entities: {} } as FloorplanCard["hass"];
  document.body.append(card);
  await card.updateComplete;
  await new Promise(requestAnimationFrame);
  return card;
}

async function clickSurface(card: FloorplanCard) {
  const glyph = card.shadowRoot!.querySelector<SVGGElement>(".fp-furniture")!;
  const p = new DOMPoint(0, 0).matrixTransform(glyph.getScreenCTM()!);
  // Use Chromium hit testing, not an event sent directly to the Area. The old
  // code's glyph has no listener but still wins this hit and swallows the tap.
  const target = card.shadowRoot!.elementFromPoint(p.x, p.y)!;
  expect(target).not.toBeNull();
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: p.x, clientY: p.y }));
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: p.x, clientY: p.y }));
  await card.updateComplete;
  return target;
}

describe("furniture hit testing (#323)", () => {
  for (const view of ["2d", "3d"] as const) {
    for (const rotation of [0, 90, 180, 270]) {
      it(`${view}, rotation ${rotation}: decorative furniture lets the Area receive the tap`, async () => {
        const card = await mount(view, {}, rotation);
        const target = await clickSurface(card);
        expect(target.closest(".area-tap-target")).not.toBeNull();
        expect(card.shadowRoot!.querySelector(".zoom-out")).not.toBeNull();
      });
    }
    it(`${view}: explicit none and unusable actions let room taps through`, async () => {
      for (const tap_action of [{ action: "none" }, { action: "more-info" }]) {
        const card = await mount(view, { tap_action } as Partial<Furniture>);
        await clickSurface(card);
        expect(card.shadowRoot!.querySelector(".zoom-out")).not.toBeNull();
        card.remove();
      }
    });
    it(`${view}: a configured action still receives the tap instead of zooming`, async () => {
      const card = await mount(view, { tap_action: { action: "fire-dom-event" } });
      const actions: Event[] = [];
      card.addEventListener("ll-custom", e => actions.push(e));
      const target = await clickSurface(card);
      expect(target.closest(".fp-furniture-link")).not.toBeNull();
      expect(actions).toHaveLength(1);
      expect(card.shadowRoot!.querySelector(".zoom-out")).toBeNull();
    });
  }
});
