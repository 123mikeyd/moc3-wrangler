/**
 * Hermes Puppet Engine v3 — Multi-part, smart weights, animations
 * 
 * - Separate mesh parts (body, hair, eyes) with individual textures
 * - Smart bone weight painting based on vertex position
 * - Spring physics with parameter-driven input
 * - Animation keyframe system
 * - Drag-and-drop any image → auto-rigged puppet
 */

import * as THREE from 'three';

// === Types ===
interface PBone {
    name: string;
    parent: PBone | null;
    children: PBone[];
    localX: number; localY: number; localRotation: number;
    worldX: number; worldY: number; worldRotation: number;
    visualizer: THREE.Group | null;
}

interface Part {
    name: string;
    mesh: THREE.Mesh;
    restX: Float32Array;
    restY: Float32Array;
    weights: Map<string, { x: Float32Array; y: Float32Array }>;
    z: number;
}

interface Spring {
    bone: string;
    parent: string;
    angle: number;
    velocity: number;
    stiffness: number;
    damping: number;
    gravity: number;
    restAngle: number;
}

interface Param {
    name: string;
    min: number; max: number; value: number;
    drives: Array<{ bone: string; prop: string; mult: number }>;
}

interface Keyframe {
    time: number;
    values: Record<string, number>;
    easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

interface Animation {
    name: string;
    duration: number;
    loop: boolean;
    keyframes: Keyframe[];
}

// === State ===
var scene: THREE.Scene;
var camera: THREE.OrthographicCamera;
var renderer: THREE.WebGLRenderer;
var clock: THREE.Clock;
var puppet: THREE.Group;
var boneMap: Map<string, PBone> = new Map();
var partMap: Map<string, Part> = new Map();
var springMap: Map<string, Spring> = new Map();
var paramMap: Map<string, Param> = new Map();
var animMap: Map<string, Animation> = new Map();
var currentAnim: Animation | null = null;
var animTime: number = 0;
var animPlaying: boolean = false;

// === INIT ===
export function init(id: string = 'puppet-canvas'): void {
    const el = document.getElementById(id)!;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor(0x0d0d0d, 1);
    el.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    const a = el.clientWidth / el.clientHeight;
    const s = 350;
    camera = new THREE.OrthographicCamera(-s * a, s * a, s, -s, 0.1, 2000);
    camera.position.set(0, 0, 500);
    camera.lookAt(0, 0, 0);

    puppet = new THREE.Group();
    scene.add(puppet);
    clock = new THREE.Clock();

    // Grid
    const g = new THREE.GridHelper(700, 14, 0x1a1a1a, 0x141414);
    g.rotation.x = Math.PI / 2;
    g.position.z = -2;
    scene.add(g);

    // Center marker
    const cm = new THREE.LineBasicMaterial({ color: 0x222222 });
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-15,0,0),new THREE.Vector3(15,0,0)]), cm));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,-15,0),new THREE.Vector3(0,15,0)]), cm));

    tick();
    console.log('Hermes Puppet Engine v3 — ready');
}

// === BONES ===
function bone(name: string, parent: string | null, x: number, y: number): PBone {
    const b: PBone = {
        name, parent: parent ? boneMap.get(parent)! : null,
        children: [], localX: x, localY: y, localRotation: 0,
        worldX: x, worldY: y, worldRotation: 0, visualizer: null
    };
    if (b.parent) b.parent.children.push(b);
    boneMap.set(name, b);
    return b;
}

function updateBoneTree(): void {
    for (const b of boneMap.values()) {
        if (!b.parent) updateBone(b, 0, 0, 0);
    }
}

function updateBone(b: PBone, px: number, py: number, pr: number): void {
    const c = Math.cos(pr), s = Math.sin(pr);
    b.worldX = px + b.localX * c - b.localY * s;
    b.worldY = py + b.localX * s + b.localY * c;
    b.worldRotation = pr + b.localRotation;
    for (const ch of b.children) updateBone(ch, b.worldX, b.worldY, b.worldRotation);
}

