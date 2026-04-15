# Cubism SDK Research Document
# Live2D Phase 2 Reference — Updated April 14, 2026

> Living document. Update as we learn more. All findings from official docs,
> reverse engineering, source code analysis, and hands-on experience.

---

## 1. THE STACK

```
YOUR APP (Hermes Editor)
     |
[CubismWebFramework]          ← TypeScript, OPEN SOURCE (~20 files)
     |                             Motion blending, physics, expressions,
     |                             eye blink, lip sync, pose switching
     |
[CubismRenderer_WebGL]        ← TypeScript, OPEN SOURCE
     |                             Draws textured triangle meshes
     |                             with masks & blend modes
     |
[Cubism Core]                 ← PROPRIETARY BINARY (live2dcubismcore.min.js)
                                  Emscripten-compiled C → JS blob (~200KB)
                                  Parses .moc3, computes vertex positions
                                  CANNOT be replaced for .moc3 files
```

### What Each Layer Does

**Cubism Core (live2dcubismcore.min.js)**
- Loads .moc3 binary → creates model in memory
- You set parameter values → call update() → Core recalculates ALL vertex
  positions for ALL drawables based on deformation keyframes in the .moc3
- Outputs: vertex positions (Float32Array), UV coords, triangle indices,
  opacity, draw order, clipping masks, blend modes
- Core does NOT render — it just computes geometry. You draw it.
- PROPRIETARY — no source, no alternative parser exists for .moc3
- Latest: Cubism 5 SDK R5 (April 2026)

**CubismWebFramework (TypeScript)**
- Open source: github.com/Live2D/CubismWebFramework
- License: Live2D Open Software License (NOT MIT/GPL — restrictions apply)
- Manages motion playback, blending, physics, expressions, eye blink, breath
- Provides CubismUserModel base class, CubismRenderer_WebGL, math utilities
- ~20 source files across 8 modules

**Our App (editor.html → editor.ts)**
- Creates WebGL canvas, loads Core + Framework
- Subclasses CubismUserModel for custom update pipeline
- Owns the UI: sliders, timeline, texture painter
- Talks to editor_backend.py for file I/O

---

## 2. CubismWebFramework MODULES

Source: github.com/Live2D/CubismWebFramework/tree/develop/src

| Module | Files | Purpose |
|--------|-------|---------|
| effect/ | CubismEyeBlink, CubismBreath, CubismLook | Procedural animations (blink, breath, gaze) |
| id/ | CubismId, CubismIdManager | String interning for parameter/part/drawable IDs |
| math/ | CubismMatrix44, CubismVector2, etc. | Matrix math, easing, bezier solver |
| model/ | CubismMoc, CubismModel, CubismUserModel | Model loading, parameter access, vertex update |
| motion/ | CubismMotion, CubismMotionManager, CubismExpressionMotion | Motion playback, priority queue, expression layering |
| physics/ | CubismPhysics | Spring pendulum particle chains (hair/cloth bounce) |
| rendering/ | CubismRenderer, CubismRenderer_WebGL, shaders | WebGL drawing, clipping masks, blend modes |
| type/ | Common type definitions | csmVector, csmMap, etc. |
| utils/ | CubismDebug, csmString | Logging, memory helpers |

### Key Framework Files (Root)

| File | Purpose |
|------|---------|
| live2dcubismframework.ts | Main entry point — startUp(), initialize(), dispose() |
| cubismmodelsettingjson.ts | Parses .model3.json for asset paths |
| icubismmodelsetting.ts | Interface for model settings |
| cubismdefaultparameterid.ts | Standard param IDs (EyeBlink, Breath, etc.) |
| cubismframeworkconfig.ts | Logging levels, config |

---

## 3. THE .moc3 FILE FORMAT

### What We Know

- Binary format — raw dump of C arrays and structs
- NOT documented publicly, NOT human-readable
- Parsed ONLY by Cubism Core (live2dcubismcore.min.js)
- Contains: mesh geometry, parameter definitions, deformation keyframes,
  draw order, clipping mask definitions, blend modes, part hierarchy

### Structure (from reverse engineering)

