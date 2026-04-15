/**
 * Hermes VTuber Editor — Phase 2 Proof of Concept
 * 
 * Minimal: load CubismWebFramework + Core → render hermes_dark model on canvas.
 * No UI, no sliders, no fighting. Just direct Cubism pipeline.
 */

// === Framework imports (from source — esbuild compiles TS) ===
import { CubismFramework, Option } from '../lib/CubismWebFramework/src/live2dcubismframework';
import { CubismModelSettingJson } from '../lib/CubismWebFramework/src/cubismmodelsettingjson';
import { CubismUserModel } from '../lib/CubismWebFramework/src/model/cubismusermodel';
import { CubismRenderer_WebGL } from '../lib/CubismWebFramework/src/rendering/cubismrenderer_webgl';
import { CubismMatrix44 } from '../lib/CubismWebFramework/src/math/cubismmatrix44';
import { CubismModelMatrix } from '../lib/CubismWebFramework/src/math/cubismmodelmatrix';
import { CubismMoc } from '../lib/CubismWebFramework/src/model/cubismmoc';
import { CubismEyeBlink } from '../lib/CubismWebFramework/src/effect/cubismeyeblink';
import { CubismBreath, BreathParameterData } from '../lib/CubismWebFramework/src/effect/cubismbreath';
import { CubismPhysics } from '../lib/CubismWebFramework/src/physics/cubismphysics';
import { CubismDefaultParameterId } from '../lib/CubismWebFramework/src/cubismdefaultparameterid';
import { csmLogFunction } from '../lib/CubismWebFramework/src/utils/cubismdebug';

// === Config ===
const MODEL_DIR = '/live2d-models/hermes_dark/runtime/';
const MODEL_FILE = 'hermes_dark.model3.json';
const SHADER_PATH = '/shaders/WebGL/';
const CANVAS_ID = 'live2d-canvas';

// === State ===
var cubismModel: HermesModel | null = null;
var gl: WebGLRenderingContext | null = null;

// Expose to window for debugging
declare global { interface Window { cubismModel: any; gl: any; } }

/**
 * Our model class — extends CubismUserModel with custom update.
 */
class HermesModel extends CubismUserModel {

    /**
     * Load model from model3.json
     */
    async load(modelDir: string, modelFileName: string): Promise<void> {
        // 1. Fetch and parse model3.json
        const settingUrl = modelDir + modelFileName;
        console.log('Loading model setting from:', settingUrl);
        const settingBuf = await fetch(settingUrl).then(r => r.arrayBuffer());
        const setting = new CubismModelSettingJson(settingBuf, settingBuf.byteLength);

        // 2. Load .moc3 (use loadModel which handles Moc creation internally)
        const mocUrl = modelDir + setting.getModelFileName();
        console.log('Loading moc3 from:', mocUrl);
        const mocBuf = await fetch(mocUrl).then(r => r.arrayBuffer());
        this.loadModel(mocBuf);

        // 3. Setup eye blink
        if (setting.getEyeBlinkParameterCount() > 0) {
            this._eyeBlink = CubismEyeBlink.create(setting);
        }

        // 4. Setup breath
        this._breath = CubismBreath.create();
        const idMgr = CubismFramework.getIdManager();
        const breathParams: BreathParameterData[] = [
            new BreathParameterData(idMgr.getId('PARAM_ANGLE_X'), 0.0, 15.0, 6.5345, 0.5),
            new BreathParameterData(idMgr.getId('PARAM_ANGLE_Y'), 0.0, 8.0, 3.5345, 0.5),
            new BreathParameterData(idMgr.getId('PARAM_ANGLE_Z'), 0.0, 10.0, 5.5345, 0.5),
            new BreathParameterData(idMgr.getId('PARAM_BODY_ANGLE_X'), 0.0, 4.0, 15.5345, 0.5),
            new BreathParameterData(
                idMgr.getId(CubismDefaultParameterId.ParamBreath),
                0.5, 0.5, 3.2345, 1.0
            ),
        ];
        this._breath.setParameters(breathParams);

        // 5. Load physics
        if (setting.getPhysicsFileName() !== '') {
            const physicsUrl = modelDir + setting.getPhysicsFileName();
            console.log('Loading physics from:', physicsUrl);
            const physicsBuf = await fetch(physicsUrl).then(r => r.arrayBuffer());
            this._physics = CubismPhysics.create(physicsBuf, physicsBuf.byteLength);
        }

        // 6. Layout
        const layout = new Map<string, number>();
        setting.getLayoutMap(layout);
        const modelMatrix = new CubismModelMatrix(
            this._model.getCanvasWidth(),
            this._model.getCanvasHeight()
        );
        if (layout.has('width')) {
            modelMatrix.setWidth(layout.get('width')!);
        }
        if (layout.has('height')) {
            modelMatrix.setHeight(layout.get('height')!);
        }
        if (layout.has('x')) {
            modelMatrix.setX(layout.get('x')!);
        }
        if (layout.has('y')) {
            modelMatrix.setY(layout.get('y')!);
        }
        this._modelMatrix = modelMatrix;

        // 7. Create renderer — initialize model first, then set GL
        const renderer = new CubismRenderer_WebGL();
        renderer.initialize(this._model);
        renderer.startUp(gl!);
        renderer.setIsPremultipliedAlpha(true);
        (this as any)._renderer = renderer;

        // 8. Load textures
        const texCount = setting.getTextureCount();
        console.log(`Loading ${texCount} textures...`);
        for (let i = 0; i < texCount; i++) {
            const texFile = setting.getTextureFileName(i);
            const texUrl = modelDir + texFile;
            console.log(`  Texture ${i}: ${texUrl}`);
            const tex = await loadTexture(texUrl, gl!);
            this.getRenderer().bindTexture(i, tex);
        }

        // 9. Load shaders
        this.getRenderer().loadShaders(SHADER_PATH);

        // 10. Set initial state
        this._model.saveParameters();

        // 11. Load idle motion (best-effort — don't kill render if motion fails)
        const motionCount = setting.getMotionCount('Idle');
        if (motionCount > 0) {
            try {
                const motionFile = setting.getMotionFileName('Idle', 0);
                const motionUrl = modelDir + motionFile;
                console.log('Loading idle motion from:', motionUrl);
                const motionBuf = await fetch(motionUrl).then(r => r.arrayBuffer());
                const motion = this.loadMotion(motionBuf, motionBuf.byteLength, motionFile);
                if (motion) {
                    const fadeIn = setting.getMotionFadeInTimeValue('Idle', 0);
                    const fadeOut = setting.getMotionFadeOutTimeValue('Idle', 0);
                    motion.setFadeInTime(fadeIn > 0 ? fadeIn : 1.0);
                    motion.setFadeOutTime(fadeOut > 0 ? fadeOut : 1.0);
                    this._motionManager.startMotionPriority(motion, false, 2);
                    console.log('Idle motion started');
                } else {
                    console.warn('loadMotion returned null — skipping motion');
                }
            } catch (motionErr) {
                console.warn('Motion loading failed (non-fatal):', motionErr);
            }
        }

        console.log('Model loaded successfully!');
    }

