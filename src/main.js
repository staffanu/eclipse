import { installOverride, sigmaDeltaT, deltaT } from "./delta-t.js";
import { nextEclipseFrom, nextEclipseAfter, prevEclipseBefore } from "./eclipse-search.js";
import { computeShadowPath } from "./path.js";
import { pathUncertaintyDeg } from "./uncertainty.js";
import { MapView } from "./views/map-view.js";
import { SceneView } from "./views/scene-view.js";
import { LocalView } from "./views/local-view.js";

installOverride();

const els = {
  searchFrom: document.getElementById("search-from"),
  prev: document.getElementById("prev-eclipse"),
  next: document.getElementById("next-eclipse"),
  jumpYear: document.getElementById("jump-year"),
  jumpGo: document.getElementById("jump-go"),
  obsLat: document.getElementById("obs-lat"),
  obsLon: document.getElementById("obs-lon"),
  info: document.getElementById("info"),
  dtInfo: document.getElementById("dt-info"),
};

const state = {
  eclipse: null,
  observer: { lat: +els.obsLat.value, lon: +els.obsLon.value },
};

const map = new MapView(document.getElementById("map"), {
  onClick: (lat, lon) => setObserver(lat, lon),
});
const scene = new SceneView(document.getElementById("scene"));
const local = new LocalView(document.getElementById("local"));

function setObserver(lat, lon) {
  state.observer = { lat, lon };
  els.obsLat.value = lat.toFixed(2);
  els.obsLon.value = lon.toFixed(2);
  map.setObserver(lat, lon);
  if (state.eclipse) local.showEclipse(state.eclipse, lat, lon);
}
setObserver(state.observer.lat, state.observer.lon);

function showEclipse(eclipse) {
  state.eclipse = eclipse;
  const year = peakYear(eclipse);
  const samples = computeShadowPath(eclipse, { halfHours: 3, stepMinutes: 2 }).samples;

  map.showEclipse(eclipse, samples, year);
  scene.showEclipse(eclipse);
  local.showEclipse(eclipse, state.observer.lat, state.observer.lon);

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

// Wire controls.
els.next.addEventListener("click", () => {
  const e = state.eclipse
    ? nextEclipseAfter(state.eclipse)
    : nextEclipseFrom(new Date(els.searchFrom.value));
  showEclipse(e);
});

els.prev.addEventListener("click", () => {
  const ref = state.eclipse ? state.eclipse.peak.date : new Date(els.searchFrom.value);
  const e = prevEclipseBefore(ref);
  if (e) showEclipse(e);
});

els.jumpGo.addEventListener("click", () => {
  const year = +els.jumpYear.value;
  if (!Number.isFinite(year)) return;
  const date = yearToDate(year);
  state.eclipse = null;
  showEclipse(nextEclipseFrom(date));
});

els.searchFrom.addEventListener("change", () => {
  state.eclipse = null;
  const e = nextEclipseFrom(new Date(els.searchFrom.value));
  showEclipse(e);
});

function yearToDate(year) {
  const y = Math.trunc(year);
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCFullYear(y);
  return d;
}

els.obsLat.addEventListener("change", () => setObserver(+els.obsLat.value, +els.obsLon.value));
els.obsLon.addEventListener("change", () => setObserver(+els.obsLat.value, +els.obsLon.value));

// Initial eclipse.
showEclipse(nextEclipseFrom(new Date(els.searchFrom.value)));
