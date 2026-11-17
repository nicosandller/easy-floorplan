import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebugLogger } from "./debug";

describe("createDebugLogger", () => {
  let logs: unknown[][];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs nothing when disabled", () => {
    const debug = createDebugLogger("test", {
      enabled: false,
      maxChars: 1000,
      repeatSummaryEvery: 20,
      labelAllow: ["foo:"],
    });
    debug("foo:bar", { a: 1 });
    expect(logs).toHaveLength(0);
  });

  it("only logs labels matching the allow-list prefixes", () => {
    const debug = createDebugLogger("test", {
      enabled: true,
      maxChars: 1000,
      repeatSummaryEvery: 20,
      labelAllow: ["foo:"],
    });
    debug("bar:baz", { a: 1 });
    expect(logs).toHaveLength(0);
    debug("foo:baz", { a: 1 });
    expect(logs).toHaveLength(1);
    expect(logs[0]![0]).toContain("[easy-floorplan:test]");
  });

  it("collapses repeated identical payloads into a periodic summary", () => {
    const debug = createDebugLogger("test", {
      enabled: true,
      maxChars: 1000,
      repeatSummaryEvery: 3,
      labelAllow: ["foo:"],
    });
    for (let i = 0; i < 7; i++) debug("foo:same", { a: 1 });
    // First call logs the payload; the 3rd and 6th repeat log a summary line.
    expect(logs).toHaveLength(3);
    expect(String(logs[1]![0])).toContain("repeated 3x");
  });

  it("omits keys listed in omitKeys regardless of type", () => {
    const debug = createDebugLogger("test", {
      enabled: true,
      maxChars: 1000,
      repeatSummaryEvery: 20,
      labelAllow: ["foo:"],
      omitKeys: ["secret"],
    });
    debug("foo:bar", { secret: { deep: true }, visible: 1 });
    expect(logs[0]![1]).toBe('{"secret":"[omitted]","visible":1}');
  });

  it("summarizes arrayLengthKeys as Array(n), or omits non-array values", () => {
    const debug = createDebugLogger("test", {
      enabled: true,
      maxChars: 1000,
      repeatSummaryEvery: 20,
      labelAllow: ["foo:"],
      arrayLengthKeys: ["points"],
    });
    debug("foo:bar", { points: [1, 2, 3] });
    expect(logs[0]![1]).toBe('{"points":"Array(3)"}');
    logs = [];
    debug("foo:baz", { points: "not-an-array" });
    expect(logs[0]![1]).toBe('{"points":"[omitted]"}');
  });

  it("applies an extra shouldLog gate after the allow-list", () => {
    let allow = false;
    const debug = createDebugLogger("test", {
      enabled: true,
      maxChars: 1000,
      repeatSummaryEvery: 20,
      labelAllow: ["foo:"],
      shouldLog: () => allow,
    });
    debug("foo:bar", {});
    expect(logs).toHaveLength(0);
    allow = true;
    debug("foo:bar", {});
    expect(logs).toHaveLength(1);
  });

  it("truncates serialized payloads longer than maxChars", () => {
    const debug = createDebugLogger("test", {
      enabled: true,
      maxChars: 10,
      repeatSummaryEvery: 20,
      labelAllow: ["foo:"],
    });
    debug("foo:bar", { long: "a".repeat(50) });
    expect(String(logs[0]![1])).toContain("[truncated");
  });
});
