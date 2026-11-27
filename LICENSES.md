# Skeleton Model — Licenses and Credits

*Written 2026-10-08, when the release decision was made: **publish free, comply
with share-alike.** No license in this project charges a fee. Updated 2026-10-09:
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

- License: [CC BY-SA 2.1 JP](https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en)
- Source: <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html>
- Used for: the muscle meshes, and (through Z-Anatomy) most bone meshes.
- CC BY-SA 2.x allows adaptations to be released under a later version with the
  same license elements, which is how the combined model can be CC BY-SA 4.0.
  Z-Anatomy relicensed its BodyParts3D-derived files the same way.

### 1.2 Z-Anatomy

Requested attribution, from the license text inside Z-Anatomy's `Startup.blend`:

> "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan"
> mixed and modified by 'Z-anatomy.com'

- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
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
  before the license stamp; the stamp refuses to run if any of the six still
  carries the Dundee mesh. The node names were kept so the app is unchanged.
- **The master `.blend` still contains the Dundee objects.** They never ship: every
  export passes through the swap. Replace them in the `.blend` the next time
  Blender is open, so the master and the shipped file agree.
- The pre-swap model is kept as `(C) skeleton_v2_backup_2026-10-09_dundee-ossicles.glb`
  for reference only. **Do not ship it.**

### 1.4 Changes made for this app

All meshes were rescaled and repositioned into one coordinate frame, decimated,
renamed, re-materialed (emissive removed, surface colors from material slots),
and converted to glTF. Muscles were mirrored about the sagittal plane to make
left and right sides. Some BodyParts3D foot muscles (2026-08-01) and the 24 wrist and
hand muscles (2026-10-14) were replaced by Z-Anatomy equivalents, so they sit on
the Z-Anatomy skeleton; both sources are CC BY-SA, so this changes no license
terms. CC 4.0 licenses require that modifications be indicated; this
section and the Credits screen do that.

### 1.5 Bony-landmark positions — `data/landmarks.json` (added 2026-11-04)

The 3D positions of the bony landmarks used in Study were taken from
Z-Anatomy's own landmark labels (the end of each label's pointer line on the
bone surface), transformed into the app's model frame and matched to the
landmark names on the bone cards by
`03 Testing & Review/(C) landmarks_2026-11-04/(C) extract_landmarks.py`.
That makes the file an adaptation of Z-Anatomy, so it is licensed
**CC BY-SA 4.0**, like the model, and is listed as a third-party component in
the site LICENSE. Changes: positions transformed and mirrored to the left
side; the two femoral supracondylar labels, which Z-Anatomy has swapped, were
corrected. Landmark names are standard anatomical terms.

### 1.6 Detailed atlas and axis — `(C) detail_atlas_axis.glb` (added 2026-11-19)

Used only in landmark Study rounds on the atlas-and-axis card, in place of the
main model's two bones.

> "Atlas and Axis" by Dr. Petar Valchanov, segmented from a CT scan, published on
> Sketchfab (sketchfab.com/3d-models/101d81bcb3d549a99eee6ef922088b01), licensed
> **CC BY 4.0** (creativecommons.org/licenses/by/4.0/). anatomytool.org credits
> Leiden University Medical Center for Dr. Valchanov's models.

Licence checked on the model page on 2026-11-19 (it reads "CC Attribution");
Sketchfab's terms leave free downloads to the Creative Commons licence. CC BY
allows commercial use with credit and has no share-alike, so this file does not
change the paid-app position. Changes: scaled to 92% and placed to fit this
model's skeleton (one transform for both bones, no mirroring), reduced to
12,000 triangles per bone, renamed (`Atlas_C1_ZA`, `Axis_C2_ZA`). The credit is
also written into the file (`asset.copyright`). The landmark areas drawn on it
(`data/landmark_regions.json`, which lists its vertices) are part of the same
adaptation. Built by `01 3D Model/(C) build_detail_atlas_axis.py`.

### 1.7 Detailed clavicle and scapula — `(C) detail_clavicle.glb`, `(C) detail_scapula.glb` (added 2026-11-25)

Used only in landmark Study rounds on the clavicle card, in place of the main
model's right clavicle.

> "Shoulders" by Dr. Petar Valchanov, segmented from a CT scan, published on
> Sketchfab (sketchfab.com/3d-models/538eb8046ae243bb871713f1a0dd0d2c), licensed
> **CC BY 4.0** (creativecommons.org/licenses/by/4.0/).

Licence read from Sketchfab's public model record on 2026-11-25 ("CC
Attribution", downloadable, no restricting tags). CC BY allows commercial use
with credit and has no share-alike. Changes: the right clavicle taken out of the
scan (one of its 23 bones), placed to fit this model's skeleton (scale 99.6%,
no mirroring), reduced to 12,000 triangles, renamed `Clavicle_r_ZA`; the credit
is written into the file. The landmark areas on it (in
`data/landmark_regions.json`) are part of the same adaptation. Built by
`01 3D Model/(C) build_detail_card.py`.

