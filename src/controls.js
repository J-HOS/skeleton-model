/**
 * controls.js — orbit / pan / zoom, written directly against pointer events.
 *
 * This is deliberately not three.js's OrbitControls. It is ~80 lines, it is
 * the only camera behaviour we need, and every dependency we do not take is
 * one less thing to audit and keep patched (security architecture §7:
 * minimise dependencies). It also handles two-finger pinch, which the app
 * needs on phones and tablets.
 */

const MIN_RADIUS = 2;
const MAX_RADIUS = 24;
// Keep the camera just shy of the poles — exactly at phi=0 or phi=PI the
// view direction is parallel to camera.up and lookAt() has no well-defined
// roll, which snaps/flips the view. 0.02 rad (~1.1 degrees) is close enough
// to a full flip to look and feel unrestricted while staying numerically
// stable; the earlier 0.12 rad (~6.9 degrees) margin was reported as "can't
// rotate 360 in any direction" — you could never quite look straight down
// from above the skull or up from below the feet (2026-07-31).
const MIN_PHI = 0.02;
const MAX_PHI = Math.PI - 0.02;

// How far the orbit target may be pushed from the origin. The model is fitted
// so its longest axis is MODEL_FIT_UNITS (7) and centred, so its half-extent is
// ~3.5 — this lets any part of the body be dragged to any edge of the screen
// while making it impossible to pan the model off into empty space and be
// unable to find it again. Added 2026-08-01 with panning.
const MAX_PAN_FROM_ORIGIN = 5;

export class OrbitControls {
  constructor(camera, element, target) {
    this.camera = camera;
    this.element = element;
    this.target = target.clone();
    this.home = target.clone();
    this.radius = 9.5;
    // theta=0 faces the model's +Z (anterior) side by default — see the
    // matching note in viewer.js on why anterior is +Z, not -Z (a corrective
    // rotation added 2026-07-31 for an unrelated upside-down bug flips which
    // side that is). syncFromCamera() below derives the real starting value
    // from the camera's actual position, so this is the rest angle
    // documentation/fallback, not the only place this matters.
    this.theta = 0;          // azimuth
    this.phi = Math.PI / 2; // polar
    this.pinching = false;

    this._pointers = new Map();
    this._lastPinchDistance = 0;
    this._lastPinchCentre = null;

    element.addEventListener('pointerdown', this._onDown);
    element.addEventListener('pointermove', this._onMove);
    element.addEventListener('pointerup', this._onUp);
    element.addEventListener('pointercancel', this._onUp);
    element.addEventListener('wheel', this._onWheel, { passive: false });
    // Right-drag pans, so the browser menu must not interrupt it.
    element.addEventListener('contextmenu', (event) => event.preventDefault());

    this.syncFromCamera();
  }

  /** Derive spherical coordinates from wherever the camera currently is. */
  syncFromCamera() {
    const dx = this.camera.position.x - this.target.x;
    const dy = this.camera.position.y - this.target.y;
    const dz = this.camera.position.z - this.target.z;
    this.radius = Math.max(MIN_RADIUS, Math.hypot(dx, dy, dz));
    this.theta = Math.atan2(dx, dz);
    this.phi = Math.acos(Math.min(1, Math.max(-1, dy / this.radius)));
    this.update();
  }

  _onDown = (event) => {
    this._pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.element.setPointerCapture?.(event.pointerId);
  };

