import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CATALOGUE } from '../ar/models';

/**
 * Developer page (open with ?ui=models): the catalogue models in a plain
 * grey room with the same renderer settings as AR, so their look can be
 * checked on a desktop. This is not AR and is not linked from the app.
 */
export default function ModelPreview() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xc9ccd2);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f9c, 0.6);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(0.6, 1.4, 0.8);
    scene.add(hemi, dir);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshStandardMaterial({ color: 0xe6e3dd, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 3),
      new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.95 }),
    );
    wall.position.set(0, 1.5, -1);
    scene.add(floor, wall);

    const byKind = Object.fromEntries(CATALOGUE.map((m) => [m.kind, m]));
    const tv = byKind.tv.build();
    tv.position.set(0, 1.25, -1);
    const table = byKind.table.build();
    table.position.set(0, 0, 0.1);
    const chairA = byKind.chair.build();
    chairA.position.set(-0.35, 0, 0.75);
    chairA.rotation.y = Math.PI;
    const chairB = byKind.chair.build();
    chairB.position.set(0.35, 0, 0.75);
    chairB.rotation.y = Math.PI;
    scene.add(tv, table, chairA, chairB);

    const camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.05, 50);
    let raf = 0;
    const start = performance.now();
    const frame = () => {
      const t = (performance.now() - start) / 1000;
      const a = 0.55 * Math.sin(t * 0.3);
      camera.position.set(Math.sin(a) * 3.4, 1.7, 0.3 + Math.cos(a) * 3.4);
      camera.lookAt(0, 0.85, -0.2);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    frame();

    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0 }} ref={host}>
      <div className="ar-banner">Model preview for development. This is not AR.</div>
    </div>
  );
}
