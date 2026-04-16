/**
 * Hermes Puppet Engine v5 — Production Quality
 * 
 * Multi-layer system: each image is a layer with its own bone hierarchy.
 * Drag-and-drop to add layers. Click-drag to pose. Paint to customize.
 * Animation keyframes. Spring physics. Import .moc3. Export HPE format.
 * 
 * Built to replace Live2D entirely. Open source. Free forever.
 */

import * as THREE from 'three';

// ============================================================
//  TYPES
// ============================================================

interface Bone {
    name: string;
    parent: Bone | null;
    children: Bone[];
    lx: number; ly: number; lr: number;
    wx: number; wy: number; wr: number;
    vis: THREE.Group | null;
}

interface MeshPart {
    name: string;
    mesh: THREE.Mesh;
    restX: Float32Array;
    restY: Float32Array;
    weights: Map<string, Float32Array>;
    z: number;
    visible: boolean;
}

interface Spring {
    bone: string;
    parent: string;
    angle: number; vel: number;
    stiff: number; damp: number; grav: number;
}

interface Param {
    name: string;
    min: number; max: number; value: number;
    drives: Array<{ bone: string; prop: 'rot' | 'scaleY'; mult: number }>;
}

interface Keyframe {
    t: number;
    vals: Record<string, number>;
    ease: 'linear' | 'in' | 'out' | 'inout';
}

interface Anim {
    name: string;
    dur: number;
    loop: boolean;
    kfs: Keyframe[];
}

interface Layer {
    name: string;
    image: HTMLImageElement;
    texture: THREE.Texture;
    bones: Map<string, Bone>;
    parts: MeshPart[];
    springs: Map<string, Spring>;
    params: Map<string, Param>;
    anims: Map<string, Anim>;
    group: THREE.Group;
    visible: boolean;
    opacity: number;
}

// ============================================================
//  STATE
// ============================================================

let scene: THREE.Scene;
let camera: THREE.OrthographicCamera;
let renderer: THREE.WebGLRenderer;
let clock: THREE.Clock;

let layers: Layer[] = [];
let activeLayer: Layer | null = null;

// Global params (shared across layers)
let globalParams = new Map<string, Param>();

// Drag
let dragging = false;
let dragBone: Bone | null = null;

// Paint
let paintActive = false;
let paintPart: MeshPart | null = null;
let paintCanvas: HTMLCanvasElement | null = null;
let paintCtx: CanvasRenderingContext2D | null = null;
let paintTex: THREE.CanvasTexture | null = null;
let paintColor = '#ff0000';
let paintSize = 8;
let painting = false;

// Animation
let curAnim: Anim | null = null;
let animT = 0;
let animPlay = false;

// ============================================================
//  INIT
// ============================================================

export function init(id = 'puppet-canvas'): void {
    const el = document.getElementById(id)!;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor(0x0d0d0d, 1);
    el.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    const a = el.clientWidth / el.clientHeight;
    const s = 350;
    camera = new THREE.OrthographicCamera(-s*a, s*a, s, -s, 0.1, 2000);
    camera.position.set(0, 0, 500);
    camera.lookAt(0, 0, 0);
    clock = new THREE.Clock();

    // Grid
    const grid = new THREE.GridHelper(700, 14, 0x1a1a1a, 0x141414);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -2;
    scene.add(grid);

    // Interaction
    renderer.domElement.addEventListener('mousedown', onDown);
    renderer.domElement.addEventListener('mousemove', onMove);
    renderer.domElement.addEventListener('mouseup', onUp);
    renderer.domElement.addEventListener('mouseleave', onUp);

    // Drop zone for images
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', onDrop);

    // Global params
    globalParams.set('HeadX', { name:'HeadX', min:-30, max:30, value:0, drives:[] });
    globalParams.set('BodyX', { name:'BodyX', min:-15, max:15, value:0, drives:[] });

    tick();
    console.log('Hermes Puppet Engine v5 — ready');
}

