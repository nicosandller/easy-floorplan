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
  const mounted = execFileSync(
    "docker",
    ["inspect", "easy-floorplan-ha", "--format", "{{range .Mounts}}{{.Source}}\n{{end}}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const configMount = mounted.split("\n").find((line) => line.trim().endsWith("/config"));
  if (configMount && resolve(configMount.trim()) !== resolve(join(here, "config"))) {
    console.error(
      `\nA container named easy-floorplan-ha is already running, and it is mounting\n` +
        `  ${configMount.trim()}\n` +
        `which is not this checkout's\n  ${join(here, "config")}\n\n` +
        `It was started from a different worktree, and because the container name is\n` +
        `fixed you would be editing files it never reads. Stop that one first:\n\n` +
        `  docker rm -f easy-floorplan-ha\n`,
    );
    process.exit(1);
  }
} catch {
  // No docker, or no such container: nothing to collide with.
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
