import sys, numpy as np, trimesh, json
from scipy import ndimage as ndi
src, out = sys.argv[1], sys.argv[2]
m = trimesh.load(src, force='mesh', process=False)
V, F = m.vertices, m.faces
n = m.face_normals; c = m.triangles_center; A = m.area_faces
CS = 0.05
x0, z0 = V[:,0].min()-0.1, V[:,2].min()-0.1
nx = int((V[:,0].max()+0.1-x0)/CS)+1; nz = int((V[:,2].max()+0.1-z0)/CS)+1
ix = ((c[:,0]-x0)/CS).astype(int); iz = ((c[:,2]-z0)/CS).astype(int)
FLOOR0 = -1.47
# floor heightmap: lowest well-populated upward surface near global floor
up = (n[:,1] > 0.85) & (c[:,1] < FLOOR0 + 0.25)
fl = np.full((nx,nz), np.nan)
sumh = np.zeros((nx,nz)); suma = np.zeros((nx,nz))
np.add.at(sumh, (ix[up],iz[up]), c[up,1]*A[up]); np.add.at(suma, (ix[up],iz[up]), A[up])
# use min-ish: take faces in lowest band per cell
minh = np.full((nx,nz), 9.0); np.minimum.at(minh, (ix[up],iz[up]), c[up,1])
fl = np.where(minh < 9, minh, np.nan)
# robust: median filter & fill
valid = ~np.isnan(fl)
idx = ndi.distance_transform_edt(~valid, return_distances=False, return_indices=True)
flf = fl[tuple(idx)]
flf = ndi.median_filter(flf, size=7)
floor_at = flf[ix, iz]
rel = c[:,1] - floor_at
# ceiling heightmap
dn = (n[:,1] < -0.85) & (c[:,1] > 0.5)
maxh = np.full((nx,nz), -9.0); np.maximum.at(maxh, (ix[dn],iz[dn]), c[dn,1])
cv = maxh > -9
cidx = ndi.distance_transform_edt(~cv, return_distances=False, return_indices=True)
clf = ndi.median_filter(maxh[tuple(cidx)], size=7)
ceil_at = clf[ix, iz]
has_ceil = ndi.binary_dilation(cv, iterations=4)[ix, iz]
# wall detection: vertical coverage per cell
vert = np.abs(n[:,1]) < 0.35
HB = 0.1; nb = 30
hb = np.clip((rel/HB).astype(int), 0, nb-1)
cov = np.zeros((nx,nz,nb), bool)
cov[ix[vert], iz[vert], hb[vert]] = True
# pool with neighbours (walls are thin; vertices spread)
covp = ndi.maximum_filter(cov, size=(3,3,1))
lowcov = covp[:,:,3:12].mean(2)   # 0.3..1.2m
highcov = covp[:,:,18:22].mean(2) # 1.8..2.2m
wall = (lowcov > 0.5) & (highcov > 0.5)
wall = ndi.binary_opening(wall, iterations=0) if False else wall
# remove small wall blobs (tall furniture islands) - keep connected comps of reasonable length
lab, nl = ndi.label(ndi.binary_dilation(wall, iterations=1))
sizes = ndi.sum(np.ones_like(lab), lab, range(1, nl+1))
keep = np.zeros(nl+1, bool); keep[1:] = sizes >= 30  # >= 30 cells*25cm2
wallk = keep[lab] & wall
wall_near = ndi.binary_dilation(wallk, iterations=2)
# --- low boundary walls (terrace parapets, fences, balustrades) ---
# Cells on the outermost edge of the scan whose geometry tops out between
# LOWTOP and 1.7 m above the floor, forming runs longer than MINRUN.
# Furniture-sized blobs and anything away from the outer edge stay clutter.
BAND = 4          # cells (5 cm each): how close to the outer edge
LOWTOP = 0.95     # metres: minimum height of a parapet / balustrade
MINRUN = 1.2      # metres: minimum run length
body = (rel > 0.3) & (rel < 1.7)
geo = np.zeros((nx,nz), bool); geo[ix[body], iz[body]] = True
top = np.zeros((nx,nz)); np.maximum.at(top, (ix[body], iz[body]), rel[body])
# outermost band: looking outwards along an axis there is (almost) nothing
# beyond BAND cells
def beyond(g, axis, rev):
    g = np.flip(g, axis) if rev else g
    cs_ = np.cumsum(g, axis)
    tot = cs_.take([-1], axis)
    sh = np.concatenate([cs_.take(range(BAND, g.shape[axis]), axis),
                         np.repeat(tot, BAND, axis)], axis)   # count up to i+BAND
    r = tot - sh
    return np.flip(r, axis) if rev else r
