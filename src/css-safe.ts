/**
 * Sanitise user-supplied CSS values before they are interpolated into a `style`
 * attribute.
 *
 * A floorplan config is shareable and importable, so its colour and size strings
 * are effectively attacker-controlled. Lit does **not** escape `;` or `}` inside a
 * style-attribute expression, so a value like `red;position:fixed;inset:0;z-index:99999`
 * breaks out of its declaration and paints a full-viewport overlay over Home
 * Assistant, and `red;background-image:url(https://evil/x)` turns into a remote fetch
 * that beacons the viewer's IP. Both were reproduced by parsing the emitted DOM.
 *
 * Note this is specifically about values that land in a `style="…"` attribute. SVG
 * presentation attributes (`fill=`, `stroke=`) are not affected — there is no
 * declaration there to break out of — so those sinks are intentionally left alone.
 */

/**
 * Functions that are inert as a CSS *value*: colour, gradient, `var()`/`env()`
 * and maths. This is an **allowlist** and we fail closed — anything not listed
 * (`url()`, `image-set()`, `cross-fade()`, `element()`, `paint()`, `attr()`,
 * legacy `expression()`, …) is rejected, so a resource fetch or worklet can never
 * appear, even nested. Home Assistant themes lean on nesting heavily — colours are
 * stored as bare `r, g, b` triplets and read back as `rgb(var(--rgb-primary-color))`,
 * and fallbacks chain as `var(--a, var(--b, #fff))` — so nesting must be allowed.
 */
const SAFE_FUNCS = new Set([
  // colour
  "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch",
  "color", "color-mix", "light-dark",
  // custom properties / environment
  "var", "env",
  // maths (calc & friends can appear inside colour components)
  "calc", "clamp", "min", "max", "abs", "round", "mod", "rem",
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "pow", "sqrt", "hypot", "log", "exp",
  // gradients (valid for the stage `background`)
  "linear-gradient", "radial-gradient", "conic-gradient",
  "repeating-linear-gradient", "repeating-radial-gradient", "repeating-conic-gradient",
]);

// The characters a colour / gradient value is built from. Deliberately excludes
// `;` `{` `}` (declaration/rule breakout), `"` `'` `:` `@` `\` `!` and every
// control char — so an accepted value can neither end its declaration, start a
// new one, carry a quoted or `data:` URL, nor use an escape or `!important`.
const SAFE_CHARS = /^[a-z0-9#%.,/_() +*-]+$/i;
// A function call is an identifier (optionally hyphenated) immediately before `(`.
const FUNC_CALL = /([a-z][a-z0-9-]*)\s*\(/gi;

/**
 * The colour if it is safe to place in a `style` attribute, else `undefined`.
 *
 * Fail-closed and structural rather than a fixed set of regexes, so it accepts the
 * full range of real values (hex, named/CSS-wide keywords, `rgb/hsl/oklch/…`,
 * `color-mix`, gradients, and arbitrarily nested `var()` / `rgb(var(--…))`) while
 * still guaranteeing no breakout: allowed characters only, balanced parens, and
 * every function on the {@link SAFE_FUNCS} allowlist. Whitespace is trimmed; empty
 * and non-strings return `undefined`.
 */
export function cssColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v) return undefined;
  if (!SAFE_CHARS.test(v)) return undefined;
  if (v.includes("/*") || v.includes("*/")) return undefined; // no comments
  if (!/^[a-z#]/i.test(v)) return undefined; // must read as a colour/keyword/function
  // Balanced parens, never dropping below zero.
  let depth = 0;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === "(") depth++;
    else if (c === ")" && --depth < 0) return undefined;
  }
  if (depth !== 0) return undefined;
  // Every function call must be inert (fail closed on anything unknown).
  const funcs = new RegExp(FUNC_CALL.source, "gi");
  for (let m: RegExpExecArray | null; (m = funcs.exec(v)); ) {
    if (!SAFE_FUNCS.has(m[1].toLowerCase())) return undefined;
  }
  return v;
}

/**
 * `cssColor(value) ?? fallback` — the value if safe, otherwise the (trusted,
 * caller-supplied) fallback. Use at every point a config colour reaches a style.
 */
export function cssColorOr(value: unknown, fallback: string): string {
  return cssColor(value) ?? fallback;
}

/**
 * A finite number for a numeric CSS field (a size, an angle) that will be
 * interpolated into a `style` attribute, else `fallback`. This is what stops a
 * size like `1;position:fixed;inset:0` from breaking out of `font-size:${…}px`.
 * `null`/`undefined` fall back like the previous `?? default` did; strings that
 * parse to a finite number (`"16"`) are accepted, anything else is rejected.
 */
