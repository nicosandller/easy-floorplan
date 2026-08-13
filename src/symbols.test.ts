import { describe, it, expect } from "vitest";
import {
  BUILTIN_SYMBOLS,
  FALLBACK_SYMBOL,
  MAX_PARTS,
  MAX_REPEAT,
  MAX_STROKE_WIDTH,
  MIN_STROKE_WIDTH,
  SYMBOL_CATEGORIES,
  normalizeSymbol,
  renderSymbolParts,
  symbolCatalog,
  symbolList,
  symbolMatches,
  symbolSize,
} from "./symbols";
import type { FurnitureType } from "./types";

/**
 * Same strict flattener `render.test.ts` documents: Lit's `nothing`, null and
 * booleans all render as nothing at all, and attribute values come out
 * **unquoted** because this is the interpolated form.
 */
const flatten = (node: unknown): string => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "symbol") return "";
  if (Array.isArray(node)) return node.map(flatten).join("");
  if (typeof node === "object" && "strings" in (node as Record<string, unknown>)) {
    const { strings, values } = node as { strings: string[]; values: unknown[] };
    return strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? flatten(values[i]) : ""),
      "",
    );
  }
  return String(node);
};

const draw = (parts: unknown[], w = 100, h = 100): string => {
  const def = normalizeSymbol({ id: "t", size: { w, h }, parts });
  expect(def, "symbol should validate").not.toBeNull();
  return flatten(renderSymbolParts(def!, w, h, "#111"));
};

/** All numbers in an attribute, e.g. `attr("x1", markup)`. */
const attr = (name: string, markup: string): number[] =>
  [...markup.matchAll(new RegExp(`\\s${name}=(-?[\\d.]+)`, "g"))].map((m) => Number(m[1]));

// ---------------------------------------------------------------------------

describe("the shipped furniture library", () => {
  // The same glob the card bundles with, so this asserts on exactly what ships
  // rather than on whatever happens to be on disk.
  const files = Object.entries(
    import.meta.glob("../furniture/*.json", { eager: true, import: "default" }) as Record<
      string,
      { id: string }
    >
  ).map(([path, raw]) => [path.split("/").pop()!, raw] as const);

  it("ships every symbol as its own file, and every file validates", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const [file, raw] of files) {
      expect(normalizeSymbol(raw), file).not.toBeNull();
    }
  });

  // The catalogue is keyed by the symbol's own `id`, but a contributor naturally
  // looks for `sofa.json`. If the two drift, the file people edit is not the
  // symbol they see, which is a confusing way to lose an afternoon.
  it("names each file after the id inside it", () => {
    for (const [file, raw] of files) expect(`${raw.id}.json`, file).toBe(file);
  });

  it("loads them all into the catalogue, with no id lost to a collision", () => {
    expect(Object.keys(BUILTIN_SYMBOLS)).toHaveLength(files.length);
  });

  it("files every symbol under a known category", () => {
    for (const s of Object.values(BUILTIN_SYMBOLS)) {
      expect(SYMBOL_CATEGORIES as readonly string[], s.id).toContain(s.category);
    }
  });

  it("gives every symbol a positive default size", () => {
    for (const s of Object.values(BUILTIN_SYMBOLS)) {
      expect(s.size.w, s.id).toBeGreaterThan(0);
      expect(s.size.h, s.id).toBeGreaterThan(0);
    }
  });

  // The union in types.ts is what a hand-written config autocompletes against
  // and what the README documents. A member with no symbol behind it would draw
  // the blank fallback box.
  it("answers to every name in the FurnitureType union", () => {
    const union: FurnitureType[] = [
      "table", "roundTable", "desk", "chair", "sofa", "bed", "wardrobe", "rug",
      "plant", "fridge", "stove", "sink", "toilet", "stairs", "tv",
      "washer", "dryer", "dishwasher", "waterHeater", "airHandler", "bathtub",
      "vanity", "sectional", "fishTank", "piano", "hotTub",
    ];
    for (const t of union) expect(BUILTIN_SYMBOLS[t], t).toBeTruthy();
    expect(Object.keys(BUILTIN_SYMBOLS).sort()).toEqual([...union].sort());
  });

  it("draws every symbol without throwing, at its own size and at a squashed one", () => {
    for (const s of Object.values(BUILTIN_SYMBOLS)) {
      expect(() => renderSymbolParts(s, s.size.w, s.size.h, "#111"), s.id).not.toThrow();
      expect(() => renderSymbolParts(s, 300, 20, "#111"), s.id).not.toThrow();
    }
  });

  // No symbol names a color, which is what makes entity recoloring (#82) and
  // skins (#122) work on a contributed glyph without it doing anything.
  it("paints every part in the color it is handed, and no other", () => {
    for (const s of Object.values(BUILTIN_SYMBOLS)) {
      const markup = flatten(renderSymbolParts(s, s.size.w, s.size.h, "#abcdef"));
      const paints = [...markup.matchAll(/\s(?:fill|stroke)="?([^\s/">]+)"?/g)].map((m) => m[1]);
      expect(paints.length, s.id).toBeGreaterThan(0);
      for (const p of paints) expect(["#abcdef", "none"], `${s.id}: ${p}`).toContain(p);
    }
  });
});

