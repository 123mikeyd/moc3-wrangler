/**
 * Hermes Puppet Engine v4
 * 
 * Everything: smart weights, multi-part meshes, .moc3 import,
 * click-drag posing, texture painting, animation system.
 * The VTuber engine that replaces Live2D.
 */

import * as THREE from 'three';

// ============================================================
//  TYPES
// ============================================================

interface Bone {
    name: string;
    parent: Bone | null;
    children: Bone[];
    lx: number; ly: number; lr: number;        // local
    wx: number; wy: number; wr: number;        // world
    vis: THREE.Group | null;
}

interface MeshPart {
    name: string;
    mesh: THREE.Mesh;
    restX: Float32Array;
    restY: Float32Array;
    weights: Map<string, Float32Array>;  // bone name → per-vertex weight
    z: number;
    visible: boolean;
}

interface Spring {
    bone: string;
    parent: string;
    angle: number;
    vel: number;
    stiff: number;
    damp: number;
    grav: number;
}

interface Param {
    name: string;
    min: number; max: number; value: number;
    drives: Array<{ bone: string; prop: 'rot' | 'rotX' | 'scaleY'; mult: number }>;
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

// ============================================================
//  STATE
// ============================================================

let scene: THREE.Scene;
let camera: THREE.OrthographicCamera;
let renderer: THREE.WebGLRenderer;
let clock: THREE.Clock;
let puppet: THREE.Group;

let boneMap = new Map<string, Bone>();
let partMap = new Map<string, MeshPart>();
let springMap = new Map<string, Spring>();
let paramMap = new Map<string, Param>();
let animMap = new Map<string, Anim>();

let curAnim: Anim | null = null;
let animT = 0;
let animPlay = false;

// Drag state
let dragging = false;
let dragBone: Bone | null = null;
let dragStartX = 0;
let dragStartY = 0;
let dragStartRot = 0;

// Texture paint state
let paintCanvas: HTMLCanvasElement | null = null;
let paintCtx: CanvasRenderingContext2D | null = null;
let paintTex: THREE.Texture | null = null;
let painting = false;
let paintColor = '#ff0000';
let paintSize = 8;

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

    puppet = new THREE.Group();
    scene.add(puppet);
    clock = new THREE.Clock();

    // Grid
    const grid = new THREE.GridHelper(700, 14, 0x1a1a1a, 0x141414);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -2;
    scene.add(grid);

    // Click-drag interaction
    renderer.domElement.addEventListener('mousedown', onDown);
    renderer.domElement.addEventListener('mousemove', onMove);
    renderer.domElement.addEventListener('mouseup', onUp);

    tick();
    console.log('Hermes Puppet Engine v4');
}

// ============================================================
//  BONES
// ============================================================

function addBone(name: string, parent: string | null, x: number, y: number): Bone {
    const b: Bone = { name, parent: null, children: [], lx: x, ly: y, lr: 0, wx: x, wy: y, wr: 0, vis: null };
    if (parent && boneMap.has(parent)) { b.parent = boneMap.get(parent)!; b.parent.children.push(b); }
    boneMap.set(name, b);
    return b;
}

