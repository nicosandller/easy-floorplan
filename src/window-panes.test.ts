import { describe, expect, it } from "vitest";
import type { Opening } from "./types";
import { windowPanes, paneOpening } from "./window-panes";
import { openingSolids } from "./projection-openings";
import { openingTop } from "./projection";
import { openingForm } from "./editor-forms";
import { resolveOpeningAmount } from "./render";

const win: Opening = { id: "window", type: "window", x: 100, y: 0, length: 90, angle: 0, sill: 0, openingHeight: 60 };
const map = (x: number, y: number) => ({ x, y });
const panels = (o: Opening, amounts: number[]) => openingSolids(o, {
  color: "#555", amount: 0, panes: amounts.map(amount => ({ amount, active: amount > 0 })),
}, map, 100).filter(s => s.kind === "panel");

describe("Window – Multipane", () => {
  it("keeps three stacked panes with only the middle top-hinged pane opening", () => {
    const o: Opening = { ...win, panes: [{ motion: "fixed" }, { motion: "awning" }, { motion: "fixed" }] };
    const shut = panels(o, [0, 0, 0]);
    expect(shut.map(p => [p.z0, p.z1])).toEqual([[0, 20], [20, 40], [40, 60]]);
    const open = panels(o, [0, 1, 0]);
    expect(open[0]).toEqual(shut[0]);
    expect(open[2]).toEqual(shut[2]);
    expect(open[1].vertices?.[0].y).toBeCloseTo(-10);
    expect(open[1].vertices?.[2].z).toBe(40);
  });

  it("retains full travel when a position sensor is available", () => {
    const o: Opening = { ...win, motion: "awning" };
    const draw = (positionAware: boolean) => openingSolids(o, { color: "#555", amount: 1, positionAware }, map, 100).find(s => s.kind === "panel")!;
    expect(draw(false).vertices?.[0].y).toBeCloseTo(-30);
    expect(draw(true).vertices?.[0].y).toBeCloseTo(-60);
  });

  it("slides the lower sash up behind the upper sash, without changing its size", () => {
    const o: Opening = { ...win, panes: [{ height: 1, motion: "slide-up" }, { height: 1, motion: "fixed" }] };
    expect(panels(o, [0.5, 0]).map(p => [p.z0, p.z1])).toEqual([[15, 45], [30, 60]]);
    expect(panels(o, [1, 0]).map(p => [p.z0, p.z1])).toEqual([[30, 60], [30, 60]]);
  });

  it("supports double-hung sashes and unequal pane heights without leaving the frame", () => {
    const o: Opening = { ...win, panes: [{ height: 1, motion: "slide-up" }, { height: 2, motion: "slide-down" }] };
    expect(panels(o, [1, 1]).map(p => [p.z0, p.z1])).toEqual([[20, 40], [0, 40]]);
  });

  it("uses separate contacts and positions, failing closed on an outage", () => {
    const o: Opening = { ...win, entity: "binary_sensor.middle", panes: [{}, { motion: "awning" }] };
    const p = paneOpening(o, windowPanes(o)[1]);
    expect(resolveOpeningAmount(p, { state: "on" })).toBe(1);
    const lower = paneOpening(o, { motion: "slide-up", entity: "cover.lower" });
    expect(resolveOpeningAmount(lower, { state: "open", attributes: { current_position: 40 } })).toBe(0.4);
    expect(resolveOpeningAmount({ ...lower, invert: true }, { state: "unavailable" })).toBe(0);
    expect(paneOpening(o, { motion: "fixed" }).entity).toBeUndefined();
  });

  it("sanitizes malformed layouts and ignores pane settings on doors", () => {
    expect(windowPanes({ ...win, panes: [null, { height: -1, motion: "bad" }] as never })).toEqual([
      { height: 1, motion: "fixed", entity: undefined, invert: false },
      { height: 1, motion: "fixed", entity: undefined, invert: false },
    ]);
    expect(windowPanes({ ...win, type: "door", panes: [{}] })).toEqual([]);
    expect(windowPanes({ ...win, panes: Array(50).fill({}) })).toHaveLength(8);
    expect(openingTop({ ...win, openingHeight: 200 }, 100)).toBe(100);
    expect(openingTop({ ...win, openingHeight: NaN }, 100)).toBe(85);
  });

  it("lets the editor add, configure and remove panes without leaking flat form keys", () => {
    const form = openingForm(win);
    const patch = form.toPatch({ paneCount: 3 });
    const o = { ...win, ...patch } as Opening;
    expect(o.panes).toHaveLength(3);
    const next = openingForm(o).toPatch({ pane1Motion: "awning", pane1Entity: "binary_sensor.middle", pane1Height: 2 });
    expect((next.panes as Opening["panes"])?.[1]).toMatchObject({ motion: "awning", entity: "binary_sensor.middle", height: 2 });
    expect(next).not.toHaveProperty("pane1Motion");
    expect(openingForm(o).toPatch({ paneCount: 0 })).toEqual({ panes: undefined });
    expect(openingForm(o).toPatch({ type: "door" })).toMatchObject({ panes: undefined, openingHeight: undefined });
  });
});
