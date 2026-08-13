/**
 * Furniture symbols — the geometry format behind every glyph on the plan
 * (issue #90).
 *
 * A symbol is a JSON list of primitives with **numeric attributes only**. The
 * card builds the SVG elements itself, so nothing a user supplies is ever
 * parsed as markup: no `<script>`, no `on*` handlers, no `javascript:` href,
 * nothing to sanitise. The injection surface is gone by construction rather
 * than by filtering, which is the whole reason the format is geometry and not
 * SVG. See `furniture/README.md` for the authoring guide.
 *
 * Colors never appear in a symbol either. A part picks a {@link SymbolRole},
 * and the renderer pours the piece's resolved color into it — so a community
 * symbol inherits entity recoloring (#82) and skins (#122) for free, and
 * cannot smuggle a `url()` into a paint attribute.
 */
import { nothing, svg, type SVGTemplateResult } from "lit";
import { cssIdent } from "./css-safe";

/** How a part is painted. Never a color — the renderer supplies that. */
export type SymbolRole = "body" | "line" | "thin" | "detail" | "hint" | "solid";

/**
 * Which box a part's coordinates live in.
 *
 * `box` (the default) maps the viewBox onto the piece's full `w × h`, so a
 * glyph stretches with the furniture. `square` maps it onto the centered
 * square of side `min(w, h)`, which keeps a ring of parts concentric with a
 * circle when the piece is not square — the hot tub's jets sit on its water
 * circle in either mode only because of this.
 */
export type SymbolSpace = "box" | "square";

/** Paint settings resolved from a part's role plus its numeric overrides. */
export interface PartStyle {
  role: SymbolRole;
  width: number;
  opacity: number;
  fillOpacity: number;
  dash?: number[];
}

export type PathCmd =
  | ["M", number, number]
  | ["L", number, number]
  | ["Q", number, number, number, number]
  | ["C", number, number, number, number, number, number]
  | ["Z"];

/** A part after validation: one primitive, all numbers finite, style resolved. */
export type SymbolPart = { style: PartStyle; space: SymbolSpace } & (
  | { kind: "line"; a: [number, number]; b: [number, number] }
  | { kind: "rect"; x: number; y: number; w: number; h: number; rx: number }
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "poly"; closed: boolean; pts: Array<[number, number]> }
  | { kind: "path"; cmds: PathCmd[] }
);

export interface SymbolDef {
  id: string;
  name: string;
  category: string;
  keywords: string[];
  /** Default size in canvas units when the piece is first placed. */
  size: { w: number; h: number };
  /** Authoring box: `[x, y, w, h]`, origin top-left. */
  viewBox: [number, number, number, number];
  /** Shape the glow mask cuts for this piece (#106). */
  footprint: "rect" | "ellipse";
  parts: SymbolPart[];
}

export type SymbolCatalog = Readonly<Record<string, SymbolDef>>;

/** Picker grouping. Anything else sorts into "other", after these. */
export const SYMBOL_CATEGORIES = [
  "living",
  "bedroom",
  "kitchen",
  "bath",
  "utility",
  "other",
] as const;

/**
 * Every lookup in this file is keyed by an untrusted string — a symbol id, a
 * role name, a path command — and `cssIdent` happily passes `__proto__`,
 * `toString` and `constructor`, which are all just letters and underscores.
 *
 * On a plain object that is a real fault, not a nicety. Reading
 * `catalog["toString"]` returns `Object.prototype.toString`, a truthy value, so
 * every `?? FALLBACK_SYMBOL` guard sails past it and the renderer destructures
 * a function — which throws and takes the **whole card** down, from a config
 * that never defined a symbol at all. Writing `out["__proto__"] = def` is worse
 * in a quieter way: the assignment hits the inherited setter, so the symbol
 * vanishes from `Object.keys` while every unrelated lookup starts resolving
 * through the injected object.
 *
 * So every table here is null-prototype, and {@link own} is the one way any of
 * them is read. Null-prototype construction alone would be enough today, but it
 * is an invariant every future caller has to remember; the helper makes it hold
 * even for a catalogue somebody hands us built the ordinary way.
 */
