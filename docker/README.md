# Developing against a real Home Assistant

## Standalone editor preview

Run `npx vite --host 127.0.0.1 --port 5187` and open
<http://127.0.0.1:5187/docker/editor-preview.html> to try the responsive editor
workspace with a sample two-floor home. Select and drag objects, edit their
properties, use undo, switch floors, and expand the workspace. The theme button
exercises the same Home Assistant CSS variables the editor uses in a dashboard.
The Selection and Project tabs separate object properties from plan settings.
Selecting an object shows its main properties directly. Visible category tabs open
sensor bindings, appearance, actions or visibility in one step, with no nested
accordions or repeated basic fields. All destinations stay visible while their
fields scroll; arrow keys, Home and End move between tabs. Size and rotation come
before the object type, and staircase navigation has a full-width field. The
header uses the selected furniture's actual symbol or the device's resolved icon
and friendly name. Undo keeps an existing object selected. Project settings use
six visible destinations: Plan, Style, View, Lighting, Devices and Symbols.

On phones, Edit properties opens a panel below a live view of the plan. The
preview preserves drawing scale and follows the selected object; its zoom
controls have their own space. Properties receive most of the available height.
Hide plan gives fields the whole workspace; Show plan restores the preview.
When an input is focused and the visual viewport shrinks for a keyboard, the
preview temporarily hides and the expanded editor follows the available height.
Phone inputs use 16px text and larger touch controls. Done returns to the full
drawing area. A compact Drawing tool picker offers all eight modes; Project settings, undo/redo and Apply
remain accessible. At tablet widths the inspector docks beside the plan and the
tool picker shares the top toolbar. Large screens use a vertical tool rail.
Short landscape screens keep the drawing and open properties side by side.

This renders the actual editor with its standalone input fallbacks. Changes
stay in the page; Apply requires a Home Assistant dashboard. Use the container
below to test the actual Home Assistant entity and action selectors.
The preview's MDI paths are from `@mdi/svg` 7.4.47; their license is beside
`editor-preview-icons.json`. Production continues to use HA's `ha-icon`.

### Editor workspace screenshots

The desktop and mobile comparisons show the same sample home and selected stairs. The
[previous editor](../docs/img/editor-workspace-before.jpg) is a full-page
capture of `main` at `5641e51`; its properties sit below the large canvas.
The [desktop workspace](../docs/img/editor-workspace-preview.jpg) keeps the
tools, fitted plan and inspector together within a 1280×720 viewport.
On mobile, the [drawing workspace](../docs/img/editor-workspace-mobile.jpg)
opens [properties beneath a live preview](../docs/img/editor-workspace-mobile-inspector.jpg);
both captures are 360×780. The [tablet layout](../docs/img/editor-workspace-tablet.jpg)
keeps the inspector beside the plan with a compact toolbar at 960×780.
The [landscape properties](../docs/img/editor-workspace-landscape.jpg) show both
panes within a 740×360 fullscreen viewport. The [project settings](../docs/img/editor-workspace-project.jpg)
show all six category tabs with flat field headings.
These comparisons demonstrate the standalone preview. The
[native desktop editor](../docs/img/editor-workspace-ha.jpg) and
[native phone inspector](../docs/img/editor-workspace-ha-mobile.jpg) show Home
Assistant 2026.9.2 with its own forms, theme and selectors. On the phone, Hide plan
gives the fields the available space.

### Native acceptance checked on 2026-10-03

In a separate loopback-only development container, opened the card's narrow
configuration dialog and expanded workspace, bound a real demo sensor, selected
a More info hold action, changed the stairs from 80 to 96 units wide and used
Apply. The size, binding and action survived a reload; dashboard storage contains the
96-unit width, sensor binding and hold action. Also checked the native inspector
at 375×812 and toggled its plan preview. The typing check caught and fixed
per-keystroke minimum clamping that could turn `96` into `106`; unfinished number
input now stays intact while the stored configuration remains normalized.

Browser regressions cover the visual viewport keyboard transition and synthetic
touch pinch/cancel events. Physical iOS/Android keyboards and gestures still need
device testing; desktop viewport emulation does not establish that acceptance.

## Home Assistant integration

A throwaway Home Assistant in a container, preloaded with a sample floorplan
and entities that keep changing, so the card can be developed against the real
thing rather than a mock.

## Running it

