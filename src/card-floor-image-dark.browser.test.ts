/**
 * The floor image following Home Assistant's light/dark mode (issue #366).
 *
 * In a real browser because the switch has to reach the painted image: the
 * card filters which hass ticks redraw it, and a tick that only flips dark
 * mode would otherwise leave the light image up until some entity changed.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { Floor, FloorplanCardConfig } from "./types";

function config(floor: Partial<Floor>): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 600,
    floors: [
      { id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [], ...floor },
    ],
  } as FloorplanCardConfig;
}

const hass = (darkMode: boolean) =>
  ({ states: {}, entities: {}, themes: { darkMode }, formatEntityState: () => "" }) as unknown as FloorplanCard["hass"];

async function mount(floor: Partial<Floor>, dark: boolean) {
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config(floor));
  card.hass = hass(dark);
  document.body.appendChild(card);
  await card.updateComplete;
  const image = () => card.shadowRoot!.querySelector("image.fp-floor-image") as SVGImageElement | null;
  return {
    card,
    href: () => image()?.getAttribute("href") ?? null,
    filter: () => (image() ? getComputedStyle(image()!).filter : null),
    async setDark(d: boolean) {
      card.hass = hass(d);
      await card.updateComplete;
    },
  };
}

describe("floor image in dark mode", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("inverts the image when HA turns dark, and back again", async () => {
    const t = await mount({ image: "/local/plan.png", imageInvertDark: true }, false);
    expect(t.filter()).toBe("none");
    await t.setDark(true);
    expect(t.href()).toBe("/local/plan.png");
    expect(t.filter()).toBe("invert(1) hue-rotate(180deg)");
    await t.setDark(false);
    expect(t.filter()).toBe("none");
  });

  it("swaps to the dark image of its own", async () => {
    const t = await mount({ image: "/local/plan.png", imageDark: "/local/plan-dark.png" }, false);
    expect(t.href()).toBe("/local/plan.png");
    await t.setDark(true);
    expect(t.href()).toBe("/local/plan-dark.png");
    expect(t.filter()).toBe("none");
  });

  it("leaves a plan without either option alone in dark mode", async () => {
    const t = await mount({ image: "/local/plan.png" }, true);
    expect(t.href()).toBe("/local/plan.png");
    expect(t.filter()).toBe("none");
  });
});
