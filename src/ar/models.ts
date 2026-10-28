import * as THREE from 'three';

/**
 * Placeholder models built from primitives. Phase 6 replaces these with GLB
 * files loaded on demand through GLTFLoader; the placement code only needs
 * an Object3D whose front faces +Z and whose origin is at the mounting point,
 * so swapping in real assets does not touch the AR engine.
 *
 * Geometries and materials are created once and shared between instances.
 */

export const CUBE_SIZE = 0.15;

/** Sample TV: 55 inch class, about 1.22 m wide, 0.70 m tall, 5 cm deep. */
export const TV_WIDTH = 1.22;
export const TV_HEIGHT = 0.7;
export const TV_DEPTH = 0.05;

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
export function createCube(): THREE.Object3D {
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
export function createTv(): THREE.Object3D {
  const body = new THREE.Mesh(shared.tvBodyGeometry, shared.tvBodyMaterial);
  body.position.z = TV_DEPTH / 2;
  const screen = new THREE.Mesh(shared.tvScreenGeometry, shared.tvScreenMaterial);
  screen.position.z = TV_DEPTH + 0.001;
  const root = new THREE.Group();
  root.add(body, screen);
  return root;
}

/** Call once when the app is torn down. Instances must already be removed. */
export function disposeSharedModelResources(): void {
  for (const value of Object.values(shared)) value.dispose();
}
