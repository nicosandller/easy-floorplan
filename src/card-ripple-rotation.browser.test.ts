/**
 * A ripple's direction follows the card's rotation (issue #280).
 *
 * "Ripple direction stays in editing reference … only follow editing mode
 * orientation." The overlay is HTML, so unlike the SVG it is never transformed
 * as a whole — each anchor is remapped instead, which is exactly what keeps
 * badges and labels upright. A *bearing* is the one thing that must not be left
 * behind by that: it says where the sensor looks in the room, so a plan rotated
 * for display aimed the cone at a different wall than the one it was set to.
 *
 * In a browser rather than the node suite because the helper being right proves
 * nothing about it being *used*: the direction reaches the mask as a custom
 * property, and the card could compute a correct angle and still hand the
 * renderer the raw one.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorItem, FloorplanCardConfig } from "./types";
import type { PlanRotation } from "./render";

function config(rotation: PlanRotation, item: Partial<FloorItem>): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 400,
    height: 200,
    rotation,
    floors: [
      {
        id: "f1",
        name: "Floor 1",
        walls: [],
        openings: [],
        items: [
          {
            id: "s1",
            entity: "binary_sensor.motion",
            x: 200,
            y: 100,
            display: "ripple",
            rippleWidth: 90,
            ...item,
          } as FloorItem,
        ],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      },
    ],
  } as unknown as FloorplanCardConfig;
}

const hass = {
  states: {
    "binary_sensor.motion": {
      entity_id: "binary_sensor.motion",
      state: "on",
      attributes: { device_class: "motion" },
    },
  },
  entities: {},
  formatEntityState: (st: { state: string }) => st.state,
} as unknown as FloorplanCard["hass"];

async function mount(rotation: PlanRotation, item: Partial<FloorItem> = {}) {
  const host = document.createElement("div");
  host.style.width = "800px";
  host.style.height = "400px";
  document.body.appendChild(host);

  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config(rotation, item));
  card.hass = hass;
  host.appendChild(card);
  await card.updateComplete;

  const ripple = card.shadowRoot!.querySelector(".ripple") as HTMLElement;
  return {
    exists: () => !!ripple,
    /** What the conic-gradient mask is actually driven by. */
    direction: () =>
      Number(getComputedStyle(ripple).getPropertyValue("--fp-ripple-direction").trim()),
  };
}

describe("a ripple's cone points at the same wall however the card is rotated", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("finds a ripple to measure", async () => {
    // Guards the rest: a selector that stopped matching would make every
    // assertion below throw on NaN rather than say what was wrong.
    const t = await mount(0, { rippleDirection: 0 });
    expect(t.exists()).toBe(true);
    expect(Number.isNaN(t.direction())).toBe(false);
  });

  it("turns a plan bearing into the displayed frame", async () => {
    // Aimed at plan-north. At 90° the top of the plan is the right of the
    // screen, so the cone has to be pointing right — 90 — to still be on it.
    for (const [rotation, expected] of [
      [0, 0],
      [90, 90],
      [180, 180],
      [270, 270],
    ] as const) {
      const t = await mount(rotation, { rippleDirection: 0 });
      expect(t.direction(), `rotation=${rotation}`).toBe(expected);
      document.body.innerHTML = "";
    }
  });

  it("carries a bearing that is not the default", async () => {
    const t = await mount(90, { rippleDirection: 45 });
    expect(t.direction()).toBe(135);
  });

  it("wraps past 360 rather than running off the end", async () => {
    const t = await mount(270, { rippleDirection: 135 });
    expect(t.direction()).toBe(45);
  });

  it("leaves an unrotated card exactly as it was", async () => {
    // Every plan that does not set `rotation` is on this path, and none of
    // them should move.
    for (const direction of [0, 45, 200, 359]) {
      const t = await mount(0, { rippleDirection: direction });
      expect(t.direction(), `direction=${direction}`).toBe(direction);
      document.body.innerHTML = "";
    }
  });

  it("still points somewhere sensible when no direction was ever set", async () => {
    // An all-round ripple has no visible cone, but the property still feeds the
    // mask and must not come out NaN on a rotated card.
    const t = await mount(90, {});
    expect(Number.isNaN(t.direction())).toBe(false);
  });
});
