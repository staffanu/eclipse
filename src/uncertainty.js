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
// Each quad spans one (sample i, sample i+1) interval. Quads where the path
// itself wraps the antimeridian, or where the ±dlon shift would push a
// vertex over ±180°, are skipped — that produces a small gap in the band at
// the wrap location, mirroring the path's own break there.
export function uncertaintyQuads(samples, year, sigmas = 1) {
  const dlon = pathUncertaintyDeg(year) * sigmas;
  if (dlon <= 0) return [];
  const quads = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    if (a.lat == null || b.lat == null) continue;
    if (Math.abs(a.lon - b.lon) > 180) continue;             // path itself wraps here
    if (a.lon + dlon > 180 || a.lon - dlon < -180) continue; // shifted vertex would wrap
    if (b.lon + dlon > 180 || b.lon - dlon < -180) continue;
    quads.push([
      [a.lat, a.lon - dlon],
      [b.lat, b.lon - dlon],
      [b.lat, b.lon + dlon],
      [a.lat, a.lon + dlon],
    ]);
  }
  return quads;
}

export function normalizeLon(lon) {
  let x = lon;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}