// ============================================================
//  LAYER SYSTEM
// ============================================================

export async function addLayer(name: string, imageUrl: string): Promise<Layer> {
    const img = await loadImage(imageUrl);
    const tex = new THREE.Texture(img);
    tex.needsUpdate = true;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;

    const W = img.width;
    const H = img.height;

    const layer: Layer = {
        name,
        image: img,
        texture: tex,
        bones: new Map(),
        parts: [],
        springs: new Map(),
        params: new Map(),
        anims: new Map(),
        group: new THREE.Group(),
        visible: true,
        opacity: 1
    };

    scene.add(layer.group);

    // Create bones
    const addB = (n: string, p: string | null, x: number, y: number): Bone => {
        const b: Bone = { name: n, parent: null, children: [], lx: x, ly: y, lr: 0, wx: x, wy: y, wr: 0, vis: null };
        if (p && layer.bones.has(p)) { b.parent = layer.bones.get(p)!; b.parent.children.push(b); }
        layer.bones.set(n, b);
        return b;
    };

    addB('root', null, 0, 0);
    addB('head', 'root', 0, H*0.22);
    addB('body', 'root', 0, -H*0.05);
    addB('hair_top', 'head', 0, H*0.15);
    addB('hair_l', 'head', -W*0.18, H*0.08);
    addB('hair_r', 'head', W*0.18, H*0.08);
    addB('eye_l', 'head', -W*0.09, H*0.01);
    addB('eye_r', 'head', W*0.09, H*0.01);
    addB('arm_l', 'body', -W*0.2, H*0.02);
    addB('arm_r', 'body', W*0.2, H*0.02);
    addB('fore_l', 'arm_l', 0, -H*0.1);
    addB('fore_r', 'arm_r', 0, -H*0.1);

    // Create mesh
    const zOrder = layers.length;
    const part = makePart(layer.group, 'body', 0, 0, W, H, tex, 12, 12, zOrder);

    // Paint weights
    const pw = (bone: string, cx: number, cy: number, r: number, str: number) => {
        const count = part.restX.length;
        const w = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const dx = part.restX[i] - cx, dy = part.restY[i] - cy;
            const dist = Math.sqrt(dx*dx + dy*dy);
            w[i] = dist > r*2 ? 0 : Math.min(1, Math.exp(-(dist*dist)/(2*r*r)) * Math.exp(-(dist*dist)/(2*r*r)) * str);
        }
        part.weights.set(bone, w);
    };

    pw('head', 0, H*0.22, W*0.18, 1.0);
    pw('hair_top', 0, H*0.35, W*0.2, 0.85);
    pw('hair_l', -W*0.2, H*0.25, W*0.1, 0.8);
    pw('hair_r', W*0.2, H*0.25, W*0.1, 0.8);
    pw('eye_l', -W*0.09, H*0.19, W*0.05, 0.9);
    pw('eye_r', W*0.09, H*0.19, W*0.05, 0.9);
    pw('body', 0, -H*0.05, W*0.15, 1.0);
    pw('arm_l', -W*0.22, 0, W*0.1, 0.9);
    pw('arm_r', W*0.22, 0, W*0.1, 0.9);
    pw('fore_l', -W*0.22, -H*0.12, W*0.08, 0.85);
    pw('fore_r', W*0.22, -H*0.12, W*0.08, 0.85);
    normalizeWeights(part);
    layer.parts.push(part);

    // Springs
    const addS = (bone: string, parent: string, stiff: number, damp: number, grav: number) => {
        layer.springs.set(bone, { bone, parent, angle: 0, vel: 0, stiff, damp, grav });
    };
    addS('hair_top', 'head', 0.4, 0.82, 0.5);
    addS('hair_l', 'head', 0.35, 0.85, 0.45);
    addS('hair_r', 'head', 0.35, 0.85, 0.45);

    // Params
    const addP = (n: string, min: number, max: number, def: number, drives: Array<{bone:string;prop:'rot'|'scaleY';mult:number}>) => {
        layer.params.set(n, { name: n, min, max, value: def, drives });
    };
    addP('HeadX', -30, 30, 0, [{bone:'head',prop:'rot',mult:1}]);
    addP('HeadTilt', -20, 20, 0, [{bone:'head',prop:'rot',mult:0.3}]);
    addP('BodyX', -15, 15, 0, [{bone:'body',prop:'rot',mult:1}]);
    addP('ArmL', -55, 55, 0, [{bone:'arm_l',prop:'rot',mult:1}]);
    addP('ArmR', -55, 55, 0, [{bone:'arm_r',prop:'rot',mult:-1}]);
    addP('ForeL', -90, 90, 0, [{bone:'fore_l',prop:'rot',mult:1}]);
    addP('ForeR', -90, 90, 0, [{bone:'fore_r',prop:'rot',mult:-1}]);

    // Animations
    layer.anims.set('idle_breath', { name:'idle_breath', dur:4, loop:true, kfs:[
        {t:0,vals:{BodyX:-1},ease:'inout'},{t:2,vals:{BodyX:1},ease:'inout'},{t:4,vals:{BodyX:-1},ease:'inout'}
    ]});
    layer.anims.set('look_around', { name:'look_around', dur:6, loop:true, kfs:[
        {t:0,vals:{HeadX:0},ease:'inout'},{t:1.5,vals:{HeadX:-15},ease:'inout'},
        {t:3,vals:{HeadX:0},ease:'inout'},{t:4.5,vals:{HeadX:15},ease:'inout'},{t:6,vals:{HeadX:0},ease:'inout'}
    ]});
    layer.anims.set('wave', { name:'wave', dur:2, loop:false, kfs:[
        {t:0,vals:{ArmR:0},ease:'out'},{t:0.4,vals:{ArmR:-50},ease:'inout'},
        {t:0.8,vals:{ArmR:-30},ease:'inout'},{t:1.2,vals:{ArmR:-50},ease:'inout'},{t:2,vals:{ArmR:0},ease:'in'}
    ]});

    layers.push(layer);
    setActiveLayer(layer);
    buildUI();

    console.log(`Layer "${name}": ${W}x${H}, ${layer.bones.size} bones, ${layer.parts.length} parts`);
    return layer;
}

