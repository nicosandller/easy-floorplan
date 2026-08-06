/**
 * Dead spaces (issue #88).
 *
 * A "dead space" is a region of the plan that the walls close off completely
 * and that no door or window opens onto: the void behind a boxed-in stairwell,
 * a service shaft, the leftover pocket between two rooms. It is not a room —
 * you cannot get into it — and a plan that draws it like one is lying about the
 * house. Floor plans conventionally hatch such a region, and that is what this
 * produces: the polygons to hatch, worked out from the walls and openings
 * themselves rather than drawn by hand.
 *
 * The whole feature is that last part. A hand-drawn dead space is just an
 * {@link Area} with a hatch on it, and it goes stale the moment a wall moves or
 * a door is added. Here, cutting a doorway into a shaft stops it being dead,
 * because "dead" is derived from the geometry every time.
 *
 * ## How the regions are found
 *
 * The walls are a set of unordered line segments that cross, touch and share
 * corners. Turning that into regions is the standard planar-subdivision walk:
 *
 * 1. **Split** every wall at every point another wall meets or crosses it, so
 *    the pieces only ever touch at endpoints ({@link splitSegments}). A wall
 *    running into the middle of another (the usual T at a partition) has to
 *    become a vertex there, or the room on either side is not a cycle.
 * 2. **Weld** endpoints that coincide into shared vertices, within a tolerance
 *    of {@link WELD_EPS} — the editor's corner snapping already makes room
 *    corners exact, so this is only for floating-point drift and hand-typed
 *    coordinates, deliberately far too small to close a doorway-sized gap.
 * 3. **Trace faces**: from each directed edge, repeatedly turn as sharply as
 *    possible in one direction. That walk traces the minimal cycles — the
 *    faces of the arrangement — and the outer face of each connected component
 *    comes out with the opposite winding, so a sign test drops it
 *    ({@link traceFaces}).
 * 4. **Keep the faces no opening touches**. An opening's centre sits on the
 *    wall centreline, which is exactly where the face's own edges run, so
 *    "this door belongs to this region" is a point-to-segment distance.
 *
 * Two consequences worth stating, because they are what makes the result
 * trustworthy rather than merely plausible:
 *
 * - **A gap in the walls is not a cycle.** Plenty of plans mark a doorway by
 *   simply leaving a hole in the wall instead of placing a door symbol. Such a
 *   region never closes, so it is never traced as a face and can never be
 *   hatched. Only genuinely sealed regions are candidates in the first place.
 * - **Nothing here mutates the config.** No dead-space element is written to
 *   the YAML; the polygons are recomputed for the render and thrown away.
 */

import type { AreaPoint, Opening, Wall } from "./types";

/**
 * How far apart two endpoints may be and still weld into one vertex, in canvas
 * units. Small on purpose: this closes rounding drift, not doorways. The
 * editor snaps a wall's endpoint onto an existing corner exactly (see
 * `snapWallEnd`), so shared corners arrive here already identical.
 */
export const WELD_EPS = 0.75;

/**
 * How far an opening's centre may sit from a region's wall and still count as
 * opening onto it. The editor drops openings onto the wall centreline
 * (`snapToWall`), so this only absorbs a nudge afterwards — one wall thickness,
 * i.e. still visibly on the wall.
 */
export const OPENING_ON_WALL_EPS = 8;

/**
 * Smallest region worth hatching, in square canvas units — one cell of the
 * default 20-unit grid. Below that the "region" is a sliver where two walls
 * cross or overlap slightly, not a space in the house, and hatching it would
 * put a smudge on the plan with nothing the user could do about it.
 */
export const MIN_DEAD_AREA = 400;

interface Pt {
  x: number;
  y: number;
}

interface Seg {
  a: Pt;
  b: Pt;
}

export interface DeadSpaceOptions {
  weldEps?: number;
  openingEps?: number;
  minArea?: number;
}

/**
 * Shoelace area, signed: positive for one winding of the ring and negative for
 * the other. Which winding is which does not matter — only that the two differ,
 * which is how {@link traceFaces}' output separates inside from outside.
 */
export function signedArea(points: readonly AreaPoint[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += points[j]!.x * points[i]!.y - points[i]!.x * points[j]!.y;
  }
  return sum / 2;
}

/** Distance from `(x, y)` to the segment `a`–`b`. */
function distToSegment(x: number, y: number, a: Pt, b: Pt): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(x - a.x, y - a.y);
  let t = ((x - a.x) * vx + (y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a.x + t * vx), y - (a.y + t * vy));
}