const dict = <T>(entries: Record<string, T>): Record<string, T> =>
  Object.assign(Object.create(null) as Record<string, T>, entries);

const own = <T>(table: Record<string, T>, key: unknown): T | undefined =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : undefined;

/**
 * Role defaults — the de-facto design system the built-in glyphs already used,
 * read off the 26 of them: a filled carcass, then three weights of line art,
 * then the one solid fill (the fish tank's tails).
 */
const ROLE_STYLE = dict<Omit<PartStyle, "role">>({
  body: { width: 2, opacity: 1, fillOpacity: 0.12 },
  line: { width: 2, opacity: 1, fillOpacity: 0 },
  thin: { width: 1.5, opacity: 1, fillOpacity: 0 },
  detail: { width: 1.5, opacity: 0.7, fillOpacity: 0 },
  hint: { width: 1, opacity: 0.6, fillOpacity: 0 },
  solid: { width: 0, opacity: 0.7, fillOpacity: 1 },
});

const DEFAULT_VIEW_BOX: [number, number, number, number] = [0, 0, 100, 100];

/**
 * Caps. A symbol arrives from a config file or a paste box, so every count is
 * bounded: a `repeat` of a million would hang the render, and the failure mode
 * we want is "your symbol was rejected", not "the dashboard froze".
 */
export const MAX_REPEAT = 64;
export const MAX_PARTS = 256;
export const MAX_PATH_CMDS = 256;
export const MIN_STROKE_WIDTH = 0.25;
export const MAX_STROKE_WIDTH = 8;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A tuple of exactly `n` finite numbers, or null. */
function nums(v: unknown, n: number): number[] | null {
  if (!Array.isArray(v) || v.length !== n) return null;
  const out: number[] = [];
  for (const x of v) {
    const f = num(x);
    if (f === null) return null;
    out.push(f);
  }
  return out;
}

function points(v: unknown): Array<[number, number]> | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > MAX_PARTS) return null;
  const out: Array<[number, number]> = [];
  for (const p of v) {
    const xy = nums(p, 2);
    if (!xy) return null;
    out.push([xy[0]!, xy[1]!]);
  }
  return out;
}

const PATH_ARITY = dict<number>({ M: 2, L: 2, Q: 4, C: 6, Z: 0 });

function pathCmds(v: unknown): PathCmd[] | null {
  if (!Array.isArray(v) || !v.length || v.length > MAX_PATH_CMDS) return null;
  const out: PathCmd[] = [];
  for (const c of v) {
    if (!Array.isArray(c) || typeof c[0] !== "string") return null;
    const op = c[0].toUpperCase();
    const arity = own(PATH_ARITY, op);
    if (arity === undefined) return null;
    const args = nums(c.slice(1), arity);
    if (!args) return null;
    out.push([op, ...args] as PathCmd);
  }
  // A path that never moves anywhere draws nothing; reject it so the author
  // sees the mistake instead of an invisible part.
  if (out[0]?.[0] !== "M") return null;
  return out;
}

function styleOf(raw: Record<string, unknown>, fallback: SymbolRole): PartStyle {
  // `in` would walk the prototype chain, so `role: "toString"` passed the guard
  // and then read a function whose `.width` is undefined — a part stroked
  // `stroke-width="undefined"`.
  const role: SymbolRole = own(ROLE_STYLE, raw.role) ? (raw.role as SymbolRole) : fallback;
  const base = ROLE_STYLE[role]!;
  const width = num(raw.width);
  const opacity = num(raw.opacity);
  const fillOpacity = num(raw.fillOpacity);
  const dashRaw = Array.isArray(raw.dash) ? raw.dash.map(num) : null;
  const dash =
    dashRaw && dashRaw.length && dashRaw.length <= 8 && dashRaw.every((d) => d !== null)
      ? (dashRaw as number[]).map((d) => clamp(d, 0, 100))
      : undefined;
  return {
    role,
    width:
      width === null
        ? base.width
        : role === "solid"
          ? clamp(width, 0, MAX_STROKE_WIDTH)
          : clamp(width, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH),
    opacity: opacity === null ? base.opacity : clamp(opacity, 0, 1),
    fillOpacity: fillOpacity === null ? base.fillOpacity : clamp(fillOpacity, 0, 1),
    dash,
  };
}

