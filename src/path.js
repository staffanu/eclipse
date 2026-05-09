// Compute the umbral / antumbral / penumbral footprints of a solar eclipse on
// Earth's surface by intersecting the Moon's shadow cone with the WGS84
// ellipsoid model of Earth.
//
// We rotate the Sun and Moon vectors from the J2000 mean equator (EQJ) frame
// into the true equator of date (EQD) frame so the ellipsoid axes align with
// the coordinate axes (Earth's true rotation pole is +Z in EQD). We solve the
// quadratic for ray-ellipsoid intersection there, then rotate the resulting
// surface point back to EQJ and call astronomy-engine's VectorObserver to
// project onto geographic latitude/longitude (it handles sidereal rotation
// using the AstroTime stamp on the vector).
//
// Distinguishing total vs annular: the umbral cone has its apex at distance
//     L = |M - S| * R_moon / (R_sun - R_moon)
// from the Moon along the shadow axis. If the surface intersection s* < L
// the umbra reaches the surface (Total). If s* > L the apex falls short and
// observers near the centerline see an annular eclipse.

import * as A from "astronomy-engine";

const AU_KM = 149_597_870.7;
const R_SUN = 695_700.0;
const R_MOON = 1_737.4;
// WGS84 ellipsoid axes (km).
const R_EQ = 6_378.137;
const R_POL = 6_356.752;

export function computeShadowPath(eclipse, opts = {}) {
  const halfHours = opts.halfHours ?? 3.0;
  const stepMinutes = opts.stepMinutes ?? 2.0;
  const peakUt = eclipse.peak.ut;
  const samples = [];
  const nSteps = Math.round((halfHours * 60) / stepMinutes);
  let peakIndex = 0;
  let bestDt = Infinity;

  for (let i = -nSteps; i <= nSteps; i++) {
    const ut = peakUt + (i * stepMinutes) / (60 * 24);
    const t = A.MakeTime(utToDate(ut));
    samples.push(sampleAt(t));
    const dt = Math.abs(ut - peakUt);
    if (dt < bestDt) { bestDt = dt; peakIndex = samples.length - 1; }
  }
  return { samples, peakIndex };
}

// Compute the shadow-center sample at an arbitrary instant — used by the
// time slider to position the moving marker without re-sampling the full
// path each tick.
export function shadowSampleAtTime(time) {
  return sampleAt(A.MakeTime(time));
}

function sampleAt(t) {
  // Sun and Moon in J2000 equatorial geocentric coords (AU). We use the
  // *apparent* Sun position (aberration corrected) because that's what
  // determines where the Moon's shadow falls from an observer's perspective:
  // light reaching the Moon now left the Sun ~8 minutes ago, so the shadow
  // axis at this instant points from the apparent Sun through the Moon. Not
  // doing this would offset the path by ~35 km.
  const sunEqj = A.GeoVector(A.Body.Sun, t, true);
  const moonEqj = A.GeoMoon(t);

  // Rotate to equator-of-date so +Z is Earth's true rotation pole at this
  // instant — that is what the WGS84 ellipsoid is aligned to.
  const eqjToEqd = A.Rotation_EQJ_EQD(t);
  const sunEqd = A.RotateVector(eqjToEqd, sunEqj);
  const moonEqd = A.RotateVector(eqjToEqd, moonEqj);

  const S = scale(sunEqd, AU_KM);
  const M = scale(moonEqd, AU_KM);
  const SM = sub(M, S);
  const SMlen = len(SM);
  const D = scale(SM, 1 / SMlen); // unit shadow-axis direction

  // Solve (Mx + s Dx)^2 / a^2 + (My + s Dy)^2 / a^2 + (Mz + s Dz)^2 / c^2 = 1
  // with a = R_EQ, c = R_POL.
  const a2 = R_EQ * R_EQ, c2 = R_POL * R_POL;
  const aQ = (D.x*D.x + D.y*D.y) / a2 + D.z*D.z / c2;
  const bQ = 2 * ((M.x*D.x + M.y*D.y) / a2 + M.z*D.z / c2);
  const cQ = (M.x*M.x + M.y*M.y) / a2 + M.z*M.z / c2 - 1;
  const disc = bQ*bQ - 4*aQ*cQ;
  if (disc < 0) {
    return { time: t, lat: null, lon: null, kind: "none", axisDistKm: NaN };
  }
  const sqrtDisc = Math.sqrt(disc);
  const s = (-bQ - sqrtDisc) / (2 * aQ);
  if (s <= 0) return { time: t, lat: null, lon: null, kind: "none", axisDistKm: NaN };

  const Pkm_eqd = add(M, scale(D, s));

  // Rotate the surface point back to EQJ so VectorObserver can project to
  // geographic lat/lon (it expects an EQJ vector with a time stamp).
  const eqdToEqj = A.Rotation_EQD_EQJ(t);
  const pVecEqd = new A.Vector(Pkm_eqd.x / AU_KM, Pkm_eqd.y / AU_KM, Pkm_eqd.z / AU_KM, t);
  const pVecEqj = A.RotateVector(eqdToEqj, pVecEqd);
  const obs = A.VectorObserver(pVecEqj);

  const L = SMlen * R_MOON / (R_SUN - R_MOON);
  const kind = s < L ? "total" : "annular";

  return { time: t, lat: obs.latitude, lon: obs.longitude, kind, axisDistKm: 0 };
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

