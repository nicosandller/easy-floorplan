// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { dump, load, YAML11_SCHEMA } from "js-yaml";
import { validateYCoordinates } from "./config-coordinates";
import type { FloorplanCardConfig, Opening } from "./types";
import "./floorplan-card";
import "./editor";

const yaml = (key: string) => `type: custom:easy-floorplan-card
openings:
  - id: velux
    type: skylight
    x: 480
    ${key}: 141
    length: 78
    width: 98
    angle: 0
`;
const parse = (text: string) => load(text, { schema: YAML11_SCHEMA }) as FloorplanCardConfig;

describe("YAML coordinates (#312)", () => {
  for (const tag of ["easy-floorplan-card", "easy-floorplan-card-editor"] as const) {
    it.each(["y", "Y"])(`${tag} identifies a misparsed %s before rendering`, (key) => {
      const config = parse(yaml(key));
      expect(config.openings![0]).toMatchObject({ true: 141 });
      const element = document.createElement(tag);
      expect(() => element.setConfig(config)).toThrow(/openings\[0\]\.y.*Replace the "true" key.*'y'/);
    });
    it(`${tag} accepts quoted y through HA's parse/save/parse cycle`, () => {
      const config = parse(dump(parse(yaml("'y'")), { schema: YAML11_SCHEMA, noRefs: true }));
      expect(config.openings![0].y).toBe(141);
      expect(() => document.createElement(tag).setConfig(config)).not.toThrow();
    });
  }

  it("explains why quoted uppercase Y still is not a coordinate", () => {
    expect(() => validateYCoordinates(parse(yaml("'Y'")))).toThrow(/Replace the "Y" key/);
  });
  it.each([undefined, null, "141", false, NaN, Infinity])("rejects missing or invalid y (%s)", (y) => {
    const c = parse(yaml("'y'"));
    c.openings![0] = { ...c.openings![0], y } as Opening;
    expect(() => validateYCoordinates(c)).toThrow(/openings\[0\]\.y must be a finite number/);
  });
  it.each([0, -20, 141])("accepts finite coordinates including zero and negatives (%s)", (y) => {
    const c = parse(yaml("'y'"));
    c.openings![0].y = y;
    expect(() => validateYCoordinates(c)).not.toThrow();
  });
  it.each(["openings", "items", "texts", "furniture", "trackers"])("checks %s on every floor", (key) => {
    const c = { type: "custom:easy-floorplan-card", floors: [{ id: "first" }, { id: "second", [key]: [{ x: 10, true: 40 }] }] } as unknown as FloorplanCardConfig;
    expect(() => validateYCoordinates(c)).toThrow(`floors[1].${key}[0].y`);
  });
  it("checks area vertices and the floor switcher", () => {
    const c = { type: "custom:easy-floorplan-card", areas: [{ points: [{ x: 1, true: 2 }] }] } as unknown as FloorplanCardConfig;
    expect(() => validateYCoordinates(c)).toThrow("areas[0].points[0].y");
    expect(() => validateYCoordinates({ ...c, areas: [], floorSwitcher: { x: 1, true: 2 } } as unknown as FloorplanCardConfig)).toThrow("floorSwitcher.y");
  });
  it("ignores unused legacy arrays and arbitrary action payloads", () => {
    const c = { type: "custom:easy-floorplan-card", floors: [{ id: "up", items: [{ x: 0, y: 0, tap_action: { data: { Y: 1 } } }] }], openings: [{ true: 141 }] } as unknown as FloorplanCardConfig;
    const before = JSON.stringify(c);
    expect(() => validateYCoordinates(c)).not.toThrow();
    expect(JSON.stringify(c)).toBe(before);
  });
  it("preserves the default placement for an incomplete optional floor switcher", () => {
    for (const floorSwitcher of [{}, { x: 20 }, { y: 20 }]) {
      expect(() => validateYCoordinates({
        type: "custom:easy-floorplan-card", width: 500, height: 400, floorSwitcher,
      } as unknown as FloorplanCardConfig)).not.toThrow();
    }
  });
});

const examples = import.meta.glob<string>(["../README.md", "../docs/*.md", "../docker/config/floorplan-demo.yaml"], {
  query: "?raw", import: "default", eager: true,
});

describe("published YAML coordinates survive HA's schema", () => {
  for (const [file, text] of Object.entries(examples)) {
    const blocks = file.endsWith(".yaml") ? [text] : [...text.matchAll(/```yaml\n([\s\S]*?)\n```/g)].map(m => m[1]);
    blocks.forEach((block, index) => {
      if (!/(?:^|[\s,{])['"]?y['"]?\s*:/m.test(block)) return;
      it(`${file}, example ${index + 1}`, () => {
        // Compare coordinates with YAML 1.2, which did not reinterpret y.
        // An unquoted key in any nested sample fails this check under YAML 1.1.
        const expected = load(block);
        const actual = parse(dump(parse(block), { schema: YAML11_SCHEMA }));
        let count = 0;
        const compare = (a: unknown, b: unknown): void => {
          if (!a || typeof a !== "object") return;
          for (const [key, value] of Object.entries(a)) {
            const other = (b as Record<string, unknown>)?.[key];
            if (key === "y") { expect(other).toBe(value); count++; }
            else compare(value, other);
          }
        };
        compare(expected, actual);
        expect(count).toBeGreaterThan(0);
      });
    });
  }
});
