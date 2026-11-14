import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { CATALOGUE, TYPES, buildItemObject } from './furniture.js';
import { Scan } from './scan.js';
import { loadFloorplan } from './floorplan.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const LAYOUT_KEY = 'housedesigner.layouts.v1';
const PREFS_KEY = 'housedesigner.prefs.v1';
const uid = () => Math.random().toString(36).slice(2, 10);
const deg = r => r * 180 / Math.PI, rad = d => d * Math.PI / 180;
const safeGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { console.warn(e); } };

// ---------------------------------------------------------------- renderer
const viewport = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none';
viewport.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const bgColor = () => getComputedStyle(document.documentElement).getPropertyValue('--view').trim() || '#d9d7d2';
scene.background = new THREE.Color(bgColor());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => scene.background.set(bgColor()));
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const persp = new THREE.PerspectiveCamera(55, 1, 0.03, 200);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
let camera = persp;
const orbit = new OrbitControls(persp, renderer.domElement);
orbit.enableDamping = true; orbit.dampingFactor = 0.12; orbit.maxPolarAngle = Math.PI * 0.495;
const planCtl = new OrbitControls(ortho, renderer.domElement);
planCtl.enableRotate = false; planCtl.screenSpacePanning = true; planCtl.enabled = false;
planCtl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
planCtl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
planCtl.minZoom = 0.3; planCtl.maxZoom = 12;

const itemsGroup = new THREE.Group(); scene.add(itemsGroup);
const helpersGroup = new THREE.Group(); scene.add(helpersGroup);
const grid = new THREE.GridHelper(40, 40, 0x666666, 0x999999);
grid.material.transparent = true; grid.material.opacity = 0.35; grid.visible = false; scene.add(grid);

// ---------------------------------------------------------------- state
const scan = new Scan();
let view = 'orbit';
let layouts = [], currentId = null;
const itemObjs = new Map(); // id -> { data, obj, label }
let selectedId = null;
let tidyTool = 'none';
let measuring = false;
const layoutUndo = [], layoutRedo = [];
const prefs = Object.assign({ cut: 3.0, showCeiling: false, showFill: true, showGrid: false, showLabels: true, snap: true, xray: true, opacity: 1, panel: true, model: 'scan', fpOverlay: true }, JSON.parse(safeGet(PREFS_KEY) || '{}'));
const savePrefs = () => safeSet(PREFS_KEY, JSON.stringify(prefs));

function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------------------------------------------------------------- layouts
function current() { return layouts.find(l => l.id === currentId); }
function loadLayouts() {
  try { const s = JSON.parse(safeGet(LAYOUT_KEY) || 'null'); if (s && s.layouts?.length) { layouts = s.layouts; currentId = s.current; } } catch (e) {}
  if (!layouts.length) { layouts = [{ id: uid(), name: 'My layout', items: [] }]; }
  if (!current()) currentId = layouts[0].id;
}
function saveLayouts() {
  clearTimeout(saveLayouts._t);
  saveLayouts._t = setTimeout(() => safeSet(LAYOUT_KEY, JSON.stringify({ layouts, current: currentId })), 250);
}
function snapshot() { return JSON.stringify(current().items); }
function pushLayoutUndo(before) {
  layoutUndo.push({ id: currentId, items: before }); if (layoutUndo.length > 100) layoutUndo.shift();
  layoutRedo.length = 0; updateUndoButtons();
}
function layoutHistory(from, to) {
  const op = from.pop(); if (!op) return;
  const l = layouts.find(x => x.id === op.id); if (!l) return;
  to.push({ id: op.id, items: JSON.stringify(l.items) });
  l.items = JSON.parse(op.items);
  if (currentId !== op.id) currentId = op.id;
  rebuildItems(); saveLayouts(); renderLayoutUI(); updateUndoButtons();
}

// ---------------------------------------------------------------- items
function makeLabel(text) {
  const el = document.createElement('div'); el.className = 'label2d'; el.textContent = text;
  return new CSS2DObject(el);
}
const cm = m => Math.round(m * 100);
function labelText(d, sel) { return sel ? `${d.name} · ${cm(d.w)}×${cm(d.d)}×${cm(d.h)} cm` : d.name; }

function placeObj(entry) {
  const d = entry.data;
  const y = scan.floorAt(d.x, d.z) + (d.elev || 0);
  entry.obj.position.set(d.x, y, d.z);
  entry.obj.rotation.set(0, rad(-(d.rot || 0)), 0);
  entry.label.position.set(0, d.h + 0.12, 0);
  entry.label.element.textContent = labelText(d, d.id === selectedId);
}
function createItemObj(d) {
  const obj = buildItemObject(d);
  obj.userData.itemId = d.id;
  const label = makeLabel(d.name);
  obj.add(label);
  label.visible = prefs.showLabels;
  const entry = { data: d, obj, label };
  itemObjs.set(d.id, entry);
  itemsGroup.add(obj);
  applyOpacity(obj);
  placeObj(entry);
  return entry;
}
function disposeObj(obj) {
  obj.traverse(o => { if (o.isCSS2DObject) o.element.remove(); });
  obj.removeFromParent();
}
function rebuildItems() {
  for (const e of itemObjs.values()) disposeObj(e.obj);
  itemObjs.clear();
  for (const d of current().items) createItemObj(d);
  if (selectedId && !itemObjs.has(selectedId)) selectedId = null;
  select(selectedId);
}
function refreshItem(id) {
  const e = itemObjs.get(id); if (!e) return;
  disposeObj(e.obj); itemObjs.delete(id);
  createItemObj(e.data);
  if (id === selectedId) updateSelectionHelper();
}
function viewCentreOnFloor() {
  const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(0, 0), camera);
  const p = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -scan.meta.floorY);
  if (rc.ray.intersectPlane(plane, p) && scan.bounds.containsPoint(p.setY(scan.meta.floorY + 0.1))) return p;
  const c = new THREE.Vector3(); scan.bounds.getCenter(c); return c;
}
function addItem(type) {
  const def = TYPES[type];
  const p = view === 'walk' ? (() => { const f = new THREE.Vector3(); persp.getWorldDirection(f); f.y = 0; f.normalize(); return persp.position.clone().addScaledVector(f, 1.6); })() : viewCentreOnFloor();
  for (let k = 0; k < 12 && current().items.some(i => Math.hypot(i.x - p.x, i.z - p.z) < 0.4); k++) { p.x += 0.5; p.z += 0.35; }
  const before = snapshot();
  const d = { id: uid(), type, name: def.name, x: +p.x.toFixed(3), z: +p.z.toFixed(3), rot: 0, w: def.w, d: def.d, h: def.h, elev: def.elev || 0, color: def.color };
  current().items.push(d);
  pushLayoutUndo(before);
  createItemObj(d); select(d.id); saveLayouts(); renderItemList();
  toast(`Added ${def.name} — drag it into place`);
}
function deleteSelected() {
  if (!selectedId) return;
  const before = snapshot();
  current().items = current().items.filter(i => i.id !== selectedId);
  const e = itemObjs.get(selectedId); if (e) disposeObj(e.obj); itemObjs.delete(selectedId);
  pushLayoutUndo(before); select(null); saveLayouts(); renderItemList();
}
function duplicateSelected() {
  const e = itemObjs.get(selectedId); if (!e) return;
  const before = snapshot();
  const d = { ...e.data, id: uid(), x: e.data.x + 0.3, z: e.data.z + 0.3, locked: false };
  current().items.push(d); pushLayoutUndo(before);
  createItemObj(d); select(d.id); saveLayouts(); renderItemList();
}

