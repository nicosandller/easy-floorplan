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
