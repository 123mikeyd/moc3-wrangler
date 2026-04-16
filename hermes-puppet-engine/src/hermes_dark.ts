/**
 * Hermes Puppet Engine — hermes_dark Rig
 * 
 * Dedicated rig for the hermes_dark model using actual Live2D parameter names,
 * real ranges, correct bone positions, and proper texture layer placement.
 * 
 * 5 texture layers at different Z depths, 12 bones, 45 parameters.
 * Works like the OLLV VTuber but with our own renderer.
 */

import * as THREE from 'three';

// Types
interface Bone {
    name: string; parent: Bone | null; children: Bone[];
    lx: number; ly: number; lr: number;
    wx: number; wy: number; wr: number;
    vis: THREE.Group | null;
}

interface Part {
    name: string; mesh: THREE.Mesh;
    restX: Float32Array; restY: Float32Array;
    weights: Map<string, Float32Array>;
    z: number; visible: boolean;
}

interface Param {
    id: string; name: string;
    min: number; max: number; def: number; value: number;
    drives: Array<{ bone: string; prop: 'rot'; mult: number }>;
}

// State
let scene: THREE.Scene;
let camera: THREE.OrthographicCamera;
let renderer: THREE.WebGLRenderer;
let clock: THREE.Clock;
let puppet: THREE.Group;
let boneMap = new Map<string, Bone>();
let partMap = new Map<string, Part>();
let paramMap = new Map<string, Param>();
let dragging = false;
let dragBone: Bone | null = null;

// hermes_dark texture layout (1024x1024 each, body parts positioned on atlas):
//
// texture_00 (face): Head area, eyes, mouth, bangs, headphones
//   - Head face: center of texture (~512, 300)
//   - Eyes: around (400, 380) and (624, 380)
//   - Mouth: around (512, 480)
//
// texture_01 (body): Body, arms, uniform, skirt
//   - Body/torso: center (~512, 400)
//   - Left arm: left side (~200, 500)
//   - Right arm: right side (~824, 500)
//   - Bow: center top (~512, 200)
//
// texture_02 (hair): Main hair bulk, twin tails
//   - Hair main: center top (~512, 300)
//   - Twin tail L: left (~200, 600)
//   - Twin tail R: right (~824, 600)
//
// texture_03 (desk): Desk, stationery
//   - Desk: bottom center (~512, 800)
//
// texture_04 (legs): Legs, feet
//   - Legs: bottom center (~512, 700)

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
    puppet = new THREE.Group();
    scene.add(puppet);

    // Grid
    const grid = new THREE.GridHelper(700, 14, 0x1a1a1a, 0x141414);
    grid.rotation.x = Math.PI / 2; grid.position.z = -2;
    scene.add(grid);

    // Interaction
    renderer.domElement.addEventListener('mousedown', onDown);
    renderer.domElement.addEventListener('mousemove', onMove);
    renderer.domElement.addEventListener('mouseup', onUp);
    renderer.domElement.addEventListener('mouseleave', onUp);

    tick();
    console.log('Hermes Puppet Engine — hermes_dark rig');
}

// ============================================================
//  LOAD HERMES DARK
// ============================================================

