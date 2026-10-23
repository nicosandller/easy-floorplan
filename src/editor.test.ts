// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import { rectAreaSideWallSegments } from "./editor-geometry";
import type { FloorplanCardConfig } from "./types";

function config(): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 600,
    grid: 20,
    snap: 0,
    floors: [
      {
        id: "f1",
        name: "Floor 1",
        walls: [],
        openings: [],
        items: [],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      },
    ],
  };
}

async function mountEditor(points: Array<{ x: number; y: number }>): Promise<FloorplanCardEditor> {
  const host = document.createElement("div");
  host.style.width = "900px";
  document.body.appendChild(host);

  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
  ed.setConfig({
    ...config(),
    floors: [
      {
        ...config().floors![0],
        areas: [{ id: "room1", points }],
      },
    ],
  });
  host.appendChild(ed);
  await ed.updateComplete;
  (ed as any)._selection = [{ kind: "area", id: "room1" }];
  await ed.updateComplete;
  return ed;
}

describe("editor side-wall toggles", () => {
  it("_toggleRectAreaSide cycles a rectangle edge across full interval", async () => {
    const ed = await mountEditor([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 240 },
      { x: 100, y: 240 },
    ]);

    const area = (ed as any)._floor().areas[0];
    (ed as any)._toggleRectAreaSide(area, 2);
    await ed.updateComplete;
    expect((ed as any)._floor().areas[0].sideWalls?.bottom).toBe("wall");

    (ed as any)._toggleRectAreaSide((ed as any)._floor().areas[0], 2);
    await ed.updateComplete;
    expect((ed as any)._floor().areas[0].sideWalls?.bottom).toBe("divider");

    (ed as any)._toggleRectAreaSide((ed as any)._floor().areas[0], 2);
    await ed.updateComplete;
    expect((ed as any)._floor().areas[0].sideWalls?.bottom).toBeUndefined();

    document.body.innerHTML = "";
  });

  it("_toggleRectAreaSide applies full clicked edge interval on an L recess edge", async () => {
    const ed = await mountEditor([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 200 },
      { x: 200, y: 200 },
      { x: 200, y: 300 },
      { x: 100, y: 300 },
    ]);

    const area = (ed as any)._floor().areas[0];
    (ed as any)._toggleRectAreaSide(area, 2);
    await ed.updateComplete;

    const bottom = rectAreaSideWallSegments((ed as any)._floor().areas[0].sideWalls?.bottom);
    expect(bottom).toEqual([{ start: 0.5, end: 1, state: "wall" }]);

    document.body.innerHTML = "";
  });
});