```
Offset 0x00: Header
  - Magic: "MOC3" (4 bytes)
  - Version: uint32
  - Endianness flag: uint32

After header: Section Offset Table
  - Array of (section_id, offset) pairs
  - Cubism Core adds offsets to base address to locate data sections
  - NO bounds checking (CVE-2023-27566 — moc3ingbird exploit)

Sections (order may vary):
  - Parameters: names, min/max/default values, count
  - Parts: names, parent hierarchy, opacity defaults
  - Drawables: vertex positions, UV coords, triangle indices,
    draw order, opacity, blend mode, clipping mask refs
  - Deformation: interpolation data between parameter keyframes
  - (unknown sections may exist)
```

### Count Info Table
- Defines array sizes (how many parameters, parts, drawables)
- NOT validated by Cubism Core — attacker can claim huge counts
  to cause out-of-bounds reads (CVE-2023-27566)

### Security Issues (CVE-2023-27566)
- Cubism Core performs NO bounds checking on section offsets
- Malicious .moc3 can read/write memory within ~2 GiB of model data
- Proof of concept: openl2d/moc3ingbird — crashes any app loading it
- May enable arbitrary code execution depending on memory layout
- Implications: NEVER load untrusted .moc3 files

### .moc3 Is Inescapable
- The .moc3 format is proprietary and undocumented
- Cubism Core is the ONLY thing that can parse it
- Alternative: Inochi2D (open source, D language) uses .inp format
  — NOT compatible with .moc3 models
- We CANNOT modify mesh geometry, add parameters, or change deformations
  without Cubism Editor ($$$)

---

## 4. WHAT WE CAN AND CANNOT CHANGE

### CAN Change (no Cubism Editor needed)
- **Hair/eye/skin color** — paint directly on texture PNGs
- **Add drawn accessories** (headphones, jewelry) — paint on textures
- **Poses** — set parameter values in motion JSON files
- **Animation speed** — scale time values in motion files
- **Which motions play when** — edit model3.json motion groups
- **Physics** (hair bounce, etc) — edit physics3.json
- **Expression sets** — add/modify expression files
- **Part opacity** — arm layer switching, costume toggles

### CANNOT Change without Cubism Editor ($$$)
- **Mesh geometry** — the .moc3 is binary, locked
- **Add new moving parts** — requires new mesh regions
- **Change how parts deform** — baked into .moc3
- **Add new parameters** — defined at model creation

---

## 5. MODEL FILE STRUCTURE

```
live2d-models/<model_name>/runtime/
  <name>.model3.json        ← MASTER CONFIG (start here)
  <name>.moc3               ← Binary mesh (DON'T TOUCH)
  <name>.physics3.json      ← Hair/cloth bounce physics
  <name>.pose3.json         ← Part switching rules
  <name>.cdi3.json          ← Parameter names/metadata (human-readable)
  <name>.1024/              ← TEXTURE ATLAS (PNGs)
    texture_00.png
    texture_01.png
    texture_02.png
    texture_03.png
    texture_04.png
  motion/                   ← POSE/ANIMATION FILES
    idle_calm.motion3.json
    01.motion3.json
    ...
```

---

## 6. FRAMEWORK INITIALIZATION (Direct Usage)

From official SDK manual: docs.live2d.com/en/cubism-sdk-manual/use-framework-web/

### Lifecycle
1. Initialize the framework
2. Obtain model file paths (from .model3.json)
3. Load the model data
4. Update parameters and vertex info (main loop)
5. Discard the model when finished
6. Exit/dispose the framework

### Initialization Code
```typescript
// 1. Configure logging
cubismOption.logFunction = (msg) => console.log(msg);
cubismOption.loggingLevel = LogLevel.LogLevel_Verbose;

// 2. Start up and initialize
CubismFramework.startUp(cubismOption);
CubismFramework.initialize();  // Only called once
```

### Loading a Model
```typescript
// Parse .model3.json
const setting = new CubismModelSettingJson(buffer, size);

// Load .moc3
const mocPath = modelHomeDir + setting.getModelFileName();
const mocBuffer = await fetch(mocPath).then(r => r.arrayBuffer());
this.loadModel(mocBuffer);  // CubismUserModel method
```

