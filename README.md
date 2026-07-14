# Easy Floorplan

[![hacs][hacs-badge]][hacs-url]
[![release][release-badge]][release-url]
[![license][license-badge]](LICENSE)

A Home Assistant Lovelace card for building an interactive floorplan — **with a visual DRAG AND DROP 
editor**. Draw walls, drop doors and windows, add gray furniture diagrams and text
labels, and place your entities as icons, ripples or live state. Everything scales
automatically to the card and screen size.

<img width="1080" height="608" alt="demo" src="https://github.com/user-attachments/assets/98abaddc-b713-492f-be85-ca5f778f3779" />

## Features

- **Visual editor** — draw walls (endpoints snap to nearby corners to close rooms),
  click to drop doors/windows that snap onto walls, drag everything around, nudge with
  arrow keys, undo/redo, zoom.
- **Devices** — bind any entity to an icon. Click to toggle lights/switches or open the
  more-info dialog. Optional live state label (incl. a paired temperature + humidity
  entity), custom icon (with autocomplete + preview), size and rotation.
- **Presence ripples** — render presence/movement sensors as animated concentric rings
  that pulse while active and fade to a faint dot when idle.
- **Animated doors & windows** — link a contact `binary_sensor` or `cover` so doors swing
  and windows open on the plan as their real state changes, with an optional accent color
  while open.
- **Furniture** — gray line-art diagrams: table, round table, desk, chair, sofa, bed,
  wardrobe, rug, plant, fridge, stove, sink, toilet, stairs, tv.
- **Live position tracker** — draw a rectangular tracked area and bind one or two
  orthogonal distance sensors (e.g. mmWave / radar). The card linearly maps each
  sensor's `[min, max]` reading to the rectangle's edges and animates a pulsating
  triangle with ripples at the resolved `(x, y)`. With only one sensor configured
  it falls back to a faint pulsating line with ripples along the unknown axis.
  An optional occupancy `binary_sensor` per axis gates the animation so the
  marker hides cleanly when the room is empty. The zone outline is visible only
  in the editor — the live card shows just the animation.
- **Text labels** and a configurable **canvas background color**.
- **Background image** — drop in a floor-plan image (per floor) and trace walls, doors and
  devices over it, with adjustable opacity.
- **Multiple floors** — group elements per floor and switch between them with a control in
  the top-right (in both the editor and the live card).
- **Multi-select & copy/paste** — shift/ctrl-click or drag a box to select many; move,
  duplicate (Ctrl/Cmd+D), copy/paste (Ctrl/Cmd+C/V) or delete them together.
- **Snapping** — by default walls and elements snap to the visible grid; switch **Snap to**
  to **Off** for free placement, or **Custom** to snap to your own step.
- **Auto-scaling** — a virtual coordinate space + SVG means the plan rescales to any
  card or screen size with no reflow.

## What you can end up with

<img width="1103" height="592" alt="demo_screenshot" src="https://github.com/user-attachments/assets/c05d32e3-8a9e-4643-8c25-79c1128dbb59" />

## Installation

### HACS (recommended)

This is currently distributed as a **custom repository**. Click the badge to add it
to your own Home Assistant in one step:

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

## Usage

Edit a dashboard → **Add card** → search **Easy Floorplan**. The editor is laid out
top-to-bottom as a **tools row**, a **context row** with options/actions for whatever
you're doing, the **canvas**, and two sections below — **Element** (per-element editor
for the current selection) and **Project** (page-level settings like canvas size, grid,
background):

- **Select** — the default tool. Click an element to select it; Shift/Ctrl-click or drag
  a box to select several at once. Arrow keys nudge the selection (Shift+arrow jumps a
  full grid cell); **Ctrl/Cmd+C/V/D** copy / paste / duplicate; **Ctrl/Cmd+Z** undoes
  (**Shift+Z** or **Ctrl+Y** redoes); **Escape** cancels an in-progress draw or clears
  the selection. The **Element** section below the canvas names the selection
  (e.g. *Door · 60 units*) and carries its **duplicate** / **delete** buttons along
  with the full property editor.
