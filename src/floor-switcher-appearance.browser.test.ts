import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig } from "./types";

let seq = 0;
async function mount(extra: Partial<FloorplanCardConfig> = {}, count = 3, width = 600) {
  const host = document.createElement("div");
  host.style.cssText = `width:${width}px;height:400px;--primary-color:#2468ac;
    --primary-text-color:#223344;--card-background-color:#f5f6f7;--text-primary-color:#ffffff;`;
  document.body.append(host);
  const floors = Array.from({ length: count }, (_, i) => ({
    id: `appearance-${seq}-${i}`, name: `Floor ${i + 1}`, short: `F${i + 1}`,
    color: i === 0 ? "#aabbcc" : undefined,
    walls: [], openings: [], items: [], furniture: [], trackers: [], areas: [],
    texts: [{ id: `label-${i}`, text: `Inside floor ${i + 1}`, x: 100, y: 100 }],
  }));
  seq++;
  const config = {
    type: "custom:easy-floorplan-card", width: 400, height: 300, floors, ...extra,
  } as FloorplanCardConfig;
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config);
  card.hass = { states: {}, entities: {} } as FloorplanCard["hass"];
  host.append(card);
  await card.updateComplete;
  const root = card.shadowRoot!;
  const switcher = root.querySelector<HTMLElement>(".floor-switcher");
  const buttons = () => [...root.querySelectorAll<HTMLButtonElement>(".floor-switcher button")];
  return { host, card, config, root, switcher, buttons };
}

afterEach(() => { document.body.replaceChildren(); });

