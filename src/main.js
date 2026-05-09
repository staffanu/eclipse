import { installOverride, sigmaDeltaT, deltaT } from "./delta-t.js";
import { nextEclipseFrom, nextEclipseAfter, prevEclipseBefore, nearestEclipseTo } from "./eclipse-search.js";
import { computeShadowPath, shadowSampleAtTime } from "./path.js";
import { pathUncertaintyDeg, normalizeLon } from "./uncertainty.js";
import { MapView } from "./views/map-view.js";
import { SceneView } from "./views/scene-view.js";
import { LocalView } from "./views/local-view.js";

installOverride();

const els = {
  dateInput: document.getElementById("date-input"),
  prev: document.getElementById("prev-eclipse"),
  next: document.getElementById("next-eclipse"),
  timeSlider: document.getElementById("time-slider"),
  timeDisplay: document.getElementById("time-display"),
  obsLat: document.getElementById("obs-lat"),
  obsLon: document.getElementById("obs-lon"),
  info: document.getElementById("info"),
  dtInfo: document.getElementById("dt-info"),
};

const state = {
  eclipse: null,
  observer: { lat: +els.obsLat.value, lon: +els.obsLon.value },
  // Time slider offset from peak, in minutes. 0 = exactly at peak.
  scrubMinutes: 0,
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

  syncDateInput(eclipse);
  map.showEclipse(eclipse, samples, year, peakIndex);
  scene.showEclipse(eclipse);
  local.showEclipse(eclipse, state.observer.lat, state.observer.lon, currentScrubTime());
  updateScrub();  // place the shadow-center marker at peak

  const dateStr = eclipse.peak.date.toISOString().replace("T", " ").slice(0, 19) + " UT";
  const lat = eclipse.latitude?.toFixed(2) ?? "--";
  const lon = eclipse.longitude?.toFixed(2) ?? "--";
  const obs = eclipse.obscuration != null
    ? `obscuration ${(eclipse.obscuration * 100).toFixed(1)}%`
    : "";
  els.info.textContent =
    `Kind:        ${eclipse.kind}\n` +
    `Peak:        ${dateStr}\n` +
    `Greatest:    ${lat}°, ${lon}°\n` +
    (obs ? `             ${obs}\n` : "") +
    `Year:        ${year}`;

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

function peakYear(e) {
  const d = e.peak.date;
  return d.getUTCFullYear() + (d.getUTCMonth() + d.getUTCDate() / 31) / 12;
}

// Set the date input to the eclipse's peak date. The native date input only
// accepts AD years 0001-9999; outside that range we leave it blank (the full
// date is still shown in the info panel).
function syncDateInput(eclipse) {
  const d = eclipse.peak.date;
  const y = d.getUTCFullYear();
  if (y >= 1 && y <= 9999) {
    els.dateInput.value =
      String(y).padStart(4, "0") + "-" +
      String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
      String(d.getUTCDate()).padStart(2, "0");
  } else {
    els.dateInput.value = "";
  }
}

function refDate() {
  return state.eclipse ? state.eclipse.peak.date : new Date(els.dateInput.value);
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

els.dateInput.addEventListener("change", safe(() => {
  if (!els.dateInput.value) return;
  showEclipse(nearestEclipseTo(new Date(els.dateInput.value)));
}));

els.obsLat.addEventListener("change", () => setObserver(+els.obsLat.value, +els.obsLon.value));
els.obsLon.addEventListener("change", () => setObserver(+els.obsLat.value, +els.obsLon.value));

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
  const utLabel = t.toISOString().slice(11, 19) + " UT";
  map.setShadowCenter(sample.lat, sample.lon, sample.kind, utLabel);
  // Refresh the local view at this instant for the chosen observer.
  local.showEclipse(state.eclipse, state.observer.lat, state.observer.lon, t);
}

function formatScrub(minutes, t) {
  const sign = minutes < 0 ? "−" : minutes > 0 ? "+" : "";
  const m = Math.abs(minutes);
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  const offset = minutes === 0
    ? "peak"
    : hh ? `peak ${sign}${hh}h ${String(mm).padStart(2, "0")}m`
         : `peak ${sign}${mm}m`;
  const utc = t.toISOString().slice(11, 19) + " UT";
  return `${offset}  ·  ${utc}`;
}

// Initial eclipse — wrap so any failure shows in the UI rather than vanishing.
safe(() => showEclipse(nearestEclipseTo(new Date(els.dateInput.value))))();

// If the browser will hand us the user's coordinates (cached or freshly
// granted), use them as the default observer. Otherwise we keep the HTML
// fallback, Södermalm in Stockholm.
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (pos) => setObserver(pos.coords.latitude, pos.coords.longitude),
    () => { /* denied / timed out — keep the fallback */ },
    { timeout: 8000, maximumAge: 600_000 },
  );
}
