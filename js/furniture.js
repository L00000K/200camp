// Procedural furniture catalogue. Every builder returns a THREE.Group whose
// origin sits at floor level in the centre of the footprint: x in [-w/2,w/2],
// y in [0,h], z in [-d/2,d/2] (z- is the "back" of the item).
import * as THREE from 'three';

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...opts }));
  }
  return matCache.get(key);
}
const shade = (hex, f) => {
  const c = new THREE.Color(hex);
  if (f > 1) c.lerp(new THREE.Color(0xffffff), f - 1); else c.multiplyScalar(f);
  return '#' + c.getHexString();
};
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 28);
const coneGeo = new THREE.ConeGeometry(1, 1, 28, 1, true);
const sphGeo = new THREE.SphereGeometry(1, 20, 14);

function box(g, m, cx, cy, cz, sx, sy, sz) {
  const o = new THREE.Mesh(boxGeo, m);
  o.position.set(cx, cy, cz);
  o.scale.set(Math.max(sx, 0.001), Math.max(sy, 0.001), Math.max(sz, 0.001));
  g.add(o); return o;
}
function cyl(g, m, cx, cy, cz, r, h, rz = r) {
  const o = new THREE.Mesh(cylGeo, m);
  o.position.set(cx, cy, cz); o.scale.set(r, Math.max(h, 0.001), rz);
  g.add(o); return o;
}
function sph(g, m, cx, cy, cz, rx, ry = rx, rz = rx) {
  const o = new THREE.Mesh(sphGeo, m);
  o.position.set(cx, cy, cz); o.scale.set(rx, ry, rz);
  g.add(o); return o;
}
function legs(g, m, w, d, h, inset = 0.04, t = 0.04) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(g, m, sx * (w / 2 - inset - t / 2), h / 2, sz * (d / 2 - inset - t / 2), t, h, t);
  }
}

