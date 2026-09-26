# Issue #322: 3D railings

Actual browser screenshots of `docker/railing-preview.html`, with identical
configuration: one full wall, three railing edges, wall height 90 and thickness 12.

- `before.png`: upstream `ea5b5d2c4835f0679f362f4472651064ed682fba`, with only the preview copied in.
- `after.png`: this branch, with half-height railings at 40% wall thickness.

Run `npx vite --host 127.0.0.1 --port 4322` and open
`http://127.0.0.1:4322/docker/railing-preview.html`. The `?stage=before` query changes
only the caption; comparison captures require the corresponding source checkout.