// selection helper
const selBox = new THREE.Box3Helper(new THREE.Box3(), 0x2f6fde);
selBox.material.depthTest = false; selBox.renderOrder = 10; selBox.visible = false; selBox.raycast = () => {};
function updateSelectionHelper() {
  const e = itemObjs.get(selectedId);
  if (!e) { selBox.visible = false; selBox.removeFromParent(); return; }
  const d = e.data, m = 0.015;
  selBox.box.min.set(-d.w / 2 - m, -m, -d.d / 2 - m); selBox.box.max.set(d.w / 2 + m, d.h + m, d.d / 2 + m);
  if (selBox.parent !== e.obj) e.obj.add(selBox);
  selBox.visible = true;
}
function select(id) {
  const prev = itemObjs.get(selectedId);
  selectedId = id && itemObjs.has(id) ? id : null;
  if (prev) { prev.label.element.classList.remove('sel'); prev.label.element.textContent = labelText(prev.data, false); }
  const e = itemObjs.get(selectedId);
  if (e) { e.label.element.classList.add('sel'); e.label.element.textContent = labelText(e.data, true); e.label.visible = true; }
  if (prev && !prefs.showLabels) prev.label.visible = false;
  updateSelectionHelper(); renderSelectionPanel(); renderItemList();
}
function renderSelectionPanel() {
  const e = itemObjs.get(selectedId), card = $('#selection');
  card.classList.toggle('hidden', !e);
  if (!e) return;
  const d = e.data;
  $('#selName').value = d.name;
  $('#selW').value = cm(d.w); $('#selD').value = cm(d.d); $('#selH').value = cm(d.h); $('#selE').value = cm(d.elev || 0);
  $('#selRot').value = Math.round(d.rot || 0); $('#selRotOut').textContent = Math.round(d.rot || 0) + '°';
  $('#selColor').value = d.color;
  $('#selLock').textContent = d.locked ? 'Unlock' : 'Lock';
  $('#selLock').classList.toggle('on', !!d.locked);
}
function editSelected(fn, rebuild = false, record = true) {
  const e = itemObjs.get(selectedId); if (!e) return;
  const before = snapshot();
  fn(e.data);
  if (record) pushLayoutUndo(before);
  if (rebuild) refreshItem(selectedId); else { placeObj(e); updateSelectionHelper(); }
  renderSelectionPanel(); saveLayouts(); renderItemList();
}
const wrapRot = r => { r = ((r + 180) % 360 + 360) % 360 - 180; return Math.round(r * 10) / 10; };

function applyOpacity(root) {
  const op = prefs.opacity;
  root.traverse(o => { if (o.isMesh) { o.material.transparent = op < 1; o.material.opacity = op; o.material.depthWrite = op >= 1; } });
}

// ---------------------------------------------------------------- pointer handling
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function setNdc(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}
function pickItem() {
  const hits = raycaster.intersectObjects(itemsGroup.children, true);
  for (const h of hits) { let o = h.object; while (o && !o.userData.itemId) o = o.parent; if (o) return { id: o.userData.itemId, point: h.point, distance: h.distance }; }
  return null;
}
function floorPoint(y = scan.meta.floorY) {
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p) ? p : null;
}
function pickSurface() {
  const it = pickItem();
  let s = scan.mesh.visible ? scan.raycast(raycaster, 'visible') : null;
  if (fp && fp.walls.visible) {
    const w = raycaster.intersectObject(fp.walls, true).find(h => h.point.y <= scan.clipPlane.constant);
    if (w && (!s || w.distance < s.distance)) s = w;
  }
  if (it && (!s || it.distance < s.distance)) return it.point;
  if (s) return s.point;
  return floorPoint();
}

let down = null, drag = null, painting = false;
const activeControls = () => (view === 'plan' ? planCtl : orbit);

renderer.domElement.addEventListener('pointerdown', ev => {
  if (ev.button !== 0 && ev.pointerType === 'mouse') return;
  setNdc(ev);
  down = { x: ev.clientX, y: ev.clientY, t: performance.now() };
  if (tc.dragging || tc.axis) return;
  if (measuring) return;
  // tidy brush
  if ((tidyTool === 'erase' || tidyTool === 'restore') && !scan.mesh.visible) { toast('Set Display > Model to show the scan before tidying'); return; }
  if (tidyTool === 'erase' || tidyTool === 'restore') {
    const hit = scan.raycast(raycaster, tidyTool === 'erase' ? 'visible' : 'any');
    if (hit) {
      painting = true; activeControls().enabled = false;
      scan.beginStroke(); paintAt(hit.point);
      renderer.domElement.setPointerCapture(ev.pointerId);
    }
    return;
  }
  if (tidyTool === 'box') return;
  if (view === 'walk') return;
  const it = pickItem();
  if (it) {
    select(it.id);
    const e = itemObjs.get(it.id);
    if (e.data.locked) return;
    const fp = floorPoint(e.obj.position.y);
    if (!fp) return;
    drag = { id: it.id, offX: e.data.x - fp.x, offZ: e.data.z - fp.z, y: e.obj.position.y, before: snapshot(), moved: false };
    activeControls().enabled = false;
    renderer.domElement.setPointerCapture(ev.pointerId);
  }
}, { capture: true });