function updateBones(): void {
    for (const b of boneMap.values()) {
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

// ============================================================
//  MESH PARTS (multi-part with smart weights)
// ============================================================

function makePart(name: string, cx: number, cy: number, w: number, h: number,
    tex: THREE.Texture, cols: number, rows: number, z: number): MeshPart {
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
    puppet.add(mesh);

    const count = verts.length/3;
    const restX = new Float32Array(count), restY = new Float32Array(count);
    for (let i = 0; i < count; i++) { restX[i]=verts[i*3]; restY[i]=verts[i*3+1]; }
    const part: MeshPart = { name, mesh, restX, restY, weights: new Map(), z, visible: true };
    partMap.set(name, part);
    return part;
}

// === SMART WEIGHT PAINTING v2 — distance-based with falloff ===

function gaussWeight(dist: number, radius: number): number {
    if (dist > radius * 2) return 0;
    const w = Math.exp(-(dist*dist) / (2 * radius * radius));
    return w * w; // sharper falloff
}

function paintWeights(part: MeshPart, boneName: string, cx: number, cy: number, radius: number, strength: number): void {
    const count = part.restX.length;
    const w = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const dx = part.restX[i] - cx;
        const dy = part.restY[i] - cy;
        const dist = Math.sqrt(dx*dx + dy*dy);
        w[i] = Math.min(1, gaussWeight(dist, radius) * strength);
    }
    part.weights.set(boneName, w);
}

function normalizeWeights(part: MeshPart): void {
    // Ensure weights sum to 1 per vertex
    const count = part.restX.length;
    const allWeights = Array.from(part.weights.values());
    for (let i = 0; i < count; i++) {
        let sum = 0;
        for (const w of allWeights) sum += w[i];
        if (sum > 0) for (const w of allWeights) w[i] /= sum;
    }
}

// Deform with multi-bone blending
function deform(part: MeshPart): void {
    if (!part.visible) { part.mesh.visible = false; return; }
    part.mesh.visible = true;
    const pos = part.mesh.geometry.getAttribute('position');
    const count = pos.count;
    const dx = new Float32Array(count);
    const dy = new Float32Array(count);

    for (const [boneName, w] of part.weights) {
        const b = boneMap.get(boneName);
        if (!b) continue;
        const ox = b.wx - b.lx;
        const oy = b.wy - b.ly;
        const cos = Math.cos(b.wr);
        const sin = Math.sin(b.wr);
        for (let i = 0; i < count; i++) {
            if (w[i] === 0) continue;
            const lx = part.restX[i] - b.lx;
            const ly = part.restY[i] - b.ly;
            dx[i] += (lx*cos - ly*sin + b.lx - part.restX[i] + ox) * w[i];
            dy[i] += (lx*sin + ly*cos + b.ly - part.restY[i] + oy) * w[i];
        }
    }
    for (let i = 0; i < count; i++) pos.setXY(i, part.restX[i]+dx[i], part.restY[i]+dy[i]);
    pos.needsUpdate = true;
}

// ============================================================
//  SPRINGS
// ============================================================

function tickSprings(dt: number): void {
    const cd = Math.min(dt, 0.04);
    for (const s of springMap.values()) {
        const p = boneMap.get(s.parent);
        const c = boneMap.get(s.bone);
        if (!p || !c) continue;
        const target = p.lr;
        s.vel += ((target - s.angle) * s.stiff + (-s.angle * s.grav * 0.08)) * cd * 60;
        s.vel *= s.damp;
        s.angle += s.vel * cd * 60;
        c.lr = s.angle;
    }
}

// ============================================================
//  PARAMETERS
// ============================================================

function applyParams(): void {
    for (const p of paramMap.values()) {
        for (const d of p.drives) {
            const b = boneMap.get(d.bone);
            if (!b) continue;
            const v = p.value * d.mult;
            if (d.prop === 'rot') b.lr = v * Math.PI / 180;
        }
    }
}

// ============================================================
//  ANIMATIONS
// ============================================================

function tickAnim(dt: number): void {
    if (!animPlay || !curAnim) return;
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
    const e = ease(t, next.ease);
    for (const [name, p] of paramMap) {
        const pv = prev.vals[name] ?? p.value;
        const nv = next.vals[name] ?? p.value;
        p.value = pv + (nv - pv) * e;
    }
    syncSliders();
}

function ease(t: number, type: string): number {
    if (type === 'in') return t*t;
    if (type === 'out') return t*(2-t);
    if (type === 'inout') return t<0.5 ? 2*t*t : -1+(4-2*t)*t;
    return t;
}

// ============================================================
//  CLICK-DRAG POSING
// ============================================================

function screenToWorld(ex: number, ey: number): [number, number] {
    const rect = renderer.domElement.getBoundingClientRect();
    const a = rect.width / rect.height;
    const s = 350;
    const nx = ((ex - rect.left) / rect.width) * 2 - 1;
    const ny = -((ey - rect.top) / rect.height) * 2 + 1;
    return [nx * s * a, ny * s];
}

function findNearestBone(wx: number, wy: number): Bone | null {
    let best: Bone | null = null;
    let bestDist = 50; // max click radius
    for (const b of boneMap.values()) {
        const d = Math.sqrt((b.wx - wx)**2 + (b.wy - wy)**2);
        if (d < bestDist) { bestDist = d; best = b; }
    }
    return best;
}

function onDown(e: MouseEvent): void {
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    const bone = findNearestBone(wx, wy);
    if (bone) {
        dragging = true;
        dragBone = bone;
        dragStartX = wx;
        dragStartY = wy;
        dragStartRot = bone.lr;
        renderer.domElement.style.cursor = 'grabbing';
    }
}

function onMove(e: MouseEvent): void {
    if (!dragging || !dragBone) return;
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    const dx = wx - dragBone.wx;
    const dy = wy - dragBone.wy;
    const angle = Math.atan2(dy, dx);
    dragBone.lr = angle + Math.PI/2; // rotate to point at mouse
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

export function initPaint(partName: string): void {
    const part = partMap.get(partName);
    if (!part) return;
    const mat = part.mesh.material as THREE.MeshBasicMaterial;
    const tex = mat.map;
    if (!tex || !tex.image) return;

    paintCanvas = document.createElement('canvas');
    paintCanvas.width = tex.image.width;
    paintCanvas.height = tex.image.height;
    paintCtx = paintCanvas.getContext('2d')!;
    paintCtx.drawImage(tex.image, 0, 0);
    paintTex = new THREE.CanvasTexture(paintCanvas);
    mat.map = paintTex;
    mat.needsUpdate = true;

    renderer.domElement.addEventListener('mousedown', onPaintStart);
    renderer.domElement.addEventListener('mousemove', onPaintMove);
    renderer.domElement.addEventListener('mouseup', onPaintEnd);
    console.log('Paint mode on:', partName);
}

function onPaintStart(e: MouseEvent): void {
    if (!paintCtx) return;
    painting = true;
    paintAt(e);
}

function onPaintMove(e: MouseEvent): void {
    if (!painting || !paintCtx) return;
    paintAt(e);
}

function onPaintEnd(): void {
    painting = false;
    if (paintTex) paintTex.needsUpdate = true;
}

function paintAt(e: MouseEvent): void {
    if (!paintCtx || !paintCanvas) return;
    // Map screen coords to texture coords (simplified — assumes full-image part)
    const rect = renderer.domElement.getBoundingClientRect();
    const tx = ((e.clientX - rect.left) / rect.width) * paintCanvas.width;
    const ty = ((e.clientY - rect.top) / rect.height) * paintCanvas.height;
    paintCtx.fillStyle = paintColor;
    paintCtx.beginPath();
    paintCtx.arc(tx, ty, paintSize, 0, Math.PI*2);
    paintCtx.fill();
    if (paintTex) paintTex.needsUpdate = true;
}

export function setPaintColor(color: string): void { paintColor = color; }
export function setPaintSize(size: number): void { paintSize = size; }
export function stopPaint(): void {
    paintCanvas = null; paintCtx = null; paintTex = null; painting = false;
}

// ============================================================
//  .MOC3 IMPORT (bridge to our Cubism integration)
// ============================================================

export async function importMoc3(modelName: string): Promise<void> {
    console.log('Importing .moc3:', modelName);
    
    // Fetch model info from editor backend
    const info = await fetch(`http://localhost:8080/api/model/${modelName}/info`).then(r => r.json());
    
    // Clear previous
    boneMap.clear(); partMap.clear(); springMap.clear(); paramMap.clear(); animMap.clear();
    while (puppet.children.length) puppet.remove(puppet.children[0]);
    
    // Load all textures
    const textures: THREE.Texture[] = [];
    for (const texPath of info.textures) {
        const url = `/live2d-models/${modelName}/runtime/${texPath}`;
        const tex = await new Promise<THREE.Texture>(r => new THREE.TextureLoader().load(url, r));
        textures.push(tex);
    }
    
    // Create bones from parameter names (heuristic)
    addBone('root', null, 0, 0);
    addBone('head', 'root', 0, 200);
    addBone('body', 'root', 0, -50);
    
    // Map known Live2D params to our params
    const paramMap: Record<string, { bone: string; prop: 'rot'; mult: number }> = {
        'PARAM_ANGLE_X': { bone: 'head', prop: 'rot', mult: 1 },
        'PARAM_ANGLE_Y': { bone: 'head', prop: 'rot', mult: 0.5 },
        'PARAM_BODY_X': { bone: 'body', prop: 'rot', mult: 1 },
        'PARAM_ARM_L': { bone: 'body', prop: 'rot', mult: 0.5 },
        'PARAM_ARM_R': { bone: 'body', prop: 'rot', mult: -0.5 },
    };
    
    for (const [paramId, paramInfo] of Object.entries(info.parameters)) {
        const drive = paramMap[paramId];
        if (drive) {
            const min = -30, max = 30; // default range
            addParam(paramId.replace('PARAM_', ''), min, max, 0, [drive]);
        }
    }
    
    // Create mesh parts from textures
    for (let i = 0; i < textures.length; i++) {
        const tex = textures[i];
        const w = tex.image?.width || 1024;
        const h = tex.image?.height || 1024;
        const part = makePart(`tex_${i}`, 0, 0, w * 0.5, h * 0.5, tex, 6, 6, i);
        
        // Simple weights: everything to root, head gets top half
        paintWeights(part, 'root', 0, 0, w, 1.0);
        paintWeights(part, 'head', 0, h * 0.15, w * 0.3, 0.8);
        paintWeights(part, 'body', 0, -h * 0.1, w * 0.25, 0.8);
        normalizeWeights(part);
    }
    
    // Load motions
    for (const [group, motions] of Object.entries(info.motions || {})) {
        if (Array.isArray(motions) && motions.length > 0) {
            // Create a simple animation from first motion
            const firstMotion = motions[0];
            if (firstMotion.exists) {
                animMap.set(`${group}_0`, {
                    name: `${group}_0`,
                    dur: firstMotion.duration || 3,
                    loop: firstMotion.loop !== false,
                    kfs: [
                        { t: 0, vals: {}, ease: 'inout' },
                        { t: (firstMotion.duration || 3) / 2, vals: { 'ANGLE_X': 10 }, ease: 'inout' },
                        { t: firstMotion.duration || 3, vals: {}, ease: 'inout' },
                    ]
                });
            }
        }
    }
    
    buildUI();
    console.log(`Imported: ${modelName}, ${boneMap.size} bones, ${partMap.size} parts, ${paramMap.size} params`);
}

// ============================================================
//  BONE VISUALIZERS
// ============================================================

function drawBones(): void {
    puppet.children = puppet.children.filter(c => !String(c.name).startsWith('bv'));
    for (const b of boneMap.values()) {
        const g = new THREE.Group();
        g.name = `bv_${b.name}`;
        
        // Joint
        const j = new THREE.Mesh(
            new THREE.CircleGeometry(dragging && dragBone === b ? 8 : 5, 12),
            new THREE.MeshBasicMaterial({
                color: dragging && dragBone === b ? 0xff4444 : 0x00ddff,
                transparent: true, opacity: 0.8, side: THREE.DoubleSide
            })
        );
        j.position.set(b.wx, b.wy, 60);
        g.add(j);
        
        // Line to parent
        if (b.parent) {
            g.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(b.wx, b.wy, 60),
                    new THREE.Vector3(b.parent.wx, b.parent.wy, 60)
                ]),
                new THREE.LineBasicMaterial({ color: 0x00ddff, transparent: true, opacity: 0.5 })
            ));
        }
        puppet.add(g);
    }
}

