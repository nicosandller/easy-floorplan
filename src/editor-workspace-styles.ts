import { css } from "lit";

/** Editor chrome follows HA's theme; the drawing continues to use skin tokens. */
export const editorWorkspaceStyles = css`
  :host { display: block; min-width: 0; }
  .editor {
    --editor-ink: var(--primary-text-color, #24323d);
    --editor-muted: var(--secondary-text-color, #586772);
    --editor-paper: var(--card-background-color, #fff);
    --editor-ground: var(--secondary-background-color, #f3f5f7);
    --editor-line: var(--divider-color, #dfe5e9);
    --editor-accent: var(--primary-color, #00897b);
    container: workspace / inline-size;
    display: flex;
    flex-direction: column;
    gap: 0;
    color: var(--editor-ink);
    background: var(--editor-paper);
    border: 1px solid var(--editor-line);
    border-radius: 12px;
    font: inherit;
    font-size: 14px;
  }
  button, input, select { font: inherit; }
  button {
    min-height: 34px;
    text-transform: none;
    transition: background-color 120ms, border-color 120ms;
  }
  button:hover:not(:disabled) { background: var(--editor-ground); }
  button:focus-visible, input:focus-visible, select:focus-visible {
    outline: 2px solid var(--editor-accent);
    outline-offset: 2px;
  }
  button.active, button.active:hover {
    color: var(--editor-accent);
    background: color-mix(in srgb, var(--editor-accent) 12%, var(--editor-paper));
    border-color: color-mix(in srgb, var(--editor-accent) 35%, var(--editor-line));
  }
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 9px 12px;
    border-bottom: 1px solid var(--editor-line);
    flex: none;
  }
  .editor-brand { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; margin-right: auto; }
  .editor-brand > ha-icon { --mdc-icon-size: 22px; color: var(--editor-accent); flex: none; }
  .editor-brand strong { font-size: 14px; font-weight: 600; max-width: 30ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toolbar .project-settings { padding: 5px; border-color: transparent; color: var(--editor-muted); flex: none; }
  .tool-compact { display: none; }
  .toolbar .apply-error { flex-basis: 100%; font-size: 12px; color: var(--error-color, #c62828); }
  .toolbar { position: relative; }
  .toolbar > .pop-wrap { position: static; }
  .toolbar .add-pop { left: auto; right: 8px; top: calc(100% + 4px); width: min(360px, calc(100% - 16px)); min-width: 0; box-sizing: border-box; display: flex; flex-direction: column; max-height: max(120px, calc(100dvh - 170px)); overflow: auto; }
  .editor.fullscreen .toolbar .add-pop { max-height: max(120px, calc(100dvh - 126px)); }
  .add-shortcuts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; flex: none; }
  .add-pop .furn-search { flex: none; }
  .toolbar .add-entry { justify-content: flex-start; }
  .toolbar .furn-cell { padding: 7px 3px; font-size: 12px; min-height: 70px; justify-content: flex-start; }
  .furn-cell svg { flex-shrink: 0; }
  .add-furn-scroll { scrollbar-width: thin; min-height: 0; }
  .floors .pop { left: 0; right: auto; }
  .toolbar button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 11px; }
  .toolbar button ha-icon { --mdc-icon-size: 18px; }
  .toolbar .apply-btn, .toolbar .apply-btn:hover {
    background: var(--editor-accent);
    border-color: var(--editor-accent);
    color: var(--text-primary-color, #fff);
  }
  .workspace { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; min-width: 0; height: clamp(360px, calc(100dvh - 210px), 780px); overflow: hidden; border-radius: 0 0 12px 12px; }
  .tool-rail {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 4px;
    padding: 8px;
    border-bottom: 1px solid var(--editor-line);
    min-width: 0;
    scrollbar-width: thin;
  }
  .tool-rail button {
    display: flex;
    flex: 1 0 58px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 52px;
    padding: 8px 4px;
    border: 1px solid transparent;
    border-radius: 8px;
    font-size: 11px;
    color: var(--editor-muted);
    background: transparent;
  }
  .tool-rail ha-icon { --mdc-icon-size: 21px; }
  .tool-rail button.active {
    color: var(--editor-accent);
    background: color-mix(in srgb, var(--editor-accent) 12%, var(--editor-paper));
    border-color: color-mix(in srgb, var(--editor-accent) 25%, var(--editor-line));
  }
  .canvas-column { min-width: 0; display: flex; flex-direction: column; background: var(--editor-ground); }
  .canvas-heading { display: flex; align-items: center; gap: 10px; padding: 6px 12px; background: var(--editor-paper); border-bottom: 1px solid var(--editor-line); }
  .canvas-heading .spacer { flex: 1; }
  .canvas-heading .icon-btn { display: flex; align-items: center; gap: 6px; color: var(--editor-muted); border-color: transparent; }
  .canvas-heading ha-icon { --mdc-icon-size: 18px; }
  .floors { min-width: 0; gap: 6px; }
  .floors > ha-icon { color: var(--editor-muted); }
  .floors > label { display: none; }
  .floors select { max-width: 180px; min-width: 60px; font-weight: 600; border-color: transparent; background: transparent; }
  .floors > button { display: inline-flex; align-items: center; justify-content: center; width: 30px; padding: 5px; border-color: transparent; }
  .canvas-outer { padding: 12px; min-width: 0; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .canvas-wrap { width: 100%; box-sizing: border-box; min-width: 0; border-radius: 4px; border-color: var(--editor-line); flex: 1; height: auto; min-height: 0; resize: none; max-height: none; aspect-ratio: auto !important; background: var(--editor-ground); }
  .stage { box-shadow: 0 1px 6px #0000000a; }
  .grid { stroke-opacity: .11; }
  .zoom-overlay { right: 22px; bottom: 22px; gap: 0; padding: 3px; background: var(--editor-paper); border: 1px solid var(--editor-line); border-radius: 8px; box-shadow: 0 3px 10px #0000000d; }
  .zoom-overlay button { border: 0; min-height: 30px; background: transparent; }
  .zoom-overlay button:hover { background: var(--editor-ground); }
  .zoom-overlay ha-icon { --mdc-icon-size: 17px; }
  .context-bar { margin: 0; padding: 7px 12px; gap: 8px; background: var(--editor-paper); border: 0; border-top: 1px solid var(--editor-line); border-radius: 0; }
  .context-bar .ctx-label { border: 0; padding: 0; text-transform: none; letter-spacing: 0; font-size: 12px; }
  .context-bar .ctx-hint { font-size: 12px; line-height: 1.5; }
  .context-bar .ctx-divider { margin-left: auto; }
  .context-bar button { font-size: 12px; min-height: 32px; padding: 4px 8px; }
  .snap-control { display: flex; align-items: center; gap: 6px; color: var(--editor-muted); font-size: 12px; white-space: nowrap; }
  .snap-control select { min-height: 30px; padding: 3px 6px; border: 1px solid var(--editor-line); border-radius: 6px; color: var(--editor-ink); background: var(--editor-paper); }
  .ctx-count { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .context-bar .ctx-label { display: none; }
  .side { display: flex; flex-direction: column; min-width: 0; gap: 0; border-top: 1px solid var(--editor-line); background: var(--editor-paper); }
  .inspector-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 0 16px; border-bottom: 1px solid var(--editor-line); }
  .inspector-tabs { display: flex; gap: 12px; }
  .inspector-tabs button { min-height: 42px; padding: 10px 2px; border: 0; border-radius: 0; border-bottom: 2px solid transparent; color: var(--editor-muted); background: transparent; font-weight: 600; }
  .inspector-tabs button[aria-selected="true"] { color: var(--editor-accent); border-bottom-color: var(--editor-accent); }
  .inspector-tabs button:hover { color: var(--editor-accent); background: transparent; }
  .canvas-jump, .preview-toggle { min-height: 44px; padding: 5px; border: 0; color: var(--editor-accent); font-size: 12px; }
  .preview-toggle { margin-left: auto; }
  .context-bar .inspector-jump { color: var(--editor-accent); margin-left: auto; }
  .edit-area, .panel { border: 0; border-radius: 0; padding: 16px; }
  .panel { border: 0; }
  .panel-body { margin-top: 0; }
  .side .rows { display: flex; flex-direction: column; gap: 0; }
  .side .rows > * { width: 100%; box-sizing: border-box; }
  .edit-head { display: grid; grid-template-columns: 28px minmax(0, 1fr) repeat(3, 32px); gap: 4px; padding-bottom: 14px; margin: 0; }
  .edit-head .head-spacer { display: none; }
  .edit-head .edit-title { font-size: 14px; white-space: normal; line-height: 1.4; }
  .selection-symbol { position: static; display: block; width: 28px; height: 32px; color: var(--editor-ink); }
  .edit-head button { min-height: 30px; padding: 5px; justify-content: center; border-color: transparent; }
  .cfg-group { width: 100%; margin: 0; padding: 16px 0 0; border: 0; }
  .cfg-group + .cfg-group { border-top: 1px solid var(--editor-line); margin-top: 12px; }
  .cfg-group-title { min-height: 0; margin: 0 0 14px; padding: 0; font-size: 14px; font-weight: 600; letter-spacing: 0; color: var(--editor-ink); }
  .settings-category { position: sticky; top: 43px; z-index: 1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; margin: 0 0 16px; padding: 6px 0; background: var(--editor-paper); border-bottom: 1px solid var(--editor-line); }
  .settings-category.two-columns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .settings-category > button { min-width: 0; min-height: 36px; padding: 7px 4px; color: var(--editor-muted); background: transparent; border: 1px solid transparent; border-radius: 6px; font-size: 13px; font-weight: 500; }
  .settings-category > button[aria-selected="true"] { color: var(--editor-accent); background: color-mix(in srgb, var(--editor-accent) 10%, var(--editor-paper)); border-color: color-mix(in srgb, var(--editor-accent) 25%, var(--editor-line)); font-weight: 600; }
  .side .row { gap: 8px; margin-bottom: 12px; }
  .side .row label { font-size: 13px; flex-basis: 94px; color: var(--editor-ink); }
  .side .row.col > label { flex-basis: auto; }
  .side .row input[type="text"], .side .row input[type="number"], .side .row select { min-height: 38px; box-sizing: border-box; padding: 7px 9px; border-radius: 6px; border-color: var(--editor-line); font-size: 14px; }
  .side .row input.num { flex: 1; width: 0; }
  .side .row input[type="range"] { flex: 1; width: 0; min-width: 0; accent-color: var(--editor-accent); }
  .side .row input[type="range"] + input.num { flex: 0 0 62px; min-width: 62px; }
  .side .hint { font-size: 12px; line-height: 1.6; }
  .inspector-empty { padding: 24px 8px 30px; display: grid; justify-items: center; text-align: center; }
  .inspector-empty > ha-icon { --mdc-icon-size: 30px; padding: 14px; background: var(--editor-ground); border-radius: 14px; color: var(--editor-muted); margin-bottom: 16px; }
  .inspector-empty strong { font-size: 14px; font-weight: 600; }
  .inspector-empty p { color: var(--editor-muted); line-height: 1.7; margin: 8px 0 16px; max-width: 26ch; }
  .inspector-empty span { color: var(--editor-muted); font-size: 11px; }
  /* The popover top layer escapes HA's transformed edit dialog. */
  .editor.fullscreen {
    position: fixed;
    inset: var(--editor-viewport-top, 0px) 0 auto;
    z-index: 100;
    width: auto;
    height: var(--editor-viewport-height, 100dvh);
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    box-sizing: border-box;
    overflow: hidden;
  }
  .editor.fullscreen .workspace { flex: 1; min-height: 0; height: auto; border-radius: 0; }
  .canvas-column { min-height: 0; }
  .side { min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; }
  .inspector-heading { position: sticky; top: 0; background: var(--editor-paper); z-index: 2; flex: none; }
  .essential-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
  .essential-field { min-width: 0; }
  .essential-field.full { grid-column: 1 / -1; }
  .essential-field .row { display: flex; flex-direction: column; align-items: stretch; gap: 6px; margin: 0; }
  .essential-field .row label { flex: none; }
  .essential-field .row input.num, .essential-field .row input[type="text"], .essential-field .row select { width: 100%; min-width: 0; flex: none; }
  .essential-field .row:has(input[type="checkbox"]) { flex-direction: row; align-items: center; justify-content: space-between; min-height: 30px; }
  .essential-field .row input[type="checkbox"] { accent-color: var(--editor-accent); }
  .essential-field ha-form { display: block; min-width: 0; }
  .essential-properties > .row { flex-wrap: wrap; }
  .essential-properties > .row > label { flex-basis: 100%; }
  .essential-properties > .row input[type="text"] { flex: 1; min-width: 0; }
  .secondary-property { border-top: 1px solid var(--editor-line); padding-top: 16px; margin-top: 4px; }
  .secondary-property .essential-fields { margin-bottom: 0; }
  @container workspace (min-width: 760px) {
    .workspace {
      grid-template-columns: minmax(0, 1fr) 280px;
      grid-template-rows: minmax(0, 1fr);
      height: clamp(520px, 72dvh, 880px);
    }
    .tool-rail { display: none; }
    .side { border-top: 0; border-left: 1px solid var(--editor-line); }
    .inspector-jump, .canvas-jump, .preview-toggle { display: none; }
    .context-bar > .ctx-hint { flex: 1 1 140px; }
  }
  @container workspace (min-width: 1000px) {
    .workspace { grid-template-columns: 72px minmax(0, 1fr) 316px; grid-template-rows: minmax(0, 1fr); }
    .tool-rail { grid-column: auto; display: flex; flex-direction: column; padding: 6px; border-bottom: 0; border-right: 1px solid var(--editor-line); overflow-y: auto; overflow-x: hidden; }
    .tool-rail button { flex: 0 0 auto; min-height: 54px; padding: 6px 2px; font-size: 12px; gap: 4px; }
  }
  @container workspace (max-width: 999px) {
    .toolbar { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; padding: 8px; gap: 6px; }
    .editor-brand { grid-column: 1 / 3; grid-row: 1; margin: 0; }
    .editor-brand strong { max-width: none; }
    .toolbar .expand-toggle { grid-column: 3; grid-row: 1; }
    .toolbar .apply-btn { grid-column: 4; grid-row: 1; }
    .toolbar .history { grid-column: 1; grid-row: 2; gap: 2px; }
    .toolbar button { min-height: 40px; padding: 7px 9px; }
    .toolbar .project-settings { padding: 3px; min-height: 36px; }
    .toolbar .history button { padding: 7px; border-color: transparent; }
    .tool-compact { display: flex; align-items: center; grid-column: 2 / 4; grid-row: 2; gap: 8px; padding: 0 10px; min-width: 0; border: 1px solid var(--editor-line); border-radius: 6px; color: var(--editor-accent); background: color-mix(in srgb, var(--editor-accent) 5%, var(--editor-paper)); }
    .tool-compact ha-icon { --mdc-icon-size: 18px; flex: none; }
    .tool-compact select { flex: 1; width: 0; min-width: 0; min-height: 40px; padding: 4px 0; font-weight: 600; color: var(--editor-ink); background: transparent; border: 0; }
    .toolbar .insert-menu { grid-column: 4; grid-row: 2; }
    .toolbar .insert-menu > button { width: 100%; }
    .toolbar .apply-error { grid-column: 1 / -1; }
    .toolbar .add-pop { left: 8px; right: 8px; top: calc(100% + 4px); width: auto; min-width: 0; }
    .add-furn-scroll { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .tool-rail { display: none; }
    .canvas-heading { padding: 4px 8px; min-height: 40px; }
    .floors select { max-width: 150px; min-height: 40px; }
    .floors > button { min-height: 40px; width: 34px; }
    .canvas-heading .icon-btn { min-height: 40px; }
    .canvas-outer { padding: 8px; }
    .zoom-overlay { right: 16px; bottom: 16px; }
    .zoom-overlay button { min-height: 36px; }
    .context-bar { padding: 8px; gap: 6px; }
    .context-bar > .ctx-hint { flex: 1 1 160px; }
    .context-bar .ctx-divider { display: none; }
    .context-bar .ctx-count { flex: 1 1 100px; }
    .context-bar .inspector-jump { min-height: 40px; font-size: 12px; padding: 5px 10px; border-color: var(--editor-line); }
    .snap-control { margin-left: auto; }
    .snap-control select { min-height: 36px; }
    .side .row { flex-wrap: wrap; }
    .side .row label { flex-basis: 82px; }
    .side .row input[type="text"], .side .row input[type="number"], .side .row select { min-height: 40px; }
    .essential-field .row label { flex-basis: auto; }
    .essential-properties > .row > label { flex-basis: 100%; }
    .edit-head { grid-template-columns: 20px minmax(0, 1fr) repeat(3, 36px); }
    .edit-head button { min-height: 40px; }
  }
  @container workspace (max-width: 399px) {
    .expand-label, .floors > ha-icon { display: none; }
    .toolbar .expand-toggle { padding: 7px; }
    .editor-brand > ha-icon { display: none; }
    .floors select { max-width: 115px; }
  }
  @container workspace (max-width: 339px) {
    .tool-compact ha-icon { display: none; }
    .tool-compact { padding: 0 4px; }
    .canvas-heading .icon-btn { font-size: 0; gap: 0; width: 44px; padding: 5px; }
  }
  @container workspace (min-width: 600px) and (max-width: 999px) {
    .toolbar { display: flex; flex-wrap: nowrap; }
    .editor-brand > ha-icon { display: none; }
    .editor-brand strong { max-width: 14ch; }
    .toolbar .history, .toolbar .insert-menu, .toolbar .expand-toggle, .toolbar .apply-btn { flex-shrink: 0; }
    .tool-compact { flex: 0 1 140px; }
    .editor.fullscreen .toolbar .add-pop { max-height: calc(100dvh - 70px); }
  }
  @container workspace (max-width: 759px) {
    .toolbar button, .tool-compact select, .canvas-heading button, .floors select, .zoom-overlay button, .snap-control select, .context-bar .inspector-jump { min-height: 44px; }
    .toolbar .project-settings { min-height: 44px; min-width: 40px; }
    .toolbar .history button, .toolbar .expand-toggle, .floors > button { min-width: 44px; }
    .inspector-heading { padding: 0 12px; gap: 4px; }
    .inspector-tabs { gap: 10px; }
    .inspector-tabs button { min-height: 44px; }
    .settings-category { top: 45px; margin-bottom: 12px; }
    .settings-category > button { min-height: 44px; }
    .edit-head { grid-template-columns: 28px minmax(0, 1fr) repeat(3, 44px); }
    .edit-head button { min-height: 44px; }
    .side .row input[type="text"], .side .row input[type="number"], .side .row select { min-height: 44px; font-size: 16px; }
    .side .row label, .side .hint { font-size: 13px; }
    .side { display: none; border-top: 1px solid var(--editor-line); }
    .show-inspector .workspace { grid-template-rows: minmax(130px, .28fr) minmax(200px, .72fr); }
    .show-inspector .side { display: flex; }
    .show-inspector .canvas-heading, .show-inspector .context-bar { display: none; }
    .show-inspector .canvas-outer { padding: 6px; }
    .show-inspector .zoom-overlay { position: static; align-self: flex-end; margin-top: 4px; flex: none; box-shadow: none; }
    .show-inspector .zoom-overlay button { min-height: 36px; }
    .show-inspector .edit-area, .show-inspector .panel { padding-top: 10px; }
    .show-inspector .edit-head { padding-bottom: 8px; }
    .show-inspector.preview-collapsed .workspace, .show-inspector.keyboard-open .workspace { grid-template-rows: minmax(0, 1fr); }
    .show-inspector.preview-collapsed .canvas-column, .show-inspector.keyboard-open .canvas-column { display: none; }
    .keyboard-open .preview-toggle { display: none; }
    .keyboard-open:not(.fullscreen) .workspace { height: max(180px, calc(var(--editor-viewport-height, 100dvh) - 160px)); }
  }
  @media (max-height: 500px) {
    @container workspace (max-width: 759px) {
      .show-inspector:not(.preview-collapsed):not(.keyboard-open) .workspace { grid-template-rows: minmax(90px, .3fr) minmax(140px, .7fr); }
    }
    @container workspace (min-width: 600px) and (max-width: 759px) {
      .show-inspector:not(.preview-collapsed):not(.keyboard-open) .workspace { grid-template-columns: minmax(0, 1fr) 280px; grid-template-rows: minmax(0, 1fr); }
      .show-inspector .side { border-top: 0; border-left: 1px solid var(--editor-line); }
    }
  }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }
`;
