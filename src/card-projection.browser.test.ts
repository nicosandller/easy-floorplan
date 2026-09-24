import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig } from "./types";
import type { PlanRotation } from "./render";

function config(extra: Partial<FloorplanCardConfig> = {}): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card", width: 400, height: 300, view: "3d", wallHeight: 60,
    wallOpacity: 0.45, sunlight: true, sunBearing: 0, ambientDaylight: true,
    walls: [
      { id: "north", x1: 0, y1: 0, x2: 400, y2: 0 },
      { id: "west", x1: 0, y1: 0, x2: 0, y2: 300 },
      { id: "east", x1: 400, y1: 0, x2: 400, y2: 300 },
      { id: "south", x1: 0, y1: 300, x2: 400, y2: 300 },
    ],
    openings: [
      { id: "door", type: "door", x: 100, y: 300, angle: 0, length: 60, entity: "binary_sensor.door" },
      { id: "window", type: "window", motion: "fixed", x: 200, y: 0, angle: 0, length: 80 },
    ],
    items: [{ id: "lamp", kind: "light", entity: "light.lamp", x: 180, y: 160, glow: true }],
    furniture: [{ id: "sofa", type: "sofa", x: 280, y: 150, w: 60, h: 40, entity: "light.lamp", tap_action: { action: "more-info" } }],
    texts: [], trackers: [],
    areas: [{ id: "room", points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] }],
    ...extra,
  } as FloorplanCardConfig;
}

function hass(open = false): FloorplanCard["hass"] {
  return {
    states: {
      "binary_sensor.door": { entity_id: "binary_sensor.door", state: open ? "on" : "off", attributes: { friendly_name: "Door", device_class: "door" } },
      "light.lamp": { entity_id: "light.lamp", state: "on", attributes: { friendly_name: "Lamp", brightness: 255 } },
      "sun.sun": { entity_id: "sun.sun", state: "above_horizon", attributes: { elevation: 40, azimuth: 180 } },
    }, entities: {},
    formatEntityState: (state: { state: string }) => state.state,
  } as unknown as FloorplanCard["hass"];
}

async function mount(extra: Partial<FloorplanCardConfig> = {}) {
  const host = document.createElement("div");
  host.style.width = "800px";
  document.body.append(host);
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config(extra));
  card.hass = hass();
  host.append(card);
  await card.updateComplete;
  return { card, host, root: card.shadowRoot! };
}

afterEach(() => { document.body.innerHTML = ""; });

/** Longer than the 0.5s panel travel, so whatever is read has arrived. */
const settled = () => new Promise((r) => setTimeout(r, 700));

