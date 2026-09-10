# Lighting

How the plan lights itself — from your own lights, and from the sun outside.

Back to the [README](../README.md).

## Follow the sun

Set **`sunDimming: true`** and the plan dims through dusk and brightens through dawn.

```yaml
type: custom:easy-floorplan-card
sunDimming: true
sunBrightnessMin: 0.45   # brightness once the sun is fully down (default 0.45)
sunBrightnessMax: 1      # brightness in full daylight (default 1)
```

It reads **`sun.sun`'s `elevation`**, which HA computes continuously from your instance's
latitude, longitude and clock. Being a smooth signal there's nothing to interpolate, and
being server-side, a phone in another timezone sees the same picture. The ramp spans civil
twilight (−6° to +6°) and eases at both ends.

- **Device icons and labels are not dimmed** — they sit above the dimming layer, so a dark
  plan stays readable and lit rooms glow.
- **`sunBrightnessMin` defaults to 0.45, not 0** — a plan you can't read is worse than a
  dim one. Set it lower for a darker house.
- **It fails bright** — a missing or unreadable `sun.sun` leaves the plan at full
  brightness rather than stranded dark.

Toggle it in the editor under **Project → Follow the sun**; the brightness sliders appear
once it's on.

### Lit rooms hold back the night

A flat dim would darken a lit room as much as an empty one, leaving a lamp *less*
noticeable at night than at noon. Instead, **light withholds the dim**: any device with
**Cast light** on clears the darkness around itself, full at the centre and diffusing to
nothing at its `glowRadius` — the same shape and falloff as the pool it casts. Strength
follows brightness; a light that's off, unavailable, or has no Cast light clears nothing.

**Walls stop the clearing**, using the same visibility polygon that stops the pools, so a
lit room brightens itself and not the one next door. Walls are treated as solid along
their whole length — light reaches through no doorway, for the clearing or the pool.

## Sunlight

A floor plan is a section through a house, so it has no depth by construction. Letting the
sun in gives it some, from where depth actually comes from.

```yaml
sunlight: true    # light through the windows and open doors
north: 20         # north points 20° clockwise from the top of the canvas
sunBearing: 135   # the sun sits in the south-east; omit to follow the real one
```

**Sunlight** lets the light in through the openings. The sun is far enough away that its
rays arrive parallel, which makes this exact rather than an impression — a wall's shadow is
precisely that wall moved along the light, and the patch a window admits is precisely its
gap moved the same way. So:

- every **window** admits its whole gap, open or shut, because glass is transparent — and
  so does anything `glazed`, which is what a patio or French door is: drawn as a door
  because that is how it swings, but a wall of glass;
- anything **opaque** admits exactly as far as it is open, and no further: a door ajar
  throws a narrow patch, not the one it would throw standing wide open. Sliding styles
  count the gap they actually clear rather than the distance a leaf travels, so a
  converging pair reads the same here as it draws;
- a patch **fades out from its opening** over the distance the light actually travels
  before a wall stops it, so it is always faint by the time it ends, whatever size the
  room is. `sunReach` is the ceiling on that distance, not a fixed span. The falloff is
  an ellipse fitted to the patch — long along the light, narrow across it — so the tip
  rounds off and the flanks dim, instead of the light stopping at an edge;
  What ends a patch is that circle, not the edge of any shape: the beam's outline always
  extends past the point the light has faded to nothing, so you see the arc and never a
  straight cut across the room;
- while the plan follows the real sun, that reach **shortens as the sun climbs** — a patch
  is about as deep as the opening is tall over the tangent of the sun's angle, so a midday
  sun lays a short patch at your feet and an evening one rakes across the room. A pinned
  `sunBearing` states a picture rather than reading the sky, so it keeps the plain reach;
- **walls cast the shade behind them**, cutting the patches — and the part of a door that
  is still shut casts shade like the wall it stands in, while an open doorway casts none,
  the same rule the lamps already follow;
- **only the openings the sun shines on are sources.** Trace back along the light: if a
  wall stands between an opening and the sky, that opening is not letting the sun in. So
  the shaded façade stays dark, and an interior door is never a second sun. Light still
  travels *through* an interior doorway — the beam from the window upstream carries on,
  because that wall's shade has the same gap cut in it — it simply does not start there
  and widen to the doorway's own width (issues #177 / #178);
- a **shutter that is all the way down** stops the light whatever the glass says — that is
  what a shutter is for, and a window behind a closed one is as dark as a wall;
