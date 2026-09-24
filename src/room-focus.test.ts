import { describe, expect, it } from "vitest";
import {
  MAX_FOCUS_INTERVAL,
  MIN_FOCUS_INTERVAL,
  focusOrder,
  normalizeRoomFocus,
  stepFocus,
} from "./room-focus";

const areas = [{ id: "hall" }, { id: "living" }, { id: "kitchen" }];

describe("normalizeRoomFocus", () => {
  it("takes the plain `true` as controls without cycling", () => {
    expect(normalizeRoomFocus(true)).toEqual({ controls: true, intervalMs: 0 });
  });

  it("defaults the controls on, since they are the way in", () => {
    expect(normalizeRoomFocus({ interval: 10 })).toEqual({ controls: true, intervalMs: 10_000 });
  });

  it("clamps a dwell to something a person can read", () => {
    expect(normalizeRoomFocus({ interval: 0.2 })?.intervalMs).toBe(MIN_FOCUS_INTERVAL * 1000);
    expect(normalizeRoomFocus({ interval: 99_999 })?.intervalMs).toBe(MAX_FOCUS_INTERVAL * 1000);
    expect(normalizeRoomFocus({ interval: "15" })?.intervalMs).toBe(15_000);
  });

  it("reads an unusable interval as no cycling rather than guessing one", () => {
    for (const interval of [undefined, null, false, {}, [], "soon", NaN, -5, 0]) {
      expect(normalizeRoomFocus({ interval })?.intervalMs).toBe(0);
    }
  });

  it("switches off entirely when there would be nothing to show or do", () => {
    expect(normalizeRoomFocus(undefined)).toBeUndefined();
    expect(normalizeRoomFocus(false)).toBeUndefined();
    expect(normalizeRoomFocus("yes")).toBeUndefined();
    expect(normalizeRoomFocus([1, 2])).toBeUndefined();
    // No controls and no dwell: a feature that does nothing at all.
    expect(normalizeRoomFocus({ controls: false })).toBeUndefined();
    // …but no controls *with* a dwell is a legitimate kiosk.
    expect(normalizeRoomFocus({ controls: false, interval: 8 })).toEqual({
      controls: false,
      intervalMs: 8000,
    });
  });

  it("keeps a named order, dropping entries that are not names", () => {
    expect(normalizeRoomFocus({ rooms: ["living", "", 7, "kitchen"] })?.rooms).toEqual([
      "living",
      "kitchen",
    ]);
    expect(normalizeRoomFocus({ rooms: [] })?.rooms).toBeUndefined();
    expect(normalizeRoomFocus({ rooms: "living" })?.rooms).toBeUndefined();
  });
});

describe("focusOrder", () => {
  const settings = normalizeRoomFocus(true)!;

  it("visits every room as drawn when no order is named", () => {
    expect(focusOrder(areas, settings)).toEqual(["hall", "living", "kitchen"]);
  });

  it("follows a named order, including a partial tour", () => {
    const named = normalizeRoomFocus({ rooms: ["kitchen", "hall"] })!;
    expect(focusOrder(areas, named)).toEqual(["kitchen", "hall"]);
  });

  it("drops a room that no longer exists instead of focusing nothing", () => {
    const named = normalizeRoomFocus({ rooms: ["kitchen", "attic", "hall"] })!;
    expect(focusOrder(areas, named)).toEqual(["kitchen", "hall"]);
  });

  it("is empty with no rooms or no feature, so the card renders no controls", () => {
    expect(focusOrder([], settings)).toEqual([]);
    expect(focusOrder(undefined, settings)).toEqual([]);
    expect(focusOrder(areas, undefined)).toEqual([]);
  });
});

describe("stepFocus", () => {
  const order = ["hall", "living", "kitchen"];

  it("moves along and wraps at both ends", () => {
    expect(stepFocus(order, "hall", 1)).toBe("living");
    expect(stepFocus(order, "kitchen", 1)).toBe("hall");
    expect(stepFocus(order, "living", -1)).toBe("hall");
    expect(stepFocus(order, "hall", -1)).toBe("kitchen");
  });

  it("is a way in from the unzoomed plan, from either end", () => {
    expect(stepFocus(order, undefined, 1)).toBe("hall");
    expect(stepFocus(order, undefined, -1)).toBe("kitchen");
  });

  it("treats a room that has left the order as nowhere", () => {
    expect(stepFocus(order, "attic", 1)).toBe("hall");
    expect(stepFocus(order, "attic", -1)).toBe("kitchen");
  });

  it("has nowhere to go with no rooms", () => {
    expect(stepFocus([], undefined, 1)).toBeUndefined();
    expect(stepFocus([], "hall", -1)).toBeUndefined();
  });

  it("keeps a single room where it is", () => {
    expect(stepFocus(["only"], "only", 1)).toBe("only");
    expect(stepFocus(["only"], "only", -1)).toBe("only");
  });
});
