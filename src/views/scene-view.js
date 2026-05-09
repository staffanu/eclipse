// 3D Sun-Earth-Moon scene at the eclipse peak.
//
// Bodies are placed in a frame centred on Earth, with positions taken from
// astronomy-engine's J2000 geocentric vectors and scaled into world units that
// are visible at once. We exaggerate body radii so they're not invisible
// dots, but keep the shadow geometry qualitatively correct: the Moon really
// is on the Sun-Earth line at peak, so the cast shadow points the right way.

import * as THREE from "three";
import * as A from "astronomy-engine";

const AU_KM = 149_597_870.7;

// Distance scale (km -> world units). The Moon is ~384,400 km away; placing
// it at world distance ~5 keeps everything navigable.
const DIST_SCALE = 1 / 80_000;
// Bodies are scaled up (more so for the smaller bodies) so they're visible.
const SUN_RADIUS_W = 1.2;
const EARTH_RADIUS_W = 0.4;
const MOON_RADIUS_W = 0.18;

export class SceneView {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000005);

    const w = container.clientWidth || 800;
    const h = container.clientHeight || 400;

    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 5000);
    this.camera.position.set(2.5, 1.5, 6);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    // Stars backdrop.
    const starGeo = new THREE.BufferGeometry();
    const starCount = 800;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 200;
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      positions[3*i] = r * Math.sin(phi) * Math.cos(theta);
      positions[3*i+1] = r * Math.sin(phi) * Math.sin(theta);
      positions[3*i+2] = r * Math.cos(phi);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.scene.add(new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: false })
    ));

    // Bodies.
    this.sun = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_RADIUS_W, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe27a }),
    );
    this.scene.add(this.sun);

    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS_W, 48, 48),
      new THREE.MeshPhongMaterial({ color: 0x2255aa, emissive: 0x041020, shininess: 8 }),
    );
    this.scene.add(this.earth);

    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_RADIUS_W, 32, 32),
      new THREE.MeshPhongMaterial({ color: 0xc8c0b0, emissive: 0x080705 }),
    );
    this.scene.add(this.moon);

    // Sun light source for shading Earth/Moon.
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
    this.scene.add(this.sunLight);

    // Visualised umbra cone (just a thin line through Moon to Earth).
    const lineMat = new THREE.LineBasicMaterial({ color: 0xff5555, transparent: true, opacity: 0.7 });
    this.shadowLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      lineMat,
    );
    this.scene.add(this.shadowLine);

    this._spin = 0;
    this._lastFrame = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);

    window.addEventListener("resize", () => this._resize());
    this._installDrag();
  }

  showEclipse(eclipse) {
    const t = eclipse.peak;
    const sunV = A.GeoVector(A.Body.Sun, t, false);     // AU, J2000 EQJ
    const moonV = A.GeoMoon(t);                          // AU, J2000 EQJ

    // Place bodies using J2000 geocentric vectors. Earth is at origin.
    const sunPos = new THREE.Vector3(sunV.x, sunV.y, sunV.z).multiplyScalar(AU_KM * DIST_SCALE);
    const moonPos = new THREE.Vector3(moonV.x, moonV.y, moonV.z).multiplyScalar(AU_KM * DIST_SCALE);

    // Cap Sun distance for usability — keep Sun "very far" but not absurd.
    const sunDir = sunPos.clone().normalize();
    sunPos.copy(sunDir).multiplyScalar(60);

    this.sun.position.copy(sunPos);
    this.moon.position.copy(moonPos);
    this.sunLight.position.copy(sunPos);
    this.sunLight.target = this.earth;

    // Shadow line from Moon through Earth (extending past).
    const dir = this.earth.position.clone().sub(moonPos).normalize();
    const lineEnd = moonPos.clone().add(dir.clone().multiplyScalar(8));
    this.shadowLine.geometry.setFromPoints([moonPos, lineEnd]);
    this.shadowLine.geometry.attributesNeedUpdate = true;

    this._fitCamera(moonPos);
  }

  _fitCamera(moonPos) {
    // Position camera offset perpendicular to the Moon-Sun line so we see the
    // alignment.
    const moonDir = moonPos.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(moonDir, up).normalize();
    const cam = moonPos.clone().multiplyScalar(0.4)
      .addScaledVector(side, 4)
      .addScaledVector(up, 2);
    this.camera.position.copy(cam);
    this.camera.lookAt(0, 0, 0);
  }

  _loop() {
    const now = performance.now();
    const dt = (now - this._lastFrame) / 1000;
    this._lastFrame = now;
    this._spin += dt * 0.05;
    this.earth.rotation.y = this._spin;
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
    let dragging = false, lx = 0, ly = 0;
    dom.addEventListener("mousedown", (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener("mouseup", () => { dragging = false; });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      const radius = this.camera.position.length();
      const spherical = new THREE.Spherical().setFromVector3(this.camera.position);
      spherical.theta -= dx * 0.005;
      spherical.phi = Math.min(Math.PI - 0.1, Math.max(0.1, spherical.phi - dy * 0.005));
      this.camera.position.setFromSpherical(spherical);
      this.camera.lookAt(0, 0, 0);
    });
    dom.addEventListener("wheel", (e) => {
      e.preventDefault();
      const f = e.deltaY > 0 ? 1.1 : 0.9;
      this.camera.position.multiplyScalar(f);
      this.camera.lookAt(0, 0, 0);
    }, { passive: false });
  }
}
