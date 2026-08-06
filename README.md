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
- **Cast light** — a light can pool its own color and brightness onto the plan from where
  it sits. Several lights in one room each cast their own pool, and overlapping pools
  *mix* — so a warm lamp and a cool lamp blend between them, and you can read the tones
  set across the house at a glance.
- **Animated doors & windows** — link a contact `binary_sensor` or `cover` so doors swing
  and windows open on the plan as their real state changes, with an optional accent color
  while open.
- **Furniture** — gray line-art diagrams: table, round table, desk, chair, sofa, bed,
  wardrobe, rug, plant, fridge, stove, sink, toilet, stairs, tv, washer, dryer,
  dishwasher, water heater, air handler, bathtub, vanity, sectional, fish tank,
  piano, hot tub.
- **Areas** — trace a room's outline point-by-point (points snap to wall corners and to
  neighboring areas' corners) to get a colored, named room polygon. Bind an entity to a
  room and it goes live — green while a presence sensor is occupied, red when a CO2
  sensor crosses a threshold — as a fill, or as the room's own walls lighting up if you
  would rather not tint everything inside it. Naming a room after
  one of your Home Assistant areas (the name field autocompletes against them) links the
  two, which scopes the entity picker — for any device dropped inside it — to that HA
  area's entities, and can bulk-add every device in the area.
- **Live position tracker** — draw a rectangular tracked area and bind one or two
  orthogonal distance sensors (e.g. mmWave / radar). The card linearly maps each
  sensor's `[min, max]` reading to the rectangle's edges and animates a pulsating
  triangle with ripples at the resolved `(x, y)`. With only one sensor configured
  it falls back to a faint pulsating line with ripples along the unknown axis.
  An optional occupancy `binary_sensor` per axis gates the animation so the
  marker hides cleanly when the room is empty. The zone outline is visible only
  in the editor — the live card shows just the animation.
- **Follow the sun** — optionally dim the whole plan through dusk and brighten it through
  dawn, tracking your Home Assistant's own sunrise and sunset rather than the viewer's
  browser. Device icons stay at full brightness, so a night plan reads as a dark house
  with its lit rooms glowing.
- **Skins** — restyle the whole plan from one line of config: `default` follows your Home
  Assistant theme, `odnetnin` is playful and chunky, `pastel` is soft and low-contrast,
  `tron` is neon on near-black. Colours you set on an element yourself always win. See
  **Skins**.
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

<img width="1550" height="761" alt="Screenshot 2026-08-05 at 2 54 49 PM" src="https://github.com/user-attachments/assets/7130f94f-f591-486b-bf9d-ecf137b653a9" />


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
  a box to select several at once. Where elements **overlap**, the first click takes the
  most specific one (a device beats the tracker zone it sits in), and clicking again
  without moving steps to the next element underneath, wrapping around — so nothing is
  ever unreachable. Move the pointer and the next click starts over. Arrow keys nudge the selection (Shift+arrow jumps a
  full grid cell); **Ctrl/Cmd+C/V/D** copy / paste / duplicate — pasting also works
  across floors (copy, switch floor, paste); **Ctrl/Cmd+Z** undoes
  (**Shift+Z** or **Ctrl+Y** redoes); **Escape** cancels an in-progress draw or clears
  the selection. The **Element** section below the canvas names the selection
  (e.g. *Door · 60 units*) and carries its **duplicate** / **delete** buttons along
  with the full property editor.
- **Wall** — drag to draw. Endpoints snap to nearby corners; start a new wall on an
  existing corner to continue the perimeter. The context row's **straighten** toggle
  keeps walls horizontal/vertical and corner-snapped (turn it off to draw freely), and
  the **Snap** segmented control (`On` / `Off` / `Custom`) governs snapping for *all*
  tools — `Custom` lets you snap to a percentage of the grid (e.g. 50% = half a cell).
  Rooms **stretch** instead of tearing: dragging a wall — or one of its corner
  handles — carries every wall corner that touches it, so you can widen a room by
  just pulling its wall. Hold **Alt** while dragging to detach and move only the
  grabbed wall.
- **Door / Window** — click to drop; it snaps onto the nearest wall. The context row
  shows a **Length** field for the *next* opening you place, so you can size doors and
  windows before placing them. Assign a sensor after placement (in the **Element**
  section) to animate the opening open/closed — see **Doors & windows**.
- **Tracker** — drag to draw a rectangular tracked area, then bind one or two distance
  sensors (X axis and/or Y axis) in the **Element** section to animate a live position
  marker inside the zone — see **Tracker**. The zone outline is visible only in the
  editor; the live card shows just the marker.
- **Area** — click to place each corner of a room outline; points snap onto nearby wall
  corners or another area's corners, and clicking back on the starting point closes the
  shape (3+ points required; Backspace removes the last point while drawing, Escape
  discards the whole outline). Once placed, drag anywhere inside the fill to move the
  whole room, or drag a corner handle to reshape it — see **Areas**. Bind an **Entity** in
  the Element section and the room's conditional-color controls appear beside it — **Active
  color**, **Active opacity**, **Highlight**, and the **Color by state** rule list — the same
  set devices and furniture already offer.
- **+ Add** — one popover for everything droppable: device, text, and all furniture
  types shown as their actual glyphs (pick a sofa by seeing a sofa). The new element is
  selected immediately so the **Element** section is ready for configuring it.
