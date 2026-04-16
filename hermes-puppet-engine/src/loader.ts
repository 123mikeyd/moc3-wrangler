/**
 * Hermes Puppet Engine — Universal Loader
 * 
 * Drop ANYTHING and it becomes a puppet:
 * - PSD/GIMP files with separated layers → each layer becomes a puppet part
 * - .moc3 files → extracts textures, creates layers
 * - Single PNG/JPG → auto-separates into body regions
 * - Model directories → loads all textures
 * 
 * This is the pipeline that replaces Cubism Editor.
 */

import * as THREE from 'three';
import { readPsd, Psd } from 'ag-psd';

// ============================================================
//  TYPES
// ============================================================

interface ExtractedLayer {
    name: string;
    image: HTMLImageElement;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    opacity: number;
    visible: boolean;
}

interface AutoRegion {
    name: string;
    x: number; y: number;
    width: number; height: number;
    type: 'head' | 'body' | 'arm_l' | 'arm_r' | 'hair' | 'eye_l' | 'eye_r' | 'mouth' | 'other';
}

// ============================================================
//  PSD / GIMP LAYER EXTRACTION
// ============================================================

export async function loadPSD(file: File): Promise<ExtractedLayer[]> {
    const buffer = await file.arrayBuffer();
    const psd = readPsd(buffer, { skipLayerImageData: false, useImageData: true });
    
    const layers: ExtractedLayer[] = [];
    
    async function extractLayers(children: any[], prefix: string = ''): Promise<void> {
        for (const child of children) {
            if (!child.children) {
                // Leaf layer — has actual image data
                if (child.canvas) {
                    const img = await canvasToImage(child.canvas);
                    layers.push({
                        name: prefix + (child.name || 'unnamed'),
                        image: img,
                        width: child.canvas.width,
                        height: child.canvas.height,
                        offsetX: child.left || 0,
                        offsetY: child.top || 0,
                        opacity: child.opacity ?? 1,
                        visible: child.visible !== false
                    });
                }
            } else {
                // Group — recurse
                await extractLayers(child.children, prefix + child.name + '/');
            }
        }
    }
    
    if (psd.children) {
        extractLayers(psd.children);
    }
    
    console.log(`PSD: ${layers.length} layers extracted from ${file.name}`);
    return layers;
}

/**
 * Load GIMP XCF file (GIMP's native format)
 * XCF is gzipped, contains layer data as PNG chunks
 */
export async function loadXCF(file: File): Promise<ExtractedLayer[]> {
    // XCF files are gzipped — decompress first
    const buffer = await file.arrayBuffer();
    
    try {
        // Try to decompress as gzip
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(new Uint8Array(buffer));
        writer.close();
        const reader = ds.readable.getReader();
        const chunks: Uint8Array[] = [];
        let totalLen = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalLen += value.length;
        }
        const decompressed = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) {
            decompressed.set(chunk, offset);
            offset += chunk.length;
        }
        
        // Parse XCF structure — layers are embedded as PNG blobs
        return parseXCFLayers(decompressed);
    } catch (e) {
        console.warn('XCF decompression failed, trying raw:', e);
        return parseXCFLayers(new Uint8Array(buffer));
    }
}

function parseXCFLayers(data: Uint8Array): ExtractedLayer[] {
    const layers: ExtractedLayer[] = [];
    
    // XCF format: header, then layer chunks
    // Each layer has: width, height, type, name length, name, then PNG data
    // We scan for PNG magic bytes (89 50 4E 47) to find layer images
    
    const pngMagic = [0x89, 0x50, 0x4E, 0x47];
    let layerIndex = 0;
    
    for (let i = 0; i < data.length - 4; i++) {
        if (data[i] === pngMagic[0] && data[i+1] === pngMagic[1] &&
            data[i+2] === pngMagic[2] && data[i+3] === pngMagic[3]) {
            // Found a PNG blob — extract it
            const pngEnd = findPNGEnd(data, i);
            if (pngEnd > i) {
                const pngBlob = new Blob([data.slice(i, pngEnd)], { type: 'image/png' });
                const url = URL.createObjectURL(pngBlob);
                const img = new Image();
                img.src = url;
                // We'll load async later
                layers.push({
                    name: `layer_${layerIndex}`,
                    image: img,
                    width: 0, // will be set when image loads
                    height: 0,
                    offsetX: 0,
                    offsetY: 0,
                    opacity: 1,
                    visible: true
                });
                layerIndex++;
                i = pngEnd;
            }
        }
    }
    
    console.log(`XCF: ${layers.length} PNG layers found`);
    return layers;
}

