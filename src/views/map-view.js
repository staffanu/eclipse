import L from "leaflet";
import { uncertaintyQuads, normalizeLon } from "../uncertainty.js";

export class MapView {
  constructor(container, { onClick }) {
    this.map = L.map(container, {
      worldCopyJump: true,
      preferCanvas: true,
      minZoom: 1,
    }).setView([20, 0], 2);

    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { attribution: "© OpenStreetMap", maxZoom: 7 },
    ).addTo(this.map);

    // Footprint layer is added before the main layer so the centerline,
    // uncertainty band and markers always render on top of it.
    this.footprintLayer = L.layerGroup().addTo(this.map);
    this.layer = L.layerGroup().addTo(this.map);
    this.observerMarker = null;
    // Shadow-center marker is owned separately so it can be updated by the
    // time slider without rebuilding the whole eclipse layer.
    this.shadowMarker = null;

    if (onClick) {
      // Pass through the raw click latlng — the marker should land where the
      // user actually clicked, even if they're viewing a wrapped world copy
      // (lng outside [-180, 180]). Normalisation, if any, happens upstream.
      this.map.on("click", (e) => onClick(e.latlng.lat, e.latlng.lng));
    }
  }

  setObserver(lat, lon) {
    if (!this.observerMarker) {
      this.observerMarker = L.circleMarker([lat, lon], {
        radius: 5,
        color: "#58a6ff",
        weight: 2,
        fillOpacity: 0.6,
      }).addTo(this.map);
    } else {
      this.observerMarker.setLatLng([lat, lon]);
    }
  }

  showEclipse(eclipse, samples, year, peakIndex) {
    this.layer.clearLayers();
    // Drop the shadow-center marker too — it'll be re-placed by the next
    // setShadowCenter call.
    if (this.shadowMarker) { this.shadowMarker.remove(); this.shadowMarker = null; }

    // Use the same accent colour as the centerline for the band and the
    // peak tick: red for total eclipses, yellow for annular ones.
    const accent = eclipse.kind === "annular" ? "#ffd75c" : "#ff5c5c";

    // Uncertainty band: one small quadrilateral per path step. Adjacent
    // quads share edges, so they paint as one continuous shaded band.
    // Drawn at low opacity so the (more solid) footprint polygon below
    // reads clearly on top of it.
    const drawBand = (quads, opacity) => {
      for (const q of quads) {
        L.polygon(q, {
          color: accent, weight: 0,
          fillColor: accent, fillOpacity: opacity,
        }).addTo(this.layer);
      }
    };
    drawBand(uncertaintyQuads(samples, year, 3), 0.05);
    drawBand(uncertaintyQuads(samples, year, 1), 0.11);

    // Footprint of totality (or annularity): a filled polygon whose width
    // perpendicular to the path equals the umbra (or antumbra) cone radius
    // at the surface. This shows the actual strip of Earth that experiences
    // total / annular eclipse, not just the centerline.
    const segments = breakSegments(samples);
    for (const seg of segments) {
      const color = seg[0].kind === "annular" ? "#ffd75c" : "#ff5c5c";
      const ring = footprintRing(seg);
      if (ring.length >= 3) {
        L.polygon(ring, {
          color, weight: 1, opacity: 0.9,
          fillColor: color, fillOpacity: 0.55,
        }).addTo(this.layer);
      }
    }

    // Greatest-eclipse marker. Totality occurs along the entire centerline
    // as the umbra sweeps across Earth over a few hours; this is just the
    // *instant* of greatest eclipse (largest umbral diameter). Drawn as a
    // small tick perpendicular to the local path direction in the same
    // colour as the centerline so it reads as part of the path.
    if (Number.isFinite(eclipse.latitude) && Number.isFinite(eclipse.longitude)
        && peakIndex != null && samples.length > 1) {
      const tick = perpendicularTick(samples, peakIndex, eclipse.latitude, eclipse.longitude);
      if (tick) {
        L.polyline(tick, { color: accent, weight: 2, opacity: 0.95 })
          .bindTooltip(
            `Greatest eclipse (${eclipse.kind}) — instant of maximum umbra. ` +
            `Totality occurs along the whole centerline as the shadow sweeps Earth.`,
          )
          .addTo(this.layer);
      }
      this.map.setView([eclipse.latitude, eclipse.longitude], 3, { animate: true, duration: 0.6 });
    }
  }

  // Draw (or clear) the penumbral footprint as a stack of contour polygons,
  // each filled at low opacity so they additively colour the most-obscured
  // areas more strongly. Owned on a separate layer so toggling visibility
  // doesn't touch the centerline / band.
  //
  // Each polygon is rendered three times (offset −360°, 0°, +360°) so that
  // a footprint whose vertex sequence crosses the antimeridian (vertices in
  // continuous lon space, e.g. 170 → 200) shows up correctly regardless of
  // which world copy the user is currently viewing.
  showFootprint(layers, visible) {
    this.footprintLayer.clearLayers();
    if (!visible || !layers || !layers.length) return;
    for (const layer of layers) {
      for (const poly of layer.polygons) {
        const base = poly.map(p => [p.lat, p.lon]);
        for (const offset of [-360, 0, 360]) {
          L.polygon(base.map(([lat, lon]) => [lat, lon + offset]), {
            color: "#ffd75c", weight: 0,
            fillColor: "#ffd75c", fillOpacity: layer.fillOpacity,
          }).addTo(this.footprintLayer);
        }
      }
    }
  }

  // Pan the map to the centroid of the outermost contour polygons. Used for
  // partial eclipses where there's no greatest-eclipse coord to fly to.
  flyToFootprint(layers) {
    if (!layers || !layers.length) return;
    const outer = layers[0].polygons;            // lowest threshold = largest region
    if (!outer.length) return;
    let sumLat = 0, sumLon = 0, n = 0;
    for (const p of outer) for (const v of p) { sumLat += v.lat; sumLon += v.lon; n++; }
    if (!n) return;
    this.map.setView([sumLat / n, sumLon / n], 3, { animate: true, duration: 0.6 });
  }

  // Move (or remove) the shadow-center marker driven by the time slider.
  // Pass lat/lon = null to hide it (e.g. when the axis misses Earth at the
  // chosen instant). The label is pinned next to the marker so the map
  // doubles as a readout of "where is the umbra at the current scrub time".
  setShadowCenter(lat, lon, kind, label) {
    if (lat == null || lon == null) {
      if (this.shadowMarker) { this.shadowMarker.remove(); this.shadowMarker = null; }
      return;
    }
    const fill = kind === "annular" ? "#ffd75c" : "#ff5c5c";
    if (!this.shadowMarker) {
      this.shadowMarker = L.circleMarker([lat, lon], {
        radius: 8, color: "#fff", weight: 2, fillColor: fill, fillOpacity: 0.9,
      }).addTo(this.map);
      this.shadowMarker.bindTooltip(label || "", {
        permanent: true, direction: "top", offset: [0, -8], className: "shadow-time-tip",
      });
    } else {
      this.shadowMarker.setLatLng([lat, lon]);
      this.shadowMarker.setStyle({ fillColor: fill });
      if (label != null) this.shadowMarker.setTooltipContent(label);
    }
  }
}

