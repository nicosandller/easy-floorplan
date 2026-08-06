/**
 * Built-in skins (issue #122).
 *
 * A skin restyles a whole plan at once. Everything the card draws already reads
 * its colour from a Home Assistant theme variable — `--primary-text-color` for
 * the walls, `--card-background-color` for the paper and badges,
 * `--primary-color` for the accents — which is exactly why the card looks like
 * a Home Assistant card and nothing else. A skin is a thin layer of card-local
 * custom properties that sits *in front of* those chains.
 *
 * Two consequences worth stating, because the whole design rests on them:
 *
 * - **The default skin declares nothing.** `skinStyle` returns `""` for it, so
 *   an unskinned plan emits not one extra declaration and renders exactly as it
 *   did before this file existed. Every token's default (see {@link skinTokens})
 *   is the literal fallback chain that used to be hard-coded at the call site.
 * - **A skin never overrides what a user set.** The per-element variables
 *   (`--fp-active`, `--fp-state`, `--fp-ink`, `--fp-ripple-color`) and every
 *   config colour are resolved ahead of these tokens, so a room painted green
 *   stays green under Tron. A skin only supplies the fallbacks.
 *
 * Uploaded/community skins (the other half of #122) are additional entries in
 * {@link SKINS} and need no new plumbing.
 */

import { css } from "lit";

/**
 * Every token a skin may set. Exported so the tests can assert each skin is
 * complete — a palette that forgets `--fp-skin-text` is a plan you cannot read.
 */
export const SKIN_TOKENS = [
  "--fp-skin-bg",
  "--fp-skin-card-bg",
  "--fp-skin-wall",
  "--fp-skin-wall-width",
  "--fp-skin-wall-filter",
  "--fp-skin-accent",
  "--fp-skin-accent-ink",
  "--fp-skin-active",
  "--fp-skin-active-ink",
  "--fp-skin-text",
  "--fp-skin-badge-bg",
  "--fp-skin-badge-border",
  "--fp-skin-badge-border-width",
  "--fp-skin-badge-radius",
  "--fp-skin-badge-shadow",
  "--fp-skin-furniture",
  "--fp-skin-glow",
] as const;

export type SkinToken = (typeof SKIN_TOKENS)[number];

export interface Skin {
  /** Stored in the config as `skin:`. Lowercase, stable — renaming one breaks saved plans. */
  id: string;
  /** Shown in the editor's dropdown. */
  label: string;
  /** One line of "what is this for", shown as the field's helper text. */
  description: string;
  /** Token overrides. Empty for the default skin, which is the absence of a skin. */
  vars: Partial<Record<SkinToken, string>>;
}

export const DEFAULT_SKIN = "default";

/**
 * The widest a skinned wall may be drawn.
 *
 * A doorway is a hole punched through the wall layer by an SVG mask, and that
 * hole is `WALL_THICKNESS + 4` = 12 units tall (see `renderWallMask`). Only the
 * *stroke* is skinnable — the geometry constants are shared with the mask and
 * the opening symbols — so a wall wider than the hole would not be fully
 * cleared by its own door, and every doorway would show a sliver of wall.
 */
export const MAX_SKIN_WALL_WIDTH = 10;

