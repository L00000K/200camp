# Builds floorfill.glb: a heightfield floor patch whose texture fills the gaps left
# under removed furniture.
#   python3 floorfill.py <workdir> [scan.glb]
# <workdir> must hold floorgrid.json, wall.npy, lowwall.npy, labels.bin (from classify.py)
# and floor_raw.png: a top-down orthographic render of only the label-1 (floor) faces,
# 4 px per 5 cm grid cell, transparent where there is no floor.
import sys, json, numpy as np, trimesh
from PIL import Image
from scipy import ndimage as ndi
S=sys.argv[1]
G=json.load(open(S+'/floorgrid.json')); nx,nz,cs,x0,z0=G['nx'],G['nz'],G['cs'],G['x0'],G['z0']
fl=np.array(G['floor'])  # [nx,nz]
im=np.asarray(Image.open(S+'/floor_raw.png')).astype(np.float32)/255  # [H=nz*4, W=nx*4, 4]
m=trimesh.load(sys.argv[2] if len(sys.argv)>2 else S+'/scan/17_12_2021.glb',force='mesh',process=False)
c=m.triangles_center
ix=((c[:,0]-x0)/cs).astype(int); iz=((c[:,2]-z0)/cs).astype(int)
occ=np.zeros((nx,nz),bool); occ[ix,iz]=True
L=np.fromfile(S+'/labels.bin',np.uint8)
# footprint: cells with any geometry below 1.0m rel floor, closed & hole-filled
rel=c[:,1]-fl[ix,iz]
low=np.zeros((nx,nz),bool); low[ix[rel<1.0],iz[rel<1.0]]=True
fp=ndi.binary_closing(low,iterations=4)
holes=ndi.binary_fill_holes(fp)&~fp; hl,hn=ndi.label(holes); hs=ndi.sum(holes,hl,range(1,hn+1))
small=np.zeros(hn+1,bool); small[1:]=hs<400; fp=fp|small[hl]; fp=ndi.binary_opening(fp,iterations=2)
# pixel footprint
fpp=np.repeat(np.repeat(fp.T,4,0),4,1)  # [nz*4, nx*4]
import cv2
PX=4                                   # pixels per grid cell
a=im[...,3]>0.5
rgb=im[...,:3]
# walls block the fill, so colour never leaks from one room (or the terrace) into the next
wallc=np.load(S+'/wall.npy')
try: wallc=wallc|np.load(S+'/lowwall.npy')
except FileNotFoundError: pass
barrier=np.repeat(np.repeat(ndi.binary_dilation(wallc,iterations=1).T,PX,0),PX,1)
# trust only floor pixels away from the patch edge and from walls: edge pixels carry
# skirting-board / wall / furniture colour, which used to bleed into the fill
ERODE=5
known=ndi.binary_erosion(a,iterations=ERODE)&~ndi.binary_dilation(barrier,iterations=3)
known=ndi.binary_opening(known,iterations=2)
# push-pull fill (fallback for barrier pixels and anything the geodesic fill cannot reach)
def pushpull(rgb,w):
    if min(w.shape)<=2:
        s=w.sum(); return np.broadcast_to((rgb*w[...,None]).sum((0,1))/max(s,1e-6),rgb.shape).copy()
    H,W=w.shape; H2,W2=(H+1)//2,(W+1)//2
    pr=np.zeros((H2*2,W2*2,3)); pw=np.zeros((H2*2,W2*2)); pr[:H,:W]=rgb*w[...,None]; pw[:H,:W]=w
    sr=pr.reshape(H2,2,W2,2,3).sum((1,3)); sw=pw.reshape(H2,2,W2,2).sum((1,3))
    lr=np.where(sw[...,None]>0, sr/np.maximum(sw,1e-6)[...,None], 0)
    coarse=pushpull(lr,(sw>0).astype(float))
    up=np.repeat(np.repeat(coarse,2,0),2,1)[:H,:W]
    up=ndi.uniform_filter(up,size=(3,3,1))
    return np.where(w[...,None]>0, rgb, up)
pp=pushpull(rgb,known.astype(float))
# geodesic onion-peel fill: grow colour outwards from known floor, never through walls
base=(rgb*known[...,None]).astype(np.float32); w=known.astype(np.float32)
free=~barrier
for it in range(600):
    num=cv2.blur(base*w[...,None],(5,5)); den=cv2.blur(w,(5,5))
    grow=(w==0)&(den>1e-4)&free
    if not grow.any(): break
    base[grow]=num[grow]/den[grow][:,None]; w[grow]=1
