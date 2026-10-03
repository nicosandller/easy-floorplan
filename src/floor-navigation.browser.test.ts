import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "@vitest/browser/context";
import "./floorplan-card";
import "./editor";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardEditor } from "./editor";
import type { FloorplanCardConfig, Furniture } from "./types";

let seq = 0;
function config(target: Furniture["goToFloor"] = "top"): FloorplanCardConfig {
  const suffix = seq++;
  return {
    type: "custom:easy-floorplan-card", width: 400, height: 200,
    defaultFloor: `ground-${suffix}`,
    floors: ["Cellar", "Ground", "Loft"].map((name) => ({
      id: `${name.toLowerCase()}-${suffix}`, name,
      walls: [], openings: [], items: [], trackers: [], areas: [],
      texts: [{ id: "label", x: 50, y: 50, text: name }],
      furniture: [{ id: "stairs", type: "stairs", x: 200, y: 100, w: 60, h: 80, goToFloor: target }],
    })),
  };
}

async function mount(c: FloorplanCardConfig) {
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.style.cssText = "display: block; width: 600px; height: 300px";
  card.setConfig(c);
  card.hass = { states: {}, entities: {} } as FloorplanCard["hass"];
  document.body.append(card);
  await card.updateComplete;
  const root = card.shadowRoot!;
  return {
    card, root,
    floor: () => root.querySelector(".fp-text")?.textContent?.trim(),
    link: () => root.querySelector<HTMLElement>(".fp-furniture-link"),
    async switchTo(name: string) {
      root.querySelector<HTMLButtonElement>(`.floor-switcher button[title="${name}"]`)!.click();
      await card.updateComplete;
    },
  };
}

afterEach(() => { document.body.innerHTML = ""; });

describe("direct floor navigation on the card", () => {
  it.each([
    ["top", "Cellar", "Loft", "mdi:stairs-up"],
    ["bottom", "Loft", "Cellar", "mdi:stairs-down"],
    ["main", "Loft", "Ground", "mdi:stairs-down"],
  ] as const)("taps %s to skip straight to %s / %s", async (target, start, end, icon) => {
    const t = await mount(config(target));
    await t.switchTo(start);
    expect(t.link()!.getAttribute("aria-label")).toBe(`Go to ${end}`);
    expect(t.link()!.querySelector("ha-icon")?.getAttribute("icon")).toBe(icon);
    await userEvent.click(t.link()!);
    await t.card.updateComplete;
    expect(t.floor()).toBe(end);
    expect(t.link()).toBeNull(); // Already at this destination.
  });

  it.each(["Enter", " "])("activates a specific floor with the %j key", async (key) => {
    const c = config();
    c.floors![1].furniture[0].goToFloor = { floor: c.floors![0].id };
    const t = await mount(c);
    expect(t.link()!.getAttribute("aria-label")).toBe("Go to Cellar");
    t.link()!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await t.card.updateComplete;
    expect(t.floor()).toBe("Cellar");
  });

  it("drops a deleted destination and restores it when the floor returns", async () => {
    const c = config();
    c.floors![1].furniture[0].goToFloor = { floor: c.floors![2].id };
    const t = await mount(c);
    expect(t.link()).not.toBeNull();
    t.card.setConfig({ ...c, floors: c.floors!.slice(0, 2) });
    await t.card.updateComplete;
    expect(t.link()).toBeNull();
    t.card.setConfig(c);
    await t.card.updateComplete;
    expect(t.link()!.getAttribute("aria-label")).toBe("Go to Loft");
  });

  it("keeps tap action precedence and a hold action alongside a direct destination", async () => {
    const c = config("bottom");
    c.floors![1].furniture[0].hold_action = { action: "fire-dom-event" };
    const t = await mount(c);
    let held = 0;
    t.card.addEventListener("ll-custom", () => { held++; });
    t.link()!.dispatchEvent(new CustomEvent("action", { detail: { action: "hold" } }));
    expect(held).toBe(1);
    expect(t.floor()).toBe("Ground");
    c.floors![1].furniture[0].tap_action = { action: "none" };
    t.card.setConfig(c);
    await t.card.updateComplete;
    expect(t.link()!.getAttribute("role")).toBe("group");
    expect(t.link()!.getAttribute("title")).not.toContain("Go to");
    t.link()!.dispatchEvent(new CustomEvent("action", { detail: { action: "tap" } }));
    await t.card.updateComplete;
    expect(t.floor()).toBe("Ground");
  });
});

describe("editing floor destinations", () => {
  it("lists the plan's floors, saves an explicit destination, and clears it", async () => {
    const c = config();
    const editor = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    editor.style.cssText = "display: block; width: 900px";
    editor.setConfig(c);
    document.body.append(editor);
    await editor.updateComplete;
    // Selection gestures have their own suite; here the real form and commit
    // path must agree about the selector value and the serialized target.
    (editor as unknown as { _selection: unknown[] })._selection = [{ kind: "furniture", id: "stairs" }];
    editor.requestUpdate();
    await editor.updateComplete;
    const root = editor.shadowRoot!;
    const group = [...root.querySelectorAll<HTMLButtonElement>(".cfg-group-title")]
      .find((b) => b.textContent?.trim().startsWith("Behavior"))!;
    group.click();
    await editor.updateComplete;
    const select = () => [...root.querySelectorAll<HTMLSelectElement>("select")]
      .find((s) => s.parentElement?.querySelector("label")?.textContent === "Go to floor")!;
    expect([...select().options].map((o) => o.value)).toContain(`floor:${c.floors![2].id}`);
    const emitted: FloorplanCardConfig[] = [];
    editor.addEventListener("config-changed", (ev) => {
      emitted.push((ev as CustomEvent<{ config: FloorplanCardConfig }>).detail.config);
    });
    const change = async (value: string) => {
      select().value = value;
      select().dispatchEvent(new Event("change", { bubbles: true }));
      await editor.updateComplete;
    };
    await change(`floor:${c.floors![2].id}`);
    const savedTarget = () => emitted[emitted.length - 1].floors![1].furniture[0].goToFloor;
    expect(savedTarget()).toEqual({ floor: c.floors![2].id });
    expect(select().value).toBe(`floor:${c.floors![2].id}`);
    await change("main");
    expect(savedTarget()).toBe("main");
    await change("");
    expect(savedTarget()).toBeUndefined();
  });
});
