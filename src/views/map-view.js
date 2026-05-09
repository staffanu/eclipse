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

  showEclipse(eclipse, samples, year) {
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

    // Greatest-eclipse marker. Note: totality occurs along the entire red
    // line as the umbra sweeps across Earth over a few hours; this dot marks
    // the *instant* of greatest eclipse (largest umbral diameter / longest
    // local totality), which is one specific point on that line.
    if (eclipse.latitude != null && eclipse.longitude != null) {
      L.circleMarker([eclipse.latitude, eclipse.longitude], {
        radius: 6, color: "#fff", weight: 2, fillColor: "#ff5c5c", fillOpacity: 1,
      })
        .bindTooltip(
          `Greatest eclipse (${eclipse.kind}) — instant of maximum umbra. ` +
          `Totality occurs along the whole red line as the shadow sweeps Earth.`,
        )
        .addTo(this.layer);
      this.map.flyTo([eclipse.latitude, eclipse.longitude], 3, { duration: 0.6 });
    }
  }

  // Move (or remove) the shadow-center marker driven by the time slider.
  // Pass lat/lon = null to hide it (e.g. when the axis misses Earth at the
  // chosen instant).
  setShadowCenter(lat, lon, kind) {
    if (lat == null || lon == null) {
      if (this.shadowMarker) { this.shadowMarker.remove(); this.shadowMarker = null; }
      return;
    }
    const fill = kind === "annular" ? "#ffd75c" : "#ff5c5c";
    if (!this.shadowMarker) {
      this.shadowMarker = L.circleMarker([lat, lon], {
        radius: 8, color: "#fff", weight: 2, fillColor: fill, fillOpacity: 0.9,
      }).addTo(this.map);
    } else {
      this.shadowMarker.setLatLng([lat, lon]);
      this.shadowMarker.setStyle({ fillColor: fill });
    }
  }
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
