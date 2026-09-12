/**
 * Named colours, in a real browser (issue #265).
 *
 * The node suite tests what `palette.ts` computes; none of it can test the
 * thing the whole design rests on, which is that a stored
 * `var(--fp-color-warm)` becomes an actual painted colour. That is CSS
 * resolution, so it needs a browser and a mounted card, and it is exactly the
 * claim that would be silently wrong if the custom properties were declared on
 * the wrong element — with no error anywhere, just elements drawn black.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig, PaletteColor } from "./types";

const WARM = "rgb(255, 136, 0)";
const COLD = "rgb(68, 136, 255)";

function config(palette: PaletteColor[] | undefined): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 600,
    palette,
    floors: [
      {
        id: "f1",
        name: "Floor 1",
        walls: [],
        openings: [],
        items: [],
        // An inline style on HTML…
        texts: [{ id: "t1", x: 100, y: 500, text: "Label", color: "var(--fp-color-cold)" }],
        furniture: [],
        trackers: [],
        // …and an SVG presentation attribute, which is the half that has no
        // declaration to sit in and could plausibly have behaved differently.
        areas: [
          {
            id: "a1",
            name: "Living",
            color: "var(--fp-color-warm)",
            points: [
              { x: 100, y: 100 },
              { x: 500, y: 100 },
              { x: 500, y: 400 },
              { x: 100, y: 400 },
            ],
          },
        ],
      },
    ],
  } as FloorplanCardConfig;
}

const hass = {
  states: {},
  entities: {},
  formatEntityState: (st: { state: string }) => st.state,
} as unknown as FloorplanCard["hass"];

async function mount(palette: PaletteColor[] | undefined) {
  const host = document.createElement("div");
  host.style.width = "900px";
  host.style.height = "540px";
  document.body.appendChild(host);

  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config(palette));
  card.hass = hass;
  host.appendChild(card);
  await card.updateComplete;

  const root = card.shadowRoot!;
  const area = () => root.querySelector("svg polygon")!;
  const text = () => [...root.querySelectorAll(".fp-text")].pop() as HTMLElement;
  return {
    card,
    styleAttr: () => root.querySelector("ha-card")!.getAttribute("style"),
    areaFillAttr: () => area().getAttribute("fill"),
    areaFill: () => getComputedStyle(area()).fill,
    textColor: () => getComputedStyle(text()).color,
    async recolor(next: PaletteColor[] | undefined) {
      card.setConfig(config(next));
      card.hass = { ...hass } as FloorplanCard["hass"];
      await card.updateComplete;
    },
  };
}

describe("a named color reaches the paint", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves in an SVG presentation attribute and in an inline style", async () => {
    const t = await mount([
      { name: "Warm", color: "#ff8800" },
      { name: "Cold", color: "#4488ff" },
    ]);
    expect(t.areaFill()).toBe(WARM);
    expect(t.textColor()).toBe(COLD);
  });

  it("leaves the reference in the markup, which is what keeps it live", async () => {
    // If this ever became a literal, recolouring the palette would stop
    // propagating and the test below would be the only thing to notice.
    const t = await mount([{ name: "Warm", color: "#ff8800" }]);
    expect(t.areaFillAttr()).toBe("var(--fp-color-warm)");
  });

  it("declares the palette on the card, and nothing at all without one", async () => {
    const t = await mount([{ name: "Warm", color: "#ff8800" }]);
    expect(t.styleAttr()).toBe("--fp-color-warm:#ff8800;");

    // An unpalettised plan must not gain a style attribute it never had.
    const plain = await mount(undefined);
    expect(plain.styleAttr()).toBeNull();
  });

  it("repaints when a name is given a new color", async () => {
    // The reason both canvases key their SVG on the palette: Chromium does not
    // repaint an element whose colour comes from a var() in a presentation
    // attribute when the property moves under it (the trap skins hit in #122).
    const t = await mount([
      { name: "Warm", color: "#ff8800" },
      { name: "Cold", color: "#4488ff" },
    ]);
    expect(t.areaFill()).toBe(WARM);

    await t.recolor([
      { name: "Warm", color: "#00cc44" },
      { name: "Cold", color: "#4488ff" },
    ]);
    expect(t.areaFill()).toBe("rgb(0, 204, 68)");
    // The colour that did not change did not move.
    expect(t.textColor()).toBe(COLD);
  });

  it("paints black when a reference dangles, which is why deleting rewrites", async () => {
    // Not a wish, a fact about CSS: an undefined custom property makes the
    // declaration invalid, the element falls back to inherit, and an SVG fill
    // inherits black. Pinned here because the editor's delete behaviour — and
    // the doc comment explaining it — is built entirely on this being true.
    const t = await mount([]);
    expect(t.areaFill()).toBe("rgb(0, 0, 0)");
    expect(t.textColor()).toBe("rgb(0, 0, 0)");
  });
});
