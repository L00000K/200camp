// Floorplan-derived geometry: clean extruded walls + an image overlay, aligned to the scan.
import * as THREE from 'three';

const WALL_H = 2.52, HEADER = 2.1;

function prism(quad, y0, y1) {
  // quad: 4 [x,z] corners -> closed box between y0 and y1
  const shape = new THREE.Shape(quad.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  return g;
}
function merge(geos) {
  // tiny merge (positions + normals only) to keep draw calls low
  let n = 0; const parts = geos.map(g => (g.index ? g.toNonIndexed() : g)); parts.forEach(g => n += g.attributes.position.count);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return m;
}

export async function loadFloorplan(base, floorY, clipPlane) {
  const [data, tex] = await Promise.all([
    fetch(base + 'floorplan.json').then(r => (r.ok ? r.json() : null)),
    new THREE.TextureLoader().loadAsync(base + 'floorplan.png').catch(() => null),
  ]);
  if (!data) return null;

  const walls = new THREE.Group(); walls.name = 'floorplan-walls';
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf1eee8, roughness: 0.9, clippingPlanes: [clipPlane], clipShadows: true });
  const wm = new THREE.Mesh(merge(data.walls.map(q => prism(q, floorY, floorY + WALL_H))), wallMat);
  wm.castShadow = true; wm.receiveShadow = true; walls.add(wm);
  if (data.windows.length) {
    const hm = new THREE.Mesh(merge(data.windows.map(q => prism(q, floorY + HEADER, floorY + WALL_H))), wallMat);
    hm.castShadow = true; walls.add(hm);
    const glass = new THREE.Mesh(merge(data.windows.map(q => prism(q, floorY, floorY + HEADER))),
      new THREE.MeshStandardMaterial({ color: 0x9fd3ec, transparent: true, opacity: 0.32, roughness: 0.1, depthWrite: false, clippingPlanes: [clipPlane] }));
    walls.add(glass);
  }

  let overlay = null;
  if (tex) {
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const im = data.image;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(im.w, im.h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    plane.rotation.x = -Math.PI / 2;
    // the plane's centre is the image centre; shift if cx/cy are not exactly w/2,h/2
    plane.position.set(im.w / 2 - im.cx, 0, im.h / 2 - im.cy);
    overlay = new THREE.Group(); overlay.name = 'floorplan-overlay';
    const inner = new THREE.Group(); inner.scale.setScalar(im.s); inner.add(plane);
    overlay.add(inner);
    overlay.rotation.y = -(Math.PI + im.th);
    overlay.position.set(im.tx, floorY + 0.02, im.tz);
    overlay.renderOrder = 4; plane.renderOrder = 4;
  }
  return { walls, overlay, data };
}
