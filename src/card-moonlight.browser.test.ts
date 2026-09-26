import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig } from "./types";
import { MOON_TICK_MS } from "./render";

// London at 21:00 UTC on 22 September 2026: the moon 85% lit and 20° up due
// south, the sun 27° down. Only Date and the interval are faked, so Lit's
// own scheduling runs as normal.
beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-09-22T21:00:00Z"), toFake: ["Date", "setInterval", "clearInterval"] });
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const sun = (elevation: number) => ({
  entity_id: "sun.sun",
  state: elevation > 0 ? "above_horizon" : "below_horizon",
  attributes: { elevation, azimuth: 300 },
});

function mount(elevation: number, extra: Partial<FloorplanCardConfig> = {}): FloorplanCard {
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig({
    type: "custom:easy-floorplan-card", width: 200, height: 200,
    sunlight: true, moonlight: true, sunDimming: true,
    // A south-facing window, so a southern moon shines straight in.
    floors: [{ id: "ground", name: "Ground", walls: [], items: [], texts: [], furniture: [], trackers: [], areas: [],
      openings: [{ id: "win", type: "window", x: 100, y: 190, length: 40, angle: 0 }] }],
    ...extra,
  } as FloorplanCardConfig);
  card.hass = {
    states: { "sun.sun": sun(elevation) },
    entities: {},
    config: { latitude: 51.5074, longitude: -0.1278 },
  } as unknown as FloorplanCard["hass"];
  document.body.append(card);
  return card;
}

const moonBeam = (card: FloorplanCard) =>
  card.shadowRoot!.querySelector<SVGPolygonElement>(".fp-moonlight .fp-sunbeam");

it("lets the moon in after dark, in its own cool light (issue #201)", async () => {
  const card = mount(-27);
  await card.updateComplete;
  const beam = moonBeam(card);
  expect(beam).toBeTruthy();
  const gradientId = beam!.getAttribute("fill")?.match(/url\(#(.+)\)/)?.[1];
  const gradient = card.shadowRoot!.querySelector(`[id='${gradientId}']`);
  expect(gradient?.querySelector("stop")?.getAttribute("stop-color")).toContain("--fp-skin-moonlight");
  // A moon due south throws its light north, up the canvas from the window.
  const ys = (beam!.getAttribute("points") ?? "").split(/\s+/).map((p) => Number(p.split(",")[1]));
  expect(Math.min(...ys)).toBeLessThan(150);
});

it("holds the night back where it lands, the way a lamp does", async () => {
  const card = mount(-27);
  await card.updateComplete;
  const dim = card.shadowRoot!.querySelector(".fp-sun-dim")!;
  // No lamp is lit, so the only thing that can have given the dim a mask is
  // the moon's clearing.
  const maskId = dim.getAttribute("mask")?.match(/url\(#(.+)\)/)?.[1];
  expect(maskId).toBeTruthy();
  const mask = card.shadowRoot!.querySelector(`[id='${maskId}']`)!;
  expect(mask.querySelector(".fp-sunbeam")).toBeTruthy();
});

it("draws no moon while the sun is up, or without the switch", async () => {
  const day = mount(30);
  await day.updateComplete;
  expect(moonBeam(day)).toBeNull();
  document.body.innerHTML = "";
  const off = mount(-27, { moonlight: false });
  await off.updateComplete;
  expect(moonBeam(off)).toBeNull();
});

it("follows the moon across the sky with nothing else changing", async () => {
  const card = mount(-27);
  await card.updateComplete;
  const before = moonBeam(card)!.getAttribute("points");
  // An hour on, and not one state change: only the card's own clock can
  // have moved the light.
  vi.advanceTimersByTime(15 * MOON_TICK_MS);
  await card.updateComplete;
  expect(moonBeam(card)!.getAttribute("points")).not.toBe(before);
});

it("puts the replayed night's moon in, not tonight's", async () => {
  // Where the moon is 3½ hours on, drawn live, as the answer to compare with.
  const replayed = Date.parse("2026-09-23T00:30:00Z");
  // Replay has to be offered for the card to draw from it at all.
  const replay: Partial<FloorplanCardConfig> = { historyReplay: { enabled: true } };
  vi.setSystemTime(replayed);
  const live = mount(-27, replay);
  await live.updateComplete;
  const then = moonBeam(live)!.getAttribute("points");
  live.remove();

  vi.setSystemTime(Date.parse("2026-09-22T21:00:00Z"));
  const card = mount(-27, replay);
  await card.updateComplete;
  expect(moonBeam(card)!.getAttribute("points")).not.toBe(then);
  const controller = (card as unknown as { _replayController: {
    state: { enabled: boolean; historyVisible: boolean; playbackController: { currentTime: number } };
  } })._replayController;
  controller.state.enabled = true;
  controller.state.historyVisible = true;
  // The replay clock counts seconds, where Date.now() counts milliseconds.
  controller.state.playbackController.currentTime = replayed / 1000;
  card.requestUpdate();
  await card.updateComplete;
  expect(moonBeam(card)?.getAttribute("points")).toBe(then);
});

it("keeps no clock without moonlight, and stops it when the card goes", async () => {
  const idle = vi.getTimerCount();
  const card = mount(-27);
  await card.updateComplete;
  expect(vi.getTimerCount()).toBe(idle + 1);
  card.remove();
  expect(vi.getTimerCount()).toBe(idle);
  mount(-27, { moonlight: false });
  expect(vi.getTimerCount()).toBe(idle);
});
