# HERMES PUPPET ENGINE — Design Document
# A fully open-source 2D puppet animation system
# April 14, 2026

---

## THE VISION

Build a VTuber engine that does everything Live2D does, but open source,
with a better UI, and can load ANY format: .moc3, PSD, images, Spine JSON,
or our own format. We own the pipeline end to end.

---

## CORE CONCEPT: WHAT IS 2D PUPPET ANIMATION?

It's simpler than people think. All these systems (Live2D, Spine, DragonBones,
Inochi2D) do the same thing:

```
1. Take a 2D image
2. Cut it into pieces (layers)
3. Assign each piece a mesh (triangle grid)
4. Create bones (transform hierarchy)
5. Bind mesh vertices to bones with weights
6. Drive bones with parameters (head angle, eye open, etc.)
7. Add physics (springs for hair/cloth bounce)
8. Render from orthographic camera (looks 2D, but depth exists)
```

The "magic" is in the mesh deformation and weight painting. Everything else
is standard 3D graphics (transform matrices, textured triangles, physics).

---

## ARCHITECTURE

```
┌─────────────────────────────────────────────┐
│  HERMES PUPPET ENGINE                       │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │  LOADER  │  │ RENDERER │  │ PHYSICS   │ │
│  │          │  │          │  │ ENGINE    │ │
│  │ .moc3    │  │ Three.js │  │           │ │
│  │ PSD      │  │ Ortho    │  │ Springs   │ │
│  │ Spine    │  │ Camera   │  │ Pendulums │ │
│  │ Images   │  │ WebGL2   │  │ Gravity   │ │
│  │ INP      │  │          │  │ Collision │ │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘ │
│       │              │              │       │
│  ┌────┴──────────────┴──────────────┴─────┐ │
│  │           SCENE GRAPH                  │ │
│  │                                        │ │
│  │  Root                                  │ │
│  │   ├─ Bone (Head)                       │ │
│  │   │   ├─ Bone (Hair Front)             │ │
│  │   │   │   └─ Mesh (hair texture)       │ │
│  │   │   ├─ Bone (Eye L)                  │ │
│  │   │   │   └─ Mesh (eye texture)        │ │
│  │   │   └─ Bone (Eye R)                  │ │
│  │   │       └─ Mesh (eye texture)        │ │
│  │   ├─ Bone (Body)                       │ │
│  │   │   ├─ Mesh (body texture)           │ │
│  │   │   ├─ Bone (Arm L)                  │ │
│  │   │   │   ├─ Bone (Forearm L)          │ │
│  │   │   │   │   └─ Bone (Hand L)         │ │
│  │   │   └─ Bone (Arm R)                  │ │
│  │   │       └─ ...                       │ │
│  │   └─ Bone (Hair Back)                  │ │
│  │       └─ Mesh (hair back texture)      │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  ┌────────────────────────────────────────┐ │
│  │         PARAMETER SYSTEM               │ │
│  │                                        │ │
│  │  Param "HeadX" → Bone.Head.rotation.y  │ │
│  │  Param "EyeOpen" → Mesh.Eye.scale.y    │ │
│  │  Param "ArmAngle" → Bone.Arm.rotation  │ │
│  │  ...maps any param to any transform    │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  ┌────────────────────────────────────────┐ │
│  │         IMPORT PLUGINS                 │ │
│  │                                        │ │
│  │  Moc3Loader  → reads .moc3 via Core    │ │
│  │  PSDLoader   → reads layered PSD       │ │
│  │  SpineLoader → reads Spine JSON        │ │
│  │  ImageLoader → single image, auto-mesh │ │
│  │  INPLoader   → reads Inochi2D puppets  │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

---

## TECHNOLOGY STACK

### Rendering: Three.js + Orthographic Camera
- Three.js is the standard for WebGL
- OrthographicCamera gives the 2D look (no perspective distortion)
- Sprites/planes with custom shaders for mesh deformation
- WebGL2 for better performance

### Physics: Custom Spring System
- Simple but effective: spring-pendulum chains
- Each "bone" can have spring physics attached
- Parameters (head angle) drive the spring input
- Output: position/rotation offset applied to bone
- ~100 lines of math, not a physics engine

### UI: Same as our pose studio
- Parameter sliders
- Click-drag posing
- Animation sequencer
- But with a BONE VISUALIZER (see the skeleton)
- And a MESH EDITOR (move vertices)
- And a WEIGHT PAINTER (bone influences)

### Format: HPE (Hermes Puppet Engine) JSON
```json
{
  "version": "1.0",
  "name": "character_name",
  "canvas": { "width": 1024, "height": 1024 },
  "textures": ["body.png", "hair.png", "face.png"],
  "bones": [
    { "name": "root", "x": 512, "y": 700, "rotation": 0 },
    { "name": "head", "parent": "root", "x": 0, "y": -200, "length": 80 },
    { "name": "hair_front", "parent": "head", "x": 0, "y": -40, "length": 120,
      "physics": { "stiffness": 0.5, "damping": 0.8, "gravity": 0.3 } },
    { "name": "eye_l", "parent": "head", "x": -30, "y": 0 },
    { "name": "eye_r", "parent": "head", "x": 30, "y": 0 },
    { "name": "body", "parent": "root", "x": 0, "y": 100, "length": 200 },
    { "name": "arm_l", "parent": "body", "x": -80, "y": -50, "length": 120 },
    { "name": "forearm_l", "parent": "arm_l", "x": 0, "y": 120, "length": 100 }
  ],
  "meshes": [
    { "name": "head_mesh", "texture": 0, "bone": "head",
      "vertices": [[x,y,u,v], ...],
      "triangles": [[0,1,2], ...],
      "weights": { "head": [1.0, 1.0, ...], "hair_front": [0.0, ...] } }
  ],
  "parameters": [
    { "name": "HeadX", "min": -30, "max": 30, "default": 0,
      "drives": [
        { "bone": "head", "property": "rotation.z", "multiplier": 1.0 }
      ] },
    { "name": "HairFrontPhysics", "min": 0, "max": 1, "default": 0,
      "drives": [
        { "bone": "hair_front", "property": "rotation.z", "multiplier": 0.5 }
      ],
      "physics": { "input": "HeadX", "stiffness": 0.3, "damping": 0.85 } }
  ],
  "motions": {
    "idle": { "duration": 10, "loop": true, "curves": [...] }
  }
}
```

---

## WHAT MAKES THIS BETTER THAN LIVE2D

| Feature | Live2D | Hermes Puppet Engine |
|---------|--------|---------------------|
| Open source | No | Yes |
| Create from scratch | Cubism Editor ($$$) | Free, in browser |
| Load .moc3 | Only option | Yes (via Core) |
| Load PSD | Cubism Editor only | Yes (direct) |
| Load Spine JSON | No | Yes |
| Load any image | No | Yes (auto-mesh) |
| Bone visualizer | No (hidden) | Yes (see skeleton) |
| Mesh editor | Limited | Full vertex control |
| Weight painter | No (auto only) | Manual + auto |
| Physics tuning | Cubism Editor only | In browser |
| API/CLI | No | Yes |
| Custom shaders | No | Yes |
| Multi-format export | .moc3 only | HPE JSON + images |

---

## IMPLEMENTATION PLAN

### Phase 1: Proof of Concept (Week 1-2)
- Three.js scene with orthographic camera
- Load a PNG, auto-generate mesh (grid)
- Create 3 bones, bind mesh to bones with weights
- Drive bones with slider parameters
- Basic spring physics on one bone
- **Milestone:** A PNG head that rotates when you drag a slider,
  with hair that bounces on a spring.

### Phase 2: Import Existing Models (Week 3-4)
- MOC3 loader (reuse our Cubism integration)
- PSD loader (use ag-psd npm package)
- Image loader (auto-mesh from PNG)
- Parameter mapping (any format → our parameter system)
- **Milestone:** Load hermes_dark .moc3, render in our engine.

### Phase 3: Editor UI (Week 5-8)
- Bone hierarchy editor (create, parent, move bones)
- Mesh editor (add/remove vertices, adjust UVs)
- Weight painter (click bone, paint influence on mesh)
- Parameter editor (create params, map to bone transforms)
- Physics tuner (adjust springs, see live preview)
- Animation timeline (keyframe editor)
- **Milestone:** Create a character from scratch in the browser.

### Phase 4: Advanced Features (Week 9-12)
- Clipping masks (like Live2D's eyelid clipping)
- Blend modes (additive, multiply)
- Multiple texture atlases
- Expression system (preset face poses)
- Export to HPE JSON format
- Import from Spine JSON
- **Milestone:** Feature parity with basic Live2D.

### Phase 5: Integration (Week 13+)
- VTuber server integration (replace Live2D renderer)
- Face tracking input (webcam → parameters)
- Audio lip sync (mic → mouth parameter)
- Scene composition (multiple characters)
- Background layers with parallax
- **Milestone:** Full VTuber system, 100% open source.

---

## KEY INSIGHT: THE MESH IS JUST A TRIANGLE SOUP

Forget all the Live2D complexity. At the GPU level, EVERYTHING is:

```
Vertices:   [(x, y, u, v), ...]   ← position + texture coordinate
Triangles:  [(0, 1, 2), ...]      ← which vertices form each triangle
Textures:   [png_data, ...]        ← image data
```

A "bone" is just a transform matrix. "Weight painting" is assigning each
vertex a blend of bone matrices. "Physics" is offsetting bone transforms
based on spring math. "Parameters" is mapping input values to bone transforms.

The rendering is just: for each triangle, compute final vertex positions
(by blending bone transforms using weights), then draw the textured triangle.

This is ~500 lines of code for a basic implementation. The complexity is
in the EDITOR (mesh editing, weight painting, animation timeline), not the
renderer.

---

## EXISTING OPEN SOURCE COMPONENTS WE CAN USE

| Component | Library | License |
|-----------|---------|---------|
| WebGL rendering | Three.js | MIT |
| PSD parsing | ag-psd | MIT |
| Mesh deformation | Custom (vertex shader) | — |
| Spring physics | Custom (~100 lines) | — |
| UI framework | Existing editor (FastAPI + vanilla JS) | — |
| MOC3 loading | Our Cubism integration | Live2D OSL |
| Spine runtime | spine-runtimes (esotericsoftware) | Spine license |

---

## THE SELLING POINT

"Any image in, any format in, full control, open source, free forever."

No Cubism Editor ($199/yr). No Spine Pro ($379). No proprietary binary
formats. No EULA restrictions. Just drag an image into the browser,
rig it with bones and weights, add physics, animate it, and use it
as a VTuber. The whole pipeline in one tool.

---

## IMMEDIATE NEXT STEPS

1. Create `hermes-puppet-engine/` directory
2. Set up Three.js + orthographic camera
3. Load a PNG, auto-generate mesh grid
4. Create bone system (parent-child hierarchy)
5. Bind mesh vertices to bones
6. Add slider → bone rotation
7. Add spring physics
8. **DEMO:** PNG image that deforms when you drag sliders,
   with hair bouncing on springs

This is doable in a weekend for the proof of concept.

---

*Document created April 14, 2026.*
*This is the plan for replacing Live2D entirely.*
