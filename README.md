# Easy Floorplan

[![hacs][hacs-badge]][hacs-url]
[![release][release-badge]][release-url]
[![license][license-badge]](LICENSE)

A Home Assistant Lovelace card for building an interactive floorplan — **with a visual
drag-and-drop editor**. Draw walls, drop doors and windows, add furniture and labels, and
place your entities as icons, ripples or live state. Everything scales to the card and
screen size.

<img width="1080" height="608" alt="demo" src="https://github.com/user-attachments/assets/98abaddc-b713-492f-be85-ca5f778f3779" />

## Features

- **Visual editor** — draw walls, drop doors and windows that snap onto them, drag, nudge
  with arrow keys, multi-select, copy/paste, undo/redo, zoom.
- **Devices** — bind any entity to an icon: tap to toggle, live state or attribute label,
  custom icon, size, rotation.
- **Presence ripples** — presence sensors drawn as animated rings instead of a static icon.
- **Cast light** — a light pools its own color and brightness onto the plan; overlapping
  pools mix, so a warm lamp and a cool one blend between them.
- **Animated doors & windows** — bind a contact `binary_sensor` or `cover` and openings
  swing, slide or roll with their real state, partial positions included.
- **Furniture** — 25+ gray line-art diagrams (table, sofa, bed, stove, stairs, tv…), each
  bindable to an entity.
- **Areas** — trace room polygons that color live from an entity, and link them to Home
  Assistant areas to scope entity pickers and bulk-add devices.
- **Live position trackers** — map one or two distance sensors (mmWave / radar) onto a
  marker that moves across the plan in real time.
- **Follow the sun** — dim the plan through dusk and brighten it through dawn, from your
  HA instance's sun elevation. Lit rooms stay bright.
- **Multiple floors** — per-floor elements with a switcher in both the editor and the card.
- **Background image** — trace over a floor-plan scan, per floor, with adjustable opacity.
- **Text labels**, canvas background color, and grid / custom / off snapping.
- **Auto-scaling** — SVG over a virtual coordinate space, so the plan fits any card size.

## What you can end up with

<img width="1550" height="761" alt="Screenshot 2026-08-05 at 2 54 49 PM" src="https://github.com/user-attachments/assets/7130f94f-f591-486b-bf9d-ecf137b653a9" />


## Installation

### HACS (recommended)

Distributed as a **custom repository**. Add it in one click:

