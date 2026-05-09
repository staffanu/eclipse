// Local-observer view: an SVG showing the Sun's disk with the Moon's disk
// transiting across it, sampled at the eclipse peak instant for the chosen
// observer location.
//
// Two coordinated parts:
//
//   - Main close-up: Sun centred at (0,0) with unit radius (≈ 16'). Moon
//     drawn at the topocentric angular offset, so its disk position and
//     relative size are accurate.
//   - Altitude inset (left strip): always-visible horizon line with markers
//     at the Sun's and Moon's true altitudes, so the user can see where the
//     bodies are in the sky even when the Sun is far below the horizon and
//     thus outside the close-up zoom.
//
// The sky background colour transitions smoothly through day → golden hour
// → civil/nautical/astronomical twilight → night based on the Sun's
// altitude, instead of a binary visible/dimmed toggle.

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

  showEclipse(eclipse, lat, lon, time = null) {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    const observer = new A.Observer(lat, lon, 0);
    const t = time ? A.MakeTime(time) : eclipse.peak;

    const sunEq = A.Equator(A.Body.Sun, t, observer, true, true);
    const moonEq = A.Equator(A.Body.Moon, t, observer, true, true);
    const sunHor = A.Horizon(t, observer, sunEq.ra, sunEq.dec, "normal");
    const moonHor = A.Horizon(t, observer, moonEq.ra, moonEq.dec, "normal");

    const sunDistKm = sunEq.dist * AU_KM;
    const moonDistKm = moonEq.dist * AU_KM;
    const sunR_arcmin = (Math.atan(SUN_RADIUS_KM / sunDistKm) * 180 / Math.PI) * 60;
    const moonR_arcmin = (Math.atan(MOON_RADIUS_KM / moonDistKm) * 180 / Math.PI) * 60;

    const dAz_arcmin = wrap180(moonHor.azimuth - sunHor.azimuth) * 60
                     * Math.cos((sunHor.altitude * Math.PI) / 180);
    const dAlt_arcmin = (moonHor.altitude - sunHor.altitude) * 60;

    const moonR = moonR_arcmin / sunR_arcmin;
    const mx = dAz_arcmin / sunR_arcmin;
    const my = -dAlt_arcmin / sunR_arcmin;
    const sep = Math.hypot(mx, my);
    const inUmbra = sep < Math.abs(moonR - 1);
    const inPenumbra = sep < (moonR + 1);
    const obscur = obscuration(sep, 1, moonR);

    const sky = skyColor(sunHor.altitude);
    this.svg.appendChild(rect(-1.5, -1.5, 3, 3, sky));

    // Solar corona / glow during day and twilight, fading out below ~−6°.
    const glowOpacity = clamp((sunHor.altitude + 6) / 18, 0, 1);
    if (glowOpacity > 0.02) {
      const defs = document.createElementNS(SVG_NS, "defs");
      defs.innerHTML = `
        <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#fff5b8" stop-opacity="${0.6 * glowOpacity}"/>
          <stop offset="60%" stop-color="#ffaa3d" stop-opacity="${0.15 * glowOpacity}"/>
          <stop offset="100%" stop-color="#000" stop-opacity="0"/>
        </radialGradient>`;
      this.svg.appendChild(defs);
      this.svg.appendChild(circle(0, 0, 1.25, "url(#sunGlow)"));
    }

    // The Sun's apparent colour shifts from pale yellow high in the sky to
    // deep red near and below the horizon, fading to a dim ember well below.
    this.svg.appendChild(circle(0, 0, 1, sunDiskColor(sunHor.altitude)));
    // Moon disk: dark silhouette by day, slightly grey at night.
    this.svg.appendChild(circle(mx, my, moonR, sunHor.altitude > 0 ? "#101418" : "#2a2e36"));

    // If the geometric horizon happens to fall within the close-up zoom
    // (sunset / sunrise), draw it as a faint band — purely cosmetic, the
    // inset on the left is the authoritative horizon indicator.
    const horizonY = sunHor.altitude * 60 / sunR_arcmin;
    if (Math.abs(horizonY) < 1.4) {
      this.svg.appendChild(rect(-1.5, horizonY, 3, 1.5 - Math.max(horizonY, -1.5), "rgba(20,12,8,0.55)"));
      this.svg.appendChild(line(-1.5, horizonY, 1.5, horizonY, "rgba(255,200,140,0.7)", 0.015));
    }

    drawAltitudeInset(this.svg, sunHor.altitude, moonHor.altitude);

    // Status + numbers.
    let status;
    if (sunHor.altitude < 0) {
      status = `Sun ${Math.abs(sunHor.altitude).toFixed(1)}° below horizon`;
    } else if (inUmbra) {
      status = moonR >= 1 ? "Total" : "Annular";
    } else if (inPenumbra) {
      status = "Partial";
    } else {
      status = "No eclipse here";
    }

    const labelStyle = sunHor.altitude < -6 ? "#cdd9e6" : "#1a1410";
    this.svg.appendChild(text(-0.65, 1.30, status, "0.11", labelStyle));
    const detail = sunHor.altitude > 0
      ? `obscuration ${(obscur * 100).toFixed(1)}%   ·   Sun alt ${sunHor.altitude.toFixed(1)}°`
      : `Sun alt ${sunHor.altitude.toFixed(1)}°   ·   Moon alt ${moonHor.altitude.toFixed(1)}°`;
    this.svg.appendChild(text(-0.65, 1.43, detail, "0.085", labelStyle));
  }
}