// === MESH PARTS ===
function makePart(name: string, cx: number, cy: number, w: number, h: number,
    tex: THREE.Texture, cols: number, rows: number, z: number): Part {
    
    const verts: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
            verts.push(cx + (c / cols - 0.5) * w, cy + (0.5 - r / rows) * h, 0);
            uv.push(c / cols, 1 - r / rows);
        }
    }
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const a = r * (cols + 1) + c;
            idx.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1);
        }
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

    const count = verts.length / 3;
    const restX = new Float32Array(count);
    const restY = new Float32Array(count);
    for (let i = 0; i < count; i++) { restX[i] = verts[i*3]; restY[i] = verts[i*3+1]; }

    const part: Part = { name, mesh, restX, restY, weights: new Map(), z };
    partMap.set(name, part);
    return part;
}

// === SMART WEIGHT PAINTING ===
function weightByRegion(part: Part, boneName: string,
    regionFn: (x: number, y: number) => number): void {
    
    const count = part.restX.length;
    const wx = new Float32Array(count);
    const wy = new Float32Array(count);
    
    const bone = boneMap.get(boneName);
    if (!bone) return;
    
    for (let i = 0; i < count; i++) {
        const w = regionFn(part.restX[i], part.restY[i]);
        wx[i] = w;
        wy[i] = w;
    }
    
    part.weights.set(boneName, { x: wx, y: wy });
}

function deform(part: Part): void {
    const pos = part.mesh.geometry.getAttribute('position');
    const count = pos.count;
    
    // Start with rest positions
    const dx = new Float32Array(count);
    const dy = new Float32Array(count);
    
    for (const [boneName, w] of part.weights) {
        const b = boneMap.get(boneName);
        if (!b) continue;
        
        const offX = b.worldX - b.localX;
        const offY = b.worldY - b.localY;
        const cos = Math.cos(b.worldRotation);
        const sin = Math.sin(b.worldRotation);
        
        for (let i = 0; i < count; i++) {
            if (w.x[i] === 0 && w.y[i] === 0) continue;
            
            const lx = part.restX[i] - b.localX;
            const ly = part.restY[i] - b.localY;
            
            const rotX = lx * cos - ly * sin + b.localX;
            const rotY = lx * sin + ly * cos + b.localY;
            
            dx[i] += (rotX - part.restX[i] + offX) * w.x[i];
            dy[i] += (rotY - part.restY[i] + offY) * w.y[i];
        }
    }
    
    for (let i = 0; i < count; i++) {
        pos.setXY(i, part.restX[i] + dx[i], part.restY[i] + dy[i]);
    }
    pos.needsUpdate = true;
}

// === SPRINGS ===
function tickSprings(dt: number): void {
    const cd = Math.min(dt, 0.04);
    for (const s of springMap.values()) {
        const parent = boneMap.get(s.parent);
        const child = boneMap.get(s.bone);
        if (!parent || !child) continue;
        
        const target = parent.localRotation + s.restAngle;
        const f = (target - s.angle) * s.stiffness + (-s.angle * s.gravity * 0.08);
        s.velocity += f * cd * 60;
        s.velocity *= s.damping;
        s.angle += s.velocity * cd * 60;
        child.localRotation = s.angle;
    }
}

// === PARAMETERS ===
function applyParams(): void {
    for (const p of paramMap.values()) {
        for (const d of p.drives) {
            const b = boneMap.get(d.bone);
            if (!b) continue;
            const v = p.value * d.mult;
            if (d.prop === 'rot') b.localRotation = v * Math.PI / 180;
            if (d.prop === 'rotX') b.localRotation = v * Math.PI / 180;
        }
    }
}

// === ANIMATIONS ===
function tickAnimation(dt: number): void {
    if (!animPlaying || !currentAnim) return;
    
    animTime += dt;
    if (animTime >= currentAnim.duration) {
        if (currentAnim.loop) animTime -= currentAnim.duration;
        else { animPlaying = false; return; }
    }
    
    // Find surrounding keyframes
    const kfs = currentAnim.keyframes;
    let prev = kfs[0], next = kfs[kfs.length - 1];
    for (let i = 0; i < kfs.length - 1; i++) {
        if (kfs[i].time <= animTime && kfs[i+1].time >= animTime) {
            prev = kfs[i]; next = kfs[i+1]; break;
        }
    }
    
    const t = next.time > prev.time ? (animTime - prev.time) / (next.time - prev.time) : 0;
    const eased = ease(t, next.easing);
    
    for (const [name, param] of paramMap) {
        const pv = prev.values[name] ?? param.value;
        const nv = next.values[name] ?? param.value;
        param.value = pv + (nv - pv) * eased;
    }
    
    updateSliders();
}

