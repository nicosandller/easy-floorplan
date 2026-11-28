import type { Opening, WindowPane } from "./types";

export const MAX_WINDOW_PANES = 8;
/** Read untrusted YAML without mutating it; old windows have no pane layout. */
export function windowPanes(o: Opening): WindowPane[] {
  if (o.type !== "window" || !Array.isArray(o.panes)) return [];
  return o.panes.slice(0, MAX_WINDOW_PANES).map((p) => {
    const pane = p && typeof p === "object" ? p : {};
    return {
      height: typeof pane.height === "number" && Number.isFinite(pane.height) && pane.height > 0 ? pane.height : 1,
      motion: ["swing", "awning", "slide-up", "slide-down"].includes(pane.motion ?? "") ? pane.motion : "fixed",
      entity: typeof pane.entity === "string" ? pane.entity : undefined,
      invert: pane.invert === true,
    };
  });
}

/** A moving pane reuses the opening's contact/cover interpretation. */
export function paneOpening(o: Opening, p: WindowPane): Opening {
  return { ...o, panes: undefined, shutterEntity: undefined, sash: "single", sashSpan: undefined,
    secondaryEntity: undefined, tiltEntity: undefined,
    motion: p.motion === "swing" || p.motion === "awning" ? p.motion : "fixed",
    entity: p.motion === "fixed" ? undefined : p.entity || o.entity,
    invert: p.entity ? p.invert === true : o.invert === true };
}
