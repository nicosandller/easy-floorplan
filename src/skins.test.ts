import { describe, it, expect } from "vitest";
import {
  DEFAULT_SKIN,
  MAX_SKIN_WALL_WIDTH,
  SKINS,
  SKIN_TOKENS,
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