renderer.domElement.addEventListener('pointermove', ev => {
  setNdc(ev);
  if (painting) { const hit = scan.raycast(raycaster, tidyTool === 'erase' ? 'visible' : 'any'); if (hit) paintAt(hit.point); return; }
  if (drag) {
    const fp = floorPoint(drag.y); if (!fp) return;
    const e = itemObjs.get(drag.id);
    let x = fp.x + drag.offX, z = fp.z + drag.offZ;
    if (prefs.snap && !ev.altKey) { x = Math.round(x / 0.05) * 0.05; z = Math.round(z / 0.05) * 0.05; }
    if (x !== e.data.x || z !== e.data.z) { e.data.x = +x.toFixed(3); e.data.z = +z.toFixed(3); drag.moved = true; placeObj(e); updateSelectionHelper(); }
    return;
  }
  if (tidyTool === 'erase' || tidyTool === 'restore') updateBrushCursor();
  if (measuring) updateMeasurePreview();
  if (view !== 'walk' && !down && ev.pointerType === 'mouse') {
    renderer.domElement.style.cursor = tidyTool !== 'none' ? 'crosshair' : (pickItem() ? 'grab' : '');
  }
});

window.addEventListener('pointerup', ev => {
  const wasClick = down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5;
  if (painting) {
    painting = false; activeControls().enabled = view !== 'walk';
    const n = scan.endStroke(tidyTool); if (n) updateTidyStats();
  } else if (drag) {
    if (drag.moved) { pushLayoutUndo(drag.before); saveLayouts(); }
    drag = null; activeControls().enabled = view !== 'walk';
  } else if (wasClick && ev.target === renderer.domElement) {
    setNdc(ev);
    if (measuring) measureClick();
    else if (tidyTool === 'none' && view !== 'walk' && !pickItem()) select(null);
  }
  down = null;
});

renderer.domElement.addEventListener('dblclick', ev => {
  if (view !== 'walk') return;
  setNdc(ev);
  const s = scan.raycast(raycaster, 'visible');
  const p = s && s.face && s.face.normal && Math.abs(s.face.normal.y) > 0.7 ? s.point : floorPoint();
  if (p) { walk.target = new THREE.Vector3(p.x, 0, p.z); }
});

// ---------------------------------------------------------------- tidy tools
const brushCursor = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xff3b30, wireframe: true, transparent: true, opacity: 0.6, depthTest: false }));
brushCursor.renderOrder = 20; brushCursor.visible = false; helpersGroup.add(brushCursor);
let brushRadius = 0.25;
function updateBrushCursor() {
  const hit = scan.raycast(raycaster, tidyTool === 'erase' ? 'visible' : 'any');
  brushCursor.visible = !!hit;
  if (hit) { brushCursor.position.copy(hit.point); brushCursor.scale.setScalar(brushRadius); brushCursor.material.color.set(tidyTool === 'erase' ? 0xff3b30 : 0x22b14c); }
}
function paintAt(p) {
  brushCursor.position.copy(p); brushCursor.scale.setScalar(brushRadius); brushCursor.visible = true;
  scan.brush(p, brushRadius, tidyTool === 'erase' ? 0 : 1, { protectFloor: $('#protectFloor').checked, protectWalls: $('#protectWalls').checked });
}

const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.15, depthWrite: false }));
boxMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xff8800 })));
boxMesh.visible = false; helpersGroup.add(boxMesh);
const tc = new TransformControls(persp, renderer.domElement);
tc.addEventListener('dragging-changed', e => { activeControls().enabled = !e.value; });
const tcHelper = tc.getHelper ? tc.getHelper() : tc; scene.add(tcHelper);
tc.enabled = false; tcHelper.visible = false;

function setTidyTool(t) {
  tidyTool = t;
  $$('#tidySeg button').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  $('#brushOpts').classList.toggle('hidden', !(t === 'erase' || t === 'restore'));
  $('#boxOpts').classList.toggle('hidden', t !== 'box');
  brushCursor.visible = false;
  if (t === 'box') {
    if (!boxMesh.userData.placed) {
      const c = viewCentreOnFloor(); boxMesh.scale.set(1.2, 1.2, 1.2); boxMesh.position.set(c.x, scan.meta.floorY + 0.6, c.z); boxMesh.userData.placed = true;
    }
    boxMesh.visible = true; tc.attach(boxMesh); tc.enabled = true; tcHelper.visible = true;
  } else { boxMesh.visible = false; tc.detach(); tc.enabled = false; tcHelper.visible = false; }
  if (t !== 'none') { setMeasuring(false); select(null); }
  const hints = { erase: 'Paint over things to remove them from the scan', restore: 'Paint over removed (red) parts to bring them back', box: 'Position the box, then Remove / Restore inside' };
  showToolHint(hints[t]);
  if (t === 'restore' && !scan.showRemoved) { $('#showRemoved').checked = true; scan.showRemoved = true; scan.rebuild(); }
  renderer.domElement.style.cursor = t === 'none' ? '' : 'crosshair';
}
function showToolHint(text) { const h = $('#toolHint'); h.textContent = text || ''; h.classList.toggle('hidden', !text); }
function updateTidyStats() {
  const pct = (scan.hiddenCount / scan.faceCount * 100).toFixed(1);
  $('#tidyStats').textContent = `${scan.hiddenCount.toLocaleString()} of ${scan.faceCount.toLocaleString()} scan triangles hidden (${pct}%).`;
  updateUndoButtons();
}

