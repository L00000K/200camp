# Writes the small app assets from classify.py output.
#   python3 export_assets.py <workdir> <assets dir>
# walls.png: plan-view wall outline (rows = z, cols = x, 2 px per cell, alpha = wall)
# meta.json: grid description + floor heights (base64 little-endian Int16 mm, index [i*nz+j])
import sys, json, base64, numpy as np
from PIL import Image
S, out = sys.argv[1], sys.argv[2]
G = json.load(open(S + '/floorgrid.json'))
wall = np.load(S + '/wall.npy') | np.load(S + '/lowwall.npy')
a = np.repeat(np.repeat(wall.T, 2, 0), 2, 1)
im = np.zeros(a.shape + (4,), np.uint8); im[..., :3] = 40; im[..., 3] = a * 255
Image.fromarray(im).save(out + '/walls.png', optimize=True)
fl = np.round(np.array(G['floor']) * 1000).astype('<i2')
meta = {k: G[k] for k in ('x0', 'z0', 'cs', 'nx', 'nz')}
meta.update(floorY=-1.47, ceilY=1.05, floorMM=base64.b64encode(fl.tobytes()).decode())
json.dump(meta, open(out + '/meta.json', 'w'))
print('walls', a.shape, 'floor cells', fl.size)