export const SKINS: readonly Skin[] = [
  {
    id: DEFAULT_SKIN,
    label: "Default",
    description: "Follows your Home Assistant theme",
    vars: {},
  },
  {
    id: "odnetnin",
    label: "Odnetnin",
    description: "Playful and chunky — thick outlines on warm paper",
    vars: {
      "--fp-skin-bg": "#fffdf7",
      "--fp-skin-card-bg": "#fffdf7",
      "--fp-skin-wall": "#3b3b3b",
      "--fp-skin-wall-width": "10",
      "--fp-skin-wall-filter": "none",
      "--fp-skin-accent": "#e4444c",
      // White, not the charcoal ink: on this red it reads at 4.0 where the
      // charcoal manages 2.8. The skin whose accent is dark enough to want
      // dark ink is the one that would get this wrong by reusing active-ink.
      "--fp-skin-accent-ink": "#ffffff",
      "--fp-skin-active": "#ffcb05",
      "--fp-skin-active-ink": "#3b3b3b",
      "--fp-skin-text": "#3b3b3b",
      "--fp-skin-badge-bg": "#ffffff",
      "--fp-skin-badge-border": "#3b3b3b",
      "--fp-skin-badge-border-width": "2px",
      // Rounded square rather than a circle, and a hard offset shadow instead
      // of a blur — the two together are what read as "printed sticker".
      "--fp-skin-badge-radius": "30%",
      "--fp-skin-badge-shadow": "0 2px 0 #3b3b3b",
      "--fp-skin-furniture": "#b9b3a7",
      "--fp-skin-glow": "#ffe9a8",
    },
  },
  {
    id: "pastel",
    label: "Pastel",
    description: "Soft and low-contrast — muted mauve on blush",
    vars: {
      "--fp-skin-bg": "#fdf7f9",
      "--fp-skin-card-bg": "#fdf7f9",
      "--fp-skin-wall": "#8b8296",
      "--fp-skin-wall-width": "7",
      "--fp-skin-wall-filter": "none",
      "--fp-skin-accent": "#a8c8ec",
      "--fp-skin-accent-ink": "#4a4453",
      "--fp-skin-active": "#ffd6a5",
      "--fp-skin-active-ink": "#4a4453",
      "--fp-skin-text": "#4a4453",
      "--fp-skin-badge-bg": "#ffffff",
      "--fp-skin-badge-border": "#e6dced",
      "--fp-skin-badge-border-width": "1.5px",
      "--fp-skin-badge-radius": "50%",
      "--fp-skin-badge-shadow": "0 1px 4px rgba(120, 100, 130, 0.18)",
      "--fp-skin-furniture": "#d8cfe0",
      "--fp-skin-glow": "#ffe8d6",
    },
  },
  {
    id: "tron",
    label: "Tron",
    description: "Neon lines on near-black — thin walls that glow",
    vars: {
      "--fp-skin-bg": "#05080c",
      "--fp-skin-card-bg": "#05080c",
      "--fp-skin-wall": "#7de3ff",
      // Thin, because a neon line is the light rather than the mass. The glow
      // does the work the width would have done.
      "--fp-skin-wall-width": "5",
      "--fp-skin-wall-filter": "drop-shadow(0 0 4px #22d3ee)",
      "--fp-skin-accent": "#22d3ee",
      "--fp-skin-accent-ink": "#05080c",
      "--fp-skin-active": "#ff9f1c",
      "--fp-skin-active-ink": "#05080c",
      "--fp-skin-text": "#cdf6ff",
      "--fp-skin-badge-bg": "#0b1220",
      "--fp-skin-badge-border": "#22d3ee",
      "--fp-skin-badge-border-width": "1.5px",
      "--fp-skin-badge-radius": "50%",
      "--fp-skin-badge-shadow": "0 0 8px rgba(34, 211, 238, 0.5)",
      "--fp-skin-furniture": "#1e4b57",
      "--fp-skin-glow": "#7de3ff",
    },
  },
];

/**
 * The chains that get interpolated into SVG attributes and inline styles from
 * TypeScript, rather than written in a stylesheet.
 *
 * Each is `var(<token>, <what the call site used to hard-code>)`, so every one
 * still resolves on its own even where the token defaults below are out of
 * scope — and an unskinned plan emits the same colour it always did, one
 * `var()` deeper.
 */
export const SKIN_PAPER = "var(--fp-skin-bg, var(--card-background-color, #fff))";
export const SKIN_WALL = "var(--fp-skin-wall, var(--primary-text-color))";
export const SKIN_TEXT = "var(--fp-skin-text, var(--primary-text-color))";
export const SKIN_ACCENT = "var(--fp-skin-accent, var(--primary-color, #03a9f4))";

/** The skin with this id, or `undefined` — including for the default. */
export function findSkin(id: unknown): Skin | undefined {
  if (typeof id !== "string") return undefined;
  return SKINS.find((s) => s.id === id);
}

/**
 * The `style` attribute text that applies a skin, or `""` when there is nothing
 * to apply.
 *
 * Returning `""` for both the default *and* an unrecognised id is deliberate:
 * a hand-written `skin: nintendo` renders as today rather than as a half-styled
 * plan built from whichever tokens happened to match.
 *
 * The values are library constants, not config, so there is nothing to
 * sanitise here — but they still land in a `style="…"` attribute, and
 * `skins.test.ts` holds them to the same no-breakout rule `cssColor` enforces
 * for user input.
 */
export function skinStyle(id: unknown): string {
  const skin = findSkin(id);
  if (!skin) return "";
  return Object.entries(skin.vars)
    .map(([k, v]) => `${k}:${v};`)
    .join("");
}

/**
 * Default values for every token, to be included in the `static styles` of both
 * the card and the editor. Each one is the exact fallback chain that used to be
 * written at the call site, so an unskinned plan is unchanged and every
 * `var(--fp-skin-…)` read still works standalone.
 */
export const skinTokens = css`
  :host {
    --fp-skin-bg: var(--card-background-color, #fff);
    --fp-skin-card-bg: var(--ha-card-background, var(--card-background-color, #fff));
    --fp-skin-wall: var(--primary-text-color);
    --fp-skin-wall-width: 8;
    --fp-skin-wall-filter: none;
    --fp-skin-accent: var(--primary-color, #03a9f4);
    --fp-skin-accent-ink: var(--text-primary-color, #fff);
    --fp-skin-active: var(--state-light-active-color, var(--state-active-color, #fdd835));
    --fp-skin-active-ink: var(--text-primary-color, #212121);
    --fp-skin-text: var(--primary-text-color);
    --fp-skin-badge-bg: var(--card-background-color, #fff);
    --fp-skin-badge-border: var(--divider-color, #ccc);
    --fp-skin-badge-border-width: 1.5px;
    --fp-skin-badge-radius: 50%;
    --fp-skin-badge-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    --fp-skin-furniture: #9e9e9e;
    --fp-skin-glow: #ffd9a0;
  }
`;