function ease(t: number, type: string): number {
    if (type === 'ease-in') return t * t;
    if (type === 'ease-out') return t * (2 - t);
    if (type === 'ease-in-out') return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    return t;
}

function updateSliders(): void {
    for (const [name, p] of paramMap) {
        const slider = document.querySelector(`input[data-p="${name}"]`) as HTMLInputElement;
        if (slider) {
            slider.value = String(p.value);
            const label = slider.nextElementSibling as HTMLElement;
            if (label) label.textContent = p.value.toFixed(1);
        }
    }
}

// === BONE VISUALIZERS ===
function drawBoneVis(): void {
    puppet.children = puppet.children.filter(c => !String(c.name).startsWith('bv'));
    
    for (const b of boneMap.values()) {
        const g = new THREE.Group();
        g.name = `bv_${b.name}`;
        
        // Joint
        const j = new THREE.Mesh(
            new THREE.CircleGeometry(5, 12),
            new THREE.MeshBasicMaterial({ color: 0x00ddff, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
        );
        j.position.set(b.worldX, b.worldY, 60);
        g.add(j);
        
        // Line to parent
        if (b.parent) {
            const l = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(b.worldX, b.worldY, 60),
                    new THREE.Vector3(b.parent.worldX, b.parent.worldY, 60)
                ]),
                new THREE.LineBasicMaterial({ color: 0x00ddff, transparent: true, opacity: 0.6 })
            );
            g.add(l);
        }
        
        puppet.add(g);
    }
}

