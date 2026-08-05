import { describe, it, expect } from "vitest";
import { cssColor, cssIdent, cssEntityId, cssIcon, contrastText } from "./css-safe";
import { furnitureColor } from "./render";
import type { Furniture } from "./types";

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
    "var(--a, var(--b, url(//evil)))", // url hidden inside a nested var fallback
    "var(--a, var(--b, red);position:fixed))", // breakout inside a nested fallback
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
    // breakout hidden inside otherwise-safe nesting
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
  it("no accepted value can break out of a style declaration", () => {
    // Nested functions are allowed, so an accepted value may contain several
    // balanced parens — but never a declaration break (`;` `{` `}`) and never a
    // fetch/execute function, since those aren't on the SAFE_FUNCS allowlist.
    const FORBIDDEN = ["url(", "image(", "image-set(", "-webkit-image-set(",
      "cross-fade(", "element(", "paint(", "expression(", "attr("];
    let accepted = 0;
    for (const c of cases) {
      const out = cssColor(c);
      if (out === undefined) continue;
      accepted++;
      expect(out).not.toMatch(/[;{}]/);
      // balanced parens
      let d = 0;
      for (const ch of out) { if (ch === "(") d++; else if (ch === ")") d--; expect(d).toBeGreaterThanOrEqual(0); }
      expect(d).toBe(0);
      const lower = out.toLowerCase();
      for (const bad of FORBIDDEN) expect(lower).not.toContain(bad);
      // no quotes, colons, semicolons, escapes, or bangs survived
      expect(out).not.toMatch(/["':@\\!]/);
    }
    // sanity: the legit seeds really were accepted (so the invariant isn't vacuous)
    expect(accepted).toBeGreaterThanOrEqual(6);
  });
});

/*
 * The colors added for #68/#79/#82 reach a `stroke`/`fill` attribute or a CSS
 * custom property, so each new path needs its own gate — resolveStateColor
 * deliberately returns the config string unfiltered, and it is the caller's
 * job to run cssColor on it. These assert the callers actually do.
 */
describe("entity-driven colors are gated (issues #68, #79, #82)", () => {
  const HOSTILE = "red;position:fixed";

  it("furnitureColor filters a hostile stateColor rule", () => {
    const f = {
      id: "f",
      type: "plant",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      entity: "sensor.soil",
      stateColor: [{ color: HOSTILE }],
    } as Furniture;
    expect(furnitureColor(f, "1")).toBeUndefined();
  });

  it("furnitureColor filters a hostile activeColor", () => {
    const f = {
      id: "f",
      type: "plant",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      entity: "binary_sensor.x",
      activeColor: HOSTILE,
    } as Furniture;
    expect(furnitureColor(f, "on")).toBeUndefined();
  });

  it("a legitimate color still survives both paths", () => {
    const base = { id: "f", type: "plant", x: 0, y: 0, w: 10, h: 10, entity: "sensor.s" };
    expect(furnitureColor({ ...base, stateColor: [{ color: "#ff0000" }] } as Furniture, "1")).toBe(
      "#ff0000",
    );
    expect(
      furnitureColor(
        { ...base, entity: "binary_sensor.x", activeColor: "var(--primary-color)" } as Furniture,
        "on",
      ),
    ).toBe("var(--primary-color)");
  });

  // The item badge's activeColor (#79) lands in a --fp-active custom property;
  // the card runs it through the same gate before it reaches the style string.
  it("a hostile item activeColor does not survive cssColor", () => {
    expect(cssColor(HOSTILE)).toBeUndefined();
    expect(cssColor("#fdd835")).toBe("#fdd835");
  });
});

describe("cssIdent / cssEntityId — styling hooks (issue #105)", () => {
  it("keeps the identifiers the editor actually generates", () => {
    expect(cssIdent("area_a5r5nwl")).toBe("area_a5r5nwl");
    expect(cssIdent("furn_3j66s50")).toBe("furn_3j66s50");
    expect(cssIdent("roundTable")).toBe("roundTable");
  });

  it("drops whitespace, so a value cannot smuggle in a second class", () => {
    // "sofa fp-wall" as a type would otherwise style every wall on the plan.
    expect(cssIdent("sofa fp-wall")).toBe("sofafp-wall");
    expect(cssIdent("  padded  ")).toBe("padded");
  });

  it("drops quotes and backslashes, so a selector still matches what was written", () => {
    expect(cssIdent('a"b')).toBe("ab");
    expect(cssIdent("a\\b")).toBe("ab");
    expect(cssIdent("a<b>c")).toBe("abc");
  });

  it("returns undefined for nothing usable, so the attribute is omitted", () => {
    // The alternative is data-id="undefined", which is worse than no hook.
    expect(cssIdent(undefined)).toBeUndefined();
    expect(cssIdent("")).toBeUndefined();
    expect(cssIdent("   ")).toBeUndefined();
    expect(cssIdent("!!!")).toBeUndefined();
    expect(cssIdent(42)).toBeUndefined();
  });

  it("cssEntityId keeps the dot, which cssIdent deliberately does not", () => {
    // [data-entity="light.kitchen"] is the selector people will write.
    expect(cssEntityId("light.kitchen")).toBe("light.kitchen");
    expect(cssEntityId("binary_sensor.front_door_contact")).toBe("binary_sensor.front_door_contact");
    expect(cssIdent("light.kitchen")).toBe("lightkitchen");
  });

  it("cssEntityId still drops what would break the attribute selector", () => {
    expect(cssEntityId('light.k"]{}')).toBe("light.k");
    expect(cssEntityId("")).toBeUndefined();
  });
});

