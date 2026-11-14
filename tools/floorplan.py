"""Build assets/floorplan.png + assets/floorplan.json from the agent's floorplan image.

usage: python3 -I tools/floorplan.py tools/floorplan-source.png align.json assets/
align.json holds the fitted image->world transform (scale s m/px, rotation th about pi,
translation tx/tz of the image centre, plus a stretch factor k for pixels right of `split`).
"""
import sys, json, numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, alignf, out = sys.argv[1:4]
A = json.load(open(alignf))
a = np.asarray(Image.open(src).convert('RGB')).astype(int)
H, W = a.shape[:2]

dark = a.max(2) < 90
op = ndi.binary_opening(dark, structure=np.ones((5, 5)))
lab, n = ndi.label(op)
keep = np.zeros(n + 1, bool)
for i, s in enumerate(ndi.find_objects(lab)):
    if max(s[0].stop - s[0].start, s[1].stop - s[1].start) > 45: keep[i + 1] = True
walls = keep[lab]
cyan = (a[..., 2] > 150) & (a[..., 0] < 150) & (a[..., 1] > 150) & (a[..., 2] - a[..., 0] > 50)
win = ndi.binary_closing(ndi.binary_opening(cyan), iterations=2)

def rects(mask):
    """merge horizontal runs with identical extents across rows into rectangles"""
    out, open_ = [], {}
    for y in range(mask.shape[0] + 1):
        runs = set()
        if y < mask.shape[0]:
            row = np.concatenate([[0], mask[y].astype(np.int8), [0]])
            d = np.diff(row); st = np.nonzero(d == 1)[0]; en = np.nonzero(d == -1)[0]
            runs = set(zip(st.tolist(), en.tolist()))
        for r in list(open_):
            if r not in runs: out.append((r[0], open_.pop(r), r[1], y))
        for r in runs:
            if r not in open_: open_[r] = y
    return [r for r in out if (r[2] - r[0]) * (r[3] - r[1]) >= 12]

s, th, tx, tz, cx, cy, split, k = (A[x] for x in ('s', 'th', 'tx', 'tz', 'cx', 'cy', 'split', 'k'))
c, sn = np.cos(np.pi + th), np.sin(np.pi + th)
def tf(u, v):
    u = split + (u - split) * k if u > split else u
    uu, vv = u - cx, v - cy
    return [round(tx + s * (c * uu - sn * vv), 4), round(tz + s * (sn * uu + c * vv), 4)]
quad = lambda r: [tf(r[0], r[1]), tf(r[2], r[1]), tf(r[2], r[3]), tf(r[0], r[3])]

wr, wn = rects(walls), rects(win)
img = np.dstack([a.astype(np.uint8), np.where(a.min(2) > 245, 0, 255).astype(np.uint8)])
Image.fromarray(img).save(out + '/floorplan.png', optimize=True)
json.dump({
    'image': {'w': W, 'h': H, 's': s, 'th': th, 'tx': tx, 'tz': tz, 'cx': cx, 'cy': cy},
    'walls': [quad(r) for r in wr], 'windows': [quad(r) for r in wn],
}, open(out + '/floorplan.json', 'w'), separators=(',', ':'))
print(len(wr), 'wall rects', len(wn), 'window rects')