// ---------------------------------------------------------------- measuring
const measurements = [];
let measureStart = null;
const previewLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0xffb800, dashSize: 0.05, gapSize: 0.03, depthTest: false }));
previewLine.renderOrder = 30; previewLine.visible = false; helpersGroup.add(previewLine);
const previewLabel = (() => { const el = document.createElement('div'); el.className = 'measure-label'; el.style.pointerEvents = 'none'; return new CSS2DObject(el); })();
previewLabel.visible = false; helpersGroup.add(previewLabel);
const dot = () => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb800, depthTest: false })); m.renderOrder = 31; return m; };
function fmtLen(l) { return l >= 1 ? l.toFixed(2) + ' m' : Math.round(l * 100) + ' cm'; }
function setMeasuring(on) {
  measuring = on; $('#measureBtn').classList.toggle('on', on);
  measureStart = null; previewLine.visible = false; previewLabel.visible = false;
  helpersGroup.children.filter(c => c.userData.measureStartDot).forEach(c => c.removeFromParent());
  if (on) { setTidyTool('none'); showToolHint('Click two points to measure · Esc to stop'); } else if (tidyTool === 'none') showToolHint('');
  renderer.domElement.style.cursor = on ? 'crosshair' : '';
}
function measureClick() {
  const p = pickSurface(); if (!p) return;
  if (!measureStart) {
    measureStart = p.clone();
    const d = dot(); d.position.copy(p); d.userData.measureStartDot = true; helpersGroup.add(d);
    return;
  }
  const a = measureStart, b = p.clone();
  helpersGroup.children.filter(c => c.userData.measureStartDot).forEach(c => c.removeFromParent());
  const g = new THREE.Group();
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xffb800, depthTest: false }));
  line.renderOrder = 30; g.add(line);
  const d1 = dot(), d2 = dot(); d1.position.copy(a); d2.position.copy(b); g.add(d1, d2);
  const el = document.createElement('div'); el.className = 'measure-label';
  const horiz = Math.hypot(b.x - a.x, b.z - a.z), len = a.distanceTo(b);
  el.textContent = fmtLen(len) + (Math.abs(b.y - a.y) > 0.05 && horiz > 0.05 ? ` (↔ ${fmtLen(horiz)})` : '');
  el.title = 'Click to remove';
  const lab = new CSS2DObject(el); lab.position.copy(a).add(b).multiplyScalar(0.5); g.add(lab);
  el.addEventListener('pointerdown', e => { e.stopPropagation(); el.remove(); g.removeFromParent(); measurements.splice(measurements.indexOf(g), 1); });
  helpersGroup.add(g); measurements.push(g);
  measureStart = null; previewLine.visible = false; previewLabel.visible = false;
}
function updateMeasurePreview() {
  if (!measureStart) return;
  const p = pickSurface(); if (!p) return;
  previewLine.geometry.setFromPoints([measureStart, p]); previewLine.computeLineDistances(); previewLine.visible = true;
  previewLabel.position.copy(measureStart).add(p).multiplyScalar(0.5);
  previewLabel.element.textContent = fmtLen(measureStart.distanceTo(p)); previewLabel.visible = true;
}
function clearMeasurements() { for (const g of measurements) disposeObj(g); measurements.length = 0; }