### The Update Loop (CRITICAL)
```typescript
public update(): void {
    // 1. Reset to last frame's state
    this._model.loadParameters();

    // 2. Apply motion playback (overwrites params)
    this._motionManager.updateMotion(this._model, deltaTimeSeconds);

    // 3. Save state after motion, BEFORE manual adjustments
    this._model.saveParameters();

    // 4. Manual adjustments (Add/Multiply — eye tracking, drag, breath)
    this._model.addParameterValueById(idAngleX, eyeX, 1.0);

    // 5. Physics simulation
    this._physics.evaluate(this._model, deltaTimeSeconds);

    // 6. Calculate vertex positions
    this._model.update();
}
```

### Drawing
```typescript
// Renderer setup (once)
const renderer = new CubismRenderer_WebGL();
renderer.initialize(model);

// Each frame (after update)
renderer.drawModel();
```

---

## 7. PARAMETER OPERATIONS

Three modes for manipulating parameters (from official docs):

### Overwrite (setParameterValueById)
- Replaces current value entirely
- Used by: motions, eye blink, forced expressions
- LAST overwrite wins

### Add (addParameterValueById)
- Adds to current value
- Used by: breathing, manual dragging, relative adjustments
- Stacks with existing value

### Multiply (multiplyParameterValueById)
- Multiplies current value
- Used by: expressions that scale existing movements
- e.g., "surprised face" multiplies eye openness by 2.0

### CRITICAL: Order Matters
1. Overwrite (motion, eye blink)
2. Add (breath, drag)
3. Multiply (expressions)

If Overwrite happens LAST, it erases all Add/Multiply effects.
Example: expression multiplies eyes ×2, but blink Overwrites after →
expression effect is lost.

### Optimization: Cache Parameter Indices
```typescript
// Init (once)
const angleXIndex = model.getParameterIndex(
    idManager.getId("PARAM_ANGLE_X")
);

// Update (every frame — use index, not string)
model.setParameterValueByIndex(angleXIndex, 30.0);
```

### Save/Load Pattern
- `loadParameters()` — restores last frame's state
- Motion playback overwrites some params
- `saveParameters()` — stores post-motion state
- Manual adjustments applied after save (breath, physics, eye tracking)
- `update()` — recalculates all vertices

This prevents value drifting where additive operations stack infinitely.

---

## 8. MOTION SYSTEM

### Motion Groups (in model3.json)
```json
"Motions": {
    "Idle": [
        {"File": "motion/idle_calm.motion3.json", "FadeInTime": 1.5, "FadeOutTime": 1.5}
    ],
    "TapBody": [
        {"File": "motion/01.motion3.json", "FadeInTime": 0.5, "FadeOutTime": 0.5}
    ],
    "Talk": [
        {"File": "motion/talk_01.motion3.json", "FadeInTime": 0.3, "FadeOutTime": 0.5}
    ]
}
```

### Group Behavior
- **Idle**: SDK picks randomly from list, loops continuously
- **TapBody**: Triggered when user CLICKS on avatar body
- **Talk**: Triggered when TTS audio starts (the REAL speaking group)
- NO dedicated "listening" group in OLLV frontend (as of v1.2.1)

### Motion Priority System
| Priority | Value | Use Case |
|----------|-------|----------|
| None | 0 | Stopped/overridden |
| Idle | 1 | Calm loops when not speaking |
| Normal | 2 | Speaking gestures, reactions |
| Force | 3 | Forced expression (surprise, laugh) |

### CubismMotionManager
- Priority queue: higher priority motions override lower
- Fade blending: sine-eased weight transitions
- Can register upcoming motion with priority
- `updateMotion()` applies current motion to model

### Motion File Format (.motion3.json)
```json
{
    "Version": 3,
    "Meta": {
        "Duration": 10.0,
        "Fps": 30.0,
        "Loop": true,
        "CurveCount": 25
    },
    "Curves": [
        {
            "Target": "Parameter",  // or "PartOpacity"
            "Id": "PARAM_ANGLE_X",
            "Segments": [0, 24, 1, ...]
        }
    ]
}
```

