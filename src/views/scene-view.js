// 3D Sun-Earth-Moon scene driven by the time slider.
//
// Positions come from astronomy-engine in J2000 equatorial coordinates and
// are placed directly in the Three.js world frame, so world +Z is the
// celestial pole. Distances use a single linear scale (1 km → 1/80000
// world units) but body radii are exaggerated for visibility — the umbra
// and penumbra cones use the actual longitudinal scale (so the apex sits
// at the right distance along the axis) but are rendered with the same
// transverse exaggeration as the Moon, which makes them visible without
// distorting where the shadow reaches. Earth's rotation about its own
// axis is set from Greenwich apparent sidereal time at the slider's
// instant, so dragging the slider sweeps the shadow across the surface.

import * as THREE from "three";
import * as A from "astronomy-engine";
import { shadowSampleAtTime } from "../path.js";

const AU_KM = 149_597_870.7;
const R_SUN_KM = 695_700.0;
const R_MOON_KM = 1_737.4;

// Distance scale (km -> world units). The Moon is ~384,400 km away; placing
// it at world distance ~5 keeps everything navigable.
const DIST_SCALE = 1 / 80_000;

// Body radii — exaggerated so the bodies are visible at the chosen distance
// scale. The shadow cones share the Moon's exaggeration on the transverse
// axis so they line up with Moon's silhouette at the base.
const SUN_RADIUS_W = 1.2;
const EARTH_RADIUS_W = 0.32;
const MOON_RADIUS_W = 0.18;

// Sun is capped at this world distance — the actual scaled distance (~1850)
// would push it absurdly far off-screen.
const SUN_DISPLAY_DIST = 60;

