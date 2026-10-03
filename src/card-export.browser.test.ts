import { afterEach, describe, expect, it, vi } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import { emptyConfig } from "./types";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("SVG export control", () => {
  it("is opt-in and stays below the canvas at desktop and phone widths", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    host.append(card);
    const config = emptyConfig("custom:easy-floorplan-card");
    card.setConfig(config);
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector(".export-bar")).toBeNull();
    card.setConfig({ ...config, showExport: true });
    await card.updateComplete;
    const button = card.shadowRoot!.querySelector<HTMLButtonElement>(".export-bar button")!;
    expect(button.textContent).toBe("Export SVG");
    for (const width of [900, 320]) {
      host.style.width = `${width}px`;
      const stage = card.shadowRoot!.querySelector(".stage")!.getBoundingClientRect();
      const box = button.getBoundingClientRect();
      expect(box.top).toBeGreaterThanOrEqual(stage.bottom);
      expect(box.right).toBeLessThanOrEqual(host.getBoundingClientRect().right);
      expect(stage.width).toBeCloseTo(width);
    }
  });
});