// ============================================================
//  SLIDER SYNC
// ============================================================

function syncSliders(): void {
    for (const [name, p] of paramMap) {
        const s = document.querySelector(`input[data-p="${name}"]`) as HTMLInputElement;
        if (s) { s.value = String(p.value); (s.nextElementSibling as HTMLElement).textContent = p.value.toFixed(1); }
    }
}

// ============================================================
//  UI
// ============================================================

function buildUI(): void {
    const sp = document.getElementById('slider-panel')!;
    sp.innerHTML = '';
    for (const [name, p] of paramMap) {
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
    for (const [name] of animMap) {
        const btn = document.createElement('button');
        btn.className = 'preset-btn';
        btn.textContent = `▶ ${name}`;
        btn.onclick = () => { curAnim = animMap.get(name)!; animT = 0; animPlay = true; };
        ap.appendChild(btn);
    }
    const stop = document.createElement('button');
    stop.className = 'preset-btn';
    stop.textContent = '⏹ Stop';
    stop.onclick = () => { animPlay = false; };
    ap.appendChild(stop);
    
    document.getElementById('info-panel')!.textContent =
        `${boneMap.size} bones | ${partMap.size} meshes | ${paramMap.size} params | ${animMap.size} anims`;
}

// helper for loadPuppet to add params
function addParam(name: string, min: number, max: number, def: number,
    drives: Array<{bone:string;prop:'rot';mult:number}>): void {
    paramMap.set(name, { name, min, max, value: def, drives });
}

// ============================================================
//  LOAD PUPPET (from image)
// ============================================================

export async function loadPuppet(url: string): Promise<void> {
    const tex = await new Promise<THREE.Texture>(r => new THREE.TextureLoader().load(url, r));
    const W = tex.image?.width || 512;
    const H = tex.image?.height || 512;
    
    boneMap.clear(); partMap.clear(); springMap.clear(); paramMap.clear(); animMap.clear();
    while (puppet.children.length) puppet.remove(puppet.children[0]);
    
    // 15 bones
    addBone('root', null, 0, 0);
    addBone('body', 'root', 0, -H*0.05);
    addBone('head', 'root', 0, H*0.22);
    addBone('hair_main', 'head', 0, H*0.05);
    addBone('hair_l', 'head', -W*0.18, H*0.1);
    addBone('hair_r', 'head', W*0.18, H*0.1);
    addBone('eye_l', 'head', -W*0.09, H*0.01);
    addBone('eye_r', 'head', W*0.09, H*0.01);
    addBone('mouth', 'head', 0, -H*0.04);
    addBone('arm_l', 'body', -W*0.2, H*0.02);
    addBone('arm_r', 'body', W*0.2, H*0.02);
    addBone('fore_l', 'arm_l', 0, -H*0.1);
    addBone('fore_r', 'arm_r', 0, -H*0.1);
    addBone('skirt', 'body', 0, -H*0.15);
    addBone('neck', 'root', 0, H*0.1);
    
    // Full body mesh
    const part = makePart('body', 0, 0, W, H, tex, 12, 12, 0);
    
    // Distance-based weights
    paintWeights(part, 'head', 0, H*0.22, W*0.18, 1.0);
    paintWeights(part, 'hair_main', 0, H*0.35, W*0.22, 0.85);
    paintWeights(part, 'hair_l', -W*0.2, H*0.25, W*0.1, 0.8);
    paintWeights(part, 'hair_r', W*0.2, H*0.25, W*0.1, 0.8);
    paintWeights(part, 'eye_l', -W*0.09, H*0.19, W*0.05, 0.9);
    paintWeights(part, 'eye_r', W*0.09, H*0.19, W*0.05, 0.9);
    paintWeights(part, 'body', 0, -H*0.05, W*0.15, 1.0);
    paintWeights(part, 'arm_l', -W*0.22, H*0.0, W*0.1, 0.9);
    paintWeights(part, 'arm_r', W*0.22, H*0.0, W*0.1, 0.9);
    paintWeights(part, 'fore_l', -W*0.22, -H*0.12, W*0.08, 0.85);
    paintWeights(part, 'fore_r', W*0.22, -H*0.12, W*0.08, 0.85);
    normalizeWeights(part);
    
    // Springs
    springMap.set('hair_main', { bone:'hair_main', parent:'head', angle:0, vel:0, stiff:0.4, damp:0.82, grav:0.5 });
    springMap.set('hair_l', { bone:'hair_l', parent:'head', angle:0, vel:0, stiff:0.35, damp:0.85, grav:0.45 });
    springMap.set('hair_r', { bone:'hair_r', parent:'head', angle:0, vel:0, stiff:0.35, damp:0.85, grav:0.45 });
    springMap.set('skirt', { bone:'skirt', parent:'body', angle:0, vel:0, stiff:0.25, damp:0.88, grav:0.3 });
    
    // Params
    addParam('HeadX', -30, 30, 0, [{bone:'head',prop:'rot',mult:1}]);
    addParam('HeadTilt', -20, 20, 0, [{bone:'head',prop:'rot',mult:0.4}]);
    addParam('BodyX', -15, 15, 0, [{bone:'body',prop:'rot',mult:1}]);
    addParam('EyeL', 0, 1.2, 1, []);
    addParam('EyeR', 0, 1.2, 1, []);
    addParam('ArmL', -55, 55, 0, [{bone:'arm_l',prop:'rot',mult:1}]);
    addParam('ArmR', -55, 55, 0, [{bone:'arm_r',prop:'rot',mult:-1}]);
    addParam('ForeL', -90, 90, 0, [{bone:'fore_l',prop:'rot',mult:1}]);
    addParam('ForeR', -90, 90, 0, [{bone:'fore_r',prop:'rot',mult:-1}]);
    
    // Animations
    animMap.set('idle_breath', { name:'idle_breath', dur:4, loop:true, kfs:[
        {t:0,vals:{BodyX:-1},ease:'inout'},{t:2,vals:{BodyX:1},ease:'inout'},{t:4,vals:{BodyX:-1},ease:'inout'}
    ]});
    animMap.set('look_around', { name:'look_around', dur:6, loop:true, kfs:[
        {t:0,vals:{HeadX:0},ease:'inout'},{t:1.5,vals:{HeadX:-15},ease:'inout'},
        {t:3,vals:{HeadX:0},ease:'inout'},{t:4.5,vals:{HeadX:15},ease:'inout'},{t:6,vals:{HeadX:0},ease:'inout'}
    ]});
    animMap.set('wave', { name:'wave', dur:2, loop:false, kfs:[
        {t:0,vals:{ArmR:0},ease:'out'},{t:0.4,vals:{ArmR:-50},ease:'inout'},
        {t:0.8,vals:{ArmR:-30},ease:'inout'},{t:1.2,vals:{ArmR:-50},ease:'inout'},{t:2,vals:{ArmR:0},ease:'in'}
    ]});
    
    buildUI();
    console.log(`Loaded: ${W}x${H}, ${boneMap.size} bones, ${partMap.size} meshes`);
}

// ============================================================
//  RENDER LOOP
// ============================================================

function tick(): void {
    requestAnimationFrame(tick);
    const dt = clock.getDelta();
    applyParams();
    tickSprings(dt);
    tickAnim(dt);
    updateBones();
    drawBones();
    for (const p of partMap.values()) deform(p);
    renderer.render(scene, camera);
}

// ============================================================
//  PUBLIC API
// ============================================================

(window as any).engine = {
    init, loadPuppet, importMoc3,
    initPaint, setPaintColor, setPaintSize, stopPaint,
    setParam(name: string, val: number) { const p = paramMap.get(name); if (p) { p.value = val; syncSliders(); } },
    pokeSpring(name: string, imp: number) { const s = springMap.get(name); if (s) s.vel += imp; },
    playAnim(name: string) { curAnim = animMap.get(name)!; animT = 0; animPlay = true; },
    stopAnim() { animPlay = false; },
    shakeHead() { let i=0; const iv=setInterval(()=>{ this.setParam('HeadX', Math.sin(i*0.6)*25); i++; if(i>25)clearInterval(iv); },50); },
    get params() { return paramMap; },
    get bones() { return boneMap; },
    get parts() { return partMap; },
    get springs() { return springMap; },
};
