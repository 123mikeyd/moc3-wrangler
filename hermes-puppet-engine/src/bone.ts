/**
 * Bone hierarchy system
 * 
 * Parent-child transform chain. Each bone has position, rotation, scale
 * in local space. World space is computed by walking up the parent chain.
 */

import * as THREE from 'three';

export class Bone {
    name: string;
    parent: Bone | null = null;
    children: Bone[] = [];

    // Local transforms
    localX: number;
    localY: number;
    localRotation: number = 0;  // radians
    localScaleX: number = 1;
    localScaleY: number = 1;

    // World transforms (computed)
    worldX: number = 0;
    worldY: number = 0;
    worldRotation: number = 0;
    worldScaleX: number = 1;
    worldScaleY: number = 1;

    // Visualizer reference
    visualizer: THREE.Group | null = null;

    constructor(name: string, x: number, y: number) {
        this.name = name;
        this.localX = x;
        this.localY = y;
    }

    setRotationX(deg: number): void { this.localRotation = THREE.MathUtils.degToRad(deg); }
    setRotationY(deg: number): void { this.localRotation = THREE.MathUtils.degToRad(deg); }
    setRotationZ(deg: number): void { this.localRotation = THREE.MathUtils.degToRad(deg); }
    setScaleX(s: number): void { this.localScaleX = s; }
    setScaleY(s: number): void { this.localScaleY = s; }
    setTranslateX(v: number): void { this.localX = v; }
    setTranslateY(v: number): void { this.localY = v; }
}

export class BoneChain {
    private bones: Map<string, Bone> = new Map();
    private rootBones: Bone[] = [];

    addBone(name: string, parentName: string | null, x: number, y: number, z: number = 0): Bone {
        const bone = new Bone(name, x, y);
        this.bones.set(name, bone);

        if (parentName) {
            const parent = this.bones.get(parentName);
            if (parent) {
                bone.parent = parent;
                parent.children.push(bone);
            }
        } else {
            this.rootBones.push(bone);
        }

        return bone;
    }

    getBone(name: string): Bone | undefined {
        return this.bones.get(name);
    }

    getAll(): Bone[] {
        return Array.from(this.bones.values());
    }

    count(): number {
        return this.bones.size;
    }

    /**
     * Update world transforms for all bones
     */
    update(): void {
        for (const root of this.rootBones) {
            this.updateBone(root, 0, 0, 0, 1, 1);
        }
    }

    private updateBone(bone: Bone, parentX: number, parentY: number,
        parentRotation: number, parentScaleX: number, parentScaleY: number): void {

        // Compute world transform
        const cos = Math.cos(parentRotation);
        const sin = Math.sin(parentRotation);

        // Rotate and scale local offset
        const offsetX = bone.localX * parentScaleX;
        const offsetY = bone.localY * parentScaleY;

        bone.worldX = parentX + offsetX * cos - offsetY * sin;
        bone.worldY = parentY + offsetX * sin + offsetY * cos;
        bone.worldRotation = parentRotation + bone.localRotation;
        bone.worldScaleX = parentScaleX * bone.localScaleX;
        bone.worldScaleY = parentScaleY * bone.localScaleY;

        // Update children
        for (const child of bone.children) {
            this.updateBone(child, bone.worldX, bone.worldY,
                bone.worldRotation, bone.worldScaleX, bone.worldScaleY);
        }
    }
}
