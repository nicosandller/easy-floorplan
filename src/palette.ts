/**
 * Named colours for a plan (issue #265).
 *
 * *"I want all my temperature sensors to use the same conditional colours but I
 * hate copying colour hex codes across so many entities."* A plan can name a
 * handful of colours once, under Project, and every colour field then offers
 * them in a dropdown. Change the name's colour and every element using it
 * follows.
 *
 * ## A reference is a `var()`, and that is the whole design
 *
 * Picking "Warm" from a dropdown stores the literal string
 * `var(--fp-color-warm)` in the colour field. The palette is emitted as those
 * custom properties on the card, and CSS resolves the reference at every sink
 * by itself.
 *
 * The alternative — a sentinel like `palette:warm` resolved in TypeScript —
 * would have to be understood at *every* place a config colour is read, and
 * there are around twenty of them across `render.ts`, the card and the editor,
 * in inline styles and in SVG presentation attributes alike. Each one is a
 * place the resolution could be forgotten, and forgetting it paints the literal
 * word `palette:warm`, which is not a colour, so the element would silently
 * draw as nothing.
 *
 * Going through `var()` instead means:
 *
 * - **no sink changes at all.** `var()` is already on {@link cssColor}'s
 *   allowlist (Home Assistant's own themes are built on it), and it is equally
 *   valid in an inline style and in a `fill=` attribute.
 * - **hand-written configs get the feature too**, without learning a syntax
 *   this card invented — `color: var(--fp-color-warm)` is just CSS.
 * - **live updates are free.** Recolouring a palette entry changes one custom
 *   property and the whole plan follows, with no re-resolution anywhere.
 *
 * It costs two things, and both are handled rather than accepted:
 *
 * - JavaScript that needs to *read* the colour cannot resolve a `var()`. That
 *   is `contrastText` (which picks a badge's ink) and the editor's `<input
 *   type="color">` swatch. Both go through {@link resolvePaletteColor} first.
 * - Chromium does not repaint an SVG element whose colour comes from a `var()`
 *   in a presentation attribute when the custom property changes — the same
 *   trap skins hit in issue #122. Both canvases key their SVG subtree on
 *   {@link paletteKey} for exactly that reason.
 */

import { cssColor } from "./css-safe";
import type { PaletteColor } from "./types";

/**
 * Prefix for the custom property a palette entry becomes. Namespaced like
 * `--fp-skin-*` so it cannot collide with a Home Assistant theme variable, and
 * short enough to type by hand in YAML.
 *
 * Changing this breaks every saved plan that references a palette colour, since
 * the reference is stored as the full `var(--fp-color-…)` string.
 */
export const PALETTE_VAR_PREFIX = "--fp-color-";

/** How many colours a palette may hold. */
export const MAX_PALETTE = 24;

/**
 * The custom-property suffix a display name maps to: lowercased, with every run
 * of anything that is not a letter or digit collapsed to a single `-`.
 *
 * "Warm white" and "warm-white" therefore mean the same colour, which is the
 * behaviour you want when someone renames an entry casually — but it also means
 * two entries can collide, so {@link paletteEntries} drops the later of any two
 * that produce the same slug. Returns `""` for a name with nothing usable in
 * it, which that same function treats as unusable.
 */
export function paletteSlug(name: unknown): string {
  if (typeof name !== "string") return "";
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The custom property a name declares, e.g. `--fp-color-warm`. */
export function paletteVar(name: unknown): string {
  return PALETTE_VAR_PREFIX + paletteSlug(name);
}

/** What a colour field stores to reference a name, e.g. `var(--fp-color-warm)`. */
export function paletteRef(name: unknown): string {
  return `var(${paletteVar(name)})`;
}

/**
 * The palette as the rest of the card should see it: entries with a usable name
 * *and* a colour that passes {@link cssColor}, deduped by slug (first wins), and
 * capped at {@link MAX_PALETTE}.
 *
 * Fails entry-by-entry rather than all-or-nothing. A hand-written config with
 * one bad colour in it should lose that colour, not its palette.
 */
export function paletteEntries(palette: unknown): PaletteColor[] {
  if (!Array.isArray(palette)) return [];
  const seen = new Set<string>();
  const out: PaletteColor[] = [];
  for (const entry of palette) {
    if (!entry || typeof entry !== "object") continue;
    const { name, color } = entry as PaletteColor;
    const slug = paletteSlug(name);
    const safe = cssColor(color);
    if (!slug || !safe || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ name: (name as string).trim(), color: safe });
    if (out.length >= MAX_PALETTE) break;
  }
  return out;
}

