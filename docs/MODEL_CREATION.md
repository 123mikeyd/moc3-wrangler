# Creating Live2D Models — The Hard Truth
# How to go from image → rigged .moc3 model
# April 14, 2026

---

## THE FUNDAMENTAL PROBLEM

**There is NO open-source tool that can create .moc3 files.**

The .moc3 format is proprietary binary. Cubism Core (the Emscripten-compiled
C library) is the ONLY software that can write it. And Cubism Core is locked
behind Live2D's EULA, which prohibits:
- Using it in competing software
- Reverse engineering the format
- Creating alternative .moc3 writers

**This means: if you want a .moc3 file, you MUST use Live2D Cubism Editor.**

---

## HOW THE INDUSTRY ACTUALLY DOES IT

### The Professional Workflow (Cubism Editor PRO)

```
1. ARTIST draws character in Photoshop/Clip Studio
   └─ Layers: one per body part (face, hair, eyes, body, arms, etc.)
   └─ IMPORTANT: parts must be separated, not merged
   └─ Extends beyond borders (for deformation headroom)

2. PSD IMPORT into Cubism Editor
   └─ Each PSD layer → one ArtMesh
   └─ Editor auto-generates UV mapping
   └─ Editor auto-generates initial mesh (point density setting)

3. AUTO-GENERATE MESHES
   └─ Ctrl+Shift+A → Automatic Mesh Generator
   └─ Settings: dot interval (outside/inside), boundary margin, alpha threshold
   └─ Creates triangle mesh for each ArtMesh
   └─ Mesh density = deformation quality (more points = smoother but slower)

4. AUTO-GENERATE DEFORMERS (AI-assisted, PRO only)
   └─ [Modeling] → [Deformer] → [Auto Generation of Deformer]
   └─ AI identifies body parts from image
   └─ Creates hierarchy: Part → Deformer → ArtMesh
   └─ Standard human template: head, body, arms, legs
   └─ User can manually reassign misidentified parts

5. MANUAL RIGGING (the labor-intensive part)
   └─ Create parameters (PARAM_ANGLE_X, PARAM_EYE_L_OPEN, etc.)
   └─ For each parameter:
     └─ Set key values (e.g., -30, 0, +30 for head rotation)
     └─ At each key value, deform the mesh manually
     └─ Move vertices to show the deformation
     └─ This is where the "art" happens — hundreds of keyforms
   └─ Set clipping masks (eyelids clip to face, etc.)
   └─ Set draw order (what renders on top)
   └─ Configure arm layer switching (pose3.json)

6. ADD PHYSICS
   └─ Configure hair/cloth bounce
   └─ Spring-pendulum chains
   └─ Link to head angle parameters

7. EXPORT .moc3
   └─ Binary format, only Cubism Editor can write it
   └─ Also exports: .model3.json, .physics3.json, .cdi3.json
```

### Time Investment
- **Simple model (head only, few expressions):** 4-8 hours
- **Full-body VTuber (20+ parameters):** 20-40 hours
- **Commercial quality (50+ parameters, physics, expressions):** 80-200 hours
- **Professional rigger rate:** $500-5000+ per model

### Cost
- **Cubism Editor FREE:** Limited features, no auto-deformer generation
- **Cubism Editor PRO:** $199/year (subscription) or $1,500 one-time (old pricing)
- **Commission a rigger:** $200-5,000+ depending on quality

---

## WHAT THE CUBISM EDITOR ACTUALLY DOES

When you click "Export .moc3", the editor:

1. Takes all your ArtMeshes (with their meshes)
2. Takes all your deformers (with their hierarchies)
3. Takes all your parameters and keyforms
4. Serializes EVERYTHING into the binary .moc3 format
5. Writes the .cdi3.json (display names for parameters)
6. Writes the .model3.json (file references)

The .moc3 contains:
- Canvas info (dimensions, pixels per unit)
- Part hierarchy (parent-child relationships)
- Deformer hierarchies (warp + rotation)
- ArtMesh definitions (vertices, UVs, triangle indices)
- Parameter definitions (min/max/default)
- Keyform data (vertex positions at each key value)
- Draw order groups
- Drawable masks (clipping)
- Glue constraints (for V5.0+)

---

## ALTERNATIVE APPROACHES

### 1. Inochi2D (Fully Open Source)

**What it is:** An open-source 2D puppet animation framework with its own
creation tool (Inochi2D Creator) and its own format (.inp).

**Format:** .inp — JSON payload + texture blobs, Big Endian, well-documented.

**Capabilities:**
- Import PSD layers as separate meshes
- Auto-generate mesh deformation
- Manual vertex deformation
- Parameter binding
- Physics simulation
- Export to .inp format

**Limitations:**
- NOT compatible with .moc3 — uses its own format
- Smaller ecosystem (fewer tools, fewer models)
- Less mature than Live2D (fewer features)
- Requires separate runtime (Inochi2D SDK)