describe("mapping a symbol onto a piece's box", () => {
  it("puts the middle of the viewBox at the origin, where the glyph is centered", () => {
    const markup = draw([{ circle: [50, 50, 10] }], 200, 80);
    expect(attr("cx", markup)).toEqual([0]);
    expect(attr("cy", markup)).toEqual([0]);
  });

  it("reads a coordinate as a fraction of the box, per axis", () => {
    // vy = 22 in a 0..100 viewBox is the glyphs' old `-h/2 + h * 0.22`.
    const markup = draw([{ line: [0, 22, 100, 22] }], 300, 50);
    expect(attr("y1", markup)).toEqual([-50 / 2 + 50 * 0.22]);
    expect(attr("x1", markup)).toEqual([-150]);
    expect(attr("x2", markup)).toEqual([150]);
  });

  // A radius has no axis to belong to. Scaling it by the smaller side is what
  // the old glyphs did by hand (`Math.min(w, h) * k`) and is the only choice
  // that leaves a circle circular on a piece that is not square.
  it("keeps a circle circular when the piece is not square", () => {
    const wide = draw([{ circle: [50, 50, 20] }], 400, 100);
    const tall = draw([{ circle: [50, 50, 20] }], 100, 400);
    expect(attr("r", wide)).toEqual([20]);
    expect(attr("r", tall)).toEqual([20]);
  });

  it("lets an ellipse stretch with the box, because both its axes are named", () => {
    const markup = draw([{ ellipse: [50, 50, 50, 50] }], 400, 100);
    expect(attr("rx", markup)).toEqual([200]);
    expect(attr("ry", markup)).toEqual([50]);
  });

  it("scales a corner radius like a radius, not like a width", () => {
    const markup = draw([{ rect: [0, 0, 100, 100], rx: 10 }], 400, 100);
    expect(attr("rx", markup)).toEqual([10]);
  });

  it("omits a zero corner radius rather than writing rx=0", () => {
    expect(attr("rx", draw([{ rect: [0, 0, 100, 100] }]))).toEqual([]);
  });

  // Stroke widths are plan units, deliberately: line art that thickened with
  // the furniture would make a big sofa look like a different drawing.
  it("does not scale stroke width with the piece", () => {
    expect(attr("stroke-width", draw([{ line: [0, 0, 100, 100] }], 40, 40))).toEqual([2]);
    expect(attr("stroke-width", draw([{ line: [0, 0, 100, 100] }], 400, 400))).toEqual([2]);
  });

  it("does not clip a part that reaches outside the viewBox", () => {
    // The tv's stand is drawn below its box this way.
    const markup = draw([{ line: [50, 100, 50, 200] }], 100, 100);
    expect(attr("y2", markup)).toEqual([150]);
  });

  it("respects a viewBox that is not the default 0 0 100 100", () => {
    const def = normalizeSymbol({
      id: "t", viewBox: [-10, -10, 20, 20], size: { w: 100, h: 100 },
      parts: [{ circle: [0, 0, 10] }],
    })!;
    const markup = flatten(renderSymbolParts(def, 100, 100, "#111"));
    expect(attr("cx", markup)).toEqual([0]);
    expect(attr("r", markup)).toEqual([50]);
  });

  // `space: "square"` exists for rings of parts that have to stay concentric
  // with a circle — the hot tub's jets sit on its water, not on its shell.
  it("lays a square-space part out in the centered square of the box", () => {
    // vx = 100 is the viewBox's right edge. In square space that is half of
    // min(w, h) from the centre; in box space it is half of w.
    const square = draw([{ circle: [100, 50, 0], space: "square" }], 400, 100);
    expect(attr("cx", square)).toEqual([50]);
    const box = draw([{ circle: [100, 50, 0] }], 400, 100);
    expect(attr("cx", box)).toEqual([200]);
  });
});

