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

// Build a polygon (array of [lat, lon]) that wraps the central path with
// +/-N-sigma uncertainty in longitude. If sigmas is 0 returns an empty array.
export function uncertaintyBand(samples, year, sigmas = 1) {
  const dlon = pathUncertaintyDeg(year) * sigmas;
  if (dlon <= 0) return [];
  const fwd = [];
  const back = [];
  for (const s of samples) {
    if (s.lat == null) continue;
    fwd.push([s.lat, normalizeLon(s.lon + dlon)]);
    back.push([s.lat, normalizeLon(s.lon - dlon)]);
  }
  back.reverse();
  return [...fwd, ...back];
}

export function normalizeLon(lon) {
  let x = lon;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}
