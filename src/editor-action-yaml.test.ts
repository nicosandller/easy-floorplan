import { describe, it, expect } from "vitest";
import { actionFieldNames, actionYamlPatch, itemBehaviourForm, areaForm } from "./editor-forms";
import type { Area, FloorItem } from "./types";

const NAMES = ["tap_action", "hold_action", "double_tap_action"];

describe("Behavior code editor (issue #314)", () => {
  it("finds the action fields of each Behavior form", () => {
    const item = { id: "i", x: 0, y: 0, entity: "light.desk", kind: "light" } as FloorItem;
    expect(actionFieldNames(itemBehaviourForm(item))).toEqual(NAMES);
    const area = { id: "a", name: "Kitchen", points: [] } as unknown as Area;
    expect(actionFieldNames(areaForm(area))).toEqual(NAMES);
  });

  it("passes a YAML-only action through untouched", () => {
    const popup = { action: "fire-dom-event", popup_card: { entity: "light.desk", card: { type: "tile" } } };
    expect(actionYamlPatch({ tap_action: popup }, NAMES)).toEqual({
      patch: { tap_action: popup, hold_action: undefined, double_tap_action: undefined },
    });
  });

  it("clears every action when the document is emptied", () => {
    expect(actionYamlPatch(null, NAMES)).toEqual({
      patch: { tap_action: undefined, hold_action: undefined, double_tap_action: undefined },
    });
  });

  it("refuses other keys rather than half-applying", () => {
    const r = actionYamlPatch({ tap_action: { action: "toggle" }, entity: "light.x" }, NAMES);
    expect(r).toHaveProperty("error");
    expect((r as { error: string }).error).toContain("entity");
  });

  it("refuses an action without an action: line, a list or a scalar", () => {
    expect(actionYamlPatch({ tap_action: { navigation_path: "/x" } }, NAMES)).toHaveProperty("error");
    expect(actionYamlPatch({ tap_action: "toggle" }, NAMES)).toHaveProperty("error");
    expect(actionYamlPatch([], NAMES)).toHaveProperty("error");
    expect(actionYamlPatch("tap_action", NAMES)).toHaveProperty("error");
  });
});
