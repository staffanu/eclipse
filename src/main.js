import { installOverride, sigmaDeltaT, deltaT } from "./delta-t.js";
import { nextEclipseFrom, nextEclipseAfter, prevEclipseBefore } from "./eclipse-search.js";
import { computeShadowPath, shadowSampleAtTime } from "./path.js";
import { computeFootprintLayers } from "./footprint.js";
import { pathUncertaintyDeg, normalizeLon } from "./uncertainty.js";
import { MapView } from "./views/map-view.js";
import { SceneView } from "./views/scene-view.js";
import { LocalView } from "./views/local-view.js";

installOverride();

const els = {
  yearInput: document.getElementById("year-input"),
  dayDisplay: document.getElementById("day-display"),
  monthDisplay: document.getElementById("month-display"),
  prev: document.getElementById("prev-eclipse"),
  next: document.getElementById("next-eclipse"),
  timeSlider: document.getElementById("time-slider"),
  timeDisplay: document.getElementById("time-display"),
  obsLat: document.getElementById("obs-lat"),
  obsLon: document.getElementById("obs-lon"),
  info: document.getElementById("info"),
  dtInfo: document.getElementById("dt-info"),
  mapHeader: document.getElementById("map-header"),
  showFootprint: document.getElementById("show-footprint"),
};

const state = {
  eclipse: null,
  observer: { lat: +els.obsLat.value, lon: +els.obsLon.value },
  // Time slider offset from peak, in minutes. 0 = exactly at peak.
  scrubMinutes: 0,
  // Cached penumbral-footprint contour layers for the current eclipse,
  // so toggling the visibility checkbox doesn't have to recompute.
  footprintLayers: [],
  showFootprint: els.showFootprint.checked,
};

const map = new MapView(document.getElementById("map"), {
  onClick: (lat, lon) => setObserver(lat, lon),
});
const scene = new SceneView(document.getElementById("scene"));
const local = new LocalView(document.getElementById("local"));

// rawLon may come from a click on a wrapped Leaflet world copy and so can be
// outside [-180, 180]. The marker is placed at the raw click position (so it
// stays where the user clicked even with worldCopyJump), but state and the
// input field hold the canonical wrap.
function setObserver(lat, rawLon) {
  const lon = normalizeLon(rawLon);
  state.observer = { lat, lon };
  els.obsLat.value = lat.toFixed(2);
  els.obsLon.value = lon.toFixed(2);
  map.setObserver(lat, rawLon);
  if (state.eclipse) local.showEclipse(state.eclipse, lat, lon, currentScrubTime());
}

function currentScrubTime() {
  if (!state.eclipse) return null;
  return new Date(state.eclipse.peak.date.getTime() + state.scrubMinutes * 60_000);
}
setObserver(state.observer.lat, state.observer.lon);

