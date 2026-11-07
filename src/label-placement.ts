/**
 * `labelPosition: auto` — choosing the side of the badge a label hangs on.
 *
 * Split in two on purpose. Everything that decides is pure and takes plain
 * boxes and segments, so it is unit-tested in node; {@link measureLabelScene}
 * is the only part that touches the DOM, and it reads everything it needs in
 * one pass before anything is written back.
 *
 * **One coordinate space: client pixels.** Badges, labels, room names and
 * opening symbols are measured with `getBoundingClientRect()`, which already
 * includes the zoom-to-room transform, the badges' counter-scale and either
 * overlay scale. Walls are not measured (a rotated `<line>`'s bounding box
 * would be the box around the diagonal, not the wall); they are mapped from
 * plan coordinates through the same display mapping the overlay anchors use
 * and scaled by the overlay's measured width, so a rotated plan gets real
 * segments with their drawn thickness.
 */

/** A manual side, and the four an `auto` label chooses between. */
export type LabelSide = "below" | "right" | "left" | "above";

/**
 * Candidate order, which is also the tie-break: an `auto` label only leaves
 * the historic `below` when another side is actually better.
 */
export const AUTO_LABEL_ORDER: readonly LabelSide[] = ["below", "right", "left", "above"];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A wall as drawn: a centre line and half its stroke width. */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  half: number;
}

/** What a label must stay off, each kind with its own cost per px² covered. */
export interface LabelObstacles {
  walls: Segment[];
  /** Door/window symbols — their swing arcs and leaves. */
  openings: Box[];
  /** Badges (devices, shutter and opening marks). */
  badges: Box[];
  /** Labels that are not moving: manual ones, room names and plan texts. */
  labels: Box[];
  /** The visible part of the plan; whatever of a label falls outside it costs. */
  bounds?: Box;
}

/**
 * Cost per px² covered. Covering a badge or another label hides information,
 * so it costs the most; a label over a wall line only looks untidy; leaving
 * the visible plan loses text outright.
 */
export const LABEL_WEIGHTS = {
  wall: 1,
  opening: 1,
  badge: 3,
  label: 3,
  outside: 4,
} as const;

/**
 * How much better another side must be before a label that already has one
 * moves, as a fraction of the label's own area. Without it, a reading that
 * gains a digit or a card resized by a pixel could flip a label back and forth
 * between two nearly equal sides.
 */
export const LABEL_STICKINESS = 0.15;

/** The four boxes a label could occupy around its badge. */
export function labelCandidates(
  badge: Box,
  label: { w: number; h: number },
  gap: { below: number; side: number },
  /** A label-only device's `below` is centred on its point (issue #308), not hung under it. */
  centredBelow = false
): Record<LabelSide, Box> {
  const cx = badge.x + badge.w / 2;
  const cy = badge.y + badge.h / 2;
  const { w, h } = label;
  return {
    below: centredBelow
      ? { x: cx - w / 2, y: cy - h / 2, w, h }
      : { x: cx - w / 2, y: badge.y + badge.h + gap.below, w, h },
    right: { x: badge.x + badge.w + gap.side, y: cy - h / 2, w, h },
    left: { x: badge.x - gap.side - w, y: cy - h / 2, w, h },
    above: { x: cx - w / 2, y: badge.y - gap.below - h, w, h },
  };
}

/** Area shared by two boxes. */
export function boxOverlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Area of a box that lies outside `bounds`. */
export function areaOutside(a: Box, bounds: Box): number {
  return a.w * a.h - boxOverlap(a, bounds);
}

type Pt = { x: number; y: number };

/**
 * Area shared by a box and a wall drawn as a band of width `2 * half` (butt
 * ends — a wall's caps are hidden in the walls it meets). Exact: the band is
 * a quadrilateral, clipped against the box's four edges (Sutherland–Hodgman)
 * and measured with the shoelace formula, so a diagonal wall costs what it
 * actually covers rather than its whole bounding box.
 */
