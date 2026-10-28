import * as THREE from 'three';
import type { ObjectKind } from './types';

/**
 * Placeholder models built from primitives. Phase 6 replaces these with GLB
 * files loaded on demand through GLTFLoader; the engine only needs an
 * Object3D whose front faces +Z and whose origin is at its mounting point
 * (bottom centre for floor objects, back centre for wall objects), so
 * swapping in real assets does not touch the placement or gesture code.
 *
 * Geometries and materials are created once and shared between instances.
 */

export const CUBE_SIZE = 0.3;

/** Sample TV: 43 inch class, about 0.96 m wide, 0.56 m tall, 4 cm deep. */
export const TV_WIDTH = 0.96;
export const TV_HEIGHT = 0.56;
export const TV_DEPTH = 0.04;

export interface ModelSpec {
  kind: ObjectKind;
  label: string;
  /** Where the object is spawned relative to the user. */
  spawn: 'floor' | 'eye';
  build: () => THREE.Object3D;
}

const shared = {
  cubeGeometry: new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE),
  cubeMaterial: new THREE.MeshStandardMaterial({ color: 0x4f8cff, roughness: 0.6 }),

  tvBodyGeometry: new THREE.BoxGeometry(TV_WIDTH, TV_HEIGHT, TV_DEPTH),
  tvBodyMaterial: new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.4, metalness: 0.3 }),
  tvScreenGeometry: new THREE.PlaneGeometry(TV_WIDTH - 0.04, TV_HEIGHT - 0.04),
  tvScreenMaterial: new THREE.MeshStandardMaterial({
    color: 0x0c1a33,
    emissive: 0x18407a,
    emissiveIntensity: 0.6,
    roughness: 0.2,
    metalness: 0.1,
  }),
};

/** A cube whose origin is at the centre of its bottom face. */
function createCube(): THREE.Object3D {
  const mesh = new THREE.Mesh(shared.cubeGeometry, shared.cubeMaterial);
  mesh.position.y = CUBE_SIZE / 2;
  const root = new THREE.Group();
  root.add(mesh);
  return root;
}

/**
 * A wall TV whose origin is the centre of its back face (the point that
 * touches the wall) and whose screen faces +Z.
 */
function createTv(): THREE.Object3D {
  const body = new THREE.Mesh(shared.tvBodyGeometry, shared.tvBodyMaterial);
  body.position.z = TV_DEPTH / 2;
  const screen = new THREE.Mesh(shared.tvScreenGeometry, shared.tvScreenMaterial);
  screen.position.z = TV_DEPTH + 0.001;
  const root = new THREE.Group();
  root.add(body, screen);
  return root;
}

export const CATALOGUE: ModelSpec[] = [
  { kind: 'tv', label: 'TV', spawn: 'eye', build: createTv },
  { kind: 'cube', label: 'Box', spawn: 'floor', build: createCube },
];

export function getModelSpec(kind: ObjectKind): ModelSpec {
  const spec = CATALOGUE.find((m) => m.kind === kind);
  if (!spec) throw new Error(`Unknown model kind: ${kind}`);
  return spec;
}

/** Call once when the app is torn down. Instances must already be removed. */
export function disposeSharedModelResources(): void {
  for (const value of Object.values(shared)) value.dispose();
}
