# Issue #323: furniture taps

Actual browser screenshots of `docker/furniture-click-preview.html`, taken after
clicking the decorative table's painted surface in both 2D and 3D.

- `before.png`: upstream `ea5b5d2c4835f0679f362f4472651064ed682fba`, with only the preview copied in. Neither room focuses.
- `after.png`: this branch. Both rooms focus and show their zoom-out controls.

Run `npx vite --host 127.0.0.1 --port 4323` and open
`http://127.0.0.1:4323/docker/furniture-click-preview.html`. Tap the centre of each
table; use the reset button to repeat. The `?stage=before` query changes only the
caption; comparison captures require the corresponding source checkout.
