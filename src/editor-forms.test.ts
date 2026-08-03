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
  areaForm,
  areaNameForm,
} from "./editor-forms";
import type { FormField } from "./editor-forms";
import type { Area, Opening, FloorItem, Floor, FloorplanCardConfig } from "./types";
import { DEFAULT_GLOW_RADIUS } from "./types";

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

  it("roll-up opening hides swing and slide fields (issue #45)", () => {
    const motionField = openingForm(door).fields.find((x) => x.name === "motion")!;
    const opts = (motionField.selector as { select: { options: { value: string }[] } }).select
      .options.map((o) => o.value);
    expect(opts).toEqual(["swing", "slide", "roll"]);
    const roll = openingForm({ ...door, motion: "roll" } as Opening).fields.map((x) => x.name);
    expect(roll).not.toContain("hinge");
    expect(roll).not.toContain("opens");
    expect(roll).not.toContain("slide");
    expect(roll).not.toContain("style");
    expect(openingForm(door).toPatch({ motion: "roll" })).toEqual({
      motion: "roll",
      sliderStyle: undefined,
    });
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

  it("offers Cast light on lights only, with its controls behind the toggle (#6)", () => {
    const names = (it: FloorItem) => itemForm(it).fields.map((x) => x.name);
    expect(names(item)).toContain("glow");
    // Radius/colour would be noise on a device that isn't casting yet.
    expect(names(item)).not.toContain("glowRadius");
    const lit = { ...item, glow: true } as FloorItem;
    expect(names(lit)).toContain("glowRadius");
    expect(names(lit)).toContain("glowColor");
    expect(itemForm(lit).data.glowRadius).toBe(DEFAULT_GLOW_RADIUS);
    // A sensor has no colour to cast, so it is never offered.
    expect(names({ ...item, kind: "sensor", entity: "sensor.temp" } as FloorItem)).not.toContain("glow");
  });

  it("hides ripple size for badge display, shows it otherwise", () => {
    expect(itemForm(item).fields.map((x) => x.name)).not.toContain("rippleSize");
    expect(
      itemForm({ ...item, display: "ripple" } as FloorItem).fields.map((x) => x.name)
    ).toContain("rippleSize");
  });

  it("offers the icon-animation dropdown defaulting to auto", () => {
    const f = itemForm(item).fields.find((x) => x.name === "iconAnimation");
    expect(f).toBeDefined();
    const opts = (f!.selector as { select: { options: { value: string }[] } }).select.options.map(
      (o) => o.value
    );
    expect(opts).toEqual(["auto", "none", "spin", "pulse"]);
    expect(itemForm(item).data.iconAnimation).toBe("auto");
    expect(itemForm({ ...item, iconAnimation: "spin" } as FloorItem).data.iconAnimation).toBe(
      "spin"
    );
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

  it("scopes the entity/secondaryEntity pickers to the area's entities when given", () => {
    const unscoped = itemForm(item);
    expect(unscoped.fields.find((x) => x.name === "entity")!.selector).toEqual({ entity: {} });
    const scoped = itemForm({ ...item, entity: "light.kitchen" } as FloorItem, {
      entities: ["light.kitchen", "switch.kitchen"],
      name: "Kitchen",
    });
    expect(scoped.fields.find((x) => x.name === "entity")!.selector).toEqual({
      entity: { include_entities: ["light.kitchen", "switch.kitchen"] },
    });
    expect(scoped.fields.find((x) => x.name === "secondaryEntity")!.selector).toEqual({
      entity: { include_entities: ["light.kitchen", "switch.kitchen"] },
    });
  });

  it("an empty area list does NOT filter — an empty picker would hide everything", () => {
    // Regression: `[]` is truthy, so the old code emitted
    // `include_entities: []` and the picker listed nothing at all — the
    // common case when a linked HA area has no entities assigned.
    const scoped = itemForm(item, { entities: [], name: "Kitchen" });
    expect(scoped.fields.find((x) => x.name === "entity")!.selector).toEqual({ entity: {} });
    expect(scoped.fields.find((x) => x.name === "entity")!.helper).toBeUndefined();
  });

  it("always keeps the bound entity pickable, even from another area", () => {
    const scoped = itemForm({ ...item, entity: "light.hallway" } as FloorItem, {
      entities: ["light.kitchen"],
      name: "Kitchen",
    });
    expect(scoped.fields.find((x) => x.name === "entity")!.selector).toEqual({
      entity: { include_entities: ["light.kitchen", "light.hallway"] },
    });
  });

  it("says why the list is short, and how to widen it", () => {
    const scoped = itemForm(item, { entities: ["light.kitchen"], name: "Kitchen" });
    const helper = scoped.fields.find((x) => x.name === "entity")!.helper!;
    expect(helper).toContain("Kitchen");
    expect(helper).toContain("Filter entities");
    // The secondary picker keeps its own explanation too.
    expect(scoped.fields.find((x) => x.name === "secondaryEntity")!.helper).toContain(
      "Shown next to the primary state"
    );
  });
});

describe("areaNameForm", () => {
  const area = (extra: Partial<Area> = {}): Area => ({
    id: "a",
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    ...extra,
  });

  it("offers the HA areas as a typeable dropdown (so HA renders it natively)", () => {
    const name = areaNameForm(area(), ["Bedroom", "Living Room"]).fields[0];
    expect(name.selector).toEqual({
      select: {
        options: [
          { value: "Bedroom", label: "Bedroom" },
          { value: "Living Room", label: "Living Room" },
        ],
        custom_value: true,
        mode: "dropdown",
        sort: false,
      },
    });
  });

  it("degrades to a plain text field when there are no HA areas to offer", () => {
    expect(areaNameForm(area()).fields[0].selector).toEqual({ text: {} });
  });

  it("carries the current name as its data", () => {
    expect(areaNameForm(area({ name: "Kitchen" })).data).toEqual({ name: "Kitchen" });
    expect(areaNameForm(area()).data).toEqual({ name: "" });
  });
});

describe("areaForm", () => {
  const area = (extra: Partial<Area> = {}): Area => ({
    id: "a",
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    ...extra,
  });

  it("data presents effective defaults (showName true, DEFAULT_AREA_OPACITY)", () => {
    const d = areaForm(area()).data;
    expect(d).toMatchObject({ showName: true, opacity: 0.25 });
  });

  it("data reflects an explicit showName/opacity", () => {
    const d = areaForm(area({ name: "Kitchen", showName: false, opacity: 0.5 })).data;
    expect(d).toMatchObject({ showName: false, opacity: 0.5 });
  });

  it("keeps name out of the style form — it's its own form, above the link status", () => {
    expect(areaForm(area({ name: "Kitchen" })).fields.some((x) => x.name === "name")).toBe(false);
  });

  it("opacity field is a 0..1 slider", () => {
    const f = areaForm(area()).fields.find((x) => x.name === "opacity")!;
    expect(f.selector).toEqual({ number: { min: 0, max: 1, step: 0.05, mode: "slider" } });
  });

  it("clamps an out-of-range opacity patch via normalizeFormPatch", () => {
    const fields = areaForm(area()).fields;
    expect(normalizeFormPatch({ opacity: 5 }, fields)).toEqual({ opacity: 1 });
    expect(normalizeFormPatch({ opacity: -1 }, fields)).toEqual({ opacity: 0 });
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

  // Issue #82: furniture can bind an entity so the drawing goes live.
  it("furniture offers an optional entity, empty when unbound", () => {
    const form = furnitureForm({ id: "f", type: "plant", x: 0, y: 0, w: 10, h: 10 } as never);
    const entity = form.fields.find((x) => x.name === "entity")!;
    expect(entity.required).toBeUndefined();
    expect(entity.selector).toEqual({ entity: {} });
    expect(form.data.entity).toBe("");
  });

  it("furniture entity picker scopes to a linked HA area when given one", () => {
    const form = furnitureForm({ id: "f", type: "plant", x: 0, y: 0, w: 10, h: 10 } as never, {
      entities: ["sensor.soil"],
      name: "Living room",
    });
    expect(form.fields.find((x) => x.name === "entity")!.selector).toEqual({
      entity: { include_entities: ["sensor.soil"] },
    });
  });

  it("sectional keeps its chaise-side field alongside the entity", () => {
    const form = furnitureForm({
      id: "f",
      type: "sectional",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      entity: "binary_sensor.x",
    } as never);
    expect(form.fields.map((x) => x.name)).toContain("hand");
    expect(form.data).toMatchObject({ hand: "right", entity: "binary_sensor.x" });
  });

  it("non-sectional furniture has no chaise-side field or data", () => {
    const form = furnitureForm({ id: "f", type: "table", x: 0, y: 0, w: 10, h: 10 } as never);
    expect(form.fields.map((x) => x.name)).not.toContain("hand");
    expect("hand" in form.data).toBe(false);
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

describe("openingForm — sash and shutter (issues #73 / #74)", () => {
  const win = { id: "w1", type: "window", x: 0, y: 0, length: 90, angle: 0 } as Opening;

  it("swing windows offer Sashes; single sash reveals Hinge", () => {
    const names = openingForm(win).fields.map((x) => x.name);
    expect(names).toContain("sash");
    expect(names).not.toContain("hinge"); // double: no single hinge
    const single = openingForm({ ...win, sash: "single" } as Opening).fields.map((x) => x.name);
    expect(single).toContain("hinge");
    // doors and sliders don't get a sash field
    expect(openingForm(door).fields.map((x) => x.name)).not.toContain("sash");
    expect(
      openingForm({ ...win, motion: "slide" } as Opening).fields.map((x) => x.name)
    ).not.toContain("sash");
  });

  it("every opening offers a Shutter picker taking covers or contact sensors", () => {
    // Doors get shutters too (French/patio doors), and a hinged shutter
    // usually reports through a binary_sensor rather than a cover (#74).
    for (const o of [win, door]) {
      const f = openingForm(o).fields.find((x) => x.name === "shutterEntity");
      expect(f).toBeDefined();
      expect(f!.selector).toEqual({
        entity: { filter: [{ domain: ["cover", "binary_sensor"] }] },
      });
    }
  });

  it("the shutter type appears only once one is bound, and defaults per domain", () => {
    expect(openingForm(win).fields.map((x) => x.name)).not.toContain("shutterStyle");
    const contact = openingForm({ ...win, shutterEntity: "binary_sensor.shutter" } as Opening);
    expect(contact.fields.map((x) => x.name)).toContain("shutterStyle");
    expect(contact.data.shutterStyle).toBe("swing");
    const roller = openingForm({ ...win, shutterEntity: "cover.tapparella" } as Opening);
    expect(roller.data.shutterStyle).toBe("roll");
    // An explicit choice overrides the domain default either way.
    expect(
      openingForm({ ...win, shutterEntity: "cover.x", shutterStyle: "swing" } as Opening).data
        .shutterStyle
    ).toBe("swing");
  });

  it("patches map back to config shape (double stays out of the YAML)", () => {
    const form = openingForm(win);
    expect(form.toPatch({ sash: "single" })).toEqual({ sash: "single" });
    expect(form.toPatch({ sash: "double" })).toEqual({ sash: undefined });
    expect(form.data.sash).toBe("double");
    expect(openingForm({ ...win, sash: "single" } as Opening).data.sash).toBe("single");
  });
});

describe("area scoping never traps you (issue reported on #83)", () => {
  const item = { id: "i", entity: "", kind: "light", x: 0, y: 0 } as FloorItem;

  it("outside every area, and inside an empty one, nothing is filtered", () => {
    // No scope at all — the element sits outside every area.
    expect(itemForm(item).fields.find((x) => x.name === "entity")!.selector).toEqual({
      entity: {},
    });
    // Inside an area whose HA area has no entities: same, unfiltered.
    expect(
      itemForm(item, { entities: [], name: "Spare" }).fields.find((x) => x.name === "entity")!
        .selector
    ).toEqual({ entity: {} });
  });
});