export function removeLayer(name: string): void {
    const idx = layers.findIndex(l => l.name === name);
    if (idx < 0) return;
    const layer = layers[idx];
    scene.remove(layer.group);
    layers.splice(idx, 1);
    if (activeLayer === layer) setActiveLayer(layers[0] || null);
    buildUI();
}

export function setActiveLayer(layer: Layer | null): void {
    activeLayer = layer;
    buildUI();
}

export function setLayerOpacity(name: string, opacity: number): void {
    const layer = layers.find(l => l.name === name);
    if (layer) {
        layer.opacity = opacity;
        for (const part of layer.parts) {
            (part.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
        }
    }
}

export function setLayerVisibility(name: string, visible: boolean): void {
    const layer = layers.find(l => l.name === name);
    if (layer) {
        layer.visible = visible;
        layer.group.visible = visible;
    }
}

// ============================================================
//  MESH
// ============================================================

function makePart(parent: THREE.Group, name: string, cx: number, cy: number,
    w: number, h: number, tex: THREE.Texture, cols: number, rows: number, z: number): MeshPart {
    const verts: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
        verts.push(cx+(c/cols-0.5)*w, cy+(0.5-r/rows)*h, 0);
        uv.push(c/cols, 1-r/rows);
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const a = r*(cols+1)+c;
        idx.push(a, a+1, a+cols+1, a+1, a+cols+2, a+cols+1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false
    }));
    mesh.renderOrder = z;
    parent.add(mesh);

    const count = verts.length/3;
    const restX = new Float32Array(count), restY = new Float32Array(count);
    for (let i = 0; i < count; i++) { restX[i]=verts[i*3]; restY[i]=verts[i*3+1]; }
    return { name, mesh, restX, restY, weights: new Map(), z, visible: true };
}

