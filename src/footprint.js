// Penumbral footprint: the region on Earth's surface where any partial solar
// eclipse is visible at a given instant.
//
// We sample obscuration on a regular lat/lon grid and then use marching
// squares to extract a smooth boundary polygon at one or more obscuration
// thresholds. Drawing those polygons gives a continuous-looking footprint
// instead of a staircase of square cells.

import * as A from "astronomy-engine";

const AU_KM = 149_597_870.7;
const R_SUN = 695_700.0;
const R_MOON = 1_737.4;

const LAT_STEP = 3;
const LON_STEP = 3;

// Stacked contours: each polygon set draws at a low opacity, so where higher
// obscuration overlaps lower obscuration the colour deepens — produces a
// soft heat-map look without any per-pixel tricks.
export const FOOTPRINT_CONTOURS = [
  { threshold: 0.001, fillOpacity: 0.10 },  // outer boundary of any coverage
  { threshold: 0.25,  fillOpacity: 0.10 },
  { threshold: 0.50,  fillOpacity: 0.12 },
  { threshold: 0.75,  fillOpacity: 0.14 },
  { threshold: 0.95,  fillOpacity: 0.18 },
];

// Returns a list of layers, one per contour threshold:
//   [{ threshold, fillOpacity, polygons: [[{lat,lon}, ...], ...] }, ...]
// Each polygons entry is a closed ring of vertices.
export function computeFootprintLayers(time) {
  const grid = computeFootprintGrid(time);
  return FOOTPRINT_CONTOURS.map(({ threshold, fillOpacity }) => ({
    threshold,
    fillOpacity,
    polygons: segmentsToPolygons(extractContour(grid, threshold)),
  }));
}

// Sample obscuration on a (lat, lon) grid covering the whole Earth.
// grid[i][j] is obscuration at (lats[i], lons[j]); 0 outside the penumbra
// or where the Sun is below the horizon.
function computeFootprintGrid(time) {
  const t = A.MakeTime(time);
  const sun = A.GeoVector(A.Body.Sun, t, true);
  const moon = A.GeoMoon(t);

  const lats = []; for (let v = -90; v <= 90; v += LAT_STEP) lats.push(v);
  const lons = []; for (let v = -180; v <= 180; v += LON_STEP) lons.push(v);

  const grid = [];
  for (let i = 0; i < lats.length; i++) {
    grid[i] = new Array(lons.length);
    for (let j = 0; j < lons.length; j++) {
      grid[i][j] = obscurationAt(t, sun, moon, lats[i], lons[j]);
    }
  }
  return { lats, lons, grid };
}

function obscurationAt(t, sun, moon, lat, lon) {
  const obs = new A.Observer(lat, lon, 0);
  const ov = A.ObserverVector(t, obs, false);
  const sunTopo  = sub(sun,  ov);
  const moonTopo = sub(moon, ov);
  if (dot(ov, sunTopo) <= 0) return 0;             // Sun below horizon

  const sunR  = Math.asin(R_SUN  / (mag(sunTopo)  * AU_KM));
  const moonR = Math.asin(R_MOON / (mag(moonTopo) * AU_KM));
  const cosSep = dot(sunTopo, moonTopo) / (mag(sunTopo) * mag(moonTopo));
  const sep = Math.acos(Math.min(1, Math.max(-1, cosSep)));
  if (sep >= sunR + moonR) return 0;
  return discOverlap(sep, sunR, moonR);
}

