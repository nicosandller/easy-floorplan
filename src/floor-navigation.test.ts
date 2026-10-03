import { describe, expect, it } from "vitest";
import { furnitureFloorTarget } from "./render";
import { furnitureForm } from "./editor-forms";
import type { Furniture } from "./types";

const floors = [
  { id: "cellar", name: "Cellar" },
  { id: "ground", name: "Ground" },
  { id: "loft", name: "Loft" },
];
const piece = (goToFloor?: Furniture["goToFloor"]): Furniture => ({
  id: "stairs", type: "stairs", x: 100, y: 100, w: 60, h: 80, goToFloor,
});

describe("direct floor destinations (issue #327)", () => {
  it.each([
    ["top", "cellar", "loft"],
    ["bottom", "loft", "cellar"],
    ["main", "loft", "ground"],
    [{ floor: "loft" }, "cellar", "loft"],
    [{ floor: "cellar" }, "loft", "cellar"],
  ] as const)("resolves %j from %s", (target, active, expected) => {
    expect(furnitureFloorTarget(piece(target), floors, active, "ground")).toBe(expected);
  });

  it("uses the first floor for main when the default is unset or was deleted", () => {
    expect(furnitureFloorTarget(piece("main"), floors, "loft")).toBe("cellar");
    expect(furnitureFloorTarget(piece("main"), floors, "loft", "gone")).toBe("cellar");
  });

  it("keeps explicit destinations through renames and reorders, while top follows the order", () => {
    const reordered = [floors[2], floors[0], { ...floors[1], name: "Entrance" }];
    expect(furnitureFloorTarget(piece({ floor: "ground" }), reordered, "loft")).toBe("ground");
    expect(furnitureFloorTarget(piece("top"), reordered, "loft")).toBe("ground");
    expect(furnitureFloorTarget(piece("bottom"), reordered, "ground")).toBe("loft");
  });

  it("distinguishes floor ids from the navigation keywords", () => {
    const named = [{ id: "up" }, { id: "main" }, { id: "floor:top" }];
    expect(furnitureFloorTarget(piece({ floor: "up" }), named, "main")).toBe("up");
    expect(furnitureFloorTarget(piece("up"), named, "main")).toBe("floor:top");
    expect(furnitureFloorTarget(piece({ floor: "main" }), named, "up")).toBe("main");
  });

  it("does not offer a button for the current, deleted, or invalid destination", () => {
    for (const target of ["top", { floor: "loft" }, { floor: "gone" }, { floor: 3 }, null, "sideways"]) {
      expect(furnitureFloorTarget(piece(target as never), floors, "loft")).toBeUndefined();
    }
    expect(furnitureFloorTarget(piece("bottom"), floors, "cellar")).toBeUndefined();
    expect(furnitureFloorTarget(piece("main"), floors, "ground", "ground")).toBeUndefined();
  });

  it.each(["top", "bottom", "main", { floor: "loft" }] as const)("is inert on empty/single-floor plans and unknown active floors: %j", (target) => {
    expect(furnitureFloorTarget(piece(target), [], "loft")).toBeUndefined();
    expect(furnitureFloorTarget(piece(target), [{ id: "loft" }], "loft")).toBeUndefined();
    expect(furnitureFloorTarget(piece(target), floors, "gone")).toBeUndefined();
    expect(furnitureFloorTarget(piece(target), floors, undefined)).toBeUndefined();
  });
});

describe("floor destination selector", () => {
  const form = (target?: Furniture["goToFloor"]) => furnitureForm(piece(target), undefined, undefined, floors);
  const options = (spec: ReturnType<typeof form>) =>
    (spec.fields.find((f) => f.name === "goToFloor")!.selector.select as {
      options: { value: string; label: string }[];
    }).options;

  it("offers relative destinations and every named floor", () => {
    expect(options(form()).map((o) => o.value)).toEqual([
      "", "up", "down", "top", "bottom", "main", "floor:cellar", "floor:ground", "floor:loft",
    ]);
    expect(options(form()).find((o) => o.value === "floor:ground")?.label).toContain("Ground");
  });

  it("round trips a specific floor, including keyword and prefixed ids", () => {
    for (const id of ["ground", "up", "main", "floor:top"]) {
      const spec = form({ floor: id });
      expect(spec.toPatch({ goToFloor: spec.data.goToFloor })).toEqual({ goToFloor: { floor: id } });
    }
  });

  it("retains a missing floor and unrelated actions when editing", () => {
    const spec = form({ floor: "removed" });
    expect(options(spec)).toContainEqual({ value: "floor:removed", label: "Missing floor: removed" });
    expect(spec.toPatch({ angle: 90 })).toEqual({ angle: 90 });
    expect(spec.toPatch({ goToFloor: "", hold_action: { action: "more-info" } })).toEqual({
      goToFloor: undefined, hold_action: { action: "more-info" },
    });
    expect(spec.toPatch({ goToFloor: "main" })).toEqual({ goToFloor: "main" });
  });
});