function showEclipse(eclipse) {
  state.eclipse = eclipse;
  // Reset the time slider for each new eclipse.
  state.scrubMinutes = 0;
  els.timeSlider.value = "0";

  const year = peakYear(eclipse);
  const { samples, peakIndex } = computeShadowPath(eclipse, { halfHours: 3, stepMinutes: 2 });

  syncYearInput(eclipse);
  map.showEclipse(eclipse, samples, year, peakIndex);

  // Compute the penumbral-footprint contour layers once per eclipse and
  // cache them; the checkbox just toggles drawing the cached layers.
  state.footprintLayers = computeFootprintLayers(eclipse.peak.date);
  map.showFootprint(state.footprintLayers, state.showFootprint);

  // For partial eclipses there's no greatest-eclipse coord to fly to, so
  // pan the map to the centroid of the outer footprint contour instead.
  // astronomy-engine returns null *or* NaN for these — guard against both.
  const isPartial = !Number.isFinite(eclipse.latitude)
                 || !Number.isFinite(eclipse.longitude);
  if (isPartial) map.flyToFootprint(state.footprintLayers);

  // Snap the observer to the peak point (or footprint centroid for partials)
  // so the local view defaults to the most interesting spot on Earth for
  // each new eclipse. We update state and the marker here without calling
  // setObserver(), because setObserver re-renders local-view, and we want
  // a single consistent render below — after scene.showEclipse has rebuilt
  // its geometry for the new eclipse.
  const peakObs = isPartial
    ? footprintCenter(state.footprintLayers)
    : { lat: eclipse.latitude, lon: eclipse.longitude };
  if (peakObs) {
    const lon = normalizeLon(peakObs.lon);
    state.observer = { lat: peakObs.lat, lon };
    els.obsLat.value = peakObs.lat.toFixed(2);
    els.obsLon.value = lon.toFixed(2);
    map.setObserver(peakObs.lat, peakObs.lon);
  }

  scene.showEclipse(eclipse);
  // updateScrub() handles the local-view and scene time-dependent rendering
  // at the current slider position (which we just reset to 0 = peak).
  updateScrub();

  const dateStr = eclipse.peak.date.toISOString().replace("T", " ").slice(0, 19) + " UT";
  const lat = eclipse.latitude?.toFixed(2) ?? "—";
  const lon = eclipse.longitude?.toFixed(2) ?? "—";
  const obs = eclipse.obscuration != null
    ? `obscuration ${(eclipse.obscuration * 100).toFixed(1)}%`
    : "";

  let body = `Kind:        ${eclipse.kind}\nPeak:        ${dateStr}`;
  if (isPartial) {
    body += "\n(only the penumbra grazes Earth — no totality path)";
  } else {
    body += `\nGreatest:    ${lat}°, ${lon}°`;
    if (obs) body += `\n             ${obs}`;
  }
  els.info.textContent = body;

  // Update the map panel header so the user immediately sees what's shown.
  els.mapHeader.textContent = isPartial
    ? "Partial eclipse"
    : eclipse.kind === "annular"
      ? "Annular eclipse — antumbral path with ΔT uncertainty band"
      : "Total eclipse — umbral path with ΔT uncertainty band";

  const sigma = sigmaDeltaT(year);
  const dt = deltaT(year);
  const dlon = pathUncertaintyDeg(year);
  const kmAtEq = dlon * 111.32;
  els.dtInfo.innerHTML =
    `<div>&Delta;T at peak: <b>${dt.toFixed(0)} s</b></div>` +
    `<div>1&sigma;(&Delta;T): <b>${sigma.toFixed(1)} s</b></div>` +
    `<div>1&sigma; ground shift: <b>${dlon.toFixed(3)}&deg;</b> (~${kmAtEq.toFixed(0)} km E&ndash;W)</div>` +
    (Math.abs(year - 2000) > 3000
      ? `<div style="color:#ff5c5c;margin-top:6px">Outside &plusmn;3000 y of J2000: ephemeris accuracy degrades.</div>`
      : "");
}

function footprintCenter(layers) {
  if (!layers || !layers.length) return null;
  const outer = layers[0].polygons;
  if (!outer.length) return null;
  let sumLat = 0, sumLon = 0, n = 0;
  for (const p of outer) for (const v of p) { sumLat += v.lat; sumLon += v.lon; n++; }
  return n ? { lat: sumLat / n, lon: sumLon / n } : null;
}

function peakYear(e) {
  const d = e.peak.date;
  return d.getUTCFullYear() + (d.getUTCMonth() + d.getUTCDate() / 31) / 12;
}

// Reflect the snapped eclipse back to the day / month displays and the
// year input — day and month are read-only labels (they update with the
// search), only the year is typeable.
function syncYearInput(eclipse) {
  const d = eclipse.peak.date;
  els.yearInput.value = String(d.getUTCFullYear());
  els.dayDisplay.textContent = String(d.getUTCDate());
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  els.monthDisplay.textContent = months[d.getUTCMonth()];
}

function refDate() {
  if (state.eclipse) return state.eclipse.peak.date;
  return jan1OfYear(parseInt(els.yearInput.value, 10));
}

function jan1OfYear(y) {
  const d = new Date(0);
  d.setUTCFullYear(y, 0, 1);
  return d;
}