band = np.zeros((nx,nz), bool)
for ax in (0,1):
    for rev in (False, True): band |= beyond(geo, ax, rev) <= 1
lowgeo = np.zeros((nx,nz), bool); lowgeo[ix[rel<1.5], iz[rel<1.5]] = True
fp = ndi.binary_fill_holes(ndi.binary_closing(np.pad(lowgeo, 8), iterations=4))[8:-8, 8:-8]
cand = band & (top >= LOWTOP) & ~wall_near
cand = ndi.binary_closing(cand, iterations=3) & ~wall_near
ll, nlw = ndi.label(cand, structure=np.ones((3,3)))
lowk = np.zeros_like(cand)
indoor = ndi.binary_dilation(cv, iterations=6) & (clf < 1.18)   # interior ceiling ~1.05, awning ~1.27
for k, sl in enumerate(ndi.find_objects(ll), 1):
    ext = max(sl[0].stop-sl[0].start, sl[1].stop-sl[1].start) * CS
    comp = ll == k
    # indoor runs (kitchen units, shelving along a missing wall) stay clutter
    if ext >= MINRUN and indoor[comp].mean() < 0.5: lowk |= comp
low_near = ndi.binary_dilation(lowk, iterations=1)
np.save(out+'/lowwall.npy', lowk); np.save(out+'/footprint.npy', fp)
print('low boundary wall cells', int(lowk.sum()), 'of', int(cand.sum()), 'candidates')
labels = np.zeros(len(F), np.uint8)  # 0 removed(furniture) 1 floor 2 wall 3 ceiling
is_floor = (n[:,1] > 0.6) & (np.abs(rel) < 0.06)
is_ceil = (n[:,1] < -0.5) & (np.abs(c[:,1]-ceil_at) < 0.12) & has_ceil
is_wall = wall_near[ix, iz] & (rel > -0.05)
labels[is_wall] = 2
labels[low_near[ix, iz] & (rel > -0.05) & (rel < 1.7)] = 2
labels[is_floor] = 1
labels[is_ceil] = 3
# faces high up (above 2.1m) near ceiling e.g. beams, lights -> ceiling-ish keep
labels[(labels==0) & (rel > 2.1) & has_ceil] = 3
# connected component cleanup: drop small kept islands
keepmask = labels > 0
sub = F[keepmask]
fidx = np.nonzero(keepmask)[0]
adj = trimesh.graph.face_adjacency(sub)
import scipy.sparse as sp
g = sp.coo_matrix((np.ones(len(adj)), (adj[:,0], adj[:,1])), shape=(len(sub),len(sub)))
ncomp, cl = sp.csgraph.connected_components(g, directed=False)
carea = np.bincount(cl, weights=A[fidx])
small = carea[cl] < 0.15
labels[fidx[small]] = 0
print('faces', len(F), 'counts', np.bincount(labels, minlength=4))
labels.tofile(out + '/labels.bin')
json.dump({'x0':x0,'z0':z0,'cs':CS,'nx':nx,'nz':nz,'floor':np.round(flf,4).tolist()}, open(out+'/floorgrid.json','w'))
np.save(out+'/wall.npy', wallk)