**Scapula** (`(C) detail_scapula.glb`, added 2026-11-25, same scan and licence):
the right scapula, placed with the clavicle's transform and refined (scale
99.6%, no mirroring), reduced to 12,000 triangles, renamed `Scapula_r_ZA`.
(The scan's other scapula is a copy of the right, not a true left; only the
right is used.) Valchanov's "Thorax" and "Foot" models (same licence, checked the same
day) are downloaded for later cards.

### 1.8 Detailed femur — `(C) detail_femur.glb` (added 2026-11-25)

Used only in landmark Study rounds on the femur card, in place of the main
model's right femur.

> "Human femur" by SquareL, NIH 3D Print Exchange entry 3DPX-000168 (3d.nih.gov), a CT
> scan, dedicated to the **public domain (CC0 1.0)**.

Licence read on the entry page on 2026-11-19 ("Public Domain, CC0 1.0"). CC0
asks nothing - no credit, no share-alike - so it does not change the paid-app
position; it is credited anyway. Changes: the scan is a LEFT femur, mirrored
to serve as the right (unmirrored it fits our right femur badly - landmarks 9
mm off, the head 38 mm; mirrored 4 mm), placed to fit this model's skeleton
(scale 97.5%), reduced to 12,000 triangles, renamed `Femur_r_ZA`; the
public-domain notice is written into the file. Built by
`01 3D Model/(C) build_detail_card.py`. (Title corrected 2026-11-27 from
"SquareL femur" to the entry's own title, "Human femur", created by SquareL;
read on the entry page that day. Geometry unchanged.)

### 1.9 Detailed patella — `(C) detail_patella.glb` (added 2026-11-27)

Used only in landmark Study rounds on the patella card, in place of the main
model's right patella.

> "Human patella" by SquareL, NIH 3D Print Exchange entry 3DPX-000170
> (3d.nih.gov), "segmentation of a human patella based on a CT scan of a full
> leg" (the same leg as the femur), dedicated to the **public domain (CC0 1.0)**.

Licence read on the entry page on 2026-11-27 ("Public Domain", CC0 1.0). Like
the femur it asks nothing and is credited as a courtesy. Changes: the scan is a
LEFT patella, mirrored to serve as the right (mirrored it fits our right
patella better - surface 0.8/1.0 mm vs 1.1/1.6 mm - and only mirrored is the
lateral facet the larger, as it must be), placed to fit this model's skeleton
(scale 92.3%), smoothed with 10 Taubin passes to remove CT slice steps (Jake's
choice on renders; volume restored; surface moves 0.6 mm on average), not
reduced (3,436 triangles), renamed `Patella_r_ZA`; the public-domain notice is
written into the file. Built by `01 3D Model/(C) build_detail_card.py`.

### 1.10 Detailed tibia and fibula — `(C) detail_tibia.glb`, `(C) detail_fibula.glb` (added 2026-11-27)

Used only in landmark Study rounds on the tibia and fibula cards, in place of
the main model's right tibia and fibula.

> "Human tibia and fibula" by SquareL, NIH 3D Print Exchange entry 3DPX-000169
> (3d.nih.gov), from the same CT scan of a full leg as the femur and patella,
> dedicated to the **public domain (CC0 1.0)**.

Licence read on the entry page on 2026-11-27 ("Public Domain", CC0 1.0 Universal;
"segmentation of a full human tibia and fibula based on a CT scan of a full leg",
matching the femur and patella). CC0 asks nothing; credited as a courtesy.
Changes: the scan is one surface with the two bones joined at both
tibiofibular joints; separated by `01 3D Model/(C) split_tibia_fibula_2026-11-27.py`
(voxel watershed at the narrowest neck of each joint), a LEFT leg mirrored to
serve as the right (mirrored it fits better and the medial malleolus and the
fibula fall on the correct sides), each bone placed to fit this model's skeleton
(scale 92.7% / 94.0%), lightly smoothed (0.75 mm blur of the solid, Jake's choice
on renders), reduced to about 12,000 triangles with MeshLab's topology-preserving
reduction, renamed `Tibia_r_ZA` / `Fibula_r_ZA`; the public-domain notice is
written into each file. Built by `01 3D Model/(C) build_detail_card.py`.

---

## 2. Muscle content — `(C) muscle_database.json`

All origins, insertions, actions and nerve innervations are written in **original
wording** and checked against NIH/NCBI StatPearls articles (re-sourced
2026-09-16; each entry cites its sources by NBK number in `notes`), and against
university medical-school anatomy tables and atlases (TTUHSC, University of
Washington). Two further university sources were dropped on 2026-11-04 because
their terms limit use to personal or non-commercial purposes. Those
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
  Releasing the code under an open license too is an option, not an obligation.

---

## 4. Obligations checklist for any release

- [x] Credits screen in the app with full attribution (Credits button, top bar)
- [x] Short attribution on every content card, pointing to Credits
- [x] License and attribution written inside the shipped `.glb`
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