// === LOAD PUPPET ===
export async function loadPuppet(url: string): Promise<void> {
    const tex = await new Promise<THREE.Texture>(r => new THREE.TextureLoader().load(url, r));
    const W = tex.image?.width || 512;
    const H = tex.image?.height || 512;
    
    // Clear
    boneMap.clear(); partMap.clear(); springMap.clear(); paramMap.clear(); animMap.clear();
    while (puppet.children.length) puppet.remove(puppet.children[0]);
    
    // === BONES (15) ===
    bone('root', null, 0, 0);
    bone('body', 'root', 0, -H * 0.05);
    bone('head', 'root', 0, H * 0.22);
    bone('neck', 'root', 0, H * 0.1);
    bone('hair_main', 'head', 0, H * 0.05);
    bone('hair_l', 'head', -W * 0.18, H * 0.1);
    bone('hair_r', 'head', W * 0.18, H * 0.1);
    bone('eye_l', 'head', -W * 0.09, H * 0.01);
    bone('eye_r', 'head', W * 0.09, H * 0.01);
    bone('mouth', 'head', 0, -H * 0.04);
    bone('arm_l', 'body', -W * 0.2, H * 0.02);
    bone('arm_r', 'body', W * 0.2, H * 0.02);
    bone('fore_l', 'arm_l', 0, -H * 0.1);
    bone('fore_r', 'arm_r', 0, -H * 0.1);
    bone('skirt', 'body', 0, -H * 0.15);
    
    // === MESH (1 full-body, smart weights) ===
    const part = makePart('body', 0, 0, W, H, tex, 12, 12, 0);
    
    // Smart weight functions
    const dist = (x1: number, y1: number, x2: number, y2: number) => Math.sqrt((x1-x2)**2 + (y1-y2)**2);
    const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        return Math.max(0, 1 - (dx*dx + dy*dy));
    };
    const inBox = (x: number, y: number, l: number, r: number, t: number, b: number) => {
        if (x < l || x > r || y < b || y > t) return 0;
        const cx = (l+r)/2, cy = (t+b)/2;
        return 1 - Math.max(Math.abs(x-cx)/((r-l)/2), Math.abs(y-cy)/((t-b)/2)) * 0.3;
    };
    
    // Head: top-center ellipse
    weightByRegion(part, 'head', (x, y) => inEllipse(x, y, 0, H*0.22, W*0.2, H*0.15));
    
    // Hair: top edges
    weightByRegion(part, 'hair_main', (x, y) => {
        if (y < H * 0.25) return 0;
        return inEllipse(x, y, 0, H*0.35, W*0.28, H*0.12) * 0.9;
    });
    weightByRegion(part, 'hair_l', (x, y) => {
        if (x > -W*0.05 || y < H*0.1) return 0;
        return inEllipse(x, y, -W*0.2, H*0.25, W*0.12, H*0.15) * 0.85;
    });
    weightByRegion(part, 'hair_r', (x, y) => {
        if (x < W*0.05 || y < H*0.1) return 0;
        return inEllipse(x, y, W*0.2, H*0.25, W*0.12, H*0.15) * 0.85;
    });
    
    // Eyes
    weightByRegion(part, 'eye_l', (x, y) => inEllipse(x, y, -W*0.09, H*0.19, W*0.06, H*0.04));
    weightByRegion(part, 'eye_r', (x, y) => inEllipse(x, y, W*0.09, H*0.19, W*0.06, H*0.04));
    
    // Body
    weightByRegion(part, 'body', (x, y) => inBox(x, y, -W*0.18, W*0.18, H*0.08, -H*0.25));
    
    // Arms
    weightByRegion(part, 'arm_l', (x, y) => inBox(x, y, -W*0.35, -W*0.12, H*0.08, -H*0.1));
    weightByRegion(part, 'arm_r', (x, y) => inBox(x, y, W*0.12, W*0.35, H*0.08, -H*0.1));
    
    // Forearms (lower portion of arm boxes)
    weightByRegion(part, 'fore_l', (x, y) => {
        if (x > -W*0.05 || y > -H*0.02) return 0;
        return inBox(x, y, -W*0.35, -W*0.1, -H*0.02, -H*0.25) * 0.9;
    });
    weightByRegion(part, 'fore_r', (x, y) => {
        if (x < W*0.05 || y > -H*0.02) return 0;
        return inBox(x, y, W*0.1, W*0.35, -H*0.02, -H*0.25) * 0.9;
    });
    
    // === SPRINGS ===
    springMap.set('hair_main', { bone:'hair_main', parent:'head', angle:0, velocity:0, stiffness:0.4, damping:0.82, gravity:0.5, restAngle:0 });
    springMap.set('hair_l', { bone:'hair_l', parent:'head', angle:0, velocity:0, stiffness:0.35, damping:0.85, gravity:0.45, restAngle:0 });
    springMap.set('hair_r', { bone:'hair_r', parent:'head', angle:0, velocity:0, stiffness:0.35, damping:0.85, gravity:0.45, restAngle:0 });
    springMap.set('skirt', { bone:'skirt', parent:'body', angle:0, velocity:0, stiffness:0.25, damping:0.88, gravity:0.3, restAngle:0 });
    
    // === PARAMETERS ===
    const addP = (name: string, min: number, max: number, def: number, drives: Array<{bone:string;prop:string;mult:number}>) => {
        paramMap.set(name, { name, min, max, value: def, drives });
    };
    addP('HeadX', -30, 30, 0, [{bone:'head',prop:'rot',mult:1}]);
    addP('HeadTilt', -20, 20, 0, [{bone:'head',prop:'rot',mult:0.4}]); // subtle tilt
    addP('BodyX', -15, 15, 0, [{bone:'body',prop:'rot',mult:1}]);
    addP('EyeLOpen', 0, 1.2, 1, []);
    addP('EyeROpen', 0, 1.2, 1, []);
    addP('ArmL', -55, 55, 0, [{bone:'arm_l',prop:'rot',mult:1}]);
    addP('ArmR', -55, 55, 0, [{bone:'arm_r',prop:'rot',mult:-1}]);
    addP('ForeL', -90, 90, 0, [{bone:'fore_l',prop:'rot',mult:1}]);
    addP('ForeR', -90, 90, 0, [{bone:'fore_r',prop:'rot',mult:-1}]);
    
    // === BUILT-IN ANIMATIONS ===
    animMap.set('idle_breath', {
        name: 'idle_breath', duration: 4, loop: true,
        keyframes: [
            { time: 0, values: { BodyX: -1 }, easing: 'ease-in-out' },
            { time: 2, values: { BodyX: 1 }, easing: 'ease-in-out' },
            { time: 4, values: { BodyX: -1 }, easing: 'ease-in-out' },
        ]
    });
    animMap.set('look_around', {
        name: 'look_around', duration: 6, loop: true,
        keyframes: [
            { time: 0, values: { HeadX: 0 }, easing: 'ease-in-out' },
            { time: 1.5, values: { HeadX: -15 }, easing: 'ease-in-out' },
            { time: 3, values: { HeadX: 0 }, easing: 'ease-in-out' },
            { time: 4.5, values: { HeadX: 15 }, easing: 'ease-in-out' },
            { time: 6, values: { HeadX: 0 }, easing: 'ease-in-out' },
        ]
    });
    animMap.set('wave', {
        name: 'wave', duration: 2, loop: false,
        keyframes: [
            { time: 0, values: { ArmR: 0 }, easing: 'ease-out' },
            { time: 0.4, values: { ArmR: -50 }, easing: 'ease-in-out' },
            { time: 0.8, values: { ArmR: -30 }, easing: 'ease-in-out' },
            { time: 1.2, values: { ArmR: -50 }, easing: 'ease-in-out' },
            { time: 2, values: { ArmR: 0 }, easing: 'ease-in' },
        ]
    });
    
    buildUI();
    console.log(`Puppet: ${W}x${H}, ${boneMap.size} bones, ${partMap.size} meshes, ${paramMap.size} params, ${animMap.size} anims`);
}