export class SceneView {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000005);
    this.eclipse = null;

    const w = container.clientWidth || 800;
    const h = container.clientHeight || 400;

    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.05, 5000);
    this.camera.up.set(0, 0, 1);   // J2000 +Z = celestial north pole
    this.camera.position.set(2.5, -6, 2);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this._addStars();
    this._addBodies();
    this._addEarthMarkers();
    this._addShadowCones();

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);

    window.addEventListener("resize", () => this._resize());
    this._installDrag();
  }

  _addStars() {
    const starGeo = new THREE.BufferGeometry();
    const starCount = 800;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 200;
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      positions[3*i]   = r * Math.sin(phi) * Math.cos(theta);
      positions[3*i+1] = r * Math.sin(phi) * Math.sin(theta);
      positions[3*i+2] = r * Math.cos(phi);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.scene.add(new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: false })
    ));
  }

  _addBodies() {
    // Sun: rendered as a billboarded sprite with a radial-gradient texture
    // rather than a 3D sphere. A sphere far from the optical axis would
    // project to a noticeable ellipse ("egg shape") in perspective; a
    // sprite always faces the camera and is always circular. This is fine
    // for the Sun because we don't need real 3D shading on a self-luminous
    // body.
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeSunTexture(),
      transparent: true,
      depthWrite: false,
    }));
    this.sun.scale.set(SUN_RADIUS_W * 2.4, SUN_RADIUS_W * 2.4, 1);
    this.scene.add(this.sun);

    // Three.js SphereGeometry has its UV pole at +Y and its texture U=0
    // seam at −X. We render in a J2000-ish frame where +Z is the celestial
    // pole, and our lat/lon → Cartesian convention puts lon=0 at +X. A
    // single rotateX(π/2) maps the geometry's +Y pole to +Z; the U=0/1
    // seam stays at −X (the antimeridian, lon=±180) and U=0.5 lands at +X
    // (the prime meridian) — exactly where the disc and wireframe expect.
    const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS_W, 64, 48);
    earthGeo.rotateX(Math.PI / 2);

    const earthMat = new THREE.MeshPhongMaterial({
      color: 0x1a4878, emissive: 0x031020, shininess: 8,
    });
    this.earth = new THREE.Mesh(earthGeo, earthMat);

    // Try to load a public Earth texture so continents are visible — that's
    // the only way the user can perceive Earth rotating in the scene. We
    // use a jsDelivr URL because that CDN sets `Access-Control-Allow-Origin: *`
    // for all assets, which `crossOrigin="anonymous"` requires (the original
    // threejs.org-hosted texture failed CORS in some browsers).
    new THREE.TextureLoader()
      .setCrossOrigin("anonymous")
      .load(
        "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/planets/earth_atmos_2048.jpg",
        (tex) => { tex.colorSpace = THREE.SRGBColorSpace; earthMat.map = tex; earthMat.needsUpdate = true; },
        undefined,
        (err) => { console.warn("Earth texture failed to load:", err); },
      );

    this.scene.add(this.earth);

    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_RADIUS_W, 48, 48),
      new THREE.MeshPhongMaterial({ color: 0xc8c0b0, emissive: 0x080705 }),
    );
    this.scene.add(this.moon);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
    this.sunLight.target = this.earth;
    this.scene.add(this.sunLight);

    // Umbral shadow patch on Earth's surface — a small dark sphere half
    // embedded in the surface at the centerline lat/lon. (A flat disc was
    // invisible edge-on, which happens almost any time the camera sits to
    // the side of the Sun-Moon-Earth axis.) Parented to Earth so it
    // inherits the planet's sidereal rotation; as you scrub the slider
    // the sphere walks along the surface while Earth turns under it —
    // the visible "shadow sweeps from one side to the other" effect.
    this.shadowDisc = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    this.shadowDisc.visible = false;
    this.earth.add(this.shadowDisc);
  }

  // Wireframe meridians, parallels and a polar axis on Earth — gives the
  // sphere visible features so you can actually see Earth turning under the
  // shadow when the time slider moves.
  _addEarthMarkers() {
    const wire = new THREE.LineBasicMaterial({ color: 0x77a8d8, transparent: true, opacity: 0.45 });
    const accent = new THREE.LineBasicMaterial({ color: 0xff9a7a, transparent: true, opacity: 0.85 });
    const r = EARTH_RADIUS_W * 1.005;

    // Equator.
    this.earth.add(line(circlePoints(r, "equator"), accent));
    // Prime meridian (lon = 0).
    this.earth.add(line(meridianPoints(r, 0), accent));
    // Other meridians every 30°.
    for (let lon = 30; lon < 360; lon += 30) {
      this.earth.add(line(meridianPoints(r, lon), wire));
    }
    // Parallels every 30°.
    for (const lat of [-60, -30, 30, 60]) {
      this.earth.add(line(parallelPoints(r, lat), wire));
    }
    // Polar axis through Earth.
    const axisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, -EARTH_RADIUS_W * 1.6),
      new THREE.Vector3(0, 0,  EARTH_RADIUS_W * 1.6),
    ]);
    this.earth.add(new THREE.Line(axisGeo, new THREE.LineBasicMaterial({
      color: 0xffd75c, transparent: true, opacity: 0.6,
    })));
  }

  // Two cones extend from the Moon along the shadow axis: the umbra (dark
  // red) narrows to its apex; the penumbra (pale yellow) flares outward.
  // Both share the same axis and base position so they line up at the Moon.
  _addShadowCones() {
    this.umbra = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x8a3030, transparent: true, opacity: 0.30, side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.penumbra = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xc9a04a, transparent: true, opacity: 0.10, side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    // Penumbra first so umbra paints over it where they overlap.
    this.scene.add(this.penumbra);
    this.scene.add(this.umbra);
  }

  showEclipse(eclipse) {
    this.eclipse = eclipse;

    // Build cone geometry once per eclipse — Sun-Moon distance barely
    // changes within the ±2 h slider range, so the cone shape can be
    // reused across all scrub times for this eclipse.
    const t = eclipse.peak;
    const sunV  = A.GeoVector(A.Body.Sun, t, true);
    const moonV = A.GeoMoon(t);
    const sunMoonKm = mag({
      x: (moonV.x - sunV.x) * AU_KM,
      y: (moonV.y - sunV.y) * AU_KM,
      z: (moonV.z - sunV.z) * AU_KM,
    });
    const L_km = sunMoonKm * R_MOON_KM / (R_SUN_KM - R_MOON_KM);
    const L_w  = L_km * DIST_SCALE;
    const penLen_w = L_w * 1.4;
    const penTopRadius_w = MOON_RADIUS_W * (1 + penLen_w / L_w);

    this.umbra.geometry.dispose();
    this.umbra.geometry = new THREE.ConeGeometry(MOON_RADIUS_W, L_w, 64, 1, true);
    this.penumbra.geometry.dispose();
    this.penumbra.geometry = new THREE.CylinderGeometry(
      penTopRadius_w, MOON_RADIUS_W, penLen_w, 64, 1, true,
    );

    this.updateForTime(eclipse.peak.date);
    this._fitCamera();
  }

  // Drive the scene from the time slider. We render in the J2000 inertial
  // frame: Sun and Moon stay (approximately) fixed in space while Earth
  // rotates around its +Z axis by Greenwich Apparent Sidereal Time. With
  // continent texture visible, the user sees Earth turning underneath the
  // (nearly fixed) shadow disc, which reads as the umbra sweeping across
  // the surface as Earth rotates.
  updateForTime(time) {
    if (!this.eclipse) return;
    const t = A.MakeTime(time);

    const sunV  = A.GeoVector(A.Body.Sun, t, true);
    const moonV = A.GeoMoon(t);

    const moonPos = new THREE.Vector3(moonV.x, moonV.y, moonV.z).multiplyScalar(AU_KM * DIST_SCALE);
    const sunDir  = new THREE.Vector3(sunV.x,  sunV.y,  sunV.z).normalize();
    const sunPos  = sunDir.clone().multiplyScalar(SUN_DISPLAY_DIST);

    this.sun.position.copy(sunPos);
    this.moon.position.copy(moonPos);
    this.sunLight.position.copy(sunPos);

    // Shadow axis: from Sun toward Moon, then beyond.
    const shadowDir = new THREE.Vector3().subVectors(moonPos, sunPos).normalize();
    placeAlongAxis(this.umbra, moonPos, shadowDir);
    placeAlongAxis(this.penumbra, moonPos, shadowDir);

    // Earth's rotation around +Z is set from Greenwich Apparent Sidereal
    // Time at this instant.
    const sidereal = A.SiderealTime(t);
    this.earth.rotation.z = sidereal * Math.PI / 12;

    // Shadow patch at the umbra's surface point. shadowSampleAtTime returns
    // Earth-fixed lat/lon; the disc is parented to the (rotating) Earth so
    // setting its local position from those coords places it at the
    // correct world location once Earth's rotation is applied.
    const sample = shadowSampleAtTime(t);
    if (sample.lat == null) {
      this.shadowDisc.visible = false;
    } else {
      this.shadowDisc.visible = true;
      const latR = sample.lat * Math.PI / 180;
      const lonR = sample.lon * Math.PI / 180;
      this.shadowDisc.position.set(
        Math.cos(latR) * Math.cos(lonR) * EARTH_RADIUS_W,
        Math.cos(latR) * Math.sin(lonR) * EARTH_RADIUS_W,
        Math.sin(latR) * EARTH_RADIUS_W,
      );
    }
  }

  _fitCamera() {
    if (!this.eclipse) return;
    const moonV = A.GeoMoon(this.eclipse.peak);
    const moonPos = new THREE.Vector3(moonV.x, moonV.y, moonV.z).multiplyScalar(AU_KM * DIST_SCALE);
    const polar = new THREE.Vector3(0, 0, 1);
    let side = new THREE.Vector3().crossVectors(moonPos, polar);
    if (side.lengthSq() < 1e-6) side.set(0, 1, 0);
    side.normalize();
    const midpoint = moonPos.clone().multiplyScalar(0.5);
    this.camera.position.copy(midpoint
      .clone()
      .addScaledVector(side, 7)
      .addScaledVector(polar, 1.8));
    this.camera.lookAt(midpoint);
  }

  _loop() {
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._loop);
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _installDrag() {
    const dom = this.renderer.domElement;
    dom.style.touchAction = "none";
    const pointers = new Map();
    let lastPinchDist = null;

    // Z-up orbit: decompose the camera offset from origin into yaw (around
    // the world's +Z axis, the celestial pole) and pitch (signed elevation
    // angle from the equatorial plane). Three.js's Spherical helper uses
    // +Y as the polar axis, which doesn't agree with our camera.up = +Z
    // and leads to the camera rolling unexpectedly during drag.
    const orbitFromDelta = (dx, dy) => {
      const off = this.camera.position.clone();
      const radius = off.length();
      if (radius < 1e-6) return;

      const horizDist = Math.hypot(off.x, off.y);
      let yaw = Math.atan2(off.y, off.x);
      let pitch = Math.atan2(off.z, horizDist);

      yaw -= dx * 0.005;
      pitch -= dy * 0.005;
      const PITCH_LIMIT = Math.PI / 2 - 0.05;
      pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));

      const newH = Math.cos(pitch) * radius;
      this.camera.position.set(
        Math.cos(yaw) * newH,
        Math.sin(yaw) * newH,
        Math.sin(pitch) * radius,
      );
      this.camera.lookAt(0, 0, 0);
    };
    const zoomBy = (factor) => {
      this.camera.position.multiplyScalar(factor);
      this.camera.lookAt(0, 0, 0);
    };

    dom.addEventListener("pointerdown", (e) => {
      dom.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastPinchDist = null;
    });
    dom.addEventListener("pointermove", (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const next = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, next);
      if (pointers.size === 1) {
        orbitFromDelta(next.x - prev.x, next.y - prev.y);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinchDist != null && dist > 0) zoomBy(lastPinchDist / dist);
        lastPinchDist = dist;
      }
    });
    const release = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) lastPinchDist = null;
    };
    dom.addEventListener("pointerup", release);
    dom.addEventListener("pointercancel", release);
    dom.addEventListener("pointerleave", release);
    dom.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoomBy(e.deltaY > 0 ? 1.1 : 0.9);
    }, { passive: false });
  }
}

