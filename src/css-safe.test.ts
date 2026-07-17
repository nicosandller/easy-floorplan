import { describe, it, expect } from "vitest";
import { cssColor, cssColorOr, cssNumber } from "./css-safe";

describe("cssColor — accepts the colours real users actually type", () => {
  // Every value a Home Assistant floorplan user would plausibly put in a config.
  const LEGIT = [
    // HA theme variables — by far the most common in HA cards
    "var(--primary-color)",
    "var(--primary-color, #03a9f4)",
    "var(--error-color)",
    "var(--success-color)",
    "var(--state-active-color)",
    "var(--disabled-text-color)",
    "var(--card-background-color, #fff)",
    "var(--primary-text-color)",
    "var(  --primary-color , red )", // sloppy whitespace
    // nested var() fallback chains — valid CSS, common in HA themes (Codex #65 P2)
    "var(--ha-card-background, var(--card-background-color, #fff))",
    "var(--x, var(--y, var(--z, red)))",
    "var(--accent, rgb(3, 169, 244))", // function fallback
    // THE core HA idiom: colours stored as bare "r, g, b" triplets, read back
    // wrapped in rgb()/rgba() (HA default themes since 2022.12).
    "rgb(var(--rgb-primary-color))",
    "rgba(var(--rgb-primary-color), 0.5)",
    "rgb(var(--rgb-card-background-color))",
    "rgba(var(--rgb-primary-color), 0.35)",
    "hsl(var(--h), var(--s), var(--l))",
    // modern mixing + gradients (valid for a background)
    "color-mix(in srgb, var(--primary-color), transparent 40%)",
    "linear-gradient(to right, var(--primary-color), transparent)",
    "hsl(calc(200 + 10) 90% 48%)", // maths inside a colour component
    // hex, all valid lengths + case
    "#fff",
    "#FFF",
    "#03a9f4",
    "#03A9F4",
    "#ff000080", // 8-digit (alpha)
    "#f00a", // 4-digit
    // named + CSS-wide keywords
    "red",
    "blue",
    "white",
    "transparent",
    "currentColor",
    "rebeccapurple",
    "cornflowerblue",
    "inherit",
    "initial",
    "unset",
    // rgb / rgba — legacy comma and modern space syntaxes
    "rgb(3,169,244)",
    "rgb(3, 169, 244)",
    "rgba(3,169,244,0.5)",
    "rgba(3, 169, 244, .5)",
    "rgb(3 169 244)",
    "rgb(3 169 244 / 50%)",
    "rgb(100%, 0%, 0%)",
    // hsl / hsla
    "hsl(200, 90%, 48%)",
    "hsla(200, 90%, 48%, 0.5)",
    "hsl(200deg 90% 48%)",
    // modern colour spaces (picker output)
    "oklch(70% 0.1 200)",
    "oklab(0.7 -0.1 0.1)",
    "lab(52% 40 60)",
    "lch(52% 60 40)",
    "hwb(200 10% 20%)",
    "color(display-p3 1 0 0)",
  ];
  for (const v of LEGIT) {
    it(`accepts ${v}`, () => {
      expect(cssColor(v)).toBe(v.trim());
    });
  }
});

describe("cssColor — accepts HA theme colours across every version/era", () => {
  // A config outlives any one HA release, so the allowlist must accept the colour
  // forms from all eras, not just current. Each must round-trip unchanged.
  const HA_ERAS = [
    // docs examples / named (all versions)
    "pink", "orange",
    // traditional hex + rgb/hsl literals (pre-2022.12 default themes)
    "#ffffff", "#03a9f480", "rgb(255, 255, 255)", "rgba(0,0,0,0.5)", "hsl(200,90%,48%)",
    // traditional var() references (all versions)
    "var(--primary-color)", "var(--card-background-color)", "var(--state-active-color)",
    // old Polymer/paper era + MDC era variables
    "var(--paper-item-icon-color)", "var(--mdc-theme-primary)",
    // 2022.12+ RGB-triplet idiom, incl. nested var in the alpha slot
    "rgb(var(--rgb-primary-color))", "rgba(var(--rgb-primary-color), 0.5)",
    "rgba(var(--rgb-accent-color), var(--opacity, 0.3))",
    // fallback chains + modern functions (2024+)
    "var(--ha-card-border-color, var(--divider-color))",
    "color-mix(in srgb, var(--primary-color), transparent 40%)", "light-dark(#fff, #000)",
  ];
  for (const v of HA_ERAS) {
    it(`accepts ${v}`, () => expect(cssColor(v)).toBe(v));
  }
});

