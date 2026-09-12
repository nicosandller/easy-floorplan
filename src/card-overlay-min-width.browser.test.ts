import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig } from "./types";

function config(extra: Partial<FloorplanCardConfig> = {}): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card", width: 1000, height: 600,
    overlayScale: "plan", overlayMinWidth: 800,
    floors: [{ id: "ground", name: "Ground", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [],
      areas: [{ id: "room", name: "Room", labelSize: 20,
        points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 600 }, { x: 0, y: 600 }] }],
    }], ...extra,
  } as FloorplanCardConfig;
}

async function mount(extra: Partial<FloorplanCardConfig> = {}) {
  const host = document.createElement("div");
  host.style.cssText = "width: 500px; height: 1200px";
  document.body.append(host);
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config(extra));
  card.hass = { states: {}, entities: {} } as FloorplanCard["hass"];
  host.append(card);
  await card.updateComplete;
  const root = card.shadowRoot!;
  const font = () => parseFloat(getComputedStyle(root.querySelector(".area-label")!).fontSize);
  const width = () => root.querySelector(".plan")!.getBoundingClientRect().width;
  return { host, card, font, width };
}

afterEach(() => { document.body.innerHTML = ""; });
describe("overlay minimum in real CSS layout", () => {
  it("holds the minimum below the threshold and resumes scaling above it", async () => {
    const t = await mount();
    expect(t.width()).toBeLessThan(800);
    expect(t.font()).toBeCloseTo(16, 1);
    t.host.style.width = "400px";
    expect(t.font()).toBeCloseTo(16, 1);
    t.host.style.width = "1000px";
    expect(t.width()).toBeGreaterThan(800);
    expect(t.font()).toBeCloseTo(20 * t.width() / 1000, 1);
  });
  it("removes the minimum when cleared and ignores it in fixed mode", async () => {
    const t = await mount();
    t.card.setConfig(config({ overlayMinWidth: undefined }));
    await t.card.updateComplete;
    expect(t.font()).toBeCloseTo(20 * t.width() / 1000, 1);
    t.card.setConfig(config({ overlayScale: "fixed" }));
    await t.card.updateComplete;
    expect(t.font()).toBeCloseTo(20, 1);
  });
  it("divides by the displayed canvas width after rotation", async () => {
    const t = await mount({ rotation: 90 });
    expect(t.width()).toBeLessThan(800);
    expect(t.font()).toBeCloseTo(20 * 800 / 600, 1);
  });
});