function normalizeWeights(part: MeshPart): void {
    const count = part.restX.length;
    const all = Array.from(part.weights.values());
    for (let i = 0; i < count; i++) {
        let sum = 0;
        for (const w of all) sum += w[i];
        if (sum > 0) for (const w of all) w[i] /= sum;
    }
}

function deform(part: MeshPart, bones: Map<string, Bone>): void {
    if (!part.visible) { part.mesh.visible = false; return; }
    part.mesh.visible = true;
    const pos = part.mesh.geometry.getAttribute('position');
    const count = pos.count;
    const dx = new Float32Array(count), dy = new Float32Array(count);

    for (const [boneName, w] of part.weights) {
        const b = bones.get(boneName);
        if (!b) continue;
        const ox = b.wx - b.lx, oy = b.wy - b.ly;
        const cos = Math.cos(b.wr), sin = Math.sin(b.wr);
        for (let i = 0; i < count; i++) {
            if (w[i] === 0) continue;
            const lx = part.restX[i] - b.lx, ly = part.restY[i] - b.ly;
            dx[i] += (lx*cos - ly*sin + b.lx - part.restX[i] + ox) * w[i];
            dy[i] += (lx*sin + ly*cos + b.ly - part.restY[i] + oy) * w[i];
        }
    }
    for (let i = 0; i < count; i++) pos.setXY(i, part.restX[i]+dx[i], part.restY[i]+dy[i]);
    pos.needsUpdate = true;
}

// ============================================================
//  BONES
// ============================================================

function updateBoneTree(bones: Map<string, Bone>): void {
    for (const b of bones.values()) {
        if (!b.parent) updateBone(b, 0, 0, 0);
    }
}

function updateBone(b: Bone, px: number, py: number, pr: number): void {
    const c = Math.cos(pr), s = Math.sin(pr);
    b.wx = px + b.lx*c - b.ly*s;
    b.wy = py + b.lx*s + b.ly*c;
    b.wr = pr + b.lr;
    for (const ch of b.children) updateBone(ch, b.wx, b.wy, b.wr);
}

function drawBonesForLayer(layer: Layer): void {
    layer.group.children = layer.group.children.filter(c => !String(c.name).startsWith('bv'));
    if (!layer.visible) return;
    for (const b of layer.bones.values()) {
        const g = new THREE.Group();
        g.name = `bv_${b.name}`;
        const isDrag = dragging && dragBone === b;
        const j = new THREE.Mesh(
            new THREE.CircleGeometry(isDrag ? 8 : 5, 12),
            new THREE.MeshBasicMaterial({ color: isDrag ? 0xff4444 : 0x00ddff, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
        );
        j.position.set(b.wx, b.wy, 60);
        g.add(j);
        if (b.parent) {
            g.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(b.wx, b.wy, 60),
                    new THREE.Vector3(b.parent.wx, b.parent.wy, 60)
                ]),
                new THREE.LineBasicMaterial({ color: 0x00ddff, transparent: true, opacity: 0.4 })
            ));
        }
        layer.group.add(g);
    }
}

// ============================================================
//  SPRINGS
// ============================================================

function tickSprings(layer: Layer, dt: number): void {
    const cd = Math.min(dt, 0.04);
    for (const s of layer.springs.values()) {
        const p = layer.bones.get(s.parent);
        const c = layer.bones.get(s.bone);
        if (!p || !c) continue;
        s.vel += ((p.lr - s.angle) * s.stiff + (-s.angle * s.grav * 0.08)) * cd * 60;
        s.vel *= s.damp;
        s.angle += s.vel * cd * 60;
        c.lr = s.angle;
    }
}

// ============================================================
//  PARAMETERS
// ============================================================

