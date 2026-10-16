/**
 * viewer.js — the 3D scene. Owns three.js and nothing else owns it.
 *
 * The rest of the app talks to the viewer through a small surface:
 * load(), select(), setLayerVisible(), onSelect(). Keeping three.js behind
 * this boundary is what lets every other module be tested in plain Node.
 */

import * as THREE from '../vendor/three.module.js?v=67094af755ca';
import { GLTFLoader } from '../vendor/GLTFLoader.js?v=67094af755ca';
import { OrbitControls } from './controls.js?v=67094af755ca';
import { BONE_SURFACE_COLORS, COLORS, LAYERS, LIMITS, MODEL_FIT_UNITS, MUSCLE_SECTION_COLORS, PATHS, PEEL, RENDER } from './config.js?v=67094af755ca';
import { assertLooksLikeGLB, fetchLocal } from './security.js?v=67094af755ca';
import { attachmentWeight, axialParameter, axialTaper, boneSurfaceKey, classifyLayer, findMuscleRecord, hiddenByIsolation, isPeeled, recordAliases, resolvesToContent, scaleChannels, selectionGroup, varyLightness, viewOffsetFor, fitDistance } from './anatomy.js?v=67094af755ca';

const TAP_MOVE_TOLERANCE_PX = 8; // beyond this, the gesture was a drag, not a tap

