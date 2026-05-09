import L from "leaflet";
import { uncertaintyBand, normalizeLon } from "../uncertainty.js";

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

    // Uncertainty band.
    const band1 = uncertaintyBand(samples, year, 1);
    const band3 = uncertaintyBand(samples, year, 3);
    if (band3.length) {
      L.polygon(splitOnAntimeridian(band3), {
        color: "#ff5c5c",
        weight: 0,
        fillColor: "#ff5c5c",
        fillOpacity: 0.08,
      }).addTo(this.layer);
    }
    if (band1.length) {
      L.polygon(splitOnAntimeridian(band1), {
        color: "#ff5c5c",
        weight: 0,
        fillColor: "#ff5c5c",
        fillOpacity: 0.18,
      }).addTo(this.layer);
    }

    // Centerline, broken when axis misses Earth or wraps the antimeridian.
    const segments = breakSegments(samples);
    for (const seg of segments) {
      const color = seg[0].kind === "annular" ? "#ffd75c" : "#ff5c5c";
      L.polyline(seg.map((s) => [s.lat, s.lon]), {
        color, weight: 3, opacity: 0.9,
      }).addTo(this.layer);
    }

    // Greatest-eclipse marker. Totality occurs along the entire red line as
    // the umbra sweeps across Earth over a few hours; this is just the
    // *instant* of greatest eclipse (largest umbral diameter). Drawn as a
    // small white tick perpendicular to the local path direction so it
    // doesn't dominate the centerline.
    if (eclipse.latitude != null && eclipse.longitude != null
        && peakIndex != null && samples.length > 1) {
      const tick = perpendicularTick(samples, peakIndex, eclipse.latitude, eclipse.longitude);
      if (tick) {
        L.polyline(tick, { color: "#fff", weight: 2, opacity: 0.9 })
          .bindTooltip(
            `Greatest eclipse (${eclipse.kind}) — instant of maximum umbra. ` +
            `Totality occurs along the whole red line as the shadow sweeps Earth.`,
          )
          .addTo(this.layer);
      }
      this.map.flyTo([eclipse.latitude, eclipse.longitude], 3, { duration: 0.6 });
    }
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
  const half = 0.6;                 // tick half-length, "flat" degrees
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
