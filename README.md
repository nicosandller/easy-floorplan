# Easy Floorplan

[![hacs][hacs-badge]][hacs-url]
[![release][release-badge]][release-url]
[![license][license-badge]](LICENSE)

A Home Assistant Lovelace card for building an interactive floorplan — **with a visual
drag-and-drop editor**. Draw walls, drop doors and windows, add furniture and labels, and
place your entities as icons, ripples or live state. Everything scales to the card and
screen size.

<img width="1080" height="608" alt="demo" src="https://github.com/user-attachments/assets/98abaddc-b713-492f-be85-ca5f778f3779" />

## What you can end up with

<img width="1161" height="596" alt="Screenshot 2026-08-06 at 4 26 22 PM" src="https://github.com/user-attachments/assets/69c6c865-4eeb-4878-914b-182b2c31b63b" />

## Features
- **Visual editor** — draw walls, drop doors and windows that snap onto them, drag, nudge with arrow keys, multi-select, copy/paste, undo/redo, zoom.
- **Devices** — bind any entity to an icon: tap to toggle or open more-info, live state or attribute label, custom icon, size, rotation.
  - **Presence ripples** — presence sensors drawn as animated rings instead of a static icon.
  - (${\color{red}NEW!}$) **Cast light** — a light pools its own color and brightness onto the plan; overlapping pools mix, so a warm lamp and a cool one blend between them.
  - (${\color{red}NEW!}$) **Conditional text / icon / coloring** — threshold and state rules restyle an element from what its entity reads: the badge color, the label, and the glyph itself, so blinds swap between open and closed icons and a thermostat reddens as it heats. The same rules drive furniture and rooms.
 
<img width="195" height="278" alt="light blend" src="https://github.com/user-attachments/assets/23104587-687b-4c9a-83e8-e83c3d5eb6eb" />
<img width="240" height="358" alt="conditionals" src="https://github.com/user-attachments/assets/11d359b6-de8c-483c-8763-105ddf7d915b" />

- **Animated doors & windows** — bind a contact `binary_sensor` or `cover` and openings swing, slide or roll with their real state, partial positions included.
- (${\color{red}NEW!}$) **Furniture** — 26 gray line-art diagrams (table, sofa, bed, stove, stairs, tv…), each bindable to an entity, in a searchable picker. Every one is a plain JSON file of numbers you can copy: draw your own in the editor's paste box, use it straight away, and open a PR when it's good. No SVG, so nothing you paste can run anything.
- **Areas** — trace room polygons that color live from an entity, and link them to Home Assistant areas to scope entity pickers and bulk-add devices.
- **Live position trackers** — map one or two distance sensors (mmWave / radar) onto a marker that moves across the plan in real time.
- (${\color{red}NEW!}$) **Dead spaces** — hatch the spaces your walls seal off that no door or window reaches: a service shaft, the void behind a boxed-in stairwell. Nothing to draw — the regions come from the walls and openings themselves, so cutting a doorway into one stops it being dead the moment you place the door.
- (${\color{red}NEW!}$) **Follow the sun** — dim the plan through dusk and brighten it through dawn, from your HA instance's sun elevation. Any light casting light holds the dark back around itself, out to its radius, so a night plan reads as a dark house with lit rooms glowing.
 
<img width="441" height="301" alt="day" src="https://github.com/user-attachments/assets/f3dbfc88-9d06-4f44-81dc-bf499cbd9bd3" />
<img width="444" height="313" alt="night" src="https://github.com/user-attachments/assets/1590b710-d88f-4a34-986b-b08640a45f4c" />


- **Multiple floors** — per-floor elements with a switcher in both the editor and the card.
- **Background image** — trace over a floor-plan scan, per floor, with adjustable opacity.
- (${\color{red}NEW!}$) **Skins** — restyle the whole plan from one line of config: `default` follows your Home Assistant theme, `odnetnin` is chunky charcoal on cream, `pastel` is soft and low-contrast, `tron` is neon on near-black. Colors you set on an element yourself always win.
  
<img width="300" height="300" alt="default" src="https://github.com/user-attachments/assets/ce2d6545-10f4-4aa2-bbd7-0dcae08c27f5" />
<img width="300" height="300" alt="odnetnin" src="https://github.com/user-attachments/assets/1d46f7a3-b894-4fcb-bdb9-a55270b8e4e4" />
<img width="300" height="300" alt="tron" src="https://github.com/user-attachments/assets/de5b0825-3bff-4817-8a26-8f887bab8c48" />

