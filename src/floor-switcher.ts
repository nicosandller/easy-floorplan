import { css } from "lit";
import type { FloorplanCardConfig } from "./types";

/** The live buttons and the editor's drag handle use the same appearance. */
export function floorSwitcherClasses(
  c: Pick<FloorplanCardConfig, "floorSwitcher" | "compactHeader">,
): string {
  const layout = c.floorSwitcher?.layout;
  const row = layout === "horizontal" || (layout !== "vertical" && c.compactHeader === true);
  return `${row ? "row" : ""} ${c.floorSwitcher?.style === "buttons" ? "buttons" : ""}`;
}

// Public variables are only consumed, never declared here, so values inherited
// from a theme or card-mod win over either preset. Private defaults let the
// dashboard preset change without making authors fight selector specificity.
export const floorSwitcherStyles = css`
  .floor-switcher {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--fp-floor-switcher-gap, var(--_fp-floor-gap, 4px));
    max-width: calc(100% - 16px);
  }
  .floor-switcher.row {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .floor-switcher.buttons {
    --_fp-floor-gap: 8px;
    --_fp-floor-radius: var(--ha-card-border-radius, 12px);
    --_fp-floor-padding: 10px 16px;
    --_fp-floor-font-size: 14px;
    --_fp-floor-font-weight: 500;
    --_fp-floor-min-height: 44px;
    --_fp-floor-shadow: none;
    --_fp-floor-background: var(--ha-card-background, var(--card-background-color, #fff));
    --_fp-floor-color: var(--primary-text-color, #212121);
    --_fp-floor-border: var(--ha-card-border-color, var(--divider-color, #ccc));
    --_fp-floor-accent: var(--primary-color, #03a9f4);
    --_fp-floor-accent-ink: var(--text-primary-color, #fff);
  }
  :where(.floor-switcher) .floor-button {
    box-sizing: border-box;
    border: var(--fp-floor-switcher-border-width, 1px) solid
      var(--fp-floor-switcher-border-color, var(--_fp-floor-border, var(--fp-skin-badge-border, var(--divider-color, #ccc))));
    background: var(--fp-floor-switcher-background, var(--_fp-floor-background, var(--fp-skin-badge-bg, var(--card-background-color, #fff))));
    color: var(--fp-floor-switcher-color, var(--_fp-floor-color, var(--fp-skin-text, var(--primary-text-color))));
    border-radius: var(--fp-floor-switcher-border-radius, var(--_fp-floor-radius, 6px));
    padding: var(--fp-floor-switcher-padding, var(--_fp-floor-padding, 4px 8px));
    font-size: var(--fp-floor-switcher-font-size, var(--_fp-floor-font-size, 12px));
    font-weight: var(--fp-floor-switcher-font-weight, var(--_fp-floor-font-weight, 400));
    line-height: 1;
    min-height: var(--fp-floor-switcher-min-height, var(--_fp-floor-min-height, 0px));
    box-shadow: var(--fp-floor-switcher-box-shadow, var(--_fp-floor-shadow, 0 1px 3px rgba(0, 0, 0, 0.2)));
    max-width: var(--fp-floor-switcher-max-width, 120px);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    align-content: center;
  }
  .floor-switcher.buttons .floor-button {
    font-family: inherit;
  }
  :where(.floor-switcher) .floor-button:where(.active) {
    background: var(--fp-floor-switcher-active-background, var(--fp-floor-accent, var(--_fp-floor-accent, var(--fp-skin-accent, var(--primary-color, #03a9f4)))));
    color: var(--fp-floor-switcher-active-color, var(--_fp-floor-accent-ink, var(--fp-skin-accent-ink, var(--text-primary-color, #fff))));
    border-color: var(--fp-floor-switcher-active-border-color, var(--fp-floor-switcher-active-background, var(--fp-floor-accent, var(--_fp-floor-accent, var(--fp-skin-accent, var(--primary-color, #03a9f4))))));
  }
`;