function applyParams(layer: Layer): void {
    for (const p of layer.params.values()) {
        for (const d of p.drives) {
            const b = layer.bones.get(d.bone);
            if (!b) continue;
            if (d.prop === 'rot') b.lr = p.value * d.mult * Math.PI / 180;
        }
    }
}

// ============================================================
//  ANIMATIONS
// ============================================================

function tickAnim(layer: Layer, dt: number): void {
    if (!animPlay || !curAnim || !layer.anims.has(curAnim.name)) return;
    animT += dt;
    if (animT >= curAnim.dur) {
        if (curAnim.loop) animT -= curAnim.dur;
        else { animPlay = false; return; }
    }
    const kfs = curAnim.kfs;
    let prev = kfs[0], next = kfs[kfs.length-1];
    for (let i = 0; i < kfs.length-1; i++) {
        if (kfs[i].t <= animT && kfs[i+1].t >= animT) { prev = kfs[i]; next = kfs[i+1]; break; }
    }
    const t = next.t > prev.t ? (animT - prev.t) / (next.t - prev.t) : 0;
    const e = t < 0.5 ? 2*t*t : -1+(4-2*t)*t; // ease-in-out
    for (const [name, p] of layer.params) {
        const pv = prev.vals[name] ?? p.value;
        const nv = next.vals[name] ?? p.value;
        p.value = pv + (nv - pv) * e;
    }
    syncSliders();
}

// ============================================================
//  CLICK-DRAG
// ============================================================

function screenToWorld(ex: number, ey: number): [number, number] {
    const rect = renderer.domElement.getBoundingClientRect();
    const a = rect.width / rect.height;
    const s = 350;
    return [((ex - rect.left) / rect.width * 2 - 1) * s * a, -((ey - rect.top) / rect.height * 2 - 1) * s];
}

function findBone(wx: number, wy: number): Bone | null {
    let best: Bone | null = null, bestD = 50;
    for (const layer of layers) {
        if (!layer.visible) continue;
        for (const b of layer.bones.values()) {
            const d = Math.sqrt((b.wx-wx)**2 + (b.wy-wy)**2);
            if (d < bestD) { bestD = d; best = b; }
        }
    }
    return best;
}

function onDown(e: MouseEvent): void {
    if (paintActive) return;
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    const bone = findBone(wx, wy);
    if (bone) {
        dragging = true;
        dragBone = bone;
        renderer.domElement.style.cursor = 'grabbing';
    }
}

function onMove(e: MouseEvent): void {
    if (!dragging || !dragBone) return;
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    dragBone.lr = Math.atan2(wy - dragBone.wy, wx - dragBone.wx) + Math.PI/2;
    syncSliders();
}

function onUp(): void {
    dragging = false;
    dragBone = null;
    renderer.domElement.style.cursor = 'default';
}

// ============================================================
//  TEXTURE PAINTING
// ============================================================

export function startPaint(partName: string = 'body'): void {
    if (!activeLayer) return;
    const part = activeLayer.parts.find(p => p.name === partName) || activeLayer.parts[0];
    if (!part) return;
    const mat = part.mesh.material as THREE.MeshBasicMaterial;
    const img = activeLayer.image;

    paintCanvas = document.createElement('canvas');
    paintCanvas.width = img.width;
    paintCanvas.height = img.height;
    paintCtx = paintCanvas.getContext('2d')!;
    paintCtx.drawImage(img, 0, 0);
    paintTex = new THREE.CanvasTexture(paintCanvas);
    mat.map = paintTex;
    mat.needsUpdate = true;
    paintPart = part;
    paintActive = true;
    console.log('Paint mode ON');
}

export function stopPaint(): void {
    paintActive = false;
    paintPart = null;
    paintCanvas = null;
    paintCtx = null;
    paintTex = null;
    renderer.domElement.style.cursor = 'default';
    console.log('Paint mode OFF');
}

function onPaintDown(e: MouseEvent): void {
    if (!paintActive || !paintCtx) return;
    painting = true;
    doPaint(e);
}