// ---------------------------------------------------------------- views
const walk = { yaw: 0, pitch: 0, keys: new Set(), target: null, looking: null };
let savedOrbit = null;
let wallPlan = null;
let fp = null; // floorplan walls + overlay
function fitPlan() {
  const c = new THREE.Vector3(); scan.bounds.getCenter(c);
  const size = new THREE.Vector3(); scan.bounds.getSize(size);
  const r = renderer.domElement, aspect = r.clientWidth / Math.max(1, r.clientHeight);
  const half = Math.max(size.z / 2, size.x / 2 / aspect) * 1.08;
  ortho.left = -half * aspect; ortho.right = half * aspect; ortho.top = half; ortho.bottom = -half;
  ortho.zoom = 1; ortho.position.set(c.x, 40, c.z + 0.0001); ortho.up.set(0, 1, 0);
  planCtl.target.set(c.x, scan.meta.floorY, c.z); ortho.updateProjectionMatrix(); planCtl.update();
}
function setView(v) {
  if (v === view) return;
  if (view === 'walk') { renderer.domElement.style.cursor = ''; if (savedOrbit) { persp.position.copy(savedOrbit.pos); orbit.target.copy(savedOrbit.target); } }
  if (v === 'walk') {
    savedOrbit = { pos: persp.position.clone(), target: orbit.target.clone() };
    const t = view === 'plan' ? planCtl.target.clone() : orbit.target.clone();
    const fy = scan.floorAt(t.x, t.z);
    persp.position.set(t.x, fy + 1.6, t.z);
    const dir = new THREE.Vector3().subVectors(orbit.target, savedOrbit.pos); dir.y = 0;
    walk.yaw = Math.atan2(-dir.x, -dir.z); walk.pitch = -0.08;
    if (!scan.showCeiling) { $('#showCeiling').checked = true; setCeiling(true, false); walk.autoCeiling = true; }
  } else if (walk.autoCeiling) { $('#showCeiling').checked = false; setCeiling(false, false); walk.autoCeiling = false; }
  view = v;
  $$('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  camera = v === 'plan' ? ortho : persp;
  orbit.enabled = v === 'orbit'; planCtl.enabled = v === 'plan';
  tc.camera = camera;
  if (v === 'plan') { fitPlan(); if (prefs.cut >= 3) { setCut(1.4, false); setView.autoCut = true; } }
  else if (setView.autoCut) { if (prefs.cut === 1.4) setCut(3.0, false); setView.autoCut = false; }
  $('#walkHint').classList.toggle('hidden', v !== 'walk');
  updateWallPlan();
  persp.near = v === 'walk' ? 0.05 : 0.03; persp.updateProjectionMatrix();
}
function setCut(v, save = true) {
  prefs.cut = v; $('#cut').value = v;
  $('#cutOut').textContent = v >= 3 ? 'off' : v.toFixed(2) + ' m';
  scan.setCut(v >= 3 ? 1000 : scan.meta.floorY + v);
  updateWallPlan();
  if (save) savePrefs();
}
function applyModel() {
  const m = prefs.model, showScan = m !== 'plan';
  if (scan.mesh) { scan.mesh.visible = showScan; scan.ghost.visible = showScan && scan.showRemoved; }
  if (scan.fill) scan.fill.visible = prefs.showFill && showScan;
  if (fp) fp.walls.visible = m !== 'scan';
  updateWallPlan();
}
function updateWallPlan() {
  if (fp?.overlay) {
    const asFloor = prefs.model === 'plan';
    fp.overlay.visible = asFloor || (view === 'plan' && prefs.fpOverlay);
    fp.overlay.traverse(o => { if (o.material) o.material.opacity = asFloor ? 1 : 0.6; });
    fp.overlay.position.y = scan.meta.floorY + (asFloor ? 0.002 : view === 'plan' ? Math.min(prefs.cut, 2.3) - 0.02 : 0.02);
  }
  if (!wallPlan) return;
  wallPlan.visible = view === 'plan' && prefs.model === 'scan' && !(fp?.overlay && prefs.fpOverlay);
  wallPlan.position.y = scan.meta.floorY + Math.min(prefs.cut, 2.3) - 0.01;
}
function setCeiling(on, save = true) {
  scan.showCeiling = on; scan.rebuild();
  if (save) { prefs.showCeiling = on; savePrefs(); }
}

const clock = new THREE.Clock();
function updateWalk(dt) {
  const k = walk.keys, speed = (k.has('shift') ? 3 : 1.4) * dt;
  const fwd = new THREE.Vector3(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const mv = new THREE.Vector3();
  if (k.has('w') || k.has('arrowup')) mv.add(fwd);
  if (k.has('s') || k.has('arrowdown')) mv.sub(fwd);
  if (k.has('d') || k.has('arrowright')) mv.add(right);
  if (k.has('a') || k.has('arrowleft')) mv.sub(right);
  if (mv.lengthSq()) { persp.position.addScaledVector(mv.normalize(), speed); walk.target = null; }
  if (walk.target) {
    const d = new THREE.Vector3(walk.target.x - persp.position.x, 0, walk.target.z - persp.position.z);
    const l = d.length(); if (l < 0.03) walk.target = null; else persp.position.addScaledVector(d.normalize(), Math.min(l, 3 * dt));
  }
  const fy = scan.floorAt(persp.position.x, persp.position.z);
  persp.position.y += (fy + 1.6 - persp.position.y) * Math.min(1, dt * 8);
  persp.rotation.order = 'YXZ'; persp.rotation.set(walk.pitch, walk.yaw, 0);
}
renderer.domElement.addEventListener('pointerdown', ev => {
  if (view !== 'walk' || measuring || tidyTool !== 'none') return;
  walk.looking = { x: ev.clientX, y: ev.clientY };
});
window.addEventListener('pointermove', ev => {
  if (!walk.looking || view !== 'walk') return;
  walk.yaw += (ev.clientX - walk.looking.x) * 0.004; walk.pitch += (ev.clientY - walk.looking.y) * 0.004;
  walk.pitch = Math.max(-1.3, Math.min(1.3, walk.pitch));
  walk.looking = { x: ev.clientX, y: ev.clientY };
});
window.addEventListener('pointerup', () => { walk.looking = null; });
renderer.domElement.addEventListener('wheel', ev => {
  if (view !== 'walk') return;
  const fwd = new THREE.Vector3(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw));
  persp.position.addScaledVector(fwd, -Math.sign(ev.deltaY) * 0.3); ev.preventDefault();
}, { passive: false });

// ---------------------------------------------------------------- keyboard
window.addEventListener('keydown', ev => {
  const tag = (ev.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') { if (ev.key === 'Escape') ev.target.blur(); return; }
  const k = ev.key.toLowerCase(), mod = ev.ctrlKey || ev.metaKey;
  if (view === 'walk' && ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) { walk.keys.add(k); ev.preventDefault(); return; }
  if (mod && k === 'z') { ev.preventDefault(); ev.shiftKey ? doRedo() : doUndo(); return; }
  if (mod && k === 'y') { ev.preventDefault(); doRedo(); return; }
  if (mod && k === 'd') { ev.preventDefault(); duplicateSelected(); return; }
  if (k === 'escape') { if (measuring) setMeasuring(false); else if (tidyTool !== 'none') setTidyTool('none'); else select(null); return; }
  if (k === '1') setView('orbit'); else if (k === '2') setView('plan'); else if (k === '3') setView('walk');
  else if (k === 'm') setMeasuring(!measuring);
  else if (k === '?') $('#help').showModal();
  else if (selectedId) {
    const e = itemObjs.get(selectedId);
    if (k === 'delete' || k === 'backspace') { ev.preventDefault(); deleteSelected(); }
    else if (k === 'q' || k === 'e') editSelected(d => { d.rot = wrapRot(Math.round(((d.rot || 0) + (k === 'q' ? -15 : 15)) / 15) * 15); });
    else if (k.startsWith('arrow') && !e.data.locked) {
      ev.preventDefault();
      const st = ev.shiftKey ? 0.1 : 0.01;
      // nudge relative to screen: project camera forward to floor axes
      const f = new THREE.Vector3(); camera.getWorldDirection(f); if (view === 'plan') f.set(0, 0, -1); f.y = 0; f.normalize();
      const ax = Math.abs(f.x) > Math.abs(f.z) ? new THREE.Vector3(Math.sign(f.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(f.z));
      const rt = new THREE.Vector3(-ax.z, 0, ax.x);
      const v = k === 'arrowup' ? ax : k === 'arrowdown' ? ax.clone().negate() : k === 'arrowright' ? rt : rt.clone().negate();
      editSelected(d => { d.x = +(d.x + v.x * st).toFixed(3); d.z = +(d.z + v.z * st).toFixed(3); });
    }
  }
});
window.addEventListener('keyup', ev => walk.keys.delete(ev.key.toLowerCase()));
window.addEventListener('blur', () => walk.keys.clear());

// ---------------------------------------------------------------- undo routing
const activeTab = () => $('.tabs button.on').dataset.tab;
function doUndo() { if (activeTab() === 'tidy') { scan.undo(); updateTidyStats(); } else layoutHistory(layoutUndo, layoutRedo); }
function doRedo() { if (activeTab() === 'tidy') { scan.redo(); updateTidyStats(); } else layoutHistory(layoutRedo, layoutUndo); }
function updateUndoButtons() {
  const tidy = activeTab() === 'tidy';
  $('#undoBtn').disabled = tidy ? !scan.undoStack.length : !layoutUndo.length;
  $('#redoBtn').disabled = tidy ? !scan.redoStack.length : !layoutRedo.length;
}

// ---------------------------------------------------------------- UI wiring
function renderCatalogue(thumbs) {
  const q = $('#catSearch').value.trim().toLowerCase();
  const root = $('#catalogue'); root.innerHTML = '';
  for (const g of CATALOGUE) {
    const items = g.items.filter(i => !q || i.name.toLowerCase().includes(q) || g.group.toLowerCase().includes(q));
    if (!items.length) continue;
    const sec = document.createElement('div'); sec.className = 'group';
    sec.innerHTML = `<h5>${g.group}</h5>`;
    const gridEl = document.createElement('div'); gridEl.className = 'grid';
    for (const it of items) {
      const b = document.createElement('button'); b.className = 'item'; b.title = `Add ${it.name}`;
      const img = thumbs?.[it.type] ? `<img alt="" src="${thumbs[it.type]}">` : '';
      b.innerHTML = `${img}<span>${it.name}</span><small>${cm(it.w)}×${cm(it.d)}</small>`;
      b.onclick = () => addItem(it.type);
      gridEl.appendChild(b);
    }
    sec.appendChild(gridEl); root.appendChild(sec);
  }
}
let thumbs = null;
function makeThumbs() {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(128, 96); r.setPixelRatio(1);
  const s = new THREE.Scene(); s.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2)); const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(2, 3, 4); s.add(dl);
  const cam = new THREE.PerspectiveCamera(30, 128 / 96, 0.01, 100);
  const out = {};
  for (const g of CATALOGUE) for (const it of g.items) {
    const o = buildItemObject({ type: it.type, w: it.w, d: it.d, h: it.h, color: it.color });
    s.add(o);
    const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3()).length();
    cam.position.set(c.x + sz * 0.9, c.y + sz * 0.75, c.z + sz * 1.5); cam.lookAt(c);
    r.render(s, cam); out[it.type] = r.domElement.toDataURL();
    s.remove(o);
  }
  r.dispose(); r.forceContextLoss?.();
  return out;
}

