/**
 * Spring physics system
 * 
 * Simple spring-pendulum chains for hair/cloth bounce.
 * Each chain has a rest angle, current angle, and velocity.
 * The spring pulls toward rest, damping slows it, gravity pulls down.
 * 
 * Input: parent bone rotation (head angle)
 * Output: child bone rotation offset (hair bounce)
 */

import { Bone, BoneChain } from './bone';

interface SpringChain {
    name: string;
    parentBone: string;
    stiffness: number;   // how fast it returns to rest (0-1)
    damping: number;     // how much velocity is lost each frame (0-1)
    gravity: number;     // pulls toward vertical (0-1)
    angle: number;       // current angle offset (radians)
    velocity: number;    // current angular velocity
    restAngle: number;   // rest position angle
}

export class SpringSystem {
    private chains: Map<string, SpringChain> = new Map();

    /**
     * Add a spring chain
     */
    addChain(name: string, parentBone: string, config: {
        stiffness: number;
        damping: number;
        gravity: number;
    }): void {
        this.chains.set(name, {
            name,
            parentBone,
            stiffness: config.stiffness,
            damping: config.damping,
            gravity: config.gravity,
            angle: 0,
            velocity: 0,
            restAngle: 0
        });
    }

    /**
     * Update all spring chains
     */
    update(dt: number, bones: BoneChain): void {
        const cappedDt = Math.min(dt, 0.05); // cap to prevent explosion

        for (const [name, chain] of this.chains) {
            const parentBone = bones.getBone(chain.parentBone);
            const childBone = bones.getBone(name);
            if (!parentBone || !childBone) continue;

            // Input: how far the parent has rotated from vertical
            const parentAngle = parentBone.worldRotation;
            
            // The spring wants to follow the parent but with delay
            // Target angle = parent's angle (hair follows head)
            const targetAngle = parentAngle + chain.restAngle;
            
            // Spring force: pull toward target
            const springForce = (targetAngle - chain.angle) * chain.stiffness;
            
            // Gravity: pull toward vertical (0)
            const gravityForce = -chain.angle * chain.gravity * 0.1;
            
            // Total force
            const force = springForce + gravityForce;
            
            // Update velocity
            chain.velocity += force * cappedDt * 60; // normalize to ~60fps
            chain.velocity *= chain.damping;
            
            // Update angle
            chain.angle += chain.velocity * cappedDt * 60;
            
            // Apply to bone as rotation offset
            // (bone's base rotation is from parameters, spring adds on top)
            childBone.localRotation = chain.angle;
        }
    }

    /**
     * Get a chain for direct manipulation
     */
    getChain(name: string): SpringChain | undefined {
        return this.chains.get(name);
    }

    /**
     * Poke a spring (apply impulse)
     */
    poke(name: string, impulse: number): void {
        const chain = this.chains.get(name);
        if (chain) {
            chain.velocity += impulse;
        }
    }
}
