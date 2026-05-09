// Compute the umbral / antumbral / penumbral footprints of a solar eclipse on
// Earth's surface by intersecting the Moon's shadow cone with a spherical
// Earth model.
//
// Strategy: in J2000 mean-equator (EQJ) geocentric coordinates, the Sun and
// Moon positions S, M are inertial vectors at instant t. The shadow axis is
// the ray starting at M in the direction (M - S)/|M - S|. We solve for the
// near-side intersection s* with a sphere of radius R_earth centred at the
// origin, then call astronomy-engine's VectorObserver to convert the
// resulting J2000 vector into geographic latitude and longitude (it accounts
// for sidereal rotation using the AstroTime stamp on the vector).
//
// Distinguishing total vs annular: the umbral cone has its apex at distance
//     L = |M - S| * R_moon / (R_sun - R_moon)
// from the Moon along the shadow axis. If the near-side intersection s* < L
// the umbra reaches the surface (Total). If s* > L the apex falls short and
// observers near the centerline see an annular eclipse.

import * as A from "astronomy-engine";

const AU_KM = 149_597_870.7;
const R_SUN = 695_700.0;
const R_MOON = 1_737.4;
const R_EARTH = 6_378.137;

// Sample the path between (peak - halfHours) and (peak + halfHours), one point
// every stepMinutes. Returns:
//   { samples: [{ time, lat, lon, kind, axisDistKm, sunAlt }], peakIndex }
// where kind is one of "total", "annular", "none" (axis misses Earth).
export function computeShadowPath(eclipse, opts = {}) {
  const halfHours = opts.halfHours ?? 3.0;
  const stepMinutes = opts.stepMinutes ?? 2.0;
  const peakUt = eclipse.peak.ut;
  const samples = [];
  const nSteps = Math.round((halfHours * 60) / stepMinutes);
  let peakIndex = 0;
  let bestDist = Infinity;

  for (let i = -nSteps; i <= nSteps; i++) {
    const ut = peakUt + (i * stepMinutes) / (60 * 24);
    const t = A.MakeTime(utToDate(ut));
    const sample = sampleAt(t);
    samples.push(sample);
    if (sample.kind !== "none" && sample.axisDistKm < bestDist) {
      bestDist = sample.axisDistKm;
      peakIndex = samples.length - 1;
    }
  }
  return { samples, peakIndex };
}

function sampleAt(t) {
  const sunV = A.GeoVector(A.Body.Sun, t, false);
  const moonV = A.GeoMoon(t);
  // Convert to km.
  const S = scale(sunV, AU_KM);
  const M = scale(moonV, AU_KM);
  const SM = sub(M, S);
  const SMlen = len(SM);
  const D = scale(SM, 1 / SMlen); // unit shadow-axis direction

  // Solve |M + s D|^2 = R_earth^2 for the smallest positive s.
  const b = 2 * dot(M, D);
  const c = dot(M, M) - R_EARTH * R_EARTH;
  const disc = b * b - 4 * c;
  if (disc < 0) {
    // Axis misses Earth — could still be a partial eclipse somewhere, but
    // there is no centerline ground point at this instant.
    return { time: t, lat: null, lon: null, kind: "none", axisDistKm: NaN };
  }
  const sqrtDisc = Math.sqrt(disc);
  const s1 = (-b - sqrtDisc) / 2;
  const s2 = (-b + sqrtDisc) / 2;
  const s = s1 > 0 ? s1 : s2;
  if (s <= 0) return { time: t, lat: null, lon: null, kind: "none", axisDistKm: NaN };

  // Surface point in J2000 km, then in AU as a Vector with the time stamp so
  // VectorObserver can apply sidereal rotation correctly.
  const Pkm = add(M, scale(D, s));
  const Pvec = new A.Vector(Pkm.x / AU_KM, Pkm.y / AU_KM, Pkm.z / AU_KM, t);
  const obs = A.VectorObserver(Pvec);

  // Total vs annular: compare s to umbral apex distance L.
  const L = SMlen * R_MOON / (R_SUN - R_MOON);
  const kind = s < L ? "total" : "annular";

  return {
    time: t,
    lat: obs.latitude,
    lon: obs.longitude,
    kind,
    axisDistKm: 0, // by construction the axis hits the surface here
  };
}

function utToDate(ut) {
  return new Date((ut + 10957.5) * 86400_000);
}

// --- tiny vector helpers ---
function scale(v, k) { return { x: v.x * k, y: v.y * k, z: v.z * k }; }
function add(a, b)   { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function sub(a, b)   { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a, b)   { return a.x * b.x + a.y * b.y + a.z * b.z; }
function len(a)      { return Math.sqrt(dot(a, a)); }
