/** The icon fill's maths (issue #421). */
import { describe, expect, it } from "vitest";
import { badgeFillClipTop, badgeFillFraction, badgeFillRange } from "./render";

describe("badgeFillRange", () => {
  it("is off unless asked for", () => {
    expect(badgeFillRange(undefined)).toBeUndefined();
    expect(badgeFillRange(false)).toBeUndefined();
  });
  it("reads true as a percentage and fills in either end", () => {
    expect(badgeFillRange(true)).toEqual({ min: 0, max: 100 });
    expect(badgeFillRange({ max: 12 })).toEqual({ min: 0, max: 12 });
    expect(badgeFillRange({ min: 20 })).toEqual({ min: 20, max: 100 });
  });
  it("ignores an end that is not a finite number", () => {
    expect(badgeFillRange({ min: Number.NaN, max: "8" as unknown as number })).toEqual({ min: 0, max: 100 });
  });
});

describe("badgeFillFraction", () => {
  const f = (fill: unknown, raw: unknown, extra: object = {}) =>
    badgeFillFraction({ fill: fill as boolean, ...extra }, raw);

  it("scales a reading into the range", () => {
    expect(f(true, "60")).toBeCloseTo(0.6);
    expect(f(true, 25)).toBeCloseTo(0.25);
    expect(f({ min: 0, max: 12 }, "3")).toBeCloseTo(0.25);
    expect(f({ min: 15, max: 25 }, "20")).toBeCloseTo(0.5);
  });
  it("clamps past either end", () => {
    expect(f(true, "130")).toBe(1);
    expect(f(true, "-5")).toBe(0);
  });
  it("fills as the reading falls when the range is reversed", () => {
    expect(f({ min: 100, max: 0 }, "25")).toBeCloseTo(0.75);
  });
  it("treats equal ends as a threshold", () => {
    expect(f({ min: 5, max: 5 }, "5")).toBe(1);
    expect(f({ min: 5, max: 5 }, "4")).toBe(0);
  });
  it("has no fill without a number, so offline never reads as empty", () => {
    for (const raw of ["unavailable", "unknown", "", "  ", undefined, null, "on"]) expect(f(true, raw)).toBeUndefined();
  });
  it("is off when not configured, and on value or hidden badges", () => {
    expect(f(undefined, "60")).toBeUndefined();
    expect(f(true, "60", { badgeContent: "value" })).toBeUndefined();
    expect(f(true, "60", { badgeContent: "none" })).toBeUndefined();
    expect(f(true, "60", { showIcon: false })).toBeUndefined();
  });
});

describe("badgeFillClipTop", () => {
  it("maps the fraction onto the glyph's 2–22 span of the 24-unit icon box", () => {
    expect(badgeFillClipTop(1)).toBeCloseTo((2 / 24) * 100, 1);
    expect(badgeFillClipTop(0)).toBeCloseTo((22 / 24) * 100, 1);
    expect(badgeFillClipTop(0.5)).toBe(50);
  });
  it("clamps out-of-range fractions", () => {
    expect(badgeFillClipTop(2)).toBe(badgeFillClipTop(1));
    expect(badgeFillClipTop(-1)).toBe(badgeFillClipTop(0));
  });
});
