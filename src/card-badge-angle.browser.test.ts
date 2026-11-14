import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import { emptyConfig, getFloors, type FloorplanCardConfig } from "./types";

afterEach(() => { document.body.replaceChildren(); });

async function mount(rotation: number) {
  const config: FloorplanCardConfig = { ...emptyConfig("custom:easy-floorplan-card"), width: 600, height: 400, rotation };
  const floor = getFloors(config)[0];
  floor.items = [
    { id: "strip", kind: "light", entity: "light.strip", x: 200, y: 200, angle: 45 },
    { id: "lamp", kind: "light", entity: "light.lamp", x: 400, y: 200 },
  ];
  floor.texts = [{ id: "note", text: "Hall", x: 300, y: 300, angle: 30 }];
  config.floors = [floor];
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.style.cssText = "display:block;width:600px";
  card.setConfig(config);
  card.hass = { states: {
    "light.strip": { entity_id: "light.strip", state: "on", attributes: {} },
    "light.lamp": { entity_id: "light.lamp", state: "on", attributes: {} },
  }, entities: {} } as unknown as FloorplanCard["hass"];
  document.body.append(card);
  await card.updateComplete;
  const root = card.shadowRoot!;
  const badge = (id: string) => root.querySelector<HTMLElement>(`.fp-item[data-id="${id}"] .badge`)!.style.transform;
  return { badge, text: root.querySelector<HTMLElement>(".fp-text")!.style.transform };
}

describe("badge angle under a rotated display (issue #387)", () => {
  it("turns an angled badge and text with the plan, text kept readable, and keeps the rest upright", async () => {
    const flat = await mount(0);
    expect(flat.badge("strip")).toBe("rotate(45deg)");
    expect(flat.badge("lamp")).toBe("rotate(0deg)");
    document.body.replaceChildren();
    const turned = await mount(270);
    expect(turned.badge("strip")).toBe("rotate(315deg)");
    expect(turned.badge("lamp")).toBe("rotate(0deg)");
    expect(turned.text).toContain("rotate(-60deg)");
  });
});
