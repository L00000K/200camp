// Scan loading + per-triangle visibility mask used for tidying.
// labels.bin (auto clean-up): 0 = furniture/clutter (hidden), 1 = floor, 2 = wall, 3 = ceiling.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshBVH } from 'three-mesh-bvh';

export const LABEL = { CLUTTER: 0, FLOOR: 1, WALL: 2, CEILING: 3 };
const MASK_KEY = 'housedesigner.mask.v1';

export class Scan {
  constructor() {
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
    this.showCeiling = false;
    this.showRemoved = false;
    this.undoStack = []; this.redoStack = [];
    this.onChange = () => {};
    this._dirty = false;
  }

  async load(base, onProgress) {
    const loader = new GLTFLoader();
    const [gltf, labels, meta, shippedMask, fill] = await Promise.all([
      loader.loadAsync(base + 'scan.glb', e => onProgress && e.total && onProgress(e.loaded / e.total)),
      fetch(base + 'labels.bin').then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
      fetch(base + 'meta.json').then(r => r.json()),
      fetch(base + 'mask.bin').then(r => r.ok ? r.arrayBuffer() : null).catch(() => null),
      loader.loadAsync(base + 'floorfill.glb').catch(() => null),
    ]);
    let src = null;
    gltf.scene.traverse(o => { if (o.isMesh && !src) src = o; });
    src.updateWorldMatrix(true, false);
    const geo = src.geometry.clone();
    geo.applyMatrix4(src.matrixWorld);
    this.geo = geo;
    this.fullIndex = geo.index.array.slice();
    this.faceCount = this.fullIndex.length / 3;
    this.labels = labels.length === this.faceCount ? labels : new Uint8Array(this.faceCount).fill(2);
    this.meta = meta;
    const fb = Uint8Array.from(atob(meta.floorMM), c => c.charCodeAt(0));
    this.floorGrid = new Int16Array(fb.buffer);

    const tex = src.material.map;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide, clippingPlanes: [this.clipPlane] });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'scan';

    // ghost of removed triangles (shares vertex data)
    const gGeo = new THREE.BufferGeometry();
    for (const k in geo.attributes) gGeo.setAttribute(k, geo.attributes[k]);
    this.ghostGeo = gGeo;
    this.ghost = new THREE.Mesh(gGeo, new THREE.MeshBasicMaterial({
      color: 0xff3b30, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [this.clipPlane],
    }));
    this.ghost.visible = false;
    this.ghost.renderOrder = 2;

    // BVH over the full mesh for picking (indirect keeps the index untouched)
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', geo.attributes.position);
    pGeo.setIndex(new THREE.BufferAttribute(this.fullIndex.slice(), 1));
    this.bvh = new MeshBVH(pGeo, { indirect: true });
    this.pickGeo = pGeo;

    this._computeCentroids();

    if (fill) {
      let fm = null; fill.scene.traverse(o => { if (o.isMesh && !fm) fm = o; });
      const m = fm.material.map; m.colorSpace = THREE.SRGBColorSpace;
      fm.material = new THREE.MeshBasicMaterial({ map: m });
      this.fill = fm; fm.name = 'floorfill';
    }

    // initial visibility: localStorage > assets/mask.bin > auto labels
    this.visible = new Uint8Array(this.faceCount);
    this.defaultVisible = new Uint8Array(this.faceCount);
    if (shippedMask && shippedMask.byteLength === Math.ceil(this.faceCount / 8)) {
      unpackBits(new Uint8Array(shippedMask), this.defaultVisible);
      this.hasShippedMask = true;
    } else {
      for (let f = 0; f < this.faceCount; f++) this.defaultVisible[f] = this.labels[f] !== 0 ? 1 : 0;
    }
    const saved = loadSavedMask(this.faceCount);
    this.visible.set(saved || this.defaultVisible);
    this.rebuild();
  }

  _computeCentroids() {
    const P = this.geo.attributes.position.array, I = this.fullIndex, F = this.faceCount;
    const C = new Float32Array(F * 3);
    const box = new THREE.Box3();
    for (let f = 0; f < F; f++) {
      const a = I[3 * f] * 3, b = I[3 * f + 1] * 3, c = I[3 * f + 2] * 3;
      C[3 * f] = (P[a] + P[b] + P[c]) / 3;
      C[3 * f + 1] = (P[a + 1] + P[b + 1] + P[c + 1]) / 3;
      C[3 * f + 2] = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    }
    this.centroids = C;
    this.geo.computeBoundingBox();
    box.copy(this.geo.boundingBox).expandByScalar(0.01);
    this.bounds = box;
    // uniform grid buckets for fast brush queries
    const cs = 0.25; this.gcs = cs;
    const gx = Math.ceil((box.max.x - box.min.x) / cs), gy = Math.ceil((box.max.y - box.min.y) / cs), gz = Math.ceil((box.max.z - box.min.z) / cs);
    this.gdim = [gx, gy, gz];
    const cell = new Int32Array(F), counts = new Int32Array(gx * gy * gz + 1);
    for (let f = 0; f < F; f++) {
      const i = Math.min(gx - 1, ((C[3 * f] - box.min.x) / cs) | 0), j = Math.min(gy - 1, ((C[3 * f + 1] - box.min.y) / cs) | 0), k = Math.min(gz - 1, ((C[3 * f + 2] - box.min.z) / cs) | 0);
      const id = (i * gy + j) * gz + k; cell[f] = id; counts[id + 1]++;
    }
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
    const fill = counts.slice(0, -1), order = new Int32Array(F);
    for (let f = 0; f < F; f++) order[fill[cell[f]]++] = f;
    this.gStart = counts; this.gOrder = order;
  }

  // faces with centroid inside sphere
  facesInSphere(center, r, cb) {
    const b = this.bounds.min, cs = this.gcs, [gx, gy, gz] = this.gdim, C = this.centroids, r2 = r * r;
    const i0 = Math.max(0, Math.floor((center.x - r - b.x) / cs)), i1 = Math.min(gx - 1, Math.floor((center.x + r - b.x) / cs));
    const j0 = Math.max(0, Math.floor((center.y - r - b.y) / cs)), j1 = Math.min(gy - 1, Math.floor((center.y + r - b.y) / cs));
    const k0 = Math.max(0, Math.floor((center.z - r - b.z) / cs)), k1 = Math.min(gz - 1, Math.floor((center.z + r - b.z) / cs));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
      const id = (i * gy + j) * gz + k;
      for (let n = this.gStart[id]; n < this.gStart[id + 1]; n++) {
        const f = this.gOrder[n];
        const dx = C[3 * f] - center.x, dy = C[3 * f + 1] - center.y, dz = C[3 * f + 2] - center.z;
        if (dx * dx + dy * dy + dz * dz <= r2) cb(f);
      }
    }
  }

  isShown(f) { return this.visible[f] && (this.showCeiling || this.labels[f] !== LABEL.CEILING); }

  rebuild() {
    if (!this.geo) return;
    const F = this.faceCount, I = this.fullIndex, V = this.visible, L = this.labels, sc = this.showCeiling;
    let n = 0, h = 0;
    for (let f = 0; f < F; f++) { if (V[f]) { if (sc || L[f] !== 3) n++; } else h++; }
    const vi = new Uint32Array(n * 3), hi = new Uint32Array(this.showRemoved ? h * 3 : 0);
    let p = 0, q = 0;
    for (let f = 0; f < F; f++) {
      if (V[f]) {
        if (sc || L[f] !== 3) { vi[p++] = I[3 * f]; vi[p++] = I[3 * f + 1]; vi[p++] = I[3 * f + 2]; }
      } else if (this.showRemoved) { hi[q++] = I[3 * f]; hi[q++] = I[3 * f + 1]; hi[q++] = I[3 * f + 2]; }
    }
    this.geo.setIndex(new THREE.BufferAttribute(vi, 1));
    this.ghostGeo.setIndex(new THREE.BufferAttribute(hi, 1));
    this.ghost.visible = this.showRemoved;
    this.hiddenCount = h;
  }

  // ---- picking ----
  // mode: 'visible' (what you see) or 'any' (include removed, for restoring)
  raycast(raycaster, mode = 'visible') {
    const hits = this.bvh.raycast(raycaster.ray, THREE.DoubleSide);
    let best = null;
    for (const h of hits) {
      const f = h.faceIndex;
      if (h.point.y > this.clipPlane.constant) continue;
      if (mode === 'visible' ? !this.isShown(f) : !(this.isShown(f) || !this.visible[f])) continue;
      if (h.distance < raycaster.near || h.distance > raycaster.far) continue;
      if (!best || h.distance < best.distance) best = h;
    }
    return best;
  }

  // ---- editing with undo ----
  beginStroke() { this._stroke = new Map(); }
  setFace(f, v) {
    if (this.visible[f] === v) return false;
    if (this._stroke && !this._stroke.has(f)) this._stroke.set(f, this.visible[f]);
    this.visible[f] = v; this._dirty = true; return true;
  }
  endStroke(label) {
    const s = this._stroke; this._stroke = null;
    if (!s || !s.size) return 0;
    const faces = Int32Array.from(s.keys()), before = Uint8Array.from(s.values());
    this.undoStack.push({ faces, before, label });
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
    this.commit();
    return faces.length;
  }
  undo() { this._swap(this.undoStack, this.redoStack); }
  redo() { this._swap(this.redoStack, this.undoStack); }
  _swap(from, to) {
    const op = from.pop(); if (!op) return;
    const cur = new Uint8Array(op.faces.length);
    for (let i = 0; i < op.faces.length; i++) { cur[i] = this.visible[op.faces[i]]; this.visible[op.faces[i]] = op.before[i]; }
    to.push({ faces: op.faces, before: cur, label: op.label });
    this.commit();
  }
  commit() { this.rebuild(); this.save(); this.onChange(); }

  brush(center, r, value, { protectFloor, protectWalls, minY = -Infinity } = {}) {
    let changed = 0;
    const L = this.labels;
    this.facesInSphere(center, r, f => {
      if (value === 0 && protectFloor && L[f] === 1) return;
      if (value === 0 && protectWalls && L[f] === 2) return;
      if (!this.showCeiling && L[f] === 3) return;
      if (this.centroids[3 * f + 1] < minY) return;
      if (this.setFace(f, value)) changed++;
    });
    if (changed) this.rebuild();
    return changed;
  }

  applyBox(obj, value, opts = {}) {
    obj.updateMatrixWorld(true);
    const inv = obj.matrixWorld.clone().invert(), v = new THREE.Vector3(), C = this.centroids, L = this.labels;
    this.beginStroke();
    for (let f = 0; f < this.faceCount; f++) {
      v.set(C[3 * f], C[3 * f + 1], C[3 * f + 2]).applyMatrix4(inv);
      if (Math.abs(v.x) <= 0.5 && Math.abs(v.y) <= 0.5 && Math.abs(v.z) <= 0.5) {
        if (value === 0 && opts.protectFloor && L[f] === 1) continue;
        if (value === 0 && opts.protectWalls && L[f] === 2) continue;
        this.setFace(f, value);
      }
    }
    return this.endStroke(value ? 'restore box' : 'remove box');
  }

  // remove visible connected pieces smaller than minArea (m²)
  removeFloating(minArea) {
    const P = this.geo.attributes.position.array, I = this.fullIndex, F = this.faceCount;
    // weld vertices by position so UV seams don't split pieces
    const nV = P.length / 3, weld = new Int32Array(nV), map = new Map();
    for (let v = 0; v < nV; v++) {
      const key = Math.round(P[3 * v] * 2000) + ',' + Math.round(P[3 * v + 1] * 2000) + ',' + Math.round(P[3 * v + 2] * 2000);
      let id = map.get(key); if (id === undefined) { id = v; map.set(key, v); } weld[v] = id;
    }
    const parent = new Int32Array(nV); for (let i = 0; i < nV; i++) parent[i] = i;
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const shown = f => this.visible[f];
    for (let f = 0; f < F; f++) {
      if (!shown(f)) continue;
      const a = find(weld[I[3 * f]]), b = find(weld[I[3 * f + 1]]), c = find(weld[I[3 * f + 2]]);
      parent[b] = a; parent[find(c)] = a;
    }
    const area = new Map(), A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3();
    const root = new Int32Array(F);
    for (let f = 0; f < F; f++) {
      if (!shown(f)) continue;
      const r = find(weld[I[3 * f]]); root[f] = r;
      A.fromArray(P, I[3 * f] * 3); B.fromArray(P, I[3 * f + 1] * 3); Cc.fromArray(P, I[3 * f + 2] * 3);
      const ar = B.sub(A).cross(Cc.sub(A)).length() / 2;
      area.set(r, (area.get(r) || 0) + ar);
    }
    this.beginStroke();
    for (let f = 0; f < F; f++) if (shown(f) && area.get(root[f]) < minArea) this.setFace(f, 0);
    return this.endStroke('remove floating');
  }

  resetTo(which) {
    this.beginStroke();
    for (let f = 0; f < this.faceCount; f++) {
      const v = which === 'original' ? 1 : which === 'auto' ? (this.labels[f] !== 0 ? 1 : 0) : this.defaultVisible[f];
      this.setFace(f, v);
    }
    this.endStroke('reset');
  }

  floorAt(x, z) {
    const m = this.meta; if (!m) return -1.47;
    const i = Math.floor((x - m.x0) / m.cs), j = Math.floor((z - m.z0) / m.cs);
    if (i < 0 || j < 0 || i >= m.nx || j >= m.nz) return m.floorY;
    return this.floorGrid[i * m.nz + j] / 1000;
  }

  setCut(y) { this.clipPlane.constant = y; }

  save() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => {
      try { localStorage.setItem(MASK_KEY, bytesToB64(packBits(this.visible))); } catch (e) { console.warn('mask save failed', e); }
    }, 400);
  }
  clearSaved() { try { localStorage.removeItem(MASK_KEY); } catch (e) {} }
  maskBytes() { return packBits(this.visible); }
  loadMaskBytes(bytes) {
    if (bytes.length !== Math.ceil(this.faceCount / 8)) throw new Error('Mask file does not match this scan');
    const nv = new Uint8Array(this.faceCount); unpackBits(bytes, nv);
    this.beginStroke(); for (let f = 0; f < this.faceCount; f++) this.setFace(f, nv[f]); this.endStroke('import mask');
  }

  // geometry with only visible faces, for export
  exportMesh() {
    const g = new THREE.BufferGeometry();
    for (const k in this.geo.attributes) g.setAttribute(k, this.geo.attributes[k]);
    const out = [];
    for (let f = 0; f < this.faceCount; f++) if (this.visible[f]) out.push(this.fullIndex[3 * f], this.fullIndex[3 * f + 1], this.fullIndex[3 * f + 2]);
    g.setIndex(out);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: this.material.map, metalness: 0, roughness: 1 }));
    m.name = 'scan-cleaned';
    return m;
  }
}

function packBits(v) {
  const out = new Uint8Array(Math.ceil(v.length / 8));
  for (let i = 0; i < v.length; i++) if (v[i]) out[i >> 3] |= 1 << (i & 7);
  return out;
}
function unpackBits(b, out) { for (let i = 0; i < out.length; i++) out[i] = (b[i >> 3] >> (i & 7)) & 1; }
function bytesToB64(b) { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
function loadSavedMask(n) {
  try {
    const s = localStorage.getItem(MASK_KEY); if (!s) return null;
    const b = Uint8Array.from(atob(s), c => c.charCodeAt(0));
    if (b.length !== Math.ceil(n / 8)) return null;
    const out = new Uint8Array(n); unpackBits(b, out); return out;
  } catch (e) { return null; }
}
export { packBits, bytesToB64 };
