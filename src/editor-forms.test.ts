import { describe, it, expect } from "vitest";
import { isLiveField, diffFormValue, normalizeFormPatch } from "./editor-forms";
import type { FormField } from "./editor-forms";

const fields: FormField[] = [
  { name: "name", label: "Name", selector: { text: {} } },
  { name: "text", label: "Text", required: true, selector: { text: {} } },
  { name: "size", label: "Size", selector: { number: { min: 16, max: 160, mode: "slider" } } },
  { name: "length", label: "Length", required: true, selector: { number: { min: 1, mode: "box" } } },
  { name: "angle", label: "Angle", selector: { number: { min: 0, max: 360, mode: "slider" } } },
  { name: "display", label: "Display", selector: { select: { options: [] } } },
  { name: "showIcon", label: "Show icon", selector: { boolean: {} } },
  { name: "icon", label: "Icon", selector: { icon: {} } },
  { name: "entity", label: "Entity", selector: { entity: {} } },
];
const f = (n: string) => fields.find((x) => x.name === n)!;

describe("isLiveField", () => {
  it("marks text and number selectors live, others discrete", () => {
    expect(isLiveField(f("name"))).toBe(true);
    expect(isLiveField(f("size"))).toBe(true);
    expect(isLiveField(f("display"))).toBe(false);
    expect(isLiveField(f("showIcon"))).toBe(false);
    expect(isLiveField(f("entity"))).toBe(false);
    expect(isLiveField(f("icon"))).toBe(false);
  });
});

describe("diffFormValue", () => {
  it("returns only schema keys whose value identity changed", () => {
    const prev = { name: "a", size: 20, id: "x" };
    const next = { name: "b", size: 20, id: "y" };
    expect(diffFormValue(prev, next, fields)).toEqual({ name: "b" });
  });

  it("empty diff for identical payloads", () => {
    const data = { name: "a", size: 20 };
    expect(Object.keys(diffFormValue(data, { ...data }, fields)).length).toBe(0);
  });
});

describe("normalizeFormPatch", () => {
  it("maps empty optional strings to undefined, keeps required ones", () => {
    const out = normalizeFormPatch({ name: "" }, fields);
    expect("name" in out).toBe(true);
    expect(out.name).toBeUndefined();
    expect(normalizeFormPatch({ text: "" }, fields).text).toBe("");
    const icon = normalizeFormPatch({ icon: "" }, fields);
    expect("icon" in icon).toBe(true);
    expect(icon.icon).toBeUndefined();
  });

  it("drops invalid required numbers (keep-old), passes undefined optionals through", () => {
    expect("length" in normalizeFormPatch({ length: undefined }, fields)).toBe(false);
    expect("length" in normalizeFormPatch({ length: Number.NaN }, fields)).toBe(false);
    const out = normalizeFormPatch({ size: undefined }, fields);
    expect("size" in out).toBe(true);
    expect(out.size).toBeUndefined();
  });

  it("clamps numbers to the selector range and wraps angle", () => {
    expect(normalizeFormPatch({ length: 0 }, fields).length).toBe(1);
    expect(normalizeFormPatch({ size: 999 }, fields).size).toBe(160);
    expect(normalizeFormPatch({ angle: 360 }, fields).angle).toBe(0);
    expect(normalizeFormPatch({ angle: -30 }, fields).angle).toBe(330);
  });

  it("parses numeric strings from plain-input fallbacks", () => {
    expect(normalizeFormPatch({ length: "42" }, fields).length).toBe(42);
  });

  it("coerces booleans", () => {
    expect(normalizeFormPatch({ showIcon: undefined }, fields).showIcon).toBe(false);
    expect(normalizeFormPatch({ showIcon: true }, fields).showIcon).toBe(true);
  });

  it("ignores keys not in the schema", () => {
    expect("id" in normalizeFormPatch({ id: "z" }, fields)).toBe(false);
  });
});
