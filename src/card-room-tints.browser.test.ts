/**
 * Automatic room tints, in a real browser.
 *
 * The node suite covers which tint each room gets. What it cannot cover is
 * that the `var()` chain a tint is written as actually resolves to a painted
 * colour on a mounted card — and to the theme's or palette's override when
 * one is set — which is CSS resolution and needs a browser.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { Area, FloorplanCardConfig, PaletteColor } from "./types";
import { ROOM_TINTS, assignRoomTints } from "./room-tints";

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const AREAS: Area[] = [
  { id: "a_living", name: "Living", points: rect(100, 100, 300, 300) },
  { id: "b_kitchen", name: "Kitchen", points: rect(400, 100, 300, 300) },
  { id: "c_study", name: "Study", color: "#123456", points: rect(700, 100, 200, 300) },
];

function config(extra: Partial<FloorplanCardConfig> = {}, palette?: PaletteColor[]): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 600,
    palette,
    ...extra,
    floors: [
      { id: "f1", name: "Floor 1", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: AREAS },
    ],
  } as FloorplanCardConfig;
}

function hex(rgb: string): string {
  const m = rgb.match(/\d+/g)!.slice(0, 3).map(Number);
  return "#" + m.map((n) => n.toString(16).padStart(2, "0")).join("");
}

async function mount(c: FloorplanCardConfig, darkMode = false, hostStyle = "") {
  const host = document.createElement("div");
  host.style.cssText = `width:900px;height:540px;${hostStyle}`;
  document.body.appendChild(host);
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(c);
  card.hass = {
    states: {},
    entities: {},
    themes: { darkMode },
    formatEntityState: (st: { state: string }) => st.state,
  } as unknown as FloorplanCard["hass"];
  host.appendChild(card);
  await card.updateComplete;
  const fills = () =>
    [...card.shadowRoot!.querySelectorAll<SVGPolygonElement>("svg polygon.fp-area")].map((p) => ({
      fill: hex(getComputedStyle(p).fill),
      opacity: p.getAttribute("fill-opacity"),
    }));
  return { card, fills };
}

describe("roomTints: auto reaches the paint", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const expected = assignRoomTints(AREAS);

  it("leaves every uncoloured room in the accent while off", async () => {
    const t = await mount(config(), false, "--primary-color:#03a9f4");
    const [a, b, c] = t.fills();
    expect(a!.fill).toBe("#03a9f4");
    expect(b!.fill).toBe("#03a9f4");
    expect(a!.opacity).toBe("0.25");
    expect(c!.fill).toBe("#123456");
  });

  it("tints uncoloured neighbours apart and keeps an explicit colour", async () => {
    const t = await mount(config({ roomTints: "auto" }));
    const [a, b, c] = t.fills();
    expect(a!.fill).toBe(ROOM_TINTS[expected[0]!]!.light);
    expect(b!.fill).toBe(ROOM_TINTS[expected[1]!]!.light);
    expect(a!.fill).not.toBe(b!.fill);
    expect(a!.opacity).toBe("0.18");
    expect(c!.fill).toBe("#123456");
  });

  it("draws the dark side in Home Assistant's dark mode", async () => {
    const t = await mount(config({ roomTints: "auto" }), true);
    expect(t.fills()[0]!.fill).toBe(ROOM_TINTS[expected[0]!]!.dark);
  });

  it("draws the dark side on a dark skin whatever HA's mode", async () => {
    const t = await mount(config({ roomTints: "auto", skin: "tron" }), false);
    expect(t.fills()[0]!.fill).toBe(ROOM_TINTS[expected[0]!]!.dark);
  });

  it("takes a theme variable over the built-in tint", async () => {
    const n = expected[0]! + 1;
    const t = await mount(config({ roomTints: "auto" }), false, `--fp-room-tint-${n}:#ff00ff`);
    expect(t.fills()[0]!.fill).toBe("#ff00ff");
  });

  it("takes a palette entry named Room tint N", async () => {
    const n = expected[1]! + 1;
    const t = await mount(config({ roomTints: "auto" }, [{ name: `Room tint ${n}`, color: "#00ff00" }]));
    expect(t.fills()[1]!.fill).toBe("#00ff00");
  });

  it("tints the floor in the 3D view too", async () => {
    const t = await mount(config({ roomTints: "auto", view: "3d" }));
    expect(t.fills()[0]!.fill).toBe(ROOM_TINTS[expected[0]!]!.light);
  });

  it("leaves line art white", async () => {
    const t = await mount(config({ roomTints: "auto", appearance: "line-art" }));
    expect(t.fills()[0]!.fill).toBe("#ffffff");
  });
});
