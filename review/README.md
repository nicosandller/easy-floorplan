# Review captures

Before/after renders used in the PR reviews of #164, #184 and #204.

The Home Assistant dev container (`npm run ha`) could not be used for these:
this environment's egress policy blocks `pkg-containers.githubusercontent.com`,
so `ghcr.io/home-assistant/home-assistant:stable` cannot be pulled.

Instead the built `dist/easy-floorplan-card.js` was loaded into headless
Chromium with the demo plan from `docker/config/floorplan-demo.yaml` and a
mocked `hass` (sun elevation 42.5deg, lights on, sensors at their demo values).
CSS animation is frozen in the harness, so a before/after pair differs only by
the code under review — an earlier unfrozen pass made the tracker's ripple ring
look like a rendering change when it was only animation phase.

Each pair uses the *same* card config on both sides; `main` simply ignores the
new field.