unreached=w==0
base[unreached]=pp[unreached]
# smooth the filled area (known pixels stay fixed, walls still block)
hole=~known
wf=free.astype(np.float32)
for k in (41,21,9):
    for _ in range(3):
        num=cv2.GaussianBlur(base*wf[...,None],(k,k),0); den=cv2.GaussianBlur(wf,(k,k),0)
        sm=num/np.maximum(den,1e-4)[...,None]
        m=hole&free; base[m]=sm[m]
# texture: large fills are otherwise flat and blurry. Transplant fine detail
# (image minus its local mean) from nearby real floor, patch by patch.
PS=32; ST=20; rng=np.random.default_rng(1)
kf=known.astype(np.float32)
lowf=cv2.GaussianBlur(rgb*kf[...,None],(0,0),6)/np.maximum(cv2.GaussianBlur(kf,(0,0),6),1e-4)[...,None]
resid=(rgb-lowf)*kf[...,None]
srcok=ndi.binary_erosion(known,iterations=PS//2+2)          # centres of fully known patches
from scipy.spatial import cKDTree
energy=cv2.blur(np.abs(resid).sum(2),(PS,PS))               # busy patches hold objects / hard shadows
cand=np.zeros_like(srcok); cand[::6,::6]=True; cand&=srcok
sy,sx=np.nonzero(cand); tree=cKDTree(np.stack([sy,sx],1))
win=np.outer(np.hanning(PS+2)[1:-1],np.hanning(PS+2)[1:-1]).astype(np.float32)
det=np.zeros_like(base); dw=np.zeros(base.shape[:2],np.float32)
H,W=hole.shape; need=hole&fpp; h=PS//2
for y in range(h,H-h,ST):
    for x in range(h,W-h,ST):
        if not need[y-h:y+h,x-h:x+h].any(): continue
        _,nn=tree.query([y,x],k=min(240,len(sy)))
        nn=nn[np.argsort(energy[sy[nn],sx[nn]])[:len(nn)//8]]   # calmest eighth of the 240 nearest
        k=rng.choice(nn); cy,cx=sy[k],sx[k]
        det[y-h:y+h,x-h:x+h]+=resid[cy-h:cy+h,cx-h:cx+h]*win[...,None]
        dw[y-h:y+h,x-h:x+h]+=win
det/=np.maximum(dw,1e-4)[...,None]
det=np.clip(det*1.25,-0.07,0.07)       # blending overlapping patches lowers contrast a little
fade=np.clip(ndi.distance_transform_edt(hole)/6.0,0,1)[...,None]   # no seam at the hole edge
filled=np.where(known[...,None],rgb,np.clip(base+det*fade,0,1))
out=np.concatenate([filled, fpp[...,None].astype(float)],2)
# soften alpha edge
Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8)).save(S+'/floorfill.png')
Image.fromarray((np.clip(filled,0,1)*255).astype(np.uint8)).save(S+'/floorfill.jpg',quality=88)
# heightfield mesh over footprint cells (vertex grid nx+1 x nz+1)
fpd=fp
hv=np.pad(fl,((0,1),(0,1)),mode='edge')
hv=ndi.uniform_filter(hv,3)-0.006
vid=-np.ones((nx+1,nz+1),int); verts=[]; uvs=[]
faces=[]
I,J=np.nonzero(fpd)
need=np.zeros((nx+1,nz+1),bool)
for di in (0,1):
  for dj in (0,1): need[I+di,J+dj]=True
VI,VJ=np.nonzero(need); vid[VI,VJ]=np.arange(len(VI))
verts=np.stack([x0+VI*cs, hv[VI,VJ], z0+VJ*cs],1)
uvs=np.stack([VI/nx, 1-VJ/nz],1)
a_,b_,c_,d_=vid[I,J],vid[I+1,J],vid[I+1,J+1],vid[I,J+1]
faces=np.concatenate([np.stack([a_,d_,c_],1),np.stack([a_,c_,b_],1)])
mesh=trimesh.Trimesh(verts,faces,process=False)
mesh.visual=trimesh.visual.TextureVisuals(uv=uvs,image=Image.open(S+'/floorfill.jpg'))
mesh.export(S+'/floorfill.glb')
print(len(verts),len(faces), fp.sum()*cs*cs,'m2')
