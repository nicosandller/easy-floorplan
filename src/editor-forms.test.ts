import { describe, it, expect } from "vitest";
import {
  isLiveField,
  diffFormValue,
  normalizeFormPatch,
  openingForm,
  itemForm,
  textForm,
  furnitureForm,
  trackerForm,
  wallForm,
  projectForm,
  projectRotationForm,
  floorImageForm,
} from "./editor-forms";
import type { FormField } from "./editor-forms";
import type { Opening, FloorItem, Floor, FloorplanCardConfig } from "./types";

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

const door = { id: "o1", type: "door", x: 0, y: 0, length: 90, angle: 0 } as Opening;

describe("openingForm", () => {
  it("swing door shows hinge + opens, no slide fields", () => {
    const names = openingForm(door).fields.map((x) => x.name);
    expect(names).toContain("hinge");
    expect(names).toContain("opens");
    expect(names).not.toContain("style");
    expect(names).not.toContain("slide");
  });

  it("sliding opening shows slide + style, hides hinge; biparting hides slide", () => {
    const slide = openingForm({ ...door, motion: "slide" } as Opening).fields.map((x) => x.name);
    expect(slide).toContain("slide");
    expect(slide).toContain("style");
    expect(slide).not.toContain("hinge");
    expect(slide).not.toContain("opens");
    const bi = openingForm({ ...door, motion: "slide", sliderStyle: "biparting" } as Opening);
    expect(bi.fields.map((x) => x.name)).not.toContain("slide");
  });

  it("invert only offered with an entity; entity filter targets covers and binary_sensors", () => {
    expect(openingForm(door).fields.map((x) => x.name)).not.toContain("invert");
    const bound = openingForm({ ...door, entity: "cover.x" } as Opening);
    expect(bound.fields.map((x) => x.name)).toContain("invert");
    const entity = bound.fields.find((x) => x.name === "entity")!;
    expect(entity.selector).toEqual({ entity: { filter: [{ domain: ["binary_sensor", "cover"] }] } });
  });

  it("maps view-model patches back to config shape", () => {
    const form = openingForm(door);
    expect(form.toPatch({ motion: "swing" })).toEqual({ motion: undefined, sliderStyle: undefined });
    expect(form.toPatch({ motion: "slide" })).toEqual({ motion: "slide" });
    expect(form.toPatch({ hinge: "right" })).toEqual({ flipH: true });
    expect(form.toPatch({ hinge: "left" })).toEqual({ flipH: undefined });
    expect(form.toPatch({ opens: "other" })).toEqual({ flipV: true });
    expect(form.toPatch({ slide: "left" })).toEqual({ flipH: undefined });
    expect(form.toPatch({ style: "single" })).toEqual({ sliderStyle: undefined });
    expect(form.toPatch({ style: "bypass" })).toEqual({ sliderStyle: "bypass" });
    expect(form.toPatch({ invert: false })).toEqual({ invert: undefined });
    expect(form.toPatch({ invert: true })).toEqual({ invert: true });
    expect(form.toPatch({ entity: undefined })).toEqual({ entity: undefined });
    expect(form.toPatch({ length: 50, angle: 10 })).toEqual({ length: 50, angle: 10 });
  });

  it("exposes derived view-model values in data", () => {
    const d = openingForm({ ...door, flipH: true } as Opening).data;
    expect(d.motion).toBe("swing");
    expect(d.hinge).toBe("right");
    expect(d.opens).toBe("this");
    expect(d.style).toBe("single");
  });
});