describe("primitives", () => {
  it("draws a line, rect, circle, ellipse, polygon, polyline and path", () => {
    const markup = draw([
      { line: [0, 0, 10, 10] },
      { rect: [0, 0, 10, 10] },
      { circle: [5, 5, 2] },
      { ellipse: [5, 5, 2, 3] },
      { polygon: [[0, 0], [10, 0], [10, 10]] },
      { polyline: [[0, 0], [10, 10]] },
      { path: [["M", 0, 0], ["L", 10, 10], ["Z"]] },
    ]);
    for (const tag of ["line", "rect", "circle", "ellipse", "polygon", "polyline", "path"]) {
      expect(markup, tag).toContain(`<${tag} `);
    }
  });

  it("writes a path as absolute commands, mapping x and y separately", () => {
    const markup = draw([{ path: [["M", 0, 0], ["L", 100, 100], ["Z"]] }], 200, 40);
    expect(markup).toContain("d=M -100 -20 L 100 20 Z");
  });

  it("rejects a path that starts anywhere but a move", () => {
    expect(normalizeSymbol({ id: "t", parts: [{ path: [["L", 1, 1]] }] })).toBeNull();
  });

  it("rejects a path command it cannot map, rather than passing it through", () => {
    // Arcs carry flags that are not coordinates; the format leaves them out.
    expect(normalizeSymbol({ id: "t", parts: [{ path: [["M", 0, 0], ["A", 1, 1, 0, 0, 1, 5, 5]] }] }))
      .toBeNull();
  });

  it("rejects a path command with the wrong number of arguments", () => {
    expect(normalizeSymbol({ id: "t", parts: [{ path: [["M", 0], ["L", 1, 1]] }] })).toBeNull();
  });
});

describe("repeat", () => {
  it("stamps one part n times along its step", () => {
    const markup = draw([{ repeat: 4, step: [0, 25], part: { line: [0, 0, 100, 0] } }]);
    expect(attr("y1", markup)).toEqual([-50, -25, 0, 25]);
  });

  it("offsets by i × step, so a long run does not drift on accumulated float", () => {
    const def = normalizeSymbol({
      id: "t", parts: [{ repeat: 8, step: [100 / 7, 0], part: { line: [0, 0, 0, 100] } }],
    })!;
    const markup = flatten(renderSymbolParts(def, 700, 100, "#111"));
    const xs = attr("x1", markup);
    expect(xs[xs.length - 1]).toBe(-350 + 700);
  });

  it("shifts a path, a polygon and a rect the same way it shifts a line", () => {
    expect(draw([{ repeat: 2, step: [50, 0], part: { rect: [0, 0, 10, 10] } }]))
      .toContain("<rect x=0 ");
    expect(draw([{ repeat: 2, step: [0, 10], part: { path: [["M", 0, 0], ["L", 10, 0]] } }]))
      .toContain("d=M -50 -40 L -40 -40");
    expect(draw([{ repeat: 2, step: [10, 0], part: { polygon: [[0, 0], [10, 0], [0, 10]] } }]))
      .toContain("points=-40,-50 -30,-50 -40,-40");
  });

  it("caps the count, so a config cannot ask for a million copies", () => {
    const def = normalizeSymbol({
      id: "t", parts: [{ repeat: 1e6, step: [1, 0], part: { line: [0, 0, 0, 10] } }],
    })!;
    expect(def.parts.length).toBe(MAX_REPEAT);
  });

  it("rounds a fractional count and floors it at one", () => {
    const one = normalizeSymbol({
      id: "t", parts: [{ repeat: 0, step: [1, 0], part: { line: [0, 0, 0, 10] } }],
    });
    expect(one!.parts).toHaveLength(1);
  });

  it("drops the whole repeat when its inner part is not drawable", () => {
    expect(normalizeSymbol({ id: "t", parts: [{ repeat: 3, step: [1, 0], part: { line: [1, 2] } }] }))
      .toBeNull();
  });
});

