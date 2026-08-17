// Register the card as a Lovelace *resource* before Home Assistant boots.
//
// The obvious way to load a custom card from YAML is `frontend:
// extra_module_url`, and it does put the file in the app shell -- but as a
// bare, unawaited dynamic import:
//
//     <script>import("/local/easy-floorplan-card.js");</script>
//
// Nothing coordinates that with the Lovelace renderer, so a dashboard can
// render before the module has defined <easy-floorplan-card>, and Home
// Assistant draws a "Configuration error" card instead of the plan. It is a
// race, so it comes and goes with cache state and machine speed, which is
// worse than a clean failure.
//
// Resources are the mechanism that does not race: the frontend fetches and
// awaits them before it renders dashboards. It is also how a real install
// loads this card (Settings > Dashboards > Resources, per the README), so
// using it here makes the harness faithful in one more place.
//
// Resources declared in YAML are only read when the whole Lovelace config is
// in yaml mode, and this instance keeps the default dashboard in storage mode
// so the visual editor stays reachable. So we write the same file the UI
// would: .storage/lovelace_resources. It is gitignored (it lives in HA's
// runtime state), which is why this runs on every `npm run ha` rather than
// being committed -- including right after `npm run ha:reset` has removed it.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Refuse to hand a running container config it is not reading.
//
// The container name is fixed, and Compose derives its project name from this
// directory -- which is called "docker" in every checkout of this repo. So a
// second worktree running `npm run ha` does not get its own instance: it
// adopts the one already running, still mounting the *first* checkout's
// config and dist. Everything appears to work, and you spend an afternoon
// editing files the instance never reads.
try {
  // `docker inspect` answers for stopped containers too, and a stopped
  // container still owns the name -- so both states need clearing, but they
  // are worth describing accurately.
  const raw = execFileSync(
    "docker",
    ["inspect", "easy-floorplan-ha", "--format", "{{.State.Status}}\n{{range .Mounts}}{{.Source}}\n{{end}}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const [state, ...mounts] = raw.split("\n").map((line) => line.trim());
  const configMount = mounts.find((line) => line.endsWith("/config"));
  if (configMount && resolve(configMount) !== resolve(join(here, "config"))) {
    console.error(
      `\nA container named easy-floorplan-ha already exists (${state}), mounting\n` +
        `  ${configMount}\n` +
        `which is not this checkout's\n  ${join(here, "config")}\n\n` +
        `It belongs to a different worktree, and the container name is fixed, so\n` +
        `starting from here would either fail on the name or adopt that instance and\n` +
        `leave you editing files it never reads. Clear it first:\n\n` +
        `  docker rm -f easy-floorplan-ha\n\n` +
        `That removes only the container. Its config and history are on a bind mount\n` +
        `in the other checkout and survive.\n`,
    );
    process.exit(1);
  }
} catch (error) {
  // Re-throw our own exit; anything else means no docker or no such
  // container, and there is nothing to collide with.
  if (error?.code === "ERR_INVALID_ARG_TYPE") throw error;
}

const storageDir = join(here, "config", ".storage");
const resourceFile = join(storageDir, "lovelace_resources");
const URL_PATH = "/local/easy-floorplan-card.js";

let store = {
  version: 1,
  minor_version: 1,
  key: "lovelace_resources",
  data: { items: [] },
};

if (existsSync(resourceFile)) {
  try {
    store = JSON.parse(readFileSync(resourceFile, "utf8"));
    store.data ??= { items: [] };
    store.data.items ??= [];
  } catch {
    // A corrupt store is not worth preserving on a throwaway instance.
    store.data = { items: [] };
  }
}

if (store.data.items.some((item) => item?.url === URL_PATH)) {
  console.log("Resource already registered; leaving it alone.");
} else {
  store.data.items.push({
    id: "easyfloorplandevresource01",
    type: "module",
    url: URL_PATH,
  });
  mkdirSync(storageDir, { recursive: true });
  writeFileSync(resourceFile, JSON.stringify(store, null, 2));
  console.log(`Registered ${URL_PATH} as a Lovelace resource.`);
}

// ---------------------------------------------------------------------------
// Seed the Floorplan Demo dashboard, in storage mode so it is editable.
//
// The plan wants to be two contradictory things: in git, so it can be
// reviewed and so a fresh clone gets a real floorplan, and editable in the UI,
// because a floorplan card whose whole point is a drag-and-drop editor is
// miserable to develop against through a text file. A yaml-mode dashboard
// gives the first and refuses the second -- Home Assistant will not edit yaml
// dashboards, and says so.
//
// So git keeps the yaml, and this seeds a *storage* dashboard from it: the
// same content, written into the two files the UI itself writes. From Home
// Assistant's side it is an ordinary dashboard, editable, with the card's own
// editor reachable on it.
//
// It seeds only when absent, so your edits survive restarts. `npm run
// ha:reseed` overwrites it from the yaml again when you want the committed
// plan back, and `npm run ha:reset` clears it along with everything else.

const DASH_ID = "floorplan_demo";
const DASH_URL = "floorplan-demo";
const dashboardsFile = join(storageDir, "lovelace_dashboards");
const dashConfigFile = join(storageDir, `lovelace.${DASH_ID}`);
const reseed = process.argv.includes("--reseed");

let dashboards = {
  version: 1,
  minor_version: 1,
  key: "lovelace_dashboards",
  data: { items: [] },
};
if (existsSync(dashboardsFile)) {
  try {
    dashboards = JSON.parse(readFileSync(dashboardsFile, "utf8"));
    dashboards.data ??= { items: [] };
    dashboards.data.items ??= [];
  } catch {
    dashboards.data = { items: [] };
  }
}

if (!dashboards.data.items.some((item) => item?.id === DASH_ID)) {
  dashboards.data.items.push({
    id: DASH_ID,
    title: "Floorplan Demo",
    url_path: DASH_URL,
    icon: "mdi:floor-plan",
    mode: "storage",
    require_admin: false,
    show_in_sidebar: true,
  });
  mkdirSync(storageDir, { recursive: true });
  writeFileSync(dashboardsFile, JSON.stringify(dashboards, null, 2));
  console.log("Registered the Floorplan Demo dashboard.");
}

if (!existsSync(dashConfigFile) || reseed) {
  const yaml = (await import("js-yaml")).default ?? (await import("js-yaml"));
  const seed = yaml.load(readFileSync(join(here, "config", "floorplan-demo.yaml"), "utf8"));
  mkdirSync(storageDir, { recursive: true });
  writeFileSync(
    dashConfigFile,
    JSON.stringify(
      {
        version: 1,
        minor_version: 1,
        key: `lovelace.${DASH_ID}`,
        data: { config: { views: seed.views } },
      },
      null,
      2,
    ),
  );
  console.log(
    reseed
      ? "Reseeded the Floorplan Demo dashboard from floorplan-demo.yaml (UI edits discarded)."
      : "Seeded the Floorplan Demo dashboard from floorplan-demo.yaml.",
  );
} else {
  console.log("Floorplan Demo dashboard already exists; keeping your edits (npm run ha:reseed to reset it).");
}