[![Open Easy Floorplan in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=nicosandller&repository=easy-floorplan&category=frontend)

…or add it manually:

1. In Home Assistant, open **HACS**.
2. Top-right **⋮ → Custom repositories**.
3. Add repository URL `https://github.com/nicosandller/easy-floorplan` with category
   **Dashboard** (a.k.a. Plugin).
4. Find **Easy Floorplan** in HACS and click **Download**.
5. Hard-refresh your browser (Cmd/Ctrl-Shift-R).

HACS adds the dashboard resource automatically.

### Manual

1. Download `easy-floorplan-card.js` from the [latest release][release-url].
2. Copy it to `<config>/www/easy-floorplan-card.js`.
3. Add it as a dashboard resource (**Settings → Dashboards → ⋮ → Resources → Add**):
   - URL `/local/easy-floorplan-card.js`
   - Type **JavaScript module**
4. Hard-refresh your browser.

## Elements

Everything you place on the plan is an **element**: **devices**, **doors & windows**,
**furniture**, **text**, **areas** and **trackers**. Select, move, nudge, copy/paste,
duplicate and delete them; each floor holds its own set.

### Devices

A **device** binds a Home Assistant entity to a spot on the plan. Add one with **+ Add**,
then pick the entity in the **Element** section below the canvas.

- **Tap to act** — lights, switches, fans and `input_boolean`s toggle on tap; everything
  else opens the more-info dialog. Covers do too, so an accidental tap can't move a
  shutter — set **Tap action** to *Toggle* to opt back in.
- **Label line** — **Show state** displays the live value (sensors do by default),
  formatted as HA would, display precision included; **Show name** adds the name, and
  both read `Name · state`. **Label size** sets the font size.
- **Two readings in one** — add a **Second entity** to render e.g. `21.5 °C · 45%`. Or set
  **Attribute** / **2nd attribute** to read attributes instead of states, so a single
  climate entity shows its temperature and humidity.
- **Badge shows** — *Icon* (default), *Value*, or *Nothing* (label only). **Value** draws
  the reading inside the badge — a thermostat reads `21°` in the circle your state rules
  already paint red — picking it per domain, dropping long units, and falling back to the
  icon when there is no number.
- **Make it yours** — override the **icon** (autocomplete + live preview), the **name**,
  **size** and rotation. Without an override the icon follows the entity's **device
  class** (HA's *show as*), so a lock renders `mdi:lock` / `mdi:lock-open`.
- **Active color** — the badge color while the entity is on, so lights, covers and
  switches are told apart at a glance. A bulb reporting an `rgb_color` wears its own
  instead, darkening as it dims. Full order: **state rules → Active color → the bulb's
  color → the theme**. The glyph flips black or white to stay readable on whatever the
  badge ended up painted.
- **Color & icon by state** — rules restyle the badge, label and icon from the entity's
  reading, whether or not it is "on" (a temperature sensor never is):

  ```yaml
  stateColor:
    - { state: open, color: "#4caf50", icon: mdi:blinds-open }
    - { above: 26, color: red }
    - { color: white }   # default
  ```

  An exact `state` beats a threshold, the highest matching `above` wins, and a rule with
  neither is the default. `icon` is optional and beats the device's own icon override
  while it matches. Rules beat **Active color**, which the editor hides once they exist.
- **Only when active** — hide the device on the card while its entity is off, idle or
  unavailable, so a busy room only shows what's doing something. The editor still draws
  it, faded with a dashed badge.
- **No entity? Still on the map** — an unbound device renders as a plain static badge, so
  hardware HA doesn't know about (a dumb smoke detector, a wired doorbell) can still be
  marked. It never highlights and tapping does nothing.

### Animations

Bind an entity and the element stops being a drawing: openings move with their real
state, rooms and furniture recolor, markers glide, icons spin.

#### Doors & windows

Drop a **door** or **window** from the toolbar and it snaps onto the nearest wall. Left
unbound it stays a static drawing. Bind an **Entity** — a contact `binary_sensor` or a
`cover` — and the opening tracks its real state. The card reads the entity's HA
`device_class` and picks a sensible `type` / `motion` for you (a `window` cover → a
window, a `blind` → a slider, a `garage` or `shutter` → a roll-up); adjust afterwards.

- **Open / closed** — open when the entity is `on` / `open`. A door's leaf swings around
  its hinge, a window's two leaves outward from the middle — or set **Sashes** to *Single*
  for one sash. The swing arc draws on as the leaf travels.
- **Partial** — a `cover` reporting `current_position` (0–100) is drawn partly open and
  tracks the position live. Everything else uses the on/off behavior above.
- **Motion** — **swing** (default), **slide**, or **roll** (a slatted curtain that thins
  onto its track). Sliding openings take a **Style**: *single* (one panel into the wall),
  *bypass* (two panels on parallel tracks), or *biparting* (two panels parting at the
  middle). **Slide** sets the direction.
- **Orientation** — **Hinge** (left / right) and **Opens** (this side / other side) face a
  swing door any of four ways; they're pure mirrors (`flipH` / `flipV`), so the animation
  follows.
- **External shutters** — bind a second `cover` or contact as **Shutter** and it shares
  the wall gap with the opening, rendering independently — so an open window behind a
  closed shutter shows both. **Shutter type** picks *Hinged* (louvered panels folding back
  against the façade) or *Roll-up*, defaulting from the entity.
- **Active color** — the leaf, sash and arc take an accent color while open. Defaults to
  the primary color.
- **Invert** — flip the open/closed interpretation (and the percentage) for sensors wired
  the other way.
- **Tap to control** — a controllable `cover` toggles (`cover.toggle`); read-only sensors
  and position-only covers open the more-info dialog.

```yaml
openings:
  # sliding window, patio-door style, driven by a cover
  - { id: patio, type: window, motion: slide, sliderStyle: biparting, x: 640, y: 500, length: 160, angle: 0, entity: cover.patio_door }
  # a swing door hinged on the right, opening into the other room
  - { id: hall, type: door, x: 300, y: 100, length: 80, angle: 0, flipH: true, flipV: true }
```

<img width="540" height="304" alt="door_window_demo" src="https://github.com/user-attachments/assets/091b3c89-5202-4025-8a0f-0fe867276be2" />

#### Areas

An **area** is a colored, named room polygon traced on top of your walls.

Pick the **Area** tool and click each corner — points snap onto nearby wall corners and
onto other areas' corners, so adjoining rooms share an exact boundary. After 3+ points,
click the **first** point to close the shape (**Backspace** drops the last point,
**Escape** discards the outline). Drag inside the fill to move the room, or a corner
handle to reshape it.

Selected, an area offers **Name** / **Show name**, a **color** and **Fill opacity**, and —
once it's live — the same conditional coloring devices get: **Entity**, **Active color**,
**Active opacity**, **Highlight** (tint the fill, or light up the room's own walls) and
**Color by state** rules. See [Area](#area) for the full set.

**Linking a Home Assistant area.** The name field autocompletes against your HA areas, and
naming a room after one links the two (a **Linked** badge appears; the **×** unlinks while
keeping the name). A link unlocks two things:

- **Filter entities** (on by default) — any device dropped inside the polygon has its
  entity picker narrowed to that HA area's entities. The room is highlighted on the canvas
  with a **Show all** link, so it's obvious why the list is short. Drag the device out, or
  untick this, and the picker widens again.
- **Add all devices in this HA area** — one click drops a device for every entity in the
  HA area not already on this floor, spread across the room rather than stacked. Click it
  again later to top up.

Overlapping areas resolve by draw order: the last one drawn wins both the fill on top and
which room a device counts as inside.

#### Live position trackers

A **tracker** turns one or two distance sensors into a live marker that moves across the
plan in real time — typically a pair of mmWave / radar / LIDAR sensors aimed along
orthogonal axes, together pinning down an `(x, y)`.

Pick the **Tracker** tool, drag a rectangle over the area to track, then set per axis:

- **X sensor** / **Y sensor** — the distance entity, plus the `min` and `max` readings (in
  the sensor's own units) that correspond to the rectangle's two edges on that axis.
- **Invert** — map a higher reading to the near edge instead of the far one, rather than
  swapping `min` and `max`.
- **Presence** — an optional binary gate, usually the occupancy sibling on the same radar.
  If either axis reports clear, unavailable or unknown, the marker hides — so a stale
  distance reading can't leave a dot pulsing in an empty room.

With both sensors set, a pulsating triangle glides to the resolved point, emitting ripple
rings; readings outside `[min, max]` clamp to the rectangle's edge. With one, a faint
pulsating line spans the unknown axis — honest about knowing only one coordinate. With
neither reporting, nothing renders.

The rectangle itself is editor-only; the card shows just the marker. **Color** and **dot
size** are per tracker.

#### Presence ripples

Switch a device's **Display** from *Icon badge* to **Ripple** or **Icon + ripple** and it
draws animated concentric rings: they pulse outward and fade while the entity is on, and
collapse to a faint dot when it's off — the spot stays marked without pulling the eye.

**Ripple color** and **ripple size** are per device (the color follows **Active color**
and state rules unless you set one). Works with any on/off-like entity, not just presence
sensors.

<img width="540" height="304" alt="ripple_demo_gif" src="https://github.com/user-attachments/assets/e43949cf-13a2-48f8-804d-73738299475f" />

#### Fans

A running fan's icon spins, and an active media player or vacuum pulses — the same
defaults Home Assistant's own Tile card uses. **Animate icon** per device forces `spin` or
`pulse` on any entity, or `none` to stop it.

An icon only animates while its entity is genuinely active, so a forced `spin` on an
unavailable fan stays still — a spinning icon is a claim that the thing is running.
Respects the OS *reduced motion* preference.

## Configuration reference

The editor writes this config for you; manual editing is optional.

### Top level

| Option       | Type     | Default            | Description                                  |
| ------------ | -------- | ------------------ | -------------------------------------------- |
| `type`       | string   | —                  | `custom:easy-floorplan-card`                 |
| `title`      | string   | —                  | Optional card header.                        |
| `width`      | number   | `1000`             | Virtual canvas width, in canvas units.       |
| `height`     | number   | `600`              | Virtual canvas height, in canvas units.      |
| `grid`       | number   | `20`               | Gap between grid lines, in canvas units — smaller means finer. |
| `snap`       | number   | follows `grid`     | Snap step in canvas units, always absolute. Omit to follow the grid, `0` for free placement. The editor shows a custom step as a percentage of the grid. |
| `rotation`   | number   | `0`                | Rotate the card `90`, `180` or `270`° — a landscape plan on a portrait wall tablet. Icons and labels stay upright; the editor always shows the plan as drawn. |
| `sunDimming` | boolean | `false` | Dim through dusk, brighten through dawn, from the HA instance's sun. See [Follow the sun](#follow-the-sun). |
| `sunBrightnessMin` | number | `0.45` | Brightness once the sun is fully down, 0–1. |
| `sunBrightnessMax` | number | `1` | Brightness in full daylight, 0–1. |
| `background` | string   | card background    | Canvas background color (CSS / hex).         |
| `floors`     | Floor[]  | —                  | Per-floor element groups (see [Floor](#floor)).   |
| `defaultFloor`| string  | first floor        | Id of the floor shown first.                 |
| `walls`      | Wall[]   | `[]`               | Wall segments (single-floor / floor 1).      |
| `openings`   | Opening[]| `[]`               | Doors and windows (swing or sliding).        |
| `items`      | Item[]   | `[]`               | Entity devices.                              |
| `texts`      | Text[]   | `[]`               | Free text labels.                            |
| `furniture`  | Furniture[]| `[]`             | Gray furniture/fixture diagrams.             |
| `trackers`   | Tracker[]| `[]`               | Live position trackers (see [Tracker](#tracker)).    |
| `areas`      | Area[]   | `[]`               | Named room polygons (see [Area](#area)).          |

When `floors` is present each floor carries its own `walls`, `openings`, `items`, `texts`,
`furniture`, `trackers` and `areas`. The top-level arrays describe a single implicit floor
and remain valid for backward compatibility.

### Floor

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

### Wall

`{ id, x1, y1, x2, y2 }` — endpoints in virtual units.

### Opening (door / window)

| Field         | Type                        | Description                                            |
| ------------- | --------------------------- | ------------------------------------------------------ |
| `id`          | string                      | Unique id.                                             |
| `type`        | `door` \| `window`          | The kind of opening.                                   |
| `motion`      | `swing` \| `slide` \| `roll` | How it moves: hinged (default), sliding panels, or a roll-up curtain (garage / roller shutter). |
| `sash`        | `single` \| `double`        | Swing windows only: one full-width sash, or the classic two. Default `double`. |
| `shutterEntity` | string                     | An external shutter over the same gap (`cover` or contact), with its own open/closed state. |
| `shutterStyle` | `swing` \| `roll`           | Louvered panels or a roll-up curtain. Defaults from the entity (contact → `swing`, `cover` → `roll`). |
| `x`, `y`      | number                      | Center position.                                       |
| `length`      | number                      | Length along the wall.                                 |
| `angle`       | number                      | Rotation in degrees.                                   |
| `entity`      | string                      | Contact `binary_sensor` / `cover` driving open/closed (or `current_position` for partial). |
| `invert`      | boolean                     | Flip the open/closed interpretation.                   |
| `activeColor` | string                      | Leaf/arc color while actively open (default primary).  |
| `flipH`       | boolean                     | Mirror left↔right. Swing door: hinge jamb. Sliding: slide direction. |
| `flipV`       | boolean                     | Mirror across the wall so a swing opening faces the other room. |
| `sliderStyle` | `single` \| `bypass` \| `biparting` | With `motion: slide`: one panel (default), two stacking, or two centre-parting. |

### Item (device)

| Field         | Type                                   | Default      | Description                                            |
| ------------- | -------------------------------------- | ------------ | ------------------------------------------------------ |
| `id`          | string                                 | —            | Unique id.                                             |
| `entity`      | string                                 | —            | Entity to bind. Without one the device is a static badge. |
| `secondaryEntity` | string                             | —            | Second entity shown alongside (e.g. humidity).         |
| `attribute`   | string                                 | —            | Show this attribute instead of the state (e.g. `current_temperature`). |
| `secondaryAttribute` | string                          | —            | Attribute for the 2nd reading — from `secondaryEntity`, or from `entity` when none. |
| `stateColor`  | rule[]                                 | —            | Badge/label color rules, regardless of on/off; beats `activeColor`. Each is `{ above? , state?, color, icon? }` — an exact `state` beats a threshold, the highest matching `above` wins, neither is the default, and a matching `icon` beats the device's own. |
| `x`, `y`      | number                                 | —            | Position.                                              |
| `kind`        | light/switch/sensor/binary_sensor/climate/cover/media_player/fan/camera/lock/humidifier/vacuum/generic | inferred | Used for the default icon. |
| `icon`        | string                                 | entity icon  | Override mdi icon.                                     |
| `name`        | string                                 | friendly name| Label / tooltip override.                             |
| `size`        | number                                 | `34`         | Icon badge diameter (px).                              |
| `angle`       | number                                 | `0`          | Icon rotation (deg).                                   |
| `display`     | `badge` \| `ripple` \| `iconRipple`    | `badge`      | How the device is drawn.                               |
| `iconAnimation` | `auto` \| `none` \| `spin` \| `pulse` | `auto`       | Animate the icon while active. `auto`: fan spins; media player / vacuum pulse. |
| `activeColor` | string                                 | theme color  | Badge color while on. Ignored while `stateColor` rules match. |
| `rippleColor` | string                                 | `activeColor`| Ripple ring color, falling back to `activeColor` then the primary color. |
| `rippleSize`  | number                                 | `80`         | Max ripple diameter (px).                              |
| `glow`        | boolean                                | `false`      | Cast a pool of light onto the plan (lights only). See [Cast light](#cast-light). |
| `glowRadius`  | number                                 | `140`        | Radius of the cast pool, in canvas units.              |
| `glowColor`   | string                                 | `#ffd9a0`    | Pool color for a bulb that can't report one; color-capable lights use their own. |
| `badgeContent` | `icon` \| `value` \| `none`           | `icon`       | What the badge holds. `value` draws the reading inside it, falling back to the icon when there is no number; `none` leaves the label alone. |
| `showIcon`    | boolean                                | `true`       | **Deprecated** — use `badgeContent`. Honoured only when it is unset (`false` = `none`). |
| `hideWhenInactive` | boolean                           | `false`      | Hide on the card while the entity is inactive. Always shown, dimmed, in the editor. |
| `showState`   | boolean                                | sensors only | Show the entity state in the label line.               |
| `showName`    | boolean                                | `false`      | Show the device's name in the label line (`Name · state` when combined). |
| `labelSize`   | number                                 | `12`         | Label line font size (px).                             |
| `tap_action`  | ActionConfig                           | per domain   | Standard Lovelace action. By default `light`, `switch`, `fan` and `input_boolean` toggle and everything else — covers included — opens more-info. |
| `hold_action` / `double_tap_action` | ActionConfig         | —            | Optional extra gestures.                               |

#### Cast light

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
visible. `glow` is independent of the icon — pair it with `badgeContent: none` for light
without a badge, or `hideWhenInactive` to drop both when the light is off.

**Walls block the light.** A pool is clipped to what the lamp can actually see, so it stops
at its room's walls and spills through a doorway gap the way real light does — an irregular
shape rather than a clean circle. A lamp with no wall inside its radius stays circular.

Pools are drawn above room fills but below furniture and walls, so light reads as cast onto
the floor. Furniture under a lit lamp picks up about half the cast, enough to read as lit
without turning into the color of the light. Pools never intercept clicks.

### Text

`{ id, x, y, text, size?, color?, angle? }` — `size` px (default 16), `color` CSS/hex,
`angle` degrees.

### Furniture

`{ id, type, x, y, w, h, angle?, hand?, color?, entity?, activeColor?, stateColor? }`

`type` is one of `table`, `roundTable`, `desk`, `chair`, `sofa`, `sectional`, `bed`,
`wardrobe`, `rug`, `plant`, `fridge`, `stove`, `sink`, `dishwasher`, `washer`, `dryer`,
`toilet`, `bathtub`, `vanity`, `stairs`, `tv`, `piano`, `fishTank`, `hotTub`,
`waterHeater`, `airHandler`. `color` defaults to gray so furniture reads differently from
walls; `hand` (`left` / `right`) picks which end an L-shaped `sectional`'s chaise sits on.

Bind an **entity** and `stateColor` / `activeColor` recolor the whole diagram — a plant
goes red when its soil sensor says it needs watering, a cabinet highlights while its
contact sensor is open.

```yaml
{ id: plant1, type: plant, x: 300, y: 220, w: 40, h: 40,
  entity: sensor.ficus_soil_moisture,
  stateColor: [ { above: 80, color: green }, { above: 65, color: yellow }, { color: red } ] }
```

### Tracker

A live (x, y) position estimate driven by one or two orthogonal distance sensors,
animated inside a rectangular tracked area:

```yaml
{ id, x, y, w, h, angle?, color?, dotSize?,
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

### Area

`{ id, points, name?, showName?, color?, opacity?, haArea?, filterEntities?, entity?, stateColor?, activeColor?, activeOpacity?, borderColor?, borderWidth?, highlight? }`

- `points` — `{ x, y }` vertices in drawing order, implicitly closed last-to-first.
- `name` / `showName` — label centered on the polygon (`showName` defaults `true`).
  Mirrors the linked HA area's name when `haArea` is set.
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

### Example

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

## Styling hooks (card-mod)

Every rendered element carries its config `id` as `data-id`, plus a type class, so
[card-mod](https://github.com/thomasloven/lovelace-card-mod) and any other CSS can target
it by something stable.

| Element | Class | Attributes |
| --- | --- | --- |
| Area (fill) | `fp-area` | `data-id`, `data-entity` |
| Area (outline) | `fp-area-border` | `data-id`, `data-entity` |
| Furniture | `fp-furniture`, `fp-furniture-<type>` | `data-id`, `data-entity` |
| Door / window | `fp-opening`, `fp-opening-door` \| `fp-opening-window` | `data-id`, `data-entity` |
| Wall | `wall`, `fp-wall` | `data-id` |
| Device | `item`, `fp-item` | `data-id`, `data-entity`, `data-kind` |
| Text | `text`, `fp-text` | `data-id` |
| Tracker | `tracker`, `fp-tracker` | `data-id` |

Ids come from the editor (`area_a5r5nwl`, `furn_3j66s50`, …) and are stable across edits.

An area is **two** elements answering the same `data-id`: the fill, under the walls, and
the outline, over them. Scope `fill` rules to `.fp-area` — the outline is drawn
`fill="none"`, so an unscoped rule floods it solid:

```css
[data-id="area_hall"]          { fill: #62f202; }  /* also floods the outline */
.fp-area[data-id="area_hall"]  { fill: #62f202; }  /* the fill, as intended */
.fp-area-border[data-id="area_hall"] { stroke-dasharray: 6 4; }
```

Non-`fill` properties — `opacity`, `filter`, `stroke` — are usually fine on both, which is
why the `data-entity` example below is left unscoped.

```yaml
type: custom:easy-floorplan-card
card_mod:
  style: |
    /* One specific room */
    .fp-area[data-id="area_a5r5nwl"] { fill: #62f202; fill-opacity: 0.35; }
    /* Every sofa on the plan */
    .fp-furniture-sofa { opacity: 0.5; }
    /* The element bound to one entity, whatever kind it is */
    [data-entity="light.kitchen"] { filter: drop-shadow(0 0 6px gold); }
```

CSS wins over SVG presentation attributes, so `fill` and `fill-opacity` set this way
override what the card draws.

Note that colouring a room from a sensor needs no CSS — areas take `entity`, `stateColor`,
`activeColor` and `activeOpacity` natively; see [Area](#area). And these hooks are a
*styling* surface, not an API: class names are stable, but the SVG inside an element may
change between releases, so target the element rather than its internals.

## Development

```bash
npm install
npm run build      # bundles to dist/easy-floorplan-card.js
npm run watch      # rebuild on change
npm run typecheck  # tsc --noEmit
npm test           # vitest (pure-logic tests; no browser)
```

Releases are built and attached automatically by GitHub Actions when a GitHub release
is published.

### Browser dev harness

Iterate on the editor / card without a Home Assistant instance:

```bash
npm run serve      # opens /dev/ on the Vite dev server with HMR
```

It mounts the **real** editor and card side-by-side over a minimal `hass` mock, with
`<ha-card>` / `<ha-icon>` / `<ha-entity-picker>` / `<ha-combo-box>` stubs so the harness
drives the same code branch a real HA install does. Editor changes round-trip through
`config-changed` into the live preview, and a **Tracker emulator** panel appears whenever
the config has a tracker — per-axis sliders write into the mock states, and **Auto-orbit**
drives them on `requestAnimationFrame`.

The harness lives entirely under `dev/` and is not in the production build. Flip
`START_WITH_DEMO` in `dev/dev.ts` to start with a sample room instead of a blank floor.

## License

[MIT](LICENSE)

[hacs-badge]: https://img.shields.io/badge/HACS-Custom-41BDF5.svg
[hacs-url]: https://github.com/hacs/integration
[release-badge]: https://img.shields.io/github/v/release/nicosandller/easy-floorplan
[release-url]: https://github.com/nicosandller/easy-floorplan/releases
[license-badge]: https://img.shields.io/github/license/nicosandller/easy-floorplan
