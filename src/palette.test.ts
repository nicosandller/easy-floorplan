import { describe, it, expect } from "vitest";
import {
  MAX_PALETTE,
  paletteEntries,
  paletteKey,
  paletteRef,
  paletteRefSlug,
  paletteSlug,
  paletteStyle,
  paletteVar,
  resolvePaletteColor,
  rewritePaletteRefs,
} from "./palette";
import { cssColor } from "./css-safe";
import type { PaletteColor } from "./types";

const PALETTE: PaletteColor[] = [
  { name: "Warm", color: "#ff8800" },
  { name: "Cold", color: "#4488ff" },
];

describe("paletteSlug — a display name becomes a custom property", () => {
  it("lowercases and hyphenates", () => {
    expect(paletteSlug("Warm")).toBe("warm");
    expect(paletteSlug("Warm White")).toBe("warm-white");
    expect(paletteSlug("Too  Hot!!")).toBe("too-hot");
  });

  it("trims the hyphens a leading or trailing symbol would leave", () => {
    // "--fp-color--hot-" is a legal property name but an ugly one, and it makes
    // two names that read the same produce different properties.
    expect(paletteSlug("  Hot  ")).toBe("hot");
    expect(paletteSlug("!Hot!")).toBe("hot");
    expect(paletteSlug("-hot-")).toBe("hot");
  });

  it("treats names that differ only in punctuation as the same colour", () => {
    expect(paletteSlug("Warm white")).toBe(paletteSlug("warm-white"));
    expect(paletteSlug("Warm_white")).toBe(paletteSlug("Warm White"));
  });

  it("returns empty for a name with nothing usable in it", () => {
    expect(paletteSlug("")).toBe("");
    expect(paletteSlug("   ")).toBe("");
    expect(paletteSlug("!!!")).toBe("");
    expect(paletteSlug(undefined)).toBe("");
    expect(paletteSlug(42)).toBe("");
  });

  it("keeps digits, since 'Color 2' is what the editor names a new entry", () => {
    expect(paletteSlug("Color 2")).toBe("color-2");
  });
});

describe("paletteVar / paletteRef — what a field stores", () => {
  it("builds the property and the reference from the name", () => {
    expect(paletteVar("Warm White")).toBe("--fp-color-warm-white");
    expect(paletteRef("Warm White")).toBe("var(--fp-color-warm-white)");
  });

  it("produces a reference cssColor accepts, or the plan would not paint", () => {
    // The whole design rests on this: a reference is an ordinary CSS value that
    // every existing sink already lets through.
    expect(cssColor(paletteRef("Warm"))).toBe("var(--fp-color-warm)");
  });
});

describe("paletteEntries — what the rest of the card is allowed to see", () => {
  it("passes a good palette through", () => {
    expect(paletteEntries(PALETTE)).toEqual(PALETTE);
  });

  it("is empty for anything that is not a list", () => {
    expect(paletteEntries(undefined)).toEqual([]);
    expect(paletteEntries(null)).toEqual([]);
    expect(paletteEntries("warm")).toEqual([]);
    expect(paletteEntries({ warm: "#f80" })).toEqual([]);
  });

  it("drops the bad entry rather than the palette", () => {
    // A hand-written config with one typo in it should lose that colour only.
    const entries = paletteEntries([
      { name: "Warm", color: "#ff8800" },
      { name: "", color: "#000000" },
      { name: "Broken", color: "red;position:fixed;inset:0" },
      { name: "Cold", color: "#4488ff" },
    ]);
    expect(entries.map((p) => p.name)).toEqual(["Warm", "Cold"]);
  });

  it("keeps the first of two names that mean the same property", () => {
    // Two entries on one slug means one of them silently never resolves; which
    // one is an accident of ordering, so the rule is written down and tested.
    const entries = paletteEntries([
      { name: "Warm white", color: "#ff8800" },
      { name: "warm-white", color: "#000000" },
    ]);
    expect(entries).toEqual([{ name: "Warm white", color: "#ff8800" }]);
  });

  it("accepts every colour the card accepts, not just hex", () => {
    const entries = paletteEntries([
      { name: "Theme", color: "var(--primary-color)" },
      { name: "Named", color: "rebeccapurple" },
      { name: "Mixed", color: "color-mix(in srgb, red 50%, blue)" },
    ]);
    expect(entries).toHaveLength(3);
  });

  it("trims the stored name so a stray space is not part of the label", () => {
    expect(paletteEntries([{ name: "  Warm  ", color: "#f80" }])[0].name).toBe("Warm");
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_PALETTE + 5 }, (_, i) => ({
      name: `C${i}`,
      color: "#ff8800",
    }));
    expect(paletteEntries(many)).toHaveLength(MAX_PALETTE);
  });

  it("survives junk in the list", () => {
    expect(paletteEntries([null, undefined, 7, "x", { name: "Warm", color: "#f80" }])).toEqual([
      { name: "Warm", color: "#f80" },
    ]);
  });
});

