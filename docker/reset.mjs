// Put docker/config back to how it looks in git: the handful of yaml files we
// own, and nothing else. That means the account, the UI dashboards, the config
// entries and the whole recorder database go, so the next `npm run ha` starts
// at onboarding with an empty history.
//
// This is deliberately a keep-list rather than a delete-list. Home Assistant
// writes a lot into /config and adds to it between versions -- .storage, the
// db and its journals, logs, .cache, blueprints, known_devices.yaml, tts,
// deps. Enumerating those means a reset quietly stops being a reset the first
// time a new one appears. The same reasoning as docker/config/.gitignore,
// which ignores everything and re-adds what we own.
//
// It is Node rather than `rm -rf` so `npm run ha:reset` works on Windows too,
// where npm scripts run through cmd.exe and there is no rm.

import { readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const configDir = join(dirname(fileURLToPath(import.meta.url)), "config");

// Must match the !-exceptions in docker/config/.gitignore.
const keep = new Set([
  ".gitignore",
  "configuration.yaml",
  "automations.yaml",
  "scripts.yaml",
  "floorplan-demo.yaml",
]);

let removed = 0;
for (const entry of readdirSync(configDir)) {
  if (keep.has(entry)) continue;
  rmSync(join(configDir, entry), { recursive: true, force: true });
  removed += 1;
}

console.log(
  removed
    ? `Reset: removed ${removed} runtime item(s) from docker/config. Next \`npm run ha\` starts at onboarding.`
    : "Reset: docker/config was already clean.",
);
