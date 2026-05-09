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

    if (onClick) {
      this.map.on("click", (e) => {
        onClick(e.latlng.lat, normalizeLon(e.latlng.lng));
      });
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

    // Greatest-eclipse marker.
    if (eclipse.latitude != null && eclipse.longitude != null) {
      L.circleMarker([eclipse.latitude, eclipse.longitude], {
        radius: 6, color: "#fff", weight: 2, fillColor: "#ff5c5c", fillOpacity: 1,
      })
        .bindTooltip(`Greatest eclipse (${eclipse.kind})`)
        .addTo(this.layer);
      this.map.flyTo([eclipse.latitude, eclipse.longitude], 3, { duration: 0.6 });
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