- **Wall** — drag to draw. Endpoints snap to nearby corners; start a new wall on an
  existing corner to continue the perimeter. The context row's **straighten** toggle
  keeps walls horizontal/vertical and corner-snapped (turn it off to draw freely), and
  the **Snap** segmented control (`On` / `Off` / `Custom`) governs snapping for *all*
  tools — `Custom` lets you snap to a percentage of the grid (e.g. 50% = half a cell).
- **Door / Window** — click to drop; it snaps onto the nearest wall. The context row
  shows a **Length** field for the *next* opening you place, so you can size doors and
  windows before placing them. Assign a sensor after placement (in the **Element**
  section) to animate the opening open/closed — see **Doors & windows**.
- **Tracker** — drag to draw a rectangular tracked area, then bind one or two distance
  sensors (X axis and/or Y axis) in the **Element** section to animate a live position
  marker inside the zone — see **Tracker**. The zone outline is visible only in the
  editor; the live card shows just the marker.
- **+ Add** — one popover for everything droppable: device, text, and all furniture
  types shown as their actual glyphs (pick a sofa by seeing a sofa). The new element is
  selected immediately so the **Element** section is ready for configuring it.
- **floor** — switch floors with the dropdown, add one with **+**; rename and delete
  live behind the gear button. The gear also offers an **HA floor** dropdown listing
  your Home Assistant floors — linking one names the plan floor after it (rename
  afterwards if you like; the link sticks either way).

Undo/redo buttons sit at the right of the tools row. Zoom controls live on the canvas
itself (bottom-right): **−** / **+** step, click the percentage to reset, the fit button
snaps back to 100%, and **Ctrl/Cmd+scroll** zooms from the keyboard/trackpad. The
**Project** section (canvas size, grid, background) is collapsed by default — click its
header to expand. Its last row, **Rotate display**, turns the *live card* in 90° steps
for portrait wall tablets — the editor keeps showing the plan as drawn, and icons and
labels stay upright at any rotation.

## Elements

Everything you place on the plan is an **element** you can select, move (freely or
snapped to a grid), nudge with arrow keys, copy/paste, duplicate and delete. The element
types are **devices**, **doors & windows**, **furniture**, **text** and **trackers** —
and each floor holds its own set of them.

### Devices

A **device** binds a Home Assistant entity to a spot on the plan. Add one with
**+ device**, then pick the entity in the **Element** section below the canvas.
By default it shows an icon badge:

- **Tap to act** — lights, switches, covers, fans and `input_boolean`s toggle on tap;
  any other entity opens its more-info dialog.
- **Live look** — the badge highlights when the entity is "on". Turn on **Show state**
  to display the current value next to it, formatted exactly as Home Assistant would —
  including the entity's configured display precision. Add a **2nd entity** to show two
  readings in one element — e.g. a temperature and a humidity sensor render together as
  `21.5 °C · 45%`.
