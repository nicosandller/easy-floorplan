import { nothing, svg, type SVGTemplateResult } from "lit";
import type { Area, Floor, FloorplanCardConfig, Opening, RenderHass } from "./types";
import { openingClearFraction, shutterAmount } from "./render";
import {
  ambientDaylightPatches,
  ambientOpeningSources,
  ambientOpeningTransmission,
} from "./ambient-daylight";
import { renderAmbientDaylight } from "./ambient-daylight-render";

/** Explicit opt-in: existing plans remain on their old render path. */
export function ambientDaylightEnabled(
  config: Pick<FloorplanCardConfig, "ambientDaylight"> | null | undefined,
): boolean {
  return config?.ambientDaylight === true;
}

export interface AmbientDaylightOpeningState {
  /** Primary opening travel, normalized to 0..1 by the card's existing resolver. */
  amount(opening: Opening): number;
  /** Optional second-leaf travel for two-panel openings. */
  secondAmount(opening: Opening): number | undefined;
}

/**
 * The floor's Areas, each carrying an id no other Area on the floor shares.
 *
 * Area ids are hand-authored, so two rooms can carry the same one. Everything
 * downstream keys on that id twice over — which sources belong to which room,
 * and the clip/filter/gradient ids the SVG resolves by `url(#...)` — so a
 * duplicate does not merely confuse a label. A window in the first room paints
 * a patch into the second, and the second room's patches resolve their clip to
 * the first room's polygon: daylight in a room with no opening at all, shaped
 * like a room somewhere else. `renderAreaBorder` takes the same precaution by
 * handing its clip the array index (see `floorplan-card.ts`).
 *
 * The first Area to claim an id keeps it, so a well-formed plan renders
 * byte-identical markup and only a plan that is already wrong sees a suffix.
 * The loop covers the corner where a real Area is already named like the
 * suffix we would have generated.
 */
function uniquelyIdentified(areas: readonly Area[]): Area[] {
  const taken = new Set(areas.map((area) => area.id));
  const seen = new Set<string>();
  return areas.map((area, index) => {
    if (!seen.has(area.id)) {
      seen.add(area.id);
      return area;
    }
    let id = `${area.id}#${index}`;
    for (let n = 0; taken.has(id); n++) id = `${area.id}#${index}-${n}`;
    taken.add(id);
    seen.add(id);
    return { ...area, id };
  });
}

/**
 * Render the complete diffuse-daylight layer for one active floor.
 *
 * Kept separate from `floorplan-card.ts` so the host card only needs one
 * additive render call. The feature uses the same opening-clear and shutter
 * resolvers as existing light behavior; geometry and SVG painting remain in
 * the pure ambient modules.
 */
export function renderAmbientDaylightLayer(
  floor: Pick<Floor, "areas" | "openings">,
  config: FloorplanCardConfig,
  hass: Pick<RenderHass, "states"> | undefined,
  idPrefix: string,
  openingState: AmbientDaylightOpeningState,
): SVGTemplateResult | typeof nothing {
  if (!ambientDaylightEnabled(config) || floor.areas.length === 0) return nothing;

  const areas = uniquelyIdentified(floor.areas);
  const sources = ambientOpeningSources(areas, floor.openings);
  if (sources.length === 0) return nothing;

  const openingsById = new Map(floor.openings.map((opening) => [opening.id, opening]));
  const transmission = (openingId: string): number => {
    const opening = openingsById.get(openingId);
    if (!opening) return 0;
    const clear = openingClearFraction(
      opening,
      openingState.amount(opening),
      openingState.secondAmount(opening),
    );
    const shutterOpen = opening.shutterEntity
      ? shutterAmount(hass?.states[opening.shutterEntity], opening.shutterInvert)
      : 1;
    return ambientOpeningTransmission(opening, clear, shutterOpen);
  };

  const elevation = hass?.states["sun.sun"]?.attributes?.elevation;
  const rendered = areas.map((area) => {
    const patches = ambientDaylightPatches(area, sources, elevation, transmission);
    return patches.length
      ? renderAmbientDaylight(area, patches, { idPrefix })
      : nothing;
  });
  return rendered.some((layer) => layer !== nothing) ? svg`${rendered}` : nothing;
}