describe("cssColor — rejects style-attribute breakouts", () => {
  const MALICIOUS = [
    "red;position:fixed;inset:0;z-index:99999",
    "red;background-image:url(https://evil.example/x)",
    "#fff;background:url(//evil/x)",
    "red}body{display:none",
    "url(https://evil/x)",
    "rgb(0,0,0);pointer-events:none",
    "expression(alert(1))",
    "var(--x); position:fixed",
    "var(--x, url(//evil))",
    "10px;position:fixed", // a size string sneaking into a colour slot
  ];
  for (const v of MALICIOUS) {
    it(`rejects ${JSON.stringify(v)}`, () => {
      expect(cssColor(v)).toBeUndefined();
    });
  }
  it("rejects empty / non-strings", () => {
    expect(cssColor("")).toBeUndefined();
    expect(cssColor("   ")).toBeUndefined();
    expect(cssColor(undefined)).toBeUndefined();
    expect(cssColor(null)).toBeUndefined();
    expect(cssColor(42)).toBeUndefined();
    expect(cssColor({})).toBeUndefined();
  });
});

describe("cssColorOr — falls back on unsafe or missing", () => {
  it("keeps a safe value", () => {
    expect(cssColorOr("#03a9f4", "red")).toBe("#03a9f4");
  });
  it("falls back on an injection", () => {
    expect(cssColorOr("red;position:fixed", "var(--primary-color)")).toBe("var(--primary-color)");
  });
  it("falls back on undefined", () => {
    expect(cssColorOr(undefined, "var(--primary-color)")).toBe("var(--primary-color)");
  });
});

describe("cssNumber — coerces size/angle fields, blocks breakouts", () => {
  it("passes finite numbers", () => {
    expect(cssNumber(16, 34)).toBe(16);
    expect(cssNumber(0, 34)).toBe(0);
    expect(cssNumber(-90, 0)).toBe(-90);
    expect(cssNumber(12.5, 0)).toBe(12.5);
  });
  it("coerces numeric strings (YAML often yields strings)", () => {
    expect(cssNumber("16", 34)).toBe(16);
    expect(cssNumber("12.5", 0)).toBe(12.5);
  });
  it("falls back on null/undefined like the old ?? default", () => {
    expect(cssNumber(undefined, 34)).toBe(34);
    expect(cssNumber(null, 34)).toBe(34);
  });
  it("rejects a breakout string in a size field", () => {
    expect(cssNumber("1;position:fixed;inset:0", 16)).toBe(16);
    expect(cssNumber("16px;color:red", 16)).toBe(16);
    expect(cssNumber(NaN, 16)).toBe(16);
    expect(cssNumber(Infinity, 16)).toBe(16);
  });
});

describe("cssNumber — style-attribute injection at the aspect-ratio sink", () => {
  const evil = "1 / 600; position: fixed; inset: 0; background: url(//evil)";
  it("coerces a declaration-breakout width to the fallback", () => {
    expect(cssNumber(evil, 1000)).toBe(1000);
    expect(String(cssNumber(evil, 1000))).not.toMatch(/[;:]/);
  });
  it("treats a blank string as unset, not 0", () => {
    expect(cssNumber("", 1000)).toBe(1000);
    expect(cssNumber("   ", 1000)).toBe(1000);
  });
});
