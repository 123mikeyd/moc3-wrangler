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

        // 7. Create renderer
        const renderer = new CubismRenderer_WebGL();
        renderer.initialize(this._model);
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

        // 11. Load idle motion (skip setEffectIds for now — just get something on screen)
        const motionCount = setting.getMotionCount('Idle');
        if (motionCount > 0) {
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
export async function init(): Promise<void> {
    console.log('=== Hermes VTuber Editor — Phase 2 PoC ===');

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
        await cubismModel.load(MODEL_DIR, MODEL_FILE);

        // Setup projection
        const proj = cubismModel._projectionMatrix;
        proj.loadIdentity();
        proj.scale(1.0, canvas.width / canvas.height);

        // 5. Start render loop
        let lastTime = performance.now();
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
            cubismModel!.update(dt);
            cubismModel!.draw();

            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        console.log('Render loop started');

    } catch (err) {
        console.error('Failed to load model:', err);
    }
}