describe("paletteStyle — the declarations the card emits", () => {
  it("writes one declaration per colour", () => {
    expect(paletteStyle(PALETTE)).toBe("--fp-color-warm:#ff8800;--fp-color-cold:#4488ff;");
  });

  it("emits nothing for an empty or absent palette", () => {
    // An unpalettised plan must not gain a style attribute it never had.
    expect(paletteStyle(undefined)).toBe("");
    expect(paletteStyle([])).toBe("");
  });

  it("cannot break out of the style attribute", () => {
    // Both halves reach CSS sanitised: the name only as slug output, the colour
    // only as cssColor output. Neither can end the declaration or start a rule.
    const style = paletteStyle([
      { name: "a;color:red;--x", color: "#ff0000" },
      { name: "Evil", color: "red;position:fixed;inset:0;z-index:99999" },
      { name: "Fetch", color: "url(https://evil/x)" },
    ]);
    expect(style).toBe("--fp-color-a-color-red-x:#ff0000;");
    expect(style).not.toContain("position");
    expect(style).not.toContain("url(");
    // One declaration means one colon and one semicolon.
    expect(style.match(/;/g)).toHaveLength(1);
  });
});

describe("paletteKey — the repaint key", () => {
  it("changes when a colour changes", () => {
    const before = paletteKey(PALETTE);
    const after = paletteKey([{ name: "Warm", color: "#00ff00" }, PALETTE[1]]);
    expect(after).not.toBe(before);
  });

  it("changes when an entry is added, removed or renamed", () => {
    const base = paletteKey(PALETTE);
    expect(paletteKey([...PALETTE, { name: "New", color: "#111111" }])).not.toBe(base);
    expect(paletteKey([PALETTE[0]])).not.toBe(base);
    expect(paletteKey([{ name: "Toasty", color: "#ff8800" }, PALETTE[1]])).not.toBe(base);
  });

  it("is stable when nothing that reaches CSS changed", () => {
    // Re-keying rebuilds the SVG subtree, so it must not happen on every render.
    expect(paletteKey(PALETTE)).toBe(paletteKey([...PALETTE]));
    expect(paletteKey(undefined)).toBe(paletteKey([]));
  });
});

describe("paletteRefSlug — recognising a reference", () => {
  it("reads the slug out of a reference", () => {
    expect(paletteRefSlug("var(--fp-color-warm)")).toBe("warm");
    expect(paletteRefSlug("  var( --fp-color-warm-white )  ")).toBe("warm-white");
    expect(paletteRefSlug("var(--fp-color-warm, #ff8800)")).toBe("warm");
  });

  it("says nothing for an ordinary colour", () => {
    expect(paletteRefSlug("#ff8800")).toBeUndefined();
    expect(paletteRefSlug("red")).toBeUndefined();
    expect(paletteRefSlug(undefined)).toBeUndefined();
  });

  it("does not mistake a theme variable for a palette colour", () => {
    // --fp-color-* is ours; --primary-color and the skin tokens are not.
    expect(paletteRefSlug("var(--primary-color)")).toBeUndefined();
    expect(paletteRefSlug("var(--fp-skin-accent)")).toBeUndefined();
  });

  it("does not match a reference buried in a larger value", () => {
    // color-mix(… var(--fp-color-warm) …) is a real colour, not a reference to
    // one: resolving it to the palette entry would throw the mix away.
    expect(paletteRefSlug("color-mix(in srgb, var(--fp-color-warm), blue)")).toBeUndefined();
  });
});

describe("resolvePaletteColor — only for JavaScript that has to read a colour", () => {
  it("resolves a reference to the literal it names", () => {
    expect(resolvePaletteColor("var(--fp-color-warm)", PALETTE)).toBe("#ff8800");
  });

  it("leaves an ordinary colour exactly as it was", () => {
    expect(resolvePaletteColor("#123456", PALETTE)).toBe("#123456");
    expect(resolvePaletteColor("var(--primary-color)", PALETTE)).toBe("var(--primary-color)");
    expect(resolvePaletteColor(undefined, PALETTE)).toBeUndefined();
  });

  it("leaves a dangling reference alone rather than inventing a colour", () => {
    // The caller (contrastText, the editor swatch) has its own fallback for a
    // colour it cannot read; guessing one here would be worse than not trying.
    expect(resolvePaletteColor("var(--fp-color-gone)", PALETTE)).toBe("var(--fp-color-gone)");
    expect(resolvePaletteColor("var(--fp-color-warm)", [])).toBe("var(--fp-color-warm)");
  });

  it("matches the name however it was spelled", () => {
    expect(resolvePaletteColor("var(--fp-color-warm-white)", [
      { name: "Warm White", color: "#ff8800" },
    ])).toBe("#ff8800");
  });

  it("ignores an entry the palette itself would reject", () => {
    expect(resolvePaletteColor("var(--fp-color-bad)", [{ name: "Bad", color: "url(x)" }])).toBe(
      "var(--fp-color-bad)"
    );
  });
});