**Why it matters:** Inochi2D is the ONLY fully open-source path from
"image" to "rigged 2D puppet." If we build our own pipeline, Inochi2D
is the format to target — not .moc3.

**Links:**
- https://inochi2d.com/
- https://github.com/Inochi2D/inochi2d (SDK, D language)
- https://github.com/nicokoziel/Inochi2D-Creator (rigging tool)

### 2. Cubism Editor FREE

**What it is:** The free version of Live2D's official editor.

**Can do:**
- Import PSD
- Generate meshes
- Manual rigging
- Export .moc3
- Basic physics

**Cannot do (PRO only):**
- Auto Generation of Deformer (AI-assisted)
- Extended interpolation
- Blend shapes
- Some advanced features

**Cost:** Free (with registration)

### 3. Live2D Material Separation Photoshop Plugin

**What it is:** A Photoshop plugin that helps prepare PSD files for Live2D.

**Does:**
- Semi-automatic cutting of body parts
- Color filling of gaps
- Transparency filling

**Does NOT:**
- Generate meshes
- Create deformers
- Rig parameters

### 4. Build Your Own Pipeline (Our Approach)

**Concept:** Instead of creating .moc3 files (which we can't), we work
WITH existing .moc3 models:

```
What we CAN modify:
  ✅ Textures (recolor, repaint, add accessories)
  ✅ Parameters (set values, create motions)
  ✅ Physics (edit physics3.json)
  ✅ Expressions (create exp3.json)
  ✅ Motion files (create motion3.json with any deformation)
  ✅ Part opacity (show/hide layers)
  ✅ Draw order (via model3.json)

What we CANNOT modify:
  ❌ Mesh topology (triangle count, vertex positions in rest pose)
  ❌ Deformer hierarchy
  ❌ Parameter definitions (min/max/IDs)
  ❌ New parameters
  ❌ New ArtMeshes
```

**The insight:** We don't need to create .moc3 files. We need:
1. A LIBRARY of diverse base models (different body types, poses, styles)
2. A TEXTURE pipeline (retexture any base model to look like any character)
3. A MOTION pipeline (generate animations from natural language)
4. A PHYSICS tuning tool (adjust bounce/spring for different hair/clothing)

This approach works within the constraints of the proprietary format.

---

## AI-ASSISTED RIGGING (EMERGING)

### What Exists (2026)
- **Live2D's own auto-deformer:** AI identifies body parts from image data
  trained on nizima submissions. PRO only.
- **No third-party AI Live2D riggers** as of April 2026.

### What Could Be Built
1. **AI mesh generation:** Train a model to predict mesh density and vertex
   placement from an image. Output: mesh definition (not .moc3 directly).
2. **AI parameter prediction:** Given a body part and desired movement,
   predict which existing parameters to use and what values.
3. **AI texture mapping:** Given a target character image and a base model,
   automatically warp and paint the texture atlas.
4. **AI motion generation:** Given a text description, generate motion3.json
   with appropriate parameter curves.

### The Inochi2D Path
Since Inochi2D is open source, we COULD build an AI pipeline that:
1. Takes an image
2. Auto-generates mesh + parameters
3. Exports .inp files
4. Renders via Inochi2D SDK

This would be a TRUE open-source alternative to Live2D Cubism Editor.

---

## RECOMMENDED STRATEGY

### Short-term (what we're doing now)
1. Collect diverse base models (different body types, styles, formats)
2. Build texture recoloring tools (HSV-based, region-aware)
3. Build motion generation tools (motion3.json from descriptions)
4. Build the editor/pose studio for direct parameter manipulation

### Medium-term
1. Integrate Inochi2D Creator for creating NEW models
2. Build Inochi2D → Live2D parameter mapping (if possible)
3. Create a "model template" library with pre-rigged bases

### Long-term
1. AI-assisted mesh generation from images
2. AI texture painting (auto-apply character designs to base models)
3. AI motion generation (text → motion3.json)
4. Full open-source pipeline: Image → Inochi2D .inp → VTuber

---

## SUMMARY

| Approach | Creates .moc3? | Open Source? | Cost | Quality |
|----------|---------------|-------------|------|---------|
| Cubism Editor PRO | Yes | No | $199/yr | Industry standard |
| Cubism Editor FREE | Yes | No | Free | Limited |
| Inochi2D Creator | No (.inp) | Yes | Free | Growing |
| Custom pipeline | No | Yes | Free | Modifying existing models |
| AI-assisted | TBD | TBD | TBD | Experimental |

**The hard truth:** Live2D has a monopoly on .moc3 creation. The path
forward is either pay them, use Inochi2D instead, or build our own
format entirely. Our current strategy — working WITH existing models
rather than creating new ones — is the pragmatic choice.

---

*Document created April 14, 2026.*
*Source: Live2D official docs, Inochi2D docs, moc3ingbird analysis, community research.*
