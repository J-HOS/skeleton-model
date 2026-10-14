# Skeleton Model — Licences and Credits

*Written 2026-10-08, when the release decision was made: **publish free, comply
with share-alike.** No licence in this project charges a fee. Updated 2026-10-09:
the one non-commercial component (the ear ossicles) has been replaced.*

This file is the full notice. The app shows the same content on its **Credits**
screen (from `CREDITS` in `02 Development/app/src/config.js`), and the shipped
model carries it inside the file (`asset.copyright` in `(C) skeleton_v2.glb`,
written by `01 3D Model/(C) stamp_glb_licence.py`). The test suite checks that
the three agree on the parts that matter.

---

## 1. The 3D model — `(C) skeleton_v2.glb`

**The combined model is licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/),
with no exceptions** (since 2026-10-09 - see section 1.3). Anyone may copy, reuse
and modify the model under those same terms. Share-alike does not prohibit
selling the app; it requires that the model itself stays reusable under CC BY-SA.

### 1.1 BodyParts3D

Required attribution, in the licensor's own wording:

> BodyParts3D, Copyright© The Database Center for Life Science licensed by CC Attribution-Share Alike 2.1 Japan

- Licence: [CC BY-SA 2.1 JP](https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en)
- Source: <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html>
- Used for: the muscle meshes, and (through Z-Anatomy) most bone meshes.
- CC BY-SA 2.x allows adaptations to be released under a later version with the
  same licence elements, which is how the combined model can be CC BY-SA 4.0.
  Z-Anatomy relicensed its BodyParts3D-derived files the same way.

### 1.2 Z-Anatomy

Requested attribution, from the licence text inside Z-Anatomy's `Startup.blend`:

> "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan"
> mixed and modified by 'Z-anatomy.com'

- Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- Authors: Gauthier Kervyn (design, 3D, anatomy) and contributors
- Source: <https://github.com/Z-Anatomy/Models-of-human-anatomy>
- Used for: all bone meshes, several muscle meshes (latissimus dorsi, rectus
  abdominis, internal oblique, transversus abdominis, quadratus lumborum,
  multifidus, and the foot and lower-leg muscles).

### 1.3 Auditory ossicles — ORIGINAL (since 2026-10-09)

The malleus, incus and stapes (both ears, nodes `Malleus/Incus/Stapes_{r,l}_ZA`)
are original to this project, built by `01 3D Model/(C) build_ossicles.py` from
published measurements and textbook descriptions (malleus and incus r13, stapes
r16, approved by Jake 2026-10-09). No third-party mesh was used to build them.
They are part of the combined model under CC BY-SA 4.0.

- **History:** until 2026-10-09 these six nodes carried the University of Dundee /
  McGill "Anatomy of the Inner Ear" meshes (CC BY-NC-SA 4.0, included via
  Z-Anatomy) - the only non-commercial component the model ever had. They were
  replaced by `01 3D Model/(C) swap_ossicles_glb.py`, which the export script runs
  before the licence stamp; the stamp refuses to run if any of the six still
  carries the Dundee mesh. The node names were kept so the app is unchanged.
- **The master `.blend` still contains the Dundee objects.** They never ship: every
  export passes through the swap. Replace them in the `.blend` the next time
  Blender is open, so the master and the shipped file agree.
- The pre-swap model is kept as `(C) skeleton_v2_backup_2026-10-09_dundee-ossicles.glb`
  for reference only. **Do not ship it.**

### 1.4 Changes made for this app

All meshes were rescaled and repositioned into one coordinate frame, decimated,
renamed, re-materialled (emissive removed, surface colours from material slots),
and converted to glTF. Muscles were mirrored about the sagittal plane to make
left and right sides. Some BodyParts3D foot muscles were replaced by Z-Anatomy
equivalents. CC 4.0 licences require that modifications be indicated; this
section and the Credits screen do that.

---

## 2. Muscle content — `(C) muscle_database.json`

All origins, insertions, actions and nerve innervations are written in **original
wording** and verified against NIH/NCBI StatPearls articles and Kenhub (re-sourced
2026-09-16; each entry cites its sources by NBK number in `notes`), and checked
on 2026-10-09 against university medical-school anatomy tables and atlases
(UAMS/TTUHSC, University of Washington, Loyola LUMEN) and Radiopaedia. Those
sources were used for facts only; no text is reproduced from them. Facts are not
copyrightable; expression is.

History: the database was first compiled from *Anatomy & Kinesiology Flashcards*
(Human Kinetics / FMP LLC, 2013). Every entry was rewritten and re-verified on
2026-09-16, so no flashcard wording remains. The `bony_landmarks` section (landmark
names only) still comes from that deck; they are standard anatomical terms.

The app no longer credits the flashcard deck on its content cards, because that
credit described where the text came from and that is no longer true.

---

## 3. Software

- **three.js 0.160.1**, Copyright 2010-2023 Three.js Authors, [MIT License](https://github.com/mrdoob/three.js/blob/r160/LICENSE).
  The MIT notice is kept in the header of each vendored file and on the Credits screen.
- **App code** (`02 Development/app/`): © 2026 Skeleton Model. All rights reserved.
  Share-alike applies to the model, not to code that only loads and displays it.
  Releasing the code under an open licence too is an option, not an obligation.

---

## 4. Obligations checklist for any release

- [x] Credits screen in the app with full attribution (Credits button, top bar)
- [x] Short attribution on every content card, pointing to Credits
- [x] Licence and attribution written inside the shipped `.glb`
- [x] Modifications indicated
- [ ] Do not add DRM or terms that stop people reusing the model
- [x] Non-commercial ossicles replaced with original ones (2026-10-09) - the
      model no longer restricts charging for the app or showing ads
- [ ] Before charging: a short IP-lawyer review is still advisable
- [ ] Do not ship the backup `.glb`s that still contain the Dundee ossicles

*Not legal advice. Sources checked 2026-10-08: [Creative Commons FAQ](https://creativecommons.org/faq/),
[BodyParts3D README](https://dbarchive.biosciencedbc.jp/data/bodyparts3d/20110915/README_e.html),
[Z-Anatomy credits](https://github.com/Z-Anatomy/Models-of-human-anatomy),
[Dundee inner-ear model](https://anatomytool.org/node/60505).*
