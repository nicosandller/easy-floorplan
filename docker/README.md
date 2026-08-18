# Developing against a real Home Assistant

A throwaway Home Assistant in a container, preloaded with a sample floorplan
and entities that keep changing, so the card can be developed against the real
thing rather than a mock.

## Running it

Needs Docker with **Compose v2**: the scripts call `docker compose` as a
subcommand, not the older standalone `docker-compose` binary. `docker compose
version` tells you which you have.

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
a hard refresh (<kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>). This is the
one place the container is more friction than the vite harness, which hot-reloads.

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

## What this catches that `dev/` cannot

The vite harness in [`dev/`](../dev) is faster and will stay the right tool for
laying out a plan or iterating on the editor: it hot-reloads, it needs no
account, and it starts instantly. What it cannot do is disagree with you,
because the `hass` object it passes the card is one the repo wrote.

Against a container:

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
