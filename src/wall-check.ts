/**
 * The editor's plan check (issue #403): wall ends that nearly meet another
 * wall, and walls drawn on top of one another.
 *
 * Neither shows on the plan. A wall end that stops a few units short of the
 * next wall hides inside that wall's stroke, and a second wall on the same
 * line draws exactly where the first one does. Both mostly come from YAML
 * written by hand or by a tool, so the editor's drawing-time snapping never
 * saw them. The card copes with the first since issue #360 (the daylight trace
 * joins such ends itself), but the plan stays wrong, and dead spaces, room
 * light and anything else that reads the walls still see the gap.
 *
 * Pure geometry: given a floor's walls, list what looks wrong and how to fix
 * it. The editor draws the markers and applies the fix; the card never calls
 * this.
 */
import type { AreaPoint, Wall } from "./types";
import { nearestWall, wallPoint } from "./ambient-daylight-walls";
import { OPENING_ON_WALL_EPS, WELD_EPS } from "./dead-space";
import { wallThickness } from "./render";

/** A wall end that stops short of another wall without reaching it. */
export interface WallNearMiss {
  kind: "near-miss";
  /** The wall whose end falls short, and which end (1 or 2). */
  wallId: string;
  wallIndex: number;
  end: 1 | 2;
  /** The wall it nearly meets. */
  otherId: string;
  /** Where the end is now. */
  point: AreaPoint;
  /** Where Join moves it: the nearest point of the other wall. */
  to: AreaPoint;
  /** How far short it stops, in canvas units. */
  gap: number;
}

/** A wall that lies wholly on another wall of the same line. */
export interface WallDuplicate {
  kind: "duplicate";
  /** The wall Remove deletes: the shorter one, or the later of two equals. */
  wallId: string;
  wallIndex: number;
  otherId: string;
  /** The middle of the duplicated stretch. */
  point: AreaPoint;
}

/** Two walls on the same line that overlap part of the way. */
export interface WallOverlap {
  kind: "overlap";
  /** The wall Trim shortens (the later one), and which end moves. */
  wallId: string;
  wallIndex: number;
  end: 1 | 2;
  otherId: string;
  /** The middle of the overlapping stretch. */
  point: AreaPoint;
  /** Where Trim moves that end: the other wall's end, so the two just meet. */
  to: AreaPoint;
  /** Length of the overlap, in canvas units. */
  length: number;
}

export type WallFinding = WallNearMiss | WallDuplicate | WallOverlap;

/**
 * How far short an end may stop and still be a near-miss rather than a gap.
 * Two strokes overlap, so the end looks joined, while the gap is under half
 * of each wall's thickness. Never less than the distance the daylight trace
 * already joins over (#360), so the editor flags every end the card repairs.
 * A doorway is far wider than either.
 */
export function nearMissTolerance(wall: Wall, other: Wall): number {
  return Math.max(OPENING_ON_WALL_EPS, (wallThickness(wall.thickness) + wallThickness(other.thickness)) / 2);
}

const ends = (w: Wall): [AreaPoint, AreaPoint] => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }];
const isPoint = (w: Wall) => w.x1 === w.x2 && w.y1 === w.y2;
const dist = (a: AreaPoint, b: AreaPoint) => Math.hypot(a.x - b.x, a.y - b.y);
/** Keep config values short; the rounding is far inside {@link WELD_EPS}. */
const round = (p: AreaPoint): AreaPoint => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });

