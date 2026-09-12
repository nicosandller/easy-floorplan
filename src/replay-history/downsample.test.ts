import { describe, expect, it } from "vitest";
import { downsampleHistory, downsampleSeries, thinForDisplay } from "./downsample";
import type { HistoryEventInput } from "./history-service";

const T0 = 1_760_000_000_000;
const ev = (i: number, newState: string, entityId = "sensor.x"): HistoryEventInput => ({
  timestamp: T0 + i * 1000,
  entityId,
  oldState: newState,
  newState,
  attributes: {},
});

describe("downsampleHistory", () => {
  it("keeps everything when no resolution is asked for", () => {
    const drift = Array.from({ length: 200 }, (_, i) => ev(i, (20 + i * 0.01).toFixed(2)));
    expect(downsampleHistory(drift)).toBe(drift);
    expect(downsampleHistory(drift, { numericSteps: 0 })).toBe(drift);
  });

  it("never drops a discrete state change", () => {
    // A light toggling is not drift — every transition is a thing that
    // happened, and losing one makes the replay wrong rather than coarse.
    const toggles = Array.from({ length: 200 }, (_, i) => ev(i, i % 2 ? "on" : "off", "light.kitchen"));
    expect(downsampleHistory(toggles, { numericSteps: 5 })).toEqual(toggles);
  });

  it("thins numeric drift", () => {
    const drift = Array.from({ length: 500 }, (_, i) => ev(i, (20 + Math.sin(i / 40) * 5).toFixed(3)));
    const out = downsampleHistory(drift, { numericSteps: 20 });
    expect(out.length).toBeLessThan(drift.length / 3);
    expect(out.length).toBeGreaterThan(10);
  });

  it("keeps the first and last point exactly", () => {
    const drift = Array.from({ length: 300 }, (_, i) => ev(i, (i * 0.1).toFixed(2)));
    const out = downsampleSeries(drift, { numericSteps: 10 });
    expect(out[0]).toBe(drift[0]);
    expect(out[out.length - 1]).toBe(drift[drift.length - 1]);
  });

  it("does not flatten a spike", () => {
    // The hottest point of the day has to stay the hottest point of the day.
    const flat = Array.from({ length: 200 }, (_, i) => ev(i, "20.0"));
    flat[120] = ev(120, "45.0");
    const out = downsampleSeries(flat, { numericSteps: 10 });
    expect(out.map((e) => e.newState)).toContain("45.0");
  });

  it("reduces a series that never moves to its endpoints", () => {
    const flat = Array.from({ length: 100 }, (_, i) => ev(i, "20.0"));
    const out = downsampleSeries(flat, { numericSteps: 10 });
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(flat[0]);
    expect(out[1]).toBe(flat[99]);
  });

  it("thins each entity on its own range and keeps chronological order", () => {
    const mixed: HistoryEventInput[] = [];
    for (let i = 0; i < 200; i++) {
      mixed.push(ev(i, (20 + i * 0.05).toFixed(2), "sensor.temp"));
      mixed.push(ev(i, i % 2 ? "on" : "off", "light.kitchen"));
    }
    mixed.sort((a, b) => a.timestamp - b.timestamp);
    const out = downsampleHistory(mixed, { numericSteps: 10 });

    // The light survives intact; the sensor does not.
    expect(out.filter((e) => e.entityId === "light.kitchen")).toHaveLength(200);
    expect(out.filter((e) => e.entityId === "sensor.temp").length).toBeLessThan(60);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].timestamp).toBeGreaterThanOrEqual(out[i - 1].timestamp);
    }
  });

  it("leaves a series too short to have a shape alone", () => {
    const two = [ev(0, "1.0"), ev(1, "2.0")];
    expect(downsampleSeries(two, { numericSteps: 10 })).toBe(two);
  });

  it("still thins a numeric sensor that drops out, and keeps the drop-outs", () => {
    // A sensor going `unavailable` does not stop it being a numeric sensor.
    // Treating it as discrete exempts it from every kind of thinning, which is
    // how the flakiest entity on the plan ended up as the only lane still
    // drawing all of its points.
    const drift: HistoryEventInput[] = [];
    for (let i = 0; i < 400; i++) {
      drift.push(ev(i, i % 97 === 0 ? "unavailable" : (20 + Math.sin(i / 30) * 4).toFixed(3)));
    }
    const out = downsampleSeries(drift, { numericSteps: 20 });
    expect(out.length).toBeLessThan(drift.length / 2);
    // Every outage survives.
    const outages = out.filter((e) => e.newState === "unavailable");
    expect(outages).toHaveLength(drift.filter((e) => e.newState === "unavailable").length);
  });

  it("keeps the reading that ends an outage", () => {
    // Nothing to have drifted from, and it is the point that says the sensor
    // came back.
    const evs = [ev(0, "20.0"), ev(1, "unavailable"), ev(2, "20.01"), ev(3, "20.02"), ev(4, "30.0")];
    const out = downsampleSeries(evs, { numericSteps: 4 });
    expect(out.map((e) => e.newState)).toContain("20.01");
  });

  it("does not treat a genuinely non-numeric series as numeric", () => {
    const words = [ev(0, "home"), ev(1, "unavailable"), ev(2, "away"), ev(3, "home")];
    expect(downsampleSeries(words, { numericSteps: 2 })).toBe(words);
  });
});

