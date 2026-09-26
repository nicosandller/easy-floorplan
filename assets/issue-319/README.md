# Ambient daylight screenshots

`before.png` shows upstream `ea5b5d2c4835f0679f362f4472651064ed682fba`;
`after.png` shows this change. Both run the same `docker/ambient-preview.html`
against the actual card, with simulated daytime entities and direct sunlight off.
These are synthetic regression layouts, not the reporter's configuration.

Run `npx vite --host 127.0.0.1`, then open `/docker/ambient-preview.html`.
To reproduce the baseline, copy that HTML file into a separate checkout of the
upstream commit and serve it with the same dependencies.