- **Follows "show as"** — the icon and state label respect the entity's
  **device class** (HA's *show as* setting): a `binary_sensor` shown as a Lock renders
  `mdi:lock` / `mdi:lock-open` and reads "Locked" / "Unlocked", a door contact gets
  door icons, a motion sensor gets motion icons, and so on — the same defaults HA
  itself uses. An explicit icon on the entity, or an **icon** override on the device,
  still wins.
- **Make it yours** — override the **icon** (with autocomplete + live preview), set a
  custom **name**, change the **size**, **rotate** it, or hide the icon entirely.

### Presence ripples

For motion/occupancy/presence sensors, switch a device's **Display** mode from *Icon
badge* to **Ripple** or **Icon + ripple**. Instead of a static icon it draws animated
concentric rings:

- **Active** (sensor on) → the rings continuously pulse outward and fade, drawing the
  eye to where motion is happening.
- **Idle** (sensor off) → the rings stop and only a faint dot remains, so the spot stays
  marked without being distracting.

You can set the **ripple color** and **ripple size** per device, so e.g. a calm blue
ring in the living room and a warmer one by the entrance. It works with any entity that
reports an on/off-like state, not just presence sensors.

<img width="540" height="304" alt="ripple_demo_gif" src="https://github.com/user-attachments/assets/e43949cf-13a2-48f8-804d-73738299475f" />

### Doors & windows

Drop a **door** or **window** from the toolbar and it snaps onto the nearest wall. On its
own a door is drawn open (the familiar swing arc) and a window closed — a static floor
plan, just like before.

Select the opening and bind an **Entity** in the **Element** section below the canvas — a
contact `binary_sensor` or a `cover` (Home Assistant's domain for anything that opens: doors,
gates, garages, blinds, shades, shutters, curtains…) — to make the opening track its real
state. When you bind an entity the card reads its HA **`device_class`** and sets a sensible
`type`/`motion` for you (a `window` cover → a window; a `garage` roller → a sliding door);
adjust either afterwards. Once bound, the opening tracks state:

- **Open / closed** — the opening is drawn open when the entity is `on` / `open`, closed
  otherwise. A door's leaf swings around its hinge; a window's two leaves swing outward
  from the middle. When closed the swing arc is hidden; as the opening moves, the arc
  **draws on**, tracing the path of the leaf edge — animated smoothly.
- **Partial (position covers)** — if the bound `cover` reports a `current_position`
  (0–100), the opening is drawn **partly open** to match — a door swings partway, a
  slider slides partway — and it tracks the position live as the cover moves. Covers
  without a position, and `binary_sensor`s, use the on/off open/closed behavior above.
  `Invert` flips the percentage too.
- **Active color** — while actively open, the leaf/sash and arc take an accent color (the
  same idea as presence ripples) so an open door is easy to spot. Defaults to the primary
  color; pick your own per opening.
- **Invert** — flip the open/closed interpretation for sensors wired the other way.
- **Tap to control** — tapping an opening bound to a controllable `cover` toggles it
  (`cover.toggle`); read-only `binary_sensor`s (and position-only covers) open the entity's
  more-info dialog instead.

Openings without an entity keep the static look.

> **Future enhancement — tilt.** HA covers for venetian blinds / shutters also report
> `current_tilt_position` (0–100, the louvre angle) with its own `*_tilt` services. A
> top-down plan can't show a swing/slide for tilt, but it could render the closed panel as
> angled slats (or vary a hatch density) driven by the tilt position, and route taps to the
> tilt services when only tilt is supported. Not implemented yet — tracked as a follow-up.

**Orientation.** A swing door defaults to hinging at the left jamb and opening toward
one side of the wall. Use **Hinge** (left / right) and **Opens** (this side / other side)
in the **Element** section to face it any of the four ways — or set `flipH` / `flipV`
directly in YAML. These are pure mirrors, so the open/closed animation follows.

**Sliding doors & windows.** Set **Motion → slide** on a door or window and it travels
*along* the wall instead of swinging — a sliding door (solid panels) or a sliding window
(thin glass panels). Then pick a **Style**:

- **single** — one panel slides aside into the wall (pocket / barn / single patio).
- **bypass** — two panels on parallel tracks; one slides behind the other (patio-door style).
- **biparting** — two panels meet in the middle and part, each recessing into the wall on
  its own side.

**Slide** (to left / to right) sets the direction (`flipH`; ignored for biparting, which is
symmetric). Bind a `cover` / `binary_sensor` just like a swing opening and the panel(s) slide
open and closed with the state (or partly, from a cover's `current_position`).

```yaml
openings:
  # sliding window, patio-door style, driven by a cover
  - { id: patio, type: window, motion: slide, sliderStyle: biparting, x: 640, y: 500, length: 160, angle: 0, entity: cover.patio_door }
  # a swing door hinged on the right, opening into the other room
  - { id: hall, type: door, x: 300, y: 100, length: 80, angle: 0, flipH: true, flipV: true }
```

<img width="540" height="304" alt="door_window_demo" src="https://github.com/user-attachments/assets/091b3c89-5202-4025-8a0f-0fe867276be2" />

### Live position trackers

A **tracker** turns one or two distance sensors into a live marker that moves around
the floor plan in real time. The classic use case is a pair of mmWave / radar /
LIDAR sensors aimed along orthogonal axes — each one reports the target's distance
from itself, and together they pin down an `(x, y)` position. With only one sensor
you still get useful information: the position along that axis.

1. Pick the **Tracker** tool from the toolbar.
2. Drag on the canvas to draw a rectangle covering the area you want to track.
3. With the new tracker selected, fill in the **Element** section below the canvas:
   - **X sensor** — the entity that measures horizontal distance, plus a
     `min` and `max` distance reading (in the sensor's own units, usually metres)
     that correspond to the rectangle's left and right edges.
   - **Y sensor** — same, for vertical distance / top and bottom edges.
   - **Invert** per axis — if a higher reading should map to the *near* edge
     instead of the *far* edge, tick this. Saves you flipping `min` and `max`.

You can leave one of the axes empty: the tracker still works, it just draws a line
spanning the unknown axis instead of a point.

#### How it animates

- **Both sensors set** — a small pulsating triangle glides to the resolved
  `(x, y)`, emitting concentric ripple rings. Readings outside `[min, max]` clamp
  to the rectangle's edge so a glitch never sends the marker off the plan.
- **Only one sensor set** — a faint pulsating line spans the unknown axis at the
  known coordinate, with ripple bands expanding along it. This honestly conveys
  "the target is *somewhere* on this line" without pretending you know more.
- **Both sensors unavailable** — nothing renders in the live card (no ghost
  markers when the sensors drop out). The editor still shows the zone outline so
  you can find and reposition it.

#### Hiding the marker when nobody's there (presence gate)

Most mmWave / radar devices expose a distance entity **and** an occupancy
`binary_sensor` as siblings (e.g. `sensor.kitchen_radar_distance` +
`binary_sensor.kitchen_radar_occupancy`). Bind the occupancy entity to the
sensor's **Presence** field and the marker animation will hide whenever the
sensor reports "clear" — no more triangle pulsing in an empty room because the
distance value is stale.

- Configure presence **per axis** alongside the distance sensor. If either
  axis's presence reports clear, the marker hides — fail-safe semantics:
  when in doubt, don't show a position.
- Works for any binary entity: `binary_sensor.*`, `input_boolean`,
  `device_tracker` reporting `home`, etc. `on` / `open` / `home` / `detected`
  count as detected; anything else (including `unavailable` and `unknown`)
  is treated as clear.
- **Invert** flips the interpretation for inverted-logic sensors. It does
  *not* invert `unavailable` / `unknown` — those always hide the marker so
  a sensor outage can't accidentally pin the dot somewhere stale.
- In the editor, a gated zone outline dims to ~35% opacity so it's clear at
  a glance that the marker is intentionally hidden (not broken). The live
  card just shows nothing.

The marker color and dot size are configurable per tracker. Updates are smoothed
with a short CSS transition, so the marker glides between readings instead of
snapping (handy when sensors update at 1–4 Hz).

#### Tips for calibrating the range

Distance sensors are usually mounted on a wall and report the gap to the closest
target, but it's rare for the rectangle you drew on the plan to match `[0, max]`
of the sensor exactly. Two common adjustments:

- **Offset** — if the sensor is mounted *outside* the tracked rectangle (e.g.
  bolted to the wall a metre behind it), set `min` to that offset so a reading
  of "1.0 m" lands at the near edge instead of off-plan.
- **Direction** — if the sensor faces the far edge (so distance *grows* as the
  target moves toward the near edge), tick **invert** instead of swapping `min`
  and `max`. Same result, fewer footguns.

#### Editor-only zone

The zone rectangle (dashed outline, light fill) is drawn **only in the editor**
so you can grab and resize it. The dashboard view renders just the animated
marker — your finished plan stays clean.

#### Sensor compatibility

Anything that resolves to a finite number works: `sensor` entities reporting
distance, `input_number` helpers (great for testing), `number` entities, etc.
States of `unavailable`, `unknown`, or non-numeric values are treated as
"no reading" — the corresponding axis falls back to its no-data behaviour.

## Configuration reference

The editor writes this config for you; manual editing is optional.

### Top level

| Option       | Type     | Default            | Description                                  |
| ------------ | -------- | ------------------ | -------------------------------------------- |
| `type`       | string   | —                  | `custom:easy-floorplan-card`                 |
| `title`      | string   | —                  | Optional card header.                        |
| `width`      | number   | `1000`             | Virtual canvas width, in canvas units.       |
| `height`     | number   | `600`              | Virtual canvas height, in canvas units.      |
| `grid`       | number   | `20`               | Gap between grid lines, in canvas units (so on a 1000-wide canvas, `20` ≈ 50 columns). A **smaller** number means a **finer** grid with more lines. |
| `snap`       | number   | follows `grid`     | Snap step for placement / drag / nudge / wall drawing, in canvas units. Omit to snap to the visible grid; set `0` for free placement; set any other number for a custom step. The editor shows a custom step as a **percentage of the grid** (e.g. `50` % of a `20` grid is stored here as `10`), but the value here is always absolute. |
| `rotation`   | number   | `0`                | Rotate the displayed card by `90`, `180` or `270` degrees — e.g. a landscape plan on a portrait wall tablet. Editing always shows the plan as drawn. Icons and labels stay upright. |
| `background` | string   | card background    | Canvas background color (CSS / hex).         |
| `floors`     | Floor[]  | —                  | Per-floor element groups (see **Floors**).   |
| `defaultFloor`| string  | first floor        | Id of the floor shown first.                 |
| `walls`      | Wall[]   | `[]`               | Wall segments (single-floor / floor 1).      |
| `openings`   | Opening[]| `[]`               | Doors and windows (swing or sliding).        |
| `items`      | Item[]   | `[]`               | Entity devices.                              |
| `texts`      | Text[]   | `[]`               | Free text labels.                            |
| `furniture`  | Furniture[]| `[]`             | Gray furniture/fixture diagrams.             |

When `floors` is present each floor carries its own `walls`, `openings`, `items`, `texts`
and `furniture`. The top-level arrays describe a single implicit floor and remain valid
for backward compatibility.

### Floor

`{ id, name, haFloor?, image?, imageOpacity?, walls, openings, items, texts, furniture }`
— a named floor with its own elements. Use the **floor** controls in the editor toolbar
to add, rename, switch and delete floors; the live card shows a floor switcher in the
top-right when there is more than one.

**`haFloor`** optionally stores the id of a linked Home Assistant floor (set from the
editor's floor gear popover). Today the link auto-names the floor; it is kept in the
config so future features (like area-based entity filtering) can build on it.

Set **`image`** to a background image URL (e.g. `/local/floorplan.png` or an external
URL) to draw it behind the elements — handy for tracing over a real floor plan. It fills
the canvas, so match the canvas `width`/`height` to the image's aspect ratio to avoid
distortion. **`imageOpacity`** (0–1, default 1) fades it.

### Wall

`{ id, x1, y1, x2, y2 }` — endpoints in virtual units.

### Opening (door / window)

| Field         | Type                        | Description                                            |
| ------------- | --------------------------- | ------------------------------------------------------ |
| `id`          | string                      | Unique id.                                             |
| `type`        | `door` \| `window`          | The kind of opening.                                   |
| `motion`      | `swing` \| `slide`          | How it moves. `swing` (default) hinged door / casement window; `slide` sliding panels. |
| `x`, `y`      | number                      | Center position.                                       |
| `length`      | number                      | Length along the wall.                                 |
| `angle`       | number                      | Rotation in degrees.                                   |
| `entity`      | string                      | Optional contact `binary_sensor` / `cover` driving open/closed (or `current_position` for partial). |
| `invert`      | boolean                     | Flip the open/closed interpretation.                   |
| `activeColor` | string                      | Leaf/arc color while actively open (default primary).  |
| `flipH`       | boolean                     | Mirror left↔right. Swing door: hinge jamb. Sliding: slide direction. |
| `flipV`       | boolean                     | Mirror across the wall so a swing opening faces the other room. |
| `sliderStyle` | `single` \| `bypass` \| `biparting` | When `motion: slide`: `single` (default) one panel; `bypass` two stacking panels; `biparting` two centre-parting panels. |

### Item (device)

| Field         | Type                                   | Default      | Description                                            |
| ------------- | -------------------------------------- | ------------ | ------------------------------------------------------ |
| `id`          | string                                 | —            | Unique id.                                             |
| `entity`      | string                                 | —            | Entity id to bind.                                     |
| `secondaryEntity` | string                             | —            | Optional 2nd entity shown alongside (e.g. humidity).   |
| `x`, `y`      | number                                 | —            | Position.                                              |
| `kind`        | light/switch/sensor/binary_sensor/climate/cover/generic | inferred | Used for the default icon.            |
| `icon`        | string                                 | entity icon  | Override mdi icon.                                     |
| `name`        | string                                 | friendly name| Label / tooltip override.                             |
| `size`        | number                                 | `34`         | Icon badge diameter (px).                              |
| `angle`       | number                                 | `0`          | Icon rotation (deg).                                   |
| `display`     | `badge` \| `ripple` \| `iconRipple`    | `badge`      | How the device is drawn.                               |
| `rippleColor` | string                                 | primary color| Ripple ring color (ripple modes).                     |
| `rippleSize`  | number                                 | `80`         | Max ripple diameter (px).                              |
| `showIcon`    | boolean                                | `true`       | Show the icon badge.                                   |
| `showState`   | boolean                                | sensors only | Show the entity state label.                           |

Clicking a `light`, `switch`, `cover`, `fan` or `input_boolean` toggles it; other
domains open the more-info dialog.

### Text

`{ id, x, y, text, size?, color?, angle? }` — `size` px (default 16), `color` CSS/hex,
`angle` degrees.

### Furniture

`{ id, type, x, y, w, h, angle?, color? }` where `type` is one of `table`, `roundTable`,
`desk`, `chair`, `sofa`, `bed`, `wardrobe`, `rug`, `plant`, `fridge`, `stove`, `sink`,
`toilet`, `stairs`, `tv`. `color` defaults to gray so furniture reads differently from
walls.

### Tracker

A live (x, y) position estimate driven by one or two orthogonal distance sensors,
animated inside a rectangular tracked area:

```yaml
{ id, x, y, w, h, angle?, color?, dotSize?,
  xSensor?: { entity, min, max, invert?, presence?: { entity, invert? } },
  ySensor?: { entity, min, max, invert?, presence?: { entity, invert? } } }
```

- `x`, `y`, `w`, `h` define the rectangle in canvas units (top-left + size).
- `xSensor` / `ySensor` are each `{ entity, min, max, invert?, presence? }`. The
  card linearly maps `[min, max]` to the rectangle's edges along the sensor's
  axis; `invert` flips the mapping. Both sensors are optional and independent.
- `presence` is an optional binary gate per axis. When set and reporting "clear"
  (or `unavailable` / `unknown`), the marker animation is hidden — useful for
  pairing a distance sensor with the occupancy sibling on the same radar
  device. If **either** axis's presence is clear, the marker hides. `invert`
  flips on/off for inverted-logic sensors (never applied to unavailable /
  unknown).
- With **both** sensors set → a pulsating triangle with ripple rings glides to the
  computed `(x, y)`.
- With **only one** sensor set → a faint pulsating line spans the unknown axis,
  with ripples expanding along it.
- The rectangle itself is **invisible at runtime** (visible only in the editor for
  drawing and resizing); only the marker animation appears in the dashboard.

```yaml
trackers:
  - id: kitchen_radar
    x: 100
    y: 100
    w: 400
    h: 270
    color: "#26c6da"
    xSensor:
      entity: sensor.radar_x_distance
      min: 0
      max: 4.0
      presence: { entity: binary_sensor.radar_occupancy }
    ySensor:
      entity: sensor.radar_y_distance
      min: 0
      max: 2.7
      presence: { entity: binary_sensor.radar_occupancy }
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
  - id: d1
    type: door
    x: 300
    y: 500
    length: 80
    angle: 0
    entity: binary_sensor.front_door   # swings open when the contact opens
    activeColor: "#ef5350"
  - { id: win1, type: window, x: 600, y: 100, length: 140, angle: 0 }
items:
  - { id: i1, entity: light.living_room, x: 240, y: 200, kind: light }
  - id: i2
    entity: binary_sensor.presence
    x: 380
    y: 380
    kind: binary_sensor
    display: iconRipple
    rippleColor: "#26c6da"
    rippleSize: 120
  - id: i3
    entity: sensor.living_room_temperature
    secondaryEntity: sensor.living_room_humidity
    x: 700
    y: 380
    kind: sensor
    showState: true
furniture:
  - { id: f1, type: sofa, x: 250, y: 420, w: 170, h: 72, angle: 0 }
texts:
  - { id: t1, x: 500, y: 60, text: Living Room, size: 22 }
trackers:
  - id: pet
    x: 120
    y: 130
    w: 760
    h: 350
    color: "#26c6da"
    xSensor:
      entity: sensor.radar_x_distance
      min: 0
      max: 7.6
      # Hide the marker when the room is empty (paired occupancy sensor):
      presence: { entity: binary_sensor.living_room_presence }
    ySensor:
      entity: sensor.radar_y_distance
      min: 0
      max: 3.5
      presence: { entity: binary_sensor.living_room_presence }
```

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

Iterating on the editor / card without a Home Assistant instance:

```bash
npm run serve      # opens /dev/ on the Vite dev server with HMR
```

This mounts the **real** `easy-floorplan-card-editor` and `easy-floorplan-card`
side-by-side in a plain HTML page with:

- a minimal `hass` mock + tiny `<ha-card>` and `<ha-icon>` stubs so the card
  renders outside HA — the entity / icon pickers are already feature-detected
  inside the editor and fall back to plain inputs;
- a `config-changed` round-trip between the editor and the live preview, so
  edits in the editor instantly update the card (matching how HA wires it);
- a **Tracker emulator** panel that appears whenever the current config has
  at least one tracker — per-axis sliders write straight into the mock
  `hass.states[entity].state`, and an **Auto-orbit** toggle drives them on
  `requestAnimationFrame` so the pulsating triangle / line animations can be
  observed without HA;
- vite HMR — saving any `src/*.ts` reloads the page (the harness invalidates
  itself on hot updates so duplicate custom-element registrations don't
  happen).

The harness lives entirely under `dev/` (`dev.ts`, `index.html`) and is **not**
included in the production build — `vite build` only entry-points
`src/index.ts`.

Useful flags inside `dev/dev.ts`:

- `START_WITH_DEMO` — flip to `true` to start with a sample room (walls, door,
  window over a background image) instead of a blank floor. Handy for testing
  rendering changes without drawing from scratch.

Pair this with `./deploy-dev.sh <branch>` (a personal, gitignored helper) when
you also want to smoke-test against a real HA install.

## License

[MIT](LICENSE)

[hacs-badge]: https://img.shields.io/badge/HACS-Custom-41BDF5.svg
[hacs-url]: https://github.com/hacs/integration
[release-badge]: https://img.shields.io/github/v/release/nicosandller/easy-floorplan
[release-url]: https://github.com/nicosandller/easy-floorplan/releases
[license-badge]: https://img.shields.io/github/license/nicosandller/easy-floorplan