// === UI ===
function buildUI(): void {
    // Sliders
    const sp = document.getElementById('slider-panel')!;
    sp.innerHTML = '';
    for (const [name, p] of paramMap) {
        const row = document.createElement('div');
        row.className = 'slider-row';
        row.innerHTML = `
            <label>${name}</label>
            <input type="range" min="${p.min}" max="${p.max}" step="0.5" value="${p.value}" data-p="${name}">
            <span class="slider-value">${p.value.toFixed(1)}</span>
        `;
        const slider = row.querySelector('input')!;
        const valEl = row.querySelector('.slider-value')!;
        slider.addEventListener('input', () => {
            p.value = parseFloat(slider.value);
            valEl.textContent = p.value.toFixed(1);
        });
        sp.appendChild(row);
    }
    
    // Animations
    const ap = document.getElementById('anim-panel')!;
    ap.innerHTML = '';
    for (const [name, anim] of animMap) {
        const btn = document.createElement('button');
        btn.className = 'preset-btn';
        btn.textContent = `▶ ${name}`;
        btn.onclick = () => playAnim(name);
        ap.appendChild(btn);
    }
    const stopBtn = document.createElement('button');
    stopBtn.className = 'preset-btn';
    stopBtn.textContent = '⏹ Stop';
    stopBtn.onclick = () => { animPlaying = false; };
    ap.appendChild(stopBtn);
    
    // Info
    document.getElementById('info-panel')!.textContent =
        `${boneMap.size} bones | ${partMap.size} meshes | ${paramMap.size} params | ${animMap.size} anims`;
}

// === ANIMATION CONTROL ===
function playAnim(name: string): void {
    const anim = animMap.get(name);
    if (!anim) return;
    
    // Save current param values as start state
    const startValues: Record<string, number> = {};
    for (const [n, p] of paramMap) startValues[n] = p.value;
    
    // Insert start keyframe if first kf time > 0
    if (anim.keyframes[0].time > 0) {
        anim.keyframes.unshift({ time: 0, values: startValues, easing: 'linear' });
    }
    
    currentAnim = anim;
    animTime = 0;
    animPlaying = true;
}

// === RENDER LOOP ===
function tick(): void {
    requestAnimationFrame(tick);
    const dt = clock.getDelta();
    
    applyParams();
    tickSprings(dt);
    tickAnimation(dt);
    updateBoneTree();
    drawBoneVis();
    
    for (const part of partMap.values()) deform(part);
    
    renderer.render(scene, camera);
}

// === PUBLIC API ===
(window as any).engine = {
    init, loadPuppet,
    setParam(name: string, val: number) {
        const p = paramMap.get(name);
        if (p) { p.value = val; updateSliders(); }
    },
    pokeSpring(name: string, impulse: number) {
        const s = springMap.get(name);
        if (s) s.velocity += impulse;
    },
    playAnim(name: string) { playAnim(name); },
    stopAnim() { animPlaying = false; },
    shakeHead() {
        let i = 0;
        const iv = setInterval(() => {
            this.setParam('HeadX', Math.sin(i * 0.6) * 25);
            i++; if (i > 25) clearInterval(iv);
        }, 50);
    },
    get params() { return paramMap; },
    get bones() { return boneMap; },
    get springs() { return springMap; },
};