Needs Docker with **Compose v2**: the scripts call `docker compose` as a
subcommand, not the older standalone `docker-compose` binary. `docker compose
version` tells you which you have. Docker Desktop ships it; for a CLI-only
setup, `brew install colima docker docker-compose && colima start`.

Run `npm install` first, and again after a pull that changes dependencies —
the seeding step reads the demo plan with `js-yaml`, and will tell you to if
it is missing.

```bash
npm run ha
```

That builds the card and starts the container. Home Assistant is at
<http://localhost:8123>.

The first boot takes a minute or two — Home Assistant is unpacking and setting
itself up — and ends at an onboarding screen. Create an account; any username
and password will do. The port is published on `127.0.0.1` only (see
`docker-compose.yml`), so whatever you type there is not exposed to the rest of
your network. It is a one-time step: the account lands in `docker/config/.storage`,
which is gitignored but persists across restarts, so every later `npm run ha`
goes straight to the dashboard.

Skip through the rest of onboarding (location, analytics, and the "found these
devices" page) — `configuration.yaml` has already set everything that matters.

Then, in the sidebar:

- **Floorplan Demo** — the sample plan, and **fully editable**: click the
  pencil and the card's own visual editor opens on it, drag-and-drop and all.
  Its starting content comes from
  [`config/floorplan-demo.yaml`](config/floorplan-demo.yaml), which is what
  lives in git; `prepare.mjs` seeds a storage-mode dashboard from that file so
  the plan is both reviewable in the repo and editable in the browser.
- **Overview** — Home Assistant's auto-generated dashboard. Nothing here needs
  it, but if you want a second surface to drop a card onto, click the pencil
  and choose **⋮ → Take control** first: auto-generated dashboards are
  read-only until claimed.
- **History** (inside Floorplan Demo) — a plain history graph over the same
  entities, plus switches for the sample-data generators. When the card and
  Home Assistant disagree about what happened, this is where you find out
  which of them is wrong.

While working, run `npm run watch` in a second terminal. It rebuilds `dist/` on
save, and `dist/` is mounted into the container, so the new file is in place
immediately — but the browser has already cached the old one, so a change needs
a hard refresh (<kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>).

Home Assistant serves `/local/` with a month-long `Cache-Control`, so a plain
reload will happily keep running a card you built last week — which looks like
your change never compiled. `npm run ha` sidesteps that by registering the
resource as `/local/easy-floorplan-card.js?v=<hash of the bundle>`: every build
gets a URL no browser has seen. Only a full `npm run ha` re-registers, which is
why the `npm run watch` loop above still needs the hard refresh.

Other commands:

```bash
npm run ha:logs
```

```bash
npm run ha:down
```

```bash
npm run ha:reseed
```

```bash
npm run ha:reset
```

`ha:reseed` rewrites the Floorplan Demo dashboard from
`config/floorplan-demo.yaml`, discarding whatever you did to it in the UI.
Reach for it when an experiment has wandered somewhere you don't want, or
after pulling a change to the committed plan — the seed only applies itself to
a dashboard that does not exist yet, so your edits are never silently
overwritten by a restart. The browser picks the change up on a refresh.

The reverse direction is manual on purpose: if you build something in the
editor worth keeping, copy the YAML out of the dashboard's **⋮ → Raw
configuration editor** into `config/floorplan-demo.yaml` and commit it.

**One instance at a time.** The container name is fixed and Compose names its
project after this directory, which is called `docker` in every checkout of
this repo. So a second worktree running `npm run ha` would silently adopt the
running container — still mounting the first checkout's config and `dist` —
and you would edit files the instance never reads. `prepare.mjs` checks for
that and stops with the command to clear it, rather than letting you find out
an hour later.

`ha:reset` deletes the account, the dashboards you made in the UI and all
recorded history, putting you back at onboarding. Reach for it when the
instance gets into a state you do not want to reason about. It works by keeping
the four yaml files this repo owns and removing everything else under
`docker/config` ([`reset.mjs`](reset.mjs)), so it stays a full reset even as
Home Assistant adds new things to write there.

## The sample data

A container that has just booted has an empty recorder. Nothing to replay,
nothing on a history graph, every entity sitting at whatever it started as. So
[`config/automations.yaml`](config/automations.yaml) keeps the house busy:
lights toggling and recolouring every 10s, covers driving to intermediate
positions, temperature and humidity walking a couple of hundredths at a time,
a door opening for four seconds, a tracker drifting across the room, and one
sensor that goes genuinely `unavailable` for 45s every five minutes.

Within a couple of minutes of `up` there is a dense, real, recorder-backed
window to work with, and it keeps growing for as long as the container runs.

The generators are deliberately not all uniform noise. The soil moisture drifts
down and then gets "watered" so a threshold actually gets crossed while you
watch; the lights sometimes change brightness and colour *without* toggling, so
there are attribute-only transitions; the door events are short enough that a
coarse timeline can swallow them. Those are the cases worth having in front of
you.

Two of the controls on that view are yours to flip rather than the generator's:
**Left leaf** and **Right leaf**. They drive one contact pair that every
two-leaved opening on the plan shares — a casement window's sashes, a double
door's leaves, and a pair of hinged shutters — so flipping one of them swings
half of three different symbols at once. That half-open state is the point:
an opening with a single sensor moves both leaves together by definition, so
there is no other way to see a sash open beside a sash that is shut.

Two devices carry the multi-reading work (issue #180). The sensor in the middle
of the plan shows three numbers from one badge — its own temperature, the paired
humidity, and a third `readings` row — which is the ordering worth checking:
`entity`, then the legacy `secondaryEntity`, then `readings`. That device is
deliberately left on the old spelling, so the plan exercises the compatibility
path too: the card reads both as one pool, and opening the device in the editor
rewrites the pair into `readings` in front of you. The fan stands
in for the smart plug from discussion #173: `showState: false`, one reading off
its own `percentage` attribute, and its label hung to the **left** of the badge,
so a device that labels itself *without* its own state and a label that is not
underneath are both on the plan at once.

The plan has **two floors**, and a staircase on each that you can click to
change floor (issue #121): the ground floor's is `goToFloor: up`, the one
upstairs is `goToFloor: down`. The corner switcher is still there — the stairs
are a second way up, not a replacement for it. Upstairs is deliberately sparse:
enough to know you changed floor, not a second plan to keep up to date.

Worth trying: move the ground floor's staircase to the top floor in the editor
and it stops being a button, because there is no floor above it.

The plan also carries one device bound to `light.deleted_by_accident`, which is
not an entity and never will be. It is what a renamed or deleted binding looks
like, and the reason it is hard-coded rather than switchable is that no live
entity can produce "not in Home Assistant at all". It is the second flavour of
offline; `sensor.flaky_sensor` above is the first.

Switch the generators off with `input_boolean.history_generator` (on the History view)
when you want to read a still plan, or when a state you set by hand keeps
getting overwritten under you. `script.burst_activity` fires thirty changes in
six seconds when you want a busy stretch on demand, and `script.all_lights_off`
gives you a known starting state.

**History can only ever build forward from boot.** Recorder timestamps are
wall-clock, so there is no way to hand yourself a plan that was busy yesterday
short of writing rows into the recorder database directly — not worth it, since
the schema moves between Home Assistant versions and you would end up debugging
the fixture instead of the card.

## Why a real Home Assistant

This container is the only harness in the repo. There was once a mock-`hass` one
under `dev/`, faster to start but only ever able to agree with itself, because the
`hass` object it passed the card was one the repo wrote. It is gone. What a real
instance gives you instead:

- **The websocket is real.** State arrives as Home Assistant actually delivers
  it, at its own pace, with the attributes that Home Assistant version actually
  sets — not the ones the mock was written against.
- **The recorder is real.** History requests get a real response shape, real
  gaps, entities whose history begins after the window opens, and payloads of a
  realistic size. A mocked history loader that returns clean canned data
  regardless of what it is asked answers every request perfectly and so tests
  nothing about the request.
- **`unavailable` happens.** On a timer here, and constantly on real
  installations. It is neither on nor off and carries no attributes.
- **The resource loader is real.** The card is registered as a Lovelace
  resource, exactly as a user's install registers it, so a build that produces
  something the frontend won't accept fails here rather than in an issue
  report. ([`prepare.mjs`](prepare.mjs) writes that registration before the
  container starts, and explains why the obvious YAML shortcut,
  `frontend.extra_module_url`, races the dashboard render and intermittently
  produces a bare "Configuration error" card instead of the plan.)
- **HA's own theming and layout are real** — dark mode, `ha-card` sizing, the
  panel view, a phone-width window.

## Entity ids

The lights, covers, fan and media players come from Home Assistant's `demo`
integration, because it provides entities carrying the attributes the card
actually reads — `brightness` and `rgb_color`, `current_position` — which are
tedious to reproduce by hand. The sensors, the door contact and the tracker's
distance readings are defined in
[`config/configuration.yaml`](config/configuration.yaml) as template entities
over input helpers, so the generators have something to drive.

Ids from the `demo` integration can drift between Home Assistant versions. If a
badge reads "Entity not available", check **Developer Tools → States** and
update the id; the full list used by the sample plan is at the top of
[`config/floorplan-demo.yaml`](config/floorplan-demo.yaml).

### The four updates that never go away

Settings will show four pending updates on every boot. They are fake: the
`demo` integration ships six `update` entities that report "update available"
forever, and demo state is not persisted, so they return on every restart.

They cannot be dismissed. `update.skip` clears two of the six, but the other
four declare `auto_update: true` and Home Assistant refuses to skip an
auto-updating entity by design. There is no way to load the demo integration
without them.

Nothing here is broken, and nothing needs installing — this is the price of
getting lights that carry real `brightness` and `rgb_color` and covers that
carry a real `current_position` for free. Ignore that badge on this instance.

## Pinning a version

The compose file tracks `stable`. To reproduce something version-specific, pin
the tag:

```yaml
image: ghcr.io/home-assistant/home-assistant:2026.7
```

Then `npm run ha:reset` first — a config directory written by a newer Home
Assistant is not always readable by an older one.

## Moving the sun

Sunlight is only visible while the sun is up, which makes it awkward to work
on in the evening — and impossible to compare morning against afternoon
without waiting half a day.

`sun.sun` is computed from the instance's own coordinates and the real clock.
The clock is not ours to move (the recorder writes against it, and jumping it
backwards confuses it), but the coordinates are: solar time runs four minutes
per degree of longitude, so moving the instance east or west is exactly
equivalent to moving the sun.

```bash
node docker/sun-at.mjs --show   # where the sun is now
node docker/sun-at.mjs 9        # mid-morning, long raking patches
node docker/sun-at.mjs 12       # overhead: short patches at your feet
node docker/sun-at.mjs 17.5     # low evening sun
node docker/sun-at.mjs 2        # below the horizon: nothing drawn
docker restart easy-floorplan-ha
```

It edits `latitude`/`longitude` in `config/.storage/core.config`, so it changes
where the instance thinks it is — worth putting back if you care, and harmless
if you don't, since nothing else here reads the location.

The alternative, when the angle matters more than the hour, is to turn
**Follow the real sun** off in the card editor and set **Sun from** yourself.
A stated bearing keeps the light on around the clock by design, so it needs no
container changes at all — but it pins the elevation at full, so it will not
show you the dusk ramp or the way reach shortens as the sun climbs.


## Checking the roller shutter's sunlight

The demo enables sunlight and gives window `o1` an explicit `motion: roll`.
The demo cover has no shutter device class, so omitting that motion would test a
clear window instead of the roller-shutter case in PR #271.

After updating an existing development instance, run `npm run ha:reseed` to load
the changed demo plan. For a repeatable comparison, turn off the **history generator**
on the History view (it moves covers automatically). In the card editor, turn
**Follow the sun** off to disable night-time dimming, turn **Follow the real sun**
off under the sunlight controls, and set **Sun from** to `0` degrees, facing the
top wall's shutter. The equivalent card settings are `sunDimming: false` and
`sunBearing: 0`; keep `sunlight: true`.

Use `cover.living_room_window` on the History view to set its position to 100%,
50%, then 0%. Return to the Plan view at each position: sunlight through the top
window should shrink with the opening and disappear at 0%. The same plan, sun
bearing and lamp states should be used for every screenshot. Before this fix,
the sunlight patch remained even at 0% because the rolled-down shutter was treated
as clear glazing.


## 3D development preview

For a quick visual check without starting Home Assistant:

```bash
npx vite --host 127.0.0.1 --port 5261
```

Open [the 3D preview](http://127.0.0.1:5261/docker/3d-preview.html). It imports the
actual card source and supplies simulated entities. Change the viewing corner,
wall height and opacity; toggle doors, the roof window and its blind, and day/night; tap a room to check zoom.
The icon placeholder is local to this preview. Use the HA container above to
check real entity services, HA icons, editor selectors and history playback.

To use 3D in that container, choose **Project → Display → View → 3D isometric**
or add `view: 3d` to its card YAML. Older `projection: iso` configurations still
work. Nothing is reseeded or changed in an existing dashboard by the standalone
preview.