  _onMove = (event) => {
    const previous = this._pointers.get(event.pointerId);
    if (!previous) return;
    const current = { x: event.clientX, y: event.clientY };
    this._pointers.set(event.pointerId, current);

    if (this._pointers.size >= 2) {
      // Two fingers do both at once, which is what every map and photo app
      // does: the change in SEPARATION zooms, the movement of the MIDPOINT
      // pans. Handling only the separation (as this did before 2026-08-01)
      // meant that once you were zoomed in, the only way to see a different
      // part of the body was to zoom out, orbit, and zoom back in.
      this.pinching = true;
      const [a, b] = [...this._pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

      if (this._lastPinchDistance) this._zoom(this._lastPinchDistance / distance);
      if (this._lastPinchCentre) {
        this._pan(centre.x - this._lastPinchCentre.x, centre.y - this._lastPinchCentre.y);
      }
      this._lastPinchDistance = distance;
      this._lastPinchCentre = centre;
      return;
    }

    const dx = current.x - previous.x;
    const dy = current.y - previous.y;

    // Desktop equivalents of the two-finger drag: right button, middle button,
    // or shift held. `buttons` is a bitmask — 2 is secondary, 4 is middle.
    if (event.shiftKey || (event.buttons & 2) || (event.buttons & 4)) {
      this._pan(dx, dy);
      return;
    }

    this.theta -= dx * 0.006;
    this.phi = Math.min(MAX_PHI, Math.max(MIN_PHI, this.phi - dy * 0.006));
    this.update();
  };

  _onUp = (event) => {
    this._pointers.delete(event.pointerId);
    if (this._pointers.size < 2) {
      this._lastPinchDistance = 0;
      this._lastPinchCentre = null;
      // Leave a beat before clearing, so the pointerup that ends a pinch is
      // not mistaken for a tap by the selection handler.
      setTimeout(() => { if (this._pointers.size === 0) this.pinching = false; }, 60);
    }
  };

  _onWheel = (event) => {
    event.preventDefault();
    this._zoom(event.deltaY > 0 ? 1.1 : 0.9);
  };

  _zoom(factor) {
    this.radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, this.radius * factor));
    this.update();
  }

  /**
   * Slide the model across the screen by moving the orbit target in the plane
   * the camera is looking at, so dragging feels like moving the model itself
   * rather than swinging around it.
   *
   * The screen basis comes straight from the spherical angles instead of the
   * camera matrix, which avoids depending on whether update() has run yet:
   *   right = (cos t, 0, -sin t)
   *   up    = (-sin t cos p, sin p, -cos t cos p)
   * Both are unit length for any theta/phi, so no normalising is needed.
   *
   * Pixels are converted to world units through the camera's own vertical
   * field of view at the current distance, which is what makes a drag track
   * the cursor at every zoom level — a fixed pixels-to-units factor would feel
   * far too fast when zoomed in and too slow when zoomed out.
   */
  _pan(dxPixels, dyPixels) {
    if (!dxPixels && !dyPixels) return;
    const height = this.element.clientHeight || window.innerHeight;
    const worldPerPixel =
      (2 * this.radius * Math.tan((this.camera.fov * Math.PI) / 360)) / height;

    const sinT = Math.sin(this.theta);
    const cosT = Math.cos(this.theta);
    const sinP = Math.sin(this.phi);
    const cosP = Math.cos(this.phi);

    // Dragging right moves the MODEL right, which means moving the target
    // left — hence the negated dx. dy is not negated because screen y already
    // grows downward while the up vector grows upward.
    const kx = -dxPixels * worldPerPixel;
    const ky = dyPixels * worldPerPixel;

    let x = this.target.x + cosT * kx + -sinT * cosP * ky;
    let y = this.target.y + sinP * ky;
    let z = this.target.z + -sinT * kx + -cosT * cosP * ky;

    // Keep the target near the model so panning cannot strand the user in
    // empty space with nothing on screen and no way back.
    const distance = Math.hypot(x - this.home.x, y - this.home.y, z - this.home.z);
    if (distance > MAX_PAN_FROM_ORIGIN) {
      const scale = MAX_PAN_FROM_ORIGIN / distance;
      x = this.home.x + (x - this.home.x) * scale;
      y = this.home.y + (y - this.home.y) * scale;
      z = this.home.z + (z - this.home.z) * scale;
    }

    this.target.set(x, y, z);
    this.update();
  }

  /** Put the camera back where it started. */
  reset() {
    this.target.copy(this.home);
    this.radius = 9.5;
    this.theta = 0;
    this.phi = Math.PI / 2;
    this.update();
  }

  update() {
    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sinPhi * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sinPhi * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
  }

  dispose() {
    this.element.removeEventListener('pointerdown', this._onDown);
    this.element.removeEventListener('pointermove', this._onMove);
    this.element.removeEventListener('pointerup', this._onUp);
    this.element.removeEventListener('pointercancel', this._onUp);
    this.element.removeEventListener('wheel', this._onWheel);
  }
}