describe("3D card integration", () => {
  it.each([0, 90, 180, 270] as PlanRotation[])("keeps walls inside the canvas and badges on their light at rotation %s", async (rotation) => {
    const { root, host, card } = await mount({ rotation });
    for (const width of [800, 320]) {
      host.style.width = `${width}px`;
      await new Promise(requestAnimationFrame);
      const box = root.querySelector(".plan")!.getBoundingClientRect();
      for (const face of root.querySelectorAll<SVGPolygonElement>(".fp-iso-wall polygon")) {
        // BoundingClientRect transforms the polygon's rectangular plan bounds,
        // including corners outside the polygon. Check the actual vertices.
        for (const vertex of Array.from(face.points)) {
          const wall = new DOMPoint(vertex.x, vertex.y).matrixTransform(face.getScreenCTM()!);
          expect(wall.x).toBeGreaterThanOrEqual(box.left - 1);
          expect(wall.x).toBeLessThanOrEqual(box.right + 1);
          expect(wall.y).toBeGreaterThanOrEqual(box.top - 1);
          expect(wall.y).toBeLessThanOrEqual(box.bottom + 1);
        }
      }
      const glow = root.querySelector<SVGCircleElement>(".fp-glow")!;
      const point = new DOMPoint(180, 160).matrixTransform(glow.getScreenCTM()!);
      const badge = root.querySelector<HTMLElement>(".fp-item")!;
      expect(box.left + parseFloat(badge.style.left) * box.width / 100).toBeCloseTo(point.x, 1);
      expect(box.top + parseFloat(badge.style.top) * box.height / 100).toBeCloseTo(point.y, 1);
    }
    expect(root.querySelector(".fp-sunlight")).not.toBeNull();
    expect(root.querySelector(".fp-ambient-daylight")).not.toBeNull();
    card.remove();
  });

  it("moves a standing leaf on contact changes, and routes opening and furniture taps", async () => {
    const { root, card } = await mount();
    const before = root.querySelector('.fp-iso-panel[data-id="door"]')!.getAttribute("points");
    card.hass = hass(true);
    await card.updateComplete;
    // The leaf eases across rather than jumping (see the travel tests below).
    await settled();
    expect(root.querySelector('.fp-iso-panel[data-id="door"]')!.getAttribute("points")).not.toBe(before);
    expect(root.querySelector(".fp-door-leaf")).toBeNull();
    const opened: string[] = [];
    card.addEventListener("hass-more-info", (ev) => opened.push((ev as CustomEvent).detail.entityId));
    root.querySelector('.fp-iso-opening-button[role="button"]')!.dispatchEvent(new CustomEvent("action", { detail: { action: "tap" } }));
    root.querySelector(".fp-furniture-link")!.dispatchEvent(new CustomEvent("action", { detail: { action: "tap" } }));
    expect(opened).toEqual(["binary_sensor.door", "light.lamp"]);
  });

  it("fades the whole wall plane but not what stands inside the room, and preserves the legacy mode alias", async () => {
    const { root, card } = await mount({ view: undefined, projection: "iso" });
    expect(getComputedStyle(root.querySelector(".fp-iso-wall")!).opacity).toBe("0.45");
    expect(getComputedStyle(root.querySelector(".fp-iso-sill")!).opacity).toBe("0.45");
    // A closed leaf fills a gap in the wall, so leaving it opaque read as a
    // patch of wall that had refused to turn transparent (issue #261 review).
    expect(getComputedStyle(root.querySelector('.fp-iso-panel[data-id="door"]')!).opacity).toBe("0.45");
    // Glass keeps its own alpha rather than being faded twice.
    expect(getComputedStyle(root.querySelector(".fp-iso-glazed")!).opacity).toBe("1");
    expect(getComputedStyle(root.querySelector(".fp-iso-furniture")!).opacity).toBe("1");
    card.setConfig(config({ projection: "iso", view: "2d" }));
    await card.updateComplete;
    expect(root.querySelector(".fp-iso")).toBeNull();
    expect(root.querySelector(".fp-door-leaf")).not.toBeNull();
  });

  it("eases a leaf across its swing instead of jumping it there", async () => {
    const { root, card } = await mount();
    const points = () => root.querySelector('.fp-iso-panel[data-id="door"]')!.getAttribute("points");
    const shut = points();
    card.hass = hass(true);
    await card.updateComplete;
    // Still shut on the frame the new state arrives: that is where it sets off
    // from, and the jump this replaces happened right here.
    expect(points()).toBe(shut);
    await new Promise((r) => setTimeout(r, 150));
    const midway = points();
    expect(midway).not.toBe(shut);
    await settled();
    expect(points()).not.toBe(midway);
  });

  it("puts the leaf straight there when the viewer asks for less motion", async () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) =>
      q.includes("prefers-reduced-motion")
        ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList)
        : real.call(window, q)) as typeof window.matchMedia;
    try {
      const { root, card } = await mount();
      const points = () => root.querySelector('.fp-iso-panel[data-id="door"]')!.getAttribute("points");
      const shut = points();
      card.hass = hass(true);
      await card.updateComplete;
      expect(points()).not.toBe(shut);
    } finally {
      window.matchMedia = real;
    }
  });

  it("draws the flat plan on an isometric floor at zero wall height", async () => {
    const { root, card } = await mount({ wallHeight: 0 });
    expect(root.querySelector(".fp-door-leaf")).not.toBeNull();
    expect(root.querySelector(".fp-iso-opening-hit")).toBeNull();
    // Walls and furniture are the flat plan's own, not boxes with no height.
    expect(root.querySelector(".fp-iso")).toBeNull();
    expect(root.querySelectorAll(".fp-wall")).toHaveLength(4);
    expect(root.querySelector(".fp-furniture")).not.toBeNull();
    // Nothing stands, so nothing travels: the leaf's CSS transition has it.
    card.hass = hass(true);
    await card.updateComplete;
    expect((card as unknown as { _openingTween: { running: boolean } })._openingTween.running).toBe(false);
  });

  it("stands a rectangle room's walls up, and leaves its dividers on the floor", async () => {
    const nook = {
      id: "nook",
      points: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 120 }, { x: 0, y: 120 }],
      sideWalls: { right: "wall", bottom: "divider" },
    };
    const { root } = await mount({ areas: [...config().areas!, nook] } as Partial<FloorplanCardConfig>);
    expect(root.querySelector('.fp-iso-wall[data-id="area-wall-nook-right"]')).not.toBeNull();
    expect(root.querySelector('.fp-iso-wall[data-id="area-wall-nook-bottom"]')).toBeNull();
    // The divider is still drawn, as the dashed line it is in the flat view.
    expect(root.querySelector('.fp-wall[data-id="area-wall-nook-bottom"]')).not.toBeNull();
    expect(root.querySelector('.fp-wall[data-id="area-wall-nook-right"]')).toBeNull();
  });
});