    /**
     * Our custom update — direct control, no fighting.
     */
    update(deltaTime: number): void {
        // 1. Load previous frame state
        this._model.loadParameters();

        // 2. Apply motion
        this._motionManager.updateMotion(this._model, deltaTime);
        this._model.saveParameters();

        // 3. Eye blink
        this._eyeBlink?.updateParameters(this._model, deltaTime);

        // 4. Breath
        this._breath?.updateParameters(this._model, deltaTime);

        // 5. Physics
        this._physics?.evaluate(this._model, deltaTime);

        // 6. Calculate vertices
        this._model.update();
    }

    draw(): void {
        this.getRenderer().setMvpMatrix(this._projectionMatrix);
        this.getRenderer().drawModel(SHADER_PATH);
    }

    _modelMatrix: CubismModelMatrix | null = null;
    _projectionMatrix: CubismMatrix44 = new CubismMatrix44();
}

/**
 * Load a texture image and create a WebGL texture.
 */
function loadTexture(url: string, gl: WebGLRenderingContext): Promise<WebGLTexture> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const tex = gl.createTexture()!;
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            // Premultiplied alpha
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.generateMipmap(gl.TEXTURE_2D);
            resolve(tex);
        };
        img.onerror = () => reject(new Error(`Failed to load texture: ${url}`));
        img.src = url;
    });
}

/**
 * Main entry point — called after Core is loaded.
 */
/**
 * Polyfill for Core 5.0 → Framework R5 compatibility.
 * Core 5.0 doesn't expose model.offscreens or parts.offscreenIndices,
 * but Framework R5 expects them. Patch Model.fromMoc to inject empty stubs.
 */