function renderItemList() {
  const ul = $('#itemList'); ul.innerHTML = '';
  const items = current().items;
  if (!items.length) { ul.innerHTML = '<li class="hint">No furniture yet — add some from the Furniture tab.</li>'; return; }
  for (const d of items) {
    const li = document.createElement('li'); li.className = d.id === selectedId ? 'sel' : '';
    li.innerHTML = `<span>${escapeHtml(d.name)}${d.locked ? ' 🔒' : ''}</span><small>${cm(d.w)}×${cm(d.d)} cm</small>`;
    li.onclick = () => { select(d.id); focusItem(d.id); };
    ul.appendChild(li);
  }
}
function focusItem(id) {
  const e = itemObjs.get(id); if (!e) return;
  const p = e.obj.position;
  if (view === 'orbit') { const off = persp.position.clone().sub(orbit.target); orbit.target.copy(p); persp.position.copy(p).add(off); }
  else if (view === 'plan') { const off = ortho.position.clone().sub(planCtl.target); planCtl.target.set(p.x, planCtl.target.y, p.z); ortho.position.copy(planCtl.target).add(off); }
}
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function renderLayoutUI() {
  const sel = $('#layoutSelect'); sel.innerHTML = '';
  for (const l of layouts) { const o = document.createElement('option'); o.value = l.id; o.textContent = `${l.name} (${l.items.length})`; sel.appendChild(o); }
  sel.value = currentId; renderItemList();
}
function switchLayout(id) { currentId = id; selectedId = null; rebuildItems(); renderLayoutUI(); saveLayouts(); }

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function compress(str) {
  const cs = new Blob([str]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer());
  let s = ''; for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function decompress(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const buf = Uint8Array.from(bin, c => c.charCodeAt(0));
  const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(ds).text();
}
function sanitizeItems(items) {
  return (Array.isArray(items) ? items : []).filter(i => i && TYPES[i.type]).map(i => ({
    id: uid(), type: i.type, name: String(i.name || TYPES[i.type].name).slice(0, 60),
    x: +i.x || 0, z: +i.z || 0, rot: +i.rot || 0, w: Math.max(0.01, +i.w || TYPES[i.type].w), d: Math.max(0.01, +i.d || TYPES[i.type].d),
    h: Math.max(0.005, +i.h || TYPES[i.type].h), elev: +i.elev || 0, color: /^#[0-9a-f]{6}$/i.test(i.color) ? i.color : TYPES[i.type].color, locked: !!i.locked,
  }));
}
function importLayout(obj, prefix = '') {
  const l = { id: uid(), name: (prefix + String(obj.name || 'Imported layout')).slice(0, 60), items: sanitizeItems(obj.items) };
  layouts.push(l); switchLayout(l.id);
  toast(`Loaded “${l.name}” (${l.items.length} items)`);
}

function wireUI() {
  // tabs
  $$('.tabs button').forEach(b => b.onclick = () => {
    $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    $$('.tab').forEach(t => t.classList.toggle('hidden', t.id !== 'tab-' + b.dataset.tab));
    if (b.dataset.tab !== 'tidy' && tidyTool !== 'none') setTidyTool('none');
    if (b.dataset.tab === 'tidy') updateTidyStats();
    updateUndoButtons();
  });
  $('#panelToggle').onclick = () => { prefs.panel = !prefs.panel; $('#app').classList.toggle('collapsed', !prefs.panel); savePrefs(); onResize(); };
  $('#app').classList.toggle('collapsed', !prefs.panel);
  $$('#viewSeg button').forEach(b => b.onclick = () => setView(b.dataset.view));
  $('#cut').oninput = e => setCut(+e.target.value);
  $('#measureBtn').onclick = () => setMeasuring(!measuring);
  $('#undoBtn').onclick = doUndo; $('#redoBtn').onclick = doRedo;
  $('#helpBtn').onclick = () => $('#help').showModal();

  // catalogue
  $('#catSearch').oninput = () => renderCatalogue(thumbs);

  // selection panel
  $('#selClose').onclick = () => select(null);
  $('#selName').onchange = e => editSelected(d => { d.name = e.target.value.slice(0, 60) || TYPES[d.type].name; });
  const dimIn = (id, key, min) => $(id).onchange = e => { const v = +e.target.value; if (!isFinite(v)) return; editSelected(d => { d[key] = Math.max(min, v) / 100; }, key !== 'elev'); };
  dimIn('#selW', 'w', 1); dimIn('#selD', 'd', 1); dimIn('#selH', 'h', 0.5); dimIn('#selE', 'elev', -300);
  let rotBefore = null;
  $('#selRot').addEventListener('pointerdown', () => { rotBefore = snapshot(); });
  $('#selRot').oninput = e => editSelected(d => { d.rot = +e.target.value; }, false, false);
  $('#selRot').onchange = () => { if (rotBefore) pushLayoutUndo(rotBefore); rotBefore = null; };
  $('#rotL').onclick = () => editSelected(d => { d.rot = wrapRot((d.rot || 0) - 15); });
  $('#rotR').onclick = () => editSelected(d => { d.rot = wrapRot((d.rot || 0) + 15); });
  $('#selColor').onchange = e => editSelected(d => { d.color = e.target.value; }, true);
  $('#selDup').onclick = duplicateSelected;
  $('#selDel').onclick = deleteSelected;
  $('#selLock').onclick = () => editSelected(d => { d.locked = !d.locked; });

  // tidy
  $$('#tidySeg button').forEach(b => b.onclick = () => setTidyTool(b.dataset.tool));
  $$('#boxModeSeg button').forEach(b => b.onclick = () => { $$('#boxModeSeg button').forEach(x => x.classList.toggle('on', x === b)); tc.setMode(b.dataset.mode); });
  $('#brushSize').oninput = e => { brushRadius = +e.target.value; $('#brushOut').textContent = Math.round(brushRadius * 100) + ' cm'; };
  $('#boxRemove').onclick = () => { const n = scan.applyBox(boxMesh, 0, { protectFloor: $('#protectFloor').checked, protectWalls: $('#protectWalls').checked }); updateTidyStats(); toast(`Removed ${n.toLocaleString()} triangles`); };
  $('#boxRestore').onclick = () => { const n = scan.applyBox(boxMesh, 1); updateTidyStats(); toast(`Restored ${n.toLocaleString()} triangles`); };
  $('#floatArea').oninput = e => { $('#floatOut').textContent = (+e.target.value).toFixed(2) + ' m²'; };
  $('#removeFloating').onclick = () => { toast('Finding floating bits…'); setTimeout(() => { const n = scan.removeFloating(+$('#floatArea').value); updateTidyStats(); toast(n ? `Removed ${n.toLocaleString()} triangles` : 'Nothing floating found'); }, 30); };
  $('#showRemoved').onchange = e => { scan.showRemoved = e.target.checked; scan.rebuild(); applyModel(); };
  $('#resetShipped').onclick = () => { if (confirm('Throw away your scan edits and go back to the saved clean-up?')) { scan.resetTo('shipped'); updateTidyStats(); } };
  $('#resetOriginal').onclick = () => { if (confirm('Show the whole original scan, including furniture? (You can undo this.)')) { scan.resetTo('original'); updateTidyStats(); } };
  $('#exportMask').onclick = () => download('mask.bin', scan.maskBytes(), 'application/octet-stream');
  $('#importMask').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { scan.loadMaskBytes(new Uint8Array(await f.arrayBuffer())); updateTidyStats(); toast('Clean-up loaded'); } catch (err) { alert(err.message); } e.target.value = ''; };
  $('#exportGlb').onclick = () => {
    toast('Building model…', 4000);
    const g = new THREE.Group(); g.add(scan.exportMesh());
    new GLTFExporter().parse(g, res => download('house-cleaned.glb', new Blob([res], { type: 'model/gltf-binary' })), err => alert('Export failed: ' + err), { binary: true });
  };

  // layouts
  $('#layoutSelect').onchange = e => switchLayout(e.target.value);
  $('#layNew').onclick = () => { const n = prompt('Name for the new layout', `Layout ${layouts.length + 1}`); if (!n) return; const l = { id: uid(), name: n.slice(0, 60), items: [] }; layouts.push(l); switchLayout(l.id); };
  $('#layDup').onclick = () => { const c = current(); const l = { id: uid(), name: (c.name + ' copy').slice(0, 60), items: JSON.parse(JSON.stringify(c.items)).map(i => ({ ...i, id: uid() })) }; layouts.push(l); switchLayout(l.id); };
  $('#layRename').onclick = () => { const n = prompt('Rename layout', current().name); if (!n) return; current().name = n.slice(0, 60); renderLayoutUI(); saveLayouts(); };
  $('#layDel').onclick = () => {
    if (!confirm(`Delete layout “${current().name}”?`)) return;
    layouts = layouts.filter(l => l.id !== currentId);
    if (!layouts.length) layouts.push({ id: uid(), name: 'My layout', items: [] });
    switchLayout(layouts[0].id);
  };
  $('#layExport').onclick = () => { const c = current(); download(c.name.replace(/[^\w-]+/g, '_') + '.json', JSON.stringify({ name: c.name, items: c.items }, null, 1), 'application/json'); };
  $('#layImport').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { importLayout(JSON.parse(await f.text())); } catch (err) { alert('Could not read that layout file.'); } e.target.value = ''; };
  $('#layLink').onclick = async () => {
    const c = current();
    const code = await compress(JSON.stringify({ name: c.name, items: c.items.map(({ id, ...rest }) => rest) }));
    const url = location.href.split('#')[0] + '#layout=' + code;
    try { await navigator.clipboard.writeText(url); toast('Share link copied'); } catch (e) { prompt('Copy this link', url); }
  };
  $('#layShot').onclick = () => {
    selBox.visible = false; renderer.render(scene, camera);
    renderer.domElement.toBlob(b => download(current().name.replace(/[^\w-]+/g, '_') + '.png', b));
    updateSelectionHelper();
  };

  // display
  const chk = (id, key, fn) => { const el = $(id); el.checked = prefs[key]; el.onchange = () => { prefs[key] = el.checked; savePrefs(); fn(el.checked); }; fn(prefs[key]); };
  chk('#showCeiling', 'showCeiling', v => setCeiling(v, false));
  chk('#showFill', 'showFill', () => applyModel());
  chk('#fpOverlay', 'fpOverlay', () => updateWallPlan());
  $('#modelSel').value = prefs.model;
  $('#modelSel').onchange = e => { prefs.model = e.target.value; savePrefs(); applyModel(); };
  chk('#showGrid', 'showGrid', v => { grid.visible = v; });
  chk('#showLabels', 'showLabels', v => { for (const e of itemObjs.values()) e.label.visible = v || e.data.id === selectedId; });
  chk('#snapGrid', 'snap', () => {});
  chk('#xray', 'xray', v => { if (!scan.material) return; scan.material.side = v ? THREE.FrontSide : THREE.DoubleSide; scan.material.needsUpdate = true; });
  $('#furnOpacity').value = prefs.opacity;
  $('#furnOpacity').oninput = e => { prefs.opacity = +e.target.value; savePrefs(); applyOpacity(itemsGroup); };
}

