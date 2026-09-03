# Easy Floorplan

[![hacs][hacs-badge]][hacs-url]
[![release][release-badge]][release-url]
[![license][license-badge]](LICENSE)

<a href="https://www.buymeacoffee.com/nicosandller" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important; width: 217px !important;" >
</a>

A Home Assistant Lovelace card for building an interactive floorplan — **with a visual
drag-and-drop editor**. Draw walls, drop doors and windows, add furniture and labels, and
place your entities as icons, ripples or live state. Everything scales to the card and
screen size.


<img width="1080" height="608" alt="demo" src="https://github.com/user-attachments/assets/98abaddc-b713-492f-be85-ca5f778f3779" />

## What you can end up with

<img width="1161" height="596" alt="Screenshot 2026-08-06 at 4 26 22 PM" src="https://github.com/user-attachments/assets/69c6c865-4eeb-4878-914b-182b2c31b63b" />

## Features
- ✏️ **Visual editor** — draw walls, drop doors and windows that snap onto them, drag, nudge with arrow keys, multi-select, copy/paste, undo/redo, zoom.
  - 🆕 **Lock in place** — pin anything you have finished positioning. A locked element still selects and edits but never moves, and it yields the click to whatever is unlocked on top of it, so reaching for a window stops grabbing the wall behind it. See [Locking elements in place](#locking-elements-in-place).
  - **Apply** — save the plan to the dashboard *without* closing the editor, so you can judge a change on the real card (in a second tab, or by collapsing the editor) instead of in the small preview beside it, then carry straight on. Needs Home Assistant 2025.3 or newer; on anything older the button says so and Save still works.
- 🎛️ **Devices** — bind any entity to an icon: tap to toggle or open more-info, live state or attribute label, custom icon, size, rotation.
  - **Presence ripples** — presence and vibration sensors drawn as animated rings instead of a static icon.
  - **Cast light** — a light pools its own color and brightness onto the plan; overlapping pools mix, so a warm lamp and a cool one blend between them.
  - **Conditional text / icon / coloring** — threshold and state rules restyle an element from what its entity reads: the badge color, the label, and the glyph itself, so blinds swap between open and closed icons and a thermostat reddens as it heats. The same rules drive furniture and rooms.
 
<img width="195" height="278" alt="light blend" src="https://github.com/user-attachments/assets/23104587-687b-4c9a-83e8-e83c3d5eb6eb" />
<img width="240" height="358" alt="conditionals" src="https://github.com/user-attachments/assets/11d359b6-de8c-483c-8763-105ddf7d915b" />

- 📊 **Many readings, one device** — a sensor that reports temperature, humidity and pressure needs one badge, not three. Add entities one at a time; they show whether or not the device's own state does, so a smart plug can label itself `1.2 kW · 84 · 5 min ago` while the badge colour carries the on/off. The label can sit below, left or right of the badge.
- 🚪 **Animated doors & windows** — bind a contact `binary_sensor`, `cover` or `lock` and openings swing, slide or roll with their real state, partial positions included. A lock reads `unlocked` as open, so a door with no contact sensor still animates.
  - **A sensor per leaf** — anything with two leaves takes a second contact and draws them independently: a casement window with one sash open and one shut, a double door ajar on one side, a pair of shutters with one folded back.
- 📴 **Offline devices read as offline** — an entity that is unavailable, unknown, or gone from Home Assistant is dimmed (or crossed out), instead of looking exactly like a device someone switched off.
- 🪑 **Furniture** — 26 gray line-art diagrams (table, sofa, bed, stove, stairs, tv…), each bindable to an entity, in a searchable picker. Every one is a plain JSON file of numbers you can copy: draw your own in the editor's paste box, use it straight away, and open a PR when it's good. No SVG, so nothing you paste can run anything.
- 🔤 **Live text labels** 🆕 — bind a text to an entity and it shows the reading: a power figure in the corner, a temperature over a room. Type words in front of it, or leave them out for the number alone.
- 🏠 **Areas** — trace room polygons that color live from an entity, and link them to Home Assistant areas to scope entity pickers and bulk-add devices.
- 📍 **Live position trackers** — map one or two distance sensors (mmWave / radar) onto a marker that moves across the plan in real time.
- 🧱 **Dead spaces** — hatch the spaces your walls seal off that no door or window reaches: a service shaft, the void behind a boxed-in stairwell. Nothing to draw — the regions come from the walls and openings themselves, so cutting a doorway into one stops it being dead the moment you place the door.
- 🌗 **Follow the sun** — dim the plan through dusk and brighten it through dawn, from your HA instance's sun elevation. Any light casting light holds the dark back around itself, out to its radius, so a night plan reads as a dark house with lit rooms glowing.
 
<img width="441" height="301" alt="day" src="https://github.com/user-attachments/assets/f3dbfc88-9d06-4f44-81dc-bf499cbd9bd3" />
<img width="444" height="313" alt="night" src="https://github.com/user-attachments/assets/1590b710-d88f-4a34-986b-b08640a45f4c" />


- 🏢 **Multiple floors** — per-floor elements with a switcher in both the editor and the card. Give a staircase `goToFloor: up` and clicking it takes you there.
- 🖼️ **Background image** — trace over a floor-plan scan, per floor, with adjustable opacity.
- 🎨 **Skins** — restyle the whole plan from one line of config: `default` follows your Home Assistant theme, `odnetnin` is chunky charcoal on cream, `pastel` is soft and low-contrast, `tron` is neon on near-black. Colors you set on an element yourself always win.
  
<img width="300" height="300" alt="default" src="https://github.com/user-attachments/assets/ce2d6545-10f4-4aa2-bbd7-0dcae08c27f5" />
<img width="300" height="300" alt="odnetnin" src="https://github.com/user-attachments/assets/1d46f7a3-b894-4fcb-bdb9-a55270b8e4e4" />
<img width="300" height="300" alt="tron" src="https://github.com/user-attachments/assets/de5b0825-3bff-4817-8a26-8f887bab8c48" />

- 📐 **Auto-scaling** — SVG over a virtual coordinate space, so the plan fits any card size.

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

## Documentation

| | | |
| --- | --- | --- |
| 🎥 | **[Video walkthrough](https://youtu.be/M-b7xK-4Bpw)** | Setting the card up end to end — a community guide, in Italian 🇮🇹 |
| ⚙️ | **[Configuration](https://github.com/nicosandller/easy-floorplan/blob/main/docs/configuration.md)** | Every config key: per-element tables, defaults, a worked example |
| 💡 | **[Lighting](https://github.com/nicosandller/easy-floorplan/blob/main/docs/lighting.md)** | Follow the sun, and real sunlight through the windows |
| 🎨 | **[Appearance](https://github.com/nicosandller/easy-floorplan/blob/main/docs/appearance.md)** | Skins, overlay scale, rotation, and card-mod styling hooks |
| ⚡ | **[Behaviour](https://github.com/nicosandller/easy-floorplan/blob/main/docs/behavior.md)** | What elements do once an entity is bound |
| 🐳 | **[Local Home Assistant](https://github.com/nicosandller/easy-floorplan/blob/main/docker/README.md)** | Running the card against a real instance in Docker |
| 🪑 | **[Furniture symbols](https://github.com/nicosandller/easy-floorplan/blob/main/furniture/README.md)** | Authoring a symbol, and contributing one |
| 🤝 | **[Contributing](https://github.com/nicosandller/easy-floorplan/blob/main/CONTRIBUTING.md)** | Build commands, and which test suite a change needs |

Below: what you can put on a plan, and links to the guide for each feature.

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
- **Other entities** — **+ Add entity**, right under the first one, appends as many as the
  device has: `21.5 °C · 45% · 1013 hPa`. Each row picks an entity, an attribute, or both
  — leave the entity empty and it reads that attribute off this device, so one climate
  entity can show four of its own numbers. See
  [More readings per device](https://github.com/nicosandller/easy-floorplan/blob/main/docs/configuration.md#more-readings-per-device).
- **Label position** — **Below** the badge (the default), or hung off its **left** or
  **right**. A reading under a badge grows in both directions and meets whatever sits
  beside it; hung off one side it grows one way only.
- **Badge shows** — one dropdown for what the device draws: *Icon* — **still**,
  **spinning** or **pulsing** — its *Value*, or *Nothing* (label only). **Value** draws
  the reading inside the badge — a thermostat reads `21°` in the circle your state rules
  already paint red — picking it per domain, dropping long units, and falling back to the
  icon when there is no number. See [Fans](#fans) for the animations.
- **Badge reads** — once the device has extra readings (**+ Add entity** under **Other
  entities**) and the badge is showing a value, this names which one it reads. Left alone
  the card takes the first with a number to show, so a smart plug pointed at its power
  sensor reads `1.2kW` without configuring anything — the switch says "on", not a number,
  so the badge falls through. Once you pick, only that entity is read; if it has nothing
  to show the badge falls back to its icon rather than quietly showing the other.
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
- **Motion** — **swing** (default), **slide**, **roll** (a slatted curtain that thins onto
  its track), or **fixed** — a window that does not open at all: a bay window, a picture
  window, a sealed pane. A fixed window is drawn as jambs and glass with no leaf and no
  arc, ignores a bound sensor for its drawing (bind one anyway if you want the tap target
  or the badge), and is never a gap — though it still lets the daylight straight through,
  because it is still glass. Offered on windows; a door that cannot open is a wall.
  Sliding openings take a **Style**, and which one you want comes down to where the panels
  go and what is left clear:

  | Style | Panels | Where they go | What clears |
  | --- | --- | --- | --- |
  | *single* | one moving | into the wall | the whole opening |
  | *bypass* | one moving, one fixed | behind the fixed one | half |
  | *biparting (into the walls)* | two moving | each recesses into its own wall — a pocket door | the whole opening |
  | *biparting (over fixed panels)* | two moving, two fixed | out onto a fixed panel at each jamb | the middle half |
  | *converging* | two moving | toward each other, stacking in the middle | a quarter at each jamb |

  The last two are both patio sliders and they are mirror images: pick *biparting (over
  fixed panels)* if the outer quarters of your door are fixed glass, and *converging* if
  every leaf slides. **Slide** sets the direction; a style that moves both panels has
  none.
- **One sensor per leaf** — anything with two leaves takes a **Second leaf** entity, and
  then each leaf opens and accents on its own state: left open and right shut draws
  exactly that. That means the two-panel sliders above, and any hinged double — a
  casement window (`sash: double`, the window default) or a double door. Leave it empty
  and both leaves follow the first entity, as they always have. The opening's own invert
  switch covers both, and a tap still acts on the first. A lamp's pool follows the leaves
  too: with one open, the light comes through *that* leaf's half of the doorway rather
  than the middle.
- **Sash width** (**Leaf width** on a door) — when only part of the opening actually
  moves and the rest is fixed, set this to the share of the frame the operable leaf
  covers, `0.05`–`1`. The leaf is drawn at that width, hinged at its own jamb, sweeping an
  arc to match, and the remainder is drawn as a fixed pane — so a narrow casement in a
  wide frame stops swinging the whole width of the glass, and a sidelight door stops
  swinging its fixed panel. The pane follows the type: thin glass on a window, solid on a
  door. Single-leaf swing openings only — a double already splits the frame between its
  two leaves. **Hinge** moves the leaf and its pane together.
- **Orientation** — **Hinge** (left / right) and **Opens** (this side / other side) face a
  swing door any of four ways; they're pure mirrors (`flipH` / `flipV`), so the animation
  follows.
- **External shutters** — bind a second `cover` or contact as **Shutter** and it shares
  the wall gap with the opening, rendering independently — so an open window behind a
  closed shutter shows both. **Shutter type** picks *Hinged* (louvered panels folding back
  against the façade) or *Roll-up*, defaulting from the entity. A hinged pair has a
  **Second shutter panel** of its own, on the same terms as the leaf above — a shutter is
  a layer *over* the opening, so a double casement behind a pair of shutters has four
  leaves and can carry four contacts.
- **Active color** — the leaf, sash and arc take an accent color while open. Defaults to
  the primary color.
- **Show icon** — an optional badge beside the opening carrying its own entity's icon,
  which changes with the state, and its dialog on a tap. Off by default: a leaf that has
  swung is still on screen saying so. The roll-up is the case that wants it — raised, its
  curtain has left the floor plane and only the coloured track remains. With a shutter
  bound too, the two badges take opposite faces of the wall.
- **Invert door animation** (**Invert window animation** on a window) — flip the
  open/closed interpretation (and the percentage) for sensors wired the other way. A bound
  shutter gets its own **Invert shutter animation**, since a reed contact on the panels
  routinely disagrees with the sensor behind them about which way round `on` means open.
- **Tap to control** — a controllable `cover` toggles (`cover.toggle`); read-only sensors
  and position-only covers open the more-info dialog.

```yaml
openings:
  # sliding window, patio-door style, driven by a cover
  - { id: patio, type: window, motion: slide, sliderStyle: biparting, x: 640, y: 500, length: 160, angle: 0, entity: cover.patio_door }
  # a two-panel patio slider with a contact on each leaf: the panels stack over
  # the fixed side panels, and each one follows its own sensor
  - { id: bay, type: window, motion: slide, sliderStyle: biparting-bypass, x: 300, y: 500, length: 200, angle: 0, entity: binary_sensor.sliding_door_left, secondaryEntity: binary_sensor.sliding_door_right }
  # the same door with no fixed glass: both leaves slide and stack in the middle
  - { id: terrace, type: window, motion: slide, sliderStyle: converging, x: 300, y: 700, length: 200, angle: 0, entity: binary_sensor.terrace_left, secondaryEntity: binary_sensor.terrace_right }
  # a casement window with a contact on each sash: one open, one shut
  - { id: study, type: window, x: 820, y: 100, length: 120, angle: 0, entity: binary_sensor.study_left, secondaryEntity: binary_sensor.study_right }
  # a single-sash window behind a pair of shutters, one contact per panel
  - { id: kitchen, type: window, sash: single, x: 500, y: 100, length: 120, angle: 0, shutterEntity: binary_sensor.persiana_left, shutterStyle: swing, shutterSecondaryEntity: binary_sensor.persiana_right }
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
**Color by state** rules. See [Area](https://github.com/nicosandller/easy-floorplan/blob/main/docs/configuration.md#area) for the full set.

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

The rectangle itself is editor-only; the card shows just the marker. **Color**, **dot
size** and **label** are per tracker — a label (initials like `FR`, up to three
characters) rides in the triangle's place with the same pulse and glide, so several
people on one floor stay tellable apart when color alone isn't enough. It stays upright
under the plan's `rotation`, like every other text on the card.

#### Presence ripples

Turn on a device's **Ripple** toggle and it draws animated concentric rings behind the
badge — set **Badge shows** to *Nothing* for the rings alone. They pulse outward and fade
while the device detects something, and collapse to a faint dot when it's clear, so the
spot stays marked without pulling the eye.

**Ripple color** and **ripple size** are per device (the color follows **Active color**
and state rules unless you set one).

The toggle appears only on devices that detect something where they sit — a
`binary_sensor` whose device class is `motion`, `occupancy`, `presence` or `vibration`, or
a `device_tracker` / `person` — the same way **Cast light** appears only on lights: a ring
claims something is happening there, so it's offered where that claim can be true. A
vibration sensor on a door therefore rings like a motion sensor does. The underlying
`display` key still works on any entity in YAML.

<img width="540" height="304" alt="ripple_demo_gif" src="https://github.com/user-attachments/assets/e43949cf-13a2-48f8-804d-73738299475f" />

#### Fans

A running fan's icon spins, and an active media player or vacuum pulses — the same
defaults Home Assistant's own Tile card uses, with no setup: those devices simply open on
*Icon, spinning* / *Icon, pulsing*. Change **Badge shows** to turn it off, or to force an
animation on any other entity.

An icon only animates while its entity is genuinely active, so a forced spin on an
unavailable fan stays still — a spinning icon is a claim that the thing is running.
Respects the OS *reduced motion* preference.

## Locking elements in place

Select anything and press the padlock in the **Element** header. It applies to every kind
of element — walls, doors and windows, devices, text, furniture, trackers and rooms — and
to a whole multi-selection at once.

A locked element:

- **still selects, still edits, still deletes.** Everything works except *moving* it.
- **never moves.** Not by dragging, not by its endpoint or vertex handles (which stop
  being drawn, so nothing on it pretends to be draggable), and not by arrow keys — alone
  or as part of a group. Drag a group by an unlocked member and the locked ones stay put
  while the rest travel.
- **yields the click.** Anything unlocked under the pointer is picked first, whatever kind
  it is. Lock the wall and a window drawn on it selects on the first click instead of
  after cycling past the wall.

Both halves are the point. Yielding alone would still let a stray drag move the wall;
pinning alone would still cost a click to get past it. Together they answer the thing
that prompted this: *"every time I want to move a window, I end up moving a wall
instead"*.

Locked elements stay selectable on purpose — a design tool hides them behind a layers
panel to unlock from, and this editor has none, so an element you could not click would
be one you could never unlock. Pasted copies are never locked: a duplicate lands offset
and the first thing you do is position it.

Nothing about the rendered card reads this — it is an editing aid, and `locked: true` in
the YAML changes nothing a viewer sees.


<!-- Anchors for sections that moved into docs/. Invisible when rendered; they keep
     links from older issues and discussions landing on this table. -->
<a name="configuration-reference"></a><a name="more-readings-per-device"></a>
<a name="follow-the-sun"></a><a name="sunlight"></a>
<a name="skins"></a><a name="overlay-scale"></a><a name="compact-header"></a>
<a name="rotation-that-follows-the-screen"></a><a name="styling-hooks-card-mod"></a>
<a name="dead-spaces"></a><a name="doors-on-locks"></a><a name="actions-on-rooms"></a>
<a name="stairs-that-change-floor"></a><a name="offline-devices"></a>
<a name="advanced-hiding-logic"></a>

## Feature guides

Everything the card does beyond placing elements, in four guides:

| | | |
| --- | --- | --- |
| ⚙️ | **[Configuration](https://github.com/nicosandller/easy-floorplan/blob/main/docs/configuration.md)** | Every key it accepts — per-element tables, defaults, a worked example |
| 💡 | **[Lighting](https://github.com/nicosandller/easy-floorplan/blob/main/docs/lighting.md)** | Sun dimming through dusk and dawn · real sunlight through the windows |
| 🎨 | **[Appearance](https://github.com/nicosandller/easy-floorplan/blob/main/docs/appearance.md)** | Skins · overlay scale · compact header · rotation · card-mod hooks |
| ⚡ | **[Behaviour](https://github.com/nicosandller/easy-floorplan/blob/main/docs/behavior.md)** | Dead spaces · doors on locks · room actions · stairs between floors · offline devices · hiding logic |

## Development

```bash
npm install
npm run build   # bundles to dist/easy-floorplan-card.js
npm run watch   # rebuild on change
npm test        # node suite
npm run ha      # a real Home Assistant in Docker, with a seeded demo plan
```

Build and test commands, and which of the two test suites a change needs, are in
[CONTRIBUTING.md](https://github.com/nicosandller/easy-floorplan/blob/main/CONTRIBUTING.md).
`npm run ha` is the only harness in the repo — what it seeds, the `ha:*` commands and how
to pin a Home Assistant version are in
[docker/README.md](https://github.com/nicosandller/easy-floorplan/blob/main/docker/README.md).

## License

[MIT](LICENSE)

[hacs-badge]: https://img.shields.io/badge/HACS-Custom-41BDF5.svg
[hacs-url]: https://github.com/hacs/integration
[release-badge]: https://img.shields.io/github/v/release/nicosandller/easy-floorplan
[release-url]: https://github.com/nicosandller/easy-floorplan/releases
[license-badge]: https://img.shields.io/github/license/nicosandller/easy-floorplan
