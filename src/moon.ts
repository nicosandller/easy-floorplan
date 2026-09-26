/**
 * Where the moon is, and how much of it is lit (issue #201).
 *
 * Home Assistant has no entity for this. Its `moon` integration reports the
 * phase as one of eight names and nothing about position, so the card works
 * the moon out itself from the instance's latitude and longitude and the time
 * — which is also what lets a replayed night show that night's moon.
 *
 * The formulas are the low-precision series from Jean Meeus' *Astronomical
 * Algorithms* (chapters 25 and 47, truncated to their largest terms) — the
 * same family SunCalc uses, with the solar perturbations and parallax it
 * leaves out, which were worth up to four degrees. Checked against PyEphem
 * over 2020-2031 at six latitudes from Quito to Tromsø: see `moon.test.ts`.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
/** Julian date of the Unix epoch, and of the J2000.0 epoch the series count from. */
const J1970 = 2_440_588;
const J2000 = 2_451_545;
/** Obliquity of the ecliptic. */
const OBLIQUITY = 23.4397 * RAD;
/** Mean Earth-sun distance, km — only its ratio to the moon's distance matters. */
const SUN_DISTANCE = 149_598_000;
/** Earth's equatorial radius, km. */
const EARTH_RADIUS = 6_378.14;

interface Equatorial {
  /** Right ascension, radians. */
  ra: number;
  /** Declination, radians. */
  dec: number;
}

/** Days since J2000.0, from a Unix time in ms. */
function daysSinceJ2000(time: number): number {
  return time / DAY_MS - 0.5 + J1970 - J2000;
}

function equatorial(longitude: number, latitude: number): Equatorial {
  return {
    ra: Math.atan2(
      Math.sin(longitude) * Math.cos(OBLIQUITY) - Math.tan(latitude) * Math.sin(OBLIQUITY),
      Math.cos(longitude),
    ),
    dec: Math.asin(
      Math.sin(latitude) * Math.cos(OBLIQUITY) +
        Math.cos(latitude) * Math.sin(OBLIQUITY) * Math.sin(longitude),
    ),
  };
}

function sunCoords(d: number): Equatorial {
  const m = (357.5291 + 0.98560028 * d) * RAD;
  const centre = (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)) * RAD;
  const perihelion = 102.9372 * RAD;
  return equatorial(m + centre + perihelion + Math.PI, 0);
}

function moonCoords(d: number): Equatorial & { distance: number } {
  const meanLongitude = (218.316 + 13.176396 * d) * RAD;
  const meanAnomaly = (134.963 + 13.064993 * d) * RAD;
  const argumentOfLatitude = (93.272 + 13.22935 * d) * RAD;
  const elongation = (297.85 + 12.190749 * d) * RAD;
  const sunAnomaly = (357.5291 + 0.98560028 * d) * RAD;
  const [mm, f, dd] = [meanAnomaly, argumentOfLatitude, elongation];
  // The largest periodic terms of each series, degrees and km. The first of
  // each is the ellipse; the rest are the sun pulling on it — evection and
  // variation alone move the moon by up to two degrees.
  const longitude =
    meanLongitude +
    RAD *
      (6.289 * Math.sin(mm) +
        1.274 * Math.sin(2 * dd - mm) +
        0.658 * Math.sin(2 * dd) +
        0.214 * Math.sin(2 * mm) -
        0.186 * Math.sin(sunAnomaly) -
        0.114 * Math.sin(2 * f));
  const latitude =
    RAD *
    (5.128 * Math.sin(f) +
      0.281 * Math.sin(mm + f) +
      0.278 * Math.sin(mm - f) +
      0.173 * Math.sin(2 * dd - f));
  return {
    ...equatorial(longitude, latitude),
    distance: 385_001 - 20_905 * Math.cos(mm) - 3_699 * Math.cos(2 * dd - mm) - 2_956 * Math.cos(2 * dd),
  };
}

/**
 * The moon as seen from a place on Earth: its compass `bearing` (degrees
 * clockwise from north, the convention `sun.sun`'s azimuth uses) and its
 * `altitude` above the horizon in degrees, refraction included.
 */
export function moonPosition(
  time: number,
  latitude: number,
  longitude: number,
): { bearing: number; altitude: number } {
  const d = daysSinceJ2000(time);
  const phi = latitude * RAD;
  const moon = moonCoords(d);
  // Hour angle: local sidereal time less the moon's right ascension.
  const h = (280.16 + 360.9856235 * d) * RAD + longitude * RAD - moon.ra;
  const geocentric = Math.asin(
    Math.sin(phi) * Math.sin(moon.dec) + Math.cos(phi) * Math.cos(moon.dec) * Math.cos(h),
  );
  // Parallax. The moon is close enough that where on Earth you stand moves it
  // by up to a degree — lowest on the horizon, where it matters most here.
  const alt = geocentric - Math.asin(EARTH_RADIUS / moon.distance) * Math.cos(geocentric);
  // Atmospheric refraction lifts a body near the horizon by up to half a
  // degree — about the moon's own width, so it decides whether a moon that
  // has just risen is up at all.
  const a = Math.max(0, alt);
  const refraction = 0.0002967 / Math.tan(a + 0.00312536 / (a + 0.08901179));
  // Measured from south, westward, by the series; turned to a compass bearing.
  const fromSouth = Math.atan2(
    Math.sin(h),
    Math.cos(h) * Math.sin(phi) - Math.tan(moon.dec) * Math.cos(phi),
  );
  return {
    bearing: (((fromSouth / RAD + 180) % 360) + 360) % 360,
    altitude: (alt + refraction) / RAD,
  };
}

/**
 * How much of the moon's disc is lit, 0 at new moon to 1 at full — the
 * same for everyone on Earth at a given moment, so it needs no place.
 */
export function moonIllumination(time: number): number {
  const d = daysSinceJ2000(time);
  const sun = sunCoords(d);
  const moon = moonCoords(d);
  // Sun-moon elongation as seen from Earth, then the phase angle at the moon.
  const elongation = Math.acos(
    Math.sin(sun.dec) * Math.sin(moon.dec) +
      Math.cos(sun.dec) * Math.cos(moon.dec) * Math.cos(sun.ra - moon.ra),
  );
  const phaseAngle = Math.atan2(
    SUN_DISTANCE * Math.sin(elongation),
    moon.distance - SUN_DISTANCE * Math.cos(elongation),
  );
  return (1 + Math.cos(phaseAngle)) / 2;
}
