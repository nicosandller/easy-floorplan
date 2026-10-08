# Elements and controls

Back to the [README](../README.md). For saving and locking your work, see the
[editor guide](editor.md); for every YAML key, see the [configuration reference](configuration.md).

Everything you place on the plan is an **element**: **devices**, **doors, windows,
skylights & passages**,
**furniture**, **text**, **areas** and **trackers**. Select, move, nudge, copy/paste,
duplicate and delete them; each floor holds its own set.

- [Devices](#devices)
- [Doors, windows, skylights and passages](#doors-windows-skylights--passages)
- [Areas](#areas)
- [Live position trackers](#live-position-trackers)
- [Animations](#animations): [press feedback](#press-feedback),
  [presence ripples](#presence-ripples) and [fans](#fans)

<img width="1161" height="596" alt="Example floorplan with rooms, furniture and Home Assistant devices" src="https://github.com/user-attachments/assets/69c6c865-4eeb-4878-914b-182b2c31b63b" />

## Devices

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
  [More readings per device](configuration.md#more-readings-per-device).
- **Label position** — **Below** the badge (the default), or hung off its **left** or
  **right**. A reading under a badge grows in both directions and meets whatever sits
  beside it; hung off one side it grows one way only. Left and right hold their place
  when the badge is set to show nothing.
- **Disable label color** — an item's label normally follows the same state and active
  color rules its badge does. That is useful as a status cue and awkward when it hurts
  readability or fights a deliberately plain dashboard, so this pins the text to the
  theme's default instead. The icon and badge keep their dynamic colors; only the text
  stops. With **Own color** — the toggle that appears underneath once this is on — you can
  pin it to a fixed color rather than the theme default, and the color picker follows.

  | YAML key | Type | Description |
  | :--- | :--- | :--- |
  | `disableLabelColor` | boolean | Keeps the label text in the theme's default color instead of inheriting the active or state color. |
  | `useCustomLabelColor` | boolean | Use a fixed color for the label instead of the theme default. Only read when `disableLabelColor` is on. |
  | `labelCustomColor` | string | The fixed color (e.g. `#ff0000` or `red`), used when `useCustomLabelColor` is on. |

  ```yaml
  disableLabelColor: true
  useCustomLabelColor: true
  labelCustomColor: "#00ff00"
  ```

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

<img width="240" height="358" alt="Device labels and icons changing with entity state" src="https://github.com/user-attachments/assets/11d359b6-de8c-483c-8763-105ddf7d915b" />

## Doors, windows, skylights & passages

Drop a **door**, **passage** or **window** from the toolbar and it snaps onto the nearest
wall. A **passage** is a doorway with no door in it — the card draws only the gap, and it
is always open. A
**skylight** is the exception: it is a hole in the ceiling, so it snaps to nothing —
click anywhere inside a room and it stays where you put it. It is also the one opening
with two sizes, **Length** and **Width**, both settable in the toolbar before you place
it. Left
unbound it stays a static drawing. Bind an **Entity** — a contact `binary_sensor` or a
`cover` — and the opening tracks its real state. For a **wall** opening the card reads
the entity's HA `device_class` and picks a sensible `type` / `motion` for you (a `window`
cover → a window, a `blind` → a slider, a `garage` or `shutter` → a roll-up); adjust
afterwards. A **skylight** is exempt, and has to be: Home Assistant has no roof-window
class, so a velux binds to a `cover` with `device_class: window` — the very class that
would turn it back into a wall opening. So is a **passage**, which would otherwise grow its
door back. A type you chose by hand is never overruled.

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
- **Shutter icon** — the same badge for the shutter's entity, and its dialog on a tap. On by
  default when the opening has its own entity too, since it's how you find the second one.
  Off for a shutter bound alone — switch it on for a roll-up shutter without a window
  contact behind it, whose raised curtain leaves only its track line.
- **Invert door animation** (**Invert window animation** on a window) — flip the
  open/closed interpretation (and the percentage) for sensors wired the other way. A bound
  shutter gets its own **Invert shutter animation**, since a reed contact on the panels
  routinely disagrees with the sensor behind them about which way round `on` means open.
- **Tap to control** — a controllable `cover` toggles (`cover.toggle`); read-only sensors
  and position-only covers open the more-info dialog.

```yaml
openings:
  # sliding window, patio-door style, driven by a cover
  - { id: patio, type: window, motion: slide, sliderStyle: biparting, 'x': 640, 'y': 500, length: 160, angle: 0, entity: cover.patio_door }
  # a two-panel patio slider with a contact on each leaf: the panels stack over
  # the fixed side panels, and each one follows its own sensor
  - { id: bay, type: window, motion: slide, sliderStyle: biparting-bypass, 'x': 300, 'y': 500, length: 200, angle: 0, entity: binary_sensor.sliding_door_left, secondaryEntity: binary_sensor.sliding_door_right }
  # the same door with no fixed glass: both leaves slide and stack in the middle
  - { id: terrace, type: window, motion: slide, sliderStyle: converging, 'x': 300, 'y': 700, length: 200, angle: 0, entity: binary_sensor.terrace_left, secondaryEntity: binary_sensor.terrace_right }
  # a casement window with a contact on each sash: one open, one shut
  - { id: study, type: window, 'x': 820, 'y': 100, length: 120, angle: 0, entity: binary_sensor.study_left, secondaryEntity: binary_sensor.study_right }
  # a single-sash window behind a pair of shutters, one contact per panel
  - { id: kitchen, type: window, sash: single, 'x': 500, 'y': 100, length: 120, angle: 0, shutterEntity: binary_sensor.persiana_left, shutterStyle: swing, shutterSecondaryEntity: binary_sensor.persiana_right }
  # a swing door hinged on the right, opening into the other room
  - { id: hall, type: door, 'x': 300, 'y': 100, length: 80, angle: 0, flipH: true, flipV: true }
```

<img width="540" height="304" alt="door_window_demo" src="https://github.com/user-attachments/assets/091b3c89-5202-4025-8a0f-0fe867276be2" />

## Areas

An **area** is a colored, named room polygon traced on top of your walls.

Choose the **Area** tool and either press-drag to make a finished rectangle in one
gesture or click each corner for a custom polygon — points snap onto nearby wall corners
and onto other areas' corners, so adjoining rooms share an exact boundary. After 3+
points, click the **first** point to close the shape (**Backspace** drops the last point,
**Escape** discards the outline). Drag inside the fill to move the room, or a corner
handle to reshape it. Double-click a rectangle room's edge to cycle it through
**wall → divider → none**.

Selected, an area offers **Name** / **Show name**, a **color** and **Fill opacity**, and —
once it's live — the same conditional coloring devices get: **Entity**, **Active color**,
**Active opacity**, **Highlight** (tint the fill, or light up the room's own walls) and
**Color by state** rules. See [Area](configuration.md#area) for the full set.

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

## Live position trackers

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

## Animations

Bind an entity and the element stops being a drawing: openings move with their real
state, rooms and furniture recolor, markers glide, icons spin.

### Press feedback

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

### Presence ripples

Turn on a device's **Ripple** toggle and it draws animated concentric rings behind the
badge — set **Badge shows** to *Nothing* for the rings alone. They pulse outward and fade
while the device detects something, and collapse to a faint dot when it's clear, so the
spot stays marked without pulling the eye.

**Ripple color** and **ripple size** are per device (the color follows **Active color**
and state rules unless you set one). With **Ripple width** and **Ripple direction** the
width of the ripple can be limited. This is intended for sensors mounted to a wall, which
cannot detect presence or motion all around them.

The toggle appears only on devices that detect something where they sit — a
`binary_sensor` whose device class is `motion`, `occupancy`, `presence` or `vibration`, or
a `device_tracker` / `person` — the same way **Cast light** appears only on lights: a ring
claims something is happening there, so it's offered where that claim can be true. A
vibration sensor on a door therefore rings like a motion sensor does. The underlying
`display` key still works on any entity in YAML.

<img width="540" height="304" alt="ripple_demo_gif" src="https://github.com/user-attachments/assets/e43949cf-13a2-48f8-804d-73738299475f" />

### Fans

A running fan's icon spins, and an active media player or vacuum pulses — the same
defaults Home Assistant's own Tile card uses, with no setup: those devices simply open on
*Icon, spinning* / *Icon, pulsing*. Change **Badge shows** to turn it off, or to force an
animation on any other entity.

An icon only animates while its entity is genuinely active, so a forced spin on an
unavailable fan stays still — a spinning icon is a claim that the thing is running.
Respects the OS *reduced motion* preference.