function cross(o: AreaPoint, a: AreaPoint, b: AreaPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Whether two walls touch or cross anywhere. */
function wallsTouch(a: Wall, b: Wall): boolean {
  const [a1, a2] = ends(a), [b1, b2] = ends(b);
  const d1 = cross(a1, a2, b1), d2 = cross(a1, a2, b2), d3 = cross(b1, b2, a1), d4 = cross(b1, b2, a2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return [dist(a1, wallPoint(a1, b)), dist(a2, wallPoint(a2, b)),
    dist(b1, wallPoint(b1, a)), dist(b2, wallPoint(b2, a))].some(d => d <= WELD_EPS);
}

/** Two walls nearly parallel but beside each other, not on one line. */
function sideBySide(w: Wall, other: Wall, p: AreaPoint): boolean {
  const wx = w.x2 - w.x1, wy = w.y2 - w.y1, ox = other.x2 - other.x1, oy = other.y2 - other.y1;
  const lw = Math.hypot(wx, wy), lo = Math.hypot(ox, oy);
  if (Math.abs(wx * oy - wy * ox) / (lw * lo) > Math.sin(Math.PI / 36)) return false;
  return Math.abs((p.x - other.x1) * oy - (p.y - other.y1) * ox) / lo > WELD_EPS;
}

function nearMisses(walls: readonly Wall[]): WallNearMiss[] {
  const found: WallNearMiss[] = [];
  walls.forEach((w, wallIndex) => {
    if (isPoint(w)) return;
    const others = walls.filter(o => o !== w);
    ends(w).forEach((p, i) => {
      const match = nearestWall(p, others);
      // Joined (a corner or a T): the end sits on another wall already.
      if (!match || match.distance <= WELD_EPS) return;
      if (match.distance > nearMissTolerance(w, match.wall)) return;
      // A wall that crosses the other one and runs a little past it ends in
      // a stub nobody sees; the walls meet, so nothing leaks.
      if (wallsTouch(w, match.wall)) return;
      // A wall laid alongside another would only be bent by a join.
      if (sideBySide(w, match.wall, p)) return;
      const to = round(match.point);
      // Two collinear walls stopping short of each other: one finding, not two.
      if (found.some(f => f.wallId === match.wall.id && f.otherId === w.id &&
        dist(f.point, to) <= WELD_EPS && dist(f.to, p) <= WELD_EPS)) return;
      found.push({
        kind: "near-miss", wallId: w.id, wallIndex, end: (i + 1) as 1 | 2,
        otherId: match.wall.id, point: p, to, gap: match.distance,
      });
    });
  });
  return found;
}

function stacked(walls: readonly Wall[]): Array<WallDuplicate | WallOverlap> {
  const found: Array<WallDuplicate | WallOverlap> = [];
  walls.forEach((a, i) => {
    if (isPoint(a)) return;
    const dx = a.x2 - a.x1, dy = a.y2 - a.y1, length = Math.hypot(dx, dy);
    const along = (p: AreaPoint) => ((p.x - a.x1) * dx + (p.y - a.y1) * dy) / length;
    const off = (p: AreaPoint) => Math.abs((p.x - a.x1) * dy - (p.y - a.y1) * dx) / length;
    const at = (t: number): AreaPoint => round({ x: a.x1 + dx * t / length, y: a.y1 + dy * t / length });
    walls.forEach((b, j) => {
      if (j <= i || isPoint(b)) return;
      const [b1, b2] = ends(b);
      if (off(b1) > WELD_EPS || off(b2) > WELD_EPS) return;
      const t1 = along(b1), t2 = along(b2);
      const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(length, Math.max(t1, t2));
      // End to end (a wall split in two) or apart: nothing on top of anything.
      if (hi - lo <= WELD_EPS) return;
      const point = at((lo + hi) / 2);
      const bInA = Math.min(t1, t2) >= -WELD_EPS && Math.max(t1, t2) <= length + WELD_EPS;
      const aInB = Math.min(t1, t2) <= WELD_EPS && Math.max(t1, t2) >= length - WELD_EPS;
      if (bInA || aInB) {
        // Remove the shorter; of two equal walls, the later one.
        const [gone, kept, index] = bInA ? [b, a, j] : [a, b, i];
        found.push({ kind: "duplicate", wallId: gone.id, wallIndex: index, otherId: kept.id, point });
        return;
      }
      // Partly on top: move the end of b that lies inside a to a's end inside b.
      const inside = t1 > 0 && t1 < length ? 1 : 2;
      const bOuter = inside === 1 ? t2 : t1;
      found.push({
        kind: "overlap", wallId: b.id, wallIndex: j, end: inside, otherId: a.id, point,
        to: bOuter > length ? { x: a.x2, y: a.y2 } : { x: a.x1, y: a.y1 },
        length: hi - lo,
      });
    });
  });
  return found;
}

/**
 * Everything the plan check flags on these walls, in wall order: near-miss
 * ends first, then walls on top of other walls. Joined corners, T-junctions,
 * crossings and gaps wider than {@link nearMissTolerance} (a doorway) are
 * never flagged.
 */
export function wallFindings(walls: readonly Wall[]): WallFinding[] {
  return [...nearMisses(walls), ...stacked(walls)];
}

const memo = new WeakMap<readonly Wall[], WallFinding[]>();

/** Config arrays are replaced on edits, so the walls array is the cache key. */
export function wallFindingsCached(walls: readonly Wall[]): WallFinding[] {
  let hit = memo.get(walls);
  if (!hit) { hit = wallFindings(walls); memo.set(walls, hit); }
  return hit;
}

/**
 * The walls with one finding fixed. Walls are matched by index and id, so a
 * finding computed against a different set of walls changes nothing.
 */
export function applyWallFix(walls: readonly Wall[], finding: WallFinding): Wall[] {
  const target = walls[finding.wallIndex];
  if (!target || target.id !== finding.wallId) return [...walls];
  if (finding.kind === "duplicate") return walls.filter((_, i) => i !== finding.wallIndex);
  const moved = finding.end === 1
    ? { ...target, x1: finding.to.x, y1: finding.to.y }
    : { ...target, x2: finding.to.x, y2: finding.to.y };
  return walls.map((w, i) => (i === finding.wallIndex ? moved : w));
}
