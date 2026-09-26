import { splitSegments, WELD_EPS } from "./dead-space";
import type { IsoWallInput, Pt } from "./projection";
import type { WallKind } from "./types";

export interface JoinedWall extends IsoWallInput {
  kind?: WallKind;
  /** Left/right corners, with a shared centre at T/cross junctions. */
  start?: Pt[];
  end?: Pt[];
}
interface Ray { wall: JoinedWall; start: boolean; dx: number; dy: number; half: number }

/**
 * Split at T/cross junctions and meet adjacent wall outlines at a shared
 * miter, instead of overlapping two square caps. The same weld tolerance
 * as the room topology joins endpoints that were drawn a little short.
 */
export function joinIsoWalls(
  walls: readonly (IsoWallInput & { kind?: WallKind })[],
  joinable: (wall: IsoWallInput, start: boolean) => boolean = () => true,
): JoinedWall[] {
  const segments = splitSegments(walls.map(w => ({ a: { x: w.x1, y: w.y1 }, b: { x: w.x2, y: w.y2 } })), WELD_EPS);
  const nodes: Array<{ p: Pt; rays: Ray[] }> = [];
  const nodeAt = (p: Pt) => {
    const existing = nodes.find(n => Math.hypot(p.x - n.p.x, p.y - n.p.y) <= WELD_EPS);
    if (existing) return existing;
    const n = { p, rays: [] as Ray[] };
    nodes.push(n);
    return n;
  };
  const seen = new Set<string>();
  const result: JoinedWall[] = [];
  for (const s of segments) {
    const owner = walls.find(w => {
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len = Math.hypot(dx, dy);
      if (!len) return false;
      return [s.a, s.b].every(p => {
        const along = ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / len;
        return along >= -WELD_EPS && along <= len + WELD_EPS &&
          Math.abs((p.x - w.x1) * dy - (p.y - w.y1) * dx) / len <= WELD_EPS;
      });
    });
    if (!owner) continue;
    const a = nodeAt(s.a), b = nodeAt(s.b);
    if (a === b) continue;
    const key = [nodes.indexOf(a), nodes.indexOf(b)].sort((x, y) => x - y).join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    const w: JoinedWall = { ...owner, x1: a.p.x, y1: a.p.y, x2: b.p.x, y2: b.p.y };
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    const dx = (w.x2 - w.x1) / len, dy = (w.y2 - w.y1) / len;
    a.rays.push({ wall: w, start: true, dx, dy, half: w.thickness / 2 });
    b.rays.push({ wall: w, start: false, dx: -dx, dy: -dy, half: w.thickness / 2 });
    result.push(w);
  }
  for (const { p, rays: allRays } of nodes) for (const kind of new Set(allRays.map(r => r.wall.kind ?? "wall"))) {
    // A low railing must not remove the exposed end of a full-height wall.
    const rays = allRays.filter(r => (r.wall.kind ?? "wall") === kind && joinable(r.wall, r.start));
    if (rays.length < 2) continue;
    rays.sort((a, b) => Math.atan2(a.dy, a.dx) - Math.atan2(b.dy, b.dx));
    const join = (a: Ray, b: Ray): Pt => {
      // Left outline of a meets right outline of its counterclockwise neighbour.
      const pa = { x: p.x - a.dy * a.half, y: p.y + a.dx * a.half };
      const pb = { x: p.x + b.dy * b.half, y: p.y - b.dx * b.half };
      const cross = a.dx * b.dy - a.dy * b.dx;
      if (Math.abs(cross) > 1e-6) {
        const t = ((pb.x - pa.x) * b.dy - (pb.y - pa.y) * b.dx) / cross;
        const q = { x: pa.x + a.dx * t, y: pa.y + a.dy * t };
        // Bevel very acute joins instead of making an unbounded spike.
        if (Math.hypot(q.x - p.x, q.y - p.y) <= 4 * Math.max(a.half, b.half)) return q;
      }
      return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    };
    const joins = rays.map((r, i) => join(r, rays[(i + 1) % rays.length]!));
    // Three or more outlines bound a central polygon. Partition it between
    // the arms so a T junction has neither a triangular hole nor double fill.
    const centre = joins.reduce((c, q) => ({ x: c.x + q.x / joins.length, y: c.y + q.y / joins.length }), { x: 0, y: 0 });
    rays.forEach((r, i) => {
      const left = joins[i]!, right = joins[(i + rays.length - 1) % rays.length]!;
      const middle = rays.length > 2 ? [centre] : [];
      if (r.start) r.wall.start = [left, ...middle, right];
      else r.wall.end = [right, ...middle, left];
    });
  }
  return result;
}