describe("round trip — a name picked in the editor reaches CSS", () => {
  it("stores a reference the style it emits actually declares", () => {
    // The one invariant that makes the feature work: whatever paletteRef writes
    // into a config field, paletteStyle must declare a property of that name.
    for (const name of ["Warm", "Warm White", "Color 2", "  Spaced  ", "Ünïcode 3"]) {
      const palette = [{ name, color: "#ff8800" }];
      const slug = paletteRefSlug(paletteRef(name));
      expect(slug).toBeTruthy();
      expect(paletteStyle(palette)).toContain(`--fp-color-${slug}:`);
      expect(resolvePaletteColor(paletteRef(name), palette)).toBe("#ff8800");
    }
  });
});

describe("rewritePaletteRefs — renaming and deleting keep the plan honest", () => {
  // Shaped like a real config: colours live at every depth, inside arrays,
  // inside per-floor arrays, and inside the state-rule arrays within those.
  const config = () => ({
    type: "custom:easy-floorplan-card",
    palette: [{ name: "Warm", color: "#ff8800" }],
    background: "var(--fp-color-warm)",
    floors: [
      {
        id: "ground",
        color: "var(--fp-color-warm)",
        texts: [{ id: "t1", text: "Hi", color: "var(--fp-color-warm)" }],
        items: [
          {
            id: "i1",
            activeColor: "var(--fp-color-cold)",
            stateColor: [
              { above: 20, color: "var(--fp-color-warm)" },
              { above: 0, color: "#00ff00" },
            ],
          },
        ],
      },
    ],
  });

  it("finds every reference, however deeply it is buried", () => {
    const next = rewritePaletteRefs(config(), "warm", "var(--fp-color-toasty)");
    expect(next.background).toBe("var(--fp-color-toasty)");
    expect(next.floors[0].color).toBe("var(--fp-color-toasty)");
    expect(next.floors[0].texts[0].color).toBe("var(--fp-color-toasty)");
    expect(next.floors[0].items[0].stateColor[0].color).toBe("var(--fp-color-toasty)");
  });

  it("leaves every other colour exactly as it was", () => {
    const next = rewritePaletteRefs(config(), "warm", "#ff8800");
    expect(next.floors[0].items[0].activeColor).toBe("var(--fp-color-cold)");
    expect(next.floors[0].items[0].stateColor[1].color).toBe("#00ff00");
    expect(next.floors[0].texts[0].text).toBe("Hi");
    expect(next.type).toBe("custom:easy-floorplan-card");
  });

  it("freezes references at a literal, which is what deleting an entry does", () => {
    // A dangling var() is not a colour: the declaration is dropped and an SVG
    // fill inherits, which is black. Deleting a name must not repaint the plan.
    const next = rewritePaletteRefs(config(), "warm", "#ff8800");
    expect(next.background).toBe("#ff8800");
    expect(next.floors[0].texts[0].color).toBe("#ff8800");
  });

  it("does not mutate the config it was given", () => {
    const before = config();
    rewritePaletteRefs(before, "warm", "#000000");
    expect(before.background).toBe("var(--fp-color-warm)");
  });

  it("does nothing without a slug to look for", () => {
    const before = config();
    expect(rewritePaletteRefs(before, "", "#000000")).toBe(before);
  });

  it("matches a reference whatever whitespace surrounds it", () => {
    expect(rewritePaletteRefs({ c: "  var(--fp-color-warm)  " }, "warm", "red").c).toBe("red");
  });

  it("does not touch a value that merely contains the reference", () => {
    // A mix built on a palette colour is its own colour, and rewriting it to a
    // flat literal would throw the mix away.
    const mixed = { c: "color-mix(in srgb, var(--fp-color-warm), blue)" };
    expect(rewritePaletteRefs(mixed, "warm", "red").c).toBe(mixed.c);
  });

  it("survives nulls and non-objects in the tree", () => {
    const tree = { a: null, b: undefined, c: 3, d: true, e: ["var(--fp-color-warm)", null] };
    expect(rewritePaletteRefs(tree, "warm", "red")).toEqual({
      a: null,
      b: undefined,
      c: 3,
      d: true,
      e: ["red", null],
    });
  });
});
