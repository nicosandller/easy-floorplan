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
  The zone outline is visible only in the editor — the live card shows just the
  animation.
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

- **select** — the default tool. Click an element to select it; Shift/Ctrl-click or drag
  a box to select several at once. Arrow keys nudge the selection (Shift+arrow jumps a
  full grid cell), and **Ctrl/Cmd+C/V/D** copy / paste / duplicate. With a selection,
  the context row offers **duplicate** and **delete**, and the **Element** section below
  the canvas exposes the full property editor for whatever you have selected.
- **wall** — drag to draw. Endpoints snap to nearby corners; start a new wall on an
  existing corner to continue the perimeter. The context row's **straighten** toggle
  keeps walls horizontal/vertical and corner-snapped (turn it off to draw freely), and
  the **Snap** segmented control (`On` / `Off` / `Custom`) governs snapping for *all*
  tools — `Custom` lets you snap to a percentage of the grid (e.g. 50% = half a cell).
- **door / window** — click to drop; it snaps onto the nearest wall. The context row
  shows a **Length** field for the *next* opening you place, so you can size doors and
  windows before placing them. Assign a sensor after placement (in the **Element**
  section) to animate the opening open/closed — see **Doors & windows**.
- **tracker** — drag to draw a rectangular tracked area, then bind one or two distance
  sensors (X axis and/or Y axis) in the **Element** section to animate a live position
  marker inside the zone — see **Tracker**. The zone outline is visible only in the
  editor; the live card shows just the marker.
- **+ device / + text / + furniture…** — drop a new element; the **Element** section
  below the canvas shows its full property editor so you can configure it right away.
- **floor** — add, rename, switch and delete floors.

Undo/redo and a zoom slider live at the right of the tools row.

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
  to display the current value next to it. Add a **2nd entity** to show two readings in
  one element — e.g. a temperature and a humidity sensor render together as `21 °C · 45 %`.
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

Select the opening and bind a **Sensor** entity in the **Element** section below the canvas —
a contact `binary_sensor` or a `cover` — to make the opening track its real state:

- **Open / closed** — the opening is drawn open when the entity is `on` / `open`, closed
  otherwise. A door's leaf swings around its hinge; a window's two leaves swing outward
  from the middle. When closed the swing arc is hidden; as the opening moves, the arc
  **draws on**, tracing the path of the leaf edge — animated smoothly.
- **Active color** — while actively open, the leaf/sash and arc take an accent color (the
  same idea as presence ripples) so an open door is easy to spot. Defaults to the primary
  color; pick your own per opening.
- **Invert** — flip the open/closed interpretation for sensors wired the other way.

Openings without a sensor keep the static look.

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
| `background` | string   | card background    | Canvas background color (CSS / hex).         |
| `floors`     | Floor[]  | —                  | Per-floor element groups (see **Floors**).   |
| `defaultFloor`| string  | first floor        | Id of the floor shown first.                 |
| `walls`      | Wall[]   | `[]`               | Wall segments (single-floor / floor 1).      |
| `openings`   | Opening[]| `[]`               | Doors and windows.                           |
| `items`      | Item[]   | `[]`               | Entity devices.                              |
| `texts`      | Text[]   | `[]`               | Free text labels.                            |
| `furniture`  | Furniture[]| `[]`             | Gray furniture/fixture diagrams.             |

When `floors` is present each floor carries its own `walls`, `openings`, `items`, `texts`
and `furniture`. The top-level arrays describe a single implicit floor and remain valid
for backward compatibility.

### Floor

`{ id, name, image?, imageOpacity?, walls, openings, items, texts, furniture }` — a named
floor with its own elements. Use the **floor** controls in the editor toolbar to add,
rename, switch and delete floors; the live card shows a floor switcher in the top-right
when there is more than one.

Set **`image`** to a background image URL (e.g. `/local/floorplan.png` or an external
URL) to draw it behind the elements — handy for tracing over a real floor plan. It fills
the canvas, so match the canvas `width`/`height` to the image's aspect ratio to avoid
distortion. **`imageOpacity`** (0–1, default 1) fades it.

### Wall

`{ id, x1, y1, x2, y2 }` — endpoints in virtual units.

### Opening (door / window)

| Field         | Type                | Description                                            |
| ------------- | ------------------- | ------------------------------------------------------ |
| `id`          | string              | Unique id.                                             |
| `type`        | `door` \| `window`  | Symbol drawn.                                          |
| `x`, `y`      | number              | Center position.                                       |
| `length`      | number              | Length along the wall.                                 |
| `angle`       | number              | Rotation in degrees.                                   |
| `entity`      | string              | Optional contact `binary_sensor` / `cover` driving open/closed. |
| `invert`      | boolean             | Flip the open/closed interpretation.                   |
| `activeColor` | string              | Leaf/arc color while actively open (default primary).  |

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
  xSensor?: { entity, min, max, invert? },
  ySensor?: { entity, min, max, invert? } }
```

- `x`, `y`, `w`, `h` define the rectangle in canvas units (top-left + size).
- `xSensor` / `ySensor` are each `{ entity, min, max, invert? }`. The card linearly
  maps `[min, max]` to the rectangle's edges along the sensor's axis; `invert`
  flips the mapping. Both sensors are optional and independent.
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
    xSensor: { entity: sensor.radar_x_distance, min: 0, max: 4.0 }
    ySensor: { entity: sensor.radar_y_distance, min: 0, max: 2.7 }
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
    xSensor: { entity: sensor.radar_x_distance, min: 0, max: 7.6 }
    ySensor: { entity: sensor.radar_y_distance, min: 0, max: 3.5 }
```

## Development

```bash
npm install
npm run build      # bundles to dist/easy-floorplan-card.js
npm run watch      # rebuild on change
```

Releases are built and attached automatically by GitHub Actions when a GitHub release
is published.

## License

[MIT](LICENSE)

[hacs-badge]: https://img.shields.io/badge/HACS-Custom-41BDF5.svg
[hacs-url]: https://github.com/hacs/integration
[release-badge]: https://img.shields.io/github/v/release/nicosandller/easy-floorplan
[release-url]: https://github.com/nicosandller/easy-floorplan/releases
[license-badge]: https://img.shields.io/github/license/nicosandller/easy-floorplan
