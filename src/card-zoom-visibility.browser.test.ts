/**
 * "Only show when zoomed" on a mounted card (issue #222).
 *
 * `itemHiddenUntilZoomed` is covered in the node suite, where the rule can be
 * asked about a room directly. What it cannot cover is the half that decides
 * whether any of it reaches the screen: that the card hands the rule the room
 * it is actually zoomed to, that the device leaves the DOM rather than merely
 * going transparent, and that tapping the room is what brings it back. The
 * node suite cannot import `floorplan-card.ts` at all — defining a custom
 * element needs a DOM — so this lives here.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig } from "./types";

const LIVING = {
  id: "a1",
  name: "Living",
  points: [
    { x: 100, y: 100 },
    { x: 500, y: 100 },
    { x: 500, y: 400 },
    { x: 100, y: 400 },
  ],
};

const config: FloorplanCardConfig = {
  type: "custom:easy-floorplan-card",
  width: 1000,
  height: 600,
  floors: [
    {
      id: "f1",
      name: "Floor 1",
      walls: [],
      openings: [],
      texts: [],
      furniture: [],
      trackers: [],
      areas: [LIVING],
      items: [
        { id: "inside", kind: "sensor", x: 300, y: 250, showOnlyWhenZoomed: true },
        { id: "outside", kind: "sensor", x: 900, y: 550, showOnlyWhenZoomed: true },
        { id: "assigned", kind: "sensor", x: 900, y: 500, showOnlyWhenZoomed: true, area: "Living" },
        { id: "ordinary", kind: "sensor", x: 300, y: 260 },
      ],
    },
  ],
} as unknown as FloorplanCardConfig;

async function mount() {
  const host = document.createElement("div");
  host.style.width = "900px";
  host.style.height = "540px";
  document.body.appendChild(host);

  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config);
  card.hass = {
    states: {},
    entities: {},
    formatEntityState: (st: { state: string }) => st.state,
  } as unknown as FloorplanCard["hass"];
  host.appendChild(card);
  await card.updateComplete;

  const root = card.shadowRoot!;
  return {
    card,
    drawn: () =>
      [...root.querySelectorAll(".fp-item")].map((e) => e.getAttribute("data-id")).sort(),
    /** The gesture a user makes: a tap on the room, through the card's own handler. */
    async tapRoom() {
      const target = root.querySelector(".area-tap-target")!;
      target.dispatchEvent(
        new CustomEvent("action", { detail: { action: "tap" }, bubbles: true, composed: true })
      );
      await card.updateComplete;
    },
  };
}

describe("only show when zoomed, on the rendered card", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("leaves the flagged devices out of the DOM on the full plan", async () => {
    const t = await mount();
    // Not hidden with CSS — gone. A transparent badge would still take the tap.
    expect(t.drawn()).toEqual(["ordinary"]);
  });

  it("brings back the room's own devices when the room is tapped", async () => {
    const t = await mount();
    await t.tapRoom();
    // "outside" is flagged but sits in no room, so the zoom is not its zoom.
    expect(t.drawn()).toEqual(["assigned", "inside", "ordinary"]);
  });

  it("takes them away again when the room is tapped back out", async () => {
    const t = await mount();
    await t.tapRoom();
    await t.tapRoom();
    expect(t.drawn()).toEqual(["ordinary"]);
  });
});
