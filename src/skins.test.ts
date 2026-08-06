import { describe, it, expect } from "vitest";
import {
  DEFAULT_SKIN,
  MAX_SKIN_WALL_WIDTH,
  SKINS,
  SKIN_TOKENS,
  type SkinToken,
  findSkin,
  skinStyle,
  SKIN_ACCENT,
  SKIN_PAPER,
  SKIN_TEXT,
  SKIN_WALL,
} from "./skins";

describe("the skin registry", () => {
  it("ships the default first, and it declares nothing", () => {
    expect(SKINS[0].id).toBe(DEFAULT_SKIN);
    expect(SKINS[0].vars).toEqual({});
  });

  it("has unique, lowercase ids — they are stored in saved plans", () => {
    const ids = SKINS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("gives every skin a label and a one-line description for the dropdown", () => {
    for (const s of SKINS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  /**
   * A palette that forgets a token half-inherits the Home Assistant theme, and
   * the result is a plan that looks broken rather than skinned — dark walls on
   * Tron's black paper, say. Completeness is the property that prevents it.
   */
  it("gives every non-default skin the complete token set", () => {
    for (const s of SKINS.slice(1)) {
      expect(Object.keys(s.vars).sort()).toEqual([...SKIN_TOKENS].sort());
    }
  });

  it("keeps every skinned wall inside the doorway cut", () => {
    for (const s of SKINS.slice(1)) {
      const width = Number(s.vars["--fp-skin-wall-width"]);
      expect(Number.isFinite(width)).toBe(true);
      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThanOrEqual(MAX_SKIN_WALL_WIDTH);
    }
  });
});

/**
 * The bug this guards against is quiet: a skin sets its accent and forgets the
 * ink that sits on it, everything still renders, and the label is simply
 * unreadable — Pastel's near-white on a pale blue measured 1.7:1. Completeness
 * cannot catch it, because the token *is* set; only the pairing is wrong.
 *
 * Thresholds are WCAG AA: 3.0 for the ink pairs, which are UI labels on a
 * coloured chip, and 4.5 for body text on the paper. Walls are deliberately
 * exempt — Pastel's whole point is a soft 3.5:1 line, and that is a drawing,
 * not something anyone reads.
 */
describe("every built-in skin is legible", () => {
  const luminance = (hex: string): number => {
    const channels = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  /** WCAG 2.x contrast ratio, 1 (identical) to 21 (black on white). */
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("computes a ratio we can trust", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  for (const skin of SKINS.slice(1)) {
    it(`${skin.id} reads its ink against what it sits on`, () => {
      const v = (token: SkinToken): string => {
        const value = skin.vars[token];
        // These four are the pairs the ratio is computed from, so a palette
        // that states one as a gradient or a var() chain needs this test
        // rethought rather than silently skipped.
        expect(value).toMatch(/^#[0-9a-f]{6}$/);
        return value as string;
      };
      expect(contrast(v("--fp-skin-accent-ink"), v("--fp-skin-accent"))).toBeGreaterThanOrEqual(3);
      expect(contrast(v("--fp-skin-active-ink"), v("--fp-skin-active"))).toBeGreaterThanOrEqual(3);
      expect(contrast(v("--fp-skin-text"), v("--fp-skin-bg"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v("--fp-skin-text"), v("--fp-skin-badge-bg"))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("skinStyle", () => {
  it("emits nothing for the default — an unskinned plan renders as it always did", () => {
    expect(skinStyle(DEFAULT_SKIN)).toBe("");
    expect(skinStyle(undefined)).toBe("");
  });

  it("emits nothing for an id we don't ship, rather than a half-applied look", () => {
    expect(skinStyle("nintendo")).toBe("");
    expect(skinStyle("")).toBe("");
    expect(skinStyle(42)).toBe("");
    expect(skinStyle(null)).toBe("");
    expect(skinStyle({ id: "tron" })).toBe("");
  });

  it("emits every declaration of the skin it names", () => {
    const style = skinStyle("tron");
    expect(style).toContain("--fp-skin-bg:#05080c;");
    expect(style).toContain("--fp-skin-wall:#7de3ff;");
    for (const token of SKIN_TOKENS) expect(style).toContain(`${token}:`);
  });

  it("finds a skin by id, and only by an exact one", () => {
    expect(findSkin("pastel")?.label).toBe("Pastel");
    expect(findSkin("Pastel")).toBeUndefined();
    expect(findSkin(undefined)).toBeUndefined();
  });
});

/**
 * These values are library constants rather than config, so `cssColor` never
 * sees them — but they land in the same `style="…"` attribute a config colour
 * does, and Lit does not escape `;` or `}` there. Holding them to the same
 * no-breakout rule means a future palette cannot quietly become the one CSS
 * injection the sanitiser was written to prevent.
 */
describe("built-in skin values cannot break out of a style attribute", () => {
  const values = SKINS.flatMap((s) => Object.values(s.vars));

  it("has values to check (guards against an empty-registry pass)", () => {
    expect(values.length).toBeGreaterThan(0);
  });

  it("contains no declaration or rule terminator", () => {
    for (const v of values) {
      expect(v).not.toContain(";");
      expect(v).not.toContain("{");
      expect(v).not.toContain("}");
    }
  });

  it("contains no quote, escape, at-rule, comment or !important", () => {
    for (const v of values) {
      expect(v).not.toMatch(/["'@\\!]/);
      expect(v).not.toContain("/*");
      expect(v).not.toContain("*/");
    }
  });

  it("never fetches a remote resource", () => {
    for (const v of values) expect(v.toLowerCase()).not.toContain("url(");
  });
});

describe("the chains interpolated from TypeScript", () => {
  /**
   * Each is read at a call site that may sit outside the element carrying the
   * token defaults, so the original hard-coded value has to survive as the
   * innermost fallback — that is what keeps an unskinned plan unchanged.
   */
  it("keeps the pre-skin value as the last fallback", () => {
    expect(SKIN_PAPER).toContain("var(--card-background-color, #fff)");
    expect(SKIN_WALL).toContain("var(--primary-text-color)");
    expect(SKIN_TEXT).toContain("var(--primary-text-color)");
    expect(SKIN_ACCENT).toContain("var(--primary-color, #03a9f4)");
  });

  it("reads its token first", () => {
    expect(SKIN_PAPER.startsWith("var(--fp-skin-bg,")).toBe(true);
    expect(SKIN_WALL.startsWith("var(--fp-skin-wall,")).toBe(true);
    expect(SKIN_TEXT.startsWith("var(--fp-skin-text,")).toBe(true);
    expect(SKIN_ACCENT.startsWith("var(--fp-skin-accent,")).toBe(true);
  });
});
