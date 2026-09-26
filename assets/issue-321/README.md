# Issue #321: depth sorting

Actual browser screenshots from `docker/depth-preview.html`, using the geometry
from the reporter's [attached YAML](https://github.com/user-attachments/files/32604056/easy-floorplan-card.yaml).
The fixture is `docker/fixtures/issue-321.json`; device badges and entity bindings
are omitted. Both captures use rotation 0, wall height 100 and opacity 1.

- `before.png`: upstream `ea5b5d2c4835f0679f362f4472651064ed682fba`, with only the preview and fixture copied in.
- `after.png`: this branch.

Run `npx vite --host 127.0.0.1 --port 4321` and open
`http://127.0.0.1:4321/docker/depth-preview.html`. The `?stage=before` query changes
only the caption; comparison captures require the corresponding source checkout.

Inspect the window sills, joined wall corners and the bathtub behind the bathroom
partition. The preview also exposes rotation and wall opacity controls.