describe("floor switcher appearance", () => {
  it("keeps the classic appearance and per-floor accent by default", async () => {
    const t = await mount();
    expect(getComputedStyle(t.switcher!).flexDirection).toBe("column");
    const style = getComputedStyle(t.buttons()[0]);
    expect(style.borderRadius).toBe("6px");
    expect(style.fontSize).toBe("12px");
    expect(style.padding).toBe("4px 8px");
    expect(style.backgroundColor).toBe("rgb(170, 187, 204)");
    expect(style.borderTopColor).toBe("rgb(170, 187, 204)");
    expect(t.switcher!.getAttribute("style")).toBeNull();
  });

  it("uses the dashboard theme for the button preset, independently of the plan skin", async () => {
    const t = await mount({ floorSwitcher: { style: "buttons" }, skin: "tron" });
    const inactive = getComputedStyle(t.buttons()[1]);
    expect(inactive.backgroundColor).toBe("rgb(245, 246, 247)");
    expect(inactive.color).toBe("rgb(34, 51, 68)");
    expect(inactive.borderRadius).toBe("12px");
    expect(inactive.boxShadow).toBe("none");
    expect(t.buttons()[1].getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    t.buttons()[1].click();
    await t.card.updateComplete;
    expect(getComputedStyle(t.buttons()[1]).backgroundColor).toBe("rgb(36, 104, 172)");
  });

  it.each([
    [false, undefined, "column"], [true, undefined, "row"],
    [false, "horizontal", "row"], [true, "vertical", "column"],
    [true, "auto", "row"], [false, "unknown", "column"],
  ])("resolves compact=%s and layout=%s to %s", async (compact, layout, direction) => {
    const t = await mount({ compactHeader: compact as boolean, floorSwitcher: { layout } as never });
    expect(getComputedStyle(t.switcher!).flexDirection).toBe(direction);
  });

  it("keeps full accessible names, selection state and floor navigation with short labels", async () => {
    const t = await mount({ floorSwitcher: { style: "buttons" } });
    expect(t.switcher!.getAttribute("aria-label")).toBe("Select floor");
    expect(t.buttons()[1].textContent?.trim()).toBe("F2");
    expect(t.buttons()[1].getAttribute("aria-label")).toBe("Floor 2");
    expect(t.buttons()[0].getAttribute("aria-pressed")).toBe("true");
    t.buttons()[1].focus();
    t.buttons()[1].click();
    await t.card.updateComplete;
    expect(t.buttons().map(b => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    expect(t.root.querySelector(".fp-text")?.textContent?.trim()).toBe("Inside floor 2");
    expect(t.root.activeElement).toBe(t.buttons()[1]);
    expect(t.buttons()[1].part.contains("floor-button-active")).toBe(true);
    expect(t.buttons()[0].part.contains("floor-button-active")).toBe(false);
  });

  it("lets inherited appearance variables override both the preset and per-floor colors", async () => {
    const t = await mount({ floorSwitcher: { style: "buttons" } });
    const haCard = t.root.querySelector<HTMLElement>("ha-card")!;
    // The same placement as the documented card-mod example.
    haCard.style.cssText = `--fp-floor-switcher-background:#123456;
      --fp-floor-switcher-color:#ffffff;--fp-floor-switcher-active-background:#fedcba;
      --fp-floor-switcher-active-color:#102030;--fp-floor-switcher-active-border-color:#654321;
      --fp-floor-switcher-border-radius:24px;--fp-floor-switcher-gap:12px;
      --fp-floor-switcher-padding:8px 20px;--fp-floor-switcher-font-size:16px;`;
    const active = getComputedStyle(t.buttons()[0]);
    const inactive = getComputedStyle(t.buttons()[1]);
    expect(active.backgroundColor).toBe("rgb(254, 220, 186)");
    expect(active.borderTopColor).toBe("rgb(101, 67, 33)");
    expect(active.color).toBe("rgb(16, 32, 48)");
    expect(active.borderRadius).toBe("24px");
    expect(inactive.backgroundColor).toBe("rgb(18, 52, 86)");
    expect(inactive.color).toBe("rgb(255, 255, 255)");
    expect(inactive.padding).toBe("8px 20px");
    expect(inactive.fontSize).toBe("16px");
    expect(getComputedStyle(t.switcher!).gap).toBe("12px");
  });

  it("allows a complete CSS override through parts and per-floor selectors without !important", async () => {
    const t = await mount();
    const outerStyle = document.createElement("style");
    outerStyle.textContent = `easy-floorplan-card::part(floor-button-active) {
      background: rgb(1, 2, 3); border-radius: 0;
    }`;
    t.host.append(outerStyle);
    expect(getComputedStyle(t.buttons()[0]).backgroundColor).toBe("rgb(1, 2, 3)");
    expect(getComputedStyle(t.buttons()[0]).borderRadius).toBe("0px");
    outerStyle.remove();
    const innerStyle = document.createElement("style");
    innerStyle.textContent = `.floor-switcher [data-floor-id="${t.config.floors![0].id}"] {
      background: rgb(4, 5, 6); border: 0; box-shadow: none;
    }`;
    t.root.append(innerStyle);
    expect(getComputedStyle(t.buttons()[0]).backgroundColor).toBe("rgb(4, 5, 6)");
    expect(getComputedStyle(t.buttons()[0]).borderTopWidth).toBe("0px");
  });

  it("wraps many dashboard buttons inside a narrow plan", async () => {
    const t = await mount({ floorSwitcher: { style: "buttons", layout: "horizontal" } }, 8, 320);
    const plan = t.root.querySelector(".plan")!.getBoundingClientRect();
    const boxes = t.buttons().map(b => b.getBoundingClientRect());
    expect(new Set(boxes.map(b => b.top)).size).toBeGreaterThan(1);
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(plan.left);
      expect(box.right).toBeLessThanOrEqual(plan.right);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  it("keeps a placed row centred with a compact title and rotation", async () => {
    const t = await mount({ title: "Home", compactHeader: true, rotation: 90,
      floorSwitcher: { style: "buttons", layout: "horizontal", x: 120, y: 100 } });
    const plan = t.root.querySelector(".plan")!.getBoundingClientRect();
    const box = t.switcher!.getBoundingClientRect();
    expect((box.left + box.width / 2 - plan.left) / plan.width).toBeCloseTo(2 / 3, 2);
    expect((box.top + box.height / 2 - plan.top) / plan.height).toBeCloseTo(0.3, 2);
  });

  it("falls back on unknown presets and rejects injected floor colors", async () => {
    const t = await mount({ floorSwitcher: { style: "unknown" } as never });
    t.config.floors![0].color = "red;position:fixed";
    t.card.setConfig(t.config);
    await t.card.updateComplete;
    expect(t.buttons()[0].getAttribute("style")).toBeNull();
    expect(getComputedStyle(t.buttons()[0]).backgroundColor).toBe("rgb(36, 104, 172)");
    expect(getComputedStyle(t.buttons()[0]).fontSize).toBe("12px");
  });

  it("does not draw a switcher for one floor even with a preset", async () => {
    expect((await mount({ floorSwitcher: { style: "buttons" } }, 1)).switcher).toBeNull();
  });
});
