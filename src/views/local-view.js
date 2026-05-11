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

    // Altitude strip lives as an absolutely-positioned HTML overlay so its
    // distance from the container's left edge is a fixed pixel count,
    // independent of the main SVG's letterbox.
    this.altInset = document.createElement("div");
    this.altInset.className = "alt-inset";
    container.appendChild(this.altInset);
  }

  showEclipse(eclipse, lat, lon, time = null) {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    const observer = new A.Observer(lat, lon, 0);
    const t = time ? A.MakeTime(time) : eclipse.peak;

    const sunEq = A.Equator(A.Body.Sun, t, observer, true, true);
    const moonEq = A.Equator(A.Body.Moon, t, observer, true, true);
    // Unrefracted horizon coordinates (refraction = null) for both bodies
    // so the moon's position relative to the sun stays smooth across
    // sunset. The "normal" refraction model has a hard cutoff near
    // altitude −1° and is strongly non-linear at the horizon (≈35′ at
    // alt 0); applied independently to two bodies of slightly different
    // altitudes it produces a visible jump in their relative offset
    // right at sundown.
    const sunHor = A.Horizon(t, observer, sunEq.ra, sunEq.dec, null);
    const moonHor = A.Horizon(t, observer, moonEq.ra, moonEq.dec, null);

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
    // The SVG content is square; the panel is usually wider than tall, so
    // letterbox bars appear on the sides. Painting the container with the
    // same sky colour fills those bars and the colour reads continuously
    // across the whole panel.
    this.container.style.backgroundColor = sky;

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

    // The Sun's apparent colour: bright yellow/orange above the horizon,
    // dim ember below. When the horizon crosses the disk, the upper and
    // lower segments are filled with their respective colours so the
    // disk itself shows the sunset/sunrise transition.
    const horizonY = sunHor.altitude * 60 / sunR_arcmin;
    const aboveColor = sunDiskColor(Math.max(sunHor.altitude, 0));
    const belowColor = sunDiskColor(Math.min(sunHor.altitude, 0) - 0.001);
    if (horizonY >= 1) {
      this.svg.appendChild(circle(0, 0, 1, aboveColor));
    } else if (horizonY <= -1) {
      this.svg.appendChild(circle(0, 0, 1, belowColor));
    } else {
      const clipDefs = document.createElementNS(SVG_NS, "defs");
      clipDefs.innerHTML = `<clipPath id="sunClip"><circle cx="0" cy="0" r="1"/></clipPath>`;
      this.svg.appendChild(clipDefs);
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("clip-path", "url(#sunClip)");
      g.appendChild(rect(-1, -1, 2, horizonY + 1, aboveColor));
      g.appendChild(rect(-1, horizonY, 2, 1 - horizonY, belowColor));
      this.svg.appendChild(g);
    }
    // Moon disk: dark silhouette by day, slightly grey at night.
    this.svg.appendChild(circle(mx, my, moonR, sunHor.altitude > 0 ? "#101418" : "#2a2e36"));

    drawAltitudeInset(this.altInset, sunHor.altitude, moonHor.altitude);

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
    this.svg.appendChild(text(-0.7, 1.25, status, "0.14", labelStyle));
    const detail = sunHor.altitude > 0
      ? `obscuration ${(obscur * 100).toFixed(1)}%   ·   Sun alt ${sunHor.altitude.toFixed(1)}°`
      : `Sun alt ${sunHor.altitude.toFixed(1)}°   ·   Moon alt ${moonHor.altitude.toFixed(1)}°`;
    this.svg.appendChild(text(-0.7, 1.44, detail, "0.14", labelStyle));
  }
}

// --- altitude inset (vertical strip on the left) ---------------------------
//
// Maps altitude linearly: +90° at top of the strip, −90° at bottom, horizon
// in the middle. Shows the Sun and Moon as small markers at their actual
// altitudes; this is the always-visible horizon reference even when the
// close-up view is centred on a Sun that's far below the horizon.

function drawAltitudeInset(host, sunAlt, moonAlt) {
  while (host.firstChild) host.removeChild(host.firstChild);

  // Map altitude -> CSS percent from top of strip. +90° = 0%, -90° = 100%.
  const altToPct = (a) => (1 - (a + 90) / 180) * 100;
  const horizonPct = altToPct(0);

  const sky = document.createElement("div");
  sky.className = "alt-sky";
  sky.style.top = "0";
  sky.style.height = `${horizonPct}%`;
  sky.style.background = `linear-gradient(to bottom, ${skyColor(90)} 0%, ${skyColor(30)} 33%, ${skyColor(6)} 66%, ${skyColor(0)} 100%)`;
  host.appendChild(sky);

  const ground = document.createElement("div");
  ground.className = "alt-ground";
  ground.style.top = `${horizonPct}%`;
  ground.style.bottom = "0";
  ground.style.background = "#1a1410";
  host.appendChild(ground);

  const horizon = document.createElement("div");
  horizon.className = "alt-horizon";
  horizon.style.top = `calc(${horizonPct}% - 0.5px)`;
  host.appendChild(horizon);

  for (const tick of [-60, -30, 30, 60]) {
    const t = document.createElement("div");
    t.className = "alt-tick";
    t.style.top = `${altToPct(tick)}%`;
    host.appendChild(t);
  }

  const sun = document.createElement("div");
  sun.className = "alt-marker alt-sun";
  sun.style.top = `${altToPct(clamp(sunAlt, -90, 90))}%`;
  host.appendChild(sun);

  const moon = document.createElement("div");
  moon.className = "alt-marker alt-moon";
  moon.style.top = `${altToPct(clamp(moonAlt, -90, 90))}%`;
  host.appendChild(moon);

  const horizLabel = document.createElement("div");
  horizLabel.className = "alt-label";
  horizLabel.style.top = `calc(${horizonPct}% + 2px)`;
  horizLabel.textContent = "horizon";
  host.appendChild(horizLabel);

  const topLabel = document.createElement("div");
  topLabel.className = "alt-label top";
  topLabel.textContent = "altitude";
  host.appendChild(topLabel);
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
  // Bright yellow high up, deep orange at the horizon; below the horizon
  // the disk is a dim ember. The hard transition is at altitude 0 so that
  // the sunset/sunrise split-disk rendering uses crisp upper/lower colours.
  if (altitude >= 10) return "#ffe27a";
  if (altitude >= 0) {
    const t = altitude / 10;
    return rgb(lerp3([255, 144,  72], [255, 226, 122], t));
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
