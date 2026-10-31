import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ObjectKind } from './types';

/**
 * Catalogue models, built in code so nothing has to download: the TV picture
 * and the wood grain are drawn on canvases once and shared.
 *
 * Every model's front faces +Z. Its origin is the mounting point: the centre
 * of the back for wall objects, the centre of the footprint for floor ones.
 * Swapping in GLB files later only needs the same convention.
 */

export interface ModelSpec {
  kind: ObjectKind;
  label: string;
  /** Short line shown on the catalogue card. */
  detail: string;
  /** Wall objects appear at eye height; floor objects on the detected floor. */
  spawn: 'floor' | 'eye';
  build: () => THREE.Object3D;
}

// ---------- Canvas textures ----------

function canvasTexture(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A sunset over mountains and a lake: bright, saturated, reads as "TV on". */
function drawTvPicture(g: CanvasRenderingContext2D) {
  const w = g.canvas.width;
  const h = g.canvas.height;
  const horizon = h * 0.7;

  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#16206b');
  sky.addColorStop(0.45, '#7b36a8');
  sky.addColorStop(0.8, '#ff7a59');
  sky.addColorStop(1, '#ffd27a');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, horizon);

  const sunX = w * 0.64;
  const sunY = horizon - h * 0.08;
  const sun = g.createRadialGradient(sunX, sunY, 0, sunX, sunY, h * 0.32);
  sun.addColorStop(0, 'rgba(255, 246, 210, 1)');
  sun.addColorStop(0.18, 'rgba(255, 220, 150, 0.95)');
  sun.addColorStop(1, 'rgba(255, 160, 90, 0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, w, horizon);

  const ridge = (color: string, base: number, peaks: [number, number][]) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, horizon);
    g.lineTo(0, base);
    for (const [x, y] of peaks) g.lineTo(x * w, y * h);
    g.lineTo(w, base);
    g.lineTo(w, horizon);
    g.closePath();
    g.fill();
  };
  ridge('#5b3389', horizon - h * 0.12, [[0.12, 0.47], [0.24, 0.56], [0.38, 0.42], [0.52, 0.55], [0.7, 0.45], [0.86, 0.53]]);
  ridge('#3a2266', horizon - h * 0.05, [[0.08, 0.6], [0.2, 0.52], [0.33, 0.62], [0.47, 0.57], [0.62, 0.64], [0.78, 0.55], [0.93, 0.62]]);
  ridge('#1f1440', horizon, [[0.1, 0.66], [0.28, 0.69], [0.45, 0.66], [0.66, 0.69], [0.88, 0.66]]);

  const lake = g.createLinearGradient(0, horizon, 0, h);
  lake.addColorStop(0, '#3a2a70');
  lake.addColorStop(1, '#0d0a24');
  g.fillStyle = lake;
  g.fillRect(0, horizon, w, h - horizon);

  // Sun reflection streaks on the water.
  for (let i = 0; i < 14; i++) {
    const y = horizon + 4 + i * ((h - horizon) / 15);
    const len = w * (0.16 - i * 0.008);
    g.fillStyle = `rgba(255, 190, 130, ${0.55 - i * 0.035})`;
    g.fillRect(sunX - len / 2, y, len, 2);
  }

  // Faint glass glare.
  const glare = g.createLinearGradient(0, 0, w, h);
  glare.addColorStop(0, 'rgba(255,255,255,0.10)');
  glare.addColorStop(0.35, 'rgba(255,255,255,0)');
  g.fillStyle = glare;
  g.fillRect(0, 0, w, h);
}

/** Oak-like grain: deterministic so every table looks the same. */
function drawWood(g: CanvasRenderingContext2D) {
  const w = g.canvas.width;
  const h = g.canvas.height;
  g.fillStyle = '#b07a45';
  g.fillRect(0, 0, w, h);
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 140; i++) {
    const y = rand() * h;
    const dark = rand() > 0.5;
    g.strokeStyle = dark ? `rgba(90, 52, 24, ${0.08 + rand() * 0.22})` : `rgba(230, 180, 120, ${0.05 + rand() * 0.12})`;
    g.lineWidth = 0.6 + rand() * 2.2;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x / (40 + rand() * 60) + i) * (1 + rand() * 3));
    g.stroke();
  }
}

