# Developing against a real Home Assistant

A throwaway Home Assistant in a container, preloaded with a sample floorplan
and entities that keep changing, so the card can be developed against the real
thing rather than a mock.

## Running it

Needs Docker with **Compose v2**: the scripts call `docker compose` as a
subcommand, not the older standalone `docker-compose` binary. `docker compose
version` tells you which you have.

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

- **Floorplan Demo** — the sample plan, defined in
  [`config/floorplan-demo.yaml`](config/floorplan-demo.yaml). Edit that file
  and refresh the browser; yaml dashboards are re-read on load, so there is no
  restart in the loop.
- **Overview** — where the **visual editor** is reachable. Home Assistant
  auto-generates this dashboard from your entities, and an auto-generated
  dashboard is not editable as-is: click the pencil, then **⋮ → Take control**
  in the dialog that appears. That converts it to a dashboard you own, once,
  after which **+ Add card → Easy Floorplan** opens `src/editor.ts`. The
  Floorplan Demo dashboard cannot do this — it is yaml-mode, and Home
  Assistant refuses to edit yaml dashboards in the UI ("The edit UI is not
  available when in YAML mode"). That is the trade: the sample plan lives in
  git, so the editor gets Overview instead.
- **History** (inside Floorplan Demo) — a plain history graph over the same
  entities, plus switches for the sample-data generators. When the card and
  Home Assistant disagree about what happened, this is where you find out
  which of them is wrong.

While working, run `npm run watch` in a second terminal. It rebuilds `dist/` on
save, and `dist/` is mounted into the container, so the new file is in place
immediately — but the browser has already cached the old one, so a change needs
a hard refresh (<kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>). This is the
one place the container is more friction than the vite harness, which hot-reloads.

Other commands:

```bash
npm run ha:logs
```

```bash
npm run ha:down
```

```bash
npm run ha:reset
```

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

Switch the lot off with `input_boolean.history_generator` (on the History view)
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
- **The resource loader is real.** The card is loaded the way a user's
  instance loads it, so a build that produces something the frontend won't
  accept fails here rather than in an issue report.
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
