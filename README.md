# Easy Floorplan

[![hacs][hacs-badge]][hacs-url]
[![release][release-badge]][release-url]
[![license][license-badge]](LICENSE)

A Home Assistant Lovelace card for building an interactive floorplan — **with a visual
editor**. Draw walls, drop doors and windows, add gray furniture diagrams and text
labels, and place your entities as icons, ripples or live state. Everything scales
automatically to the card and screen size.

> You almost never write YAML by hand — the card ships with a drag-and-drop editor.
> The configuration below is generated for you and shown here for reference.

![screenshot](docs/screenshot.png)
<!-- Replace docs/screenshot.png with a real screenshot or GIF of the editor. -->

## Features

- **Visual editor** — draw walls (endpoints snap to nearby corners to close rooms),
  click to drop doors/windows that snap onto walls, drag everything around, nudge with
  arrow keys, undo/redo, zoom.
- **Devices** — bind any entity to an icon. Click to toggle lights/switches or open the
  more-info dialog. Optional live state label, custom icon (with autocomplete + preview),
  size and rotation.
- **Presence ripples** — render presence/movement sensors as animated concentric rings
  that pulse while active and fade to a faint dot when idle.
- **Furniture** — gray line-art diagrams: table, round table, desk, chair, sofa, bed,
  wardrobe, rug, plant, fridge, stove, sink, toilet, stairs, tv.
- **Text labels** and a configurable **canvas background color**.
- **Auto-scaling** — a virtual coordinate space + SVG means the plan rescales to any
  card or screen size with no reflow.

## Installation

### HACS (recommended)

This is currently distributed as a **custom repository**:

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

Edit a dashboard → **Add card** → search **Easy Floorplan**. Use the toolbar:

- **wall** — drag to draw. Endpoints snap to nearby corners; start a new wall on an
  existing corner to continue the perimeter.
- **door / window** — click to drop; it snaps onto the nearest wall.
- **+ device / + text / + furniture…** — add elements, then edit them in the side panel.
- **select** — move, rotate, resize, recolor, delete. Arrow keys nudge the selection
  (hold **Shift** for 1-unit steps). Undo/redo and a zoom slider are in the toolbar.

## Configuration reference

The editor writes this config for you; manual editing is optional.

### Top level

| Option       | Type     | Default            | Description                                  |
| ------------ | -------- | ------------------ | -------------------------------------------- |
| `type`       | string   | —                  | `custom:easy-floorplan-card`                 |
| `title`      | string   | —                  | Optional card header.                        |
| `width`      | number   | `1000`             | Virtual canvas width.                        |
| `height`     | number   | `600`              | Virtual canvas height.                       |
| `grid`       | number   | `20`               | Editor grid spacing / snap step.             |
| `background` | string   | card background    | Canvas background color (CSS / hex).         |
| `walls`      | Wall[]   | `[]`               | Wall segments.                               |
| `openings`   | Opening[]| `[]`               | Doors and windows.                           |
| `items`      | Item[]   | `[]`               | Entity devices.                              |
| `texts`      | Text[]   | `[]`               | Free text labels.                            |
| `furniture`  | Furniture[]| `[]`             | Gray furniture/fixture diagrams.             |

### Wall

`{ id, x1, y1, x2, y2 }` — endpoints in virtual units.

### Opening (door / window)

| Field    | Type                | Description                          |
| -------- | ------------------- | ------------------------------------ |
| `id`     | string              | Unique id.                           |
| `type`   | `door` \| `window`  | Symbol drawn.                        |
| `x`, `y` | number              | Center position.                     |
| `length` | number              | Length along the wall.               |
| `angle`  | number              | Rotation in degrees.                 |

### Item (device)

| Field         | Type                                   | Default      | Description                                            |
| ------------- | -------------------------------------- | ------------ | ------------------------------------------------------ |
| `id`          | string                                 | —            | Unique id.                                             |
| `entity`      | string                                 | —            | Entity id to bind.                                     |
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
  - { id: d1, type: door, x: 300, y: 500, length: 80, angle: 0 }
  - { id: win1, type: window, x: 600, y: 100, length: 140, angle: 0 }
items:
  - { id: i1, entity: light.tv_area_lights, x: 240, y: 200, kind: light }
  - id: i2
    entity: binary_sensor.presence
    x: 380
    y: 380
    kind: binary_sensor
    display: iconRipple
    rippleColor: "#26c6da"
    rippleSize: 120
furniture:
  - { id: f1, type: sofa, x: 250, y: 420, w: 170, h: 72, angle: 0 }
texts:
  - { id: t1, x: 500, y: 60, text: Living Room, size: 22 }
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