### Segment Format
```
First keyframe:  [time, value]
Then repeating:  [type, ...control_points, end_time, end_value]

Types:
  0 = Linear    (3 values: type, time, value)
  1 = Bezier    (7 values: type, cp1_time, cp1_val, cp2_time, cp2_val, end_time, end_val)
  2 = Stepped   (3 values: type, time, value)
```

---

## 9. RENDERING PIPELINE

### Per-Frame Pipeline
1. Motion manager evaluates curves → sets parameter values
2. Physics simulation (spring pendulums for hair)
3. Eye blink, breath, expressions, lip sync layered on
4. `model.update()` → Core recalculates all vertices
5. Renderer sorts drawables by render order
6. For each drawable:
   - Upload vertices to WebGL
   - Bind texture (by atlas index)
   - Draw textured triangles
   - Handle clipping masks (rendered to offscreen FBO first)
   - Apply blend modes (Normal, Additive, Multiplicative)

### CubismRenderer_WebGL
- Initializes with WebGL context
- Sets textures by index (matches texture_XX.png order)
- Handles premultiplied alpha: `gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)`
- Clipping masks: renders mask geometry to FBO, then samples in draw pass
- Uses `CubismMatrix44` for MVP (Model-View-Projection)

### Positioning and Scaling
```typescript
const modelMatrix = new CubismModelMatrix(
    model.getCanvasWidth(),
    model.getCanvasHeight()
);
modelMatrix.centerTranslate(x, y);
modelMatrix.scale(scaleX, scaleY);

const projectionMatrix = new CubismMatrix44();
projectionMatrix.scale(1, windowWidth / windowHeight);
projectionMatrix.multiplyByMatrix(modelMatrix);
renderer.setMvpMatrix(projectionMatrix);
```

---

## 10. WHAT pixi-live2d-display COSTS US

### Limitations Discovered (Phase 1)
- Fixed update pipeline — can't reorder parameter application
- No saveParameters()/loadParameters() orchestration
- Simplified priority (IDLE/NORMAL/FORCE only)
- Can't insert custom rendering passes or change shaders
- Lags behind Cubism 5 SDK (last updated Dec 2023)
- Fights slider input via auto-update every frame
- No CubismUpdateScheduler (new R5 modular system)
- `autoUpdate = false` kills rendering entirely (BLACK CANVAS)
- `let` variables in script blocks not accessible from DevTools

### The Fighting Problem (Phase 1 Pitfall)
Three layers fight manual slider control:

1. **Motions** — motionManager auto-restarts idle motions after stop
2. **Eye blink & breath** — run independently, override EYE params every frame
3. **Physics** — overrides hair/cloth params every frame

Phase 1 workaround: replace motionManager.update with no-op, null out
eyeBlink and breath, use ticker callback ordering to override physics.
Hacky but works.

### Why Phase 2 Drops It
With direct CubismWebFramework access:
- Full control over update order
- save/loadParameters orchestration
- Custom motion priority management
- Can insert custom rendering passes
- No more fighting — we ARE the pipeline

---

## 11. DIRECT CUBISM USAGE — ARCHITECTURE PLAN

### Proposed Project Structure
```
editor/
├── src/
│   ├── app.ts              ← Main app, canvas setup, event loop
│   ├── model.ts            ← Extends CubismUserModel
│   ├── renderer.ts         ← Thin wrapper on CubismRenderer_WebGL
│   ├── ui/
│   │   ├── sliders.ts      ← Parameter slider panel
│   │   ├── timeline.ts     ← Animation sequencer
│   │   ├── textures.ts     ← Texture painting tab
│   │   └── hitTest.ts      ← Click-drag posing
│   └── utils/
│       ├── paramMap.ts     ← Parameter grouping/hierarchy
│       └── motionBuilder.ts ← motion3.json construction
├── lib/
│   ├── CubismWebFramework/ ← Git submodule (open source TS)
│   └── Core/               ← live2dcubismcore.min.js (proprietary)
├── static/
│   └── index.html          ← Entry point (loads bundled JS)
├── dist/                   ← esbuild/vite output
├── editor_backend.py       ← Unchanged (FastAPI file I/O)
└── package.json
```

### Build Step Required
- Phase 1: single HTML file, no build (vanilla JS + CDN)
- Phase 2: TypeScript → bundled output (esbuild or vite)
- Trade-off: adds complexity but gives full type safety + tree shaking
- Alternative: keep vanilla JS but import CubismWebFramework as ES modules
  (possible since framework uses standard TS exports)