// ---------- builders ----------
function sofa(w, d, h, color, { arms = true, legH = 0.08 } = {}) {
  const g = new THREE.Group();
  const m = mat(color), cm = mat(shade(color, 1.12)), lm = mat('#3a2f28');
  legs(g, lm, w, d, legH, 0.05, 0.05);
  const seatTop = Math.min(0.45, h * 0.55);
  const armW = arms ? Math.min(0.2, w * 0.12) : 0;
  box(g, m, 0, (legH + seatTop - 0.1) / 2, 0, w, seatTop - 0.1 - legH, d);
  box(g, m, 0, (legH + h) / 2, -d / 2 + 0.1, w, h - legH, 0.2);
  if (arms) for (const s of [-1, 1]) box(g, m, s * (w / 2 - armW / 2), (legH + seatTop + 0.18) / 2, 0.0, armW, seatTop + 0.18 - legH, d);
  const inner = w - 2 * armW, n = Math.max(1, Math.round(inner / 0.7)), cw = inner / n;
  for (let i = 0; i < n; i++) {
    const x = -inner / 2 + cw * (i + 0.5);
    box(g, cm, x, seatTop - 0.05, 0.1, cw - 0.02, 0.1, d - 0.22);
    box(g, cm, x, seatTop + (h - seatTop) * 0.45, -d / 2 + 0.26, cw - 0.04, (h - seatTop) * 0.8, 0.14);
  }
  return g;
}
function cornerSofa(w, d, h, color) {
  const g = new THREE.Group();
  const depth = Math.min(0.95, d * 0.45);
  const a = sofa(w, depth, h, color, { arms: false });
  a.position.z = -d / 2 + depth / 2; g.add(a);
  const b = sofa(d - depth, depth, h, color, { arms: false });
  b.rotation.y = Math.PI / 2; b.position.set(-w / 2 + depth / 2, 0, depth / 2); g.add(b);
  return g;
}
function armchair(w, d, h, color) { return sofa(w, d, h, color); }
function table(w, d, h, color, legColor) {
  const g = new THREE.Group();
  box(g, mat(color), 0, h - 0.02, 0, w, 0.04, d);
  legs(g, mat(legColor || shade(color, 0.7)), w, d, h - 0.04, 0.06, 0.05);
  return g;
}
function roundTable(w, d, h, color) {
  const g = new THREE.Group();
  cyl(g, mat(color), 0, h - 0.02, 0, w / 2, 0.04, d / 2);
  cyl(g, mat(shade(color, 0.6)), 0, (h - 0.04) / 2, 0, 0.05, h - 0.04);
  cyl(g, mat(shade(color, 0.6)), 0, 0.02, 0, Math.min(w, d) * 0.25, 0.04);
  return g;
}
function chair(w, d, h, color) {
  const g = new THREE.Group();
  const m = mat(color), seat = 0.46;
  legs(g, mat(shade(color, 0.7)), w, d, seat - 0.04, 0.03, 0.035);
  box(g, m, 0, seat - 0.02, 0, w, 0.05, d);
  box(g, m, 0, (seat + h) / 2, -d / 2 + 0.02, w, h - seat, 0.04);
  return g;
}
function officeChair(w, d, h, color) {
  const g = new THREE.Group();
  const m = mat(color), dk = mat('#222');
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2, b = box(g, dk, Math.cos(a) * w * 0.22, 0.05, Math.sin(a) * w * 0.22, w * 0.45, 0.03, 0.04);
    b.rotation.y = -a;
  }
  cyl(g, dk, 0, 0.25, 0, 0.025, 0.4);
  box(g, m, 0, 0.48, 0, w * 0.8, 0.08, d * 0.8);
  box(g, m, 0, (0.55 + h) / 2, -d * 0.38, w * 0.75, h - 0.55, 0.06);
  return g;
}
function bed(w, d, h, color) {
  const g = new THREE.Group();
  const frame = mat('#6b5442');
  box(g, frame, 0, 0.15, 0, w, 0.3, d);
  box(g, mat('#f2f0ea'), 0, 0.42, 0.03, w - 0.04, 0.24, d - 0.1);
  box(g, mat(color), 0, 0.555, 0.2, w - 0.02, 0.03, d * 0.68);
  box(g, frame, 0, h / 2, -d / 2 + 0.04, w, h, 0.08);
  const np = w > 1.1 ? 2 : 1;
  for (let i = 0; i < np; i++) box(g, mat('#ffffff'), (np === 1 ? 0 : (i - 0.5) * w * 0.5), 0.6, -d / 2 + 0.3, w / np - 0.12, 0.12, 0.35);
  return g;
}
function cabinet(w, d, h, color, { doors = 2, drawers = 0, top = null, plinth = 0.08 } = {}) {
  const g = new THREE.Group();
  const m = mat(color), ln = mat(shade(color, 0.75)), hd = mat('#9a9a9a', { metalness: 0.6, roughness: 0.4 });
  box(g, mat(shade(color, 0.6)), 0, plinth / 2, 0, w - 0.04, plinth, d - 0.04);
  box(g, m, 0, plinth + (h - plinth) / 2, 0, w, h - plinth, d);
  if (top) box(g, mat(top), 0, h + 0.02, 0, w + 0.02, 0.04, d + 0.02);
  const fz = d / 2 + 0.003;
  if (drawers) {
    const dh = (h - plinth) / drawers;
    for (let i = 1; i < drawers; i++) box(g, ln, 0, plinth + dh * i, fz, w - 0.02, 0.008, 0.004);
    for (let i = 0; i < drawers; i++) box(g, hd, 0, plinth + dh * (i + 0.5), fz + 0.01, Math.min(0.2, w * 0.3), 0.015, 0.02);
  } else if (doors) {
    const dw = w / doors;
    for (let i = 1; i < doors; i++) box(g, ln, -w / 2 + dw * i, plinth + (h - plinth) / 2, fz, 0.008, h - plinth - 0.02, 0.004);
    for (let i = 0; i < doors; i++) {
      const hx = -w / 2 + dw * (i + 0.5) + (i % 2 ? -1 : 1) * dw * 0.38;
      box(g, hd, hx, plinth + (h - plinth) * (h > 1.2 ? 0.5 : 0.8), fz + 0.01, 0.015, Math.min(0.25, h * 0.2), 0.02);
    }
  }
  return g;
}
function desk(w, d, h, color) {
  const g = table(w, d, h, color, '#333');
  const c = cabinet(0.4, d - 0.1, h - 0.06, shade(color, 0.92), { drawers: 3, plinth: 0.02 });
  c.position.x = w / 2 - 0.25; g.add(c);
  return g;
}
function bookshelf(w, d, h, color) {
  const g = new THREE.Group();
  const m = mat(color), t = 0.02;
  for (const s of [-1, 1]) box(g, m, s * (w / 2 - t / 2), h / 2, 0, t, h, d);
  box(g, mat(shade(color, 0.85)), 0, h / 2, -d / 2 + 0.005, w, h, 0.01);
  const n = Math.max(2, Math.round(h / 0.35));
  const books = ['#8b3a3a', '#3a5a8b', '#d9b44a', '#4a7a4a', '#ddd', '#555'];
  for (let i = 0; i <= n; i++) {
    const y = t / 2 + (h - t) * i / n;
    box(g, m, 0, y, 0, w - 2 * t, t, d);
    if (i < n) {
      let x = -w / 2 + t + 0.02, k = i * 3;
      const sh = (h - t) / n;
      while (x < w / 2 - t - 0.06 && (k % 7) !== 6) {
        const bw = 0.025 + ((k * 37) % 5) * 0.008, bh = sh * (0.55 + ((k * 13) % 4) * 0.08);
        box(g, mat(books[k % books.length]), x + bw / 2, y + t / 2 + bh / 2, 0.01, bw, bh, d * 0.75);
        x += bw + 0.003; k++;
      }
    }
  }
  return g;
}
function tvUnit(w, d, h, color) {
  const g = cabinet(w, d, h, color, { doors: Math.max(2, Math.round(w / 0.6)), plinth: 0.06 });
  const tw = Math.min(w * 0.85, 1.45), th = tw * 0.58;
  const dk = mat('#151515', { roughness: 0.3 });
  box(g, dk, 0, h + 0.03, 0, 0.3, 0.02, 0.2);
  box(g, dk, 0, h + 0.08, 0, 0.05, 0.1, 0.04);
  box(g, dk, 0, h + 0.12 + th / 2, 0, tw, th, 0.04);
  return g;
}
function tv(w, d, h, color) {
  const g = new THREE.Group();
  box(g, mat('#151515', { roughness: 0.3 }), 0, h / 2, 0, w, h, d);
  return g;
}
function rug(w, d, h, color) {
  const g = new THREE.Group();
  box(g, mat(color, { roughness: 1 }), 0, h / 2, 0, w, h, d);
  box(g, mat(shade(color, 0.8), { roughness: 1 }), 0, h / 2 + 0.0005, 0, w * 0.85, h, d * 0.8);
  return g;
}
function roundRug(w, d, h, color) {
  const g = new THREE.Group();
  cyl(g, mat(color, { roughness: 1 }), 0, h / 2, 0, w / 2, h, d / 2);
  return g;
}
function plant(w, d, h, color) {
  const g = new THREE.Group();
  const potH = Math.min(0.4, h * 0.3);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.75, 1, 20), mat(color));
  pot.scale.set(w * 0.3, potH, d * 0.3); pot.position.y = potH / 2; g.add(pot);
  const leaf = mat('#3f7a3a'), leaf2 = mat('#5a9a48');
  sph(g, leaf, 0, potH + (h - potH) * 0.45, 0, w * 0.42, (h - potH) * 0.45, d * 0.42);
  sph(g, leaf2, w * 0.1, potH + (h - potH) * 0.7, -d * 0.05, w * 0.3, (h - potH) * 0.3, d * 0.3);
  return g;
}
function floorLamp(w, d, h, color) {
  const g = new THREE.Group();
  const mt = mat('#333', { metalness: 0.5, roughness: 0.4 });
  cyl(g, mt, 0, 0.015, 0, w * 0.4, 0.03);
  cyl(g, mt, 0, h / 2, 0, 0.012, h);
  const shadeM = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1, 1, 24, 1, true), mat(color, { side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.25 }));
  shadeM.scale.set(w / 2, 0.3, d / 2); shadeM.position.y = h - 0.15; g.add(shadeM);
  return g;
}
function island(w, d, h, color) {
  return cabinet(w, d, h - 0.04, color, { doors: Math.max(2, Math.round(w / 0.6)), top: '#d8d4cc' });
}
function lounger(w, d, h, color) {
  // w = width (short side), d = length
  const g = new THREE.Group();
  const fr = mat('#8a6a4a'), cu = mat(color);
  legs(g, fr, w, d, 0.2, 0.03, 0.04);
  box(g, fr, 0, 0.22, 0.1, w, 0.05, d - 0.2);
  box(g, cu, 0, 0.28, 0.12, w - 0.04, 0.07, d * 0.62);
  const back = box(g, cu, 0, 0.22 + (h - 0.22) / 2, -d / 2 + 0.25, w - 0.04, 0.07, Math.hypot(h - 0.22, 0.45));
  back.rotation.x = Math.atan2(h - 0.22, 0.45);
  return g;
}
function parasol(w, d, h, color) {
  const g = new THREE.Group();
  const mt = mat('#666', { metalness: 0.4 });
  cyl(g, mat('#444'), 0, 0.04, 0, 0.25, 0.08);
  cyl(g, mt, 0, h / 2, 0, 0.022, h);
  const cn = new THREE.Mesh(coneGeo, mat(color, { side: THREE.DoubleSide }));
  cn.scale.set(w / 2, 0.45, d / 2); cn.position.y = h - 0.2; g.add(cn);
  return g;
}
function bbq(w, d, h, color) {
  const g = new THREE.Group();
  const m = mat(color, { metalness: 0.5, roughness: 0.4 }), dk = mat('#222');
  legs(g, dk, w * 0.6, d, 0.6, 0.02, 0.04);
  box(g, m, 0, 0.75, 0, w * 0.6, 0.3, d);
  const lid = box(g, m, 0, 0.95, 0, w * 0.6, 0.12, d * 0.95);
  for (const s of [-1, 1]) box(g, dk, s * w * 0.4, 0.86, 0, w * 0.2, 0.03, d * 0.9);
  box(g, mat('#aaa'), 0, h - 0.04, d / 2 - 0.02, w * 0.3, 0.03, 0.03);
  lid.scale.y = Math.max(0.05, h - 0.9);
  return g;
}
function planter(w, d, h, color) {
  const g = new THREE.Group();
  box(g, mat(color), 0, h / 2, 0, w, h, d);
  box(g, mat('#4a3626'), 0, h - 0.02, 0, w - 0.06, 0.02, d - 0.06);
  const n = Math.max(1, Math.round(w / 0.3));
  for (let i = 0; i < n; i++) sph(g, mat(i % 2 ? '#4f8a3f' : '#3c6e34'), -w / 2 + w * (i + 0.5) / n, h + 0.1, 0, w / n * 0.55, 0.18, d * 0.4);
  return g;
}
function bench(w, d, h, color) {
  const g = new THREE.Group();
  const m = mat(color);
  for (const s of [-1, 1]) box(g, mat(shade(color, 0.7)), s * (w / 2 - 0.08), (h - 0.04) / 2, 0, 0.06, h - 0.04, d * 0.9);
  for (let i = 0; i < 3; i++) box(g, m, 0, h - 0.02, -d / 2 + d * (i + 0.5) / 3, w, 0.035, d / 3 - 0.015);
  return g;
}
function hotTub(w, d, h, color) {
  const g = new THREE.Group();
  box(g, mat(color), 0, h / 2, 0, w, h, d);
  box(g, mat('#5fb4d6', { roughness: 0.15, metalness: 0.1 }), 0, h - 0.06, 0, w - 0.2, 0.02, d - 0.2);
  return g;
}
function firepit(w, d, h, color) {
  const g = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.6, 1, 28), mat(color, { metalness: 0.5, roughness: 0.6 }));
  bowl.scale.set(w / 2, h, d / 2); bowl.position.y = h / 2; g.add(bowl);
  cyl(g, mat('#ff7a1a', { emissive: '#ff5a00', emissiveIntensity: 0.6 }), 0, h - 0.04, 0, w * 0.38, 0.02, d * 0.38);
  return g;
}
function plainBox(w, d, h, color) { const g = new THREE.Group(); box(g, mat(color), 0, h / 2, 0, w, h, d); return g; }
function plainCyl(w, d, h, color) { const g = new THREE.Group(); cyl(g, mat(color), 0, h / 2, 0, w / 2, h, d / 2); return g; }
function door(w, d, h, color) {
  const g = new THREE.Group();
  const fr = mat('#eeeeee');
  for (const s of [-1, 1]) box(g, fr, s * (w / 2 - 0.03), h / 2, 0, 0.06, h, d);
  box(g, fr, 0, h - 0.03, 0, w, 0.06, d);
  box(g, mat(color), 0, (h - 0.06) / 2, 0, w - 0.12, h - 0.06, 0.04);
  box(g, mat('#999', { metalness: 0.6 }), w / 2 - 0.15, 1.0, 0.04, 0.1, 0.02, 0.03);
  return g;
}