// Marching squares: for each 2×2 patch of grid cells, emit 0–2 line segments
// approximating the contour { obscuration == threshold }. Linear
// interpolation along grid edges turns the square-stepped grid into a
// smooth polyline.
function extractContour({ lats, lons, grid }, threshold) {
  const segs = [];
  for (let i = 0; i < lats.length - 1; i++) {
    for (let j = 0; j < lons.length - 1; j++) {
      const v00 = grid[i][j],     v01 = grid[i][j+1];
      const v10 = grid[i+1][j],   v11 = grid[i+1][j+1];
      const c =
        (v10 > threshold ? 8 : 0) + (v11 > threshold ? 4 : 0) +
        (v01 > threshold ? 2 : 0) + (v00 > threshold ? 1 : 0);
      if (c === 0 || c === 15) continue;

      const lat0 = lats[i], lat1 = lats[i+1];
      const lon0 = lons[j], lon1 = lons[j+1];

      const cS = (v00 > threshold) !== (v01 > threshold)
        ? { lat: lat0, lon: lerp(lon0, lon1, frac(v00, v01, threshold)) } : null;
      const cE = (v01 > threshold) !== (v11 > threshold)
        ? { lat: lerp(lat0, lat1, frac(v01, v11, threshold)), lon: lon1 } : null;
      const cN = (v10 > threshold) !== (v11 > threshold)
        ? { lat: lat1, lon: lerp(lon0, lon1, frac(v10, v11, threshold)) } : null;
      const cW = (v00 > threshold) !== (v10 > threshold)
        ? { lat: lerp(lat0, lat1, frac(v00, v10, threshold)), lon: lon0 } : null;

      switch (c) {
        case 1:  segs.push([cW, cS]); break;
        case 2:  segs.push([cS, cE]); break;
        case 3:  segs.push([cW, cE]); break;
        case 4:  segs.push([cE, cN]); break;
        case 5: {
          const avg = (v00 + v01 + v10 + v11) / 4;
          if (avg > threshold) { segs.push([cW, cN]); segs.push([cS, cE]); }
          else                 { segs.push([cW, cS]); segs.push([cN, cE]); }
          break;
        }
        case 6:  segs.push([cS, cN]); break;
        case 7:  segs.push([cW, cN]); break;
        case 8:  segs.push([cW, cN]); break;
        case 9:  segs.push([cS, cN]); break;
        case 10: {
          const avg = (v00 + v01 + v10 + v11) / 4;
          if (avg > threshold) { segs.push([cW, cS]); segs.push([cE, cN]); }
          else                 { segs.push([cW, cN]); segs.push([cS, cE]); }
          break;
        }
        case 11: segs.push([cE, cN]); break;
        case 12: segs.push([cW, cE]); break;
        case 13: segs.push([cS, cE]); break;
        case 14: segs.push([cW, cS]); break;
      }
    }
  }
  return segs;
}

// Stitch the loose contour line segments into closed polygons. Endpoints are
// matched with a small key tolerance to absorb floating-point round-off, and
// with longitude normalised modulo 360° so segments at lon = +180 and
// lon = −180 are recognised as the same physical point. Each polygon's
// vertices are kept in *continuous* lon space (a vertex past the antimeridian
// is represented as lon ± 360 rather than wrapped) so that the renderer can
// later draw the polygon at multiple world-copy offsets without it leaping
// across the map.
function segmentsToPolygons(segments) {
  if (!segments.length) return [];
  const TOL = 1e-3;
  const normLon = (lon) => {
    let l = lon;
    while (l >= 180) l -= 360;
    while (l < -180) l += 360;
    return l;
  };
  const key = p => `${Math.round(p.lat / TOL)}_${Math.round(normLon(p.lon) / TOL)}`;

  const map = new Map();
  for (let i = 0; i < segments.length; i++) {
    for (const p of segments[i]) {
      const k = key(p);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(i);
    }
  }
  const used = new Set();
  const polygons = [];
  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    const poly = [segments[i][0]];
    poly.push(adjacentLon(segments[i][1], segments[i][0].lon));
    used.add(i);
    let endK = key(poly[poly.length - 1]);
    let safety = 0;
    while (safety++ < segments.length * 2) {
      const candidates = map.get(endK) || [];
      let next = -1;
      for (const c of candidates) if (!used.has(c)) { next = c; break; }
      if (next < 0) break;
      const [a, b] = segments[next];
      const raw = key(a) === endK ? b : a;
      poly.push(adjacentLon(raw, poly[poly.length - 1].lon));
      used.add(next);
      endK = key(poly[poly.length - 1]);
      if (endK === key(poly[0])) break;
    }
    if (poly.length > 2) polygons.push(poly);
  }
  return polygons;
}

// Return a copy of `pt` with lon shifted by ±360° so that it is within ±180°
// of `prevLon`. Keeps the polygon's lon trajectory continuous when segments
// straddle the antimeridian.
function adjacentLon(pt, prevLon) {
  let lon = pt.lon;
  while (lon - prevLon >  180) lon -= 360;
  while (lon - prevLon < -180) lon += 360;
  return { lat: pt.lat, lon };
}

function discOverlap(d, R, r) {
  if (d >= R + r) return 0;
  if (d <= Math.abs(R - r)) return Math.min(1, (r * r) / (R * R));
  const R2 = R * R, r2 = r * r, d2 = d * d;
  const a = R2 * Math.acos((d2 + R2 - r2) / (2 * d * R));
  const b = r2 * Math.acos((d2 + r2 - R2) / (2 * d * r));
  const c = 0.5 * Math.sqrt((-d + R + r) * (d + R - r) * (d - R + r) * (d + R + r));
  return (a + b - c) / (Math.PI * R2);
}

function lerp(a, b, t) { return a + (b - a) * t; }
function frac(v0, v1, t) {
  if (v0 === v1) return 0.5;
  return (t - v0) / (v1 - v0);
}
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function mag(a) { return Math.sqrt(dot(a, a)); }