- **floor** — switch floors with the dropdown, add one with **+**; rename, **reorder**
  (▲/▼ move the current floor up/down the list — the order of the dropdown and the
  card's floor switcher) and delete live behind the gear button. The gear also offers
  an **HA floor** dropdown listing your Home Assistant floors — linking one names the
  plan floor after it (rename afterwards if you like; the link sticks either way).
  Prefer the ▲/▼ buttons over reordering floor blocks in YAML: hand-editing easily
  drops or duplicates floor `id`s (the card now repairs both, but edits made while
  ids collide can land on the wrong floor).

When a device sits inside an **Area** linked to a Home Assistant area, its entity pickers
list only that area's entities — and the room is highlighted on the canvas (a breathing
tint with a marching-ants border) with a matching note above the fields carrying a **Show all**
link, so it's obvious *why* the list is short and it takes one click to widen it. An area with nothing assigned to it in HA
filters nothing, the entity already bound always stays pickable, and an element outside
every area is never filtered.

Devices on the canvas carry **the same label line the live card will draw** — the name
and/or the state, per that device's **Show name** / **Show state** — so turning one of
those on is something you can see straight away rather than only after leaving the editor.
A device set to show neither still gets a label here, dimmed, to keep it tellable apart
while you drag it around; that greyed-out one is editor-only and the card draws nothing.

The **Labels** toolbar toggle hides either kind on the canvas — useful on a
dense plan where labels overlap the things you are trying to click. It only affects the
editor view; the live card is unchanged.

Undo/redo buttons sit at the right of the tools row. Zoom controls live on the canvas
itself (bottom-right): **−** / **+** step, click the percentage to reset, the fit button
snaps back to 100%, and **Ctrl/Cmd+scroll** zooms from the keyboard/trackpad. On touch
screens, **pinch** directly on the canvas — it zooms just the plan (anchored between
your fingers), not the whole editor. The **Project** section (canvas size, grid,
background) is collapsed by default — click its header to expand. Its last row,
**Rotate display**, turns the *live card* in 90° steps for portrait wall tablets — the
editor keeps showing the plan as drawn, and icons and labels stay upright at any
rotation.

## Elements

Everything you place on the plan is an **element** you can select, move (freely or
snapped to a grid), nudge with arrow keys, copy/paste, duplicate and delete. The element
types are **devices**, **doors & windows**, **furniture**, **text**, **areas** and
**trackers** — and each floor holds its own set of them.

### Devices

A **device** binds a Home Assistant entity to a spot on the plan. Add one with
**+ device**, then pick the entity in the **Element** section below the canvas.
By default it shows an icon badge:

- **Tap to act** — lights, switches, fans and `input_boolean`s toggle on tap;
  covers open the more-info dialog instead (an accidental tap must not move a
  shutter — set **Tap action** to *Toggle* to opt back in);
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
  custom **name**, change the **size**, or **rotate** it. The icon sits at the bottom
  of the device's options, next to the state rules that can swap it.
- **One badge control** — **Badge shows** is the single dropdown for what the device
  draws: an icon (**still**, **spinning** or **pulsing**), its **Value**, or **Nothing**
  at all.
- **Icons that move** — while an entity is active its icon can animate, the way
  Home Assistant's own Tile card does it: a running **fan** spins and an active
  **media player** (playing, or simply on) or **vacuum** (cleaning / returning) pulses,
  with no setup — those devices simply open on *Icon, spinning* / *Icon, pulsing*.
  Change the dropdown to turn it off, or to force an animation on any other entity
  (a spinning icon still only plays while the entity is actually active — an
  unavailable fan never spins). Respects the OS *reduced motion* preference.
- **Label line** — **Show state** displays the live value (sensors do this by
  default); **Show name** adds the device's name — handy for a panel of look-alike
  buttons where a state would say nothing. Both together read `Name · state`, and
  **Label size** adjusts the line's font size.
