# YAML coordinate screenshots

`before.png` shows upstream `ea5b5d2c4835f0679f362f4472651064ed682fba`;
`after.png` shows this change. Both run the same `docker/yaml-preview.html`
against the actual card, using js-yaml's YAML 1.1 parse/save/parse cycle.
The page is a local reproduction, not a screenshot of the Home Assistant editor.

Run `npx vite --host 127.0.0.1`, then open `/docker/yaml-preview.html`.
To reproduce the baseline, copy that HTML file into a separate checkout of the
upstream commit and serve it with the same dependencies.