/** One raw part → one primitive, or null if it is not a shape we can draw. */
function normalizePart(raw: unknown): SymbolPart | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const space: SymbolSpace = r.space === "square" ? "square" : "box";

  if ("line" in r) {
    const v = nums(r.line, 4);
    if (!v) return null;
    return { kind: "line", a: [v[0]!, v[1]!], b: [v[2]!, v[3]!], space, style: styleOf(r, "line") };
  }
  if ("rect" in r) {
    const v = nums(r.rect, 4);
    // SVG rejects a negative width or height outright, so a mistyped rect drew
    // nothing at all, with no error anywhere — exactly the silent failure this
    // validator exists to prevent. Same rule the radii already had.
    if (!v || v[2]! < 0 || v[3]! < 0) return null;
    return {
      kind: "rect", x: v[0]!, y: v[1]!, w: v[2]!, h: v[3]!,
      rx: Math.max(0, num(r.rx) ?? 0), space, style: styleOf(r, "body"),
    };
  }
  if ("circle" in r) {
    const v = nums(r.circle, 3);
    if (!v || v[2]! < 0) return null;
    return { kind: "circle", cx: v[0]!, cy: v[1]!, r: v[2]!, space, style: styleOf(r, "line") };
  }
  if ("ellipse" in r) {
    const v = nums(r.ellipse, 4);
    if (!v || v[2]! < 0 || v[3]! < 0) return null;
    return {
      kind: "ellipse", cx: v[0]!, cy: v[1]!, rx: v[2]!, ry: v[3]!,
      space, style: styleOf(r, "line"),
    };
  }
  if ("polygon" in r || "polyline" in r) {
    const closed = "polygon" in r;
    const pts = points(closed ? r.polygon : r.polyline);
    if (!pts) return null;
    return { kind: "poly", closed, pts, space, style: styleOf(r, closed ? "body" : "line") };
  }
  if ("path" in r) {
    const cmds = pathCmds(r.path);
    if (!cmds) return null;
    return { kind: "path", cmds, space, style: styleOf(r, "line") };
  }
  return null;
}