- **Attributes, not just states** — set **Attribute** to show an attribute instead
  of the state (a climate's `current_temperature` rather than "heat"), and
  **2nd attribute** for a second reading from the same device — so one climate
  entity renders `21.5 °C · 45%`. Formatted by HA's own attribute formatter.
- **Active color** — every active device is the theme's yellow by default, which
  makes a wall of lights, covers and switches hard to read. Set **Active color**
  per device to tell them apart at a glance — lights yellow, covers purple,
  thermostats orange. Ripples follow it unless you set a ripple color too.
- **Lights badge themselves** — a bulb that reports an `rgb_color` wears it: a lamp set to
  green gets a green badge, and the badge darkens as the lamp dims, so you can read the
  room's lighting from the badges alone. Nothing to configure, and nothing changes for a
  bulb that has no color to report (a plain on/off or brightness-only light keeps the theme
  color). The full order is **state rules → Active color → the bulb's own color → the
  theme** — anything you set by hand still wins.
- **The icon stays readable** — the glyph (or the value) picks black or white to suit
  whatever the badge ended up painted, so a white state color no longer hides a white icon
  on a dark theme. A color the card can't resolve on its own — `var(--accent)`,
  `color-mix(...)`, a gradient — keeps the theme's text color as before.
- **Value in the badge** — set **Badge shows** to *Value* and the device draws its
  reading inside the badge instead of an icon: a thermostat reads `21°` in the same
  circle your state rules already paint red while it's heating, with no text line
  hanging underneath. The card picks the reading per domain, so there is nothing to
  configure — a climate shows its current temperature (its *state* is the mode,
  "heat"), a humidifier its humidity, a sensor its own value. Long units are dropped
  to keep the number legible: `°C` becomes `°`, CO₂ reads plainly as `780`.

  An **Attribute** you set wins when it's a number, so you can colour by one reading
  and display another — `attribute: hvac_action` colours the badge by whether the
  boiler is firing while the badge still shows the temperature. For a smart plug, point
  **2nd entity** at its power sensor: the badge reads `1.2kW` and tapping still toggles
  the switch. A device with no number anywhere keeps its icon, so this can never leave
  an empty circle. *Nothing* is the third setting — no badge at all, label only.

  **Which entity gets read** is worked out for you: the first of the device's entities
  with a number to show wins, which is why the plug above needs no configuration — its
  switch reads "on", not a number, so the badge falls through to the power sensor. When
  the device has a **2nd entity**, a **Badge reads** dropdown appears naming both, so you
  can overrule that — necessary when the main entity has a number of its own and you want
  the other one. Once you pick, the card reads that entity and only that entity: if it has
  nothing to show the badge falls back to its icon rather than quietly showing the other
  one instead.
- **Color and icon by state** — the **Color & icon by state** rules restyle the element
  by what the entity reads: both the **icon badge** and the label, whether or not the
  entity is "on" (a temperature sensor never is). Each rule can also swap the **icon**,
  so blinds get an open glyph and a closed one:

  ```yaml
  stateColor:
    - state: open
      color: "#4caf50"
      icon: mdi:blinds-open
    - state: closed
      color: "#9e9e9e"
      icon: mdi:blinds
  ```

  `icon` is optional — a rule without one only changes the colour, exactly as before.
  A matching rule's icon beats the device's fixed **icon** override, which is what makes
  a custom icon and state-dependent icons usable together; previously setting one froze
  the glyph for good. (Covers that carry a **device class** already get open/closed icons
  with no rules at all — this is for everything else, and for a third state.)

  Add rules in the editor, or in YAML:

  ```yaml
  stateColor:
    - above: 26
      color: red
    - above: 24
      color: orange
    - color: white   # default
  ```

  The highest matching `above` wins; non-numeric values use the default rule.
  A rule can also match an exact state instead of a threshold, for entities
  whose value is a word rather than a number:

  ```yaml
  stateColor:
    - state: open
      color: red
    - color: green
  ```

  An exact `state` match beats a threshold. Colors go through the same
  injection allowlist as every other config color.

  State rules **take precedence over `activeColor`** (and the ripple follows them, so
  a device is never badged one color and ringed another), so the editor hides the
  **Active color** field once rules exist rather than leaving a control that would
  silently lose.

  A rule's `icon` works the other way round: it is optional, and a rule without one
  keeps the device's own **Icon** — so colouring by state costs you nothing if the
  glyph never changes, and you never name the same icon in every row. That is why the
  **Icon** field stays visible next to the rules (it is still what they fall back to)
  while **Active color** disappears.
- **Only when active** — tick it and the device disappears from the card while its
  entity is off/idle, so a busy room only shows what's actually doing something.
  "Active" is the same domain-aware test the badge highlight uses (a lock counts as
  active when *unlocked*, a vacuum while cleaning), and an unavailable entity counts as
  inactive. The editor always draws these devices — faded, with a dashed badge — so you
  can still find and edit them.
- **No entity? Still on the map** — a device with no entity bound renders as a plain
  badge (its icon override or kind default), so hardware that has no Home Assistant
  entity — a dumb smoke detector, a wired doorbell — can still be marked on the plan.
  It never highlights and tapping does nothing.

### Presence ripples

Turn on a device's **Ripple** toggle and it draws animated concentric rings behind the
badge — set **Badge shows** to *Nothing* for the rings alone:

- **Active** (presence detected — the sensor reads on, the tracker reads home) → the
  rings continuously pulse outward and fade, drawing the eye to where motion is
  happening.
- **Idle** (clear) → the rings stop and only a faint dot remains, so the spot stays
  marked without being distracting.

You can set the **ripple color** and **ripple size** per device, so e.g. a calm blue
ring in the living room and a warmer one by the entrance.

The toggle only appears on devices that detect presence — a `binary_sensor` whose
**device class** is `motion`, `occupancy` or `presence`, or a `device_tracker` /
`person` — the same way **Cast light** only appears on lights. A ring is a claim that
someone is there, so it is offered where that claim can be true. The underlying
`display` key still works on any entity if you write it in YAML.

<img width="540" height="304" alt="ripple_demo_gif" src="https://github.com/user-attachments/assets/e43949cf-13a2-48f8-804d-73738299475f" />

### Doors & windows

Drop a **door** or **window** from the toolbar and it snaps onto the nearest wall. On its
own a door is drawn open (the familiar swing arc) and a window closed — a static floor
plan, just like before.

Select the opening and bind an **Entity** in the **Element** section below the canvas — a
contact `binary_sensor` or a `cover` (Home Assistant's domain for anything that opens: doors,
gates, garages, blinds, shades, shutters, curtains…) — to make the opening track its real
state. When you bind an entity the card reads its HA **`device_class`** and sets a sensible
`type`/`motion` for you (a `window` cover → a window; a `blind` → a slider; a `garage`
or `shutter` roller → a **roll-up**); adjust either afterwards. Once bound, the opening
tracks state:

- **Open / closed** — the opening is drawn open when the entity is `on` / `open`, closed
  otherwise. A door's leaf swings around its hinge; a window's two leaves swing outward
  from the middle — or set **Sashes** to *Single* for a one-sash window (hinged at
  either jamb via **Hinge**).
- **External shutters** — an opening and its shutter share one wall gap: bind the
  window's contact sensor as **Entity** and the shutter as **Shutter** (a `cover`, or
  a `binary_sensor` contact). Two kinds are drawn, picked by **Shutter type**:
  *Hinged* — louvered panels outside the wall that fold back against the façade
  (persiane/scuri) — and *Roll-up* — a slatted curtain that disappears upward
  (tapparella). It defaults from the entity: a contact sensor can only say
  open/closed, so it draws hinged; a position-carrying `cover` draws roll-up. The
  opening and its shutter render independently, so an open window behind a closed
  shutter shows both truthfully. Doors can have shutters too. When closed the swing arc is hidden; as the opening moves, the arc
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