// type -> definition. Dimensions in metres (w, d, h).
export const CATALOGUE = [
  { group: 'Living', items: [
    { type: 'sofa3', name: '3-seat sofa', w: 2.1, d: 0.92, h: 0.85, color: '#7d8a99', build: sofa },
    { type: 'sofa2', name: '2-seat sofa', w: 1.6, d: 0.9, h: 0.85, color: '#7d8a99', build: sofa },
    { type: 'cornersofa', name: 'Corner sofa', w: 2.7, d: 2.0, h: 0.85, color: '#9c9184', build: cornerSofa },
    { type: 'armchair', name: 'Armchair', w: 0.85, d: 0.85, h: 0.85, color: '#b08b5e', build: armchair },
    { type: 'coffeetable', name: 'Coffee table', w: 1.1, d: 0.6, h: 0.42, color: '#a07850', build: table },
    { type: 'sidetable', name: 'Side table', w: 0.5, d: 0.5, h: 0.55, color: '#a07850', build: table },
    { type: 'tvunit', name: 'TV unit + TV', w: 1.8, d: 0.42, h: 0.5, color: '#e8e4dc', build: tvUnit },
    { type: 'tv', name: 'Wall TV 55"', w: 1.23, d: 0.05, h: 0.71, color: '#151515', build: tv, elev: 1.0 },
    { type: 'bookshelf', name: 'Bookshelf', w: 0.8, d: 0.3, h: 1.9, color: '#d8cbb5', build: bookshelf },
    { type: 'rug', name: 'Rug', w: 2.0, d: 1.4, h: 0.012, color: '#c9b79c', build: rug },
    { type: 'roundrug', name: 'Round rug', w: 1.6, d: 1.6, h: 0.012, color: '#b9a4c9', build: roundRug },
    { type: 'floorlamp', name: 'Floor lamp', w: 0.4, d: 0.4, h: 1.6, color: '#f3e9d2', build: floorLamp },
    { type: 'plant', name: 'House plant', w: 0.5, d: 0.5, h: 1.2, color: '#d9d2c5', build: plant },
  ]},
  { group: 'Dining & kitchen', items: [
    { type: 'dining', name: 'Dining table', w: 1.8, d: 0.9, h: 0.75, color: '#b58b5a', build: table },
    { type: 'rounddining', name: 'Round table', w: 1.2, d: 1.2, h: 0.75, color: '#b58b5a', build: roundTable },
    { type: 'chair', name: 'Dining chair', w: 0.45, d: 0.5, h: 0.9, color: '#6f5a46', build: chair },
    { type: 'island', name: 'Kitchen island', w: 1.8, d: 0.9, h: 0.92, color: '#5d6b62', build: island },
    { type: 'sideboard', name: 'Sideboard', w: 1.6, d: 0.45, h: 0.8, color: '#8a6c50', build: (w, d, h, c) => cabinet(w, d, h, c, { doors: 3 }) },
  ]},
  { group: 'Bedroom & study', items: [
    { type: 'bedking', name: 'King bed 160', w: 1.6, d: 2.05, h: 1.0, color: '#8fa7c4', build: bed },
    { type: 'beddouble', name: 'Double bed 140', w: 1.4, d: 2.0, h: 1.0, color: '#8fa7c4', build: bed },
    { type: 'bedsingle', name: 'Single bed 90', w: 0.9, d: 2.0, h: 0.9, color: '#c48f8f', build: bed },
    { type: 'bedside', name: 'Bedside table', w: 0.45, d: 0.4, h: 0.55, color: '#e8e4dc', build: (w, d, h, c) => cabinet(w, d, h, c, { drawers: 2, plinth: 0.05 }) },
    { type: 'wardrobe', name: 'Wardrobe', w: 1.5, d: 0.6, h: 2.1, color: '#ece8e0', build: (w, d, h, c) => cabinet(w, d, h, c, { doors: Math.max(2, Math.round(w / 0.5)) }) },
    { type: 'drawers', name: 'Chest of drawers', w: 1.0, d: 0.5, h: 0.85, color: '#c9ad8a', build: (w, d, h, c) => cabinet(w, d, h, c, { drawers: 4 }) },
    { type: 'desk', name: 'Desk', w: 1.4, d: 0.7, h: 0.75, color: '#ddd5c8', build: desk },
    { type: 'officechair', name: 'Office chair', w: 0.6, d: 0.6, h: 1.05, color: '#444b55', build: officeChair },
  ]},
  { group: 'Outdoor', items: [
    { type: 'outsofa', name: 'Outdoor sofa', w: 1.9, d: 0.85, h: 0.75, color: '#d9d4c7', build: sofa },
    { type: 'outarmchair', name: 'Outdoor armchair', w: 0.8, d: 0.8, h: 0.75, color: '#d9d4c7', build: armchair },
    { type: 'outdining', name: 'Outdoor table', w: 1.6, d: 0.9, h: 0.74, color: '#9b7350', build: table },
    { type: 'outchair', name: 'Outdoor chair', w: 0.55, d: 0.58, h: 0.85, color: '#3d3d3d', build: chair },
    { type: 'lounger', name: 'Sun lounger', w: 0.7, d: 1.95, h: 0.8, color: '#f0ece2', build: lounger },
    { type: 'parasol', name: 'Parasol', w: 3.0, d: 3.0, h: 2.5, color: '#e4d8be', build: parasol },
    { type: 'bbq', name: 'BBQ', w: 1.2, d: 0.6, h: 1.1, color: '#2e2e2e', build: bbq },
    { type: 'planter', name: 'Planter box', w: 1.0, d: 0.4, h: 0.45, color: '#7a6a5a', build: planter },
    { type: 'bench', name: 'Bench', w: 1.5, d: 0.45, h: 0.45, color: '#a2774f', build: bench },
    { type: 'hottub', name: 'Hot tub', w: 2.0, d: 2.0, h: 0.85, color: '#5b4a3c', build: hotTub },
    { type: 'firepit', name: 'Fire pit', w: 0.9, d: 0.9, h: 0.4, color: '#3a3a3a', build: firepit },
    { type: 'potplant', name: 'Large pot plant', w: 0.7, d: 0.7, h: 1.6, color: '#b5643c', build: plant },
  ]},
  { group: 'Basic shapes', items: [
    { type: 'box', name: 'Box', w: 1.0, d: 0.6, h: 0.75, color: '#c8b8a0', build: plainBox },
    { type: 'cylinder', name: 'Cylinder', w: 0.6, d: 0.6, h: 0.75, color: '#c8b8a0', build: plainCyl },
    { type: 'partition', name: 'Wall / partition', w: 1.2, d: 0.1, h: 2.4, color: '#f2f0ec', build: plainBox },
    { type: 'door', name: 'Door', w: 0.86, d: 0.08, h: 2.04, color: '#f7f6f2', build: door },
  ]},
];

export const TYPES = {};
for (const g of CATALOGUE) for (const it of g.items) TYPES[it.type] = it;

export function buildItemObject(item) {
  const def = TYPES[item.type] || TYPES.box;
  const g = def.build(item.w, item.d, item.h, item.color);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