/** Soft dark blob used as a contact shadow under and behind objects. */
function drawShadow(g: CanvasRenderingContext2D) {
  const s = g.canvas.width;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.5)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
}

// ---------- Shared resources (created on first use) ----------

interface Resources {
  disposables: { dispose(): void }[];
  shadow: THREE.MeshBasicMaterial;
  /** Lighter version for the halo on the wall behind the TV. */
  wallShadow: THREE.MeshBasicMaterial;
  plane: THREE.PlaneGeometry;
  tvBody: THREE.BufferGeometry;
  tvBodyMat: THREE.MeshStandardMaterial;
  tvScreen: THREE.PlaneGeometry;
  tvScreenMat: THREE.MeshBasicMaterial;
  fabric: THREE.MeshStandardMaterial;
  woodMat: THREE.MeshStandardMaterial;
  legWood: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  seat: THREE.BufferGeometry;
  backrest: THREE.BufferGeometry;
  chairLeg: THREE.CylinderGeometry;
  chairPost: THREE.CylinderGeometry;
  tableTop: THREE.BufferGeometry;
  tableLeg: THREE.BoxGeometry;
  apronLong: THREE.BoxGeometry;
  apronShort: THREE.BoxGeometry;
}

let shared: Resources | null = null;

function resources(): Resources {
  if (shared) return shared;
  const shadowTex = canvasTexture(128, 128, drawShadow);
  const tvTex = canvasTexture(1024, 576, drawTvPicture);
  const woodTex = canvasTexture(1024, 512, drawWood);

  const r: Resources = {
    disposables: [shadowTex, tvTex, woodTex],
    shadow: new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }),
    wallShadow: new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      toneMapped: false,
    }),
    plane: new THREE.PlaneGeometry(1, 1),

    tvBody: new RoundedBoxGeometry(TV_WIDTH, TV_HEIGHT, TV_DEPTH, 2, 0.008),
    tvBodyMat: new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.6, roughness: 0.32 }),
    tvScreen: new THREE.PlaneGeometry(TV_WIDTH - 0.022, TV_HEIGHT - 0.022),
    // Unlit and not tone-mapped so the picture stays bright like a real screen.
    tvScreenMat: new THREE.MeshBasicMaterial({ map: tvTex, toneMapped: false }),

    fabric: new THREE.MeshStandardMaterial({ color: 0x2d7f76, roughness: 0.92, metalness: 0 }),
    woodMat: new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.55, metalness: 0.02 }),
    legWood: new THREE.MeshStandardMaterial({ color: 0x9a6435, roughness: 0.5, metalness: 0.02 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.38, metalness: 0.7 }),

    seat: new RoundedBoxGeometry(0.46, 0.06, 0.46, 3, 0.022),
    backrest: new RoundedBoxGeometry(0.42, 0.22, 0.035, 3, 0.014),
    chairLeg: new THREE.CylinderGeometry(0.017, 0.013, 0.42, 14),
    chairPost: new THREE.CylinderGeometry(0.015, 0.015, 0.46, 14),

    tableTop: new RoundedBoxGeometry(1.2, 0.035, 0.75, 2, 0.01),
    tableLeg: new THREE.BoxGeometry(0.045, 0.715, 0.045),
    apronLong: new THREE.BoxGeometry(1.06, 0.06, 0.022),
    apronShort: new THREE.BoxGeometry(0.022, 0.06, 0.6),
  };
  r.disposables.push(
    r.shadow, r.wallShadow, r.plane, r.tvBody, r.tvBodyMat, r.tvScreen, r.tvScreenMat, r.fabric, r.woodMat, r.legWood, r.metal,
    r.seat, r.backrest, r.chairLeg, r.chairPost, r.tableTop, r.tableLeg, r.apronLong, r.apronShort,
  );
  shared = r;
  return r;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