/**
 * Every wall cut at every point another wall meets or crosses it, so the
 * resulting pieces meet only at their endpoints.
 *
 * Both cases matter and they are found differently. Two walls that *cross* have
 * one intersection, solved from the two line equations. Two walls that lie
 * **along** each other — a long run drawn as two overlapping strokes, which is
 * easy to do by accident — are parallel and have no such solution, so their
 * endpoints are projected onto each other instead. Without that second case an
 * overlap leaves duplicate edges between the same pair of vertices, and the
 * face walk goes down one and back the other forever.
 */
export function splitSegments(walls: readonly Seg[], eps: number): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < walls.length; i++) {
    const s = walls[i]!;
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy);
    if (len <= eps) continue;
    // Parameters along `s` (0 at a, 1 at b) where it must be cut.
    const cuts: number[] = [0, 1];
    const tEps = eps / len;

    for (let j = 0; j < walls.length; j++) {
      if (j === i) continue;
      const o = walls[j]!;
      const ox = o.b.x - o.a.x;
      const oy = o.b.y - o.a.y;
      const denom = dx * oy - dy * ox;
      if (Math.abs(denom) > 1e-9) {
        const t = ((o.a.x - s.a.x) * oy - (o.a.y - s.a.y) * ox) / denom;
        const u = ((o.a.x - s.a.x) * dy - (o.a.y - s.a.y) * dx) / denom;
        // `u` is allowed to overshoot by the weld tolerance: a partition drawn
        // a hair short of the wall it meets still makes a corner there, and the
        // vertex it produces welds onto that endpoint in the next step.
        const uEps = eps / Math.max(Math.hypot(ox, oy), 1e-9);
        if (t > tEps && t < 1 - tEps && u >= -uEps && u <= 1 + uEps) cuts.push(t);
        continue;
      }
      // Parallel: only collinear overlap can force a cut, and then only where
      // the other segment's endpoints land inside this one.
      for (const p of [o.a, o.b]) {
        const t = ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / (len * len);
        if (t <= tEps || t >= 1 - tEps) continue;
        const px = s.a.x + t * dx;
        const py = s.a.y + t * dy;
        if (Math.hypot(p.x - px, p.y - py) <= eps) cuts.push(t);
      }
    }

    cuts.sort((a, b) => a - b);
    for (let k = 1; k < cuts.length; k++) {
      const t0 = cuts[k - 1]!;
      const t1 = cuts[k]!;
      if (t1 - t0 <= tEps) continue;
      out.push({
        a: { x: s.a.x + t0 * dx, y: s.a.y + t0 * dy },
        b: { x: s.a.x + t1 * dx, y: s.a.y + t1 * dy },
      });
    }
  }
  return out;
}

interface Graph {
  points: Pt[];
  /** Neighbour vertex ids per vertex, sorted by the angle of the outgoing edge. */
  neighbors: number[][];
}

/**
 * Weld coincident endpoints into shared vertices and index the adjacency.
 *
 * The weld goes through a hash of `eps`-sized cells rather than scanning every
 * vertex found so far. Two points within `eps` of each other necessarily share
 * a cell or sit in adjoining ones, so the nine cells around a point hold every
 * candidate — which makes welding linear in the number of endpoints instead of
 * quadratic. The scan is not a hot path on a house-sized plan, but it is the
 * one part of this whose cost grows with the *square* of the plan's size, and
 * that is the part worth not writing quadratically.
 */