/** Shift a part by `(dx, dy)` in authoring units — how `repeat` is expanded. */
function offsetPart(p: SymbolPart, dx: number, dy: number): SymbolPart {
  switch (p.kind) {
    case "line":
      return { ...p, a: [p.a[0] + dx, p.a[1] + dy], b: [p.b[0] + dx, p.b[1] + dy] };
    case "rect":
      return { ...p, x: p.x + dx, y: p.y + dy };
    case "circle":
      return { ...p, cx: p.cx + dx, cy: p.cy + dy };
    case "ellipse":
      return { ...p, cx: p.cx + dx, cy: p.cy + dy };
    case "poly":
      return { ...p, pts: p.pts.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
    case "path":
      return {
        ...p,
        cmds: p.cmds.map((c) => {
          if (c[0] === "Z") return c;
          const shifted = c.slice(1).map((n, i) => (n as number) + (i % 2 === 0 ? dx : dy));
          return [c[0], ...shifted] as PathCmd;
        }),
      };
  }
}

/**
 * Expand `{ repeat, step, part }` into `repeat` copies of `part`, each shifted
 * by `i × step`. This is what lets a fitted wardrobe run, a flight of stairs
 * and a keyboard be a few lines of JSON instead of a `for` loop in the card —
 * the thing issue #90 was actually about. It nests one part, never a group, so
 * there is no recursion to bound.
 *
 * The offset is `i × step`, not an accumulating sum, so the last copy of a long
 * run lands where the arithmetic says rather than a float epsilon away.
 */
function expandPart(raw: unknown): SymbolPart[] {
  if (raw && typeof raw === "object" && "repeat" in (raw as Record<string, unknown>)) {
    const r = raw as Record<string, unknown>;
    const count = num(r.repeat);
    const step = nums(r.step, 2);
    const inner = normalizePart(r.part);
    if (count === null || !step || !inner) return [];
    const n = clamp(Math.round(count), 1, MAX_REPEAT);
    return Array.from({ length: n }, (_, i) => offsetPart(inner, step[0]! * i, step[1]! * i));
  }
  const one = normalizePart(raw);
  return one ? [one] : [];
}

/**
 * Validate an untrusted symbol. Returns null rather than throwing — a bad
 * symbol in a config should cost you that one glyph, not the whole dashboard.
 *
 * `fallbackId` names the source (the filename, for a bundled symbol, or the
 * config key) so a symbol whose `id` is missing or unusable still resolves.
 */
export function normalizeSymbol(
  raw: unknown,
  fallbackId?: string,
  problems?: string[]
): SymbolDef | null {
  const reject = (why: string) => {
    problems?.push(why);
    return null;
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return reject("A symbol has to be a JSON object.");
  }
  const r = raw as Record<string, unknown>;

  // The id becomes a CSS class (`fp-furniture-<id>`) and is what a config's
  // `type` is looked up by. It has to survive the identifier guard **unchanged**
  // — a sanitised id would file the symbol under a name no config could name,
  // so it would validate and then never resolve. Rejecting says so out loud.
  const named = typeof r.id === "string" && r.id.trim() ? r.id.trim() : fallbackId;
  const id = cssIdent(named);
  if (!id || id !== named) {
    return reject('`id` is missing, or uses characters a CSS class cannot: letters, digits, "-" and "_" only.');
  }

  if (!Array.isArray(r.parts)) return reject("`parts` has to be an array of shapes.");
  const parts: SymbolPart[] = [];
  for (const p of r.parts) {
    for (const part of expandPart(p)) {
      if (parts.length >= MAX_PARTS) break;
      parts.push(part);
    }
  }
  if (!parts.length) {
    return reject(
      "No drawable parts. Each one needs a known shape (line, rect, circle, ellipse, polygon, polyline, path) with the right number of finite numbers."
    );
  }

  const size = r.size && typeof r.size === "object" ? (r.size as Record<string, unknown>) : {};
  const w = num(size.w);
  const h = num(size.h);
  const vb = nums(r.viewBox, 4);

  return {
    id,
    name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 60) : id,
    category:
      typeof r.category === "string" && (SYMBOL_CATEGORIES as readonly string[]).includes(r.category)
        ? r.category
        : "other",
    keywords:
      Array.isArray(r.keywords)
        ? r.keywords.filter((k): k is string => typeof k === "string").slice(0, 12)
        : [],
    size: { w: w && w > 0 ? w : 60, h: h && h > 0 ? h : 60 },
    viewBox: vb && vb[2]! > 0 && vb[3]! > 0 ? (vb as [number, number, number, number]) : DEFAULT_VIEW_BOX,
    footprint: r.footprint === "ellipse" ? "ellipse" : "rect",
    parts,
  };
}

/**
 * What an unresolved `type` draws: the plain carcass, no detail. Same shape the
 * old hand-written `switch` fell through to, so a config naming a symbol this
 * install doesn't have leaves a visible, movable placeholder instead of a hole.
 */
export const FALLBACK_SYMBOL: SymbolDef = normalizeSymbol({
  id: "unknown",
  name: "unknown",
  size: { w: 60, h: 60 },
  parts: [{ rect: [0, 0, 100, 100], rx: 6.666667 }],
})!;

/**
 * The symbols shipped with the card, one JSON file each in `furniture/`.
 *
 * Bundled with a glob rather than a generated index so contributing a symbol
 * is exactly "add one file" — an index would be a second edit people forget,
 * and the reviewer would have to notice. Every file goes through
 * {@link normalizeSymbol}, the same validator a pasted symbol hits, so the
 * shipped library is 26 live test cases for it.
 */
