"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

interface BattleSceneProps { bias: number; colorA: string; colorB: string; reducedMotion: boolean; className?: string; }

export default function BattleScene({ bias, colorA, colorB, reducedMotion, className = "" }: BattleSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const biasRef = useRef(bias);
  const colorsRef = useRef({ colorA, colorB });
  useEffect(() => { biasRef.current = bias; }, [bias]);
  useEffect(() => { colorsRef.current = { colorA, colorB }; }, [colorA, colorB]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let width = mount.clientWidth;
    let height = mount.clientHeight;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0c0d, 0.055);
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 0.6, 9);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);
    const grid = new THREE.GridHelper(60, 60, 0x2a3235, 0x1a2022);
    grid.position.y = -2.4;
    const gridMaterial = grid.material as THREE.LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.35;
    scene.add(grid);

    function makeCluster(color: string, xSign: number) {
      const count = 260;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const r = 1.4 + Math.random() * 1.1;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i * 3] = xSign * 3.1 + r * Math.sin(phi) * Math.cos(theta) * 0.9;
        positions[i * 3 + 1] = r * Math.cos(phi) * 0.9;
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta) * 0.6;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      return new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color(color), size: 0.045, transparent: true, opacity: 0.85, depthWrite: false }));
    }

    const clusterA = makeCluster(colorsRef.current.colorA, -1);
    const clusterB = makeCluster(colorsRef.current.colorB, 1);
    scene.add(clusterA, clusterB);
    const coreA = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshBasicMaterial({ color: colorsRef.current.colorA, wireframe: true, transparent: true, opacity: 0.55 }));
    coreA.position.x = -3.1;
    const coreB = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshBasicMaterial({ color: colorsRef.current.colorB, wireframe: true, transparent: true, opacity: 0.55 }));
    coreB.position.x = 3.1;
    scene.add(coreA, coreB);

    const barGroup = new THREE.Group();
    const bars: { mesh: THREE.Mesh; speed: number }[] = [];
    for (let i = 0; i < 34; i++) {
      const up = Math.random() > 0.45;
      const h = 0.3 + Math.random() * 1.1;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), new THREE.MeshBasicMaterial({ color: up ? 0xb99a58 : 0x8a4a4a, transparent: true, opacity: 0.22 }));
      mesh.position.set((Math.random() - 0.5) * 14, -1.6 + h / 2, -12 + Math.random() * 24);
      barGroup.add(mesh);
      bars.push({ mesh, speed: 0.4 + Math.random() * 0.5 });
    }
    scene.add(barGroup);

    let raf = 0;
    let t = 0;
    const clock = new THREE.Clock();
    function render() {
      const dt = reducedMotion ? 0 : Math.min(clock.getDelta(), 0.05);
      t += dt;
      const b = biasRef.current;
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, b * 1.1, 0.06);
      camera.lookAt(0, 0.1, 0);
      coreA.rotation.y += dt * 0.15;
      coreA.rotation.x += dt * 0.06;
      coreB.rotation.y -= dt * 0.15;
      coreB.rotation.x += dt * 0.06;
      clusterA.rotation.y += dt * 0.03;
      clusterB.rotation.y -= dt * 0.03;
      const glowA = THREE.MathUtils.clamp(0.55 - b * 0.35, 0.15, 0.9);
      const glowB = THREE.MathUtils.clamp(0.55 + b * 0.35, 0.15, 0.9);
      (coreA.material as THREE.MeshBasicMaterial).opacity = glowA;
      (coreB.material as THREE.MeshBasicMaterial).opacity = glowB;
      (clusterA.material as THREE.PointsMaterial).opacity = glowA;
      (clusterB.material as THREE.PointsMaterial).opacity = glowB;
      coreA.scale.setScalar(1 + glowA * 0.18);
      coreB.scale.setScalar(1 + glowB * 0.18);
      if (!reducedMotion) {
        for (const bar of bars) { bar.mesh.position.z += dt * bar.speed; if (bar.mesh.position.z > 12) bar.mesh.position.z = -12; }
        grid.position.z = (t * 0.4) % 2;
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    }
    render();
    if (reducedMotion) { cancelAnimationFrame(raf); renderer.render(scene, camera); }
    function onResize() {
      if (!mount) return;
      width = mount.clientWidth;
      height = mount.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    }
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      scene.traverse((obj) => { if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) { obj.geometry.dispose(); const mat = obj.material; (Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose()); } });
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);
  return <div ref={mountRef} aria-hidden="true" className={className} />;
}