#!/usr/bin/env node
/**
 * Put the container's sun wherever you need it, so sunlight can be worked on
 * at any hour — including at night, when there is otherwise nothing to look at.
 *
 * Home Assistant's `sun.sun` is computed from the instance's own coordinates
 * and the real clock. The clock is not ours to move (the recorder writes
 * against it, and a jump backwards confuses it), but the coordinates are:
 * solar time runs 4 minutes per degree of longitude, so moving the instance
 * east or west is exactly equivalent to moving the sun. Latitude sets how
 * high it climbs, which is what the reach scales with.
 *
 *   node docker/sun-at.mjs 9       # sun as it is at 09:00 solar time
 *   node docker/sun-at.mjs 12      # overhead: short patches
 *   node docker/sun-at.mjs 17.5    # low and raking, long patches
 *   node docker/sun-at.mjs 2       # below the horizon: nothing drawn
 *   node docker/sun-at.mjs --show  # what the sun is doing right now
 *
 * Restart the container afterwards for HA to pick the new location up.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// configuration.yaml, NOT .storage/core.config. A `homeassistant:` block in
// YAML wins over the stored core config, and this instance has one — editing
// the store looks like it works (the file changes, the UI even shows the new
// place) and moves the sun not at all. That cost an afternoon: the card was
// correctly drawing nothing, because sun.sun was still reading below_horizon
// from coordinates half a world from where the store claimed to be.
const store = resolve(here, "config", "configuration.yaml");
const LAT = /^(\s*latitude:\s*)(-?[\d.]+)/m;
const LON = /^(\s*longitude:\s*)(-?[\d.]+)/m;
const readLoc = (text) => ({
  latitude: Number(text.match(LAT)?.[2]),
  longitude: Number(text.match(LON)?.[2]),
});

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Equation of time, minutes, for a day of the year. */
function eot(day) {
  const g = rad((360 / 365.25) * (day - 81));
  return 9.87 * Math.sin(2 * g) - 7.53 * Math.cos(g) - 1.5 * Math.sin(g);
}
function declination(day) {
  return rad(23.44) * Math.sin(rad((360 / 365.25) * (day - 81)));
}
/**
 * @param {Date} date
 * @param {number} lat
 * @param {number} lon
 */
function solarPosition(date, lat, lon) {
  // getTime() on both sides: subtracting two Dates is valid JavaScript but not
  // valid TypeScript, and the day-of-year here is genuinely arithmetic on
  // milliseconds rather than on dates.
  const day = Math.floor(
    (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 864e5
  );
  const utc = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const solar = utc + (4 * lon + eot(day)) / 60;
  const H = rad(15 * (solar - 12));
  const d = declination(day);
  const la = rad(lat);
  const elevation = deg(Math.asin(Math.sin(la) * Math.sin(d) + Math.cos(la) * Math.cos(d) * Math.cos(H)));
  const azimuth =
    (deg(Math.atan2(-Math.sin(H), Math.tan(d) * Math.cos(la) - Math.sin(la) * Math.cos(H))) + 360) % 360;
  return { elevation, azimuth, solarTime: ((solar % 24) + 24) % 24 };
}

const text = readFileSync(store, "utf8");
const data = readLoc(text);
if (!Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) {
  console.error("Could not find latitude/longitude in docker/config/configuration.yaml.");
  process.exit(1);
}
const now = new Date();
const arg = process.argv[2];

if (!arg || arg === "--show") {
  const p = solarPosition(now, data.latitude, data.longitude);
  console.log(`  location   ${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}`);
  console.log(`  solar time ${p.solarTime.toFixed(2)}h`);
  console.log(`  elevation  ${p.elevation.toFixed(1)}°  ${p.elevation <= 0 ? "(below the horizon — nothing is drawn)" : ""}`);
  console.log(`  azimuth    ${p.azimuth.toFixed(1)}°`);
  process.exit(0);
}

const target = Number(arg);
if (!Number.isFinite(target) || target < 0 || target >= 24) {
  console.error("Give an hour between 0 and 24, e.g. `node docker/sun-at.mjs 15.5`.");
  process.exit(1);
}

const day = Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 864e5);
const utc = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
// solarTime = utc + (4*lon + eot)/60  =>  lon = ((target - utc)*60 - eot) / 4
let lon = ((target - utc) * 60 - eot(day)) / 4;
while (lon > 180) lon -= 360;
while (lon < -180) lon += 360;

const before = solarPosition(now, data.latitude, data.longitude);
const next = Number(lon.toFixed(4));
writeFileSync(store, text.replace(LON, `$1${next}`));
data.longitude = next;
const after = solarPosition(now, data.latitude, data.longitude);

console.log(`  solar time  ${before.solarTime.toFixed(2)}h -> ${after.solarTime.toFixed(2)}h`);
console.log(`  elevation   ${before.elevation.toFixed(1)}° -> ${after.elevation.toFixed(1)}°`);
console.log(`  azimuth     ${before.azimuth.toFixed(1)}° -> ${after.azimuth.toFixed(1)}°`);
console.log(`  longitude   -> ${data.longitude}`);
console.log(`\n  Restart for HA to read it:  docker restart easy-floorplan-ha`);