describe("itemForm", () => {
  const item = { id: "i", entity: "light.a", kind: "light", x: 0, y: 0 } as FloorItem;

  it("hides ripple size for badge display, shows it otherwise", () => {
    expect(itemForm(item).fields.map((x) => x.name)).not.toContain("rippleSize");
    expect(
      itemForm({ ...item, display: "ripple" } as FloorItem).fields.map((x) => x.name)
    ).toContain("rippleSize");
  });

  it("offers Show name, and Label size only while a label line renders (#61, #59)", () => {
    // A light shows no label by default → no size slider.
    const light = itemForm(item);
    expect(light.fields.map((x) => x.name)).toContain("showName");
    expect(light.fields.map((x) => x.name)).not.toContain("labelSize");
    // Sensors label by default; showName or showState also reveal the slider.
    const sensor = itemForm({ ...item, entity: "sensor.a", kind: "sensor" } as FloorItem);
    expect(sensor.fields.map((x) => x.name)).toContain("labelSize");
    const namedLight = itemForm({ ...item, showName: true } as FloorItem);
    expect(namedLight.fields.map((x) => x.name)).toContain("labelSize");
    expect(namedLight.data.showName).toBe(true);
    expect(namedLight.data.labelSize).toBe(12);
    expect(
      itemForm({ ...item, showName: true, labelSize: 20 } as FloorItem).data.labelSize
    ).toBe(20);
  });

  it("offers the three action fields with behavior-preserving defaults", () => {
    const fs = itemForm(item).fields;
    expect(fs.find((x) => x.name === "tap_action")!.selector).toEqual({
      ui_action: { default_action: "toggle" },
    });
    expect(fs.find((x) => x.name === "hold_action")!.selector).toEqual({
      ui_action: { default_action: "none" },
    });
    const sensor = itemForm({ ...item, entity: "sensor.a" } as FloorItem).fields;
    expect(sensor.find((x) => x.name === "tap_action")!.selector).toEqual({
      ui_action: { default_action: "more-info" },
    });
  });

  it("data presents effective defaults", () => {
    const d = itemForm(item).data;
    expect(d.showIcon).toBe(true);
    expect(d.showState).toBe(false);
    expect(d.display).toBe("badge");
    expect(d.angle).toBe(0);
  });
});

describe("textForm / furnitureForm / trackerForm", () => {
  it("text field is required (empty stays empty, not undefined)", () => {
    const form = textForm({ id: "t", x: 0, y: 0, text: "hi" });
    expect(form.fields.find((x) => x.name === "text")!.required).toBe(true);
  });

  it("furniture type options carry human labels", () => {
    const form = furnitureForm({ id: "f", type: "roundTable", x: 0, y: 0, w: 10, h: 10 } as never);
    const type = form.fields.find((x) => x.name === "type")!;
    const options = (type.selector.select as { options: { value: string; label: string }[] }).options;
    expect(options.find((o) => o.value === "roundTable")!.label).toBe("round table");
  });

  it("tracker exposes rounded position", () => {
    const d = trackerForm({ id: "t", x: 1.6, y: 2.2, w: 20, h: 20 } as never).data;
    expect(d).toMatchObject({ x: 2, y: 2, w: 20, h: 20 });
  });
});

describe("wallForm / projectForm / floorImageForm", () => {
  it("wall exposes rounded coordinates", () => {
    const d = wallForm({ id: "w", x1: 1.4, y1: 2.6, x2: 3, y2: 4 }).data;
    expect(d).toMatchObject({ x1: 1, y1: 3, x2: 3, y2: 4 });
  });

  it("project fields are required numbers with min 1", () => {
    const form = projectForm({ type: "t", width: 1000, height: 600 } as FloorplanCardConfig);
    const width = form.fields.find((x) => x.name === "width")!;
    expect(width.required).toBe(true);
    expect((width.selector.number as { min: number }).min).toBe(1);
  });

  it("rotation lives in its own bottom-row form, defaults to 0°, and patches as a number", () => {
    const form = projectRotationForm({ type: "t", width: 1000, height: 600 } as FloorplanCardConfig);
    expect(form.fields.map((x) => x.name)).toEqual(["rotation"]);
    expect(form.data.rotation).toBe("0");
    // 0 comes back as undefined so an unrotated plan stays out of the YAML.
    expect(form.toPatch({ rotation: "0" })).toEqual({ rotation: undefined });
    expect(form.toPatch({ rotation: "90" })).toEqual({ rotation: 90 });
    const rotated = projectRotationForm({
      type: "t",
      width: 1000,
      height: 600,
      rotation: 270,
    } as FloorplanCardConfig);
    expect(rotated.data.rotation).toBe("270");
  });

  it("image opacity appears only when an image is set", () => {
    expect(floorImageForm({ image: "x.png" } as Floor).fields.map((x) => x.name)).toContain(
      "imageOpacity"
    );
    expect(floorImageForm({} as Floor).fields.map((x) => x.name)).not.toContain("imageOpacity");
  });
});
