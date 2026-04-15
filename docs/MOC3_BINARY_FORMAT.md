# MOC3 Binary Format — Hands-On Analysis
# Reverse-engineered from actual model files + ImHex pattern (moc3ingbird v2.1b)
# April 14, 2026

---

## 1. FILE HEADER (64 bytes at 0x00)

```
Offset  Size  Field
0x00    4     Magic: "MOC3"
0x04    1     Version (u8): 1=V3.0, 2=V3.3, 3=V4.0, 4=V4.2, 5=V5.0
0x05    1     IsBigEndian (u8): 0=little, 1=big
0x06    58    Padding (zeros)
```

Our models:
- hermes_dark: V4.0, little endian
- shizuku: V4.0, little endian  
- mao_pro: V5.0, little endian

---

## 2. SECTION OFFSET TABLE (starts at 0x40)

After the header, the file has a section offset table containing pointers
to all major data structures. The table starts at offset 0x40.

```
Offset  Size  Field
0x40    4     Pointer → CountInfoTable
0x44    4     Pointer → CanvasInfo
0x48    ...   More section pointers (parts, deformers, meshes, etc.)
```

For hermes_dark: CountInfoTable @ 0x07C0, CanvasInfo @ 0x0840

---

## 3. CANVAS INFO

```
Offset  Size  Field
+0      4     PixelsPerUnit (float)
+4      4     OriginX (float)
+8      4     OriginY (float)
+12     4     CanvasWidth (float)
+16     4     CanvasHeight (float)
+20     1     CanvasFlags (bit 0 = reverseYCoordinate)
+21     43    Padding
```

Our models:
| Model       | Width | Height | PPU   | Origin      |
|-------------|-------|--------|-------|-------------|
| hermes_dark | 1280  | 1380   | 1280  | (640, 690)  |
| shizuku     | 1280  | 1380   | 1280  | (640, 690)  |
| mao_pro     | 5800  | 8400   | 5800  | (2900, 4200)|

---

## 4. COUNT INFO TABLE

Contains the count of every object type in the model. Located via pointer
at offset 0x40. For V4.0 files, counts start at the pointer (no padding).

### Verified counts from our models:

```
Field                         hermes_dark  shizuku  mao_pro
────────────────────────────  ───────────  ───────  ───────
parts                         29           29       31
deformers                     134          134      175
  warpDeformers               117          117      116
  rotationDeformers           17           17       59
artMeshes                     131          131      260
parameters                    45           45       128
partKeyforms                  29           29       33
warpDeformerKeyforms          744          744      611
rotationDeformerKeyforms      161          161      246
artMeshKeyforms               594          594      1341
keyformPositions              163,040      163,040  142,512
parameterBindingIndices       57           57       163
keyformBindings               46           46       138
parameterBindings             46           46       127
keys                          139          139      896
uvs                           4,908        4,908    12,024
positionIndices               9,573        9,573    23,817
drawOrderGroups               1            1        2
drawOrderGroupObjects         131          131      261
```

### V5.0-only fields (mao_pro):
```
drawableMasks                 —            —        65
glue                          —            —        7
glueInfo                      —            —        322
glueKeyforms                  —            —        7
```

### Key observations:
- **hermes_dark = shizuku** (identical structure, just recolored textures)
- **163,040 keyformPositions** — this is the VERTEX DEFORMATION DATA.
  Each position is an XY coordinate pair. This is where all the mesh
  deformation lives — the bulk of the file.
- **131 art meshes** but only **29 parts** — parts group meshes hierarchically
- **45 parameters** drive deformation of 131 meshes through 594 keyforms
- **mao_pro has more meshes** (260 vs 131) but fewer keyform positions (142K vs 163K)
  — suggesting denser, higher-quality mesh with less deformation range

---

## 5. OBJECT HIERARCHY

The .moc3 contains a tree of objects:

```
Parts (29)
  └─ Deformers (134)
       ├─ Warp Deformers (117)      — free-form mesh deformation
       └─ Rotation Deformers (17)   — rotational pivots
            └─ Art Meshes (131)     — actual textured geometry
```

Each object has:
- **ID**: 64-byte string (name like "PARTS_01_ARM_R_01")
- **Parent index**: links to parent in hierarchy
- **Keyform bindings**: link to parameters that control this object

