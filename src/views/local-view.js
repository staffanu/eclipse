// Local-observer view: an SVG showing the Sun's disk with the Moon's disk
// transiting across it, sampled at the eclipse peak instant for the chosen
// observer location. The Sun is drawn at unit radius; the Moon's relative
// size is its angular diameter / Sun's angular diameter as seen from the
// observer, and its position is the angular separation Moon - Sun expressed
// in arcminutes, with Sun-relative azimuth/altitude as x/y.

import * as A from "astronomy-engine";

const SVG_NS = "http://www.w3.org/2000/svg";
const SUN_RADIUS_KM = 695_700.0;
const MOON_RADIUS_KM = 1_737.4;
const AU_KM = 149_597_870.7;

export class LocalView {
  constructor(container) {
    this.container = container;
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("viewBox", "-1.5 -1.5 3 3");
    this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    container.appendChild(this.svg);
  }

  showEclipse(eclipse, lat, lon) {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    const observer = new A.Observer(lat, lon, 0);
    const t = eclipse.peak;

    const sunEq = A.Equator(A.Body.Sun, t, observer, true, true);
    const moonEq = A.Equator(A.Body.Moon, t, observer, true, true);
    const sunHor = A.Horizon(t, observer, sunEq.ra, sunEq.dec, "normal");
    const moonHor = A.Horizon(t, observer, moonEq.ra, moonEq.dec, "normal");

    const sunDistKm = sunEq.dist * AU_KM;
    const moonDistKm = moonEq.dist * AU_KM;
    const sunR_arcmin = (Math.atan(SUN_RADIUS_KM / sunDistKm) * 180 / Math.PI) * 60;
    const moonR_arcmin = (Math.atan(MOON_RADIUS_KM / moonDistKm) * 180 / Math.PI) * 60;

    // Position Moon relative to Sun in horizontal coordinates (arcmin).
    const dAz_arcmin = wrap180(moonHor.azimuth - sunHor.azimuth) * 60
                     * Math.cos((sunHor.altitude * Math.PI) / 180);
    const dAlt_arcmin = (moonHor.altitude - sunHor.altitude) * 60;

    // Render Sun at unit radius; convert other measurements relative to it.
    const moonR = moonR_arcmin / sunR_arcmin;
    const mx = dAz_arcmin / sunR_arcmin;
    const my = -dAlt_arcmin / sunR_arcmin;

    // Background.
    this.svg.appendChild(rect(-1.5, -1.5, 3, 3, "#000"));

    // Glow halo.
    const glow = circle(0, 0, 1.25, "url(#glow)");
    const defs = document.createElementNS(SVG_NS, "defs");
    defs.innerHTML = `
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fff5b8" stop-opacity="0.6"/>
        <stop offset="60%" stop-color="#ffaa3d" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0"/>
      </radialGradient>`;
    this.svg.appendChild(defs);
    this.svg.appendChild(glow);

    // Sun + Moon. Dim the disks if the Sun is below the horizon — the
    // bodies are still geometrically aligned, but no one at this location
    // can see anything; rendering them at full brightness is misleading.
    const visible = sunHor.altitude > 0;
    this.svg.appendChild(circle(0, 0, 1, visible ? "#ffd95c" : "#3a2f10"));
    this.svg.appendChild(circle(mx, my, moonR, visible ? "#101418" : "#1a1d22"));

    const sep = Math.hypot(mx, my);
    const inUmbra = sep < Math.abs(moonR - 1);
    const inPenumbra = sep < (moonR + 1);
    const obscur = visible ? obscuration(sep, 1, moonR) : 0;

    let status;
    if (!visible) {
      status = `Sun ${Math.abs(sunHor.altitude).toFixed(1)}° below horizon — eclipse not visible`;
    } else if (inUmbra) {
      status = moonR >= 1 ? "Total" : "Annular";
    } else if (inPenumbra) {
      status = "Partial";
    } else {
      status = "No eclipse at this location";
    }

    const altLine = visible ? `Sun altitude ${sunHor.altitude.toFixed(1)}°` : "";
    const label1 = text(-1.45, 1.32, status);
    this.svg.appendChild(label1);
    if (visible) {
      this.svg.appendChild(text(-1.45, 1.45, `obscuration ${(obscur * 100).toFixed(1)}% · ${altLine}`));
    }
  }
}

function rect(x, y, w, h, fill) {
  const r = document.createElementNS(SVG_NS, "rect");
  r.setAttribute("x", x); r.setAttribute("y", y);
  r.setAttribute("width", w); r.setAttribute("height", h);
  r.setAttribute("fill", fill);
  return r;
}
function circle(cx, cy, r, fill) {
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r);
  c.setAttribute("fill", fill);
  return c;
}
function text(x, y, s) {
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", x); t.setAttribute("y", y);
  t.setAttribute("fill", "#e6edf3");
  t.setAttribute("font-size", "0.12");
  t.setAttribute("font-family", "system-ui, sans-serif");
  t.textContent = s;
  return t;
}
function wrap180(deg) {
  let d = deg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

// Fraction of Sun's disk area covered by Moon (two-circle lens area / Sun area).
function obscuration(d, R, r) {
  if (d >= R + r) return 0;
  if (d <= Math.abs(R - r)) return Math.min(1, (r * r) / (R * R));
  const R2 = R * R, r2 = r * r, d2 = d * d;
  const a = R2 * Math.acos((d2 + R2 - r2) / (2 * d * R));
  const b = r2 * Math.acos((d2 + r2 - R2) / (2 * d * r));
  const c = 0.5 * Math.sqrt((-d + R + r) * (d + R - r) * (d - R + r) * (d + R + r));
  const lens = a + b - c;
  return lens / (Math.PI * R2);
}
