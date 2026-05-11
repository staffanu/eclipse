// 3D Sun-Earth-Moon scene driven by the time slider.
//
// Positions come from astronomy-engine in J2000 equatorial coordinates and
// are placed directly in the Three.js world frame, so world +Z is the
// celestial pole. Distances and body radii use a single linear scale
// (1 km → 1/80000 world units), so Earth, Moon, and the umbra / antumbra /
// penumbra cones are all to actual scale — every linear dimension matches
// reality. The Sun is the one deliberate deviation: at this DIST_SCALE the
// real Sun sits ~1875 world units away which would push it well off-screen
// on every camera pose, so the Sun is capped at SUN_DISPLAY_DIST and its
// radius is scaled down so its *angular size* still matches the real Sun's
// (~0.265° angular radius). Earth's rotation about its own axis is set from
// Greenwich apparent sidereal time at the slider's instant, so dragging the
// slider sweeps the shadow across the surface.

import * as THREE from "three";
import * as A from "astronomy-engine";

const AU_KM = 149_597_870.7;
const R_SUN_KM = 695_700.0;
const R_MOON_KM = 1_737.4;

// Distance scale (km -> world units). The Moon is ~384,400 km away; placing
// it at world distance ~5 keeps everything navigable.
const DIST_SCALE = 1 / 80_000;

// Body radii. Earth, Moon, and the cones are all at exactly their actual
// scaled radii so the cone-Earth visual interaction is physically correct.
// The Sun is the one deliberate deviation: at this DIST_SCALE the real Sun
// sits ~1875 world units away, so it's capped at SUN_DISPLAY_DIST and its
// radius is set so its angular size still matches the real Sun's. The
// shadow-axis direction is computed from the *actual* Sun position, not
// from this capped display position — otherwise as the Moon moves, the
// axis would swing far faster than reality and the cone would sweep off
// Earth long before the real eclipse ends.
const SUN_DISPLAY_DIST  = 60;
const EARTH_RADIUS_W    = 6_378.137 * DIST_SCALE;
const MOON_RADIUS_W     = R_MOON_KM * DIST_SCALE;
const CONE_BASE_W       = MOON_RADIUS_W;
const SUN_RADIUS_W      = SUN_DISPLAY_DIST * R_SUN_KM / AU_KM;