// ---------------------------------------------------------------- resize + loop
function onResize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h); labelRenderer.setSize(w, h);
  persp.aspect = w / Math.max(1, h); persp.updateProjectionMatrix();
  const half = (ortho.top - ortho.bottom) / 2 || 6;
  ortho.left = -half * persp.aspect; ortho.right = half * persp.aspect; ortho.updateProjectionMatrix();
}
new ResizeObserver(onResize).observe(viewport);

function animate() {
  const dt = Math.min(0.05, clock.getDelta());
  if (view === 'walk') updateWalk(dt);
  else if (view === 'orbit') orbit.update(); else planCtl.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// ---------------------------------------------------------------- boot
(async function boot() {
  loadLayouts();
  wireUI();
  try {
    await scan.load('assets/', f => { $('#loadBar').style.width = Math.round(f * 100) + '%'; $('#loadText').textContent = `Loading scan… ${Math.round(f * 100)}%`; });
  } catch (e) {
    console.error(e); $('#loadText').textContent = 'Could not load the scan: ' + e.message; return;
  }
  $('#loadText').textContent = 'Preparing…';
  scene.add(scan.mesh, scan.ghost);
  if (scan.fill) { scene.add(scan.fill); scan.fill.visible = prefs.showFill; }
  setCeiling(prefs.showCeiling, false);
  scan.material.side = prefs.xray ? THREE.FrontSide : THREE.DoubleSide;
  scan.onChange = updateTidyStats;
  const c = new THREE.Vector3(); scan.bounds.getCenter(c);
  const size = new THREE.Vector3(); scan.bounds.getSize(size);
  grid.position.set(Math.round(c.x), scan.meta.floorY + 0.003, Math.round(c.z));
  orbit.target.set(c.x, scan.meta.floorY + 0.5, c.z);
  const asp = viewport.clientWidth / Math.max(1, viewport.clientHeight), far = Math.max(1, 1.5 / asp);
  persp.position.set(c.x - size.x * 0.25 * far, scan.meta.floorY + size.x * 0.75 * far, c.z + size.z * 1.05 * far);
  sun.position.set(c.x + 6, scan.meta.floorY + 14, c.z + 8); sun.target.position.set(c.x, scan.meta.floorY, c.z);
  const sc = sun.shadow.camera; sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12; sc.far = 40; sc.updateProjectionMatrix();
  // floor-level shadow catcher so furniture grounds visually
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(size.x + 4, size.z + 4), new THREE.ShadowMaterial({ opacity: 0.22 }));
  catcher.rotation.x = -Math.PI / 2; catcher.position.set(c.x, scan.meta.floorY + 0.004, c.z); catcher.receiveShadow = true; catcher.material.depthWrite = false; catcher.renderOrder = 6; scene.add(catcher);
  // dark wall outline shown in plan view
  const M = scan.meta, wtex = await new THREE.TextureLoader().loadAsync('assets/walls.png').catch(() => null);
  if (wtex) {
    wtex.colorSpace = THREE.SRGBColorSpace;
    wallPlan = new THREE.Mesh(new THREE.PlaneGeometry(M.nx * M.cs, M.nz * M.cs), new THREE.MeshBasicMaterial({ map: wtex, transparent: true, opacity: 0.85, depthWrite: false }));
    wallPlan.rotation.x = -Math.PI / 2; wallPlan.position.set(M.x0 + M.nx * M.cs / 2, 0, M.z0 + M.nz * M.cs / 2);
    wallPlan.visible = false; wallPlan.renderOrder = 5; scene.add(wallPlan);
  }
  try {
    fp = await loadFloorplan('assets/', scan.meta.floorY, scan.clipPlane);
    if (fp) { scene.add(fp.walls); if (fp.overlay) scene.add(fp.overlay); }
  } catch (e) { console.warn('floorplan not loaded', e); }
  if (!fp) $$('.fp-only').forEach(el => el.classList.add('hidden'));
  applyModel();
  setCut(prefs.cut, false);
  onResize();

  // shared layout from URL
  const m = location.hash.match(/layout=([\w-]+)/);
  if (m) {
    try { importLayout(JSON.parse(await decompress(m[1])), 'Shared: '); } catch (e) { toast('That share link could not be read'); }
    history.replaceState(null, '', location.pathname + location.search);
  }
  rebuildItems(); renderLayoutUI(); updateTidyStats(); updateUndoButtons();
  renderer.setAnimationLoop(animate);
  $('#loading').classList.add('hidden');
  setTimeout(() => { try { thumbs = makeThumbs(); } catch (e) { console.warn(e); } renderCatalogue(thumbs); }, 50);
  renderCatalogue(null);
  window.__app = { get fp() { return fp; }, scan, scene, setView, addItem, select, itemObjs, get camera() { return camera; }, setTidyTool, setCut };
})();