### Areas

An **area** is a colored, named room polygon you trace on top of your walls — handy for
telling rooms apart at a glance, and for scoping which entities show up when you drop a
device into one.

1. Pick the **Area** tool from the toolbar.
2. Click to place each corner of the room. Points snap onto nearby wall corners — and
   onto other areas' corners, so adjoining rooms can share an exact boundary point.
3. Once you've placed at least 3 points, click back on the **first** point to close the
   shape. **Backspace** removes the last point while you're still drawing; **Escape**
   discards the whole outline.
4. With the area selected, the **Element** section offers:
   - **Name** and **Show name** — a label centered on the room; toggle it off if you'd
     rather keep the plan uncluttered. The name field autocompletes against your Home
     Assistant areas, and **naming the room after one links it**: a **Linked** badge
     appears next to the field, and the options below unlock. Any other text is just a
     label. Picking from the list adopts the HA area's exact spelling, so typing
     "living room" still shows as "Living Room" on the plan. To keep a name but drop the
     link, click the **×** on the Linked badge.
   - **Fill opacity** and a **color** picker — the translucent fill that makes the room
     stand out (falls back to the theme primary color).
   - **Filter entities** — shown once an HA area is linked; a plain checkbox, on by
     default. Turn it off to keep the name link without narrowing the entity picker.
   - **Add all devices in this HA area** — shown once an HA area is linked; one click
     drops a device for every entity registered to that HA area that isn't already
     placed on this floor, laid out across the room so the new icons spread out instead
     of stacking on top of each other. The button shows how many are pending and
     disables itself once there's nothing left to add; click it again later (after
     adding entities in Home Assistant) to top up.

**Reshaping.** Drag anywhere inside the fill to move the whole room; drag a single corner
handle to reshape it (each handle snaps the same way a freshly placed point does). There's
no cross-room "shared corner" dragging — a corner that happens to coincide with another
area's or a wall's corner doesn't drag together with it, only *snaps* there when you place
or move it.

**Entity filtering.** Drop a **device** (via **+ Add**) inside an area linked to an HA
area (with **Filter entities** on), and that device's entity picker narrows to entities
registered to that HA area — so you're not scrolling past your whole house to find the
right light. The picker widens back up the moment you drag the device outside the polygon,
or if you flip **Filter entities** off. Overlapping areas resolve by draw order: whichever
area was drawn last wins for both the fill you see on top and which one a device is
considered "inside".

```yaml
areas:
  - id: living_room
    name: Living Room
    haArea: living_room
    color: "#26c6da"
    opacity: 0.15
    points:
      - { x: 100, y: 100 }
      - { x: 900, y: 100 }
      - { x: 900, y: 500 }
      - { x: 100, y: 500 }
```

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
| `sunDimming` | boolean | `false` | Dim the plan through dusk and brighten it through dawn, following the **Home Assistant instance's** sunrise and sunset (not the browser's). See **Follow the sun**. |
| `sunBrightnessMin` | number | `0.45` | Plan brightness once the sun is fully down, 0–1. Only used when `sunDimming` is on. |
| `sunBrightnessMax` | number | `1` | Plan brightness in full daylight, 0–1. Only used when `sunDimming` is on. |
| `skin`       | string   | `default`          | Built-in look for the whole plan: `default`, `odnetnin`, `pastel` or `tron`. See **Skins**. |
| `background` | string   | skin / card bg     | Canvas background color (CSS / hex). Overrides the skin's paper. |
| `floors`     | Floor[]  | —                  | Per-floor element groups (see **Floors**).   |
| `defaultFloor`| string  | first floor        | Id of the floor shown first.                 |
| `walls`      | Wall[]   | `[]`               | Wall segments (single-floor / floor 1).      |
| `openings`   | Opening[]| `[]`               | Doors and windows (swing or sliding).        |
| `items`      | Item[]   | `[]`               | Entity devices.                              |
| `texts`      | Text[]   | `[]`               | Free text labels.                            |
| `furniture`  | Furniture[]| `[]`             | Gray furniture/fixture diagrams.             |
| `trackers`   | Tracker[]| `[]`               | Live position trackers (see **Tracker**).    |
| `areas`      | Area[]   | `[]`               | Named room polygons (see **Area**).          |

When `floors` is present each floor carries its own `walls`, `openings`, `items`, `texts`,
`furniture`, `trackers` and `areas`. The top-level arrays describe a single implicit floor
and remain valid for backward compatibility.

### Floor

`{ id, name, short?, color?, haFloor?, image?, imageFit?, imageOpacity?, walls, openings, items, texts, furniture, trackers, areas }`
— a named floor with its own elements. Use the **floor** controls in the editor toolbar
to add, rename, switch and delete floors; the live card shows a floor switcher in the
top-right when there is more than one.

