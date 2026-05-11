# Eclipse Explorer

**Live site:** <https://staffanu.github.io/eclipse/>

A static, single-page web app for exploring solar eclipses across time. Pick a
year, step backward or forward through eclipses, and see each one from three
synchronised perspectives:

- **World map** — the umbral / antumbral centerline with its ΔT uncertainty band,
  the penumbral footprint contoured by obscuration, and a time-driven marker
  showing where the shadow is at any chosen instant.
- **3D scene** — Sun, Moon, and Earth at real linear scale, with the actual
  umbra / antumbra / penumbra cones drawn in space. A "shadow on surface"
  toggle hides the cones and paints the shadow directly on the globe instead
  (red spot for total eclipses, yellow for annular, grey penumbra ring).
- **Local view** — what an observer at a chosen lat/lon sees: the Sun's disc
  with the Moon transiting across it, an altitude strip showing where the Sun
  and Moon sit relative to the horizon, and a sky colour that follows the
  Sun's altitude through day, golden hour, civil/nautical/astronomical
  twilight, and night.

A time slider scrubs all three views together. The supported range runs from
roughly &minus;3000 to +7000, with uncertainty growing rapidly outside
&plusmn;500 years of today.

## Running

There's no build step and no package manager — open `index.html` directly, or
serve the repo root with any static server:

```
python3 -m http.server 8000
```

Dependencies (`astronomy-engine`, `three`, `leaflet`) are loaded at runtime
from `esm.run` / `unpkg` via the import map in `index.html`.

## What math is involved

Geocentric Sun and Moon positions, the eclipse search itself, frame rotations
between J2000 and the true equator of date, sidereal time, topocentric
conversions, and the modern-era ΔT polynomial all come from the excellent
[**astronomy-engine**](https://github.com/cosinekitty/astronomy) library by
Don Cross. Without it this project would be an order of magnitude larger.

Everything *around* those positions is computed here:

- **Long-term ΔT** — outside astronomy-engine's Espenak–Meeus range we
  extrapolate with the Morrison & Stephenson (2004) parabola
  `ΔT = −20 + 32·u²`, `u = (year − 1820)/100`.
- **ΔT uncertainty** — 1σ from Stephenson, Morrison & Hohenkerk (2016),
  converted to a longitudinal ground shift via Earth's rotation rate
  (`Δlon = ω_E · σ_ΔT`). This is what the shaded band around the centerline
  represents — the eclipse path's east-west uncertainty, not its width.
- **Shadow centerline** — ray–ellipsoid intersection on the WGS84 ellipsoid
  (not a sphere), with the umbral apex distance `L = D · R_moon / (R_sun −
  R_moon)` used to classify total (`s < L`) vs annular (`s > L`).
- **Footprint width** — the cone's circular cross-section is foreshortened
  into an ellipse on the inclined ground (semi-axes `r` and `r/sin(h)`), and
  the visible path width is the ellipse's support perpendicular to the local
  motion direction.
- **Penumbral footprint** — sampled obscuration on a 1.5° lat/lon grid using
  the standard two-circle lens-area formula for disc overlap, then turned
  into smooth contour polygons via marching squares with antimeridian-aware
  polygon stitching.
- **3D shadow on surface** — per-fragment geometric ray-cone test in the
  Earth material's fragment shader, with a uniform-plateau penumbra dimming
  and a colour-tinted umbra so it stays visible against the ocean.
- **Local view** — angular Sun and Moon radii from topocentric distances,
  in-disc obscuration via the same lens-area formula, and key-frame RGB
  interpolation for the sky colour as a function of solar altitude.

Rendering uses [three.js](https://threejs.org) for the 3D scene and
[Leaflet](https://leafletjs.com) for the map.

## License

GPLv3 — see [LICENSE](./LICENSE) for the full text.

The runtime dependencies are all under GPL-compatible permissive licenses, so
the combined work can be distributed under the GPL:

- **astronomy-engine** — MIT
- **three.js** — MIT
- **Leaflet** — BSD 2-Clause

Map tiles are served by OpenStreetMap and used under the
[ODbL](https://www.openstreetmap.org/copyright); attribution is rendered in
the map's bottom-right corner.
