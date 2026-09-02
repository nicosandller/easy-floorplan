import { nothing, svg, type SVGTemplateResult } from "lit";
import type { Floor, FloorplanCardConfig, HomeAssistant, Opening } from "./types";
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
  hass: HomeAssistant | undefined,
  idPrefix: string,
  openingState: AmbientDaylightOpeningState,
): SVGTemplateResult | typeof nothing {
  if (!ambientDaylightEnabled(config) || floor.areas.length === 0) return nothing;

  const sources = ambientOpeningSources(floor.areas, floor.openings);
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
  const rendered = floor.areas.map((area) => {
    const patches = ambientDaylightPatches(area, sources, elevation, transmission);
    return patches.length
      ? renderAmbientDaylight(area, patches, { idPrefix })
      : nothing;
  });
  return rendered.some((layer) => layer !== nothing) ? svg`${rendered}` : nothing;
}