- **Auto-scaling** — SVG over a virtual coordinate space, so the plan fits any card size.

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
  both read `Name · state`. **Label size** sets the font size. The editor canvas draws
  the same line the card will, so turning one on is visible straight away; a device
  showing neither still gets a dimmed editor-only label so you can tell it apart.
- **Two readings in one** — add a **Second entity** to render e.g. `21.5 °C · 45%`. Or set
  **Attribute** / **2nd attribute** to read attributes instead of states, so a single
  climate entity shows its temperature and humidity.
- **Badge shows** — one dropdown for what the device draws: *Icon* — **still**,
  **spinning** or **pulsing** — its *Value*, or *Nothing* (label only). **Value** draws
  the reading inside the badge — a thermostat reads `21°` in the circle your state rules
  already paint red — picking it per domain, dropping long units, and falling back to the
  icon when there is no number. See [Fans](#fans) for the animations.
- **Badge reads** — with a **Second entity** bound and the badge showing a value, this
  names which entity it reads. Left alone the card takes the first with a number to show,
  so a smart plug pointed at its power sensor reads `1.2kW` without configuring anything —
  the switch says "on", not a number, so the badge falls through. Once you pick, only that
  entity is read; if it has nothing to show the badge falls back to its icon rather than
  quietly showing the other.
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
  neither is the default. `icon` is optional and beats the device's own icon while it
  matches — a rule without one keeps that icon, so colouring by state costs nothing when
  the glyph never changes. Rules beat **Active color**, which the editor hides once they
  exist; the **Icon** field stays, since it is still what they fall back to.
- **Only when active** — hide the device on the card while its entity is off, idle or
  unavailable, so a busy room only shows what's doing something. The editor still draws
  it, faded with a dashed badge.
- **No entity? Still on the map** — an unbound device renders as a plain static badge, so
  hardware HA doesn't know about (a dumb smoke detector, a wired doorbell) can still be
  marked. It never highlights and tapping does nothing.

### Animations

Bind an entity and the element stops being a drawing: openings move with their real
state, rooms and furniture recolor, markers glide, icons spin.

#### Press feedback

A tap used to change nothing on screen until the entity itself came back — which on a
cover, or a bulb on a slow bridge, is long enough to wonder whether it registered at all.
Devices now answer the press immediately. Set **Press effect** under **Project**:

| Effect | What it does |
| ------ | ------------ |
| **Press in** (default) | The device dips to 92% and springs back — fast in, slow out, so even a quick tap is visible. |
| **Ink ripple** | A circle spreads and fades from the point you touched. |
| **Flash** | A halo of the skin's accent color, with no movement at all. |
| **None** | Nothing, as before. |

It is one setting for the whole plan rather than per device: it is how the dashboard
feels, and a plan where half the devices answered differently would read as broken.

**Only devices that do something respond.** A device with no entity bound, or with
`tap_action: none` and nothing on hold or double-tap, isn't treated as a button at all: no
press effect, no hand cursor, no tab stop, and no `button` role for a screen reader to
announce. Feedback promising an action that never arrives is worse than none — and an
inert device that answers the keyboard with silence is the same promise, made where it is
hardest to check.

With the OS *reduce motion* preference set, all three fall back to the flash halo with no
transition: the affordance stays, the movement goes.

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

Turn on a device's **Ripple** toggle and it draws animated concentric rings behind the
badge — set **Badge shows** to *Nothing* for the rings alone. They pulse outward and fade
while presence is detected, and collapse to a faint dot when it's clear, so the spot stays
marked without pulling the eye.

**Ripple color** and **ripple size** are per device (the color follows **Active color**
and state rules unless you set one).

The toggle appears only on devices that detect presence — a `binary_sensor` whose device
class is `motion`, `occupancy` or `presence`, or a `device_tracker` / `person` — the same
way **Cast light** appears only on lights: a ring claims someone is there, so it's offered
where that claim can be true. The underlying `display` key still works on any entity in
YAML.

<img width="540" height="304" alt="ripple_demo_gif" src="https://github.com/user-attachments/assets/e43949cf-13a2-48f8-804d-73738299475f" />

#### Fans

A running fan's icon spins, and an active media player or vacuum pulses — the same
defaults Home Assistant's own Tile card uses, with no setup: those devices simply open on
*Icon, spinning* / *Icon, pulsing*. Change **Badge shows** to turn it off, or to force an
animation on any other entity.

An icon only animates while its entity is genuinely active, so a forced spin on an
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
| `showDeadSpaces` | boolean | `false` | Hatch every space the walls seal off that no door or window reaches, worked out from the walls and openings themselves. See [Dead spaces](#dead-spaces). |
| `sunDimming` | boolean | `false` | Dim through dusk, brighten through dawn, from the HA instance's sun. See [Follow the sun](#follow-the-sun). |
| `sunBrightnessMin` | number | `0.45` | Brightness once the sun is fully down, 0–1. |
| `sunBrightnessMax` | number | `1` | Brightness in full daylight, 0–1. |
| `skin`       | string   | `default`          | Built-in look for the whole plan: `default`, `odnetnin`, `pastel` or `tron`. See [Skins](#skins). |
| `pressEffect`| string   | `scale`            | Feedback when a device is pressed: `scale`, `ripple`, `flash` or `none`. Only devices that actually do something respond. See [Press feedback](#press-feedback). |
| `overlayScale`| string  | `fixed`            | How badges, labels, room names and text are sized: `fixed` = screen pixels, `plan` = canvas units so they scale with the drawing. See [Overlay scale](#overlay-scale). |
| `background` | string   | skin / card bg     | Canvas background color (CSS / hex). Overrides the skin's paper. |
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
| `display`     | `badge` \| `ripple` \| `iconRipple`    | `badge`      | How the device is drawn. The editor spells this as the **Ripple** toggle (plus **Badge shows: Nothing** for `ripple`) and offers it on presence devices only; in YAML it works on any entity. |
| `iconAnimation` | `auto` \| `none` \| `spin` \| `pulse` | `auto`       | Animate the icon while active. `auto`: fan spins; media player / vacuum pulse. The editor spells this as the icon options of **Badge shows**, showing `auto` as whatever it resolves to. |
| `activeColor` | string                                 | theme color  | Badge color while on. Ignored while `stateColor` rules match. |
| `rippleColor` | string                                 | `activeColor`| Ripple ring color, falling back to `activeColor` then the primary color. |
| `rippleSize`  | number                                 | `80`         | Max ripple diameter (px).                              |
| `glow`        | boolean                                | `false`      | Cast a pool of light onto the plan (lights only). See [Cast light](#cast-light). |
| `glowRadius`  | number                                 | `140`        | Radius of the cast pool at full brightness, in canvas units. A dimmer lamp casts a proportionally smaller pool, down to half this. |
| `glowColor`   | string                                 | `#ffd9a0`    | Pool color for a bulb that can't report one; color-capable lights use their own. |
| `badgeContent` | `icon` \| `value` \| `none`           | `icon`       | What the badge holds. `value` draws the reading inside it, falling back to the icon when there is no number; `none` leaves the label alone. |
| `badgeEntity` | `primary` \| `secondary`               | automatic    | Which entity a `value` badge reads. Unset picks the first with a number to show; set, only that entity is read. |
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

Pools are drawn above room fills but below furniture and walls, so light reads as cast onto
the floor. Furniture under a lit lamp picks up about half the cast, enough to read as lit
without turning into the color of the light. Pools never intercept clicks.

### Text

`{ id, x, y, text, size?, color?, angle? }` — `size` px (default 16), `color` CSS/hex,
`angle` degrees.

### Furniture

`{ id, type, x, y, w, h, angle?, hand?, color?, entity?, activeColor?, stateColor? }`

`type` names a **symbol** — one of the ~26 the card ships with (`table`, `sofa`, `bed`,
`fridge`, `stairs`, …; the full set is [`furniture/`](furniture/), a file each), or one you
supply yourself. `color` defaults to gray so furniture reads differently from walls; `hand`
(`left` / `right`) mirrors the symbol, and picks which end an L-shaped `sectional`'s chaise
sits on. A `type` nothing answers to draws a plain box, so a missing symbol is a visible
placeholder rather than a hole in the plan.

The editor's **+ Add** picker draws every symbol at its real size and is searchable — type
`couch` and you get the sofa and the sectional.

Bind an **entity** and `stateColor` / `activeColor` recolor the whole diagram — a plant
goes red when its soil sensor says it needs watering, a cabinet highlights while its
contact sensor is open.

```yaml
{ id: plant1, type: plant, x: 300, y: 220, w: 40, h: 40,
  entity: sensor.ficus_soil_moisture,
  stateColor: [ { above: 80, color: green }, { above: 65, color: yellow }, { color: red } ] }
```

#### Drawing your own

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

Coordinates are a fraction of the piece's box (`0`–`100` across and down); stroke widths are
canvas units and don't scale. A part picks a **role** (`body`, `line`, `thin`, `detail`,
`hint`, `solid`) rather than a colour, so your symbol inherits skins and entity recoloring
for free. `repeat` stamps one part along a step vector.

You don't have to hand-write it: **Project → Custom symbols** in the editor takes pasted JSON,
validates it, and drops it into `symbols:` — it then shows up in the picker beside the
built-ins. If it turns out to be generally useful, the same JSON is what you contribute to
[`furniture/`](furniture/). The full format is in
[`furniture/README.md`](furniture/README.md).

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

`{ id, points, name?, showName?, labelSize?, color?, opacity?, haArea?, filterEntities?, entity?, stateColor?, activeColor?, activeOpacity?, borderColor?, borderWidth?, highlight? }`

- `points` — `{ x, y }` vertices in drawing order, implicitly closed last-to-first.
- `name` / `showName` — label centered on the polygon (`showName` defaults `true`).
  Mirrors the linked HA area's name when `haArea` is set.
- `labelSize` — that label's size, `8`–`40`, default `14`. Px under `overlayScale: fixed`,
  canvas units under `plan`. Small rooms want a smaller number than the big ones beside them.
  Left unset on a `fixed` card the size stays in the stylesheet, so a card-mod rule on
  `.area-label` still wins; set it, or switch to `plan`, and it moves inline and takes over.
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

## Dead spaces

A **dead space** is a space the walls close off completely that no door and no window opens
onto: the void behind a boxed-in stairwell, a service shaft, the pocket left over between
two rooms. You cannot get into it, and a plan that draws it like a room is telling you
something untrue about the house. Floor plans conventionally hatch these, and that is what
**`showDeadSpaces: true`** does.

```yaml
type: custom:easy-floorplan-card
showDeadSpaces: true
```

There is nothing to draw and nothing stored. The regions are worked out from the walls and
openings themselves on every render, so they are never out of date:

- close the last wall of a shaft and it hatches itself;
- drop a door or a window anywhere on its boundary and the hatching goes away;
- move a wall and the hatching moves with it.

Toggle it in the editor under **Project → Mark dead spaces**. The editor draws it on the
canvas too, live as you draw — which is the quickest way to check the card agrees with you
about what is actually sealed.

**Why it is off by default.** Marking a doorway by simply leaving a gap in the wall, rather
than placing a door symbol in it, makes a perfectly good plan — and read literally, it is
also a house with no way in. Turning this on for everyone would hatch such a plan end to
end. Whether your walls tell the whole story is your call, so it is yours to switch on.

Two things worth knowing about how the regions are found:

- **A gap in the walls is not a dead space.** Only genuinely closed rings of wall are
  candidates at all, so a room you left open on purpose is never hatched — the feature can
  only ever be wrong in the quiet direction.
- **Walls have to actually meet.** Corners that merely come close do not close a ring. The
  editor's endpoint snapping already makes room corners exact; if a region you expected to
  hatch does not, a corner that missed by a unit or two is the first thing to check.

Anything below a single grid cell in area is ignored, so a sliver where two walls cross
does not leave a smudge on the plan.

## Skins

A skin restyles the whole plan at once — paper, walls, badges, accents — from one line.
Pick one under **Project → Skin**, or set it by hand:

```yaml
type: custom:easy-floorplan-card
skin: tron
```

| Skin | What it looks like |
| --- | --- |
| `default` | Follows your Home Assistant theme, as the card always has. What you get with no `skin` set. |
| `odnetnin` | Playful and chunky: thick charcoal outlines on warm cream, rounded-square badges with a printed-sticker shadow, red accent, bright yellow for anything on. |
| `pastel` | Soft and low-contrast: muted mauve walls on blush paper, peach for active devices. Easy on a dashboard that stays on screen. |
| `tron` | Neon on near-black: thin glowing cyan walls, amber for active devices, light text. Light pools read best here. |

A skin only supplies **fallbacks**, so anything you set on an element yourself still wins —
a room's own `color`, a device's `activeColor`, a `background` on the plan. Switch skins
freely without losing colors you chose by hand.

It deliberately leaves two things alone: the **editor's own chrome** stays in your HA theme
so the canvas reads as the plan, and a **background image** still covers the skin's paper.

### Rolling your own

A skin is a set of CSS custom properties, so [card-mod](#styling-hooks-card-mod) can set
the same ones for the same result:

```yaml
type: custom:easy-floorplan-card
card_mod:
  style: |
    ha-card {
      --fp-skin-bg: #101820;
      --fp-skin-wall: #f2aa4c;
      --fp-skin-text: #f2f2f2;
      --fp-skin-accent: #f2aa4c;
    }
```

| Token | Default | Paints |
| --- | --- | --- |
| `--fp-skin-bg` | card background | The canvas paper. |
| `--fp-skin-card-bg` | card background | The card around the canvas. |
| `--fp-skin-wall` | theme text color | Walls, and the jambs and leaves of openings. |
| `--fp-skin-wall-width` | `8` | Wall stroke width. **Keep at 10 or below** — a doorway is a 12-unit gap cut through the wall layer, and a wider wall wouldn't be fully cleared by its own door. |
| `--fp-skin-wall-filter` | `none` | A CSS `filter` on the walls, e.g. `drop-shadow(0 0 4px #22d3ee)`. |
| `--fp-skin-accent` | theme primary | Ripples, trackers, room fills, active doors, the floor switcher. |
| `--fp-skin-accent-ink` | theme text-on-primary | Reading color on the accent. Set it whenever your accent is pale. |
| `--fp-skin-active` | theme active color | Badge color for a device that is on. |
| `--fp-skin-active-ink` | theme text color | Icon/reading color on that badge. Set it whenever the active color is pale. |
| `--fp-skin-text` | theme text color | Labels, free text, room names, card title, editor grid. |
| `--fp-skin-badge-bg` | card background | Badge and label-chip background. |
| `--fp-skin-badge-border` | divider color | Badge border color. |
| `--fp-skin-badge-border-width` | `1.5px` | Badge border weight. |
| `--fp-skin-badge-radius` | `50%` | Badge roundness — `50%` a circle, `30%` a rounded square. |
| `--fp-skin-badge-shadow` | `0 1px 3px rgba(0,0,0,0.2)` | Badge shadow. |
| `--fp-skin-furniture` | `#9e9e9e` | Furniture with no color of its own. |
| `--fp-skin-glow` | `#ffd9a0` | Light-pool color for a bulb that reports none. |

Set them on `ha-card` and the whole plan follows, editor included. Any token you leave
alone keeps its default, so you can restyle one thing without restating the rest.

**On top of a built-in skin, add `!important`.** A `skin:` is applied as an inline `style`
on the card, which outranks a card-mod rule — so without it your override is silently
ignored, and only while a skin is set:

```yaml
type: custom:easy-floorplan-card
skin: tron
card_mod:
  style: |
    ha-card {
      --fp-skin-accent: #f2aa4c !important;
    }
```

## Overlay scale

The card draws in two layers. Walls, doors, furniture and room fills are SVG, scaled from
the canvas to whatever width the card gets — draw at any size, they always fit. Badges,
labels, room names and text are HTML on top of that, so they stay upright under
`rotation` and can take clicks, and by default they are sized in **screen pixels**.

Those two agree while the card renders at roughly its canvas size. Below that they drift
apart: a `980`-wide plan shown `500` wide draws every wall at half size while a 14px room
name stays 14px, so names spill past their rooms and collide with the badges under them.
Nothing in the config can fix that, because a label's px size doesn't know what scale the
plan ended up at.

`overlayScale: plan` sizes the overlay in **canvas units** instead, so both layers shrink
together and the card looks the same at every size — a scale drawing rather than a drawing
with fixed-size furniture on it. Every measure follows: `size` and `labelSize` on a
device, the reading drawn inside a badge, `size` on text, an area's `labelSize`, and
`rippleSize`. Hairlines deliberately don't — a badge border and a label's drop shadow
are about a pixel either way, and scaling them down is how you lose them.

```yaml
type: custom:easy-floorplan-card
width: 980
height: 700
overlayScale: plan
```

Sizes are read in canvas units under `plan`, so the numbers mean the same thing as
everything else in the config: `labelSize: 14` is 14 units on a `980`-unit-wide canvas,
about 1.4 % of the card's width whatever that turns out to be.

### Where it helps, and where it costs

Scaling with the drawing cuts both ways: it stops text overflowing its room, and it also
keeps shrinking past the point text can be read. On a `980`-wide canvas at the default
sizes (room name `14`, device label `12`):

| Card width | Room name | Device label |
| --- | --- | --- |
| 1200 | 17px | 15px |
| 800 | 11px | 10px |
| 600 | 9px | 7px |
| 450 | 6px | 6px |
| 350 | 5px | 4px |

So `plan` suits a card rendering down to roughly **two-thirds of its canvas width** on the
defaults. Below that it trades collision for illegibility, and the sizes have to come up
to compensate — a `labelSize` of `20`–`24` on a card at half its canvas width lands back
where the default was. That is a real trade, not a free win: sizes are relative, and
nothing puts a floor under them.

Use it whenever the card renders smaller than its canvas but not drastically so — a
dashboard tile, a sidebar, a desktop widget. Leave it off for a wall tablet showing the
plan at full size, where fixed px is what keeps text legible from across the room, and
for a card so small that scaled text would disappear. The default stays `fixed`, so an
existing card looks exactly as it did.

## Styling hooks (card-mod)

Every rendered element carries its config `id` as `data-id`, plus a type class, so
[card-mod](https://github.com/thomasloven/lovelace-card-mod) and any other CSS can target
it by something stable.

| Element | Class | Attributes |
| --- | --- | --- |
| Area (fill) | `fp-area` | `data-id`, `data-entity` |
| Dead space | `fp-dead-space` (hatch lines: `fp-dead-space-line`) | — |
| Area (outline) | `fp-area-border` | `data-id`, `data-entity` |
| Furniture | `fp-furniture`, `fp-furniture-<type>` | `data-id`, `data-entity` |
| Door / window | `fp-opening`, `fp-opening-door` \| `fp-opening-window` | `data-id`, `data-entity` |
| Wall | `wall`, `fp-wall` | `data-id` |
| Device | `item`, `fp-item` | `data-id`, `data-entity`, `data-kind` |
| Text | `text`, `fp-text` | `data-id` |
| Room name | `area-label` | — |
| Tracker | `tracker`, `fp-tracker` | `data-id` |

Ids come from the editor (`area_a5r5nwl`, `furn_3j66s50`, …) and are stable across edits.

A dead space has no `data-id`, and cannot: it's derived from the walls rather than placed,
so there's nothing for an id to be stable against. Style them as a group —
`.fp-dead-space { fill-opacity: 0.7; }` for a heavier hatch, `.fp-dead-space-line
{ stroke: #c62828; }` to color the lines.

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
`activeColor` and `activeOpacity` natively (see [Area](#area)) — and restyling the whole
plan doesn't either: the `--fp-skin-*` tokens in [Skins](#skins) are the supported way to
build a look of your own. These hooks are a *styling* surface, not an API: class names are
stable, but the SVG inside an element may change between releases, so target the element
rather than its internals.

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

`/dev/symbols.html` on the same server draws every symbol in [`furniture/`](furniture/) on
one page — the contact sheet to check a new one against. It reads the directory, so a file
you add appears with no other edit.

## License

[MIT](LICENSE)

[hacs-badge]: https://img.shields.io/badge/HACS-Custom-41BDF5.svg
[hacs-url]: https://github.com/hacs/integration
[release-badge]: https://img.shields.io/github/v/release/nicosandller/easy-floorplan
[release-url]: https://github.com/nicosandller/easy-floorplan/releases
[license-badge]: https://img.shields.io/github/license/nicosandller/easy-floorplan
