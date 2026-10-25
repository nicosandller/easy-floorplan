# Changelog

## Unreleased

- Awnings and curtains (#196): an `awning` or `curtain` bound to a `cover` is drawn at
  the cover's position, with `w × h` as its fully extended size. A curtain gathers at
  the end `hand` picks, or at both ends with `hand: center`. Symbols can opt in with
  the new `extend` and `elevation` keys. See [Furniture](docs/configuration.md#furniture).
- Furniture action icons can be hidden per piece (`showIcon: false`, or **Action icon**
  under Behavior); the drawing itself then takes the tap. The icons also follow
  `overlayScale: plan` now, shrinking with the drawing like device badges instead of
  staying 34px on a narrow card (#362). On existing `plan` dashboards the icons will
  look smaller than before; that is intended. `fixed` keeps them at 34px.
- Device labels gain `labelPosition: above`, and `auto` picks the clearest side
  once the plan is laid out, keeping clear of walls, openings, badges and other
  labels (#379). It measures only when the plan, floor, rotation, zoom, card size
  or a label's length changes; the 3D view keeps auto labels below.
- Animate live 3D quarter-turns around the floorplan, keeping labels, devices
  and room focus aligned. Repeated clicks can continue or reverse a turn; reset
  cancels it, and reduced motion keeps turns immediate (#354).
- Floor selection buttons can use a dashboard theme preset and an explicit horizontal
  or vertical layout (#353). The editor previews both; CSS variables, parts and floor
  id selectors support custom appearances. Existing plans keep the classic style.
- LED strips (#298): a cast-light device with a `stripLength` casts its light along a
  run instead of from a point, with a `stripSide` for a strip mounted on a wall. Walls
  stop it, the night clears along it, and its ends drag and snap like a wall's in the
  editor — laid onto a wall, it lights the room it came from. See [LED strips](docs/configuration.md#led-strips).
- Add a live Line art appearance and optional controls for 2D/3D, appearance,
  quarter-turn rotation and reset. Device states, opening actions and room zoom
  stay interactive. Configure them under Project → Display; new plans include
  the controls, while existing plans can opt in. An optional SVG download exports
  a static drawing of the active floor. See the [appearance guide](docs/appearance.md#live-appearance-and-view-controls).
- Ambient daylight (`ambientDaylight: true`) now follows solid wall outlines and
  openings instead of named Area boundaries (#319). Interior partitions block the
  wash, and open or glazed doors can carry it into neighbouring rooms within its
  fade distance. Adding or moving Area labels no longer changes wall-derived light.
- This changes existing opt-in plans: if any closed wall outline exists on a floor,
  openings outside closed outlines are ignored even if their rooms have Areas.
  Complete each building's walls to include it. Explicit doors, windows and passages
  can bridge wall gaps when both jambs meet walls; unmarked gaps can still prevent an
  outline from closing. Floors with no closed outline retain the Area-based fallback.
  See the [ambient daylight guide](docs/ambient-daylight.md) for the geometry limits.
- Ambient daylight remains off by default. The direct sunlight and device-light
  layers keep their existing behaviour.
- Sunlight now lights the floor behind a railing along its whole length. Before,
  the sun reached a glazed balcony door over the railing, but the balcony floor in
  front of it stayed dark, so the light seemed to start at the door. The door now
  carries the railing's light on into the room instead of adding a second patch.