export function segmentOverlap(r: Box, s: Segment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !(s.half > 0)) return 0;
  // Cheap reject before clipping: most walls are nowhere near most labels.
  if (
    Math.max(s.x1, s.x2) + s.half < r.x || Math.min(s.x1, s.x2) - s.half > r.x + r.w ||
    Math.max(s.y1, s.y2) + s.half < r.y || Math.min(s.y1, s.y2) - s.half > r.y + r.h
  ) return 0;
  const nx = (-dy / len) * s.half;
  const ny = (dx / len) * s.half;
  let poly: Pt[] = [
    { x: s.x1 + nx, y: s.y1 + ny },
    { x: s.x2 + nx, y: s.y2 + ny },
    { x: s.x2 - nx, y: s.y2 - ny },
    { x: s.x1 - nx, y: s.y1 - ny },
  ];
  // Signed distance inside each edge of the box; >= 0 is inside.
  const edges: Array<(p: Pt) => number> = [
    (p) => p.x - r.x,
    (p) => r.x + r.w - p.x,
    (p) => p.y - r.y,
    (p) => r.y + r.h - p.y,
  ];
  for (const inside of edges) {
    const out: Pt[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const da = inside(a);
      const db = inside(b);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    poly = out;
    if (poly.length < 3) return 0;
  }
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

/** What it costs to put a label in `box`. 0 is a clear spot. */
export function scoreLabelBox(box: Box, o: LabelObstacles): number {
  let s = 0;
  for (const w of o.walls) s += LABEL_WEIGHTS.wall * segmentOverlap(box, w);
  for (const b of o.openings) s += LABEL_WEIGHTS.opening * boxOverlap(box, b);
  for (const b of o.badges) s += LABEL_WEIGHTS.badge * boxOverlap(box, b);
  for (const b of o.labels) s += LABEL_WEIGHTS.label * boxOverlap(box, b);
  if (o.bounds) s += LABEL_WEIGHTS.outside * areaOutside(box, o.bounds);
  return s;
}

/**
 * The side to use, given what each costs.
 *
 * Fresh (no `current`): the cheapest, ties going to the earlier side in
 * {@link AUTO_LABEL_ORDER}. With a `current` side: that side, unless another
 * beats it by more than `margin` — so the choice is stable under the small
 * changes a live plan goes through.
 */
export function chooseLabelSide(
  scores: Record<LabelSide, number>,
  current?: LabelSide,
  margin = 0
): LabelSide {
  let best: LabelSide = AUTO_LABEL_ORDER[0];
  for (const side of AUTO_LABEL_ORDER) {
    // A tolerance well under a pixel², so float noise never decides a tie.
    if (scores[side] < scores[best] - 1e-6) best = side;
  }
  if (current && current !== best && scores[best] >= scores[current] - margin) return current;
  return best;
}

/** One `auto` label as measured. */
export interface AutoLabelEntry {
  key: string;
  badge: Box;
  label: { w: number; h: number };
  gap: { below: number; side: number };
  centredBelow?: boolean;
  current?: LabelSide;
}

/**
 * Place every `auto` label in turn, in the order given (the plan's own item
 * order, so the result is deterministic). Each placed label becomes an
 * obstacle for the ones after it; a label never counts its own badge.
 *
 * `badges` holds every device badge with its key; other obstacles are in
 * `fixed` and do not move.
 */
export function placeAutoLabels(
  entries: AutoLabelEntry[],
  badges: Array<{ key: string; box: Box }>,
  fixed: Omit<LabelObstacles, "badges">
): Map<string, LabelSide> {
  const out = new Map<string, LabelSide>();
  const placed: Box[] = [];
  for (const e of entries) {
    const obstacles: LabelObstacles = {
      ...fixed,
      labels: fixed.labels.concat(placed),
      badges: badges.filter((b) => b.key !== e.key).map((b) => b.box),
    };
    const boxes = labelCandidates(e.badge, e.label, e.gap, e.centredBelow);
    const scores = {} as Record<LabelSide, number>;
    for (const side of AUTO_LABEL_ORDER) scores[side] = scoreLabelBox(boxes[side], obstacles);
    const side = chooseLabelSide(scores, e.current, LABEL_STICKINESS * e.label.w * e.label.h);
    out.set(e.key, side);
    placed.push(boxes[side]);
  }
  return out;
}

/**
 * How a host keys an auto label's remembered side: the item's id, which the
 * editor guarantees; a hand-written config without one falls back to what it
 * is bound to and where it stands.
 */
export function autoLabelKey(item: { id?: string; entity?: string; x: number; y: number }): string {
  return item.id || `${item.entity ?? ""}@${item.x},${item.y}`;
}

const toBox = (r: DOMRect): Box => ({ x: r.left, y: r.top, w: r.width, h: r.height });

/** What a host (the card, or the editor's canvas) hands {@link measureLabelScene}. */
export interface LabelScene {
  /** Every device anchor on show, in plan order. */
  items: HTMLElement[];
  /** The key of an `auto` item, or undefined for one with a manual side. */
  autoKey: (el: HTMLElement) => string | undefined;
  /** Its label element, if it has one. */
  label: (el: HTMLElement) => HTMLElement | null;
  /**
   * The part of an item another label must not cover: its badge (or a
   * label-only device's empty footprint). Null for a ripple-only device — the
   * ring is decoration, mostly empty air, and counting its whole box would
   * push every label nearby off a clear spot.
   */
  solid: (el: HTMLElement) => Element | null;
  /** Whether a label-only device's `below` centres on its point. */
  centredBelow?: (el: HTMLElement) => boolean;
  /** The side each `auto` label had last time — the stickiness reference. */
  current: Map<string, LabelSide>;
  /** Other badges: shutter and opening marks. */
  marks: Element[];
  /** Room names and plan texts. */
  names: Element[];
  /** Door/window symbols. */
  openings: Element[];
  /** Walls, already in client pixels. */
  walls: Segment[];
  bounds: Box;
  /** Label gaps in em under `overlayScale: plan`; pixels otherwise. */
  scalePlan: boolean;
}

/**
 * Read the scene and place every `auto` label. Layout reads only — every
 * rect is taken before anything is decided, and nothing is written here; the
 * caller applies the result through its own render.
 *
 * A label's size does not depend on its side (the side rules only move it),
 * so it is measured wherever it currently is.
 */
export function measureLabelScene(s: LabelScene): Map<string, LabelSide> {
  const entries: AutoLabelEntry[] = [];
  const badges: Array<{ key: string; box: Box }> = [];
  const labels: Box[] = [];
  s.items.forEach((el, i) => {
    const key = s.autoKey(el);
    // The label hangs off the item's whole box, which is what the side rules
    // position it against — the ripple included, for a ripple device.
    const badge = toBox(el.getBoundingClientRect());
    const solid = s.solid(el);
    if (solid) badges.push({ key: key ?? `#${i}`, box: toBox(solid.getBoundingClientRect()) });
    const label = s.label(el);
    if (!label) return;
    const r = label.getBoundingClientRect();
    if (key === undefined) {
      labels.push(toBox(r));
      return;
    }
    // The gap the stylesheet puts between badge and label, in client pixels:
    // 2px/4px, or 0.17em/0.33em of the label under overlayScale: plan — both
    // scaled by whatever transform (the zoom's counter-scale) sits above.
    const k = label.offsetHeight > 0 ? r.height / label.offsetHeight : 1;
    let gap = { below: 2 * k, side: 4 * k };
    if (s.scalePlan) {
      const fs = parseFloat(getComputedStyle(label).fontSize) * k;
      if (fs > 0) gap = { below: 0.17 * fs, side: 0.33 * fs };
    }
    entries.push({
      key,
      badge,
      label: { w: r.width, h: r.height },
      gap,
      centredBelow: s.centredBelow?.(el) ?? false,
      current: s.current.get(key),
    });
  });
  if (!entries.length) return new Map();
  for (const m of s.marks) badges.push({ key: "", box: toBox(m.getBoundingClientRect()) });
  for (const n of s.names) labels.push(toBox(n.getBoundingClientRect()));
  const openings = s.openings.map((o) => toBox(o.getBoundingClientRect())).filter((b) => b.w > 0 || b.h > 0);
  return placeAutoLabels(entries, badges, { walls: s.walls, openings, labels, bounds: s.bounds });
}

/** Intersection of two boxes (an empty one if they do not meet). */
export function intersectBoxes(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
    h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y),
  };
}

export { toBox as rectToBox };
