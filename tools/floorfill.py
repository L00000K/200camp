import sys, json, numpy as np, trimesh
from PIL import Image
from scipy import ndimage as ndi
S=sys.argv[1]
G=json.load(open(S+'/floorgrid.json')); nx,nz,cs,x0,z0=G['nx'],G['nz'],G['cs'],G['x0'],G['z0']
fl=np.array(G['floor'])  # [nx,nz]
im=np.asarray(Image.open(S+'/floor_raw.png')).astype(np.float32)/255  # [H=nz*4, W=nx*4, 4]
m=trimesh.load(S+'/scan/17_12_2021.glb',force='mesh',process=False)
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
a=im[...,3]>0.5
rgb=im[...,:3]
# push-pull fill
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
filled=pushpull(rgb,a.astype(float))
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