---

## 6. PARAMETERS (45 in hermes_dark)

Each parameter has:
- **ID**: 64-byte name string
- **Min value**: float
- **Max value**: float
- **Default value**: float
- **IsRepeat**: bool (whether param wraps around)
- **DecimalPlaces**: u32
- **Binding indices**: link to keyform bindings

Parameters drive deformation through:
```
Parameter → ParameterBinding → KeyformBinding → Keyform → Positions
```

A parameter at value X interpolates between adjacent key values.

---

## 7. ART MESHES (131 in hermes_dark)

Each art mesh has:
- **ID**: 64-byte name
- **Parent part/deformer indices**
- **Texture number**: which texture_XX.png
- **Drawable flags**: blend mode, double-sided, inverted mask
- **Vertex count**
- **UV source indices**: mapping to UV array
- **Position index source**: mapping to vertex positions
- **Drawable mask sources**: clipping masks

### DrawableFlags (u8):
```
Bits 0-1: Blend mode (0=Normal, 1=Additive, 2=Multiplicative)
Bit 2:    IsDoubleSided
Bit 3:    IsInverted (mask inversion)
Bits 4-7: Reserved
```

---

## 8. VERSION DIFFERENCES

| Version | Cubism | Features Added |
|---------|--------|----------------|
| V3.0    | 3.0    | Base format |
| V3.3    | 3.3    | Quad source flag for warp deformers |
| V4.0    | 4.0    | — |
| V4.2    | 4.2    | Multiply/Screen colors, Blend Shapes, Parameter types |
| V5.0    | 5.0    | Glue, Blend Shapes for parts/rotation/glue, multiply/screen colors on deformers |

---

## 9. BINARY LAYOUT (hermes_dark as reference)

```
0x0000-0x003F  Header (64 bytes)
0x0040-0x07BF  Section offset table (pointers)
0x07C0-0x083F  Count info table (29 parts, 45 params, etc.)
0x0840-0x087F  Canvas info (1280x1380)
0x0880+        Object data (IDs, parent indices, flags)
0x????+        Keyform data (vertex deformation)
0x????+        UV data (texture coordinates)
0x????+        Position indices (triangle indices for mesh)
0x????+        Drawable masks
0x????+        Draw order groups
  ...remaining to EOF...
```

The bulk of the file (from ~0x0880 onward) is:
1. Object metadata (IDs, hierarchies, flags)
2. Keyform positions (163,040 XY pairs = ~1.3MB of vertex data)
3. UV coordinates (4,908 pairs)
4. Triangle indices (9,573 indices)

---

## 10. SECURITY NOTES (CVE-2023-27566)

The Cubism Core library has NO bounds checking on section offsets.
From the ImHex pattern analysis:
- Section offsets are raw pointers added to a base address
- A malicious file can point anywhere within ~2GB of the loaded data
- The CountInfoTable values are NOT validated
- Proof of concept: moc3ingbird crashes any app loading it

**Never load untrusted .moc3 files.**

---

## 11. WHAT WE CAN EXTRACT WITHOUT CUBISM EDITOR

From the binary, we can read:
- ✅ All parameter names, min/max/default values
- ✅ All part names and hierarchy
- ✅ All art mesh names, texture assignments, blend modes
- ✅ Draw order structure
- ✅ UV coordinates (can reconstruct texture mapping)
- ✅ Triangle indices (can reconstruct mesh topology)
- ✅ Keyform positions at each parameter key value (full deformation data)

What we CANNOT extract easily:
- ❌ Semantic meaning of parameters (needs cdi3.json or manual labeling)
- ❌ Motion data (separate .motion3.json files)
- ❌ Physics configuration (separate .physics3.json)

---

## 12. NEXT STEPS

1. Write a Python parser that extracts all object names and counts
2. Map parameter names to their keyform bindings
3. Export mesh topology (vertices + triangles) as OBJ for visualization
4. Compare deformation ranges across models
5. Build a "parameter space explorer" — render model at every key value

---

*Document created April 14, 2026 from hands-on analysis of 3 models.*
*ImHex pattern: moc3ingbird v2.1b (openl2d/moc3ingbird)*
*Models: hermes_dark (V4.0), shizuku (V4.0), mao_pro (V5.0)*