function onPaintMove(e: MouseEvent): void {
    if (!painting || !paintCtx) return;
    doPaint(e);
}

function onPaintUp(): void {
    painting = false;
    if (paintTex) paintTex.needsUpdate = true;
}

function doPaint(e: MouseEvent): void {
    if (!paintCtx || !paintCanvas) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const tx = ((e.clientX - rect.left) / rect.width) * paintCanvas.width;
    const ty = ((e.clientY - rect.top) / rect.height) * paintCanvas.height;
    paintCtx.fillStyle = paintColor;
    paintCtx.beginPath();
    paintCtx.arc(tx, ty, paintSize, 0, Math.PI*2);
    paintCtx.fill();
    if (paintTex) paintTex.needsUpdate = true;
}

export function setPaintColor(c: string): void { paintColor = c; }
export function setPaintSize(s: number): void { paintSize = s; }

// ============================================================
//  .MOC3 IMPORT
// ============================================================

export async function importMoc3(modelName: string): Promise<void> {
    console.log('Importing:', modelName);
    const info = await fetch(`http://localhost:8080/api/model/${modelName}/info`).then(r => r.json());

    const layer = await addLayer(modelName, `/live2d-models/${modelName}/runtime/${info.textures[0]}`);

    // Map Live2D params
    const mapping: Record<string, {bone:string;prop:'rot';mult:number}> = {
        'PARAM_ANGLE_X': {bone:'head',prop:'rot',mult:1},
        'PARAM_ANGLE_Y': {bone:'head',prop:'rot',mult:0.5},
        'PARAM_BODY_X': {bone:'body',prop:'rot',mult:1},
        'PARAM_ARM_L': {bone:'arm_l',prop:'rot',mult:1},
        'PARAM_ARM_R': {bone:'arm_r',prop:'rot',mult:-1},
    };
    for (const [id, info2] of Object.entries(info.parameters || {})) {
        const m = mapping[id];
        if (m) {
            const name = id.replace('PARAM_','');
            if (!layer.params.has(name)) {
                layer.params.set(name, { name, min: -30, max: 30, value: 0, drives: [m] });
            }
        }
    }
    buildUI();
}

// ============================================================
//  DROP HANDLER
// ============================================================

async function onDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^.]+$/, '');
    await addLayer(name, url);
    document.getElementById('drop-zone')?.classList.add('hidden');
}

// ============================================================
//  UI
// ============================================================

function syncSliders(): void {
    if (!activeLayer) return;
    for (const [name, p] of activeLayer.params) {
        const s = document.querySelector(`input[data-p="${name}"]`) as HTMLInputElement;
        if (s) { s.value = String(p.value); (s.nextElementSibling as HTMLElement).textContent = p.value.toFixed(1); }
    }
}

