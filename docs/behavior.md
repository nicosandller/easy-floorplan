# Behaviour from entities

What elements *do* once a Home Assistant entity is bound to them.

Back to the [README](../README.md).

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

## Doors on locks

A door with a smart lock and no contact sensor already knows whether it is shut. Bind the
lock and it drives the door (issue #176):

```yaml
openings:
  - { id: front, type: door, x: 300, y: 100, length: 90, angle: 0, entity: lock.front_door }
```

`unlocked` draws the door open, `locked` draws it shut. The in-between states follow the
lock domain's own reading, the same table the device badges use: `unlocking` and a latch
`open` / `opening` count as open, and `locking` is on its way to shut and draws shut.
`invert` flips all of those, for a lock wired the other way round.

**`jammed` is not one of those readings.** A lock that tried to move and could not has a
bolt that is neither thrown nor withdrawn, so it is the same "we don't know" as an
`unavailable` or `unknown` entity: the door draws shut, and `invert` does not get to turn
that into a door standing open.

A lock publishes no position, so the door is fully open or fully shut, never partway.

**A tap on a lock-driven door opens its dialog; it never turns the lock.** That is the
same rule that keeps a tap off a shutter motor: unlocking a front door by brushing the
plan is the worst version of an accidental hardware move. `tap_action: { action: toggle }`
opts in, explicitly.

## Actions on rooms

Rooms answer gestures (issue #181) — tap the floor of a room to run a scene, toggle its
lights, or open a dashboard for it:

```yaml
areas:
  - id: kitchen
    points: [ … ]
    entity: light.kitchen_lights
    hold_action: { action: toggle }
```

**Tap already does something**: it zooms the plan to that room, and has since zooming
existed. So `tap_action` *replaces* the zoom rather than joining it, and leaving it unset
keeps the zoom exactly as it was — every plan drawn before this behaves identically.

That gives three arrangements:

| You want | Set |
| --- | --- |
| Zoom, and an action | the action on `hold_action` or `double_tap_action` |
| An action instead of the zoom | `tap_action` |
| Neither | `tap_action: { action: none }` |

An action's own `entity` wins; without one it falls back to the area's `entity`, so the
example above toggles `light.kitchen_lights` without naming it twice. With no entity
anywhere, only the actions that need none — `navigate`, `url`, `call-service` — do
anything.

A room with an action bound announces itself as a button and takes a tab stop; a room that
only zooms does not, exactly as before.

## Devices that only appear up close

A busy plan cannot show every minor sensor at full zoom and stay readable. `showOnlyWhenZoomed`
keeps a device off the overview and brings it back when its room is zoomed into (issue #222):

```yaml
items:
  - id: bath_humidity
    entity: sensor.bathroom_humidity
    kind: sensor
    x: 300
    y: 250
    showOnlyWhenZoomed: true
```

Which room a device belongs to is answered from the plan itself: the area polygon it is drawn
inside. Nothing to keep in step — move the device or redraw the room and the answer follows.

For a device that belongs to a room without sitting inside it — a doorbell out on the porch, a
thermostat in the hall — name the room with `area`, by its `id` or its `name`:

```yaml
  - id: doorbell
    entity: binary_sensor.doorbell
    x: 960
    y: 560
    showOnlyWhenZoomed: true
    area: porch
```

`area` wins over where the device is drawn, so it also corrects a device that sits in the wrong
polygon.

Two things worth knowing before you use it:

- A device with the flag and **no room to be in** — no `area`, and inside no polygon — never
  appears on the card. The editor still draws it, so it stays selectable and fixable; the card
  is simply doing what it was asked.
- The way in is the room tap, so a room whose `tap_action` [replaces the zoom](#actions-on-rooms)
  has no way to reveal its devices. Put that action on `hold_action` instead.

## Stairs that change floor

A staircase already draws an arrow saying which way it goes. `goToFloor` makes that a
promise the card keeps (issue #121):

```yaml
floors:
  - id: ground
    name: Ground floor
    furniture:
      - { id: stairs_up, type: stairs, x: 640, y: 300, w: 80, h: 140, goToFloor: up }
  - id: upstairs
    name: Upstairs
    furniture:
      - { id: stairs_down, type: stairs, x: 640, y: 300, w: 80, h: 140, goToFloor: down }
```

Click the stairs, change floor. `up` is the next entry in `floors`, `down` the previous —
the list is read bottom-to-top — and the button's tooltip names the floor it leads to.

**At the end of the list it leads nowhere, and stops being a button.** An `up` staircase
on the top floor still draws as a staircase; it just takes no clicks, gets no pointer
cursor and no tab stop. A control that does nothing is worse than no control. It does not
wrap either: the loft is not above the cellar.

The option is on **furniture generally**, not just the built-in `stairs` symbol — a plan
can [draw its own](configuration.md#drawing-your-own) staircase, and a rule keyed on one symbol id would
leave those out. It sits under **Behavior** in the furniture panel.

This does not replace the floor switcher in the card's corner; the stairs are a second way
up. Set `floors` and you get both.

## Colors for on and off

A device badge has always been able to say what colour it is when it is **on**,
and nothing at all about when it is **off** — every off device is the same
neutral badge. Same for an opening: a closed door is a line the same colour as
the wall it sits in. Which is exactly backwards when the thing you need to
notice is the door that is *shut*, or the valve that is *closed*.

![The same plan twice: on the left every shut device is a neutral badge and every
closed sash is a line the colour of the wall; on the right they are red](img/inactive-color.png)

`inactiveColor` is the counterpart to `activeColor`, on both:

```yaml
items:
  - id: garage
    entity: cover.garage_door
    activeColor: "#2e7d32"    # open — fine
    inactiveColor: "#c62828"  # closed — look at me

openings:
  - id: front
    type: door
    entity: binary_sensor.front_door
    activeColor: "#2e7d32"
    inactiveColor: "#c62828"
```

### Why not just a state rule

A `stateColor` rule can already paint a badge, and for a plain switch
`{ state: "off", color: "#c62828" }` does the same job. The catch is that it
requires knowing the word. A lock says `locked`, a cover says `closed`, a vacuum
says `docked` — a rule written for one is silently wrong on the next, and the
symptom is a badge that simply never changes colour.

`inactiveColor` is resolved through the same domain table that decides whether a
device is drawn as "on" at all, so it means off for every domain at once.

Rules still win over it, exactly as they win over `activeColor`: a threshold or
an exact state is the more specific statement about what this element should
look like right now.

### What it does not touch

- **The jambs and frame of an opening.** Only the leaf, the sash and the swing
  arc move — recolouring the frame would turn the symbol from a hole in a wall
  into a coloured shape.
- **Furniture and areas.** Both already have a static `color`, which *is* their
  off colour: `activeColor` paints over it while the entity is on, and it shows
  through the rest of the time.
- **An entity that has dropped out.** `unavailable`, `unknown`, or an entity id
  Home Assistant does not answer to falls back to the resting badge and the wall
  colour, exactly as it did before this option existed. It is not active either,
  so without that it would wear the same emphatic "shut" as a device that really
  is — and under `offlineStyle: none`, which draws no fading, the two would be
  the same picture. See [Offline devices](#offline-devices).

An element with **no entity bound at all** is a different thing and does paint:
there is nothing about a hand-drawn shut window that could be wrong.

For an opening the question asked is whether it is *drawn shut*, not whether its
sensor is quiet. The two agree for anything with a contact on it, and come apart
without one: a swing door with no sensor is drawn **open** by the usual
floor-plan convention, so it keeps the wall colour, while an unbound window
renders shut and wears the closed one. Each leaf of a double is asked
separately, so a pair with one sash open and one shut shows both colours.

The editor's canvas follows the same rule. A preview that disagrees with the
card is worse than no preview, because the plan gets tuned against a picture the
dashboard will not draw.

## Offline devices

An entity that has dropped out no longer looks like one that is simply switched off.

```yaml
type: custom:easy-floorplan-card
offlineStyle: dim      # dim (default) | strike | none
```

A device counts as **offline** when its entity reads `unavailable` or `unknown`, or when
the entity id is not in Home Assistant at all — renamed, deleted, or from an integration
that failed to load. A device with no entity bound is not offline: those are plain
markers, and there is nothing about them to be wrong.

| `offlineStyle` | What it draws |
| --- | --- |
| `dim` *(default)* | The badge, its icon and its label fade back. |
| `strike` | The same fade, with a diagonal through the badge. Reads from further away. |
| `none` | The pre-#162 behaviour — an offline device looks like any other. |

The default is `dim`, and that **is** a change on upgrade: until now a dead bulb and a
bulb someone turned off were the same picture, and the plan gave that answer confidently.
`none` keeps it for anyone who wants it. Set it in the editor under **Project → Offline
devices**.

The mark's colour is `--fp-offline-mark`, falling back to the theme's `--error-color`, so
card-mod can recolour it without touching anything else. A device drawn as a bare ripple,
or as a label with no badge, has nothing to cross out and takes the fade alone.

## Advanced Hiding Logic

You can fine-tune when an item, its badge, or its state label is hidden. Instead of just hiding an element when its main entity is inactive, you can evaluate specific states, numeric thresholds, or even watch entirely different entities. 

This is available for the **whole item** (`hide...`), the **badge** (`hideBadge...`), and the **state text** (`hideState...`). 

| YAML Key | Type | Description |
| :--- | :--- | :--- |
| `enableHideByEntity` | `boolean` | Activates the advanced hide logic for the whole item. (Use `enableHideBadgeByEntity` / `enableHideStateByEntity` for specific parts). |
| `hideEntity` | `string` | The entity to evaluate. If omitted, the device's main `entity` is used. |
| `hideAttribute` | `string` | Evaluate a specific attribute (e.g., `current_temperature`) instead of the state. |
| `hideMode` | `string` | Set to `"state"` for text matching, or `"threshold"` for numeric comparisons. |
| `hideState` | `string` | The exact string to match (case-insensitive) when using `hideMode: "state"`. |
| `hideOperator` | `string` | The comparison operator (`<`, `<=`, `==`, `!=`, `>=`, `>`) used for thresholds or state matching. |
| `hideThreshold` | `number` | The numeric value to compare against when using `hideMode: "threshold"`. |
| `hideInvert` | `boolean` | If `true`, inverts the final result of the condition. |

The badge and state-text variants take the same eight keys with a `hideBadge` /
`hideState` prefix — `enableHideBadgeByEntity`, `hideBadgeEntity`, `hideBadgeAttribute`,
`hideBadgeMode`, `hideBadgeMatch`, `hideBadgeOperator`, `hideBadgeThreshold`,
`hideBadgeInvert`, and likewise for `hideState...`. (The whole-item key is `hideState`;
the state-text one is `hideStateMatch`.)

**Example:** Hide a badge if the temperature of another sensor drops below 20:
```yaml
enableHideBadgeByEntity: true
hideBadgeEntity: sensor.room_temperature
hideBadgeMode: threshold
hideBadgeOperator: "<"
hideBadgeThreshold: 20
```

**When the sensor doesn't answer.** A condition that can't be evaluated never hides —
a device that vanishes is the one thing you can't debug from the plan. A missing value,
a missing threshold, or a sensor gone `unavailable` under a numeric threshold all leave
the item on screen, and `hideInvert` doesn't flip that. The exception is an outage you
asked for by name: `hideMode: state` with `hideState: unavailable` does hide, so
"hide the badge while this sensor is dead" works as written.
