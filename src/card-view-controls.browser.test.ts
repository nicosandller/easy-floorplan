import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "@vitest/browser/context";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import { emptyConfig, getFloors, newPlanConfig, type FloorplanCardConfig } from "./types";
import { projectDisplayForm } from "./editor-forms";

beforeEach(() => {
  const match = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query) =>
    query.includes("prefers-reduced-motion") ? { ...match(query), matches: true } : match(query));
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

async function mount(extra: Partial<FloorplanCardConfig> = {}) {
  const config = { ...emptyConfig("custom:easy-floorplan-card"), width: 600, height: 400,
    view: "3d", showViewControls: true, wallOpacity: .4, ...extra } as FloorplanCardConfig;
  const floor = getFloors(config)[0];
  floor.walls = [{id:"north",x1:70,y1:70,x2:530,y2:70}];
  floor.openings = [{id:"entry",type:"door",x:240,y:70,angle:0,length:70,entity:"binary_sensor.entry"}];
  floor.areas = [{ id:"room",name:"Living",points:[{x:70,y:70},{x:320,y:70},{x:320,y:320},{x:70,y:320}],color:"#abcd99" }];
  floor.furniture = [{ id:"table",type:"table",x:190,y:170,w:80,h:60,tap_action:{action:"fire-dom-event"} }];
  floor.items = [{ id:"lamp",kind:"light",entity:"light.lamp",x:260,y:270,glow:true,tap_action:{action:"fire-dom-event"} }];
  config.floors = [floor];
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.style.cssText = "display:block;width:760px;--primary-text-color:#334455;--card-background-color:#fafafa";
  card.setConfig(config);
  document.body.append(card);
  const states = (open = false, light = true) => ({ states: {
    "binary_sensor.entry": {entity_id:"binary_sensor.entry",state:open?"on":"off",attributes:{friendly_name:"Entry",device_class:"door"}},
    "light.lamp": {entity_id:"light.lamp",state:light?"on":"off",attributes:{friendly_name:"Lamp",brightness:255}},
    "sun.sun": {entity_id:"sun.sun",state:"below_horizon",attributes:{elevation:-15,azimuth:90}},
  }, entities:{}, formatEntityState: (s: {state:string}) => s.state }) as unknown as FloorplanCard["hass"];
  card.hass = states();
  await card.updateComplete;
  const root = card.shadowRoot!;
  const button = (name: string) => [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((b) => (b.getAttribute("aria-label") || b.textContent?.trim()) === name)!;
  const click = async (name: string) => { await userEvent.click(button(name)); await card.updateComplete; };
  return { card, root, config, floor, button, click, states };
}

describe("live view controls", () => {
  it("is discoverable on new cards, optional on older cards, and editable without YAML", async () => {
    expect(newPlanConfig().showViewControls).toBe(true);
    const t = await mount({ showViewControls: undefined });
    expect(t.root.querySelector(".view-controls")).toBeNull();
    const form = projectDisplayForm(t.config);
    expect(form.data.appearance).toBe("normal");
    expect(form.data.showViewControls).toBe(false);
    const patch = form.toPatch({appearance:"line-art",showViewControls:true});
    t.card.setConfig({...t.config,...patch});
    await t.card.updateComplete;
    expect(t.button("Line art").getAttribute("aria-pressed")).toBe("true");
    expect(t.root.querySelector(".line-art")).not.toBeNull();
  });

  it("switches architecture while leaving live doors, device actions and room zoom intact", async () => {
    const t = await mount();
    const before = JSON.stringify(t.config);
    const changes = vi.fn();
    t.card.addEventListener("config-changed", changes);
    await t.click("Line art");
    expect(t.root.querySelector(".solid-edges")).not.toBeNull();
    expect(getComputedStyle(t.root.querySelector(".fp-iso-face")!).fill).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(t.root.querySelector(".fp-iso-wall")!).opacity).toBe("1");
    const shut = t.root.querySelector(".fp-iso-panel")!.getAttribute("points");
    t.card.hass = t.states(true, false);
    await t.card.updateComplete;
    expect(t.root.querySelector(".fp-iso-panel")!.getAttribute("points")).not.toBe(shut);
    expect(t.root.querySelector(".fp-glow")).toBeNull();
    const actions = vi.fn();
    t.card.addEventListener("ll-custom", actions);
    await userEvent.click(t.root.querySelector<HTMLElement>('.fp-item[data-id="lamp"]')!);
    expect(actions).toHaveBeenCalledTimes(1);
    // Linework must pass hit testing through to its room.
    const glyph = t.root.querySelector<SVGGraphicsElement>(".fp-furniture")!;
    const p = new DOMPoint(30, 10).matrixTransform(glyph.getScreenCTM()!);
    const target = t.root.elementFromPoint(p.x,p.y)!;
    expect(target.closest(".area-tap-target")).not.toBeNull();
    await userEvent.click(target);
    await t.card.updateComplete;
    expect(t.root.querySelector(".zoom-out")).not.toBeNull();
    await t.click("Normal");
    expect(t.root.querySelector(".solid-edges")).toBeNull();
    expect(t.root.querySelector(".zoom-out")).not.toBeNull();
    expect(changes).not.toHaveBeenCalled();
    expect(JSON.stringify(t.config)).toBe(before);
  });

  it("keeps overlays on their geometry through view changes and all four rotations", async () => {
    const t = await mount({ appearance:"line-art" });
    for (const view of ["2D plan", "3D isometric"]) {
      await t.click(view);
      for (let i=0;i<4;i++) {
        const glyph = t.root.querySelector<SVGGraphicsElement>(".fp-furniture")!;
        const point = new DOMPoint(0,0).matrixTransform(glyph.getScreenCTM()!);
        const badge = t.root.querySelector(".fp-furniture-link")!.getBoundingClientRect();
        expect(badge.x+badge.width/2).toBeCloseTo(point.x,1);
        expect(badge.y+badge.height/2).toBeCloseTo(point.y,1);
        await t.click("Rotate right");
      }
    }
    expect(t.root.querySelector("output")!.textContent).toBe("0°");
  });

  it("preserves viewer choices across unrelated config updates and resets to the saved defaults", async () => {
    const t = await mount({rotation:90});
    await t.click("2D plan");
    await t.click("Line art");
    await t.click("Rotate left");
    t.card.setConfig({...t.config,title:"Renamed"});
    await t.card.updateComplete;
    expect(t.button("2D plan").getAttribute("aria-pressed")).toBe("true");
    expect(t.button("Line art").getAttribute("aria-pressed")).toBe("true");
    expect(t.root.querySelector("output")!.textContent).toBe("0°");
    await t.click("Reset view");
    expect(t.button("3D isometric").getAttribute("aria-pressed")).toBe("true");
    expect(t.button("Normal").getAttribute("aria-pressed")).toBe("true");
    expect(t.root.querySelector("output")!.textContent).toBe("90°");
    expect(t.button("Reset view").disabled).toBe(true);
    await t.click("Line art");
    t.card.setConfig({...t.config,showViewControls:false});
    await t.card.updateComplete;
    expect(t.root.querySelector(".line-art")).toBeNull();
  });

  it("restores environmental shading and custom colours when Normal is selected", async () => {
    const t = await mount({sunDimming:true,background:"#123456",skin:"tron"});
    expect(t.root.querySelector(".fp-sun-dim")).not.toBeNull();
    await t.click("Line art");
    expect(t.root.querySelector(".fp-sun-dim")).toBeNull();
    expect(getComputedStyle(t.root.querySelector(".plan")!).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(t.root.querySelector(".area-label")!).color).toBe("rgb(40, 52, 62)");
    await t.click("Normal");
    expect(t.root.querySelector(".fp-sun-dim")).not.toBeNull();
    expect(getComputedStyle(t.root.querySelector(".plan")!).backgroundColor).toBe("rgb(18, 52, 86)");
  });

  it("is keyboard operable and wraps below the canvas without clipped touch controls", async () => {
    const t = await mount({showExport:true});
    t.button("Line art").focus();
    await userEvent.keyboard(" ");
    await t.card.updateComplete;
    expect(t.button("Line art").getAttribute("aria-pressed")).toBe("true");
    expect(t.root.activeElement).toBe(t.button("Line art"));
    for (const width of [760,390,320,270,240]) {
      t.card.style.width=`${width}px`;
      const stage = t.root.querySelector(".stage")!.getBoundingClientRect();
      const toolbar = t.root.querySelector(".view-controls")!.getBoundingClientRect();
      expect(toolbar.top).toBeGreaterThanOrEqual(stage.bottom);
      for(const button of t.root.querySelectorAll<HTMLButtonElement>(".view-controls button")) {
        const r=button.getBoundingClientRect();
        expect(r.left).toBeGreaterThanOrEqual(toolbar.left);
        expect(r.right).toBeLessThanOrEqual(toolbar.right);
        expect(r.height).toBeGreaterThanOrEqual(44);
        expect(r.width).toBeGreaterThanOrEqual(44);
        const icon = button.querySelector("svg");
        if (icon) {
          const i = icon.getBoundingClientRect();
          expect(i.width).toBe(18);
          expect(i.height).toBe(18);
          expect(i.left).toBeGreaterThan(r.left);
          expect(i.right).toBeLessThan(r.right);
          expect(i.top).toBeGreaterThan(r.top);
          expect(i.bottom).toBeLessThan(r.bottom);
        }
      }
    }
  });
});