/** Flat soft shadow lying on the floor under a floor object. */
function floorShadow(r: Resources, width: number, depth: number) {
  const s = mesh(r.plane, r.shadow, 0, 0.002, 0);
  s.rotation.x = -Math.PI / 2;
  s.scale.set(width, depth, 1);
  s.renderOrder = -1;
  return s;
}

// ---------- Models ----------

/** 43-inch class TV: 0.96 x 0.56 m, 3.5 cm deep. */
export const TV_WIDTH = 0.96;
export const TV_HEIGHT = 0.56;
export const TV_DEPTH = 0.035;

function createTv(): THREE.Object3D {
  const r = resources();
  const root = new THREE.Group();
  // Soft shadow on the wall around the TV, between the wall and the body.
  const wallShadow = mesh(r.plane, r.wallShadow, 0, -0.015, 0.001);
  wallShadow.scale.set(TV_WIDTH * 1.12, TV_HEIGHT * 1.28, 1);
  wallShadow.renderOrder = -1;
  root.add(
    wallShadow,
    mesh(r.tvBody, r.tvBodyMat, 0, 0, TV_DEPTH / 2),
    mesh(r.tvScreen, r.tvScreenMat, 0, 0, TV_DEPTH + 0.0006),
  );
  return root;
}

/** Dining chair, seat at 45 cm. Faces +Z (backrest at -Z). */
function createChair(): THREE.Object3D {
  const r = resources();
  const root = new THREE.Group();
  root.add(floorShadow(r, 0.62, 0.62));
  root.add(mesh(r.seat, r.fabric, 0, 0.42, 0));
  for (const x of [-0.19, 0.19]) {
    for (const z of [-0.19, 0.19]) root.add(mesh(r.chairLeg, r.legWood, x, 0.21, z));
    root.add(mesh(r.chairPost, r.legWood, x, 0.45 + 0.23, -0.19));
  }
  const back = mesh(r.backrest, r.fabric, 0, 0.79, -0.2);
  back.rotation.x = -0.08;
  root.add(back);
  return root;
}

/** Dining table, 120 x 75 cm, 75 cm high. */
function createTable(): THREE.Object3D {
  const r = resources();
  const root = new THREE.Group();
  root.add(floorShadow(r, 1.45, 1.0));
  root.add(mesh(r.tableTop, r.woodMat, 0, 0.75 - 0.0175, 0));
  for (const x of [-0.54, 0.54]) for (const z of [-0.31, 0.31]) root.add(mesh(r.tableLeg, r.metal, x, 0.3575, z));
  for (const z of [-0.33, 0.33]) root.add(mesh(r.apronLong, r.legWood, 0, 0.7, z));
  for (const x of [-0.55, 0.55]) root.add(mesh(r.apronShort, r.legWood, x, 0.7, 0));
  return root;
}

export const CATALOGUE: ModelSpec[] = [
  { kind: 'tv', label: 'TV', detail: '43 inch, wall', spawn: 'eye', build: createTv },
  { kind: 'chair', label: 'Chair', detail: 'Dining chair', spawn: 'floor', build: createChair },
  { kind: 'table', label: 'Table', detail: '120 × 75 cm', spawn: 'floor', build: createTable },
];

export function getModelSpec(kind: ObjectKind): ModelSpec {
  const spec = CATALOGUE.find((m) => m.kind === kind);
  if (!spec) throw new Error(`Unknown model kind: ${kind}`);
  return spec;
}

/** Call once when the app is torn down. Instances must already be removed. */
export function disposeSharedModelResources(): void {
  if (!shared) return;
  for (const d of shared.disposables) d.dispose();
  shared = null;
}
