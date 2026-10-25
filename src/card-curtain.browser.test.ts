/**
 * A centre-closing curtain (issue #196) as the card and the editor draw it.
 *
 * The node suite covers the geometry of the two halves. What it cannot see is
 * where the card puts the piece's tap icon — which must not float over the
 * gap once both halves are gathered — and whether the editor previews the
 * pair rather than one curtain gathered on the left.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import "./editor";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardEditor } from "./editor";
import type { FloorplanCardConfig, Furniture } from "./types";

afterEach(() => { document.body.innerHTML = ""; });

const curtain: Furniture = {
  id: "curtain", type: "curtain", x: 250, y: 100, w: 200, h: 12, hand: "center",
  entity: "cover.curtain", tap_action: { action: "toggle" },
};

const config = (): FloorplanCardConfig => ({
  type: "custom:easy-floorplan-card", width: 500, height: 200,
  floors: [{ id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [],
    furniture: [curtain], trackers: [], areas: [] }],
} as unknown as FloorplanCardConfig);

const hass = {
  states: {
    "cover.curtain": { entity_id: "cover.curtain", state: "open", attributes: { current_position: 100 } },
  },
  entities: {},
};

describe("centre curtain (issue #196)", () => {
  it("keeps its tap icon on a gathered half, not over the gap", async () => {
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    card.style.display = "block";
    card.style.width = "500px";
    card.setConfig(config());
    card.hass = hass as unknown as FloorplanCard["hass"];
    document.body.append(card);
    await card.updateComplete;
    expect(card.shadowRoot!.querySelectorAll(".fp-furniture-curtain")).toHaveLength(2);
    const link = card.shadowRoot!.querySelector<HTMLElement>(".fp-furniture-link")!;
    // The left half gathers at x 150..164 of a 500-wide plan; the gap is at 50%.
    const left = parseFloat(link.style.left);
    expect(left).toBeGreaterThan(29);
    expect(left).toBeLessThan(34);
  });

  it("previews as the pair in the editor, at full size", async () => {
    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = hass as unknown as FloorplanCardEditor["hass"];
    ed.setConfig(config());
    document.body.append(ed);
    await ed.updateComplete;
    const halves = ed.shadowRoot!.querySelectorAll<SVGGElement>(".furn-hit .fp-furniture-curtain");
    expect(halves).toHaveLength(2);
    const [l, r] = [...halves].map((g) => g.getAttribute("transform"));
    expect(l).toContain("translate(200 100)");
    expect(r).toContain("translate(300 100)");
    expect(r).toContain("scale(-1 1)");
  });
});