- an opening with `sunlight: false` is **wall to the sun**: no patch of its own, and it
  stops a beam crossing it. That is the answer for a solid front door with no sensor bound
  — the plan draws such a door open, the light believes the drawing, and the corridor
  behind it filled with sunshine the door has never let in;
- everywhere the light never reaches is drawn a shade darker — turn `sunShade` off for the
  patches alone.

`sunBearing` says where the sun **is**; the light travels the opposite way. With the sun in
the south-west it comes in through the south-west windows and falls toward the north-east.

**North** is what makes the angle a statement about the *house*. Without it, "the sun is in
the south-east" would only mean "toward the bottom-left of the drawing", and the same house
traced at a different angle would be lit from the wrong side. Set it once and every bearing
turns with it.

**The sun's height** comes from the same entity while the plan follows it: `sun.sun`'s
`elevation` says whether there is any light at all. Below the horizon nothing is drawn — a
plan does not keep its beams all night — and over the first degrees above it the light
fades in, so sunrise and sunset are a ramp rather than a switch. An unreadable `sun.sun`
leaves the plan lit, never stuck in a night that never ends — and unaimed rather than
aimed wrongly: the bearing falls back to south-east instead of reading a missing azimuth
as due north.

Set `sunBearing` and **the light stays on**, at that angle, around the clock. Stating an
angle is a decision about the picture rather than a reading of the sky, so the elevation
stops applying with it: a plan that pins its sun and then goes dark every evening would be
half-following a sun it had already declined to follow.

**`sunBearing`** pins the light. Leave it out and the plan follows `sun.sun`'s azimuth, so
the light swings through the day — the better picture, but one that moves while you are
laying a plan out, and one with no sensible answer at night. It stacks with
[Follow the sun](lighting.md#follow-the-sun), which dims the whole plan after dark and has the last
word: there is nothing to let in at night.

## Skylights

A wall is a line in plan, so the light through a hole in one is that gap swept
along the sun — it starts where the wall is, and you see the whole shaft. A
ceiling is not in the plan at all, so a roof window does something else:

```yaml
openings:
  - { id: velux, type: skylight, x: 450, y: 220, length: 100, width: 60, angle: 0,
      shutterEntity: cover.velux_blind }
skylightDrop: 0.55   # how far the patch slides before it lands (default)
```

**The patch is the skylight, moved.** Parallel light projects a horizontal
rectangle onto a horizontal floor unchanged — congruent, at every sun angle —
so a roof light lays a patch exactly its own size and shape, and the only
question it ever asks is *where*. That is why it needs no swept polygon and no
reach: four corners of arithmetic, and no approximation anywhere in it.

**Where is the ceiling height over the tangent of the sun's angle** — the same
`h/tan(e)` that says how deep a patch of window light is. `skylightDrop` states
it as a fraction of `sunReach`, and that is not a shortcut: the reach already
carries `1/tan(elevation)` (it is why patches shorten as the sun climbs), which
is exactly the factor the drop needs. So a midday sun drops the light almost
straight down the shaft, an evening one throws it right across the room, and
nothing in the skylight has to read the sky to do it. Per skylight,
`ceilingHeight` multiplies it — `2` for a stairwell, `0.6` for a low attic.

**It slides; it does not swing.** The patch keeps the skylight's own `angle` all
day, because a translation turns nothing. A roof light set square to the house
lays a patch square to the house at every hour.

**Only the walls downwind of it can shade it**, and this is the one rule that
had to be written specially rather than reused. A wall opening's light starts
*at* a wall, so every wall in the plan is fair game to shade it. A skylight's
starts at the ceiling — above every wall in the house — so a partition standing
between the roof light and the sun cannot block anything: at that partition the
ray was still outside, over the roof. Past the glass the ray is below ceiling
height and a full-height wall then blocks it completely, which makes the answer
downwind-or-nothing with no half-way case. (Given the plan's ordinary wall
shadows instead, a velux with a partition a couple of metres upwind lost its
patch entirely — the arrangement most real roof lights are in.)

**It is always a source.** The test that keeps a window on the shaded façade
from throwing sunshine into the garden asks which wall stands between it and
the sky; a skylight stands behind none of them, so it is never asked.

**And it is glass**, so what stops the light is the blind, not the sash — see
[The blind is the switch](appearance.md#the-blind-is-the-switch-not-the-sash).
A blind half down leaves half the patch, unlike a wall opening's shutter, which
the plan can only draw up or down. `glazed: false` makes it a roof hatch
instead, admitting light only as far as it is actually open.

Skins can restyle both through `--fp-skin-sunlight` and `--fp-skin-sunshade`.