describe("roles and their numeric overrides", () => {
  it("fills a body at low opacity and strokes everything else at full color", () => {
    const body = draw([{ rect: [0, 0, 100, 100], role: "body" }]);
    expect(body).toContain("fill=#111");
    expect(body).toContain("fill-opacity=0.12");
    const line = draw([{ rect: [0, 0, 100, 100], role: "line" }]);
    expect(line).toContain("fill=none");
  });

  it("gives the four line weights the widths the old glyphs used", () => {
    const widths = (role: string) =>
      attr("stroke-width", draw([{ line: [0, 0, 10, 10], role }]))[0];
    expect(widths("line")).toBe(2);
    expect(widths("thin")).toBe(1.5);
    expect(widths("detail")).toBe(1.5);
    expect(widths("hint")).toBe(1);
  });

  it("takes a numeric width and opacity over the role's defaults", () => {
    const markup = draw([{ line: [0, 0, 10, 10], role: "hint", width: 3, opacity: 0.25 }]);
    expect(attr("stroke-width", markup)).toEqual([3]);
    expect(attr("opacity", markup)).toEqual([0.25]);
  });

  it("omits opacity when it is 1, rather than writing it on every part", () => {
    expect(draw([{ line: [0, 0, 10, 10] }])).not.toMatch(/\sopacity=[\d.]/);
  });

  it("clamps a stroke width, so a symbol cannot paint over the whole plan", () => {
    expect(attr("stroke-width", draw([{ line: [0, 0, 1, 1], width: 9999 }])))
      .toEqual([MAX_STROKE_WIDTH]);
    expect(attr("stroke-width", draw([{ line: [0, 0, 1, 1], width: -5 }])))
      .toEqual([MIN_STROKE_WIDTH]);
  });

  it("clamps opacities into 0..1", () => {
    expect(attr("opacity", draw([{ line: [0, 0, 1, 1], opacity: 40 }]))).toEqual([]);
    expect(attr("opacity", draw([{ line: [0, 0, 1, 1], opacity: -3 }]))).toEqual([0]);
  });

  it("falls back to the role's own default when a number is not a number", () => {
    const markup = draw([{ line: [0, 0, 10, 10], role: "detail", width: "3" }]);
    expect(attr("stroke-width", markup)).toEqual([1.5]);
  });

  it("treats an unknown role as the primitive's default rather than dropping the part", () => {
    expect(attr("stroke-width", draw([{ line: [0, 0, 10, 10], role: "neon" }]))).toEqual([2]);
  });

  it("carries a dash pattern through in plan units", () => {
    expect(draw([{ rect: [0, 0, 100, 100], dash: [8, 5] }])).toContain("stroke-dasharray=8 5");
  });
});

