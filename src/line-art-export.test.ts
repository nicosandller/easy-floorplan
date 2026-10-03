// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createLineArtSvg } from "./line-art-export";
import { emptyConfig, getFloors } from "./types";

function fixture() {
  const config = emptyConfig("custom:easy-floorplan-card");
  config.width = 700;
  config.height = 480;
  config.view = "3d";
  const floor = getFloors(config)[0];
  floor.name = 'Ground & <script>alert("x")</script>';
  floor.walls = [{ id: "wall", x1: 80, y1: 80, x2: 620, y2: 80, thickness: 8 }];
  floor.openings = [{ id: "door", type: "door", x: 240, y: 80, length: 70, angle: 0, entity: "binary_sensor.private" }];
  floor.areas = [{ id: "living", name: "Living <room>", points: [{ x: 80, y: 80 }, { x: 620, y: 80 }, { x: 620, y: 400 }, { x: 80, y: 400 }] }];
  floor.furniture = [{ id: "sofa", type: "sofa", x: 200, y: 180, w: 100, h: 50, entity: "light.private" }];
  floor.image = "https://example.invalid/private.png";
  return { config, floor };
}
const parse = (svg: string) => new DOMParser().parseFromString(svg, "image/svg+xml");

describe("standalone line art", () => {
  it("creates valid, escaped, self-contained XML without live entity hooks or runtime markup", () => {
    const { config, floor } = fixture();
    const before = JSON.stringify({ config, floor });
    const out = createLineArtSvg(config, floor, 0);
    const doc = parse(out.svg);
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelector("title")?.textContent).toContain(floor.name);
    expect(doc.querySelector("text")?.textContent).toBe("Living <room>");
    expect(doc.querySelector("script, image, foreignObject, style")).toBeNull();
    expect(out.svg).not.toMatch(/data-entity|binary_sensor|light\.private|https:\/\/example|var\(|<!--|style=/);
    expect(out.filename).not.toMatch(/[<>/\\:]/);
    expect(JSON.stringify({ config, floor })).toBe(before);
  });

  it("uses opaque faces and real edges without the wall chunk seams", () => {
    const { config, floor } = fixture();
    const doc = parse(createLineArtSvg(config, floor, 0).svg);
    expect(doc.querySelectorAll(".fp-iso-face").length).toBeGreaterThan(4);
    expect(doc.querySelector(".fp-iso-shade, .fp-iso-opening-hit")).toBeNull();
    for (const face of doc.querySelectorAll(".fp-iso-face")) {
      expect(face.getAttribute("fill")).toBe("#ffffff");
      expect(face.getAttribute("stroke")).toBeNull();
    }
    // A middle chunk gets top and bottom long edges, but no upright end seam.
    const paths = [...doc.querySelectorAll(".solid-edges")].map((e) => e.getAttribute("d")!);
    expect(paths.some((d) => (d.match(/M/g) ?? []).length === 3)).toBe(true);
  });

  it("keeps visible wall corners after joined-wall rendering without adding seams to straight joins", () => {
    const { config, floor } = fixture();
    floor.openings = [];
    floor.furniture = [];
    floor.areas = [];
    config.wallHeight = 60;
    const wall = (x1: number, y1: number, x2: number, y2: number) =>
      ({ id: `${x1},${y1}`, x1, y1, x2, y2, thickness: 8 });
    const uprights = () => {
      const doc = parse(createLineArtSvg(config, floor, 0).svg);
      const points = [...doc.querySelectorAll(".solid-edges")].flatMap(e =>
        [...e.getAttribute("d")!.matchAll(/M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)/g)]
          .map(m => m.slice(1).map(Number))
          .filter(([x, y, tx, ty]) => Math.abs(x - tx - 60) < .001 && Math.abs(y - ty - 60) < .001)
          .map(([x, y]) => `${x},${y}`));
      return [...new Set(points)].sort();
    };
    floor.walls = [wall(0, 0, 100, 0), wall(100, 0, 100, 100), wall(100, 100, 0, 100), wall(0, 100, 0, 0)];
    // Facing boundary corners only. The painter covers the two inner side
    // corners with nearer wall faces; no chunk or miter seam is outlined.
    expect(uprights()).toEqual(["-4,104", "104,-4", "104,104", "4,4", "4,96", "96,4"].sort());
    floor.walls = [wall(0, 0, 100, 0), wall(100, 0, 200, 0)];
    expect(uprights()).toEqual(["-4,4", "204,-4", "204,4"].sort());
    floor.walls = [wall(0, 0, 200, 0), wall(100, 0, 100, 100)];
    expect(uprights()).toEqual(["-4,4", "204,-4", "204,4", "96,4", "104,4", "96,104", "104,104"].sort());
  });

  it.each(["2d", "3d"] as const)("rotates %s geometry and keeps room names upright", (view) => {
    const { config, floor } = fixture();
    config.view = view;
    const doc = parse(createLineArtSvg(config, floor, 90).svg);
    expect(doc.querySelector('g[transform="translate(480 0) rotate(90)"]')).not.toBeNull();
    const label = doc.querySelector("text")!;
    expect(label.closest("g[transform]")).toBeNull();
    expect(Number(label.getAttribute("x"))).toBeGreaterThan(0);
    expect(doc.querySelector(".fp-iso") !== null).toBe(view === "3d");
  });

  it("exports zero-height 3D as flat symbols and freezes door CSS transforms", () => {
    const { config, floor } = fixture();
    config.wallHeight = 0;
    const doc = parse(createLineArtSvg(config, floor, 0).svg);
    expect(doc.querySelector(".fp-iso")).toBeNull();
    expect(doc.querySelector(".fp-door-leaf")?.getAttribute("transform")).toBe("rotate(-90)");
    expect(doc.querySelector(".fp-furniture")).not.toBeNull();
  });

  it("includes generated room walls, dividers, railings and custom furniture", () => {
    const { config, floor } = fixture();
    floor.walls.push({ id: "divider", x1: 200, y1: 80, x2: 200, y2: 400, divider: true });
    floor.walls.push({ id: "rail", x1: 80, y1: 400, x2: 620, y2: 400, kind: "railing" });
    floor.areas[0].sideWalls = { left: "wall" };
    config.symbols = { custom: { name: "Custom", viewBox: [0, 0, 100, 100], parts: [{ circle: [50, 50, 40] }] } };
    floor.furniture[0].type = "custom";
    const doc = parse(createLineArtSvg(config, floor, 0).svg);
    expect(doc.querySelector('line[stroke-dasharray="5 4"]')).not.toBeNull();
    expect(doc.querySelector(".fp-iso-railing")).not.toBeNull();
    expect(doc.querySelector(".fp-furniture-custom circle")).not.toBeNull();
  });
});