function buildGraph(segments: readonly Seg[], eps: number): Graph {
  const points: Pt[] = [];
  const cells = new Map<string, number[]>();
  const cell = (v: number) => Math.floor(v / eps);
  const idOf = (p: Pt): number => {
    const cx = cell(p.x);
    const cy = cell(p.y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (Math.hypot(points[i]!.x - p.x, points[i]!.y - p.y) <= eps) return i;
        }
      }
    }
    const id = points.push({ x: p.x, y: p.y }) - 1;
    const key = `${cx}:${cy}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(id);
    else cells.set(key, [id]);
    return id;
  };

  const adj = new Map<number, Set<number>>();
  const at = (i: number): Set<number> => {
    let set = adj.get(i);
    if (!set) adj.set(i, (set = new Set()));
    return set;
  };
  for (const s of segments) {
    const u = idOf(s.a);
    const v = idOf(s.b);
    // A segment whose ends welded together is a dot, not an edge.
    if (u === v) continue;
    at(u).add(v);
    at(v).add(u);
  }

  const neighbors = points.map((p, i) =>
    [...(adj.get(i) ?? [])].sort(
      (a, b) =>
        Math.atan2(points[a]!.y - p.y, points[a]!.x - p.x) -
        Math.atan2(points[b]!.y - p.y, points[b]!.x - p.x)
    )
  );
  return { points, neighbors };
}

/**
 * Every bounded face of the arrangement, as a ring of vertex positions.
 *
 * The walk is the classic one: arriving at `v` from `u`, leave along the
 * neighbour that sits immediately *before* `u` in `v`'s angular order — the
 * sharpest available turn in one consistent direction. Keeping the turn
 * consistent is what makes the walk close, and it makes every bounded face come
 * out with one winding while the outer face of each connected component comes
 * out with the other. That sign is the whole test for "is this the outside",
 * which is why no point-in-polygon or bounding-box heuristic is needed.
 *
 * A wall that dead-ends (a stub partition inside a room) is walked out and
 * straight back again. That is correct, not a special case: the spike lies on
 * the region's boundary, contributes nothing to the area, and hatches as part
 * of the region it sticks into.
 */
export function traceFaces(segments: readonly Seg[], eps: number): AreaPoint[][] {
  const { points, neighbors } = buildGraph(segments, eps);
  const seen = new Set<string>();
  const faces: AreaPoint[][] = [];

  for (let start = 0; start < points.length; start++) {
    for (const first of neighbors[start]!) {
      if (seen.has(`${start}>${first}`)) continue;
      const ring: number[] = [];
      let u = start;
      let v = first;
      // Bound the walk by the number of directed edges: a malformed graph must
      // not be able to spin here forever.
      for (let guard = 0; guard <= points.length * points.length + 4; guard++) {
        seen.add(`${u}>${v}`);
        ring.push(u);
        const around = neighbors[v]!;
        const back = around.indexOf(u);
        const next = around[(back - 1 + around.length) % around.length]!;
        u = v;
        v = next;
        if (u === start && v === first) break;
      }
      if (ring.length >= 3) faces.push(ring.map((i) => ({ x: points[i]!.x, y: points[i]!.y })));
    }
  }
  return faces;
}

/** True when any opening's centre sits on one of the ring's edges. */
function ringHasOpening(
  ring: readonly AreaPoint[],
  openings: readonly Opening[],
  eps: number
): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    for (const o of openings) {
      if (distToSegment(o.x, o.y, ring[j]!, ring[i]!) <= eps) return true;
    }
  }
  return false;
}

/**
 * The polygons of every region the walls close off and no opening reaches — the
 * plan's dead spaces, in canvas units.
 *
 * Faces are returned largest-first so that a nested pair (a sealed box standing
 * inside a sealed courtyard) hatches the container before the thing inside it.
 *
 * Known limit, stated rather than papered over: a region containing a *free-
 * standing* island — a closed loop of walls that touches nothing around it — is
 * returned as its outline only, so the hatch runs across the island too. Nothing
 * in the traversal can know the two are related, since they share no vertex.
 * Touching the island to any surrounding wall resolves it, and an island inside
 * a dead space is a rare shape to begin with.
 */
export function deadSpaces(
  walls: readonly Wall[],
  openings: readonly Opening[],
  opts: DeadSpaceOptions = {}
): AreaPoint[][] {
  const weldEps = opts.weldEps ?? WELD_EPS;
  const openingEps = opts.openingEps ?? OPENING_ON_WALL_EPS;
  const minArea = opts.minArea ?? MIN_DEAD_AREA;
  if (walls.length < 3) return [];

  const segments = splitSegments(
    walls.map((w) => ({ a: { x: w.x1, y: w.y1 }, b: { x: w.x2, y: w.y2 } })),
    weldEps
  );
  const faces = traceFaces(segments, weldEps);

  return faces
    .map((ring) => ({ ring, area: signedArea(ring) }))
    // Positive is the bounded winding this walk produces; the outer face of
    // each connected component is the negative one.
    .filter((f) => f.area >= minArea && !ringHasOpening(f.ring, openings, openingEps))
    .sort((a, b) => b.area - a.area)
    .map((f) => f.ring);
}

/**
 * {@link deadSpaces}, memoized on the identity of the two arrays it reads.
 *
 * The card re-renders on every state change of every entity it watches, and the
 * walls have not moved on any of them. Both arrays come out of the config, which
 * is replaced wholesale rather than mutated, so identity is a sound cache key —
 * and a `WeakMap` keeps a floor's result alive exactly as long as that floor's
 * walls are, which the editor's per-edit copies then drop on their own.
 */
const memo = new WeakMap<readonly Wall[], { openings: readonly Opening[]; out: AreaPoint[][] }>();

export function deadSpacesCached(
  walls: readonly Wall[],
  openings: readonly Opening[]
): AreaPoint[][] {
  const hit = memo.get(walls);
  if (hit && hit.openings === openings) return hit.out;
  const out = deadSpaces(walls, openings);
  memo.set(walls, { openings, out });
  return out;
}