describe("validating an untrusted symbol", () => {
  it("returns null instead of throwing, so a bad symbol costs one glyph", () => {
    for (const bad of [null, undefined, 42, "sofa", [], {}, { id: "t" }, { id: "t", parts: [] }]) {
      expect(normalizeSymbol(bad), JSON.stringify(bad) ?? "undefined").toBeNull();
    }
  });

  it("rejects a coordinate that is not a finite number", () => {
    for (const bad of [NaN, Infinity, -Infinity, "10", null, undefined, {}]) {
      expect(normalizeSymbol({ id: "t", parts: [{ line: [0, 0, 10, bad] }] }), String(bad))
        .toBeNull();
    }
  });

  it("rejects a coordinate tuple of the wrong length", () => {
    expect(normalizeSymbol({ id: "t", parts: [{ line: [0, 0, 10] }] })).toBeNull();
    expect(normalizeSymbol({ id: "t", parts: [{ circle: [0, 0, 1, 1] }] })).toBeNull();
  });

  it("rejects a negative radius", () => {
    expect(normalizeSymbol({ id: "t", parts: [{ circle: [0, 0, -5] }] })).toBeNull();
  });

  it("drops a part whose primitive it does not know, keeping the rest", () => {
    const def = normalizeSymbol({
      id: "t", parts: [{ line: [0, 0, 1, 1] }, { spiral: [0, 0, 5] }, { rect: [0, 0, 1, 1] }],
    })!;
    expect(def.parts).toHaveLength(2);
  });

  it("caps the total part count after repeats are expanded", () => {
    const def = normalizeSymbol({
      id: "t",
      parts: Array.from({ length: 20 }, () => ({
        repeat: MAX_REPEAT, step: [1, 0], part: { line: [0, 0, 0, 1] },
      })),
    })!;
    expect(def.parts).toHaveLength(MAX_PARTS);
  });

  // The id becomes a CSS class on the drawn group, so it goes through the same
  // identifier guard every other user-supplied hook does.
  it("refuses an id that would not be safe as a class name, rather than renaming it", () => {
    for (const bad of ['a"b', "a{b", "a b", "", "a;b", "café"]) {
      expect(normalizeSymbol({ id: bad, parts: [{ line: [0, 0, 1, 1] }] }), bad).toBeNull();
    }
    expect(normalizeSymbol({ id: "my_desk-2", parts: [{ line: [0, 0, 1, 1] }] })?.id).toBe("my_desk-2");
  });

  it("falls back to the source name when the id is missing or unusable", () => {
    const def = normalizeSymbol({ parts: [{ line: [0, 0, 1, 1] }] }, "my-desk");
    expect(def?.id).toBe("my-desk");
  });

  it("defaults everything optional, so the smallest usable symbol is id plus one part", () => {
    const def = normalizeSymbol({ id: "t", parts: [{ line: [0, 0, 1, 1] }] })!;
    expect(def.name).toBe("t");
    expect(def.category).toBe("other");
    expect(def.keywords).toEqual([]);
    expect(def.viewBox).toEqual([0, 0, 100, 100]);
    expect(def.footprint).toBe("rect");
    expect(def.size.w).toBeGreaterThan(0);
  });

  it("ignores a zero or negative viewBox rather than dividing by it", () => {
    const def = normalizeSymbol({ id: "t", viewBox: [0, 0, 0, 100], parts: [{ line: [0, 0, 1, 1] }] })!;
    expect(def.viewBox).toEqual([0, 0, 100, 100]);
  });

  it("ignores a zero or negative default size", () => {
    const def = normalizeSymbol({ id: "t", size: { w: 0, h: -4 }, parts: [{ line: [0, 0, 1, 1] }] })!;
    expect(def.size.w).toBeGreaterThan(0);
    expect(def.size.h).toBeGreaterThan(0);
  });

  it("files an unrecognised category under other", () => {
    const def = normalizeSymbol({ id: "t", category: "garage", parts: [{ line: [0, 0, 1, 1] }] })!;
    expect(def.category).toBe("other");
  });
});