describe("thinForDisplay", () => {
  it("leaves a series that already fits", () => {
    const few = Array.from({ length: 40 }, (_, i) => ev(i, String(i)));
    expect(thinForDisplay(few, 150)).toBe(few);
  });

  it("caps a numeric lane at the budget", () => {
    // The demo's distance trackers swing across their whole range several
    // times a minute, so deadband thinning barely touches them — a budget is
    // the only thing that makes the lane readable.
    const sawtooth = Array.from({ length: 1400 }, (_, i) => ev(i, String(i % 100)));
    const out = thinForDisplay(sawtooth, 150);
    expect(out).toHaveLength(150);
    expect(out[0]).toBe(sawtooth[0]);
    expect(out[out.length - 1]).toBe(sawtooth[sawtooth.length - 1]);
  });

  it("spends the budget on the biggest moves", () => {
    const quiet = Array.from({ length: 300 }, (_, i) => ev(i, (20 + (i % 3) * 0.01).toFixed(2)));
    quiet[100] = ev(100, "90.0");
    quiet[200] = ev(200, "5.0");
    const kept = thinForDisplay(quiet, 10).map((e) => e.newState);
    expect(kept).toContain("90.0");
    expect(kept).toContain("5.0");
  });

  it("never thins a discrete lane, however long", () => {
    // There is no "small" change between on and off, so there is no honest
    // way to rank them — the lane keeps all of them.
    const toggles = Array.from({ length: 900 }, (_, i) => ev(i, i % 2 ? "on" : "off", "light.kitchen"));
    expect(thinForDisplay(toggles, 150)).toBe(toggles);
  });

  it("stays in chronological order", () => {
    const wobble = Array.from({ length: 800 }, (_, i) => ev(i, String(Math.sin(i / 9) * 50)));
    const out = thinForDisplay(wobble, 120);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].timestamp).toBeGreaterThan(out[i - 1].timestamp);
    }
  });
});

describe("a flaky numeric sensor on the lane", () => {
  it("is capped like any other numeric lane, with its outages intact", () => {
    const flaky: HistoryEventInput[] = [];
    for (let i = 0; i < 430; i++) {
      flaky.push(ev(i, i % 18 === 0 ? "unavailable" : (33 + Math.sin(i / 11) * 10).toFixed(1)));
    }
    const drawn = thinForDisplay(flaky, 150);
    expect(drawn.length).toBeLessThanOrEqual(150);
    expect(drawn.filter((e) => e.newState === "unavailable"))
      .toHaveLength(flaky.filter((e) => e.newState === "unavailable").length);
  });
});
