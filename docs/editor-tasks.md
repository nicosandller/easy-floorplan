# Editor tasks

The editor is where you build the plan: draw the walls, cut the openings, and put your
devices where they sit. These are the five things you do most often. Each one is a short
walkthrough — the controls as they are labelled, and the YAML the editor writes for you.

Back to the [README](../README.md). For the workspace around them — the tool rail, the
inspector, zoom and the phone layouts — see the
[editor workspace guide](editor-workspace.md). For every option each element accepts, see
the [configuration reference](configuration.md).

## Draw walls

Walls are the skeleton: rooms, dead spaces and light all follow from them.

1. Choose **Wall** in the tool rail — or in the **Drawing tool** picker on a narrow screen.
2. Set **Thickness** in the context bar. It stays in effect for every new wall until you
   change it again, in this browser and across plans.
3. Drag from one corner to the next. Each drag is one wall; the end snaps according to the
   **Snap** setting, and the hint states the distance in canvas units.
4. Press **Escape** or choose **Select** to stop drawing.

The editor checks the active floor's walls as you work. A wall end that stops just short of
another, or a wall drawn on top of another, gets an orange ring and a notice above the
context bar; **Join**, **Remove duplicate** and **Trim overlap** fix it in one edit, and
**Undo** reverts it. See [Plan check](editor.md#plan-check).

```yaml
walls:
  - { 'x1': 0, 'y1': 0, 'x2': 480, 'y2': 0 }
  - { 'x1': 480, 'y1': 0, 'x2': 480, 'y2': 360, thickness: 10 }
```

`thickness` defaults to `8` and is capped at `10`: a doorway is cut through the wall layer
with a mask sized off the default, so a wider wall would not be fully cleared by its own
door. See [Wall](configuration.md#wall).

## Place a door or window

1. Choose **Door**, **Window**, **Passage** or **Skylight** in the tool rail.
2. Set **Length** in the context bar before you place it. It applies to the next opening
   you place, so you can size it first.
3. Click on or near a wall. A door, window or passage snaps onto the nearest wall; a click
   with no wall in reach places nothing and the toolbar says so. A **skylight** snaps to
   nothing — click anywhere inside a room and it stays where you put it.
4. Select the opening. In the **Selection** inspector's **Shape** group, set its **type**,
   its **motion** and, for a sliding one, its **Style**.
5. Bind an **Entity** — a contact `binary_sensor` or a `cover` — to make it track the real
   thing. Unbound, it stays a static drawing.

A **passage** is a doorway with no door in it: the card draws the gap and nothing else, and
it is always open. A **skylight** is a hole in the ceiling, so it has two sizes,
**Length** and **Width**, and reads a slightly different set of fields — see
[Roof windows](appearance.md#roof-windows) and [Skylights](lighting.md#skylights).

```yaml
openings:
  - { id: front_door, type: door, 'x': 240, 'y': 0, length: 60, angle: 0, entity: binary_sensor.front_door }
  - { id: patio, type: window, motion: slide, sliderStyle: biparting, 'x': 400, 'y': 500, length: 120, angle: 0, entity: cover.patio_door }
```

For what each opening type reads and draws, see
[Doors, windows, skylights & passages](elements.md#doors-windows-skylights--passages). For
every key, see [Opening](configuration.md#opening-door--window--skylight--passage).

## Bind a sensor

A device is a Home Assistant entity with a spot on the plan.

1. Choose **+ Add → Device**.
2. Move it into place.
3. Select it. The **Selection** inspector's **Identity** group takes the **Entity**
   picker — Home Assistant's own selector, so it lists what you actually have.
4. Turn on **Show state** to put the live value in the label, and **Show name** to put the
   name before it. The canvas draws the same line the card will, so you see it straight
   away.
5. Optional: **+ Add entity** under **Other entities** appends more readings to the same
   device — `21.5 °C · 45% · 1013 hPa`.

A device with no entity still works: it renders as a plain static badge, so hardware Home
Assistant does not know about can still be marked. It never highlights and tapping does
nothing.

```yaml
items:
  - id: bath_humidity
    entity: sensor.bathroom_humidity
    kind: sensor
    'x': 320
    'y': 210
    showName: true
    showState: true
```

Readings, badge contents, colours and state rules are in [Devices](elements.md#devices);
the keys are in [Item (device)](configuration.md#item-device).

## Make a light glow

A lamp can pool its own light onto the plan, so a lit room reads as lit.

1. Select the light's device.
2. In the inspector's **Effects** group, tick **Cast light**.
3. Set **Light radius** — the size of the pool at full brightness. A dimmer lamp casts a
   proportionally smaller pool, down to half this.
4. Optional: **Light color**, for a bulb that cannot report its own. A bulb that can report
   one uses its own colour and brightness, and overlapping pools mix additively.
5. Optional: **Beam width** under 360° turns the pool into a cone for a spot or wall
   washer, and **Beam direction** aims it. **LED strip** casts along a run instead of from
   a point.

The editor's dashed guide shows the configured size, not the current one. Walls block the
pool and open doors let it through — the light follows what the plan actually draws. See
[Cast light](configuration.md#cast-light).

```yaml
items:
  - id: lamp_warm
    entity: light.living_standing_lamp
    kind: light
    'x': 400
    'y': 300
    glow: true
    glowRadius: 200
```

## Add a floor

1. The **Floor** control sits in the canvas heading: a list to switch floors, **+** to add
   one, and a gear for the rest.
2. Press **+**. It adds a floor that copies the current floor's walls, and switches to it.
3. Open the gear — **Floor settings** — to rename or delete the floor, set its **short**
   name for the switcher button, and link it to a Home Assistant floor.
4. Reorder with the gear's **Order** arrows: position in the list is the order of the
   card's switcher.
5. The card shows a floor switcher when there is more than one floor.

Each floor holds its own elements. A staircase can carry the change between floors — set
**Go to floor** on it. See [Stairs that change floor](behavior.md#stairs-that-change-floor).

```yaml
floors:
  - id: ground
    name: Ground floor
    short: GF
    walls: []
    openings: []
    items: []
```

`short` is the switcher button's abbreviation and `color` accents it while the floor is
active. The top-level `defaultFloor` picks which floor the card opens on. See
[Floor](configuration.md#floor).

## Where to go next

- Saving, applying and locking elements: [Editing a floorplan](editor.md).
- The workspace, zoom, snap and phone layouts: [Editor workspace](editor-workspace.md).
- What each element's controls do: [Elements and controls](elements.md).
- Every key: [Configuration reference](configuration.md).