// Construct a short tick perpendicular to the centerline at (lat0, lon0),
// using the path direction estimated from the samples either side of
// peakIndex. The tick half-length is ~0.6° measured in the local "flat"
// metric (lat degrees and lon·cosLat degrees), which keeps it visually
// perpendicular on the Mercator projection at any latitude.
function perpendicularTick(samples, peakIndex, lat0, lon0) {
  const before = nearbyValid(samples, peakIndex, -1) ?? samples[peakIndex];
  const after  = nearbyValid(samples, peakIndex, +1) ?? samples[peakIndex];
  if (!before || !after || before === after) return null;

  const cosLat = Math.cos(lat0 * Math.PI / 180);
  const dx = (after.lon - before.lon) * cosLat;
  const dy = (after.lat - before.lat);
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;          // rotate 90°
  const half = 0.3;                 // tick half-length, "flat" degrees
  const dlat = py * half;
  const dlon = (px * half) / Math.max(0.05, cosLat);
  return [
    [lat0 - dlat, lon0 - dlon],
    [lat0 + dlat, lon0 + dlon],
  ];
}

// Walk away from index i in steps of dir until a sample with a valid lat is
// found. Returns null if none is found within a few steps.
function nearbyValid(samples, i, dir) {
  for (let k = 1; k <= 5; k++) {
    const j = i + dir * k;
    if (j < 0 || j >= samples.length) return null;
    if (samples[j].lat != null) return samples[j];
  }
  return null;
}

// Break the sample list into contiguous polylines wherever the path is missing
// or jumps across the antimeridian.
function breakSegments(samples) {
  const segs = [];
  let cur = [];
  let prev = null;
  for (const s of samples) {
    if (s.lat == null) {
      if (cur.length > 1) segs.push(cur);
      cur = [];
      prev = null;
      continue;
    }
    if (prev && Math.abs(s.lon - prev.lon) > 180) {
      if (cur.length > 1) segs.push(cur);
      cur = [];
    }
    cur.push(s);
    prev = s;
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}

// Build a closed ring around the path: walk forward along the left side
// (perpendicular offset by widthKm) and back along the right. The path
// direction is estimated by centred finite difference on the lat/lon grid
// in a flat metric (lon scaled by cos(lat)), so the perpendicular offset
// stays visually perpendicular on the Mercator projection at any latitude.
function footprintRing(seg) {
  const left = [], right = [];
  for (let i = 0; i < seg.length; i++) {
    const a = seg[Math.max(0, i - 1)];
    const b = seg[Math.min(seg.length - 1, i + 1)];
    const p = seg[i];
    const cosLat = Math.cos(p.lat * Math.PI / 180);
    const dx = (b.lon - a.lon) * cosLat;
    const dy = b.lat - a.lat;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len;
    const halfDeg = (p.widthKm || 0) / 111.32;
    const offLat =  ux * halfDeg;
    const offLon = -uy * halfDeg / Math.max(0.05, cosLat);
    left.push([p.lat + offLat, p.lon + offLon]);
    right.push([p.lat - offLat, p.lon - offLon]);
  }
  return [...left, ...right.reverse()];
}

// If the band crosses the antimeridian, Leaflet would draw a wrap-around line.
// Split it into multiple sub-polygons aligned to one side or the other.
function splitOnAntimeridian(ring) {
  const out = [];
  let cur = [];
  let prev = null;
  for (const [lat, lon] of ring) {
    if (prev && Math.abs(lon - prev[1]) > 180) {
      if (cur.length > 2) out.push(cur);
      cur = [];
    }
    cur.push([lat, lon]);
    prev = [lat, lon];
  }
  if (cur.length > 2) out.push(cur);
  return out;
}