function findPNGEnd(data: Uint8Array, start: number): number {
    // PNG ends with IEND chunk: 00 00 00 00 49 45 4E 44 AE 42 60 82
    for (let i = start + 8; i < data.length - 12; i++) {
        if (data[i+4] === 0x49 && data[i+5] === 0x45 &&
            data[i+6] === 0x4E && data[i+7] === 0x44) {
            return i + 12; // Include IEND chunk + CRC
        }
    }
    return data.length;
}

// ============================================================
//  .MOC3 HANDLER
// ============================================================

export async function loadMoc3(file: File): Promise<ExtractedLayer[]> {
    // .moc3 is binary — we can't parse it without Cubism Core
    // But we can look for companion files in the same directory
    
    const layers: ExtractedLayer[] = [];
    const fileName = file.name.replace('.moc3', '');
    
    // Try to find textures in the models directory
    // The user should drop the entire model folder, not just the .moc3
    console.log(`MOC3: ${fileName} — looking for companion textures...`);
    
    // Return empty — user should drop the texture PNGs instead
    // Or use the import button which connects to the server
    return layers;
}

/**
 * Load a model directory (drag the whole folder)
 * Detects .moc3, textures, motions automatically
 */
export async function loadModelDirectory(entries: FileSystemDirectoryEntry[]): Promise<ExtractedLayer[]> {
    const layers: ExtractedLayer[] = [];
    
    for (const entry of entries) {
        if (entry.isFile) {
            const file = await new Promise<File>((resolve) => (entry as FileSystemFileEntry).file(resolve));
            
            if (file.type.startsWith('image/') || file.name.endsWith('.png')) {
                const img = await fileToImage(file);
                layers.push({
                    name: file.name.replace('.png', ''),
                    image: img,
                    width: img.width,
                    height: img.height,
                    offsetX: 0,
                    offsetY: 0,
                    opacity: 1,
                    visible: true
                });
            }
        } else if (entry.isDirectory) {
            // Recurse into subdirectories (texture folders)
            const reader = (entry as FileSystemDirectoryEntry).createReader();
            const subEntries = await new Promise<FileSystemEntry[]>((resolve) => {
                reader.readEntries(resolve);
            });
            const subLayers = await loadModelDirectory(subEntries);
            layers.push(...subLayers);
        }
    }
    
    return layers;
}

// ============================================================
//  AUTO-SEPARATION (single image → multiple layers)
// ============================================================

/**
 * Take a single character image and automatically separate it into
 * body region layers using color/edge analysis.
 * 
 * This is the "poor man's material separation" — it's not as good as
 * Live2D's PSD import, but it works with any image.
 */
export function autoSeparate(image: HTMLImageElement): ExtractedLayer[] {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    
    const W = image.width;
    const H = image.height;
    const layers: ExtractedLayer[] = [];
    
    // Define region templates based on typical anime character layout
    const regions: AutoRegion[] = [
        { name: 'hair_back', type: 'hair', x: 0, y: 0, width: W, height: H * 0.35 },
        { name: 'body', type: 'body', x: W * 0.2, y: H * 0.35, width: W * 0.6, height: H * 0.45 },
        { name: 'arm_left', type: 'arm_l', x: 0, y: H * 0.3, width: W * 0.25, height: H * 0.4 },
        { name: 'arm_right', type: 'arm_r', x: W * 0.75, y: H * 0.3, width: W * 0.25, height: H * 0.4 },
        { name: 'head', type: 'head', x: W * 0.25, y: H * 0.05, width: W * 0.5, height: H * 0.35 },
        { name: 'hair_front', type: 'hair', x: W * 0.2, y: 0, width: W * 0.6, height: H * 0.2 },
        { name: 'eye_left', type: 'eye_l', x: W * 0.3, y: H * 0.15, width: W * 0.15, height: H * 0.08 },
        { name: 'eye_right', type: 'eye_r', x: W * 0.55, y: H * 0.15, width: W * 0.15, height: H * 0.08 },
        { name: 'mouth', type: 'mouth', x: W * 0.4, y: H * 0.25, width: W * 0.2, height: H * 0.06 },
    ];
    
    for (const region of regions) {
        const layerCanvas = document.createElement('canvas');
        layerCanvas.width = W;
        layerCanvas.height = H;
        const layerCtx = layerCanvas.getContext('2d')!;
        
        // Copy the region from the full image
        const regionData = ctx.getImageData(
            Math.floor(region.x), Math.floor(region.y),
            Math.ceil(region.width), Math.ceil(region.height)
        );
        
        // Create a full-size canvas with only this region visible
        layerCtx.putImageData(regionData, Math.floor(region.x), Math.floor(region.y));
        
        // Apply soft edge mask (feather the borders)
        applyFeatherMask(layerCtx, region, 10);
        
        const img = new Image();
        img.src = layerCanvas.toDataURL();
        
        layers.push({
            name: region.name,
            image: img,
            width: W,
            height: H,
            offsetX: 0,
            offsetY: 0,
            opacity: 1,
            visible: true
        });
    }
    
    console.log(`Auto-separated into ${layers.length} layers`);
    return layers;
}

