// Translate a Delta T uncertainty (sigma seconds) into a ground-track shift.
//
// A 1-sigma error in Delta T means the actual eclipse occurs sigma seconds
// earlier or later in UT than predicted; the geometric Sun-Moon-Earth
// configuration is the same in inertial space, but Earth has rotated by
//     dtheta = omega_e * sigma_DT  (radians)
// relative to where we placed it. So the ground track is shifted east-west by
//     dlon = dtheta  (radians)
// at every point. For the visualization we render two parallel paths offset by
// +/- 1 sigma in longitude and shade between them.

import { sigmaDeltaT } from "./delta-t.js";

const OMEGA_E = 7.2921159e-5; // rad/s

export function pathUncertaintyDeg(year) {
  const sigma = sigmaDeltaT(year); // seconds
  const radians = OMEGA_E * sigma;
  return (radians * 180) / Math.PI;
}

// Build the uncertainty band as an array of small quadrilaterals — one per
// path step — instead of a single big polygon. The single-polygon approach
// fails when the path crosses the antimeridian: splitting the ring at ±180°
// leaves open curves that Leaflet closes with straight chords running from
// the start of the path to the end, painting a spurious stripe.
//
// Each quad spans one (sample i, sample i+1) interval, shifted east-west by
// ±dlon (the ΔT-uncertainty extent) and inflated perpendicular to the path
// by the footprint half-width — so the band always visually encompasses
// the totality / annularity strip, even when ΔT uncertainty is tiny.
//
// Quads where the path itself wraps the antimeridian, or where the
// outermost vertex would push past ±180°, are skipped — producing a small
// gap in the band at the wrap location, mirroring the path's own break.
export function uncertaintyQuads(samples, year, sigmas = 1) {
  const dlon = pathUncertaintyDeg(year) * sigmas;
  const quads = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    if (a.lat == null || b.lat == null) continue;
    if (Math.abs(a.lon - b.lon) > 180) continue;
    const offA = perpOffset(samples, i);
    const offB = perpOffset(samples, i + 1);
    const lonExtA = dlon + Math.abs(offA.dLon);
    const lonExtB = dlon + Math.abs(offB.dLon);
    if (a.lon + lonExtA > 180 || a.lon - lonExtA < -180) continue;
    if (b.lon + lonExtB > 180 || b.lon - lonExtB < -180) continue;
    if (dlon === 0 && offA.dLat === 0 && offA.dLon === 0
                   && offB.dLat === 0 && offB.dLon === 0) continue;
    quads.push([
      [a.lat + offA.dLat, a.lon + offA.dLon - dlon],
      [b.lat + offB.dLat, b.lon + offB.dLon - dlon],
      [b.lat - offB.dLat, b.lon - offB.dLon + dlon],
      [a.lat - offA.dLat, a.lon - offA.dLon + dlon],
    ]);
  }
  return quads;
}

// Half-width perpendicular offset (in lat/lon degrees) at sample i, using
// a centred difference of the path direction. Returns {0,0} if a direction
// can't be estimated or this sample has no footprint width.
function perpOffset(samples, i) {
  const p = samples[i];
  if (p == null || p.lat == null) return { dLat: 0, dLon: 0 };
  const aIdx = Math.max(0, i - 1);
  const bIdx = Math.min(samples.length - 1, i + 1);
  const a = samples[aIdx].lat != null ? samples[aIdx] : p;
  const b = samples[bIdx].lat != null ? samples[bIdx] : p;
  if (a === b) return { dLat: 0, dLon: 0 };
  const cosLat = Math.cos(p.lat * Math.PI / 180);
  const dx = (b.lon - a.lon) * cosLat;
  const dy = b.lat - a.lat;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { dLat: 0, dLon: 0 };
  const halfDeg = (p.widthKm || 0) / 111.32;
  return {
    dLat:  (dx / len) * halfDeg,
    dLon: -(dy / len) * halfDeg / Math.max(0.05, cosLat),
  };
}

export function normalizeLon(lon) {
  let x = lon;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}