The floor gear popover also sets (issue #67): **Short** — an abbreviation shown on the
card's switcher button (`GF`, `1st`…) while the full name stays as its tooltip;
**Color** — an accent for that button while its floor is active (goes through the
config-color allowlist); and **Default** — which floor the live card opens on
(stored as the top-level `defaultFloor`).

While editing, the preview keeps showing whichever floor you switched it to, instead of
snapping back to the default one after every change.

**`haFloor`** optionally stores the id of a linked Home Assistant floor (set from the
editor's floor gear popover). Today the link auto-names the floor; it is kept in the
config so other features (like the per-**Area** HA-area entity filtering above) can build
on the same idea one level down.

Set **`image`** to a background image URL (e.g. `/local/floorplan.png` or an external
URL) to draw it behind the elements — handy for tracing over a real floor plan.
**`imageOpacity`** (0–1, default 1) fades it.

**`imageFit`** controls how that image maps onto the canvas. The canvas `width`/`height`
are set once for the whole card, but `image` is per floor — so if your scans differ in
resolution, no single canvas ratio suits them all and some floors would be squashed.
`imageFit` is per floor so each scan can choose for itself:

| `imageFit` | What it does |
| --- | --- |
| `stretch` *(default)* | Fills the canvas, distorting if the ratios disagree. |
| `contain` | Scales to fit, keeping proportions — may leave the canvas showing on two sides. |
| `cover` | Fills the canvas keeping proportions, cropping the overflow. |

The default stays `stretch` on purpose: plans traced over a stretched image would shift
away from their walls if the fit changed under them. Set it to `contain` on a floor whose
image looks squashed.

One caveat: `imageFit` settles the image-against-canvas ratio, but the whole card is still
stretched into whatever box your dashboard gives it. If that box's proportions differ from
`width`/`height`, everything — image and elements alike — stretches together, and a
`contain` image will look distorted again. Keep the card's `width`/`height` close to the
shape it occupies on screen.

### Wall

`{ id, x1, y1, x2, y2 }` — endpoints in virtual units.

### Opening (door / window)

| Field         | Type                        | Description                                            |
| ------------- | --------------------------- | ------------------------------------------------------ |
| `id`          | string                      | Unique id.                                             |
| `type`        | `door` \| `window`          | The kind of opening.                                   |
| `motion`      | `swing` \| `slide` \| `roll` | How it moves. `swing` (default) hinged door / casement window; `slide` sliding panels; `roll` roll-up cover (garage / roller shutter) drawn as a slatted curtain that thins onto its track as it opens. |
| `sash`        | `single` \| `double`        | Swing windows only: one full-width sash or the classic two leaves. Default `double`. |
| `shutterEntity` | string                     | An external shutter over the same gap — a `cover` or a `binary_sensor` contact — layered on the sash with its own open/closed state. |
| `shutterStyle` | `swing` \| `roll`           | How that shutter is drawn: hinged louvered panels, or a roll-up curtain. Defaults from the entity (`binary_sensor` → `swing`, `cover` → `roll`). |
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
| `entity`      | string                                 | —            | Entity id to bind. Optional: without one the device renders as a static badge. |
| `secondaryEntity` | string                             | —            | Optional 2nd entity shown alongside (e.g. humidity).   |
| `attribute`   | string                                 | —            | Show this attribute of `entity` instead of its state (e.g. `current_temperature`). |
| `secondaryAttribute` | string                          | —            | Attribute for the 2nd reading — from `secondaryEntity`, or from `entity` when none. |
| `stateColor`  | rule[]                                 | —            | Colors for the badge and label (regardless of on/off; beats `activeColor`): `[{above: 26, color: red}, {color: white}]`. A rule matches `above: <n>` or `state: <value>`; an exact state beats a threshold, the highest matching `above` beats a lower one, and a rule with neither is the default. A rule may also carry an optional `icon`, which beats the device's own `icon` while that rule matches. |
| `x`, `y`      | number                                 | —            | Position.                                              |
| `kind`        | light/switch/sensor/binary_sensor/climate/cover/media_player/fan/camera/lock/humidifier/vacuum/generic | inferred | Used for the default icon. |
| `icon`        | string                                 | entity icon  | Override mdi icon.                                     |
| `name`        | string                                 | friendly name| Label / tooltip override.                             |
| `size`        | number                                 | `34`         | Icon badge diameter (px).                              |
| `angle`       | number                                 | `0`          | Icon rotation (deg).                                   |
| `display`     | `badge` \| `ripple` \| `iconRipple`    | `badge`      | How the device is drawn. The editor spells this as the **Ripple** toggle (plus **Badge shows: Nothing** for `ripple`), and offers it on presence devices only — in YAML it works on any entity. |
| `iconAnimation` | `auto` \| `none` \| `spin` \| `pulse` | `auto`       | Animate the icon while active. `auto`: fan spins; media player / vacuum pulse. The editor spells this as the icon options of **Badge shows**, showing `auto` as the animation it resolves to rather than offering the word. |
| `activeColor` | string                                 | theme color  | Badge color while the device is on — lets domains be told apart at a glance. Ignored while `stateColor` rules match. |
| `rippleColor` | string                                 | `activeColor`| Ripple ring color (ripple modes). Falls back to `activeColor`, then the primary color. |
| `rippleSize`  | number                                 | `80`         | Max ripple diameter (px).                              |
| `glow`        | boolean                                | `false`      | Cast a pool of light onto the plan from this device (lights only). See **Cast light**. |
| `glowRadius`  | number                                 | `140`        | Radius of the cast pool at full brightness, in canvas units. A dimmer lamp casts a proportionally smaller pool, down to half this. |
| `glowColor`   | string                                 | `#ffd9a0`    | Color for a bulb that can't report one. A color-capable light always uses its own. |
| `badgeContent` | `icon` \| `value` \| `none`           | `icon`       | What the badge holds. `value` draws the device's reading inside it (see **Value in the badge**), falling back to the icon when there is no number; `none` hides the badge, leaving the label. |
| `badgeEntity` | `primary` \| `secondary`               | automatic    | Which entity a `value` badge reads. Unset picks the first with a number to show. Set, only that entity is read — no falling back to the other. |
| `showIcon`    | boolean                                | `true`       | **Deprecated** — superseded by `badgeContent`. Still honoured when `badgeContent` is unset: `false` means `none`. |
| `hideWhenInactive` | boolean                           | `false`      | Hide the device on the card while its entity is inactive (issue #55). Always shown, dimmed, in the editor. |
| `showState`   | boolean                                | sensors only | Show the entity state in the label line.               |
| `showName`    | boolean                                | `false`      | Show the device's name in the label line (`Name · state` when combined). |
| `labelSize`   | number                                 | `12`         | Label line font size (px).                             |

Clicking a `light`, `switch`, `cover`, `fan` or `input_boolean` toggles it; other
domains open the more-info dialog.

#### Cast light

Set `glow: true` on a light and it pools its own color and brightness onto the plan,
centered where the device sits. The light falls **where the lamp is**, not across the
whole room — so several lights in one room each cast their own pool, and where the pools
overlap they **mix additively**: a warm lamp and a cool one blend to a neutral tone
between them, exactly as they would in the room. That's something a single room-wide fill
can't express, and it's what makes an open-plan space read correctly.

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

Lights differ in what they can report, so this degrades in rungs and every light does
something sensible:

| The light | The pool |
| --- | --- |
| Reports a color (`rgb`, `xy`, or even `color_temp`) | Its own color, strength from `brightness` |
| Brightness only | `glowColor` (warm white), strength from `brightness` |
| On/off only | `glowColor`, at full strength |
| Off, `unavailable` or `unknown` | Casts nothing |

Home Assistant derives an `rgb_color` even for `color_temp`-only bulbs, so a warm-white
bulb still reads as amber. Brightness maps into a **0.18–0.6** opacity band rather than
0–1: a lamp dimmed to 10% would otherwise be invisible.

**Brightness also sets how far the light reaches**, not just how strong it is — dimming a
lamp draws its pool in, the way dimming one does in a room. `glowRadius` is the size at
**full brightness**, and the pool shrinks to no less than half that as the lamp dims, so a
lamp at 5% still reads as a dim lamp rather than vanishing under its own icon. A bulb that
reports no brightness (plain on/off) always casts the full radius. The dashed radius guide
in the editor shows the configured, full-brightness size — it is the handle for the value
you are setting.

The pools are drawn above the room fills but below furniture and walls, so light reads as
cast onto the floor rather than painted over the plan. `glow` is independent of the icon —
combine it with `showIcon: false` for light with no badge, or with `hideWhenInactive` to
drop both when the light is off.

**Walls block the light.** A pool is clipped to what the lamp can actually see, so it stops
at the walls of its room instead of washing into the next one, and spills through a doorway
gap the way real light does. The result is an irregular shape rather than a clean circle —
that's the point. A lamp with no wall inside its radius stays a plain circle.

**Light lands on furniture, at half strength.** A table under a lit lamp is lit — but it
picks up only about half the color cast the open floor beside it gets, so it still reads as
furniture rather than turning into the color of the light. This is a deliberate middle:
furniture line art is translucent, so at full strength a warm pool shone straight through
and every sofa in the room looked highlighted, while cutting furniture out of the pool
entirely made a lit table *darker* than the floor around it — a shadow. Only entity-bound
furniture with `stateColor` / `activeColor` ever changes color outright.

Pools never intercept clicks — a device under a lit lamp stays tappable, and in the editor
rooms under one stay selectable.

### Text

`{ id, x, y, text, size?, color?, angle? }` — `size` px (default 16), `color` CSS/hex,
`angle` degrees.

### Furniture

`{ id, type, x, y, w, h, angle?, color?, entity?, activeColor?, stateColor? }` where
`type` is one of `table`, `roundTable`, `desk`, `chair`, `sofa`, `bed`, `wardrobe`,
`rug`, `plant`, `fridge`, `stove`, `sink`, `toilet`, `stairs`, `tv`. `color` defaults
to gray so furniture reads differently from walls.

Furniture can bind an **entity** to make the drawing live: `stateColor` and
`activeColor` then recolor the whole diagram the same way they do a device label.
A plant with a soil sensor goes red when it needs watering; a fish tank turns on
a water-temperature threshold; a cabinet with a contact sensor highlights while
its door is open.

```yaml
{ id: plant1, type: plant, x: 300, y: 220, w: 40, h: 40,
  entity: sensor.ficus_soil_moisture,
  stateColor:
    - above: 80
      color: green
    - above: 65
      color: yellow
    - color: red }
```

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

### Area

`{ id, points, name?, showName?, color?, opacity?, haArea?, filterEntities?, entity?, stateColor?, activeColor?, activeOpacity?, borderColor?, borderWidth?, highlight? }`

- `points` — an array of `{ x, y }` vertices (canvas units), in drawing order; the shape
  is implicitly closed from the last point back to the first.
- `name` — display label, shown centered on the polygon when `showName` (default `true`)
  is on. Mirrors the linked HA area's name when `haArea` is set.
- `color` / `opacity` — the room's fill; `color` falls back to the theme primary color,
  `opacity` defaults to `0.25`.
- `haArea` — optional id of a linked Home Assistant area. The editor sets this when the
  polygon's `name` matches one of your HA areas — see **Areas**.
- `filterEntities` — with `haArea` set, scopes the entity picker (for any device placed
  inside this polygon) to that HA area's entities. Default `true`; has no effect without
  a linked `haArea`.
- `entity` — optional entity that makes the room itself live, in the same shape furniture
  uses. Drives `stateColor` and `activeColor`; an unbound area stays a static polygon.
  Setting it in the editor reveals the colour controls below — on its own it changes
  nothing, since there is no colour yet for it to resolve.
- `stateColor` — threshold/state rules for the fill (same shape as a device's
  `stateColor`). Evaluated against `entity`'s state; takes precedence over `activeColor`
  and `color`.
- `activeColor` — fill color while `entity` is active, used when no `stateColor` rule
  matches.
- `activeOpacity` — fill opacity while `entity` resolves a color. Lets a room lift out of
  the plan while it is live without permanently darkening it. Falls back to `opacity`.
- `borderColor` / `borderWidth` — a static outline for the room. No outline is drawn by
  default; `borderWidth` defaults to `3` canvas units once a color is set. (A *live*
  outline — see `highlight` — has its own default of `4`, for the reason given below.)
- `highlight` — where a live color paints: `fill` (default), `border`, or `both`. Use
  `border` for a room that outlines itself while occupied without tinting everything
  inside it, which reads better on a busy plan.

  An area's outline is drawn **on top of the walls it traces**, so `border` colors the
  room's own walls rather than hiding a line underneath them. Doorways and windows are
  cut out of the outline exactly as they are cut out of the wall.

  A live outline is clipped to its own room, so rooms never paint each other: a wall
  between two rooms splits down the middle and each side reports its own room, and a
  corner where several rooms meet splits between them. An exterior wall colors on its
  inside face only, leaving the plan's silhouette intact. `borderWidth` is the width
  you actually see on the room's own side, and defaults to `4` here rather than the `3`
  a static `borderColor` uses — it is the room's own half of the wall, the wall being
  centred on the line the polygon follows. Widen it and the band runs past the wall onto
  the floor and over furniture standing against it.

```yaml
areas:
  - id: living_room
    name: Living Room
    haArea: living_room
    color: "#26c6da"
    opacity: 0.15
    points:
      - { x: 100, y: 100 }
      - { x: 900, y: 100 }
      - { x: 900, y: 500 }
      - { x: 100, y: 500 }

  # The room lights up green while it is occupied, and lifts to a stronger
  # fill so it reads at a glance.
  - id: kitchen
    name: Kitchen
    haArea: kitchen
    entity: binary_sensor.kitchen_occupancy
    activeColor: "#4caf50"
    opacity: 0.12
    activeOpacity: 0.35
    points:
      - { x: 100, y: 500 }
      - { x: 500, y: 500 }
      - { x: 500, y: 900 }
      - { x: 100, y: 900 }

  # Outline-only highlight: the hall's own walls turn green while it is
  # occupied and its fill never changes. activeOpacity is a fill concern, so it
  # does not apply here. Without borderWidth the outline matches the wall it is
  # painted over; 4 draws a thinner line down the middle of that wall instead.
  - id: hall
    name: Hall
    entity: binary_sensor.hall_occupancy
    activeColor: "#4caf50"
    highlight: border
    points:
      - { x: 500, y: 100 }
      - { x: 900, y: 100 }
      - { x: 900, y: 500 }
      - { x: 500, y: 500 }

  # Or bind a numeric sensor and threshold it, so the whole room reddens
  # when air quality goes bad.
  - id: study
    name: Study
    entity: sensor.study_co2
    stateColor:
      - { above: 1200, color: "#e1243b" }
      - { above: 800, color: "#ff9300" }
      - { color: "#58d32f" }
    points:
      - { x: 500, y: 500 }
      - { x: 900, y: 500 }
      - { x: 900, y: 900 }
      - { x: 500, y: 900 }
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
areas:
  - id: a1
    name: Living Room
    haArea: living_room
    color: "#26c6da"
    opacity: 0.15
    points:
      - { x: 100, y: 100 }
      - { x: 900, y: 100 }
      - { x: 900, y: 500 }
      - { x: 100, y: 500 }
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

## Follow the sun

Set **`sunDimming: true`** and the plan dims through dusk and brightens through dawn.

```yaml
type: custom:easy-floorplan-card
sunDimming: true
sunBrightnessMin: 0.45   # brightness once the sun is fully down (default 0.45)
sunBrightnessMax: 1      # brightness in full daylight (default 1)
```

It reads **`sun.sun`'s `elevation`** — the angle of the sun above the horizon, which Home
Assistant computes continuously from your instance's latitude, longitude and clock. That
matters for two reasons: it is already a smooth signal, so there is no interpolating
between sunrise and sunset timestamps; and it comes from the **server**, so a phone in
another timezone showing the same dashboard sees the same picture.

The ramp spans civil twilight, −6° to +6° — roughly the hour around sunrise and sunset
when the light outside actually changes. Below that is night, above it is day, and the
curve eases at both ends rather than cornering.

A few deliberate choices:

- **Device icons and labels are not dimmed.** They sit above the dimming layer, so a dark
  plan stays readable and lit rooms still glow — which is the look worth having at night.
- **`sunBrightnessMin` defaults to 0.45, not 0.** A plan you cannot read at night is worse
  than one that is merely dim. Set it lower if you want a darker house.
- **It fails bright.** If `sun.sun` is missing or unreadable the plan stays at full
  brightness, rather than being stranded dark with nothing on screen to explain why.

### Lit rooms hold back the night

A flat dim would darken a lit room as much as an empty one — multiplying the whole picture,
contrast included — so a lamp would end up *less* noticeable at night than at noon. Instead,
**light withholds the dim**: any device with **Cast light** on clears the darkness around
itself, full at the centre and diffusing to nothing at its `glowRadius`, the same shape and
falloff as the pool it casts.

The result is a dark house with genuinely lit rooms. Measured against the same spot in an
unlit room, a lamp's contrast goes from **100 by day to 116 at night** on a dark theme, and
from 25 to 106 on a light one — where a flat dim would have cut both to 45%.

Strength follows brightness the way the pool does: a full-brightness lamp clears completely,
one dimmed to nothing clears about a third. A light that is off, `unavailable`, or has no
Cast light enabled clears nothing.

**Walls stop the clearing**, using the same visibility polygon that stops the pools — so a lit
room brightens itself and not the room next door. Note this treats a wall as solid along its
whole length: light does not reach through a doorway, for the clearing or for the pool.

Toggle it in the editor under **Project → Follow the sun**; the two brightness sliders
appear once it is on.

## Skins

A skin restyles the whole plan at once — paper, walls, badges, accents — from one line of
config. Pick one in the editor under **Project → Skin**, or set it by hand:

```yaml
type: custom:easy-floorplan-card
skin: tron
```

| Skin | What it looks like |
| --- | --- |
| `default` | Follows your Home Assistant theme, exactly as the card always has. This is what you get with no `skin` set. |
| `odnetnin` | Playful and chunky: thick charcoal outlines on warm cream paper, rounded-square badges with a hard printed-sticker shadow, a red accent and a bright yellow for anything that's on. |
| `pastel` | Soft and low-contrast: muted mauve walls on blush paper, peach for active devices. Easy to look at on a dashboard you keep on screen all day. |
| `tron` | Neon on near-black: thin cyan walls that glow, amber for active devices, light text. Light pools read best here — a lit room genuinely lights up. |

A skin only ever supplies **fallbacks**, so anything you set on an element yourself still wins:
a room with its own `color`, a device with its own `activeColor`, a `background` on the plan.
That also means you can switch skins freely without losing the colours you chose by hand.

Two things a skin deliberately does not touch. The **editor's own chrome** — toolbar, panels,
forms — stays in your Home Assistant theme, so the canvas reads as the plan rather than as more
editor. And a **background image** covers the skin's paper, as it always has; only the area
around it changes.

### Rolling your own

Under the hood a skin is a set of CSS custom properties, so [card-mod](#styling-hooks-card-mod)
can set the same ones and get the same result:

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
| `--fp-skin-wall` | theme text color | Walls, and the jambs and leaves of doors and windows. |
| `--fp-skin-wall-width` | `8` | Wall stroke width. **Keep this at 10 or below** — a doorway is a 12-unit gap cut through the wall layer, and a wider wall would not be fully cleared by its own door. |
| `--fp-skin-wall-filter` | `none` | A CSS `filter` on the walls, e.g. `drop-shadow(0 0 4px #22d3ee)` for a neon look. |
| `--fp-skin-accent` | theme primary color | Ripples, trackers, room fills, active doors, the floor switcher. |
| `--fp-skin-accent-ink` | theme text-on-primary color | Reading colour on top of `--fp-skin-accent` — today the active floor-switcher button. Set it whenever your accent is pale. |
| `--fp-skin-active` | theme active color | Badge colour for a device that is on. |
| `--fp-skin-active-ink` | theme text color | Icon/reading colour on that badge. Set it whenever `--fp-skin-active` is pale. |
| `--fp-skin-text` | theme text color | Labels, free text, room names, the card title, the editor grid. |
| `--fp-skin-badge-bg` | card background | Badge and label-chip background. |
| `--fp-skin-badge-border` | divider color | Badge border colour. |
| `--fp-skin-badge-border-width` | `1.5px` | Badge border weight. |
| `--fp-skin-badge-radius` | `50%` | Badge roundness — `50%` is a circle, `30%` a rounded square. |
| `--fp-skin-badge-shadow` | `0 1px 3px rgba(0,0,0,0.2)` | Badge shadow. |
| `--fp-skin-furniture` | `#9e9e9e` | Furniture with no colour of its own. |
| `--fp-skin-glow` | `#ffd9a0` | Light-pool colour for a bulb that reports no colour. |

Set them on `ha-card` and the whole plan follows, editor included. Any token you leave alone keeps
its default from the table, so you can restyle one thing without restating the rest.

**On top of a built-in skin, add `!important`.** A `skin:` is applied as an inline `style` on the
card, and an inline declaration outranks a card-mod rule — so without it your override is silently
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

## Styling hooks (card-mod)

Every rendered element carries its config `id` as `data-id`, plus a type class — so
[card-mod](https://github.com/thomasloven/lovelace-card-mod) and any other CSS can target
it by something stable, instead of by a colour that breaks the moment you change it in the
editor.

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
An element with no id simply has no `data-id`, rather than `data-id="undefined"`.

An area is **two** elements answering the same `data-id`: the fill, drawn under the walls,
and the outline, drawn over them. Scope a `fill` rule to `.fp-area`, or it lands on the
outline too — the outline is drawn `fill="none"`, so an unscoped rule floods it solid:

```css
[data-id="area_hall"]          { fill: #62f202; }  /* also floods the outline */
.fp-area[data-id="area_hall"]  { fill: #62f202; }  /* the fill, as intended */
.fp-area-border[data-id="area_hall"] { stroke-dasharray: 6 4; }
```

Properties that are not `fill` — `opacity`, `filter`, `stroke` — are usually fine on both,
which is why the `data-entity` example below is left unscoped deliberately.

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

Two notes. **Colouring a room from a sensor no longer needs CSS** — areas take `entity`,
`stateColor`, `activeColor` and `activeOpacity` natively; see **Area**; and **restyling the
whole plan no longer needs CSS either** — see **Skins**, whose `--fp-skin-*` tokens are the
supported way to build a look of your own. And these hooks are
a *styling* surface, not an API: the class names are stable, but the SVG structure inside
an element may change between releases, so prefer selecting the element itself over its
internals.

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

- a minimal `hass` mock + tiny `<ha-card>`, `<ha-icon>`, `<ha-entity-picker>` and
  `<ha-combo-box>` stubs so the card renders outside HA — the pickers are
  feature-detected inside the editor and fall back to plain inputs, but stubbing
  them means the harness drives the same branch a real HA install does;
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
