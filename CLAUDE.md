# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Eclipse Explorer — a static, single-page web app for visualizing solar eclipses on a world map, in 3D, and as a local-observer Sun disk. No build step, no package manager, no tests.

## Running

Open `index.html` in a browser. Because it uses ES module `<script type="importmap">` and `type="module"`, opening the file via `file://` works in modern Chromium/Firefox but a local server is safer:

```
python3 -m http.server 8000   # then visit http://localhost:8000/
```

Dependencies (`astronomy-engine`, `three`, `leaflet`) are pulled at runtime from `esm.run` / `unpkg` via the import map in `index.html`. There is no `node_modules` or lockfile — bump versions by editing the import map.

## Deployment

`.github/workflows/pages.yml` publishes the repo root to GitHub Pages on push to `main` (and a long-lived feature branch). The repo root *is* the site root — `index.html` must stay at the top level.

## Architecture

Entry point `src/main.js` wires three independent views to a shared `state` object and an eclipse search/computation pipeline:

- **Eclipse search** (`eclipse-search.js`) — wraps `astronomy-engine` to find the nearest / next / previous global solar eclipse from a given date.
- **Delta T model** (`delta-t.js`) — replaces astronomy-engine's built-in ΔT via `A.SetDeltaTFunction` so timings far from today use the Morrison & Stephenson (2004) long-term parabola. `installOverride()` must run before any eclipse computation. The override callback receives `ut` (days since J2000 UT noon) and must **not** call back into `MakeTime` / `AstroTime` — that would recurse through the ΔT function it is replacing. Use the arithmetic `yearToUt` / `utToYear` helpers instead.
- **Shadow path** (`path.js`) — samples the umbral/antumbral centerline around peak; `shadowSampleAtTime(t)` gives the shadow center for the time-scrubber.
- **Footprint** (`footprint.js`) — contours where the penumbra touches Earth at peak, used both for the yellow overlay and (for partial eclipses with no centerline) for centering the map.
- **Uncertainty** (`uncertainty.js`) — converts ΔT 1σ into a longitudinal ground-shift band drawn around the centerline.

Three views in `src/views/`, each owning its own DOM root and exposing `showEclipse(...)` plus incremental update methods called by the time slider:

- `map-view.js` — Leaflet map: centerline, ΔT uncertainty band, footprint contours, observer marker, shadow-center marker with UT tooltip.
- `scene-view.js` — three.js Sun/Moon/Earth at real scale (only the Sun's distance is compressed; see commits). The 3D panel header has a "Shadow on surface" checkbox: when on, the umbra/antumbra/penumbra cone meshes are hidden and the Earth's fragment shader paints the shadow directly on the globe via a geometric ray-cone test (red spot for total, yellow for annular, grey penumbra ring).
- `local-view.js` — Sun disk with Moon transit as seen from `state.observer`.

Coordinate convention: longitudes coming from Leaflet click events may be outside [-180, 180] (worldCopyJump-wrapped copies). `setObserver` keeps the raw value for the marker position but stores `normalizeLon(rawLon)` in state and inputs.

The time slider (`#time-slider`) holds an offset in **minutes** from peak; `currentScrubTime()` is the single source of truth — pass its result into each view's update method rather than reading the slider directly.

Errors in event handlers are funneled through `safe(fn)` in `main.js` so they surface in the info panel instead of vanishing into the console.