### Custom Update Pipeline (OurModel extends CubismUserModel)
```typescript
class HermesModel extends CubismUserModel {
    private _sliderOverrides: Map<string, number> = new Map();

    update(deltaTime: number): void {
        // 1. Reset to last frame
        this._model.loadParameters();

        // 2. Motion playback
        this._motionManager.updateMotion(this._model, deltaTime);

        // 3. Save post-motion state
        this._model.saveParameters();

        // 4. Eye blink (if not overridden by slider)
        if (!this._sliderOverrides.has("PARAM_EYE_L_OPEN")) {
            this._eyeBlink?.updateParameters(this._model, deltaTime);
        }

        // 5. Breath (if not overridden)
        this._breath?.updateParameters(this._model, deltaTime);

        // 6. Slider overrides (last word — always win)
        for (const [id, value] of this._sliderOverrides) {
            this._model.setParameterValueById(
                CubismFramework.getIdManager().getId(id), value
            );
        }

        // 7. Physics
        this._physics?.evaluate(this._model, deltaTime);

        // 8. Calculate vertices
        this._model.update();
    }
}
```

### Key Advantages Over pixi-live2d-display
- Slider overrides applied AFTER everything else — always win
- No fighting, no workarounds
- Can selectively disable eyeBlink/breath per-parameter
- Full motion priority control
- Can inspect intermediate parameter states
- Custom rendering (background picker, texture overlay)

---

## 12. TEXTURE SYSTEM

### Texture Atlas Files
- PNG format, typically 1024x1024
- Body parts laid out flat like a sewing pattern
- .moc3 mesh maps UV coordinates to cut/warp onto model
- Index in filename matches index in CubismRenderer texture binding

### Our Texture Map (hermes_dark)
| File | Contents |
|------|----------|
| texture_00.png | Face, eyes, mouth, bangs, headphones |
| texture_01.png | Body (beige shirt, blue blouse, red bow, grey skirt) |
| texture_02.png | Main hair bulk (dark navy, cyan highlights) |
| texture_03.png | Environment (desk, stationery) |
| texture_04.png | Legs/feet (beige and pink variants) |

### Recoloring Technique (B/G Ratio Method)
- Blue/Green ratio distinguishes hair from skin
- Hair: B/G < 0.75
- Skin: B/G > 0.85
- Apply luminance-preserving hue shift to hair pixels only
- Works well for this specific model's palette

### Texture Painting (Phase 2 Feature)
- Canvas-based brush tool overlaid on texture atlas
- Live preview: paint on texture → see result on 3D model in real-time
- Must: keep same dimensions, don't move pieces, paint OVER pixels
- Transparent pixels stay transparent (cutout boundaries)
- Server endpoint: POST /api/model/{name}/texture/{index}

---

## 13. HIT TESTING AND COORDINATE TRANSFORMS

### The Three Coordinate Spaces
(from Phase 1 hard-won knowledge)

1. **Cubism Core space** — raw vertex positions
   - Range: ~-0.5 to 0.5, Y points UP (OpenGL convention)

2. **Model pixel space** — from getDrawableVertices()
   - `vertX = rawVertX * pixelsPerUnit + originalWidth / 2`
   - `vertY = -rawVertY * pixelsPerUnit + originalHeight / 2`
   - Range: 0 to originalWidth × 0 to originalHeight, Y points DOWN

3. **Screen/canvas space** — after PIXI container transform
   - `screenX = (modelPixelX - anchor.x * origW) * scale.x + position.x`
   - `screenY = (modelPixelY - anchor.y * origH) * scale.y + position.y`

### Hit Testing: Screen → Model Pixel
```typescript
const localX = (screenX - model.x) / model.scale.x
    + model.anchor.x * origW;
const localY = (screenY - model.y) / model.scale.y
    + model.anchor.y * origH;
```

### D_REF_* Hit Area Boxes (Preferred)
- Invisible reference meshes: D_REF_HEAD, D_REF_MOUTH, D_REF_ARM_L/R,
  D_REF_BODY, D_REF_HAIR, D_REF_FACE