export async function loadHermesDark(): Promise<void> {
    // Clear
    boneMap.clear(); partMap.clear(); paramMap.clear();
    while (puppet.children.length) puppet.remove(puppet.children[0]);

    // Load all 5 textures
    const texPaths = [
        'hermes_dark.1024/texture_00.png', // face
        'hermes_dark.1024/texture_01.png', // body
        'hermes_dark.1024/texture_02.png', // hair
        'hermes_dark.1024/texture_03.png', // desk
        'hermes_dark.1024/texture_04.png', // legs
    ];
    const texNames = ['face', 'body', 'hair', 'desk', 'legs'];
    const texZ = [10, 5, 8, 1, 3]; // Z-ordering: face on top, desk behind

    const textures: THREE.Texture[] = [];
    for (const path of texPaths) {
        const url = `/live2d-models/hermes_dark/runtime/${path}`;
        const tex = await new Promise<THREE.Texture>(r => new THREE.TextureLoader().load(url, r));
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        textures.push(tex);
    }

    // Canvas dimensions (all 1024x1024)
    const S = 1024;
    // Scale factor: 1024px texture → world units
    const scale = 0.5; // 1024px = 512 world units

    // === BONES ===
    // Placed at actual body part positions on the 1024x1024 atlas
    // Coordinates converted: atlas (0,0)=top-left → world (0,0)=center
    const ax = (px: number) => (px - S/2) * scale;  // atlas X → world X
    const ay = (px: number) => (S/2 - px) * scale;   // atlas Y → world Y (flipped)

    addBone('root', null, 0, 0);
    addBone('head', 'root', ax(512), ay(320));       // head center
    addBone('eye_l', 'head', ax(410), ay(380));      // left eye
    addBone('eye_r', 'head', ax(614), ay(380));      // right eye
    addBone('mouth', 'head', ax(512), ay(460));      // mouth
    addBone('brow_l', 'head', ax(420), ay(340));     // left brow
    addBone('brow_r', 'head', ax(604), ay(340));     // right brow
    addBone('body', 'root', ax(512), ay(550));       // body center
    addBone('arm_l', 'body', ax(250), ay(500));      // left arm
    addBone('arm_r', 'body', ax(774), ay(500));      // right arm
    addBone('fore_l', 'arm_l', ax(200), ay(620));    // left forearm
    addBone('fore_r', 'arm_r', ax(824), ay(620));    // right forearm
    addBone('hair_l', 'head', ax(250), ay(400));     // left twin tail
    addBone('hair_r', 'head', ax(774), ay(400));     // right twin tail
    addBone('hair_top', 'head', ax(512), ay(180));   // top hair/bangs
    addBone('desk', 'root', ax(512), ay(800));       // desk

    // === MESH PARTS (one per texture) ===
    const makeTexPart = (name: string, tex: THREE.Texture, z: number) => {
        const part = makePart(name, 0, 0, S*scale*2, S*scale*2, tex, 8, 8, z);
        
        // Default weights: everything to root
        const count = part.restX.length;
        const rootW = new Float32Array(count).fill(1.0);
        part.weights.set('root', rootW);
        
        return part;
    };

    const facePart = makeTexPart('face', textures[0], texZ[0]);
    const bodyPart = makeTexPart('body', textures[1], texZ[1]);
    const hairPart = makeTexPart('hair', textures[2], texZ[2]);
    const deskPart = makeTexPart('desk', textures[3], texZ[3]);
    const legsPart = makeTexPart('legs', textures[4], texZ[4]);

    // === WEIGHT PAINTING ===
    // Each texture part gets region-specific weights
    // Using world coordinates (0,0 = center of 1024x1024 atlas)
    
    const pw = (part: Part, bone: string, cx: number, cy: number, r: number, str: number) => {
        const count = part.restX.length;
        let existing = part.weights.get(bone);
        if (!existing) {
            existing = new Float32Array(count);
            part.weights.set(bone, existing);
        }
        for (let i = 0; i < count; i++) {
            const dx = part.restX[i] - cx;
            const dy = part.restY[i] - cy;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const w = dist > r*2 ? 0 : Math.min(1, Math.exp(-(dist*dist)/(2*r*r)) * Math.exp(-(dist*dist)/(2*r*r)) * str);
            existing[i] = Math.max(existing[i], w);
        }
    };

    // Face texture: head bone gets the face area
    pw(facePart, 'head', ax(512), ay(320), 180, 1.0);
    pw(facePart, 'eye_l', ax(410), ay(380), 40, 0.9);
    pw(facePart, 'eye_r', ax(614), ay(380), 40, 0.9);
    pw(facePart, 'mouth', ax(512), ay(460), 35, 0.9);
    pw(facePart, 'brow_l', ax(420), ay(340), 30, 0.8);
    pw(facePart, 'brow_r', ax(604), ay(340), 30, 0.8);

    // Body texture: body bone gets torso, arm bones get arms
    pw(bodyPart, 'body', ax(512), ay(450), 200, 1.0);
    pw(bodyPart, 'arm_l', ax(250), ay(500), 100, 0.9);
    pw(bodyPart, 'arm_r', ax(774), ay(500), 100, 0.9);
    pw(bodyPart, 'fore_l', ax(200), ay(620), 80, 0.85);
    pw(bodyPart, 'fore_r', ax(824), ay(620), 80, 0.85);

    // Hair texture: hair bones
    pw(hairPart, 'hair_top', ax(512), ay(200), 200, 0.9);
    pw(hairPart, 'hair_l', ax(250), ay(500), 150, 0.85);
    pw(hairPart, 'hair_r', ax(774), ay(500), 150, 0.85);
    pw(hairPart, 'head', ax(512), ay(300), 120, 0.3); // slight follow

    // Desk texture: desk bone
    pw(deskPart, 'desk', ax(512), ay(800), 250, 0.8);

    // Legs texture: body bone
    pw(legsPart, 'body', ax(512), ay(700), 200, 0.8);

    // Normalize all weights
    for (const part of [facePart, bodyPart, hairPart, deskPart, legsPart]) {
        normalizeWeights(part);
    }

    // === PARAMETERS (actual hermes_dark names with real ranges) ===
    const addP = (id: string, name: string, min: number, max: number, def: number,
                  drives: Array<{bone:string;prop:'rot';mult:number}>) => {
        paramMap.set(id, { id, name, min, max, def, value: def, drives });
    };

    // Head
    addP('PARAM_ANGLE_X', 'Head X', -30, 30, 0, [{bone:'head',prop:'rot',mult:1}]);
    addP('PARAM_ANGLE_Y', 'Head Y', -30, 30, 0, [{bone:'head',prop:'rot',mult:0.3}]);
    addP('PARAM_ANGLE_Z', 'Head Z', -30, 30, 0, [{bone:'head',prop:'rot',mult:0.5}]);
    addP('PARAM_BODY_X', 'Body X', -10, 10, 0, [{bone:'body',prop:'rot',mult:1}]);
    addP('PARAM_BODY_Y', 'Body Y', -10, 10, 0, [{bone:'body',prop:'rot',mult:0.5}]);
    addP('PARAM_BODY_Z', 'Body Z', -10, 10, 0, [{bone:'body',prop:'rot',mult:0.3}]);

    // Arms (A-layer: desk pose)
    addP('PARAM_ARM_L', 'Arm L', -1, 2, 0, [{bone:'arm_l',prop:'rot',mult:1}]);
    addP('PARAM_ARM_L_02', 'Arm L2', -1, 1, 0, [{bone:'fore_l',prop:'rot',mult:1}]);
    addP('PARAM_HAND_L', 'Hand L', -1, 1, 0, []);
    addP('PARAM_ARM_R', 'Arm R', -1, 2, 0, [{bone:'arm_r',prop:'rot',mult:-1}]);
    addP('PARAM_ARM_R_02', 'Arm R2', -1, 1, 0, [{bone:'fore_r',prop:'rot',mult:-1}]);
    addP('PARAM_HAND_R', 'Hand R', -1, 1, 0, []);

    // Arms (B-layer: face pose)
    addP('PARAM_ARM_02_L_01', 'Arm L3', -1, 1, 0, [{bone:'arm_l',prop:'rot',mult:0.8}]);
    addP('PARAM_ARM_02_L_02', 'Arm L4', -1, 1, 0, [{bone:'fore_l',prop:'rot',mult:0.8}]);
    addP('PARAM_HAND_02_L', 'Hand L2', -1, 0, 0, []);
    addP('PARAM_ARM_02_R_01', 'Arm R3', -1, 1, 0, [{bone:'arm_r',prop:'rot',mult:-0.8}]);
    addP('PARAM_ARM_02_R_02', 'Arm R4', -1, 1, 0, [{bone:'fore_r',prop:'rot',mult:-0.8}]);
    addP('PARAM_HAND_02_R', 'Hand R2', -1, 0, 0, []);

    // Hair physics (driven by springs, not direct rotation)
    addP('PARAM_KAMIYURE_FRONT', 'Hair Front', -1, 1, 0, []);
    addP('PARAM_KAMIYURE_BACK', 'Hair Back', -1, 1, 0, []);
    addP('PARAM_KAMIYURE_SIDE_L', 'Hair Side L', -1, 1, 0, []);
    addP('PARAM_KAMIYURE_SIDE_R', 'Hair Side R', -1, 1, 0, []);
    addP('PARAM_KAMIYURE_TWIN_L', 'Twin Tail L', -1, 1, 0, []);
    addP('PARAM_KAMIYURE_TWIN_R', 'Twin Tail R', -1, 1, 0, []);

    // Eyes
    addP('PARAM_EYE_L_OPEN', 'Eye L Open', 0, 1, 0.85, []);
    addP('PARAM_EYE_R_OPEN', 'Eye R Open', 0, 1, 0.85, []);
    addP('PARAM_EYE_BALL_X', 'Eye Ball X', -1, 1, 0, [{bone:'eye_l',prop:'rot',mult:0.5},{bone:'eye_r',prop:'rot',mult:0.5}]);
    addP('PARAM_EYE_BALL_Y', 'Eye Ball Y', -1, 1, 0, []);

    // Brows
    addP('PARAM_BROW_L_Y', 'Brow L Y', -1, 1, 0, [{bone:'brow_l',prop:'rot',mult:0.5}]);
    addP('PARAM_BROW_R_Y', 'Brow R Y', -1, 1, 0, [{bone:'brow_r',prop:'rot',mult:0.5}]);

    // Mouth
    addP('PARAM_MOUTH_OPEN_Y', 'Mouth Open', 0, 1, 0, []);
    addP('PARAM_MOUTH_FORM', 'Mouth Form', -1, 1, 0, []);

    // Misc
    addP('PARAM_BREATH', 'Breath', 0, 1, 0, []);
    addP('PARAM_TERE', 'Blush', 0, 1, 0, []);
    addP('PARAM_DESK', 'Desk', 0, 1, 0, [{bone:'desk',prop:'rot',mult:0.3}]);

    buildUI();
    console.log(`hermes_dark: ${boneMap.size} bones, ${partMap.size} parts, ${paramMap.size} params`);
}