describe("the catalogue", () => {
  const custom = {
    "my-desk": { id: "my-desk", name: "my desk", size: { w: 90, h: 50 }, parts: [{ rect: [0, 0, 100, 100] }] },
  };

  it("is the built-in library when a config defines no symbols", () => {
    expect(symbolCatalog(undefined)).toBe(BUILTIN_SYMBOLS);
  });

  it("adds a config's own symbols to the shipped ones", () => {
    const cat = symbolCatalog(custom);
    expect(cat["my-desk"]?.name).toBe("my desk");
    expect(cat.sofa).toBeTruthy();
  });

  it("lets a config override a shipped symbol under the same id", () => {
    const cat = symbolCatalog({ sofa: { id: "sofa", name: "my sofa", parts: [{ rect: [0, 0, 1, 1] }] } });
    expect(cat.sofa?.name).toBe("my sofa");
    expect(BUILTIN_SYMBOLS.sofa?.name).toBe("sofa");
  });

  it("skips a symbol that fails validation instead of losing the whole block", () => {
    const cat = symbolCatalog({ broken: { parts: "nope" }, ...custom });
    expect(cat.broken).toBeUndefined();
    expect(cat["my-desk"]).toBeTruthy();
  });

  it("keys a symbol by the block's own key when it carries no id", () => {
    const cat = symbolCatalog({ shelf: { parts: [{ line: [0, 0, 1, 1] }] } });
    expect(cat.shelf).toBeTruthy();
  });

  // Read on every render, so re-validating a paste box of JSON per frame would
  // show up as jank on a plan with a lot of furniture.
  it("memoizes on the config object's identity", () => {
    expect(symbolCatalog(custom)).toBe(symbolCatalog(custom));
    expect(symbolCatalog({ ...custom })).not.toBe(symbolCatalog(custom));
  });

  it("does not let a config symbol mutate the shipped library", () => {
    symbolCatalog({ sofa: { id: "sofa", name: "mine", parts: [{ rect: [0, 0, 1, 1] }] } });
    expect(BUILTIN_SYMBOLS.sofa?.name).toBe("sofa");
  });
});

describe("the picker's view of the catalogue", () => {
  it("orders by category, then by name inside it", () => {
    const order = symbolList(BUILTIN_SYMBOLS).map((s) => s.category);
    const ranks = order.map((c) => (SYMBOL_CATEGORIES as readonly string[]).indexOf(c));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    const living = symbolList(BUILTIN_SYMBOLS).filter((s) => s.category === "living").map((s) => s.name);
    expect(living).toEqual([...living].sort((a, b) => a.localeCompare(b)));
  });

  it("puts an uncategorised community symbol at the end, not in the middle", () => {
    const list = symbolList(symbolCatalog({ widget: { parts: [{ line: [0, 0, 1, 1] }] } }));
    expect(list[list.length - 1]?.id).toBe("widget");
  });

  it("matches on id, name, category and the symbol's own keywords", () => {
    const sofa = BUILTIN_SYMBOLS.sofa!;
    for (const q of ["sofa", "SOFA", " sofa ", "couch", "living"]) {
      expect(symbolMatches(sofa, q), q).toBe(true);
    }
    expect(symbolMatches(sofa, "toaster")).toBe(false);
  });

  it("matches everything on an empty query", () => {
    expect(symbolMatches(BUILTIN_SYMBOLS.sofa!, "   ")).toBe(true);
  });

  it("gives a symbol's own default size, and a sane box for one it has never heard of", () => {
    expect(symbolSize("sofa")).toEqual(BUILTIN_SYMBOLS.sofa!.size);
    const unknown = symbolSize("no-such-symbol");
    expect(unknown.w).toBeGreaterThan(0);
    expect(unknown.h).toBeGreaterThan(0);
  });
});

describe("the fallback symbol", () => {
  it("is a plain box, so a missing symbol is visible rather than a hole", () => {
    const markup = flatten(renderSymbolParts(FALLBACK_SYMBOL, 100, 60, "#111"));
    expect(markup).toContain("<rect");
    expect(markup).toContain("fill=#111");
    expect(markup).not.toContain("<line");
  });
});
