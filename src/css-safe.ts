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

// #rgb #rgba #rrggbb #rrggbbaa
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// named keywords and CSS-wide keywords: red, transparent, currentColor, inherit…
const KEYWORD = /^[a-z]+$/i;
// The colour functions CSS actually has — rgb/hsl plus the modern spaces
// (oklch is now the default output of many pickers). Only numbers, the angle/
// space keywords those functions take, separators, %, / and whitespace inside;
// no nested `(`, so url()/expression()/calc() can never form.
const FUNC =
  /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([a-z0-9.,%/\s-]+\)$/i;
// var(--token) with an optional simple fallback restricted to the characters a
// colour value uses — no `;` `{` `}` `(` `)` and no injection-adjacent punctuation,
// e.g. var(--primary, #03a9f4). Tighter than "anything but delimiters".
const VAR = /^var\(\s*--[a-z0-9-]+\s*(?:,\s*[a-z0-9\s.,%/#-]*)?\)$/i;

/**
 * The colour if it is safe to place in a `style` attribute, else `undefined`.
 * An allowlist, deliberately: a denylist ("reject `;` `url(` …") invites the one
 * vector you forgot. A value is dropped unless it is recognisably one of the
 * colour forms CSS actually uses. Whitespace is trimmed; empty and non-strings
 * return `undefined`.
 */
export function cssColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v) return undefined;
  if (HEX.test(v) || KEYWORD.test(v) || FUNC.test(v) || VAR.test(v)) return v;
  return undefined;
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
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