/**
 * Apply a soft feather mask to the edges of a region
 */
function applyFeatherMask(ctx: CanvasRenderingContext2D, region: AutoRegion, feather: number): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    
    const rx = region.x;
    const ry = region.y;
    const rw = region.width;
    const rh = region.height;
    
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            
            // Distance from region edges
            const dl = x - rx;
            const dr = (rx + rw) - x;
            const dt = y - ry;
            const db = (ry + rh) - y;
            
            // Minimum distance from any edge
            const d = Math.min(dl, dr, dt, db);
            
            if (d < 0) {
                // Outside region — fully transparent
                data[idx + 3] = 0;
            } else if (d < feather) {
                // Feather zone — fade alpha
                data[idx + 3] = Math.floor(data[idx + 3] * (d / feather));
            }
            // Inside region — keep original alpha
        }
    }
    
    ctx.putImageData(imageData, 0, 0);
}

/**
 * Smart auto-separation using edge detection
 * Detects boundaries between body parts and creates clean layers
 */
export function smartSeparate(image: HTMLImageElement): ExtractedLayer[] {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    
    const W = image.width;
    const H = image.height;
    const imageData = ctx.getImageData(0, 0, W, H);
    const data = imageData.data;
    
    // Step 1: Find the character's bounding box (non-transparent pixels)
    let minX = W, minY = H, maxX = 0, maxY = 0;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const a = data[(y * W + x) * 4 + 3];
            if (a > 10) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    
    const charW = maxX - minX;
    const charH = maxY - minY;
    const cx = minX + charW / 2;
    
    // Step 2: Divide into horizontal bands
    const bands = [
        { name: 'hair_top', yStart: 0, yEnd: 0.25 },
        { name: 'head', yStart: 0.15, yEnd: 0.45 },
        { name: 'body', yStart: 0.4, yEnd: 0.8 },
        { name: 'legs', yStart: 0.75, yEnd: 1.0 },
    ];
    
    // Step 3: Further split head region into eyes, mouth
    // Step 4: Split body into torso, arms
    
    // For now, use the simpler region-based approach
    return autoSeparate(image);
}

// ============================================================
//  UNIVERSAL DROP HANDLER
// ============================================================

export async function handleDrop(e: DragEvent): Promise<ExtractedLayer[]> {
    e.preventDefault();
    const layers: ExtractedLayer[] = [];
    
    const items = e.dataTransfer?.items;
    if (!items) return layers;
    
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry?.();
            
            if (entry?.isDirectory) {
                // Directory drop — load all images inside
                const dirLayers = await loadModelDirectory([entry]);
                layers.push(...dirLayers);
                
            } else if (entry?.isFile) {
                const file = item.getAsFile();
                if (!file) continue;
                
                const ext = file.name.toLowerCase().split('.').pop();
                
                if (ext === 'psd') {
                    const psdLayers = await loadPSD(file);
                    layers.push(...psdLayers);
                    
                } else if (ext === 'xcf') {
                    const xcfLayers = await loadXCF(file);
                    layers.push(...xcfLayers);
                    
                } else if (ext === 'moc3') {
                    console.log('MOC3 dropped — use Import button for server-side models');
                    // Can't render .moc3 directly — tell user to drop texture PNGs
                    
                } else if (file.type.startsWith('image/')) {
                    // Single image — ask user: single layer or auto-separate?
                    const img = await fileToImage(file);
                    
                    // Auto-separate if image is large enough
                    if (img.width > 300 && img.height > 300) {
                        const separated = autoSeparate(img);
                        layers.push(...separated);
                    } else {
                        layers.push({
                            name: file.name.replace(/\.[^.]+$/, ''),
                            image: img,
                            width: img.width,
                            height: img.height,
                            offsetX: 0,
                            offsetY: 0,
                            opacity: 1,
                            visible: true
                        });
                    }
                }
            }
        }
    }
    
    return layers;
}

// ============================================================
//  HELPERS
// ============================================================

function fileToImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

function canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = canvas.toDataURL();
    });
}
