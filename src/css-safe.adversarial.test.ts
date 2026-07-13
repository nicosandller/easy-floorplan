import { describe, it, expect } from "vitest";
import { cssColor } from "./css-safe";

describe("cssColor — adversarial: exotic breakout attempts all rejected", () => {
  const ATTACKS = [
    // newline / CR / tab tricks (the classic ^...$ before-\n regex hole)
    "red\n;position:fixed",
    "red\r\n}body{x:1",
    "red\t;color:blue",
    "rgb(0,0,0)\n;position:fixed",
    "var(--x)\n;evil",
    "red ;evil", // line separator
    "red;evil", // NEL
    "red;evil", // vertical tab
    "red\f;evil", // form feed
    // CSS comments
    "red/**/;position:fixed",
    "rgb(0,0,0)/*x*/",
    "/*x*/red",
    // CSS escapes / encoded
    "\\72 ed;evil",
    "\\0000red",
    "red\\3b evil",
    // url / fetch vectors in every wrapper
    "url(https://evil/x)",
    "URL(//evil)",
    "image-set(//evil)",
    "var(--x, url(//evil))",
    "rgb(0,0,0);background:url(//evil)",
    "expression(alert(1))",
    "EXPRESSION(1)",
    // breakout punctuation
    "red;",
    "red}",
    "red{x:1}",
    "red !important;x:1",
    "rgb(0,0,0) ;evil",
    "#fff;--x:url(//evil)",
    // nested / doubled parens (where url could hide)
    "rgb(rgb(0,0,0))",
    "hsl(calc(1) 0 0)",
    "var(--x, rgb(0,0,0); z:1)",
    // whitespace-obfuscated
    "red ; position : fixed",
    // quote / angle-bracket escape attempts
    'red"x',
    "red'x",
    "red>x",
    "red<x",
  ];
  for (const a of ATTACKS) {
    it(`rejects ${JSON.stringify(a)}`, () => {
      expect(cssColor(a)).toBeUndefined();
    });
  }

  // Surrounding whitespace (incl. newlines/tabs) is trimmed, and the RESULT is
  // still validated — so a whitespace-wrapped legit colour is accepted and its
  // output carries no control char. This is safe, not a bypass.
  it("trims surrounding whitespace/newlines to a clean value", () => {
    expect(cssColor("red\n")).toBe("red");
    expect(cssColor("\nred")).toBe("red");
    expect(cssColor("  #03a9f4\t")).toBe("#03a9f4");
    // but an INTERNAL newline followed by a payload is still rejected
    expect(cssColor("red\n;evil")).toBeUndefined();
  });
});

describe("cssColor — INVARIANT: nothing accepted can break out of a style declaration", () => {
  // Broad mix of legit + hostile strings; assert the invariant that any accepted
  // value contains no `;` `{` `}` and at most one `(`/`)` (so url()/expression()/
  // nested functions can never form inside an accepted value).
  const CHARS = "red#09aff(url);{}/*-,% .\n\tvax'\"!".split("");
  const seeds = [
    "red", "#03a9f4", "rgb(0,0,0)", "var(--x)", "var(--x, #fff)", "oklch(0.7 0.1 200)",
    "url(//e)", "red;evil", "red}q{", "expression(1)", "rgb(url(x))", "transparent",
  ];
  const cases: string[] = [...seeds];
  // deterministic pseudo-permutations (no Math.random — reproducible)
  for (let i = 0; i < 500; i++) {
    let s = "";
    let n = (i * 2654435761) >>> 0;
    const len = 3 + (i % 14);
    for (let j = 0; j < len; j++) {
      n = (n * 1103515245 + 12345) >>> 0;
      s += CHARS[n % CHARS.length];
    }
    cases.push(s);
  }
  it("no accepted value contains ; { } or a nested paren / url(", () => {
    let accepted = 0;
    for (const c of cases) {
      const out = cssColor(c);
      if (out === undefined) continue;
      accepted++;
      expect(out).not.toMatch(/[;{}]/);
      expect((out.match(/\(/g) ?? []).length).toBeLessThanOrEqual(1);
      expect((out.match(/\)/g) ?? []).length).toBeLessThanOrEqual(1);
      expect(out.toLowerCase()).not.toContain("url(");
      expect(out.toLowerCase()).not.toContain("expression(");
    }
    // sanity: the legit seeds really were accepted (so the invariant isn't vacuous)
    expect(accepted).toBeGreaterThanOrEqual(6);
  });
});
