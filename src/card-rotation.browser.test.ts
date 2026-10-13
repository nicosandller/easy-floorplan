import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "@vitest/browser/context";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import { emptyConfig, getFloors, type FloorplanCardConfig } from "./types";
import { rafTweenFrames } from "./opening-tween";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

async function mount(extra: Partial<FloorplanCardConfig> = {}) {
  const config: FloorplanCardConfig = { ...emptyConfig("custom:easy-floorplan-card"),
    width: 600, height: 400, view: "3d", showViewControls: true, wallOpacity: .5, ...extra };
  const floor = getFloors(config)[0];
  floor.walls = [
    { id: "north", x1: 0, y1: 0, x2: 600, y2: 0 },
    { id: "west", x1: 0, y1: 0, x2: 0, y2: 400 },
    { id: "east", x1: 600, y1: 0, x2: 600, y2: 400 },
    { id: "south", x1: 0, y1: 400, x2: 600, y2: 400 },
  ];
  floor.openings = [{ id: "door", type: "door", x: 240, y: 400, angle: 0, length: 70, entity: "binary_sensor.entry" }];
  floor.areas = [{ id: "room", name: "Living", points: [{ x: 60, y: 60 }, { x: 260, y: 60 }, { x: 260, y: 260 }, { x: 60, y: 260 }] }];
  floor.furniture = [{ id: "table", type: "table", x: 190, y: 170, w: 80, h: 60, tap_action: { action: "fire-dom-event" } }];
  floor.items = [{ id: "lamp", kind: "light", entity: "light.lamp", x: 260, y: 270, glow: true, tap_action: { action: "fire-dom-event" } }];
  config.floors = [floor, { ...floor, id: "upper", name: "Upper" }];
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.style.cssText = "display:block;width:760px";
  card.setConfig(config);
  card.hass = { states: {
    "light.lamp": { entity_id: "light.lamp", state: "on", attributes: { brightness: 255 } },
    "binary_sensor.entry": { entity_id: "binary_sensor.entry", state: "off", attributes: { friendly_name: "Entry", device_class: "door" } },
  }, entities: {} } as unknown as FloorplanCard["hass"];
  document.body.append(card);
  await card.updateComplete;
  const root = card.shadowRoot!;
  const button = (label: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const click = async (label: string) => { await userEvent.click(button(label)); await card.updateComplete; };
  // Drive the real animation wiring without depending on machine speed.
  let now = performance.now(), handle = 0;
  const frames = new Map<number, () => void>();
  vi.spyOn(rafTweenFrames, "now").mockImplementation(() => now);
  vi.spyOn(rafTweenFrames, "request").mockImplementation((cb) => { frames.set(++handle, cb); return handle; });
  vi.spyOn(rafTweenFrames, "cancel").mockImplementation((id) => { frames.delete(id); });
  const tick = async (ms: number) => {
    now += ms;
    const due = [...frames.values()];
    frames.clear();
    due.forEach((cb) => cb());
    await card.updateComplete;
  };
  return { card, config, root, click, button, tick, frames };
}

function assertAligned(root: ShadowRoot) {
  const glyph = root.querySelector<SVGGraphicsElement>(".fp-furniture")!;
  const top = new DOMPoint(0, 0).matrixTransform(glyph.getScreenCTM()!);
  const badge = root.querySelector(".fp-furniture-link")!.getBoundingClientRect();
  expect(badge.x + badge.width / 2).toBeCloseTo(top.x, 1);
  expect(badge.y + badge.height / 2).toBeCloseTo(top.y, 1);
  const glow = root.querySelector<SVGGraphicsElement>(".fp-glow")!;
  const light = new DOMPoint(260, 270).matrixTransform(glow.getScreenCTM()!);
  const box = root.querySelector(".fp-item")!.getBoundingClientRect();
  expect(box.x + box.width / 2).toBeCloseTo(light.x, 1);
  expect(box.y + box.height / 2).toBeCloseTo(light.y, 1);
}

describe("animated live 3D rotation", () => {
  it.each(["normal", "line-art"] as const)("keeps %s geometry and overlays aligned throughout all four turns", async (appearance) => {
    const t = await mount({ appearance });
    const saved = JSON.stringify(t.config);
    const changed = vi.fn();
    t.card.addEventListener("config-changed", changed);
    for (const width of [760, 320]) {
      t.card.style.width = `${width}px`;
      const initial = t.root.querySelector(".plan")!.getBoundingClientRect();
      for (let turn = 0; turn < 4; turn++) {
        const before = t.root.querySelector<SVGGraphicsElement>(".fp-furniture")!.getScreenCTM()!.e;
        await t.click("Rotate right");
        expect(t.root.querySelector(".rotating")).not.toBeNull();
        for (let frame = 0; frame < 4; frame++) {
          await t.tick(80);
          assertAligned(t.root);
          const box = t.root.querySelector(".plan")!.getBoundingClientRect();
          expect(box.width).toBeCloseTo(initial.width, 5);
          expect(box.height).toBeCloseTo(initial.height, 5);
          for (const face of t.root.querySelectorAll<SVGPolygonElement>(".fp-iso-wall polygon")) {
            for (const vertex of Array.from(face.points)) {
              const p = new DOMPoint(vertex.x, vertex.y).matrixTransform(face.getScreenCTM()!);
              expect(p.x).toBeGreaterThanOrEqual(box.left - 1);
              expect(p.x).toBeLessThanOrEqual(box.right + 1);
              expect(p.y).toBeGreaterThanOrEqual(box.top - 1);
              expect(p.y).toBeLessThanOrEqual(box.bottom + 1);
            }
          }
        }
        expect(t.root.querySelector<SVGGraphicsElement>(".fp-furniture")!.getScreenCTM()!.e).not.toBe(before);
        await t.tick(500);
        expect(t.root.querySelector(".rotating")).toBeNull();
        assertAligned(t.root);
      }
    }
    expect(t.root.querySelector("output")!.textContent).toBe("0°");
    expect(changed).not.toHaveBeenCalled();
    expect(JSON.stringify(t.config)).toBe(saved);
  });

  it("preserves the selected floor and room and keeps device actions usable during a turn", async () => {
    const t = await mount();
    await userEvent.click(t.root.querySelector<HTMLButtonElement>('button[title="Upper"]')!);
    await t.card.updateComplete;
    const area = t.root.querySelector<SVGGraphicsElement>(".area-tap-target")!;
    const point = new DOMPoint(95, 95).matrixTransform(area.getScreenCTM()!);
    const bounds = area.getBoundingClientRect();
    await userEvent.click(area, { position: { x: point.x - bounds.x, y: point.y - bounds.y } });
    await t.card.updateComplete;
    await t.click("Rotate right");
    // An unrelated HA tick coalescing with RAF must not suppress the motion
    // via shouldUpdate's pure-hass fast path.
    t.card.hass = { ...t.card.hass!, states: { ...t.card.hass!.states } };
    await t.tick(160);
    expect(t.root.querySelector(".floor-switcher button.active")!.getAttribute("title")).toBe("Upper");
    expect(t.root.querySelector(".zoom-out")).not.toBeNull();
    const zoom = t.root.querySelector<HTMLElement>(".plan-zoom")!;
    expect(getComputedStyle(zoom).transitionDuration).toBe("0s");
    assertAligned(t.root);
    const actions = vi.fn();
    t.card.addEventListener("ll-custom", actions);
    await userEvent.click(t.root.querySelector<HTMLElement>(".fp-furniture-link")!);
    expect(actions).toHaveBeenCalledOnce();
    await t.tick(500);
    expect(t.root.querySelector(".zoom-out")).not.toBeNull();
  });

  it("supports keyboard turns, quick reversal and reset during motion", async () => {
    const t = await mount({ rotation: 270 });
    t.button("Rotate right").focus();
    await userEvent.keyboard(" ");
    await t.card.updateComplete;
    await t.tick(120);
    expect(t.root.querySelector("output")!.textContent).toBe("0°");
    await t.click("Rotate right");
    await t.click("Rotate left");
    await t.tick(1000);
    expect(t.root.querySelector("output")!.textContent).toBe("0°");
    await t.click("Rotate left");
    await t.tick(80);
    await t.click("Reset view");
    await t.tick(1000);
    expect(t.root.querySelector("output")!.textContent).toBe("270°");
    expect(t.root.querySelector(".rotating")).toBeNull();
    expect(t.frames.size).toBe(0);
  });

  it("cancels motion on view/config changes and removal, while 2D turns stay immediate", async () => {
    const t = await mount();
    await t.click("Rotate right");
    await t.tick(120);
    await t.click("2D plan");
    expect(t.frames.size).toBe(0);
    await t.click("Rotate right");
    expect(t.root.querySelector("output")!.textContent).toBe("180°");
    expect(t.frames.size).toBe(0);
    await t.click("3D isometric");
    await t.click("Rotate right");
    t.card.setConfig({ ...t.config, rotation: 90 });
    await t.card.updateComplete;
    expect(t.root.querySelector("output")!.textContent).toBe("90°");
    expect(t.frames.size).toBe(0);
    await t.click("Rotate right");
    t.card.remove();
    expect(t.frames.size).toBe(0);
    document.body.append(t.card);
    await t.card.updateComplete;
    expect(t.root.querySelector("output")!.textContent).toBe("180°");
    expect(t.root.querySelector(".rotating")).toBeNull();
  });

  it("honours reduced motion even when the preference changes during a turn", async () => {
    const match = window.matchMedia.bind(window);
    const motion = Object.assign(new EventTarget(), { matches: false });
    vi.spyOn(window, "matchMedia").mockImplementation((q) => q.includes("prefers-reduced-motion")
      ? motion as MediaQueryList : match(q));
    const t = await mount();
    await t.click("Rotate right");
    await t.tick(100);
    motion.matches = true;
    motion.dispatchEvent(Object.assign(new Event("change"), { matches: true }));
    await t.card.updateComplete;
    expect(t.root.querySelector(".rotating")).toBeNull();
    expect(t.frames.size).toBe(0);
    await t.click("Rotate right");
    expect(t.root.querySelector("output")!.textContent).toBe("180°");
    expect(t.frames.size).toBe(0);
  });

  it("settles at the orientation-specific destination if the screen turns mid-orbit", async () => {
    const match = window.matchMedia.bind(window);
    const orientation = Object.assign(new EventTarget(), { matches: false });
    vi.spyOn(window, "matchMedia").mockImplementation((q) => q.includes("orientation: portrait")
      ? orientation as MediaQueryList : match(q));
    const t = await mount({ rotationLandscape: 0, rotationPortrait: 270 });
    await t.click("Rotate right");
    await t.tick(100);
    orientation.matches = true;
    orientation.dispatchEvent(Object.assign(new Event("change"), { matches: true }));
    await t.card.updateComplete;
    expect(t.root.querySelector("output")!.textContent).toBe("0°");
    expect(t.root.querySelector(".rotating")).toBeNull();
    expect(t.frames.size).toBe(0);
    await t.click("Reset view");
    expect(t.root.querySelector("output")!.textContent).toBe("270°");
  });
});