export const BUILTIN_SYMBOLS: SymbolCatalog = (() => {
  const files = import.meta.glob("../furniture/*.json", { eager: true, import: "default" }) as Record<
    string,
    unknown
  >;
  const out = dict<SymbolDef>({});
  for (const [path, raw] of Object.entries(files)) {
    const def = normalizeSymbol(raw, path.split("/").pop()?.replace(/\.json$/, ""));
    if (def) out[def.id] = def;
  }
  return out;
})();

/**
 * Resolve a config-supplied `type` against a catalogue.
 *
 * The one way a catalogue is read. See {@link own}: a bare `catalog[type]` on a
 * plain object answers `toString` with a function, which every `??` fallback in
 * the renderers treats as a hit.
 */
export function findSymbol(catalog: SymbolCatalog, type: unknown): SymbolDef | undefined {
  return own(catalog as Record<string, SymbolDef>, type);
}

let cacheKey: unknown;
let cacheValue: SymbolCatalog = BUILTIN_SYMBOLS;

/**
 * The built-in library with a config's own `symbols:` merged over it. Memoized
 * on the config object's identity, because it is read on every render and
 * re-validating a paste box's worth of JSON per frame would show.
 */
export function symbolCatalog(symbols?: Record<string, unknown>): SymbolCatalog {
  if (!symbols || typeof symbols !== "object") return BUILTIN_SYMBOLS;
  if (symbols === cacheKey) return cacheValue;
  // Object.assign onto a null-prototype target, not a spread: `{ ...x }` would
  // hand back an ordinary object and undo the whole point.
  const out = dict<SymbolDef>({});
  Object.assign(out, BUILTIN_SYMBOLS);
  for (const [key, raw] of Object.entries(symbols)) {
    const def = normalizeSymbol(raw, key);
    if (def) out[def.id] = def;
  }
  cacheKey = symbols;
  cacheValue = out;
  return out;
}

/** Every symbol, ordered for the picker: by category, then by name. */
export function symbolList(catalog: SymbolCatalog): SymbolDef[] {
  const rank = (c: string) => {
    const i = (SYMBOL_CATEGORIES as readonly string[]).indexOf(c);
    return i < 0 ? SYMBOL_CATEGORIES.length : i;
  };
  return Object.values(catalog).sort(
    (a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name)
  );
}

/** Does this symbol match a picker search query? */
export function symbolMatches(def: SymbolDef, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    def.id.toLowerCase().includes(q) ||
    def.name.toLowerCase().includes(q) ||
    def.category.includes(q) ||
    def.keywords.some((k) => k.toLowerCase().includes(q))
  );
}

/** Default placement size for a type, falling back to a plain 60×60 box. */
export function symbolSize(type: string, catalog: SymbolCatalog = BUILTIN_SYMBOLS): {
  w: number;
  h: number;
} {
  return findSymbol(catalog, type)?.size ?? { w: 60, h: 60 };
}

/**
 * Map authoring coordinates onto the piece's box.
 *
 * The glyph is drawn centered on the origin, which is the convention the card
 * has always used — the caller translates and rotates it into place.
 */
interface Mapper {
  x(v: number): number;
  y(v: number): number;
  /** A length that must not distort: scaled by the smaller axis. */
  len(v: number): number;
  sx(v: number): number;
  sy(v: number): number;
}

function mapper(def: SymbolDef, w: number, h: number, space: SymbolSpace): Mapper {
  const [vx, vy, vw, vh] = def.viewBox;
  // `square` lays the part out in the centered square of side min(w, h), so a
  // ring of jets stays concentric with a circle on a piece that is not square.
  const bw = space === "square" ? Math.min(w, h) : w;
  const bh = space === "square" ? Math.min(w, h) : h;
  const kx = bw / vw;
  const ky = bh / vh;
  return {
    x: (v) => (v - vx) * kx - bw / 2,
    y: (v) => (v - vy) * ky - bh / 2,
    len: (v) => v * Math.min(kx, ky),
    sx: (v) => v * kx,
    sy: (v) => v * ky,
  };
}

const fmt = (n: number) => (Number.isFinite(n) ? n : 0);