- 4-vertex quads, opacity 1.0, no texture (transparent)
- Designed by model creator as hit-area zones
- Use as PRIMARY hit targets
- When overlapping: pick SMALLEST (most specific) region
- D_REF_ARM_R is smaller than D_REF_HEAD → click arm returns Arm

### Fallback: Art Mesh Priority
For models WITHOUT D_REF boxes:
Eyes(10) > Mouth(9) > Brows(8) > Face(7) > Arms(6) > Body(5) >
Head(4) > Clothing(3) > Hair(2) > Other(1) > Background(0)

---

## 14. ARM LAYER SYSTEM

### hermes_dark Layers
- **Layer 01 / A-layer**: Arms DOWN on desk
- **Layer 02 / B-layer**: Hands UP near face
- 12 arm params across 2 layers, only 3 per arm per layer move geometry

### Switching Layers (Runtime)
```typescript
const im = model.internalModel;
const cm = im.coreModel;

// MUST disable pose manager — it resets opacities every frame
im.pose = null;

// Find part indices, set opacities
for (let i = 0; i < partCount; i++) {
    const id = cm._model.parts.ids[i];
    if (id === 'PARTS_01_ARM_R_01') cm._model.parts.opacities[i] = 1.0;
    if (id === 'PARTS_01_ARM_L_01') cm._model.parts.opacities[i] = 1.0;
    if (id === 'PARTS_01_ARM_R_02') cm._model.parts.opacities[i] = 0.0;
    if (id === 'PARTS_01_ARM_L_02') cm._model.parts.opacities[i] = 0.0;
}
```

### Pose Manager Fights Layer Switching
The pose3.json file defines arm layer groups. The pose engine resets
part opacities to configured defaults every frame. To switch layers
at runtime, MUST disable pose manager first.

---

## 15. LICENSING

### Live2D Open Software License
- CubismWebFramework is NOT MIT/GPL
- Governed by "Live2D Open Software License"
- Prohibits standard open-source redistribution
- Modifications must be shared back under same license

### "Expandable Application" Classification
- VTuber editor = "Expandable Application" per Live2D
- Requires commercial contract and revenue sharing (up to 20%)
- Even for small entities

### Our Approach
- Editor remains MIT-licensed for our own use
- Users must provide their own live2dcubismcore.min.js
- "Bring your own core" model
- CubismWebFramework source can be included (different license)
- Do NOT distribute Cubism Core binary

### Alternative: Inochi2D
- Truly open source (D language)
- Uses .inp format — NOT compatible with .moc3
- Growing traction but not industry standard yet
- Consider for future: Inochi2D import support alongside Live2D

---

## 16. CUBISM 5 R5 NEW FEATURES (April 2026)

- CubismUpdateScheduler: modular update ordering
- CubismLook effect: gaze tracking (new in R5)
- Enhanced physics with better spring constants
- MOC consistency validation (can enable to check for corruption)
- Updated rendering with improved shader support

---

## 17. OPEN QUESTIONS / TODO

- [ ] Can we use CubismWebFramework as ES modules without a build step?
- [ ] What's the exact shader code for clipping masks in CubismRenderer_WebGL?
- [ ] Can we inspect the deformation keyframes from .moc3 via Core API?
- [ ] How does CubismUpdateScheduler differ from the old manual update loop?
- [ ] What's the performance cost of calling getDrawableVertices() every frame
      for hit testing? (vs caching mesh bounds)
- [ ] Can we use premultiplied alpha with our texture painting approach?
- [ ] What does the Inochi2D .inp format look like? Future import path?
- [ ] Licensing: exactly which Live2D classification do we fall under?
      "Expandable Application" vs "Individual Developer"?
- [ ] Can we ship CubismWebFramework source (not Core) under Live2D OSL?
- [ ] What happens when we call update() multiple times per frame?
      (for preview/undo without re-rendering?)

---

## 19. CORE 5.0 ↔ FRAMEWORK R5 COMPATIBILITY POLYFILLS (DISCOVERED APR 14 2026)

The Core 5.0.0 binary (live2dcubismcore.min.js) doesn't expose several APIs
that the CubismWebFramework R5 source expects. These polyfills are REQUIRED
for the framework to function with this Core version.

