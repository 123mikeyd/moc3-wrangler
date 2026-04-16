/**
 * Mesh system — textured triangle grids with bone weights
 * 
 * A mesh is a set of vertices with (x, y, u, v) coordinates.
 * Each vertex is influenced by one or more bones with weights.
 * When bones move, vertices follow based on their weights.
 */

import * as THREE from 'three';
import { Bone, BoneChain } from './bone';

export class PuppetMesh {
    name: string = '';
    meshObject: THREE.Mesh;
    
    // Original (rest pose) vertex positions
    restPositions: Float32Array;  // [x0,y0, x1,y1, ...]
    uvs: Float32Array;            // [u0,v0, u1,v1, ...]
    
    // Bone weights: boneName → [weight0, weight1, ...]
    boneWeights: Map<string, Float32Array> = new Map();
    
    // Current deformed positions (updated each frame)
    positions: Float32Array;

    constructor(geometry: THREE.BufferGeometry, texture: THREE.Texture) {
        this.name = 'mesh';
        
        // Get vertex data
        const posAttr = geometry.getAttribute('position');
        const uvAttr = geometry.getAttribute('uv');
        
        this.restPositions = new Float32Array(posAttr.count * 2);
        this.positions = new Float32Array(posAttr.count * 2);
        this.uvs = new Float32Array(uvAttr.count * 2);
        
        for (let i = 0; i < posAttr.count; i++) {
            this.restPositions[i * 2] = posAttr.getX(i);
            this.restPositions[i * 2 + 1] = posAttr.getY(i);
            this.positions[i * 2] = posAttr.getX(i);
            this.positions[i * 2 + 1] = posAttr.getY(i);
        }
        for (let i = 0; i < uvAttr.count; i++) {
            this.uvs[i * 2] = uvAttr.getX(i);
            this.uvs[i * 2 + 1] = uvAttr.getY(i);
        }

        // Create the mesh
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        
        this.meshObject = new THREE.Mesh(geometry, material);
        this.meshObject.renderOrder = 0;
    }

    /**
     * Bind this mesh to a bone with a weight
     */
    bindBone(boneName: string, weight: number): void {
        const vertexCount = this.restPositions.length / 2;
        const weights = new Float32Array(vertexCount).fill(weight);
        this.boneWeights.set(boneName, weights);
    }

    /**
     * Set weight for specific vertex range
     */
    setBoneWeights(boneName: string, weights: Float32Array): void {
        this.boneWeights.set(boneName, weights);
    }

    /**
     * Apply bone transforms to deform the mesh
     */
    applyBones(boneChain: BoneChain): void {
        const vertexCount = this.restPositions.length / 2;
        
        // Start with rest positions
        this.positions.set(this.restPositions);
        
        // For each bone, transform its weighted vertices
        for (const [boneName, weights] of this.boneWeights) {
            const bone = boneChain.getBone(boneName);
            if (!bone) continue;
            
            // Compute bone transform relative to rest pose
            // (bone moved from its bind position)
            const dx = bone.worldX - bone.localX;
            const dy = bone.worldY - bone.localY;
            const cos = Math.cos(bone.worldRotation);
            const sin = Math.sin(bone.worldRotation);
            
            for (let i = 0; i < vertexCount; i++) {
                const w = weights[i];
                if (w === 0) continue;
                
                // Rest position
                const rx = this.restPositions[i * 2];
                const ry = this.restPositions[i * 2 + 1];
                
                // Transform: rotate around bone, then translate
                const lx = rx - bone.localX;
                const ly = ry - bone.localY;
                const rotatedX = lx * cos - ly * sin;
                const rotatedY = lx * sin + ly * cos;
                
                // Apply with weight (blend between rest and deformed)
                this.positions[i * 2] = rx + (rotatedX + bone.worldX - rx - bone.localX) * w;
                this.positions[i * 2 + 1] = ry + (rotatedY + bone.worldY - ry - bone.localY) * w;
            }
        }
        
        // Update the geometry
        const posAttr = this.meshObject.geometry.getAttribute('position');
        for (let i = 0; i < vertexCount; i++) {
            posAttr.setXY(i, this.positions[i * 2], this.positions[i * 2 + 1]);
        }
        posAttr.needsUpdate = true;
    }
}

/**
 * Auto-generate a mesh grid from image dimensions
 */
export function autoMesh(
    width: number, height: number,
    subdivisionsX: number, subdivisionsY: number,
    texture: THREE.Texture
): PuppetMesh {
    const vertices: number[] = [];
    const indices: number[] = [];
    const uvCoords: number[] = [];

    // Generate grid vertices
    for (let y = 0; y <= subdivisionsY; y++) {
        for (let x = 0; x <= subdivisionsX; x++) {
            const px = (x / subdivisionsX - 0.5) * width;
            const py = (0.5 - y / subdivisionsY) * height;
            const u = x / subdivisionsX;
            const v = 1 - y / subdivisionsY;
            
            vertices.push(px, py, 0);
            uvCoords.push(u, v);
        }
    }

    // Generate triangle indices
    for (let y = 0; y < subdivisionsY; y++) {
        for (let x = 0; x < subdivisionsX; x++) {
            const a = y * (subdivisionsX + 1) + x;
            const b = a + 1;
            const c = a + (subdivisionsX + 1);
            const d = c + 1;
            
            indices.push(a, b, c);
            indices.push(b, d, c);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvCoords, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return new PuppetMesh(geometry, texture);
}