export class Viewer {
  constructor(container, muscleIndex) {
    this.muscleIndex = muscleIndex;
    this.selectable = [];
    this.selectedId = null;
    // Every structure id currently lit by the selection: one, or a left/right
    // pair in bilateral mode (2026-10-09). selectedId stays the one asked for.
    this.selectedIds = new Set();
    this.bilateral = false;
    this.layerVisibility = { skeleton: true, muscle: false, ligaments: false, nerves: false, vessels: false };
    this.populatedLayers = new Set();
    this._selectHandler = () => {};
    this._mainTransform = null;
    this._loader = new GLTFLoader();
    this._xray = false;
    // Depth view (2026-10-14): measured layer per muscle, and the chosen depth
    // (0 = off). See isPeeled() in anatomy.js.
    this.layerMap = null;
    this.peelDepth = 0;

    /**
     * Live-tunable appearance. Every default here mirrors config.js exactly,
     * so an app with no dev panel — or a panel nobody touches — renders
     * byte-identically to before this existed.
     *
     * These four settings are the three appearance changes made on 2026-08-01
     * that were reasoned about and rendered in Blender but never actually seen
     * in the app (see Next Up in CLAUDE.md), plus a tone control for the suture
     * colour, which is the specific value most in doubt. They live on the
     * viewer rather than in the panel because the viewer owns material state;
     * the panel only drives them.
     */
    this.tuning = {
      boneSurfaces: true,
      sutureTone: 1,
      shadeVariance: RENDER.muscleShadeVariance,
      roughnessSplit: true,
      attachmentTint: RENDER.attachmentTint,
      attachmentSpan: RENDER.attachmentSpan,
      attachmentTaperMax: RENDER.attachmentTaperMax,
    };

    // Reused scratch colours so retune() does not allocate per mesh per frame
    // while a slider is being dragged.
    this._tintBelly = new THREE.Color();
    this._tintEnd = new THREE.Color();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.background);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    // Anterior-facing default. In the model's RAW data, anterior is -Z
    // (PectoralisMajor sits at Z -79..-16, Trapezius at Z -4..+77 — confirmed
    // 2026-07-27), which is what an earlier pass this session used to put the
    // camera on the -Z side. That was wrong to leave standing alone: the
    // model needed a 180-degree corrective rotation for an unrelated bug (it
    // was rendering upside down — see the rotation.x note in _integrate()),
    // and rotating 180 degrees about X flips Z as a side effect, so anterior
    // is +Z after that fix, not -Z. Camera restored to the +Z side to match
    // (2026-07-31) — net result across both changes: right-side up, facing
    // anterior, on the +Z side, same convention the app started with.
    this.camera.position.set(0, 0.5, 9.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Without tone mapping, any pixel whose lit colour exceeds 1.0 per
    // channel hard-clips to solid white with zero gradient left — that is
    // what "washed out, no detail" looks like, and the pale bone colour
    // pushed over that edge easily. ACES gives highlights a soft rolloff
    // instead, so a slightly-too-hot light dims gracefully rather than
    // blowing a surface out to a flat white. Added 2026-07-31 alongside the
    // lighting fix below, and kept as a standing safeguard against the same
    // mistake happening again from a future re-tune.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // Lighting, corrected 2026-07-31, then sharpened further same day for
    // fine surface detail (skull sutures, bony landmarks). An earlier pass
    // this session tried to make lighting "softer and more even" by lifting
    // the ambient hemisphere and adding a third near-equal-strength light —
    // that made a whiteout worse, not better: several similar-strength
    // lights hitting a surface from different directions all at once floods
    // MORE of it into clipping territory (see the tone-mapping note above)
    // AND erases the light/shadow gradient that reveals curved surface
    // detail — "even" lighting taken too far reads as flat, not soft. Fixed
    // by going back to one dominant key light with low ambient.
    //
    // Second pass, same session: fine detail like suture lines needs more
    // than a single key light can rake — one light only catches grooves
    // that happen to face it, leaving grooves at other angles flat. Added a
    // second, lower cross light from a different azimuth so more grooves
    // catch a shadow from at least one direction, and pushed ambient down
    // further (hemisphere/fill/rim all reduced) so those shadows read as
    // genuinely dark rather than filled back in. Safe to push key brighter
    // than before for the same reason bone could go brighter: ACES tone
    // mapping rolls off highlights instead of clipping them.
    // Third pass, 2026-08-01: ambient pulled down again and the key pushed up,
    // to deepen the grooves between adjacent muscle bellies. Ambient light is
    // what fills a crevice back in, so lowering it is the most direct control
    // available for contact definition short of real ambient occlusion.
    // Fourth pass, 2026-10-14, after Jake's phone test: zoomed in under the
    // foot, the sole was nearly black. Every light above was fixed in world
    // space and aimed from above or the side, so any surface facing down (the
    // sole, the palm turned over, the underside of the jaw) got only the dark
    // hemisphere ground colour. Jake: "everything should be highlighted and
    // easy to see". Fix: the main light now rides on the camera (a headlight,
    // offset up and to the right so curved surfaces still shade), so whatever
    // you are looking at is lit from your side; the ground colour is lifted so
    // no face goes black; one fixed light from above keeps a consistent sense
    // of top. ACES (above) still rolls off highlights.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 0.55));
    const head = new THREE.DirectionalLight(0xffffff, 1.0);
    head.position.set(2.5, 3, 6);         // relative to the camera
    head.target.position.set(0, 0, -10);  // straight ahead of the camera
    this.camera.add(head);
    this.camera.add(head.target);
    this.scene.add(this.camera);
    const top = new THREE.DirectionalLight(0xffffff, 0.35);
    top.position.set(4, 8, 6);
    this.scene.add(top);
    const fill = new THREE.DirectionalLight(0xfff4e8, 0.2);
    fill.position.set(-3, -4, -6);
    this.scene.add(fill);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement, new THREE.Vector3(0, 0, 0));
    this.raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._downAt = null;

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      // Only a plain primary press can begin a selection. Right/middle press
      // and shift-press are pan gestures (see controls.js), and a right-click
      // that happens not to move should not select whatever is under it.
      this._downAt = (e.button === 0 && !e.shiftKey)
        ? { x: e.clientX, y: e.clientY }
        : null;
    });
    this.renderer.domElement.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('resize', this.resize);

    this.resize();
    this._animate();
  }

  /** Register the callback fired when the user taps a structure. */
  onSelect(handler) {
    this._selectHandler = handler;
  }

  resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.renderer.setSize(w, h);
    this._applyViewOffset();
  };

  /**
   * Keep the selection in the part of the screen the detail card leaves
   * uncovered (2026-10-16, review N1). `inset` is the covered px on the
   * right (desktop card) and bottom (phone card); {} or zeros = none. The
   * offset eases toward the target in the render loop, roughly in step with
   * the card's .2s slide. Taps stay accurate: Raycaster.setFromCamera uses
   * the projection matrix, which includes the view offset.
   */
  setViewInset(inset = {}) {
    this._insetTarget = { right: Number(inset.right) || 0, bottom: Number(inset.bottom) || 0 };
  }

  _stepViewInset() {
    const target = this._insetTarget || { right: 0, bottom: 0 };
    const cur = this._inset || (this._inset = { right: 0, bottom: 0 });
    // Time-based easing (time constant 60 ms, ~0.2 s to settle) so the slide
    // takes the same time at 60 fps, on a slow phone, or under software GL -
    // a per-frame step was still sliding seconds later at low frame rates.
    const now = performance.now();
    const dt = this._insetAt ? Math.min(now - this._insetAt, 1000) : 16;
    this._insetAt = now;
    const k = 1 - Math.exp(-dt / 60);
    let moved = false;
    for (const key of ['right', 'bottom']) {
      const d = target[key] - cur[key];
      if (Math.abs(d) < 0.5) {
        if (cur[key] !== target[key]) { cur[key] = target[key]; moved = true; }
      } else {
        cur[key] += d * k;
        moved = true;
      }
    }
    if (moved) this._applyViewOffset();
  }

  _applyViewOffset() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const off = viewOffsetFor(w, h, this._inset || {});
    if (off) this.camera.setViewOffset(w, h, off.x, off.y, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  _animate = () => {
    requestAnimationFrame(this._animate);
    this._stepViewInset();
    this.renderer.render(this.scene, this.camera);
  };

  _onPointerUp = (event) => {
    const down = this._downAt;
    this._downAt = null;
    if (!down || this.controls.pinching) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > TAP_MOVE_TOLERANCE_PX) return;

    this._pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this._pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this._pointer, this.camera);

    const hit = this.raycaster
      .intersectObjects(this.selectable, false)
      .find((h) => h.object.visible);
    if (hit) this._selectHandler(hit.object.userData.structureId);
  };

  /**
   * Fetch and add a .glb.
   * @param {string} path
   * @param {object} options
   *   replace   - clear the scene first (the main skeleton does; add-ons do not)
   *   reuseMain - reuse the main model's transform instead of computing a new
   *               one. Used by skull_detail.glb, which was calibrated in
   *               Blender against the same frame as the main skeleton, so
   *               re-centring it on its own bounding box would misplace it.
   *   forceLayer - override layer classification for every mesh in the file
   */
  async load(path, options = {}) {
    const buffer = await fetchLocal(path, { as: 'buffer', timeoutMs: LIMITS.fetchTimeoutMs, onProgress: options.onProgress });
    assertLooksLikeGLB(buffer, LIMITS.modelBytes);
    const gltf = await this._loader.parseAsync(buffer, '');
    return this._integrate(gltf.scene, options);
  }

  /** Same as load(), for a file the user drops in or picks. */
  async loadFromBuffer(buffer, options = {}) {
    assertLooksLikeGLB(buffer, LIMITS.modelBytes);
    const gltf = await this._loader.parseAsync(buffer, '');
    return this._integrate(gltf.scene, options);
  }

  _integrate(root, { replace = false, reuseMain = false, forceLayer = null } = {}) {
    if (replace) {
      for (const mesh of this.selectable) mesh.parent?.remove(mesh);
      this.selectable = [];
      this.populatedLayers.clear();
      this.selectedId = null;
      this.selectedIds = new Set();
      if (this._modelRoot) this.scene.remove(this._modelRoot);
      this._modelRoot = null;
    }

    // NOTE (2026-08-01): there used to be a `root.rotation.x = Math.PI` here,
    // compensating for skeleton_v2.glb's raw geometry being vertically
    // inverted. That is gone because the source is fixed rather than patched.
    //
    // The root cause was never in this file: the whole Blender scene had been
    // assembled in BodyParts3D's Y-up convention INSIDE Blender, which is
    // Z-up, with the head toward -Y — and was then exported without the Y-up
    // conversion, so the .glb inherited Blender's raw axes verbatim and its
    // "up" axis ran head-DOWN. The scene has been rotated -90 degrees about X
    // into proper Blender Z-up and re-exported with export_yup=True; the model
    // now arrives right way up, anterior toward +Z, which is the side the
    // camera above sits on. See (C) export_skeleton_v2_to_glb.py, which
    // asserts both of those before it will write a file.

    if (reuseMain && this._mainTransform) {
      const { scale, center } = this._mainTransform;
      root.scale.setScalar(scale);
      root.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    } else {
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = MODEL_FIT_UNITS / (Math.max(size.x, size.y, size.z) || 1);
      root.scale.setScalar(scale);
      root.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      if (replace) this._mainTransform = { scale, center: center.clone() };
    }

    this.scene.add(root);
    if (replace) this._modelRoot = root;

    const added = [];
    root.traverse((object) => {
      if (!object.isMesh) return;
      // Read the exporter's material name BEFORE cloning — it identifies what
      // kind of surface this slot is (bone vs suture vs cartilage vs enamel),
      // which is the only place that distinction survives from Z-Anatomy.
      const materialName = (Array.isArray(object.material) ? object.material[0] : object.material)?.name || '';
      // Clone materials so highlighting one mesh cannot recolour every mesh
      // that happens to share a material instance from the exporter.
      object.material = Array.isArray(object.material)
        ? object.material.map((m) => m.clone())
        : object.material.clone();
      const material = Array.isArray(object.material) ? object.material[0] : object.material;

      const id = this._structureIdFor(object);
      object.userData.structureId = id;
      const layer = forceLayer || classifyLayer(id, this.muscleIndex);
      object.userData.layer = layer;
      // Kept because retune() has to recompute this mesh's colour later, and
      // by then the material has been cloned and its name is no longer a
      // reliable record of which Z-Anatomy surface slot it came from.
      object.userData.materialName = materialName;
      object.userData.baseColor = this._baseColorFor(layer, id, materialName);
      if (material?.color) material.color.setHex(object.userData.baseColor);
      // All 22 Z-Anatomy materials used to export with emissiveFactor [1,1,1]
      // — full-white, unlit, ADDITIVE on top of everything else, i.e. glow
      // that no amount of scene-light or material.color tuning can override.
      // Found 2026-07-31 chasing why a bone-colour change wasn't landing; it
      // came from Z-Anatomy's own shader node groups, which the glTF exporter
      // can't interpret, and not from anything we wrote (the 130 BodyParts3D
      // muscle materials were always clean).
      //
      // The export now strips it at source (2026-08-01), so this line is no
      // longer doing any work on the shipping model. Kept anyway: the app
      // drives appearance entirely from material.color and scene lights, so
      // nothing should ever emit its own light regardless of what a future
      // export or a hand-supplied .glb happens to carry.
      if (material?.emissive) material.emissive.setRGB(0, 0, 0);
      // Finish is now per tissue rather than one value for everything
      // (2026-08-01). Fully matte leaves zero specular response, which
      // flattens exactly the relief that tells one muscle belly from the next;
      // muscle therefore gets a distinctly glossier finish than bone, which
      // stays matte because dry bone is. See RENDER in config.js.
      this._applyFinish(object);
      this.populatedLayers.add(layer);
      this.selectable.push(object);
      added.push(id);
    });

    this._applyVisibility();
    // retune() rather than _applyMaterialState(): it recomputes colour, finish
    // and attachment tint from current settings, so a model loaded after the
    // tuning has been changed arrives looking like everything already in the
    // scene instead of at config defaults.
    this.retune();
    return added;
  }

  /**
   * Which structure a mesh belongs to.
   *
   * A mesh's own name is not dependable. three.js only keeps the glTF NODE
   * name when a mesh has exactly one material slot; with more than one it
   * builds a Group holding the node name and gives every child the Blender
   * mesh-datablock name instead. Those datablocks were never renamed when the
   * objects were, so they are still `Parietal_bone.r` (sanitised by the loader
   * to `Parietal_boner`) and the raw BodyParts3D ids like `FJ1478`.
   *
   * 241 of skeleton_v2.glb's 365 structures are multi-slot, because Z-Anatomy
   * models sutures, cartilage and dentine as separate materials. So before
   * this walk existed, 550 of the app's 674 meshes carried a name that matched
   * nothing: 231 of 238 bones were completely untappable, and 10 multi-part
   * muscles fell through classifyLayer()'s default into the skeleton layer,
   * rendering bone-coloured and ignoring the muscle toggle. Found 2026-08-01.
   *
   * Walking to the nearest ancestor that names real content is also just the
   * correct reading of glTF: the NODE is the structure, and primitives are an
   * implementation detail of how its surface is split across materials. That
   * makes this the right behaviour even after the .blend's mesh datablocks are
   * renamed to match their objects — it stops being load-bearing, not wrong.
   */
  _structureIdFor(object) {
    for (let node = object; node && !node.isScene; node = node.parent) {
      if (node.name && resolvesToContent(node.name, this.muscleIndex)) return node.name;
    }
    return object.name || 'structure';
  }

  /**
   * The colour a mesh should render at before any selection/x-ray state is
   * applied. Muscles are coloured per anatomical section (see
   * MUSCLE_SECTION_COLORS in config.js) so neighbouring muscles don't blend
   * into one flat red mass; everything else uses its layer's colour. This
   * overrides whatever flat colour the exporter baked into the .glb — config.js
   * is the single place colours are controlled, per its own header comment.
   *
   * Bone is the one exception to "one colour per layer": the .glb's material
   * name says whether a given slot is bone, suture, articular cartilage or
   * enamel, so that gets honoured (BONE_SURFACE_COLORS in config.js). This is
   * what makes sutures legible without screen-space ambient occlusion — see
   * the note on BONE_SURFACE_COLORS.
   */
  _baseColorFor(layer, id, materialName = '') {
    if (layer === 'muscle') {
      const record = this.muscleIndex && findMuscleRecord(this.muscleIndex, id);
      const section = record?.record?.section;
      const base = (section && MUSCLE_SECTION_COLORS[section]) ?? COLORS.muscle;
      // Keyed on the RECORD's name, not the mesh id, so a left and right
      // Soleus get the same shade rather than drifting apart.
      const key = record?.record?.name ?? id;
      return varyLightness(base, key, this.tuning.shadeVariance);
    }
    if (layer === 'skeleton') {
      // tuning.boneSurfaces off === the pre-2026-08-01 behaviour, where every
      // slot was flattened to one bone colour. That is what the suture change
      // is being compared against, so it has to be reachable exactly.
      if (!this.tuning.boneSurfaces) return COLORS.bone;
      const surface = boneSurfaceKey(materialName);
      const hex = BONE_SURFACE_COLORS[surface];
      if (hex == null) return COLORS.bone;
      return surface === 'suture' ? scaleChannels(hex, this.tuning.sutureTone) : hex;
    }
    const layerDef = LAYERS.find((l) => l.id === layer);
    return layerDef ? parseInt(layerDef.color.slice(1), 16) : COLORS.bone;
  }

  /**
   * Surface finish for one mesh, from current tuning.
   *
   * Every material slot is set, not just the first. In practice GLTFLoader
   * gives each glTF primitive its own single-material mesh, so the array case
   * does not arise on this model — but _baseColorFor above reads material[0]'s
   * name to decide what kind of surface this is, and silently finishing only
   * slot 0 while colouring from slot 0 would be a quiet inconsistency waiting
   * for a future export that does group primitives.
   */
  _applyFinish(mesh) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const isMuscle = mesh.userData.layer === 'muscle';
    const split = this.tuning.roughnessSplit;
    for (const material of materials) {
      if (!material) continue;
      if ('roughness' in material) {
        material.roughness = split
          ? (isMuscle ? RENDER.muscleRoughness : RENDER.boneRoughness)
          : RENDER.flatRoughness;
      }
      if ('metalness' in material) {
        material.metalness = split
          ? (isMuscle ? RENDER.muscleMetalness : RENDER.boneMetalness)
          : RENDER.flatMetalness;
      }
    }
  }

  /**
   * Change appearance settings and repaint everything already in the scene,
   * without reloading the model. Merges the given keys into this.tuning and
   * returns the result.
   *
   * This exists because three appearance decisions were shipped on 2026-08-01
   * having only been reasoned about — and the previous attempt to judge that
   * class of change cost most of a session to "I changed a number, does it look
   * different now?" (see the 2026-07-31 debugging note in CLAUDE.md). Being
   * able to flip a setting and see the answer immediately is the difference
   * between a judgement call and a guess.
   */
  retune(changes = {}) {
    Object.assign(this.tuning, changes);
    for (const mesh of this.selectable) {
      const tinted = this._applyAttachmentTint(mesh);
      mesh.userData.tinted = tinted;
      // A tinted muscle takes the ATTACHMENT colour as its material colour and
      // is darkened back to its own section colour by vertex colours — vertex
      // colours multiply, so they can only darken, which is why the pale end
      // has to be the base rather than the target.
      mesh.userData.baseColor = tinted
        ? COLORS.attachment
        : this._baseColorFor(
            mesh.userData.layer,
            mesh.userData.structureId,
            mesh.userData.materialName || ''
          );
      this._applyFinish(mesh);
    }
    this._applyMaterialState();
    return { ...this.tuning };
  }

  /**
   * Write (or clear) the per-vertex attachment gradient for one mesh.
   * Returns true if the mesh ended up tinted.
   *
   * The axial parameter is computed once per mesh and cached, because it only
   * depends on geometry — dragging the strength or span slider rebuilds the
   * colour buffer from the cache rather than re-deriving the axis, which is
   * what keeps the slider usable across 253 muscle meshes.
   */
  _applyAttachmentTint(mesh) {
    const strength = this.tuning.attachmentTint;
    const wanted = mesh.userData.layer === 'muscle' && strength > 0;
    const geometry = mesh.geometry;
    const position = geometry?.getAttribute?.('position');

    if (!wanted || !position || position.itemSize !== 3) {
      if (geometry?.getAttribute?.('color')) geometry.deleteAttribute('color');
      return false;
    }

    let axial = mesh.userData.axialT;
    if (!axial || axial.length !== position.count) {
      axial = axialParameter(position.array);
      mesh.userData.axialT = axial;
      mesh.userData.axialTaper = undefined;
    }

    // The taper gate. A muscle that does not narrow into the end being paled
    // has nothing for that pale to be the tendon of, and reads as a bleached
    // patch instead — 47 of 126 muscles, measured 2026-08-31. Cached alongside
    // the axial parameter and invalidated with it, since both depend only on
    // geometry; the span it is measured over is the shipped one, so that
    // dragging the span slider cannot change which muscles are eligible
    // mid-comparison.
    if (mesh.userData.axialTaper === undefined) {
      mesh.userData.axialTaper = axialTaper(position.array, axial, RENDER.attachmentSpan);
    }
    if (mesh.userData.axialTaper > this.tuning.attachmentTaperMax) {
      if (geometry.getAttribute('color')) geometry.deleteAttribute('color');
      return false;
    }

    // The belly multiplier is the ratio of the two colours in LINEAR space, not
    // sRGB: three.js converts material.color from sRGB but takes vertex colours
    // as linear already, so an sRGB ratio here would land the belly visibly off
    // its section colour. THREE.Color does the conversion for us.
    this._tintEnd.setHex(COLORS.attachment);
    this._tintBelly.setHex(
      this._baseColorFor(mesh.userData.layer, mesh.userData.structureId, '')
    );
    const ratio = [
      Math.min(1, this._tintEnd.r > 0 ? this._tintBelly.r / this._tintEnd.r : 1),
      Math.min(1, this._tintEnd.g > 0 ? this._tintBelly.g / this._tintEnd.g : 1),
      Math.min(1, this._tintEnd.b > 0 ? this._tintBelly.b / this._tintEnd.b : 1),
    ];

    let attribute = geometry.getAttribute('color');
    if (!attribute || attribute.count !== position.count) {
      attribute = new THREE.BufferAttribute(new Float32Array(position.count * 3), 3);
      geometry.setAttribute('color', attribute);
    }

    const array = attribute.array;
    const span = this.tuning.attachmentSpan;
    for (let i = 0; i < axial.length; i++) {
      const w = attachmentWeight(axial[i], span) * strength;
      array[i * 3] = ratio[0] + (1 - ratio[0]) * w;
      array[i * 3 + 1] = ratio[1] + (1 - ratio[1]) * w;
      array[i * 3 + 2] = ratio[2] + (1 - ratio[2]) * w;
    }
    attribute.needsUpdate = true;
    return true;
  }

  _applyVisibility() {
    // Muscle isolation (2026-10-16): a muscle selection hides every other
    // muscle. Decided per mesh by hiddenByIsolation() in anatomy.js.
    const selectionHasMuscle = this.selectable.some(
      (m) => m.userData.layer === 'muscle' && this.selectedIds.has(m.userData.structureId));
    for (const mesh of this.selectable) {
      const layerOn = this.layerVisibility[mesh.userData.layer] !== false;
      const peeled = mesh.userData.layer === 'muscle'
        && isPeeled(mesh.userData.structureId, this.layerMap, this.peelDepth, PEEL.side);
      const isolated = hiddenByIsolation(
        mesh.userData.layer, this.selectedIds.has(mesh.userData.structureId), selectionHasMuscle);
      mesh.visible = layerOn && !peeled && !isolated;
    }
  }

  /** Install the measured layers (Map from parseLayerMap). */
  setLayerMap(map) {
    this.layerMap = map || null;
    this._applyVisibility();
  }

  /** 0 = off; n >= 2 = on the peeled side, hide muscles shallower than n. */
  setPeelDepth(depth) {
    this.peelDepth = Number.isInteger(depth) && depth >= 2 ? depth : 0;
    this._applyVisibility();
  }

  setLayerVisible(layerId, visible) {
    this.layerVisibility[layerId] = visible;
    this._applyVisibility();
  }

  hasLayer(layerId) {
    return this.populatedLayers.has(layerId);
  }

  /**
   * Highlight a structure by id, or pass null/undefined to clear the current
   * selection. Structures can span several meshes (a left and right pair
   * share an id in some exports), so every matching mesh is recoloured, not
   * just the one that was tapped.
   *
   * Also dims every other visible structure (see RENDER.dimOpacity in
   * config.js) so a deep muscle selected under bone is actually visible —
   * added 2026-07-31, see Next Up in CLAUDE.md.
   */
  select(id) {
    this.selectedId = id || null;
    this.selectedIds = selectionGroup(this.selectedId, this.structureIds(), this.bilateral, this._aliases());
    this._applyVisibility();
    this._applyMaterialState();
    return this.selectedIds;
  }

  /**
   * Bilateral (both sides) or unilateral (the side tapped) selection, added
   * 2026-10-09 at Jake's request: both are useful, so it is a user toggle
   * rather than a decision. Re-applies the current selection so flipping the
   * switch updates what is lit without a second tap.
   */
  setBilateral(enabled) {
    this.bilateral = Boolean(enabled);
    return this.select(this.selectedId);
  }

  /**
   * Toggle x-ray mode: the skeleton layer fades so the muscle layer shows
   * through bone at all times, not only on selection. Wires up the `xray`
   * flag the old wireframe carried but never used.
   */
  setXray(enabled) {
    this._xray = Boolean(enabled);
    this._applyMaterialState();
  }

  /** Recompute colour + opacity for every mesh from current selection/x-ray state. */
  _applyMaterialState() {
    for (const mesh of this.selectable) {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!material) continue;
      const isSelected = this.selectedIds.has(mesh.userData.structureId);
      material.color.setHex(isSelected ? COLORS.selected : mesh.userData.baseColor);

      // Vertex colours multiply the material colour, so a selected muscle would
      // get its cyan highlight modulated by the belly ratio — a highlight that
      // changes colour along its own length reads as a glitch, not as anatomy.
      // Switching them off for the selection avoids that. Writing this flag
      // recompiles the shader, so it is only written when it actually changes:
      // at most two meshes per selection rather than all 807.
      const wantVertexColors = Boolean(mesh.userData.tinted) && !isSelected;
      if (material.vertexColors !== wantVertexColors) {
        material.vertexColors = wantVertexColors;
        material.needsUpdate = true;
      }

      const opacity = this._opacityFor(mesh, isSelected);
      const wantTransparent = opacity < 1;
      // Flipping `transparent` MUST force a shader rebuild (fixed 2026-10-14,
      // "X-ray off leaves half the skeleton see-through"). three.js does not
      // treat `transparent` as a reason to recompile, and while a
      // double-sided material is transparent it draws it in two passes,
      // leaving the shader compiled for FrontSide only. Back to opaque, that
      // stale shader kept rendering the body's left-side bones - whose
      // triangles face the other way - dark and see-through.
      if (material.transparent !== wantTransparent) {
        material.transparent = wantTransparent;
        material.needsUpdate = true;
      }
      material.opacity = opacity;
      // Disabling depth-write on transparent meshes lets structures behind
      // them draw normally instead of being occluded by a mostly-invisible
      // surface — the standard "see-through shell" technique, needed most for
      // x-ray mode where the whole skeleton is the shell.
      material.depthWrite = opacity >= 1;
    }
  }

  _opacityFor(mesh, isSelected) {
    if (isSelected) return 1;
    const dimmed = this.selectedIds.size > 0;
    const xrayed = this._xray && mesh.userData.layer === 'skeleton';
    if (dimmed && xrayed) return Math.min(RENDER.dimOpacity, RENDER.xrayOpacity);
    if (dimmed) return RENDER.dimOpacity;
    if (xrayed) return RENDER.xrayOpacity;
    return 1;
  }

  /**
   * What stands between a structure and the screen (2026-10-15, team review
   * P0). Search used to call focus() on a muscle while the Muscle layer was
   * off, find no VISIBLE mesh, and claim "no mesh". This reports, for the
   * structure's meshes: whether any exist at all, which layers they are on,
   * and the shallowest measured layer among those Deep view is hiding - so
   * the caller can turn the right layer on and step Deep view back only as
   * far as needed.
   */
  revealInfo(id) {
    const group = selectionGroup(id, this.structureIds(), this.bilateral, this._aliases());
    const meshes = this.selectable.filter((m) => group.has(m.userData.structureId));
    const layers = new Set(meshes.map((m) => m.userData.layer));
    let peeledLayer = null;
    for (const m of meshes) {
      if (m.userData.layer !== 'muscle') continue;
      if (!isPeeled(m.userData.structureId, this.layerMap, this.peelDepth, PEEL.side)) continue;
      const layer = this.layerMap?.get(m.userData.structureId) ?? 1;
      peeledLayer = peeledLayer === null ? layer : Math.min(peeledLayer, layer);
    }
    return { exists: meshes.length > 0, layers, peeledLayer };
  }

  /** Frame a structure: move the orbit target to it and pull the camera in. */
  focus(id) {
    const group = selectionGroup(id, this.structureIds(), this.bilateral, this._aliases());
    const meshes = this.selectable.filter((m) => group.has(m.userData.structureId) && m.visible);
    if (!meshes.length) return false;
    const box = new THREE.Box3();
    for (const mesh of meshes) box.expandByObject(mesh);
    if (box.isEmpty()) return false;
    const size = box.getSize(new THREE.Vector3());
    this.controls.target.copy(box.getCenter(new THREE.Vector3()));
    // Usual framing, or further out if the open card leaves too little room
    // (2026-10-16): fit to the area the card's TARGET inset leaves visible.
    const fit = fitDistance(size, this.camera.fov, window.innerWidth, window.innerHeight, this._insetTarget || {});
    this.controls.radius = Math.min(
      Math.max(Math.max(size.x, size.y, size.z) * 3.2, fit, 1.6),
      12
    );
    this.controls.update();
    return true;
  }

  /** Put the camera back to its starting framing after panning/orbiting away. */
  resetView() {
    this.controls.reset();
  }

  /** Database-name -> scene ids, rebuilt only when the scene's mesh count changes. */
  _aliases() {
    if (!this._aliasCache || this._aliasCache.count !== this.selectable.length) {
      this._aliasCache = { count: this.selectable.length, map: recordAliases(this.structureIds(), this.muscleIndex) };
    }
    return this._aliasCache.map;
  }

  /** Every structure id currently in the scene, de-duplicated. */
  structureIds() {
    return [...new Set(this.selectable.map((m) => m.userData.structureId))];
  }
}

export { PATHS };