/**
 * The palette as declarations for a `style` attribute, e.g.
 * `--fp-color-warm:#ff8800;`. Empty string for an empty palette, so an
 * unpalettised plan emits no attribute at all.
 *
 * Safe to interpolate: names reach CSS only as {@link paletteSlug} output
 * (letters, digits and `-`), and colours only as {@link cssColor} output, so
 * neither half can close the declaration or open a new one.
 */
export function paletteStyle(palette: unknown): string {
  return paletteEntries(palette)
    .map((p) => `${paletteVar(p.name)}:${p.color};`)
    .join("");
}

/**
 * A string that changes whenever the palette does — the key both canvases hand
 * `keyed()` so their SVG repaints when a colour is edited. Combined with the
 * skin, which needs keying for the identical reason (issue #122), so the two
 * share one key rather than nesting two.
 */
export function paletteKey(palette: unknown): string {
  return paletteEntries(palette)
    .map((p) => `${paletteSlug(p.name)}=${p.color}`)
    .join(",");
}

/** `var(--fp-color-slug)` or `var(--fp-color-slug, …)`, captured to the slug. */
const PALETTE_REF = /^var\(\s*--fp-color-([a-z0-9-]+)\s*(?:,[^)]*)?\)$/i;

/**
 * The slug a value references, or `undefined` if it is an ordinary colour.
 * Used by the editor to show which palette entry a field is on.
 */
export function paletteRefSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return PALETTE_REF.exec(value.trim())?.[1].toLowerCase();
}

/**
 * A palette reference resolved to the literal colour it names, or the value
 * unchanged when it is not a reference (or names an entry that is gone).
 *
 * Only for JavaScript that has to *read* a colour — `contrastText` choosing a
 * badge's ink, the editor's colour swatch. Never use it to paint: rendering
 * must keep the `var()` so a palette edit still propagates through CSS.
 */
export function resolvePaletteColor(value: unknown, palette: unknown): unknown {
  const slug = paletteRefSlug(value);
  if (!slug) return value;
  const hit = paletteEntries(palette).find((p) => paletteSlug(p.name) === slug);
  return hit ? hit.color : value;
}

/**
 * A deep copy of `value` with every reference to one palette slug replaced.
 *
 * The editor's answer to the two edits that could strand a reference: renaming
 * an entry rewrites them to the new name, and deleting one rewrites them to the
 * colour it held. A dangling `var()` is not a colour at all — the declaration is
 * dropped and the element falls back to `inherit`, which for an SVG `fill` is
 * black — so removing a name would otherwise repaint half a plan.
 *
 * Deliberately a blind walk rather than a list of the fields that hold a
 * colour. There are around twenty of those spread across floors, walls,
 * openings, devices, texts, furniture, areas, trackers and the state-rule
 * arrays inside several of them, and a list would be one more place to forget
 * the field the next feature adds — leaving exactly the dangling reference this
 * exists to prevent. It matches whole strings only, against a value nothing but
 * this feature writes, so there is nothing else in a config it can hit.
 */
export function rewritePaletteRefs<T>(value: T, fromSlug: string, to: string): T {
  if (!fromSlug) return value;
  const ref = `var(${PALETTE_VAR_PREFIX}${fromSlug})`;
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return node.trim() === ref ? to : node;
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };
  return walk(value) as T;
}