export function cssNumber(value: unknown, fallback: number): number {
  if (value == null) return fallback;
  // Number("") and Number("   ") are 0 (finite), which would silently become
  // 0px / a 0 ratio; treat a blank string as unset.
  if (typeof value === "string" && value.trim() === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * A config-supplied identifier safe to place in a `class` or `data-*`
 * attribute (issue #105). Lit escapes attribute values, so this is not about
 * breakout — it is about the emitted DOM being *predictable*, which is the
 * whole point of a styling hook: whitespace in a value would silently add
 * extra classes, and a stray `"` or `\` makes a selector that no longer
 * matches what the author wrote.
 *
 * Keeps letters, digits, `-` and `_`; anything else is dropped. An empty or
 * non-string value returns `undefined` so callers can emit Lit's `nothing`
 * and leave the attribute off entirely, rather than `data-id="undefined"`.
 */
export function cssIdent(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  return v === "" ? undefined : v;
}

/**
 * The CSS colour names that turn up in real floorplan configs — the README's
 * own examples use `red`, `green`, `white` and `gray`. Not the full 148-name
 * list: this exists so {@link contrastText} can judge a hand-typed colour, and
 * an unlisted name simply falls back to the theme's foreground rather than
 * being guessed at.
 */
const NAMED_COLORS: Record<string, [number, number, number]> = {
  white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0], green: [0, 128, 0],
  lime: [0, 255, 0], blue: [0, 0, 255], navy: [0, 0, 128], yellow: [255, 255, 0],
  orange: [255, 165, 0], gold: [255, 215, 0], purple: [128, 0, 128], pink: [255, 192, 203],
  brown: [165, 42, 42], maroon: [128, 0, 0], olive: [128, 128, 0], teal: [0, 128, 128],
  cyan: [0, 255, 255], aqua: [0, 255, 255], magenta: [255, 0, 255], fuchsia: [255, 0, 255],
  silver: [192, 192, 192], gray: [128, 128, 128], grey: [128, 128, 128],
  lightgray: [211, 211, 211], lightgrey: [211, 211, 211],
  darkgray: [169, 169, 169], darkgrey: [169, 169, 169],
  transparent: [255, 255, 255],
};

/** RGB channels of a colour we can actually read, else undefined. */
function parseRgb(value: string): [number, number, number] | undefined {
  const v = value.trim().toLowerCase();
  const named = NAMED_COLORS[v];
  if (named) return named;

  const hex = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16)) as [number, number, number];
    }
    if (h.length === 6 || h.length === 8) {
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
    }
    return undefined;
  }

  // rgb()/rgba(), both the legacy comma form and the modern space form.
  const fn = /^rgba?\(([^)]*)\)$/.exec(v);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter((s) => s !== "");
    if (parts.length < 3) return undefined;
    const nums = parts.slice(0, 3).map((p) => {
      // A percentage channel is still a channel.
      if (p.endsWith("%")) {
        const pct = Number(p.slice(0, -1));
        return Number.isFinite(pct) ? (pct / 100) * 255 : NaN;
      }
      return Number(p);
    });
    if (nums.some((n) => !Number.isFinite(n))) return undefined;
    return nums.map((n) => Math.max(0, Math.min(255, n))) as [number, number, number];
  }
  return undefined;
}

/** WCAG relative luminance (sRGB), 0 = black, 1 = white. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * The dark ink and the light ink a badge chooses between — the same pair the
 * theme already uses, so an unresolvable colour falling back to
 * `--text-primary-color` looks no different.
 */
const INK_DARK = "#212121";
const INK_LIGHT = "#ffffff";
const LUM_DARK = relativeLuminance([0x21, 0x21, 0x21]);
const LUM_LIGHT = relativeLuminance([0xff, 0xff, 0xff]);

/**
 * Black or white text for a known background colour (issue #106) — or
 * `undefined` when the background is not something we can read.
 *
 * A device badge paints its background from config (a state rule, an active
 * colour, a bulb's own colour) while its foreground was pinned to the theme's
 * `--text-primary-color`. On a dark theme that ink is near-white, so a pale
 * badge swallowed its own icon: *"if i set it on white background, when it's
 * open, the icon is white on white"*. The two are independent, so the
 * foreground has to follow the background rather than the theme.
 *
 * The `undefined` return is the important half. `var(--accent)`, `color-mix()`
 * and gradients are all legal here and none can be resolved without the live
 * computed style, so those badges keep the theme ink exactly as they do today.
 * Picking an ink for a colour we cannot see would be worse than not trying.
 *
 * Decided by comparing the two actual WCAG contrast ratios rather than by a
 * luminance threshold. A threshold has to be derived from the inks — the usual
 * 0.179 crossover assumes pure black, and ours is `#212121`, which moves it to
 * ~0.212 — so the constant and the inks could drift apart silently. Comparing
 * the ratios cannot.
 */
export function contrastText(color: unknown): string | undefined {
  if (typeof color !== "string") return undefined;
  const rgb = parseRgb(color);
  if (!rgb) return undefined;
  const bg = relativeLuminance(rgb);
  const ratio = (ink: number) =>
    (Math.max(bg, ink) + 0.05) / (Math.min(bg, ink) + 0.05);
  return ratio(LUM_DARK) >= ratio(LUM_LIGHT) ? INK_DARK : INK_LIGHT;
}

/**
 * An icon name for `<ha-icon icon="…">` (issue #106), or `undefined` when the
 * value is not one.
 *
 * Not a style sink — Lit escapes attribute values — so unlike {@link cssColor}
 * this is not about breakout. It is about the fallback chain staying honest.
 * `ha-icon` resolves `set:name` against a registered icon set, and anything
 * else yields a console error and an empty circle.
 *
 * Deliberately **validates rather than strips**, which is the difference
 * between this and {@link cssIdent}. Stripping `"><script>` leaves `script` —
 * harmless, but still a non-icon that has now displaced the icon the caller
 * would otherwise have fallen back to. Callers use the `undefined` to move on
 * to the next candidate, so a value that cannot render must not survive as
 * *something*.
 */
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/i;

export function cssIcon(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return ICON_NAME.test(v) ? v : undefined;
}

/**
 * An entity id for a `data-entity` attribute (issue #105). Separate from
 * {@link cssIdent} because an entity id is `domain.object_id` and the dot is
 * load-bearing — `[data-entity="light.kitchen"]` is the selector people will
 * write, and stripping the dot would silently make it never match. A dot is
 * fine in an attribute *value*; it is only a problem in a class name, which is
 * why the two are not the same function.
 */
export function cssEntityId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().replace(/[^a-zA-Z0-9_.-]/g, "");
  return v === "" ? undefined : v;
}