export class SceneView {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000005);
    this.eclipse = null;

    const w = container.clientWidth || 800;
    const h = container.clientHeight || 400;

    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.005, 5000);
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
    // threejs.org-hosted texture failed CORS in some browsers). When the
    // texture lands we also brighten the material's base colour to white so
    // the texture is shown at full brightness instead of being multiplied by
    // a dark blue.
    new THREE.TextureLoader()
      .setCrossOrigin("anonymous")
      .load(
        "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/planets/earth_atmos_2048.jpg",
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          earthMat.map = tex;
          earthMat.color.setHex(0xffffff);
          earthMat.emissive.setHex(0x101820);
          earthMat.needsUpdate = true;
        },
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

    // Low ambient light so the Earth texture's continents remain readable
    // where the penumbra cone darkens the day side. The directional sunlight
    // alone leaves shadowed regions nearly black against the map texture.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
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

  // Three cones extend along the shadow axis. The umbra (dark red) goes
  // from the Moon to the umbral apex, where Sun and Moon's apparent radii
  // are equal — past the apex the Moon is geometrically "smaller" than the
  // Sun, so an observer there sees an annular eclipse. The antumbra (same
  // red, paler) extends past the apex and is what hits Earth for annular
  // eclipses; for total eclipses the apex falls beyond Earth so its base is
  // hidden inside the planet. The penumbra (pale yellow) is the much wider
  // partial-shadow cone. Both penumbra and antumbra are cut at Earth's
  // center so they don't visually extend past the planet.
  _addShadowCones() {
    const umbraColor = 0x4a3530;
    this.umbra = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: umbraColor, transparent: true, opacity: 0.36, side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.antumbra = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: umbraColor, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    // Penumbra fades along the cone axis (local +Y) so it can extend behind
    // Earth without a hard cutoff. uFadeStart/uFadeEnd are set per-eclipse in
    // showEclipse() once we know cone_extent_w. Uniforms live on userData so
    // we can update them whether or not the shader has compiled yet.
    const penumbraMat = new THREE.MeshBasicMaterial({
      color: 0xd9b865, transparent: true, opacity: 0.11, side: THREE.DoubleSide,
      depthWrite: false,
    });
    penumbraMat.userData.fadeUniforms = {
      uFadeStart: { value: 0 },
      uFadeEnd: { value: 1 },
    };
    penumbraMat.onBeforeCompile = (shader) => {
      shader.uniforms.uFadeStart = penumbraMat.userData.fadeUniforms.uFadeStart;
      shader.uniforms.uFadeEnd   = penumbraMat.userData.fadeUniforms.uFadeEnd;
      shader.vertexShader = "varying float vLocalY;\n" + shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvLocalY = position.y;",
      );
      shader.fragmentShader =
        "varying float vLocalY;\nuniform float uFadeStart;\nuniform float uFadeEnd;\n" +
        shader.fragmentShader.replace(
          "#include <opaque_fragment>",
          "diffuseColor.a *= 1.0 - smoothstep(uFadeStart, uFadeEnd, vLocalY);\n#include <opaque_fragment>",
        );
    };
    this.penumbra = new THREE.Mesh(new THREE.BufferGeometry(), penumbraMat);
    // Penumbra first so umbra/antumbra paint over it where they overlap.
    this.scene.add(this.penumbra);
    this.scene.add(this.antumbra);
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

    // Cut both penumbra and antumbra at Earth's center so they don't extend
    // past the planet. We compute the parameter along the shadow axis at
    // which the axis passes closest to Earth's center; during an eclipse
    // this is very nearly the Moon-to-Earth-center distance, but solving
    // it properly handles the slight off-axis geometry too.
    const moonVec = new THREE.Vector3(moonV.x, moonV.y, moonV.z).multiplyScalar(AU_KM * DIST_SCALE);
    const sunVecActual = new THREE.Vector3(sunV.x, sunV.y, sunV.z).multiplyScalar(AU_KM * DIST_SCALE);
    const shadowDirPeak = moonVec.clone().sub(sunVecActual).normalize();
    const cone_extent_w = -moonVec.dot(shadowDirPeak);

    // Truncate the umbra at Earth's center so it never protrudes out the
    // back of the planet on total eclipses (where the umbral apex is past
    // Earth). For annular eclipses L_w < cone_extent_w, so the apex falls
    // short of Earth and the cylinder collapses to a sharp-tipped cone
    // (top radius 0), matching the original ConeGeometry.
    const umbLen_w = Math.min(L_w, cone_extent_w);
    const umbTopRadius = CONE_BASE_W * Math.max(0, 1 - umbLen_w / L_w);
    this.umbra.geometry.dispose();
    this.umbra.geometry = new THREE.CylinderGeometry(
      umbTopRadius, CONE_BASE_W, umbLen_w, 64, 1, true,
    );
    // Antumbra: divergent cone past the umbra apex; for annular eclipses
    // it's what hits Earth (the umbra apex falls short of the planet). For
    // total eclipses the apex is past Earth's center so antuLen_w clamps to
    // a tiny stub that's effectively hidden. Transverse radius grows at the
    // same rate the umbra was shrinking, so apex-to-Earth proportions stay
    // correct.
    const antuLen_w = Math.max(0.05, cone_extent_w - L_w);
    const antuTopRadius = CONE_BASE_W * (antuLen_w / L_w);
    this.antumbra.geometry.dispose();
    this.antumbra.geometry = new THREE.CylinderGeometry(
      antuTopRadius, 0, antuLen_w, 64, 1, true,
    );
    // Penumbra: divergent cone that grows from R_moon at the Moon outward.
    // Extend it past Earth's center by a few Earth radii and let the shader
    // fade the alpha out across that tail, so the cone dissolves smoothly
    // behind Earth instead of stopping at a hard disc at Earth's center.
    const penExtraLen_w = EARTH_RADIUS_W * 6;
    const penLen_w = cone_extent_w + penExtraLen_w;
    const penTopRadius_w = CONE_BASE_W * (1 + penLen_w / L_w);
    this.penumbra.geometry.dispose();
    this.penumbra.geometry = new THREE.CylinderGeometry(
      penTopRadius_w, CONE_BASE_W, penLen_w, 64, 1, true,
    );
    // Local +Y end of the cone is at penLen_w/2; Earth's center sits at
    // local Y = penLen_w/2 - penExtraLen_w. Begin fading slightly before
    // Earth's center so the dissolve hides the silhouette transition.
    const penFadeUniforms = this.penumbra.material.userData.fadeUniforms;
    penFadeUniforms.uFadeStart.value = penLen_w / 2 - penExtraLen_w - EARTH_RADIUS_W * 0.8;
    penFadeUniforms.uFadeEnd.value   = penLen_w / 2;
    this._L_w = L_w;   // cached so updateForTime can place the antumbra apex

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
    const sunPosActual = new THREE.Vector3(sunV.x, sunV.y, sunV.z).multiplyScalar(AU_KM * DIST_SCALE);
    const sunDir  = sunPosActual.clone().normalize();
    const sunPos  = sunDir.clone().multiplyScalar(SUN_DISPLAY_DIST);

    this.sun.position.copy(sunPos);
    this.moon.position.copy(moonPos);
    this.sunLight.position.copy(sunPos);

    // Shadow axis: from the *actual* Sun position toward the Moon. Using
    // the capped display position here would make the axis swing too fast
    // as the Moon moves (the lever arm would be ~30× too short), and the
    // cone would clear Earth far earlier than the real eclipse end time.
    const shadowDir = new THREE.Vector3().subVectors(moonPos, sunPosActual).normalize();
    placeAlongAxis(this.umbra, moonPos, shadowDir);
    placeAlongAxis(this.penumbra, moonPos, shadowDir);
    // Antumbra base sits at the umbral apex, point pointing back toward
    // the Moon; the wide end then extends past Earth in the shadow
    // direction.
    const apexPos = moonPos.clone().addScaledVector(shadowDir, this._L_w);
    placeAlongAxis(this.antumbra, apexPos, shadowDir);

    // Earth's rotation around +Z is set from Greenwich Apparent Sidereal
    // Time at this instant.
    const sidereal = A.SiderealTime(t);
    this.earth.rotation.z = sidereal * Math.PI / 12;
  }

  _fitCamera() {
    if (!this.eclipse) return;
    const moonV = A.GeoMoon(this.eclipse.peak);
    const moonPos = new THREE.Vector3(moonV.x, moonV.y, moonV.z).multiplyScalar(AU_KM * DIST_SCALE);
    // View from the Moon side, but yawed around the celestial pole and
    // tilted up off the Moon-Earth line so the camera sits well outside the
    // penumbra (~0.27° half-angle) and gives a 3/4 view of Earth and the
    // cones. Small pitch keeps the angle close to from-the-side; the yaw
    // around the pole adds a sideways component so the view isn't directly
    // along the shadow axis.
    const moonDir = moonPos.clone().normalize();
    const polar = new THREE.Vector3(0, 0, 1);
    let perp = new THREE.Vector3().crossVectors(moonDir, polar);
    if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
    perp.normalize();
    const camDir = moonDir.clone()
      .applyAxisAngle(polar, 25 * Math.PI / 180)
      .applyAxisAngle(perp, 15 * Math.PI / 180);
    this.camera.position.copy(camDir.multiplyScalar(moonPos.length() * 1.5 / 10));
    this.camera.lookAt(0, 0, 0);
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
      pitch += dy * 0.005;   // drag down → look down (inverted vs. previous)
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
      const newPos = this.camera.position.clone().multiplyScalar(factor);
      // Camera looks at Earth's center, so it must stay outside the surface
      // by at least the near clipping plane — otherwise the front of Earth
      // is clipped away and the user sees the inside.
      const minDist = EARTH_RADIUS_W + this.camera.near + 0.002;
      if (newPos.length() < minDist) newPos.setLength(minDist);
      this.camera.position.copy(newPos);
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

// Generate a soft circular gradient texture for the Sun sprite. The bright
// (alpha 1) disc fills most of the sprite (out to 80% of the texture
// radial), so the visible Sun roughly matches `SUN_RADIUS_W`'s angular
// size from the camera; the remaining 20% is a thin warm halo that fades
// to transparent at the edge.
function makeSunTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0.00, "rgba(255, 245, 200, 1)");
  grad.addColorStop(0.75, "rgba(255, 226, 122, 1)");
  grad.addColorStop(0.82, "rgba(255, 200,  90, 0.6)");
  grad.addColorStop(0.92, "rgba(255, 140,  60, 0.18)");
  grad.addColorStop(1.00, "rgba(255, 100,  30, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
