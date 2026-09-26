# Diffuse ambient daylight

Back to the [Lighting guide](lighting.md) or the [README](../README.md).

`ambientDaylight` adds a soft room-aware daylight layer from the visible sky. It is deliberately separate from Easy Floorplan's existing direct `sunlight` layer.

Direct sunlight answers **where does the sun itself cast a patch right now?** It depends on sun bearing, elevation, openings and wall shadows.

Ambient daylight answers **how much daylight from the sky softly reaches this room even when the sun itself does not?** A north-facing window can therefore brighten a room without inventing a direct-sun beam.

## Configuration

```yaml
type: custom:easy-floorplan-card
ambientDaylight: true
```

The option is off by default, so existing plans keep their current rendering.

V1 intentionally exposes only the on/off switch. Strength, depth, spread, tint and blur are implementation defaults until they have enough real-plan calibration to justify stable public knobs.

## Geometry and source classification

Closed **wall outlines** identify the outside of the building. An opening on that
outline can admit sky light; an internal doorway cannot become a new source merely
because a room has no label. Solid room side walls participate in the same geometry.
Dividers and railings do not block light.

Each exterior source paints a broad wash. Its receiving physical room sets the fade
distance, and its visibility through walls and opening gaps sets the clip. Light can
continue through an open or glazed interior doorway within that reach. Named Area
boundaries do not interrupt it. Blur is applied before the wall clip so even its soft
edge stops at a solid partition.

Detached buildings have separate outlines. A detached closed loop inside another
outline, such as a cupboard, is a blocker rather than a second exterior. Wall endpoints
use the same small welding tolerance as the existing dead-space geometry. Draw walls
continuously underneath doors and windows; opening states cut the light gaps at render
time.

**Skylights do not yet supply ambient daylight.** This model needs a source on a wall
with an inward direction; a roof light needs an overhead spread model. Direct
[Sunlight](lighting.md#skylights) continues to model skylights.

### Plans without closed wall outlines

When no closed outline can be found, the original Area-based source classification and
clip remain available. An opening touching exactly one Area is a source; touching two
Areas makes it interior; touching none ignores it. Solid walls still clip those patches.
In this fallback, complete neighbouring Areas are still necessary and light cannot
continue across Area boundaries. With neither closed walls nor Areas, no layer is drawn.

The fallback is selected for the whole floor. On a floor with closed outlines, openings
outside those outlines are ignored, even if an Area is drawn around them. Close the
walls of each building to include it.

## Light behaviour

- Ambient daylight does not use sun azimuth or bearing. Directional direct sunlight remains the job of `sunlight`.
- Sun elevation controls day/twilight/night strength. The transition uses the same civil-twilight interval as the card's sun visual language: zero at or below -6°, full at or above +6°, smoothly eased between them.
- Sun elevation is read as a number or as a numeric string, since Home Assistant supplies it either way depending on the path it arrives by.
- Missing, `unknown`, `unavailable` or otherwise unreadable sun elevation fails dark: the layer renders no invented daylight until Home Assistant supplies a valid elevation again.
- Each exterior opening creates a broad widening wash rather than a narrow sun beam.
- The physical outside outline and each source's wall visibility clip the result. Area-only plans retain their Area clip as described above.
- Multiple exterior sources combine without normalised brightness exceeding 1.
- The existing opening travel, glazing and shutter state are reused for transmission instead of introducing a second state model.
- Whether an opening counts as clear glass is `openingGlassIsClear`, the single rule both existing light paths read. A `motion: roll` window is a roller shutter bound as the opening's own entity, so it is judged by how far down it is rather than treated as always-clear glass. That helper's known gap applies here too: a blind or curtain that defaults to `slide` rather than `roll` still reads as clear glass, and fixing it needs a covering flag of its own on the opening.
- Every state the layer reads — sun elevation, opening travel and shutter position — comes from the card's replay-aware state source, and enabling the layer adds `sun.sun` to the replay scope so history is actually fetched for it. A plan scrubbed back through replay history therefore shows the daylight of the moment being replayed rather than of now.
- Cloud cover thins the wash when `cloudCoverEntity` is set, but only to 70% of itself under full cover: clouds hide the sun, not the sky. See [Clouds](lighting.md#clouds).
- `sunlight: false` remains the opening-level natural-light opt-out. This matters for intentionally schematic openings such as an unbound solid door that is drawn open as a floor-plan convention but should not illuminate the room.

The layer is rendered above Area fills and below the existing dead-space, artificial-light and direct-sun layers. It does not reorder those existing layers.

## Renderer contract

`ambient-daylight.ts` owns deterministic patch geometry, transmission math and the Area-only fallback. `ambient-daylight-walls.ts` derives physical regions using the shared planar wall-face walker and uses the existing wall visibility sweep. `ambient-daylight-render.ts` owns SVG paint and clipping. `ambient-daylight-integration.ts` is the thin card-facing adapter that reuses the card's existing opening/shutter resolvers.

The SVG renderer uses:

- one exact outside-outline clip per exterior source (an Area clip in fallback mode),
- one wall-visibility clip per patch, applied outside its blur,
- one bounded Gaussian blur filter,
- one user-space linear gradient per opening patch,
- deterministic IDs with a per-card instance prefix,
- rejection of invalid/non-finite geometry and opacity.

The renderer owns the patch `fill` and `filter`. Card CSS must not replace either with a flat declaration; a regression guard covers the same class of live-browser compositing failure that previously affected direct sunlight.

## Remaining boundaries

The wash is a visual approximation: visibility is sampled from the opening centre, not integrated across its full width. Partial passages use the shared centred-gap approximation. It does not model light bouncing around a corner or sky occlusion by buildings outside the outline.

Still outside this layer:

- calibration from local irradiance or lux sensors,
- orientation-dependent sky exposure,
- diffuse skylight sources and indirect light bouncing between rooms,
- curtains/blinds beyond the existing shutter transmission,
- vertical opening geometry,
- moonlight or night-sky contribution,
- semantic/decorative room colouring.

These can be added later without changing the distinction between directional sunlight and diffuse sky light.

## Validation expectations

The feature follows the repository's normal validation path: project typecheck, the complete Vitest suite and production build. Geometry tests cover exterior/interior classification, twilight strength, transmission, falloff, clipping, invalid inputs and multiple-card SVG ID isolation. Host/editor tests pin opt-in behaviour, the `sun.sun` watcher contract, fail-dark behavior and independence from direct sunlight.

The renderer's own markup is asserted directly — the patch fill pointing at the gradient it built, the blur on the patch with wall and envelope clips on its ancestor groups — because a layer can compute perfect geometry and still paint a flat slab if the `fill` never references it. The stylesheet guard in `src/card-styles.test.ts` covers `.fp-ambient-daylight-patch` for both `fill` and `filter`, so a future CSS rule cannot silently discard renderer-owned paint the way `.fp-sunbeam` once did.

The Chromium regressions exercise the rendered card for missing Areas, open-plan Area boundaries, solid partitions, open doors, generated room walls and dividers. `docker/ambient-preview.html` provides three reproducible visual examples with simulated entities.