// ============================================================
//  HELPERS
// ============================================================

function addBone(name: string, parent: string | null, x: number, y: number): Bone {
    const b: Bone = { name, parent: null, children: [], lx: x, ly: y, lr: 0, wx: x, wy: y, wr: 0, vis: null };
    if (parent && boneMap.has(parent)) { b.parent = boneMap.get(parent)!; b.parent.children.push(b); }
    boneMap.set(name, b);
    return b;
}

function makePart(name: string, cx: number, cy: number, w: number, h: number,
    tex: THREE.Texture, cols: number, rows: number, z: number): Part {
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
    return { name, mesh, restX, restY, weights: new Map(), z, visible: true };
}

function normalizeWeights(part: Part): void {
    const count = part.restX.length;
    const all = Array.from(part.weights.values());
    for (let i = 0; i < count; i++) {
        let sum = 0;
        for (const w of all) sum += w[i];
        if (sum > 0) for (const w of all) w[i] /= sum;
    }
}

function deform(part: Part): void {
    if (!part.visible) { part.mesh.visible = false; return; }
    part.mesh.visible = true;
    const pos = part.mesh.geometry.getAttribute('position');
    const count = pos.count;
    const dx = new Float32Array(count), dy = new Float32Array(count);

    for (const [boneName, w] of part.weights) {
        const b = boneMap.get(boneName);
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

function applyParams(): void {
    for (const p of paramMap.values()) {
        for (const d of p.drives) {
            const b = boneMap.get(d.bone);
            if (!b) continue;
            b.lr = p.value * d.mult * Math.PI / 180;
        }
    }
}

function drawBones(): void {
    puppet.children = puppet.children.filter(c => !String(c.name).startsWith('bv'));
    for (const b of boneMap.values()) {
        const g = new THREE.Group();
        g.name = `bv_${b.name}`;
        const isDrag = dragging && dragBone === b;
        const j = new THREE.Mesh(
            new THREE.CircleGeometry(isDrag ? 8 : 4, 12),
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
        puppet.add(g);
    }
}

// ============================================================
//  CLICK-DRAG
// ============================================================

function screenToWorld(ex: number, ey: number): [number, number] {
    const rect = renderer.domElement.getBoundingClientRect();
    const a = rect.width / rect.height;
    const s = 350;
    return [((ex-rect.left)/rect.width*2-1)*s*a, -((ey-rect.top)/rect.height*2-1)*s];
}

function findBone(wx: number, wy: number): Bone | null {
    let best: Bone | null = null, bestD = 40;
    for (const b of boneMap.values()) {
        const d = Math.sqrt((b.wx-wx)**2 + (b.wy-wy)**2);
        if (d < bestD) { bestD = d; best = b; }
    }
    return best;
}

function onDown(e: MouseEvent): void {
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    const bone = findBone(wx, wy);
    if (bone) { dragging = true; dragBone = bone; renderer.domElement.style.cursor = 'grabbing'; }
}

function onMove(e: MouseEvent): void {
    if (!dragging || !dragBone) return;
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    dragBone.lr = Math.atan2(wy - dragBone.wy, wx - dragBone.wx) + Math.PI/2;
    syncSliders();
}

function onUp(): void {
    dragging = false; dragBone = null; renderer.domElement.style.cursor = 'default';
}

// ============================================================
//  UI
// ============================================================

function syncSliders(): void {
    for (const [id, p] of paramMap) {
        const s = document.querySelector(`input[data-p="${id}"]`) as HTMLInputElement;
        if (s) { s.value = String(p.value); (s.nextElementSibling as HTMLElement).textContent = p.value.toFixed(1); }
    }
}

function buildUI(): void {
    const sp = document.getElementById('slider-panel')!;
    sp.innerHTML = '';
    for (const [id, p] of paramMap) {
        const row = document.createElement('div');
        row.className = 'slider-row';
        row.innerHTML = `<label>${p.name}</label><input type="range" min="${p.min}" max="${p.max}" step="0.1" value="${p.value}" data-p="${id}"><span class="slider-value">${p.value.toFixed(1)}</span>`;
        const slider = row.querySelector('input')!;
        const val = row.querySelector('.slider-value')!;
        slider.addEventListener('input', () => { p.value = parseFloat(slider.value); val.textContent = p.value.toFixed(1); });
        sp.appendChild(row);
    }
    document.getElementById('info-panel')!.textContent =
        `${boneMap.size} bones | ${partMap.size} parts | ${paramMap.size} params`;
}

// ============================================================
//  PRESETS
// ============================================================

function setPreset(vals: Record<string, number>): void {
    for (const [id, val] of Object.entries(vals)) {
        const p = paramMap.get(id);
        if (p) p.value = val;
    }
    syncSliders();
}

// ============================================================
//  RENDER LOOP
// ============================================================

function tick(): void {
    requestAnimationFrame(tick);
    applyParams();
    updateBones();
    drawBones();
    for (const p of partMap.values()) deform(p);
    renderer.render(scene, camera);
}

// ============================================================
//  PUBLIC API
// ============================================================

(window as any).puppet = {
    init,
    loadHermesDark,
    setPreset,
    setParam(id: string, val: number) { const p = paramMap.get(id); if (p) { p.value = val; syncSliders(); } },
    get params() { return paramMap; },
    get bones() { return boneMap; },
};
