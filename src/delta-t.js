// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Staffan Ulfberg

// Long-term Delta T model and its 1-sigma uncertainty.
//
// Delta T = TT - UT1 (seconds). For dates within ~1955-present we know it from
// observation; outside that, Earth's rotation is unpredictable enough that the
// dominant source of eclipse-timing error far from today is Delta T itself.
//
// Model: Morrison & Stephenson (2004) parabola, anchored at year 1820:
//     DT(y) = -20 + 32 * u^2,    u = (y - 1820) / 100
// Used by Espenak & Meeus for the NASA eclipse canon outside 1955-2005.
//
// Uncertainty (1-sigma) for the parabola, from Stephenson, Morrison & Hohenkerk
// (2016), "Measurement of the Earth's rotation: 720 BC to AD 2015":
//     sigma_DT(y) ~ 0.8 * u^2 seconds, where u as above.
// Within the modern observed era (1955..present) sigma is effectively zero.
//
// We expose deltaT(year) and sigmaDeltaT(year), and also installOverride() to
// replace astronomy-engine's built-in Delta T so eclipse times far from today
// reflect this long-term model.

import * as A from "astronomy-engine";

// Espenak-Meeus piecewise polynomials cover roughly -1999..+3000 and match
// observation well within 1955..present. Outside that we fall back to the
// long-term parabola.
const EM_MIN_YEAR = -1999;
const EM_MAX_YEAR = 3000;
const OBSERVED_START = 1955;
const OBSERVED_END = 2025;

export function deltaT(year) {
  if (year >= EM_MIN_YEAR && year <= EM_MAX_YEAR) {
    return A.DeltaT_EspenakMeeus(yearToUt(year));
  }
  const u = (year - 1820) / 100;
  return -20 + 32 * u * u;
}

// 1-sigma uncertainty of Delta T at the given year, in seconds.
//   - Modern observed era: effectively zero.
//   - Pre-telescopic / future: grows as 0.8 u^2 (Stephenson, Morrison & Hohenkerk 2016).
//   - Telescopic/historical era inside EM range: a few-second floor.
export function sigmaDeltaT(year) {
  if (year >= OBSERVED_START && year <= OBSERVED_END) return 0;
  const u = (year - 1820) / 100;
  return Math.max(2, 0.8 * u * u);
}

// Earth rotates ~0.46 km of surface (at the equator) per second of UT.
// More precisely, sidereal rotation rate * equatorial radius:
//   omega_e = 7.2921159e-5 rad/s,  R_e = 6378.137 km
//   v_eq    = omega_e * R_e ~ 0.4651 km/s
// At latitude phi the east-west shift is v_eq * cos(phi) per second.
export const EQUATORIAL_ROTATION_KM_PER_S = 7.2921159e-5 * 6378.137;

// Convert calendar year (e.g. 2030.5) to UT days since J2000.
// We do this arithmetically (not via MakeTime) to avoid re-entering the
// AstroTime constructor, which calls our Delta T override.
function yearToUt(year) {
  const yi = Math.floor(year);
  const frac = year - yi;
  const ms = Date.UTC(2000, 0, 1, 12, 0, 0); // J2000 UT noon as ms-epoch
  const d = new Date(ms);
  d.setUTCFullYear(yi);
  const dayMs = d.getTime() + frac * 365.25 * 86400_000;
  return (dayMs - ms) / 86400_000;
}

// Inverse: ut (days since J2000 UT noon) -> calendar year (real number).
function utToYear(ut) {
  const ms = ut * 86400_000 + Date.UTC(2000, 0, 1, 12, 0, 0);
  const d = new Date(ms);
  return d.getUTCFullYear() + d.getUTCMonth() / 12;
}

let _installed = false;
export function installOverride() {
  if (_installed) return;
  // The callback gets ut (days since J2000 UT noon) and must NOT recurse
  // through MakeTime / AstroTime — those construct an AstroTime, which calls
  // back into this very function.
  A.SetDeltaTFunction((ut) => {
    const year = utToYear(ut);
    if (year >= EM_MIN_YEAR && year <= EM_MAX_YEAR) {
      return A.DeltaT_EspenakMeeus(ut);
    }
    const u = (year - 1820) / 100;
    return -20 + 32 * u * u;
  });
  _installed = true;
}
