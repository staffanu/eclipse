// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Staffan Ulfberg

// Thin wrapper around astronomy-engine's eclipse search to support stepping
// forward and backward in time, and finding the nearest eclipse to a date.

import * as A from "astronomy-engine";

export function nextEclipseFrom(date) {
  return A.SearchGlobalSolarEclipse(A.MakeTime(date));
}

export function nextEclipseAfter(prev) {
  return A.NextGlobalSolarEclipse(prev.peak);
}

// Find the eclipse whose peak time is closest to the given date. Solar
// eclipses are at most ~6 months apart, so it's enough to start one season
// before the target and walk forward until we pass it.
export function nearestEclipseTo(date) {
  const target = A.MakeTime(date);
  let e = A.SearchGlobalSolarEclipse(addDays(target, -200));
  let best = e;
  let bestDist = Math.abs(e.peak.tt - target.tt);
  for (let i = 0; i < 5; i++) {
    if (e.peak.tt - target.tt > 200) break;
    e = A.NextGlobalSolarEclipse(e.peak);
    const dist = Math.abs(e.peak.tt - target.tt);
    if (dist < bestDist) { best = e; bestDist = dist; }
  }
  return best;
}

// Step backward by repeatedly searching forward in coarse 6-month windows
// before the target date, then return the latest eclipse before it.
export function prevEclipseBefore(date) {
  const target = A.MakeTime(date);
  // Walk back ~9 months at a time until we find at least one eclipse before target.
  let probe = addDays(target, -270);
  let found = null;
  for (let i = 0; i < 12; i++) {
    let e = A.SearchGlobalSolarEclipse(probe);
    while (e.peak.tt < target.tt) {
      found = e;
      e = A.NextGlobalSolarEclipse(e.peak);
    }
    if (found) return found;
    probe = addDays(probe, -270);
  }
  return found;
}

function addDays(time, days) {
  const ms = (time.ut + 10957.5) * 86400_000 + days * 86400_000;
  return A.MakeTime(new Date(ms));
}
