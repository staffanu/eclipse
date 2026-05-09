// Penumbral footprint: the region on Earth's surface where any partial solar
// eclipse is visible at a given instant.
//
// At each point of a lat/lon grid we:
//   1. Build the topocentric Sun and Moon position vectors (geocentric J2000
//      vectors with the observer's J2000 position subtracted).
//   2. Check that the Sun is above the local horizon (observer's outward
//      normal · Sun direction > 0).
//   3. Compute the Sun-Moon angular separation and the apparent radii. If
//      the disks overlap (separation < R_sun + R_moon) the observer sees a
//      partial eclipse.
//
// The returned list is one cell per "in-footprint" grid point, with
// obscuration (fraction of the Sun's disk area covered by the Moon). The
// caller renders these as semi-transparent rectangles on the map.

import * as A from "astronomy-engine";

const AU_KM = 149_597_870.7;
const R_SUN = 695_700.0;
const R_MOON = 1_737.4;

export const FOOTPRINT_LAT_STEP = 3;
export const FOOTPRINT_LON_STEP = 3;

export function computePartialFootprint(time) {
  const t = A.MakeTime(time);
  const sun = A.GeoVector(A.Body.Sun, t, true);
  const moon = A.GeoMoon(t);

  const cells = [];
  for (let lat = -87; lat < 90; lat += FOOTPRINT_LAT_STEP) {
    for (let lon = -180; lon < 180; lon += FOOTPRINT_LON_STEP) {
      const obs = new A.Observer(lat, lon, 0);
      const ov = A.ObserverVector(t, obs, false);
      const sunTopo = sub(sun, ov);
      const moonTopo = sub(moon, ov);

      // Sun above the local horizon? (observer outward normal · sun direction > 0)
      if (dot(ov, sunTopo) <= 0) continue;

      const sunDistKm = mag(sunTopo) * AU_KM;
      const moonDistKm = mag(moonTopo) * AU_KM;
      const sunR = Math.asin(R_SUN / sunDistKm);
      const moonR = Math.asin(R_MOON / moonDistKm);
      const cosSep = dot(sunTopo, moonTopo) / (mag(sunTopo) * mag(moonTopo));
      const sep = Math.acos(Math.min(1, Math.max(-1, cosSep)));
      if (sep >= sunR + moonR) continue;

      cells.push({ lat, lon, obscuration: obscuration(sep, sunR, moonR) });
    }
  }
  return cells;
}

function obscuration(d, R, r) {
  if (d >= R + r) return 0;
  if (d <= Math.abs(R - r)) return Math.min(1, (r * r) / (R * R));
  const R2 = R * R, r2 = r * r, d2 = d * d;
  const a = R2 * Math.acos((d2 + R2 - r2) / (2 * d * R));
  const b = r2 * Math.acos((d2 + r2 - R2) / (2 * d * r));
  const c = 0.5 * Math.sqrt((-d + R + r) * (d + R - r) * (d - R + r) * (d + R + r));
  return (a + b - c) / (Math.PI * R2);
}

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function mag(a) { return Math.sqrt(dot(a, a)); }
