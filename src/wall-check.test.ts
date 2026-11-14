import { describe, expect, it } from "vitest";
import type { Wall } from "./types";
import { applyWallFix, wallFindings, wallFindingsCached } from "./wall-check";

// A 400 x 300 room, corners shared exactly, as the editor draws it.
const room: Wall[] = [
  { id: "top", x1: 0, y1: 0, x2: 400, y2: 0 },
  { id: "right", x1: 400, y1: 0, x2: 400, y2: 300 },
  { id: "bottom", x1: 400, y1: 300, x2: 0, y2: 300 },
  { id: "left", x1: 0, y1: 300, x2: 0, y2: 0 },
];
const partition = (x2: number): Wall => ({ id: "partition", x1: 0, y1: 150, x2, y2: 150 });

describe("plan check: wall ends (#403)", () => {
  it("flags nothing on a closed room", () => {
    expect(wallFindings(room)).toEqual([]);
  });

  it("flags nothing at a T-junction", () => {
    expect(wallFindings([...room, partition(400)])).toEqual([]);
  });

  it("flags nothing where a wall runs a little past the one it meets", () => {
    expect(wallFindings([...room, partition(403)])).toEqual([]);
  });

  it("flags nothing across a doorway-wide gap", () => {
    expect(wallFindings([...room, partition(320)])).toEqual([]);
  });

  it("flags a wall end that stops inside the next wall's thickness", () => {
    expect(wallFindings([...room, partition(396)])).toEqual([{
      kind: "near-miss", wallId: "partition", wallIndex: 4, end: 2, otherId: "right",
      point: { x: 396, y: 150 }, to: { x: 400, y: 150 }, gap: 4,
    }]);
  });

  it("flags a 2-unit miss, and Join closes it", () => {
    const walls = [...room, partition(398)];
    const [finding] = wallFindings(walls);
    expect(finding).toMatchObject({ kind: "near-miss", gap: 2, to: { x: 400, y: 150 } });
    const fixed = applyWallFix(walls, finding!);
    expect(fixed[4]).toEqual(partition(400));
    expect(wallFindings(fixed)).toEqual([]);
    expect(walls[4]).toEqual(partition(398));
  });

  it("widens the tolerance for thick walls", () => {
    // Thickness is drawn at most 10 units wide, so 10 + 10 strokes hide 10.
    const thick = (walls: Wall[]) => walls.map(w => ({ ...w, thickness: 10 }));
    expect(wallFindings(thick([...room, partition(391.5)]))).toHaveLength(1);
    expect(wallFindings([...room, partition(391.5)])).toEqual([]);
  });

  it("reports two collinear walls stopping short of each other once", () => {
    const walls: Wall[] = [
      { id: "a", x1: 0, y1: 0, x2: 100, y2: 0 },
      { id: "b", x1: 104, y1: 0, x2: 200, y2: 0 },
    ];
    expect(wallFindings(walls)).toEqual([expect.objectContaining({
      kind: "near-miss", wallId: "a", end: 2, otherId: "b", to: { x: 104, y: 0 },
    })]);
  });

  it("leaves a wall laid alongside another alone", () => {
    const walls: Wall[] = [
      { id: "a", x1: 0, y1: 0, x2: 200, y2: 0 },
      { id: "b", x1: 50, y1: 5, x2: 150, y2: 5 },
    ];
    expect(wallFindings(walls)).toEqual([]);
  });
});

describe("plan check: walls on top of walls (#403)", () => {
  it("flags an exact duplicate, and Remove keeps one copy", () => {
    const walls = [...room, { ...room[0]!, id: "copy" }];
    const findings = wallFindings(walls);
    expect(findings).toEqual([{
      kind: "duplicate", wallId: "copy", wallIndex: 4, otherId: "top", point: { x: 200, y: 0 },
    }]);
    expect(applyWallFix(walls, findings[0]!)).toEqual(room);
  });

  it("flags a reversed duplicate", () => {
    const walls = [...room, { id: "copy", x1: 400, y1: 0, x2: 0, y2: 0 }];
    expect(wallFindings(walls)).toEqual([expect.objectContaining({ kind: "duplicate", wallId: "copy" })]);
  });

  it("removes the shorter of two walls when one lies inside the other", () => {
    const walls: Wall[] = [{ id: "short", x1: 100, y1: 0, x2: 200, y2: 0 }, ...room];
    expect(wallFindings(walls)).toEqual([expect.objectContaining({
      kind: "duplicate", wallId: "short", wallIndex: 0, otherId: "top",
    })]);
  });

  it("flags a partial collinear overlap, and Trim makes the walls meet", () => {
    const walls: Wall[] = [
      { id: "a", x1: 0, y1: 0, x2: 100, y2: 0 },
      { id: "b", x1: 60, y1: 0, x2: 160, y2: 0 },
    ];
    const findings = wallFindings(walls);
    expect(findings).toEqual([{
      kind: "overlap", wallId: "b", wallIndex: 1, end: 1, otherId: "a",
      point: { x: 80, y: 0 }, to: { x: 100, y: 0 }, length: 40,
    }]);
    const fixed = applyWallFix(walls, findings[0]!);
    expect(fixed[1]).toEqual({ id: "b", x1: 100, y1: 0, x2: 160, y2: 0 });
    expect(wallFindings(fixed)).toEqual([]);
  });

  it("flags nothing for a wall split in two end to end", () => {
    expect(wallFindings([
      { id: "a", x1: 0, y1: 0, x2: 100, y2: 0 },
      { id: "b", x1: 100, y1: 0, x2: 200, y2: 0 },
    ])).toEqual([]);
  });
});

describe("plan check: fixes and caching", () => {
  it("changes nothing when the finding is for other walls", () => {
    const walls = [...room, partition(396)];
    const [finding] = wallFindings(walls);
    expect(applyWallFix(room, finding!)).toEqual(room);
  });

  it("reuses the result for the same walls array", () => {
    const walls = [...room, partition(396)];
    expect(wallFindingsCached(walls)).toBe(wallFindingsCached(walls));
  });
});