### What's Missing and Why

| Feature | Core Version | Framework Expects | Fix |
|---------|-------------|-------------------|-----|
| `model.offscreens` | 5.3+ | R5 framework | Inject empty stub object |
| `drawables.blendModes` | 5.3+ | R5 framework | Derive from constantFlags (all Normal=0) |
| `parts.offscreenIndices` | 5.3+ | R5 framework | Inject Int32Array(-1) |
| `model.getRenderOrders()` | 5.3+ | R5 framework | Wrapper returning drawables.renderOrders |
| `ColorBlendType_*` constants | 5.3+ | R5 framework | Polyfill 18 constants on Core namespace |
| `Version.csmGetMocVersion(buffer)` | Broken in 5.0 | CubismMoc.create | Try/catch, fallback to latestMocVersion |
| `renderer.startUp(gl)` | Required call | Our app | Must call before loadShaders |

### The Polyfill Function (patchCubismCore)

Located in `src/app.ts`, called before any framework code touches the Core.
Patches `Core.Model.fromMoc` to wrap the returned model with missing properties.

```typescript
function patchCubismCore(): void {
    const Core = (window as any).Live2DCubismCore;

    // 1. ColorBlendType constants
    Core.ColorBlendType_Normal = 0;
    // ... (18 total)

    // 2. Wrap Model.fromMoc
    const origFromMoc = Core.Model.fromMoc.bind(Core.Model);
    Core.Model.fromMoc = function(moc) {
        const model = origFromMoc(moc);
        if (!model.offscreens) model.offscreens = { count: 0, ...emptyArrays };
        if (!model.drawables.blendModes) model.drawables.blendModes = new Int32Array(count);
        if (!model.parts.offscreenIndices) model.parts.offscreenIndices = new Int32Array(count).fill(-1);
        if (!model.getRenderOrders) model.getRenderOrders = () => this.drawables.renderOrders;
        return model;
    };
}
```

### Why This Happens

Live2D ships the Core binary separately from the framework. The Core is
compiled from C via Emscripten and gets updated less frequently than the
framework TypeScript source. New features (offscreen rendering, blend modes)
added in Cubism 5.3 appear in the framework source but not in older Core
binaries.

**Lesson:** Always expect Core/Framework version skew. Build polyfills
into your app layer, not into the framework source.

### renderer.startUp(gl) — Required Call

The CubismRenderer_WebGL has a `startUp(gl)` method that MUST be called
after `initialize(model)` and before `loadShaders()`. Without it, the
renderer has no WebGL context and shader loading fails silently.

```typescript
const renderer = new CubismRenderer_WebGL();
renderer.initialize(this._model);
renderer.startUp(gl!);  // ← CRITICAL — pass WebGL context here
renderer.setIsPremultipliedAlpha(true);
```

---

## 20. REFERENCES

### Official
- SDK Manual: docs.live2d.com/en/cubism-sdk-manual/
- Framework: github.com/Live2D/CubismWebFramework
- Samples: github.com/Live2D/CubismWebSamples
- Model loading: docs.live2d.com/en/cubism-sdk-manual/model-web/
- Parameter ops: docs.live2d.com/en/cubism-sdk-manual/parameters/
- Direct framework use: docs.live2d.com/en/cubism-sdk-manual/use-framework-web/

### Reverse Engineering / Security
- moc3ingbird (CVE-2023-27566): github.com/openl2d/moc3ingbird
- Security analysis: undeleted.ronsor.com/live2d-a-security-trainwreck/
- Hackaday summary: hackaday.com/2023/03/20/live2d-silently-subverting-threat-models/
- ImHex pattern for .moc3: src/moc3.hexpat in moc3ingbird repo

### Our Project
- Editor: ~/hermes-vtuber/editor/
- Backend: editor_backend.py (FastAPI, port 8080)
- Frontend: editor.html (Phase 1, 117KB single file)
- Live model: ~/Open-LLM-VTuber/live2d-models/hermes_dark/runtime/
- GitHub: github.com/123mikeyd/hermes-vtuber

---

*Document created April 14, 2026. Living document — update as Phase 2 progresses.*