// @MrMcFlyy on #106: "if i set it on white background, when it's open, the
// icon is white on white". The badge background comes from config; the ink was
// pinned to the theme. They are independent, so the ink has to follow.
describe("contrastText — the glyph stays readable (issue #106)", () => {
  const DARK = "#212121";
  const LIGHT = "#ffffff";

  it("puts dark ink on a pale badge and light ink on a dark one", () => {
    expect(contrastText("#ffffff")).toBe(DARK);
    expect(contrastText("white")).toBe(DARK);
    expect(contrastText("#000000")).toBe(LIGHT);
    expect(contrastText("black")).toBe(LIGHT);
    // The exact report: a white cover rule no longer eats its own icon.
    expect(contrastText("#fff")).toBe(DARK);
  });

  it("judges by luminance, not brightness — yellow is pale, blue is dark", () => {
    expect(contrastText("yellow")).toBe(DARK);
    expect(contrastText("#fdd835")).toBe(DARK); // the theme's own active yellow
    expect(contrastText("blue")).toBe(LIGHT);
    expect(contrastText("navy")).toBe(LIGHT);
    // Pure red looks vivid but is dark by luminance — and dark ink genuinely
    // wins on it (5.25:1 against white's 4.0:1), which is why this is decided
    // by comparing ratios rather than by eye.
    expect(contrastText("red")).toBe(DARK);
    expect(contrastText("#4caf50")).toBe(DARK); // the README's blinds-open green
    expect(contrastText("#9e9e9e")).toBe(DARK); // the furniture gray
  });

  it("reads every colour form the card actually emits", () => {
    // lightBadgePaint and glowPaint both emit this exact shape.
    expect(contrastText("rgb(0, 0, 0)")).toBe(LIGHT);
    expect(contrastText("rgb(255, 255, 255)")).toBe(DARK);
    expect(contrastText("rgba(0, 0, 0, 0.5)")).toBe(LIGHT);
    expect(contrastText("rgb(255 255 255)")).toBe(DARK); // modern space form
    expect(contrastText("rgb(100%, 100%, 100%)")).toBe(DARK);
    expect(contrastText("#ffffffff")).toBe(DARK); // 8-digit hex
  });

  it("gives up on anything it cannot actually resolve, keeping today's behaviour", () => {
    // This is the important half: picking an ink for a colour we cannot see
    // would be worse than leaving the theme's. All of these are legal config.
    for (const opaque of [
      "var(--primary-color)",
      "var(--a, var(--b, #fff))",
      "rgb(var(--rgb-primary-color))",
      "color-mix(in srgb, red 50%, blue)",
      "linear-gradient(#fff, #000)",
      "rebeccapurple", // a real colour, just not in the table
      "#12345",
      "not-a-color",
      "",
      "   ",
    ]) {
      expect(contrastText(opaque)).toBeUndefined();
    }
    expect(contrastText(undefined)).toBeUndefined();
    expect(contrastText(42)).toBeUndefined();
  });

  it("actually improves contrast rather than just changing it", () => {
    // Relative luminance and the WCAG ratio, computed independently of the
    // implementation, over the full grey ramp: the chosen ink must never be
    // the worse of the two options.
    const lum = (hex: string) => {
      const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const [r, g, b] = ch.map(lin);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    for (let v = 0; v <= 255; v++) {
      const bg = `#${v.toString(16).padStart(2, "0").repeat(3)}`;
      const ink = contrastText(bg)!;
      expect(ink).toBeDefined();
      const other = ink === DARK ? LIGHT : DARK;
      expect({ bg, ink, chosen: +ratio(bg, ink).toFixed(3) }).toMatchObject({ bg, ink });
      expect(ratio(bg, ink)).toBeGreaterThanOrEqual(ratio(bg, other));
    }
  });
});

describe("cssIcon — icon names (issue #106)", () => {
  it("accepts the icon names people actually type", () => {
    expect(cssIcon("mdi:blinds-open")).toBe("mdi:blinds-open");
    expect(cssIcon("mdi:thermostat")).toBe("mdi:thermostat");
    expect(cssIcon("mdi:smoke-detector-variant-alert")).toBe("mdi:smoke-detector-variant-alert");
    expect(cssIcon("  mdi:fire  ")).toBe("mdi:fire");
    // Custom icon sets are a real HA feature, not just mdi.
    expect(cssIcon("phu:cable-cat5")).toBe("phu:cable-cat5");
    expect(cssIcon("mdi:battery-90")).toBe("mdi:battery-90");
  });

  it("validates rather than strips: a non-icon must not survive as something", () => {
    // The trap this guards: stripping '"><script>' leaves "script", which is
    // harmless in the DOM but has silently displaced the caller's fallback
    // icon. Callers rely on undefined to move to the next candidate.
    for (const junk of [
      '"><script>',
      "mdi:blinds; color:red",
      "mdi:a b",
      "mdi:",
      ":blinds",
      "blinds",
      "mdi::blinds",
      "mdi:blinds-",
      "-mdi:blinds",
      "url(https://evil/x)",
      "",
      "   ",
    ]) {
      expect(cssIcon(junk)).toBeUndefined();
    }
  });

  it("returns undefined for non-strings", () => {
    expect(cssIcon(undefined)).toBeUndefined();
    expect(cssIcon(null)).toBeUndefined();
    expect(cssIcon(42)).toBeUndefined();
    expect(cssIcon({ icon: "mdi:fire" })).toBeUndefined();
  });
});