function safe(fn) {
  return (...args) => {
    try { fn(...args); }
    catch (err) {
      console.error(err);
      els.info.textContent = "Error: " + err.message;
    }
  };
}

els.next.addEventListener("click", safe(() => {
  const e = state.eclipse ? nextEclipseAfter(state.eclipse) : nextEclipseFrom(refDate());
  showEclipse(e);
}));

els.prev.addEventListener("click", safe(() => {
  const e = prevEclipseBefore(refDate());
  if (e) showEclipse(e);
}));

els.yearInput.addEventListener("change", safe(() => {
  const y = parseInt(els.yearInput.value, 10);
  if (!Number.isFinite(y)) return;
  showEclipse(nextEclipseFrom(jan1OfYear(y)));
}));

els.obsLat.addEventListener("change", () => setObserver(+els.obsLat.value, +els.obsLon.value));
els.obsLon.addEventListener("change", () => setObserver(+els.obsLat.value, +els.obsLon.value));

els.showFootprint.addEventListener("change", safe(() => {
  state.showFootprint = els.showFootprint.checked;
  map.showFootprint(state.footprintLayers, state.showFootprint);
}));

els.timeSlider.addEventListener("input", safe(() => {
  state.scrubMinutes = +els.timeSlider.value;
  updateScrub();
}));

function updateScrub() {
  if (!state.eclipse) return;
  const t = currentScrubTime();
  els.timeDisplay.textContent = formatScrub(state.scrubMinutes, t);
  // Move (or hide) the shadow-center marker. The time tooltip pinned to
  // the marker doubles as a "where is the umbra now" readout on the map.
  const sample = shadowSampleAtTime(t);
  const utLabel = t.toISOString().slice(11, 19) + " UTC";
  map.setShadowCenter(sample.lat, sample.lon, sample.kind, utLabel);
  // Refresh the local view and the 3D scene at this instant.
  local.showEclipse(state.eclipse, state.observer.lat, state.observer.lon, t);
  scene.updateForTime(t);
}

function formatScrub(_minutes, t) {
  return t.toISOString().slice(11, 19) + " UTC";
}

// View toggles (only visible at narrow viewports). Each button independently
// shows/hides one of the three panels; default is all three on. We always
// keep at least one panel visible — clicking the last active toggle is a no-op.
const VIEWS = ["map", "scene", "local"];
function setViewVisible(view, on) {
  document.body.classList.toggle(`show-${view}`, on);
  const btn = document.querySelector(`.view-toggle[data-view="${view}"]`);
  if (btn) btn.classList.toggle("active", on);
  window.dispatchEvent(new Event("resize"));
}
VIEWS.forEach(v => setViewVisible(v, true));
document.querySelectorAll(".view-toggle").forEach(b => {
  b.addEventListener("click", () => {
    const v = b.dataset.view;
    const on = !document.body.classList.contains(`show-${v}`);
    if (!on && VIEWS.every(x => x === v || !document.body.classList.contains(`show-${x}`))) {
      return; // refuse to hide the last visible panel
    }
    setViewVisible(v, on);
  });
});

// Details modal (mobile). On desktop the same #more-controls block is just
// inlined in the sidebar, so toggling the class is a no-op there.
const setMore = (open) => document.body.classList.toggle("more-expanded", open);
document.getElementById("more-toggle")?.addEventListener("click", () => {
  setMore(!document.body.classList.contains("more-expanded"));
});
document.getElementById("more-close")?.addEventListener("click", () => setMore(false));
document.getElementById("more-backdrop")?.addEventListener("click", () => setMore(false));

// Initial eclipse — wrap so any failure shows in the UI rather than vanishing.
// showEclipse() snaps the observer to the eclipse's peak point, so we don't
// query geolocation on startup. Start from "now" so the first eclipse shown
// is today's (if any) or the next upcoming one, rather than the first
// eclipse of the current calendar year.
safe(() => showEclipse(nextEclipseFrom(new Date())))();
