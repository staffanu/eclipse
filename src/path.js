// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Staffan Ulfberg

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
  const raw = [];
  const nSteps = Math.round((halfHours * 60) / stepMinutes);

  for (let i = -nSteps; i <= nSteps; i++) {
    const ut = peakUt + (i * stepMinutes) / (60 * 24);
    const t = A.MakeTime(utToDate(ut));
    raw.push(sampleAt(t));
  }

  // The shadow axis snaps on/off Earth between fixed time steps, so the first
  // and last valid samples sit a fraction of a step before the true
  // ingress/egress. Bisect each valid↔invalid transition to insert one extra
  // sample at the sub-step terminus, so the rendered band stops where the
  // antumbra actually leaves Earth instead of at the previous 2-min tick.
  const samples = [];
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) {
      const prev = raw[i - 1], cur = raw[i];
      const pv = prev.lat != null, cv = cur.lat != null;
      if (pv !== cv) {
        const edge = bisectEdge(pv ? prev.time.ut : cur.time.ut,
                                pv ? cur.time.ut  : prev.time.ut);
        if (edge) {
          // At ingress/egress the Sun is on the horizon, so the footprint
          // ellipse's in-plane semi-axis (r / sin h) diverges and the band
          // would balloon into a huge tail. Keep the bisected *position*
          // (that's why we bisect) but inherit the width from the adjacent
          // in-grid sample, where the geometry is well-conditioned.
          edge.widthKm = (pv ? prev : cur).widthKm;
          samples.push(edge);
        }
      }
    }
    samples.push(raw[i]);
  }

  let peakIndex = 0, bestDt = Infinity;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].lat == null) continue;
    const dt = Math.abs(samples[i].time.ut - peakUt);
    if (dt < bestDt) { bestDt = dt; peakIndex = i; }
  }
  return { samples, peakIndex };
}

// Binary-search in UT between a valid and an invalid time to find the moment
// the shadow axis is about to leave (or just arrived on) Earth, then return a
// fully-populated sample at that moment. 14 iterations narrow a 2-minute
// bracket to ~0.01 s, well below any rendering precision.
function bisectEdge(validUt, invalidUt) {
  let lo = validUt, hi = invalidUt;
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    const c = sampleCore(A.MakeTime(utToDate(mid)));
    if (c) lo = mid; else hi = mid;
  }
  return sampleAt(A.MakeTime(utToDate(lo)));
}

// Compute the shadow-center sample at an arbitrary instant — used by the
// time slider to position the moving marker without re-sampling the full
// path each tick.
export function shadowSampleAtTime(time) {
  return sampleAt(A.MakeTime(time));
}

function sampleAt(t) {
  const c = sampleCore(t);
  if (!c) return { time: t, lat: null, lon: null, kind: "none", widthKm: 0 };

  // The umbra/antumbra footprint on the ground is an ellipse — the cone's
  // circular cross-section (radius r perpendicular to the shadow axis) is
  // foreshortened by the Sun's altitude h at the intersection point. Its
  // semi-axes are r perpendicular to the incidence plane and r/sin(h) in
  // the incidence plane. The visible "path width" is measured perpendicular
  // to the shadow's motion on the ground, which generally is not aligned
  // with either ellipse axis — so we estimate the motion direction from a
  // neighbour sample and project the ellipse onto the perpendicular.
  const dtDays = 60 / 86400; // 1 minute
  const cNext = sampleCore(A.MakeTime(utToDate(t.ut + dtDays))) ||
                sampleCore(A.MakeTime(utToDate(t.ut - dtDays)));

  const widthKm = perpHalfWidth(c, cNext);
  return { time: t, lat: c.lat, lon: c.lon, kind: c.kind, widthKm };
}

function sampleCore(t) {
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
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  const s = (-bQ - sqrtDisc) / (2 * aQ);
  if (s <= 0) return null;

  const Pkm_eqd = add(M, scale(D, s));

  // Rotate the surface point back to EQJ so VectorObserver can project to
  // geographic lat/lon (it expects an EQJ vector with a time stamp).
  const eqdToEqj = A.Rotation_EQD_EQJ(t);
  const pVecEqd = new A.Vector(Pkm_eqd.x / AU_KM, Pkm_eqd.y / AU_KM, Pkm_eqd.z / AU_KM, t);
  const pVecEqj = A.RotateVector(eqdToEqj, pVecEqd);
  const obs = A.VectorObserver(pVecEqj);

  const L = SMlen * R_MOON / (R_SUN - R_MOON);
  const kind = s < L ? "total" : "annular";
  const r = R_MOON * Math.abs(1 - s / L);

  return { lat: obs.latitude, lon: obs.longitude, kind, P: Pkm_eqd, D, r, L };
}

function perpHalfWidth(c, cNext) {
  // Outward ellipsoid normal at P (gradient of the implicit function).
  const N = normalize({ x: c.P.x / (R_EQ*R_EQ), y: c.P.y / (R_EQ*R_EQ), z: c.P.z / (R_POL*R_POL) });
  // Sun altitude: Sun lies in direction -D from P; sin(altitude) = (-D)·N.
  const sinH = -dot(c.D, N);
  if (sinH <= 1e-3) return c.r; // grazing — projection blows up; fall back

  if (!cNext) return c.r / sinH; // no motion estimate — use the wider extreme

  // Tangent-plane basis: e1 perpendicular to incidence plane (D × N), e2 in
  // incidence plane on tangent plane (N × e1). Footprint ellipse semi-axes
  // are r along e1 and r/sin(h) along e2.
  const e1 = normalize(cross(c.D, N));
  const e2 = cross(N, e1);

  // Motion direction on ground: difference between consecutive sample
  // positions in EQD, projected to the tangent plane at P.
  const dP = sub(cNext.P, c.P);
  const dPperp = sub(dP, scale(N, dot(dP, N)));
  if (len(dPperp) < 1e-9) return c.r;
  const v = normalize(dPperp);

  // Decompose v in the (e1, e2) basis: v = (v·e1) e1 + (v·e2) e2. The
  // direction perpendicular to motion in the tangent plane is the 90°
  // rotation in this basis — it has e1-component (v·e2) and e2-component
  // -(v·e1). The ellipse's support in that direction is the half-width.
  const ve1 = dot(v, e1);
  const ve2 = dot(v, e2);
  const a = c.r;          // semi-axis along e1
  const b = c.r / sinH;   // semi-axis along e2
  return Math.sqrt(a*a*ve2*ve2 + b*b*ve1*ve1);
}

function normalize(v) { const k = 1 / len(v); return { x: v.x*k, y: v.y*k, z: v.z*k }; }
function cross(a, b) {
  return { x: a.y*b.z - a.z*b.y, y: a.z*b.x - a.x*b.z, z: a.x*b.y - a.y*b.x };
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

