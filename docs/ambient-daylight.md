# Diffuse ambient daylight

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

Ambient daylight uses `Area` polygons for two jobs:

1. determining whether an opening is exterior or interior, and
2. hard-clipping the soft light to the room that receives it.

An opening that touches exactly one known Area boundary is an exterior daylight source. An opening touching two known Areas is an interior opening and is not a V1 sky-light source. An opening touching no known Area is ignored.

This makes complete room geometry important. If a real neighbouring room has no Area polygon, an opening between that room and a modeled room can look exterior because only one side is represented. V1 keeps that limitation explicit instead of guessing missing topology.

## Light behaviour

- Ambient daylight does not use sun azimuth or bearing. Directional direct sunlight remains the job of `sunlight`.
- Sun elevation controls day/twilight/night strength. The transition uses the same civil-twilight interval as the card's sun visual language: zero at or below -6°, full at or above +6°, smoothly eased between them.
- Missing, `unknown`, `unavailable` or otherwise unreadable sun elevation fails dark: the layer renders no invented daylight until Home Assistant supplies a valid elevation again.
- Each exterior opening creates a broad widening wash rather than a narrow sun beam.
- The exact Area polygon clips the result. Blur can soften the pool inside a room but cannot leak through a solid Area boundary.
- Multiple exterior sources combine without normalised brightness exceeding 1.
- The existing opening travel, glazing and shutter state are reused for transmission instead of introducing a second state model.
- `sunlight: false` remains the opening-level natural-light opt-out. This matters for intentionally schematic openings such as an unbound solid door that is drawn open as a floor-plan convention but should not illuminate the room.

The layer is rendered above Area fills and below the existing dead-space, artificial-light and direct-sun layers. It does not reorder those existing layers.

## Why Areas are required

Walls alone describe segments, but not which enclosed polygon is *the room that owns a window*. The Area gives the feature the room identity and an exact physical clip without adding a second room-topology format.

That choice also fails safely: with no Areas, ambient daylight renders nothing rather than spreading light across the whole plan.

## Renderer contract

`ambient-daylight.ts` owns deterministic daylight geometry and transmission math. `ambient-daylight-render.ts` owns SVG paint and clipping. `ambient-daylight-integration.ts` is the thin card-facing adapter that reuses the card's existing opening/shutter resolvers.

The SVG renderer uses:

- one exact Area clip path,
- one bounded Gaussian blur filter,
- one user-space linear gradient per opening patch,
- deterministic IDs with a per-card instance prefix,
- rejection of invalid/non-finite geometry and opacity.

The renderer owns the patch `fill` and `filter`. Card CSS must not replace either with a flat declaration; a regression guard covers the same class of live-browser compositing failure that previously affected direct sunlight.

## V1 boundaries

Deliberately outside the first public version:

- weather/cloud attenuation,
- calibration from local irradiance or lux sensors,
- orientation-dependent sky exposure,
- propagation through open interior doors,
- curtains/blinds beyond the existing shutter transmission,
- vertical opening geometry,
- moonlight or night-sky contribution,
- semantic/decorative room colouring.

These can be added later without changing the distinction between directional sunlight and diffuse sky light.

## Validation expectations

The feature follows the repository's normal validation path: project typecheck, the complete Vitest suite and production build. Geometry tests cover exterior/interior classification, twilight strength, transmission, falloff, clipping, invalid inputs and multiple-card SVG ID isolation. Host/editor tests pin opt-in behaviour, the `sun.sun` watcher contract, fail-dark behavior and independence from direct sunlight.

Before release, the built card must also be checked in a real browser with its actual stylesheet for layer order and gradient/filter composition. Markup-only rendering is not sufficient evidence because CSS participates in the final SVG composition.