// --- altitude inset (vertical strip on the left) ---------------------------
//
// Maps altitude linearly: +90° at top of the strip, −90° at bottom, horizon
// in the middle. Shows the Sun and Moon as small markers at their actual
// altitudes; this is the always-visible horizon reference even when the
// close-up view is centred on a Sun that's far below the horizon.

function drawAltitudeInset(svg, sunAlt, moonAlt) {
  const x = -1.42;
  const w = 0.16;
  const yTop = -1.25, yBot = 1.25;
  const altToY = (a) => yTop + (1 - (a + 90) / 180) * (yBot - yTop);
  const horizonY = altToY(0);

  // Sky: a vertical gradient capturing day -> twilight -> night by altitude.
  const gradId = "altSkyGrad";
  const defs = document.createElementNS(SVG_NS, "defs");
  defs.innerHTML = `
    <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="${skyColor(90)}"/>
      <stop offset="33%" stop-color="${skyColor(30)}"/>
      <stop offset="66%" stop-color="${skyColor(6)}"/>
      <stop offset="100%" stop-color="${skyColor(0)}"/>
    </linearGradient>`;
  svg.appendChild(defs);

  svg.appendChild(rect(x, yTop, w, horizonY - yTop, `url(#${gradId})`));
  svg.appendChild(rect(x, horizonY, w, yBot - horizonY, "#1a1410"));
  svg.appendChild(line(x, horizonY, x + w, horizonY, "#dcb070", 0.012));

  // Tick marks at ±30°, ±60°.
  for (const tick of [-60, -30, 30, 60]) {
    const ty = altToY(tick);
    svg.appendChild(line(x, ty, x + 0.04, ty, "rgba(255,255,255,0.35)", 0.005));
  }

  // Sun & Moon position markers.
  svg.appendChild(circle(x + w / 2, altToY(clamp(sunAlt, -90, 90)),  0.045, "#ffd95c"));
  svg.appendChild(circle(x + w / 2, altToY(clamp(moonAlt, -90, 90)), 0.034, "#bbb"));

  svg.appendChild(text(x + w + 0.04, horizonY + 0.025, "horizon", "0.07", "#dcb070"));
  svg.appendChild(text(x, yTop - 0.04, "altitude", "0.07", "#aab"));
}

// --- sky / disk colour --------------------------------------------------

function skyColor(altitude) {
  // Linear interpolation between key (altitude → RGB) anchors. Anchors are
  // sorted from high to low altitude; we find the bracketing pair and lerp.
  const stops = [
    { alt:  30, c: [ 93, 180, 232] }, // bright day sky
    { alt:   6, c: [138, 166, 194] }, // pale, slightly warmer
    { alt:   0, c: [240, 160,  96] }, // golden hour
    { alt:  -6, c: [ 90,  48,  80] }, // civil twilight
    { alt: -12, c: [ 28,  34,  68] }, // nautical
    { alt: -18, c: [  8,   8,  26] }, // astronomical
    { alt: -90, c: [  0,   0,   5] }, // deep night
  ];
  if (altitude >= stops[0].alt) return rgb(stops[0].c);
  for (let i = 0; i < stops.length - 1; i++) {
    const hi = stops[i], lo = stops[i + 1];
    if (altitude >= lo.alt) {
      const t = (altitude - lo.alt) / (hi.alt - lo.alt);
      return rgb(lerp3(lo.c, hi.c, t));
    }
  }
  return rgb(stops[stops.length - 1].c);
}

function sunDiskColor(altitude) {
  // Bright yellow high up, deep red at horizon, dim ember below.
  if (altitude >= 10) return "#ffe27a";
  if (altitude >= 0) {
    const t = altitude / 10;
    return rgb(lerp3([255, 144,  72], [255, 226, 122], t));
  }
  if (altitude >= -6) {
    const t = (altitude + 6) / 6;
    return rgb(lerp3([130,  44,  28], [255, 144,  72], t));
  }
  return "#3a1410";
}

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function rgb(c) {
  return `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// --- SVG element helpers -----------------------------------------------

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
function line(x1, y1, x2, y2, stroke, sw = 0.01) {
  const l = document.createElementNS(SVG_NS, "line");
  l.setAttribute("x1", x1); l.setAttribute("y1", y1);
  l.setAttribute("x2", x2); l.setAttribute("y2", y2);
  l.setAttribute("stroke", stroke);
  l.setAttribute("stroke-width", sw);
  return l;
}
function text(x, y, s, size = "0.12", fill = "#e6edf3") {
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", x); t.setAttribute("y", y);
  t.setAttribute("fill", fill);
  t.setAttribute("font-size", size);
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
