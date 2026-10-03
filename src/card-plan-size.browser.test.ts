import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig } from "./types";

async function mount(extra: Partial<FloorplanCardConfig> = {}) {
  const host = document.createElement("div");
  host.style.cssText = "width: 600px; height: 400px";
  document.body.append(host);
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig({
    type: "custom:easy-floorplan-card", width: 400, height: 200,
    floors: [{
      id: "ground", name: "Ground", walls: [], openings: [], furniture: [], texts: [], trackers: [],
      image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200'%3E%3Crect width='400' height='200' fill='teal'/%3E%3C/svg%3E",
      items: [{ id: "lamp", kind: "light", x: 100, y: 60 }],
    }],
    ...extra,
  } as FloorplanCardConfig);
  host.append(card);
  await card.updateComplete;
  const root = card.shadowRoot!;
  return { host, root, plan: root.querySelector<HTMLElement>(".plan")! };
}

afterEach(() => { document.body.innerHTML = ""; });

describe("plan sizing with and without container query units (issue #339)", () => {
  it.each([
    { view: "2d", rotation: 0 },
    { view: "2d", rotation: 90 },
    { view: "3d", rotation: 0 },
  ] as const)("keeps the image and badge aligned without cqh: %j", async (extra) => {
    const { host, root, plan } = await mount(extra);
    // Make the real CSS parser reject the unit, as pre-container-unit WebViews
    // do. Keep all other card styles and its actual SVG/HTML layers in place.
    // This tests the fallback layout, not an emulation of an Android device.
    // Check that the width is actually invalidated so a future style rewrite
    // cannot silently stop exercising the fallback.
    expect(plan.style.width).toContain("cqh");
    plan.setAttribute("style", plan.getAttribute("style")!.replaceAll("cqh", "unsupported"));
    expect(plan.style.width).toBe("");
    root.querySelector<HTMLElement>(".stage")!.style.setProperty("container-type", "normal");
    for (const width of [600, 320]) {
      host.style.width = `${width}px`;
      const box = plan.getBoundingClientRect();
      expect(box.width).toBeCloseTo(width, 0);
      expect(box.height).toBeGreaterThan(0);
      const image = root.querySelector<SVGImageElement>("image")!;
      expect(image.getBoundingClientRect().width).toBeGreaterThan(0);
      expect(image.getBoundingClientRect().height).toBeGreaterThan(0);
      const point = new DOMPoint(100, 60).matrixTransform(image.getScreenCTM()!);
      const badge = root.querySelector<HTMLElement>(".fp-item")!;
      expect(box.left + parseFloat(badge.style.left) * box.width / 100).toBeCloseTo(point.x, 1);
      expect(box.top + parseFloat(badge.style.top) * box.height / 100).toBeCloseTo(point.y, 1);
    }
  });

  it("still fits a height-limited card when container units are supported", async () => {
    const { host, plan } = await mount();
    host.style.height = "150px";
    const box = plan.getBoundingClientRect();
    expect(box.width).toBeCloseTo(300, 0);
    expect(box.height).toBeCloseTo(150, 0);
  });
});