/** Paint attributes for a part, with the piece's color poured in. */
function paint(style: PartStyle, color: string) {
  const fill = style.fillOpacity > 0 ? color : "none";
  const stroke = style.role === "solid" ? "none" : color;
  return { fill, stroke, style };
}

function partTemplate(p: SymbolPart, m: Mapper, color: string): SVGTemplateResult {
  const { fill, stroke, style } = paint(p.style, color);
  // Omitted rather than defaulted: `opacity="1"` and `stroke-dasharray="none"`
  // on every part would triple the markup a large plan carries for no effect.
  const op = style.opacity < 1 ? style.opacity : nothing;
  const dash = style.dash?.length ? style.dash.join(" ") : nothing;
  const fillOp = style.fillOpacity > 0 && style.fillOpacity < 1 ? style.fillOpacity : nothing;
  const sw = style.role === "solid" ? nothing : style.width;

  switch (p.kind) {
    case "line":
      return svg`<line x1=${fmt(m.x(p.a[0]))} y1=${fmt(m.y(p.a[1]))}
                       x2=${fmt(m.x(p.b[0]))} y2=${fmt(m.y(p.b[1]))}
                       fill="none" stroke=${stroke} stroke-width=${sw}
                       stroke-dasharray=${dash} opacity=${op} />`;
    case "rect":
      return svg`<rect x=${fmt(m.x(p.x))} y=${fmt(m.y(p.y))}
                       width=${fmt(m.sx(p.w))} height=${fmt(m.sy(p.h))}
                       rx=${p.rx > 0 ? fmt(m.len(p.rx)) : nothing}
                       fill=${fill} fill-opacity=${fillOp}
                       stroke=${stroke} stroke-width=${sw}
                       stroke-dasharray=${dash} opacity=${op} />`;
    case "circle":
      return svg`<circle cx=${fmt(m.x(p.cx))} cy=${fmt(m.y(p.cy))} r=${fmt(m.len(p.r))}
                         fill=${fill} fill-opacity=${fillOp}
                         stroke=${stroke} stroke-width=${sw} opacity=${op} />`;
    case "ellipse":
      return svg`<ellipse cx=${fmt(m.x(p.cx))} cy=${fmt(m.y(p.cy))}
                          rx=${fmt(m.sx(p.rx))} ry=${fmt(m.sy(p.ry))}
                          fill=${fill} fill-opacity=${fillOp}
                          stroke=${stroke} stroke-width=${sw} opacity=${op} />`;
    case "poly": {
      const pts = p.pts.map(([x, y]) => `${fmt(m.x(x))},${fmt(m.y(y))}`).join(" ");
      return p.closed
        ? svg`<polygon points=${pts}
                       fill=${fill} fill-opacity=${fillOp}
                       stroke=${stroke} stroke-width=${sw}
                       stroke-linejoin="round" opacity=${op} />`
        : svg`<polyline points=${pts} fill="none"
                        stroke=${stroke} stroke-width=${sw}
                        stroke-linejoin="round" opacity=${op} />`;
    }
    case "path": {
      const d = p.cmds
        .map((c) =>
          c[0] === "Z"
            ? "Z"
            : `${c[0]} ${c
                .slice(1)
                .map((n, i) => (i % 2 === 0 ? fmt(m.x(n as number)) : fmt(m.y(n as number))))
                .join(" ")}`
        )
        .join(" ");
      return svg`<path d=${d}
                       fill=${fill} fill-opacity=${fillOp}
                       stroke=${stroke} stroke-width=${sw}
                       stroke-linejoin="round" opacity=${op} />`;
    }
  }
}

/**
 * A symbol's parts, drawn into a `w × h` box centered on the origin, in
 * `color`. The caller wraps them in the positioned group.
 */
export function renderSymbolParts(
  def: SymbolDef,
  w: number,
  h: number,
  color: string
): SVGTemplateResult[] {
  const box = mapper(def, w, h, "box");
  const square = mapper(def, w, h, "square");
  return def.parts.map((p) => partTemplate(p, p.space === "square" ? square : box, color));
}