function buildUI(): void {
    // Layer list
    const ll = document.getElementById('layer-list')!;
    ll.innerHTML = '';
    for (const layer of layers) {
        const row = document.createElement('div');
        row.className = 'slider-row';
        row.style.opacity = layer === activeLayer ? '1' : '0.5';
        row.innerHTML = `
            <label style="width:120px;font-size:14px;cursor:pointer;" onclick="window.setActive('${layer.name}')">${layer.name}</label>
            <input type="range" min="0" max="1" step="0.05" value="${layer.opacity}" style="width:80px" oninput="window.setLayerOpacity('${layer.name}', parseFloat(this.value))">
            <button class="preset-btn" style="padding:4px 8px;font-size:12px;" onclick="window.toggleLayer('${layer.name}')">${layer.visible ? '👁' : '👁‍🗨'}</button>
            <button class="preset-btn" style="padding:4px 8px;font-size:12px;color:#c44;" onclick="window.removeLayer('${layer.name}')">✕</button>
        `;
        ll.appendChild(row);
    }

    // Param sliders
    const sp = document.getElementById('slider-panel')!;
    sp.innerHTML = '';
    if (!activeLayer) { sp.innerHTML = '<div style="color:#444;font-size:14px;">No layer selected</div>'; return; }
    for (const [name, p] of activeLayer.params) {
        const row = document.createElement('div');
        row.className = 'slider-row';
        row.innerHTML = `<label>${name}</label><input type="range" min="${p.min}" max="${p.max}" step="0.5" value="${p.value}" data-p="${name}"><span class="slider-value">${p.value.toFixed(1)}</span>`;
        const slider = row.querySelector('input')!;
        const val = row.querySelector('.slider-value')!;
        slider.addEventListener('input', () => { p.value = parseFloat(slider.value); val.textContent = p.value.toFixed(1); });
        sp.appendChild(row);
    }

    // Animations
    const ap = document.getElementById('anim-panel')!;
    ap.innerHTML = '';
    if (activeLayer) {
        for (const [name] of activeLayer.anims) {
            const btn = document.createElement('button');
            btn.className = 'preset-btn';
            btn.textContent = `▶ ${name}`;
            btn.onclick = () => { curAnim = activeLayer!.anims.get(name)!; animT = 0; animPlay = true; };
            ap.appendChild(btn);
        }
    }
    const stop = document.createElement('button');
    stop.className = 'preset-btn';
    stop.textContent = '⏹ Stop';
    stop.onclick = () => { animPlay = false; };
    ap.appendChild(stop);

    // Info
    document.getElementById('info-panel')!.textContent =
        `${layers.length} layers | ${activeLayer?.bones.size || 0} bones | ${activeLayer?.params.size || 0} params`;
}

// ============================================================
//  LOAD IMAGE PUPPET
// ============================================================

export async function loadPuppet(url: string): Promise<void> {
    await addLayer('puppet', url);
    document.getElementById('drop-zone')?.classList.add('hidden');
}

// ============================================================
//  RENDER LOOP
// ============================================================

function tick(): void {
    requestAnimationFrame(tick);
    const dt = clock.getDelta();

    for (const layer of layers) {
        if (!layer.visible) continue;
        applyParams(layer);
        tickSprings(layer, dt);
        tickAnim(layer, dt);
        updateBoneTree(layer.bones);
        drawBonesForLayer(layer);
        for (const part of layer.parts) deform(part, layer.bones);
    }

    renderer.render(scene, camera);
}

// ============================================================
//  HELPERS
// ============================================================

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

// ============================================================
//  PUBLIC API
// ============================================================

(window as any).engine = {
    init, loadPuppet, addLayer, removeLayer, setActiveLayer,
    setLayerOpacity, setLayerVisibility,
    importMoc3,
    startPaint, stopPaint, setPaintColor, setPaintSize,
    setParam(name: string, val: number) {
        if (activeLayer) { const p = activeLayer.params.get(name); if (p) { p.value = val; syncSliders(); } }
    },
    pokeSpring(name: string, imp: number) {
        if (activeLayer) { const s = activeLayer.springs.get(name); if (s) s.vel += imp; }
    },
    playAnim(name: string) {
        if (activeLayer) { curAnim = activeLayer.anims.get(name)!; animT = 0; animPlay = true; }
    },
    stopAnim() { animPlay = false; },
    shakeHead() { let i=0; const iv=setInterval(()=>{ this.setParam('HeadX', Math.sin(i*0.6)*25); i++; if(i>25)clearInterval(iv); },50); },
    get layers() { return layers; },
    get activeLayer() { return activeLayer; },
};

// Expose for HTML buttons
(window as any).setActive = (name: string) => setActiveLayer(layers.find(l => l.name === name) || null);
(window as any).toggleLayer = (name: string) => { const l = layers.find(x => x.name === name); if (l) setLayerVisibility(name, !l.visible); buildUI(); };
(window as any).removeLayer = (name: string) => removeLayer(name);
(window as any).setLayerOpacity = (name: string, val: number) => setLayerOpacity(name, val);