// Place a Three.js mesh whose geometry has its central axis along local +Y
// so that the geometry's base sits at `basePoint` and the +Y axis points
// along `axisDir` (i.e. apex / +height end is in `axisDir` from base).
function placeAlongAxis(mesh, basePoint, axisDir) {
  const height = mesh.geometry.parameters.height;
  mesh.position.copy(basePoint).addScaledVector(axisDir, height / 2);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axisDir);
}

// --- helpers for Earth's wireframe markers ---
function line(points, material) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
}
function circlePoints(r, kind) {
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  return pts;
}
function meridianPoints(r, lonDeg) {
  const lon = lonDeg * Math.PI / 180;
  const cosLon = Math.cos(lon), sinLon = Math.sin(lon);
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const lat = (i / 64 - 0.5) * Math.PI;
    const cosLat = Math.cos(lat);
    pts.push(new THREE.Vector3(cosLat * cosLon * r, cosLat * sinLon * r, Math.sin(lat) * r));
  }
  return pts;
}
function parallelPoints(r, latDeg) {
  const lat = latDeg * Math.PI / 180;
  const cosLat = Math.cos(lat);
  const z = Math.sin(lat) * r;
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * cosLat * r, Math.sin(a) * cosLat * r, z));
  }
  return pts;
}

function mag(v) { return Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z); }

// Generate a soft circular gradient texture for the Sun sprite — bright
// pale-yellow core, falling off to a faint warm halo. Drawn into a canvas
// once at construction and reused.
function makeSunTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0.00, "rgba(255, 245, 200, 1)");
  grad.addColorStop(0.40, "rgba(255, 226, 122, 1)");
  grad.addColorStop(0.50, "rgba(255, 220, 110, 1)");
  grad.addColorStop(0.55, "rgba(255, 180,  80, 0.5)");
  grad.addColorStop(0.75, "rgba(255, 140,  60, 0.18)");
  grad.addColorStop(1.00, "rgba(255, 100,  30, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