function patchCubismCore(): void {
    const Core = (window as any).Live2DCubismCore;
    if (!Core) return;

    // Polyfill ColorBlendType constants (Cubism 5.3+ feature)
    const colorBlendTypes: Record<string, number> = {
        ColorBlendType_Normal: 0,
        ColorBlendType_AddGlow: 1,
        ColorBlendType_Add: 2,
        ColorBlendType_Darken: 3,
        ColorBlendType_Multiply: 4,
        ColorBlendType_ColorBurn: 5,
        ColorBlendType_LinearBurn: 6,
        ColorBlendType_Lighten: 7,
        ColorBlendType_Screen: 8,
        ColorBlendType_ColorDodge: 9,
        ColorBlendType_Overlay: 10,
        ColorBlendType_SoftLight: 11,
        ColorBlendType_HardLight: 12,
        ColorBlendType_LinearLight: 13,
        ColorBlendType_Hue: 14,
        ColorBlendType_Color: 15,
        ColorBlendType_AddCompatible: 16,
        ColorBlendType_MultiplyCompatible: 17,
    };
    for (const [key, val] of Object.entries(colorBlendTypes)) {
        if (!(key in Core)) {
            Core[key] = val;
        }
    }
    console.log('[Polyfill] Added ColorBlendType constants');

    const origFromMoc = Core.Model.fromMoc.bind(Core.Model);
    Core.Model.fromMoc = function(moc: any) {
        const model = origFromMoc(moc);
        if (!model) return model;

        // Polyfill model.offscreens (Cubism 5.3+ feature)
        if (!model.offscreens) {
            const emptyF32 = new Float32Array(0);
            const emptyU8 = new Uint8Array(0);
            const emptyI32 = new Int32Array(0);
            const emptyArr: any[] = [];
            model.offscreens = {
                count: 0,
                constantFlags: emptyU8,
                dynamicFlags: emptyU8,
                textureIndices: emptyI32,
                blendModes: emptyI32,
                opacities: emptyF32,
                ownerIndices: emptyI32,
                masks: emptyArr,
                maskCounts: emptyI32,
                multiplyColors: emptyF32,
                screenColors: emptyF32,
            };
            console.log('[Polyfill] Added empty model.offscreens');
        }

        // Polyfill drawables.blendModes (Cubism 5.3+ feature)
        if (model.drawables && !model.drawables.blendModes) {
            // Derive from constantFlags: bit 2 = additive, bit 3 = multiplicative
            const count = model.drawables.count;
            const flags = model.drawables.constantFlags;
            const blendModes = new Int32Array(count);
            for (let i = 0; i < count; i++) {
                // Lower 8 bits = color blend, upper 8 bits = alpha blend
                // 0 = Normal/Over (default)
                blendModes[i] = 0;
            }
            model.drawables.blendModes = blendModes;
            console.log('[Polyfill] Added drawables.blendModes');
        }

        // Polyfill parts.offscreenIndices
        if (model.parts && !model.parts.offscreenIndices) {
            model.parts.offscreenIndices = new Int32Array(model.parts.count).fill(-1);
            console.log('[Polyfill] Added empty parts.offscreenIndices');
        }

        // Polyfill model.getRenderOrders() (Core 5.3+ method)
        if (!model.getRenderOrders) {
            model.getRenderOrders = function() {
                return this.drawables.renderOrders;
            };
            console.log('[Polyfill] Added model.getRenderOrders()');
        }

        return model;
    };
    console.log('[Polyfill] CubismCore.Model.fromMoc patched');
}

export async function init(): Promise<void> {
    console.log('=== Hermes VTuber Editor — Phase 2 PoC ===');

    // 0. Patch Core API for Framework compatibility
    patchCubismCore();

    // 1. Create canvas
    const canvas = document.getElementById(CANVAS_ID) as HTMLCanvasElement;
    if (!canvas) {
        console.error(`Canvas #${CANVAS_ID} not found`);
        return;
    }
    canvas.width = 800;
    canvas.height = 900;

    // 2. Get WebGL context
    gl = canvas.getContext('webgl', {
        premultipliedAlpha: true,
        alpha: true,
        antialias: true,
    });
    if (!gl) {
        console.error('WebGL not supported');
        return;
    }
    console.log('WebGL context created');
    (window as any).gl = gl; // debug access

    // 3. Initialize CubismFramework
    const option = new Option();
    option.logFunction = ((msg: string) => console.log('[Cubism]', msg)) as csmLogFunction;
    option.loggingLevel = 1; // LogLevel_Verbose
    CubismFramework.startUp(option);
    CubismFramework.initialize();
    console.log('CubismFramework initialized');

    // 4. Load and render model
    try {
        cubismModel = new HermesModel();
        (window as any).cubismModel = cubismModel; // debug access
        await cubismModel.load(MODEL_DIR, MODEL_FILE);

        // Setup projection
        const proj = cubismModel._projectionMatrix;
        proj.loadIdentity();
        proj.scale(1.0, canvas.width / canvas.height);

        // 5. Start render loop
        let lastTime = performance.now();
        let frameCount = 0;
        let drawErrors = 0;
        function tick() {
            const now = performance.now();
            const dt = (now - lastTime) / 1000.0;
            lastTime = now;

            // Clear
            gl!.clearColor(0.0, 0.0, 0.0, 0.0);
            gl!.clear(gl!.COLOR_BUFFER_BIT);
            gl!.enable(gl!.BLEND);
            gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);

            // Update + draw
            try {
                cubismModel!.update(dt);
                cubismModel!.draw();
                const err = gl!.getError();
                if (err !== 0 && drawErrors < 5) {
                    console.error(`WebGL error on frame ${frameCount}: ${err}`);
                    drawErrors++;
                }
            } catch (e) {
                if (drawErrors < 5) {
                    console.error(`Draw error on frame ${frameCount}:`, e);
                    drawErrors++;
                }
            }

            frameCount++;
            if (frameCount === 60) {
                console.log(`[Debug] 60 frames rendered, renderer=${cubismModel!.getRenderer() !== null}, glError=${gl!.getError()}`);
            }

            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        console.log('Render loop started');

    } catch (err) {
        console.error('Failed to load model:', err);
    }
}
