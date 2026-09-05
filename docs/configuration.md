# Configuration reference

Every key the card accepts. The editor writes this for you — you only need this file
to hand-edit YAML or to see what a control maps to.

Back to the [README](../README.md).

## Top level

| Option       | Type     | Default            | Description                                  |
| ------------ | -------- | ------------------ | -------------------------------------------- |
| `type`       | string   | —                  | `custom:easy-floorplan-card`                 |
| `title`      | string   | —                  | Optional card header.                        |
| `width`      | number   | `1000`             | Virtual canvas width, in canvas units.       |
| `height`     | number   | `600`              | Virtual canvas height, in canvas units.      |
| `grid`       | number   | `20`               | Gap between grid lines, in canvas units — smaller means finer. |
| `snap`       | number   | follows `grid`     | Snap step in canvas units, always absolute. Omit to follow the grid, `0` for free placement. The editor shows a custom step as a percentage of the grid. |
| `rotation`   | number   | `0`                | Rotate the card `90`, `180` or `270`° — a landscape plan on a portrait wall tablet. Icons and labels stay upright; the editor always shows the plan as drawn. |
| `rotationPortrait` | number | (same as `rotation`) | Rotation to use while the **screen** is portrait, overriding `rotation`. Unset means `rotation` applies whichever way the screen is. See [Rotation that follows the screen](appearance.md#rotation-that-follows-the-screen). |
| `rotationLandscape` | number | (same as `rotation`) | Rotation to use while the screen is landscape. The mirror of `rotationPortrait`; set either, or both. |
| `showDeadSpaces` | boolean | `false` | Hatch every space the walls seal off that no door or window reaches, worked out from the walls and openings themselves. See [Dead spaces](behavior.md#dead-spaces). |
| `sunDimming` | boolean | `false` | Dim through dusk, brighten through dawn, from the HA instance's sun. See [Follow the sun](lighting.md#follow-the-sun). |
| `sunBrightnessMin` | number | `0.45` | Brightness once the sun is fully down, 0–1. |
| `sunBrightnessMax` | number | `1` | Brightness in full daylight, 0–1. |
| `sunlight`   | boolean  | `false`            | Let the sun in: light through every window and open door, walls casting the shade behind them. See [Sunlight](lighting.md#sunlight). |
| `north`      | number   | `0`                | Where north points on the plan, degrees clockwise from the top of the canvas. What makes the sun angle describe the house rather than the drawing. |
| `sunBearing` | number   | live sun           | Compass bearing of **where the sun is** (0 = north, 90 = east); the light travels the other way. Absent, the plan follows `sun.sun`'s azimuth and the light swings through the day. |
| `sunShade`   | boolean  | `true`             | Darken everywhere the light does not reach. Off draws the patches alone, leaving the plan as bright as it was. |
| `sunlightColor` | string | warm white        | Colour of the light the openings let in. |
| `sunShadeColor` | string | black             | Colour of that shade — a blue reads as cold north light, a warm grey as dusk. |
| `sunReach`   | number   | `0.34`             | How far light carries from an opening, as a fraction of the plan's shorter side. It fades out over that distance rather than stopping at it, and shortens as the sun climbs. Clamped to `0.02`–`1.5`; anything unreadable falls back to the default. |
| `skin`       | string   | `default`          | Built-in look for the whole plan: `default`, `odnetnin`, `pastel` or `tron`. See [Skins](appearance.md#skins). |
| `pressEffect`| string   | `scale`            | Feedback when a device is pressed: `scale`, `ripple`, `flash` or `none`. Only devices that actually do something respond. See [Press feedback](../README.md#press-feedback). |
| `offlineStyle`| string  | `dim`              | How a device whose entity is **offline** is drawn: `dim`, `strike` (dimmed with a diagonal through the badge) or `none`. See [Offline devices](behavior.md#offline-devices). |
| `compactHeader`| boolean | `false`           | Draw the title inside the plan and the floor buttons in a row, instead of spending a card header row on them. See [Compact header](appearance.md#compact-header). |
| `overlayScale`| string  | `fixed`; `plan` in new plans | How badges, labels, room names and text are sized: `plan` = canvas units so they scale with the drawing, `fixed` = screen pixels. A card added from the picker is created with `plan`; a config that doesn't say renders `fixed`, which is what every plan drawn before the option existed was laid out in. See [Overlay scale](appearance.md#overlay-scale). |
| `zoomedOverlayScale` | number | `1` | Overlay size while zoomed in to a room, as a multiple of its size at full plan. `1` — the default — holds badges, labels and text at the size they have unzoomed, which is what zooming has always done. Raise it for a wall tablet read at arm's length, lower it to get a dense room's badges out of the way. Applies to the whole overlay so a badge and its label scale as one thing, and does nothing at full plan. |
| `background` | string   | skin / card bg     | Canvas background color (CSS / hex). Overrides the skin's paper. |
| `palette`    | Palette[]| —                  | Named colours for this plan, referenced from any colour field as `var(--fp-color-<name>)`. See [Named colors](appearance.md#named-colors). |
| `floors`     | Floor[]  | —                  | Per-floor element groups (see [Floor](#floor)).   |
| `defaultFloor`| string  | first floor        | Id of the floor shown first.                 |
| `walls`      | Wall[]   | `[]`               | Wall segments (single-floor / floor 1).      |
| `openings`   | Opening[]| `[]`               | Doors and windows (swing or sliding).        |
| `items`      | Item[]   | `[]`               | Entity devices.                              |
| `texts`      | Text[]   | `[]`               | Free text labels.                            |
| `furniture`  | Furniture[]| `[]`             | Gray furniture/fixture diagrams.             |
| `trackers`   | Tracker[]| `[]`               | Live position trackers (see [Tracker](#tracker)).    |
| `areas`      | Area[]   | `[]`               | Named room polygons (see [Area](#area)).          |
| `symbols`    | map      | —                  | Furniture symbols this plan defines for itself, merged over the shipped library. See [Drawing your own](#drawing-your-own). |
| `historyReplay` | object | disabled | Optional history replay controls. Set `enabled: true` to show replay controls and load Home Assistant history for mapped entities only. |

When `floors` is present each floor carries its own `walls`, `openings`, `items`, `texts`,
`furniture`, `trackers` and `areas`. The top-level arrays describe a single implicit floor
and remain valid for backward compatibility.

### Palette

One entry per named colour. See [Named colors](appearance.md#named-colors) for how to
point a field at one.

| Option  | Type   | Default | Description                                            |
| ------- | ------ | ------- | ------------------------------------------------------ |
| `name`  | string | —       | Shown in the dropdown, and what the reference is built from: lowercased, with anything but letters and digits turned into `-`. `Warm white` is `var(--fp-color-warm-white)`. |
| `color` | string | —       | Any colour the card accepts — hex, a CSS name, `rgb()`, `color-mix()`, or a theme `var()`. |

An entry with no usable name, or a colour the card would refuse anywhere else, is
dropped — the rest of the palette still works. Two names that reduce to the same
reference are the same colour, and only the first is kept.

## History replay

`historyReplay` is optional and off by default.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Offers the **Replay** button on the card. Replay itself stays off until you press it. |
| `lookbackSeconds` | number | `3600` | Initial replay window length in seconds. Must be positive. |
| `defaultSpeed` | number | auto | Playback speed in simulated seconds per real second. `1` means real-time. |
| `debug` | boolean | `false` | Log replay lifecycle (load, seek, play, pause) to the browser console. Off by default — seeking logs once per frame. |
| `numericSteps` | number | unset | Thin numeric sensor drift to this many levels of each sensor's observed range, to cut the time a freshly loaded window takes to draw. Discrete states — lights, doors, covers — are never thinned. Unset keeps every point. |

`enabled: true` puts a **Replay** button on the card and nothing else. The plan keeps
showing live state until you press it; opening the panel loads the chosen window and
puts the plan at the *start* of it, and the **live** button in the panel's corner
closes replay and hands the plan back to Home Assistant. There is no separate on/off
setting and no mode to be stuck in: open means replay, closed means live. The panel's
clock — the highlighted timestamp in its header, and the one riding the timeline
playhead — is where in time the plan is being drawn from.

Closing keeps the window loaded, so reopening on the same range does not fetch it
again.

A busy plan can load thousands of points a numeric sensor never meaningfully moved
through, and each one becomes a marker on the timeline. `numericSteps: 25` keeps the
shape of every curve — including its peaks — while drawing far fewer of them:

```yaml
historyReplay:
  enabled: true
  lookbackSeconds: 7200
  numericSteps: 25
```

In the expanded lane view, clicking a lane's label switches that lane off — its
markers go, and so does its contribution to the collapsed summary bar. The row stays
behind, struck through, so you can click it again; a "Show all" control appears while
anything is hidden, including after you collapse the lanes. It's a view preference for
the session, not config.

Separately from this, and not configurable: the timeline draws at most 150 markers
per lane, spending them on each sensor's largest moves. A sensor that genuinely
swings across its whole range — a distance tracker, say — survives `numericSteps`
almost intact and would still paint the lane as one solid bar. Replay steps through
every value it loaded either way; the cap only decides what gets a marker.

## Floor

`{ id, name, short?, color?, haFloor?, image?, imageFit?, imageOpacity?, walls, openings, items, texts, furniture, trackers, areas }`
— a named floor with its own elements. Add, rename, reorder, switch and delete floors from
the editor's **floor** controls; the card shows a switcher when there is more than one.

- **`short`** — abbreviation for the card's switcher button (`GF`, `1st`…), full name as
  its tooltip. **`color`** accents that button while its floor is active. The top-level
  **`defaultFloor`** picks which floor the card opens on.
- **`haFloor`** — id of a linked Home Assistant floor, set from the floor gear popover.
  Today it auto-names the floor.
- **`image`** — a background URL (e.g. `/local/floorplan.png`) drawn behind the elements,
  for tracing over a real plan. **`imageOpacity`** (0–1, default 1) fades it.
- **`imageFit`** — how that image maps onto the canvas, per floor so scans of differing
  resolutions can each choose:

| `imageFit` | What it does |
| --- | --- |
| `stretch` *(default)* | Fills the canvas, distorting if the ratios disagree. |
| `contain` | Scales to fit, keeping proportions — may leave the canvas showing on two sides. |
| `cover` | Fills the canvas keeping proportions, cropping the overflow. |

`stretch` is the default so plans already traced over one don't shift away from their
walls. Note the card is still stretched into whatever box the dashboard gives it, so keep
`width` / `height` close to the shape it occupies on screen or a `contain` image looks
distorted anyway.

## Wall

`{ id, x1, y1, x2, y2, thickness?, locked? }` — endpoints in virtual units.

**`thickness`** is the stroke width in virtual units, set per wall by the **Thickness**
slider in the editor. It defaults to `8` and is capped at `10`: a doorway is cut through
the wall layer with a mask sized off the shared default, not per wall, so a wall drawn
wider than the cap would not be fully cleared by its own door or window.

## Opening (door / window)

| Field         | Type                        | Description                                            |
| ------------- | --------------------------- | ------------------------------------------------------ |
| `id`          | string                      | Unique id.                                             |
| `type`        | `door` \| `window`          | The kind of opening.                                   |
| `motion`      | `swing` \| `slide` \| `roll` \| `fixed` | How it moves: hinged (default), sliding panels, a roll-up curtain (garage / roller shutter), or `fixed` — a window that does not open (bay, picture, sealed pane). A fixed opening draws no leaf and no arc, ignores `entity` for its drawing, and never counts as a gap; glazing still applies, so it passes daylight like the glass it is. |
| `sunlight`    | boolean                     | `false` takes this opening out of [Sunlight](lighting.md#sunlight) entirely — it admits no light and blocks it like wall, however open it is drawn. Editor: **Lets sunlight in**. For the solid door with no sensor, which the plan draws open. |
| `glazed`      | boolean                     | Lets sunlight through even when shut. Defaults per type — a window is glass, a door is not. Set `true` on a **patio or French door**, which is drawn as a door because that is how it swings but is a wall of glass; set `false` on an opaque window like a glass-brick panel or a hatch, which then admits light only as far as it is open. Only [Sunlight](lighting.md#sunlight) reads it. |
| `sashSpan`    | number (0.05–1)             | Share of the opening the operable leaf covers; the rest is drawn as a fixed pane — thin glass on a window, a solid panel on a door. Default 1 (the leaf fills the frame). Single-**leaf** swing openings, doors included — a double already splits the frame between its leaves. The leaf hangs at the hinge jamb, so `flipH` moves it and its pane together, and a half-width leaf swung wide open clears half the opening rather than all of it. Values below `0.05` are clamped to it: a leaf of no width is a fixed pane, which `motion: fixed` says properly. |
| `sash`        | `single` \| `double`        | Swing openings only: how many hinged leaves. The default differs by type, because the ordinary cases do — a window opens with `double` (two casement sashes), a door with `single` (one leaf across the opening). Set it to draw a single-sash window or a **double door**; both leaves then hinge at their own jamb and trace their own arc. Ignored by sliding and rolling openings. |
| `shutterEntity` | string                     | An external shutter over the same gap (`cover` or contact), with its own open/closed state. With `entity` bound too, the card draws the shutter's own icon beside the opening — open/closed in both glyph and colour — and tapping that icon opens the shutter. |
| `shutterStyle` | `swing` \| `roll`           | Louvered panels or a roll-up curtain. Defaults from the entity (contact → `swing`, `cover` → `roll`). |
| `shutterInvert` | boolean                   | Flip the shutter's open/closed reading — a reed contact on hinged panels often reads `on` when they are shut. Separate from `invert`. |
| `shutterSecondaryEntity` | string            | Hinged shutters only: a second contact for the shutter's other panel, so one can be folded back while the other is still across the glass. Its own key rather than `secondaryEntity` — a double casement behind a pair of shutters has four leaves. `shutterInvert` covers both panels; the roll curtain ignores it. |
| `shutterActiveColor` | string               | Shutter color while open. Falls back to `activeColor`, then the accent. |
| `shutterFlipV` | boolean                    | Hang hinged panels on the sash's own side of the wall instead of the far side. Ignored by the roll curtain. |
| `x`, `y`      | number                      | Center position.                                       |
| `length`      | number                      | Length along the wall.                                 |
| `angle`       | number                      | Rotation in degrees.                                   |
| `entity`      | string                      | Contact `binary_sensor`, `cover` or `lock` driving open/closed (a `cover`'s `current_position` gives partial travel). A **lock** reads `unlocked` as open and `locked` as closed — see [Doors on locks](behavior.md#doors-on-locks). |
| `secondaryEntity` | string                  | Anything with **two leaves**: a second contact / `cover` for the other leaf, so each moves on its own state. That means the two-panel sliders (`biparting`, `biparting-bypass`, `converging`) and any hinged double — a casement window, or a `sash: double` door. `entity` drives the leaf at the −x jamb, so `flipH` swaps which sensor draws which. Unset = both follow `entity`; ignored where there is only one leaf. |
| `invert`      | boolean                     | Flip the open/closed interpretation.                   |
| `activeColor` | string                      | Leaf/arc color while actively open (default primary). On a roll-up it colours the curtain and the track it leaves behind, so a fully raised shutter still reads as open. |
| `flipH`       | boolean                     | Mirror left↔right. Swing door: hinge jamb. Sliding: slide direction. |
| `flipV`       | boolean                     | Mirror across the wall so a swing opening faces the other room. |
| `showIcon`    | boolean                     | Draw this opening's **own** icon beside it (default `false`). Editor: **Show icon**. For the roll-up: raised, its curtain is gone and only the coloured track is left, which is easy to miss across a room. Tapping the badge opens the entity's dialog. It sits on the opposite face of the wall from the shutter's badge, so an opening with both never stacks them. |
| `icon`        | string                      | Override that icon. Absent, it is the entity's own — a **pair**, so the glyph itself says open or closed; an override is one glyph for both, and colour still reports the state. |
| `showShutterIcon` | boolean                 | Draw that icon (default `true` whenever both are bound). Editor: **Shutter icon**. Turning it off changes nothing about the gestures — for a plan where every window has a shutter and the icons start to shout. |
| `shutterIcon` | string                      | Override the icon's glyph. Left unset it follows the shutter entity, whose default comes in an open/closed pair; an override is one glyph for both states, and colour still reports the state. |
| `tapTarget`   | `opening` \| `shutter`      | With both entities bound, which one a tap acts on (default `opening`); the other moves to press-and-hold. Editor: **Tap opens**. Pointing it at the shutter opens the shutter's dialog — it does not drive the motor; set `tap_action: toggle` for that. |
| `tap_action`  | ActionConfig                | Standard Lovelace action, acting on whichever entity `tapTarget` leads with (or on `shutterEntity` when it is the only one bound). By default an open/close `cover` toggles and everything else opens more-info. An action's own `entity` picks which of the two it acts on. |
| `hold_action` / `double_tap_action` | ActionConfig | With both entities bound, hold opens the shutter's more-info by default — a tap is never retargeted at the shutter motor. Double-tap does nothing unless configured. |
| `sliderStyle` | `single` \| `bypass` \| `biparting` \| `biparting-bypass` \| `converging` | With `motion: slide`: one panel (default), two stacking, two centre-parting into the walls, two centre-parting over a fixed panel at each jamb, or two running together to stack in the middle. |
| `locked`      | boolean                     | Pinned in place in the editor: it still selects, edits and deletes, but never moves, and it yields the click to anything unlocked on top of it. The editor writes it; the rendered card ignores it. See [Locking elements in place](../README.md#locking-elements-in-place). |

## Item (device)

| Field         | Type                                   | Default      | Description                                            |
| ------------- | -------------------------------------- | ------------ | ------------------------------------------------------ |
| `id`          | string                                 | —            | Unique id.                                             |
| `entity`      | string                                 | —            | Entity to bind. Without one the device is a static badge. |
| `secondaryEntity` | string                             | —            | **Legacy** spelling of the first `readings` row. Still read — it goes at the head of the list — but it has no editor field, and editing a device's readings rewrites it. Use `readings`. |
| `attribute`   | string                                 | —            | Show this attribute instead of the state (e.g. `current_temperature`). |
| `secondaryAttribute` | string                          | —            | **Legacy**, as above: the attribute for that first row — from `secondaryEntity`, or from `entity` when none. |
| `stateColor`  | rule[]                                 | —            | Badge/label color rules, regardless of on/off; beats `activeColor`. Each is `{ above? , state?, color, icon? }` — an exact `state` beats a threshold, the highest matching `above` wins, neither is the default, and a matching `icon` beats the device's own. |
| `x`, `y`      | number                                 | —            | Position.                                              |
| `kind`        | light/switch/sensor/binary_sensor/climate/cover/media_player/fan/camera/lock/humidifier/vacuum/generic | inferred | Used for the default icon. |
| `icon`        | string                                 | entity icon  | Override mdi icon.                                     |
| `name`        | string                                 | friendly name| Label / tooltip override.                             |
| `size`        | number                                 | `34`         | Icon badge diameter (px).                              |
| `angle`       | number                                 | `0`          | Icon rotation (deg).                                   |
| `display`     | `badge` \| `ripple` \| `iconRipple`    | `badge`      | How the device is drawn. The editor spells this as the **Ripple** toggle (plus **Badge shows: Nothing** for `ripple`) and offers it only on devices that detect something where they sit (see [Presence ripples](../README.md#presence-ripples)); in YAML it works on any entity. |
| `iconAnimation` | `auto` \| `none` \| `spin` \| `pulse` | `auto`       | Animate the icon while active. `auto`: fan spins; media player / vacuum pulse. A `climate` entity animates only while its `hvac_action` says it is working — an AC holding `cool` at temperature keeps its colour but stops moving. The editor spells this as the icon options of **Badge shows**, showing `auto` as whatever it resolves to. |
| `activeColor` | string                                 | theme color  | Badge color while on. Ignored while `stateColor` rules match. |
| `rippleColor` | string                                 | `activeColor`| Ripple ring color, falling back to `activeColor` then the primary color. |
| `rippleSize`  | number                                 | `80`         | Max ripple diameter (px).                              |
| `rippleDirection` | number                             | `0`          | Direction the ripple arc is centred on, in degrees clockwise from the top. Only visible when `rippleWidth` is under `360`. Wraps to be between `0`–`360`. |
| `rippleWidth` | number                                 | `360`        | Angular width of the ripple arc in degrees. `360` rings all the way round; narrow it for a sensor on a wall that cannot see behind itself. Clamped to `0`–`360`. |
| `glow`        | boolean                                | `false`      | Cast a pool of light onto the plan (lights only). See [Cast light](#cast-light). |
| `glowRadius`  | number                                 | `140`        | Radius of the cast pool at full brightness, in canvas units. A dimmer lamp casts a proportionally smaller pool, down to half this. |
| `glowColor`   | string                                 | `#ffd9a0`    | Pool color for a bulb that can't report one; color-capable lights use their own. |
| `badgeContent` | `icon` \| `value` \| `none`           | `icon`       | What the badge holds. `value` draws the reading inside it, falling back to the icon when there is no number; `none` leaves the label alone. |
| `badgeEntity` | `primary` \| number                    | automatic    | Which reading a `value` badge shows: the device's own entity, or an index into `readings`. Unset picks the first with a number; set, only that one is read (an index past the end shows the icon). `secondary` is accepted as the legacy spelling of `0`. |
| `showIcon`    | boolean                                | `true`       | **Deprecated** — use `badgeContent`. Honoured only when it is unset (`false` = `none`). |
| `hideWhenInactive` | boolean                           | `false`      | Hide on the card while the entity is inactive. Always shown, dimmed, in the editor. |
| `showState`   | boolean                                | sensors only | Show the entity state in the label line. Governs this device's **own** state only — `readings` show regardless. |
| `showName`    | boolean                                | `false`      | Show the device's name in the label line (`Name · state` when combined). |
| `readings`    | `{ entity?, attribute?, showState? }[]` | —           | Everything this device reads beyond its own state — a sensor's humidity and pressure, a plug's power, link quality and battery. These print whatever the **device's** `showState` says, since that one is about the device's own entity. To hide one of *these*, set its **own** `showState: false`, which keeps it bound (the badge can still read it) without printing it. See [More readings per device](configuration.md#more-readings-per-device). |
| `labelPosition` | `below` \| `left` \| `right`         | `below`      | Where the label sits relative to the badge. |
| `labelSize`   | number                                 | `12`         | Label line font size (px).                             |
| `tap_action`  | ActionConfig                           | per domain   | Standard Lovelace action. By default `light`, `switch`, `fan` and `input_boolean` toggle and everything else — covers included — opens more-info. |
| `hold_action` / `double_tap_action` | ActionConfig         | —            | Optional extra gestures.                               |
| `locked`      | boolean                                | `false`      | Pinned in place in the editor: it still selects, edits and deletes, but never moves, and it yields the click to anything unlocked on top of it. The editor writes it; the rendered card ignores it. See [Locking elements in place](../README.md#locking-elements-in-place). |
| `hide*` / `hideBadge*` / `hideState*` | — | — | Twenty-four keys that hide the device, its badge or its label from a second entity's state. Documented in full under [Advanced Hiding Logic](behavior.md#advanced-hiding-logic); the editor groups them under **Visibility**. |

### Cast light

Set `glow: true` on a light and it pools its own color and brightness onto the plan,
centered where the device sits — not across the whole room. Several lights in one room
each cast their own pool, and overlapping pools **mix additively**: a warm lamp and a cool
one blend to a neutral tone between them, the way they would in the room.

```yaml
items:
  - id: lamp_warm
    entity: light.living_standing_lamp
    kind: light
    x: 400
    y: 300
    glow: true
    glowRadius: 200
```

It degrades in rungs, so every light does something sensible:

| The light | The pool |
| --- | --- |
| Reports a color (`rgb`, `xy`, or even `color_temp`) | Its own color, strength from `brightness` |
| Brightness only | `glowColor` (warm white), strength from `brightness` |
| On/off only | `glowColor`, at full strength |
| Off, `unavailable` or `unknown` | Casts nothing |

Brightness maps into a **0.18–0.6** opacity band, not 0–1, so a lamp dimmed to 10% stays
visible. It also sets how *far* the light reaches: `glowRadius` is the size at full
brightness, and the pool draws in to no less than half that as the lamp dims, the way it
does in a room. A bulb reporting no brightness always casts the full radius, and the
editor's dashed guide shows the configured size rather than the current one.

`glow` is independent of the icon — pair it with `badgeContent: none` for light without a
badge, or `hideWhenInactive` to drop both when the light is off.

**Walls block the light, and open doors don't.** A pool is clipped to what the lamp can
actually see, so it stops at its room's walls and fans out through anything open the way
real light does — an irregular shape rather than a clean circle. A lamp with no wall inside
its radius stays circular.

Light agrees with the picture: it passes exactly where the plan draws a hole. A shut door
blocks it, a door on a contact sensor lets it through the moment it opens, and a door you
never bound — which this card draws open, with its swing arc — lights the room beyond it
with nothing to configure. Windows behave the same way, so an open one spills light
outside. A cover reporting a partial position opens a proportional gap, and at night the
clearing a lit room holds against the dark reaches through the same doorways its pool does.

An opening with two leaves counts **both** of them, so one with a sensor on each opens a
gap when either one does. How wide follows what the symbol actually draws: `biparting`
sends its leaves into the walls and can clear the whole opening, as does a hinged double
— each sash swings clear of its own half — while `biparting-bypass` and `converging` keep
theirs inside the frame and so clear at most half of it however wide open they are.

Pools are drawn above room fills but below furniture and walls, so light reads as cast onto
the floor. Furniture under a lit lamp picks up about half the cast, enough to read as lit
without turning into the color of the light. Pools never intercept clicks.

## Text

`{ id, x, y, text, entity?, attribute?, size?, color?, angle?, locked? }` — `size` px (default 16),
`color` CSS/hex, `angle` degrees.

Bind an **`entity`** and the label shows its current value (issue #225) — a power reading
in the corner of the plan, a temperature over a room:

```yaml
texts:
  # The reading on its own.
  - { id: pv, x: 300, y: 80, text: "", entity: sensor.pv_output, size: 28 }
  # Words in front of it: "Grid 0.4 kW".
  - { id: grid, x: 300, y: 130, text: Grid, entity: sensor.grid_power }
  # An attribute rather than the state: "Hall 21.5".
  - { id: hall, x: 300, y: 180, text: Hall, entity: climate.hall, attribute: current_temperature }
```

`text` becomes a **prefix** when an entity is bound, and the value stands alone when you
leave it empty. Values are formatted the way Home Assistant formats them anywhere else,
units and display precision included — so rounding a reading is that entity's own
**display precision** setting rather than anything to configure here. An entity that isn't
there reads `—`, the same as a device's label.

## Furniture

`{ id, type, x, y, w, h, angle?, hand?, color?, entity?, activeColor?, stateColor?, goToFloor?, locked? }`

`type` names a **symbol** — one of the ~26 the card ships with (`table`, `sofa`, `bed`,
`fridge`, `stairs`, …; the full set is [`furniture/`](../furniture), a file each), or one you
supply yourself. `color` defaults to gray so furniture reads differently from walls; `hand`
(`left` / `right`) mirrors the symbol, and picks which end an L-shaped `sectional`'s chaise
sits on. A `type` nothing answers to draws a plain box, so a missing symbol is a visible
placeholder rather than a hole in the plan.

The editor's **+ Add** picker draws every symbol at its real size and is searchable — type
`couch` and you get the sofa and the sectional.

Bind an **entity** and `stateColor` / `activeColor` recolor the whole diagram — a plant
goes red when its soil sensor says it needs watering, a cabinet highlights while its
contact sensor is open.

**`goToFloor`** (`up` / `down`) makes clicking the piece change floor — written for the
`stairs` symbol. See [Stairs that change floor](behavior.md#stairs-that-change-floor).

```yaml
{ id: plant1, type: plant, x: 300, y: 220, w: 40, h: 40,
  entity: sensor.ficus_soil_moisture,
  stateColor: [ { above: 80, color: green }, { above: 65, color: yellow }, { color: red } ] }
```

### Drawing your own

The library will never have every piece of furniture — someone always has a wardrobe with
seven doors. So a symbol is **data**, not code: a list of primitives with numeric attributes
only, which the card assembles into SVG itself. Nothing you paste is ever parsed as markup.

Define one in a top-level `symbols:` block and use it like any other type:

```yaml
symbols:
  wardrobe7:
    name: wardrobe (7 doors)
    category: bedroom
    keywords: [closet, fitted]
    size: { w: 420, h: 55 }
    parts:
      - { rect: [0, 0, 100, 100], rx: 7.3 }
      - { repeat: 6, step: [14.29, 0], part: { line: [14.29, 0, 14.29, 100], role: line } }
      - { repeat: 7, step: [14.29, 0], part: { line: [11.4, 40, 11.4, 60], role: line } }

furniture:
  - { id: w1, type: wardrobe7, x: 300, y: 90, w: 420, h: 55 }
```

You don't have to hand-write it: **Project → Symbols** in the editor takes pasted JSON,
validates it, and drops it into `symbols:` — it then shows up in the picker beside the
built-ins. If it turns out to be generally useful, the same JSON is what you contribute to
[`furniture/`](../furniture). The full format is in
[`furniture/README.md`](../furniture/README.md).

## Tracker

A live (x, y) position estimate driven by one or two orthogonal distance sensors,
animated inside a rectangular tracked area:

```yaml
{ id, x, y, w, h, angle?, color?, dotSize?, locked?,
  xSensor?: { entity, min, max, invert?, presence?: { entity, invert? } },
  ySensor?: { entity, min, max, invert?, presence?: { entity, invert? } } }
```

- `x`, `y`, `w`, `h` — the rectangle in canvas units (top-left + size).
- `xSensor` / `ySensor` — each optional and independent. The card linearly maps
  `[min, max]` onto the rectangle's edges along that axis; `invert` flips the mapping.
- `presence` — a binary gate per axis; if either reports clear (or `unavailable` /
  `unknown`) the marker hides. `invert` flips on/off, never the unavailable case.
- Both sensors → a pulsating triangle with ripple rings. One → a faint pulsating line
  across the unknown axis. The rectangle is editor-only.

## Area

`{ id, points, name?, showName?, labelSize?, color?, opacity?, haArea?, filterEntities?, entity?, stateColor?, activeColor?, activeOpacity?, borderColor?, borderWidth?, highlight?, zoom?, tap_action?, hold_action?, double_tap_action?, locked? }`

- `points` — `{ x, y }` vertices in drawing order, implicitly closed last-to-first.
- `name` / `showName` — label centered on the polygon (`showName` defaults `true`).
  Mirrors the linked HA area's name when `haArea` is set.
- `labelSize` — that label's size, `8`–`40`, default `14`. Px under `overlayScale: fixed`,
  which is what a plan renders as unless it says otherwise; canvas units under `plan`,
  which is what a new plan is created with. Small rooms want a smaller number than the big
  ones beside them. Left unset on a `fixed` card the size stays in the stylesheet, so a
  card-mod rule on `.area-label` still wins; set it, or switch to `plan`, and it moves
  inline and takes over.
- `color` / `opacity` — the room's fill; theme primary and `0.25` by default.
- `haArea` — id of a linked Home Assistant area, set by the editor when `name` matches one.
- `filterEntities` — with `haArea` set, scopes the entity picker for devices inside this
  polygon to that HA area's entities. Default `true`.
- `entity` — makes the room live, driving `stateColor` and `activeColor` the same way
  furniture does. Unbound areas stay static polygons.
- `stateColor` — threshold/state rules (same shape as a device's), beating `activeColor`
  and `color`. `activeColor` is the fill while `entity` is active and no rule matches.
- `activeOpacity` — fill opacity while a color resolves, so a room can lift out of the
  plan while live without being permanently darker. Falls back to `opacity`.
- `borderColor` / `borderWidth` — a static outline, off by default (`borderWidth` `3`).
- `highlight` — where a live color paints: `fill` (default), `border` or `both`. `border`
  suits a busy plan: the room outlines itself without tinting everything inside.

  The outline is drawn **on top of the walls it traces**, with doorways and windows cut
  out of it as they are of the wall, and clipped to its own room — a shared wall splits
  down the middle, an exterior wall colors on its inside face only. `borderWidth` is the
  width seen on the room's own side and defaults to `4` here; widen it and the band runs
  past the wall onto the floor.
- `zoom` — how close a tap goes, `1`–`10`. Unset, the room is fitted to the card (capped
  at `4`), which is what tapping a room has always done. Set it when the fit is not the
  picture you want: a small room fits at a scale that fills the card with one cupboard, and
  a long thin one binds on its long axis and barely zooms at all. The room stays centred
  either way — this sets how close, not where. A value below `1` becomes `1`; zooming out
  past the whole plan is what the zoom-out button does. In the editor, turn
  **Fit the room to the card** off and the **Zoom level** slider appears.
- `tap_action` / `hold_action` / `double_tap_action` — standard Lovelace actions on the
  room itself. **Tap already does something** — it zooms the plan to the room — so setting
  `tap_action` *replaces* that zoom; leaving it unset keeps it. Put the action on hold or
  double-tap to have both. An action's `entity` falls back to the area's own, so a room
  bound to a presence sensor needs no second mention of it. `tap_action: { action: none }`
  turns the zoom off without adding anything.

```yaml
areas:
  # A plain room, linked to an HA area.
  - id: living_room
    name: Living Room
    haArea: living_room
    color: "#26c6da"
    opacity: 0.15
    points: [{ x: 100, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 500 }, { x: 100, y: 500 }]

  # Lights up green while occupied, lifting to a stronger fill.
  - id: kitchen
    name: Kitchen
    entity: binary_sensor.kitchen_occupancy
    activeColor: "#4caf50"
    opacity: 0.12
    activeOpacity: 0.35
    points: [{ x: 100, y: 500 }, { x: 500, y: 500 }, { x: 500, y: 900 }, { x: 100, y: 900 }]

  # Outline only: the hall's own walls turn green, its fill never changes.
  - id: hall
    name: Hall
    entity: binary_sensor.hall_occupancy
    activeColor: "#4caf50"
    highlight: border
    points: [{ x: 500, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 500 }, { x: 500, y: 500 }]

  # Thresholded: the whole room reddens as air quality drops.
  - id: study
    name: Study
    entity: sensor.study_co2
    stateColor:
      - { above: 1200, color: "#e1243b" }
      - { above: 800, color: "#ff9300" }
      - { color: "#58d32f" }
    points: [{ x: 500, y: 500 }, { x: 900, y: 500 }, { x: 900, y: 900 }, { x: 500, y: 900 }]
```

## Example

```yaml
type: custom:easy-floorplan-card
title: Living Room
width: 1000
height: 600
grid: 20
background: "#fafafa"
walls:
  - { id: w1, x1: 100, y1: 100, x2: 900, y2: 100 }
  - { id: w2, x1: 900, y1: 100, x2: 900, y2: 500 }
  - { id: w3, x1: 900, y1: 500, x2: 100, y2: 500 }
  - { id: w4, x1: 100, y1: 500, x2: 100, y2: 100 }
openings:
  # Swings open when the contact opens.
  - { id: d1, type: door, x: 300, y: 500, length: 80, angle: 0,
      entity: binary_sensor.front_door, activeColor: "#ef5350" }
  - { id: win1, type: window, x: 600, y: 100, length: 140, angle: 0 }
items:
  - { id: i1, entity: light.living_room, x: 240, y: 200, kind: light, glow: true }
  - { id: i2, entity: binary_sensor.presence, x: 380, y: 380, kind: binary_sensor,
      display: iconRipple, rippleColor: "#26c6da", rippleSize: 120 }
  - { id: i3, entity: sensor.living_room_temperature,
      secondaryEntity: sensor.living_room_humidity,
      x: 700, y: 380, kind: sensor, showState: true }
furniture:
  - { id: f1, type: sofa, x: 250, y: 420, w: 170, h: 72, angle: 0 }
texts:
  - { id: t1, x: 500, y: 60, text: Living Room, size: 22 }
areas:
  - id: a1
    name: Living Room
    haArea: living_room
    color: "#26c6da"
    opacity: 0.15
    points: [{ x: 100, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 500 }, { x: 100, y: 500 }]
trackers:
  - id: pet
    x: 120
    y: 130
    w: 760
    h: 350
    color: "#26c6da"
    # `presence` hides the marker when the room is empty.
    xSensor:
      { entity: sensor.radar_x_distance, min: 0, max: 7.6,
        presence: { entity: binary_sensor.living_room_presence } }
    ySensor:
      { entity: sensor.radar_y_distance, min: 0, max: 3.5,
        presence: { entity: binary_sensor.living_room_presence } }
```

## More readings per device

One device, as many readings as it has. A sensor that reports temperature,
humidity and pressure needs one badge, not three:

```yaml
items:
  - id: study
    entity: sensor.study_temperature
    kind: sensor
    showName: true
    showState: true
    readings:
      - { entity: sensor.study_humidity }
      - { entity: sensor.study_pressure }
```

→ `Study · 21.5 °C · 48% · 1013 hPa`, on one line, in the order written.

Each row is `{ entity?, attribute?, showState? }`. `entity` and `attribute` say where the
number comes from:

| `entity` | `attribute` | reads |
| --- | --- | --- |
| set | — | that entity's state |
| set | set | that attribute of that entity |
| — | set | that attribute of **this device's own** entity |
| — | — | nothing — a blank row draws no text |

The third row is what lets one climate entity show four of its own attributes without
naming itself four times. The fourth is why the editor's **+ Add entity** can hand you an
empty row without a `—` appearing on the plan.

### Bound, but not printed

`showState: false` on a row keeps the entity bound to the device without putting its value
in the label:

```yaml
  - id: desk_plug
    entity: switch.desk_plug
    kind: switch
    badgeContent: value
    badgeEntity: 0             # the badge shows the power
    readings:
      - { entity: sensor.desk_plug_power, showState: false }
```

The badge reads `1.2 kW` in its circle and the label does not repeat it. The card still
watches the entity, so the badge stays live.

**Hiding a row does not renumber the others.** `badgeEntity` indexes the whole list,
visible or not, so switching a row off cannot silently repoint the badge at a different
entity. A device whose every extra row is hidden draws no label at all, and the editor
stops offering the label's size and position for it.

### Readings ignore the device's "Show state"

That is the point of them. A smart plug already says on/off through its badge colour, so
its label should carry the *other* numbers and not the word "on":

```yaml
  - id: desk_plug
    entity: switch.desk_plug
    kind: switch
    showName: true
    showState: false          # the badge colour already says on/off
    readings:
      - { entity: sensor.desk_plug_power }
      - { entity: sensor.desk_plug_lqi }
      - { attribute: battery }
```

→ `Desk plug · 1.2 kW · 84 · 84`. The device's `showState` is about its **own** entity;
the readings are their own statement, and each carries its own `showState` for the times
you want one bound but not printed (above).

### One list, not two mechanisms

There used to be a `secondaryEntity` / `secondaryAttribute` pair — one extra reading, with
its own pair of dropdowns and its own rule about when it showed. It is now simply the
**first row of `readings`**: still read, so no existing plan breaks, but with no field of
its own in the editor, and rewritten into `readings` the first time you touch a device's
readings. The order on the label is `entity`, then that legacy row, then the rest.

The badge follows the same list. **Badge reads** offers one option per reading rather than
just "the second one", so a plug reporting power, link quality and battery can badge
whichever it likes:

```yaml
    badgeContent: value
    badgeEntity: 1            # index into readings; "primary" is the device itself
```

`badgeEntity: secondary` still works and means index `0`.

> **Upgrading?** One behaviour changed with the merge. `secondaryEntity` used to be part of
> the state line, so it only showed while **Show state** was on — which is off by default
> for anything that isn't a `sensor`. As a reading it now shows on its own terms. If you
> have a light or a switch with a second entity and Show state off, a reading will appear
> under it that wasn't there before; delete that row, or leave it — it is the number you
> pointed the device at. Sensors, which show state by default, are unaffected.

In the editor these sit **directly under the entity** as **Other entities**, added one at a
time with **+ Add entity** rather than by putting four entity dropdowns on every device
that will never use them. Each row's attribute box is HA's own attribute picker, listing
what that entity actually has.

Every element's panel is grouped under headings, on the same criteria: what it **is**
first, then what it **reads**, then how it **looks**, then what it **does**. Groups with
nothing to offer are left out — a sensor gets no Effects group, a device that draws no
label gets no Label group, and an opening with no shutter gets no Shutter group.

| Element | Groups |
| --- | --- |
| Device | Identity · What it reads · Label · Badge · Color · Effects · Behaviour · Visibility |
| Door / window | Shape · What it reads · Sunlight · Shutter · Badge · Color · Behavior |
| Furniture | Shape · What it reads · Behavior · Color |
| Area | Identity · What it reads · Color · Behavior · Home Assistant area |
| Tracker | Zone · Sensors · Marker |
| Project | Project · Look · Floor image · Display · Sunlight · Night dimming · Devices · Symbols |

Walls and text keep a plain list: a wall is thickness and length, a text is its words, size
and angle. A heading over one or two fields is chrome rather than structure.
