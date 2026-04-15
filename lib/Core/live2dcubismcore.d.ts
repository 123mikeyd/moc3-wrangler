/**
 * Type declarations for live2dcubismcore.min.js
 * 
 * The Core is a proprietary Emscripten-compiled C library that creates
 * a global `Live2DCubismCore` object. These declarations are derived
 * from how CubismWebFramework actually uses the Core API.
 */

declare namespace Live2DCubismCore {

    // === Moc ===
    class Moc {
        static fromArrayBuffer(buffer: ArrayBuffer): Moc;
        _release(): void;
        hasMocConsistency(buffer: ArrayBuffer): number;
    }

    // === Model ===
    class Model {
        static fromMoc(moc: Moc): Model;
        update(): void;
        release(): void;
        getRenderOrders(): Int32Array;

        canvasinfo: CanvasInfo;
        parameters: Parameters;
        parts: Parts;
        drawables: Drawables;
        offscreens: Offscreens;
    }

    // === Sub-structures ===

    interface CanvasInfo {
        CanvasWidth: number;
        CanvasHeight: number;
        PixelsPerUnit: number;
    }

    interface Parameters {
        count: number;
        ids: string[];
        minimumValues: Float32Array;
        maximumValues: Float32Array;
        defaultValues: Float32Array;
        values: Float32Array;
        types: Int32Array;
        repeats: Uint8Array;
    }

    interface Parts {
        count: number;
        ids: string[];
        parentIndices: Int32Array;
        opacities: Float32Array;
        offscreenIndices: Int32Array;
    }

    interface Drawables {
        count: number;
        ids: string[];
        constantFlags: Uint8Array;
        dynamicFlags: Uint8Array;
        textureIndices: Int32Array;
        drawOrders: Int32Array;
        renderOrders: Int32Array;
        opacities: Float32Array;
        masks: Int32Array[];
        maskCounts: Int32Array;
        vertexCounts: Int32Array;
        vertexPositions: Float32Array[];
        vertexUvs: Float32Array[];
        indices: Uint16Array[];
        indexCounts: Int32Array;
        multiplyColors: Float32Array;   // flat: [r,g,b,a, r,g,b,a, ...]
        screenColors: Float32Array;     // flat: [r,g,b,a, r,g,b,a, ...]
        blendModes: Int32Array;
        offscreenIndices: Int32Array[];
        parentPartIndices: Int32Array;
        resetDynamicFlags(): void;
    }

    interface Offscreens {
        count: number;
        constantFlags: Uint8Array;
        blendModes: Int32Array;
        opacities: Float32Array;
        masks: Int32Array[];
        maskCounts: Int32Array;
        ownerIndices: Int32Array;
        multiplyColors: Float32Array;   // flat array
        screenColors: Float32Array;     // flat array
    }

    // === Parameter types ===
    enum csmParameterType {
        csmParameterType_Normal = 0,
        csmParameterType_BlendShape = 1
    }

    // === Color blend types ===
    const ColorBlendType_Normal: number;
    const ColorBlendType_Additive: number;
    const ColorBlendType_Multiplicative: number;
    const ColorBlendType_Add: number;
    const ColorBlendType_AddGlow: number;
    const ColorBlendType_AddCompatible: number;
    const ColorBlendType_Multiply: number;
    const ColorBlendType_MultiplyCompatible: number;
    const ColorBlendType_Screen: number;
    const ColorBlendType_Overlay: number;
    const ColorBlendType_Darken: number;
    const ColorBlendType_Lighten: number;
    const ColorBlendType_ColorDodge: number;
    const ColorBlendType_ColorBurn: number;
    const ColorBlendType_HardLight: number;
    const ColorBlendType_SoftLight: number;
    const ColorBlendType_Difference: number;
    const ColorBlendType_Exclusion: number;
    const ColorBlendType_Hue: number;
    const ColorBlendType_Saturation: number;
    const ColorBlendType_Color: number;
    const ColorBlendType_Luminosity: number;
    const ColorBlendType_LinearBurn: number;
    const ColorBlendType_LinearLight: number;

    // === Utils ===
    namespace Utils {
        function hasIsDoubleSidedBit(flags: number): boolean;
        function hasBlendAdditiveBit(flags: number): boolean;
        function hasBlendMultiplicativeBit(flags: number): boolean;
        function hasIsInvertedMaskBit(flags: number): boolean;
        function hasIsVisibleBit(flags: number): boolean;
        function hasVisibilityDidChangeBit(flags: number): boolean;
        function hasOpacityDidChangeBit(flags: number): boolean;
        function hasRenderOrderDidChangeBit(flags: number): boolean;
        function hasBlendColorDidChangeBit(flags: number): boolean;
        function hasVertexPositionsDidChangeBit(flags: number): boolean;
    }

    // === Version ===
    namespace Version {
        function csmGetMocVersion(mocBytes: ArrayBuffer): number;
        function csmGetLatestMocVersion(): number;
        function csmGetVersion(): number;
    }

    // === Memory ===
    namespace Memory {
        function initializeAmountOfMemory(size: number): void;
    }

    // === Logging ===
    type csmLogFunction = (message: string) => void;

    namespace Logging {
        function csmSetLogFunction(fn: csmLogFunction): void;
        function csmGetLogFunction(): csmLogFunction;
    }
}
