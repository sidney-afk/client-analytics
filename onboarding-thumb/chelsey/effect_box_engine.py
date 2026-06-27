import numpy as np, sys, json
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
img = Image.open('june1-boldround.png').convert('RGB')
a = np.asarray(img).astype(np.float32); H,W,_=a.shape
R,G,B=a[:,:,0],a[:,:,1],a[:,:,2]; minc=np.minimum(np.minimum(R,G),B)
yy=np.arange(H)[:,None]; band=(yy>int(H*0.60))&(yy<int(H*0.82))
white=(minc>205)&(np.abs(R-G)<28)&(np.abs(G-B)<34); mask=white&band
mask=np.asarray(Image.fromarray((mask*255).astype(np.uint8)).filter(ImageFilter.MedianFilter(3)))>0
talpha=np.clip((minc-200)/55,0,1)*mask
rows=np.where(mask.any(axis=1))[0]; lines=[];s=rows[0];p=rows[0]
for y in rows[1:]:
    if y-p>16: lines.append((s,p));s=y
    p=y
lines.append((s,p))
def disk(r):
    yy,xx=np.ogrid[-r:r+1,-r:r+1]; return (xx*xx+yy*yy)<=r*r
def render(r=22,padx=20,pad_in=14,textval=22,aa=1.1,fname='boxc.jpg'):
    U=np.zeros((H,W),bool); n=len(lines)
    for i,(ly0,ly1) in enumerate(lines):
        cc=np.where(mask[ly0:ly1+1].any(axis=0))[0]
        top=(ly0-pad_in) if i==0 else (lines[i-1][1]+ly0)//2
        bot=(ly1+pad_in) if i==n-1 else (ly1+lines[i+1][0])//2
        U[top:bot, max(0,cc.min()-padx):cc.max()+padx]=True
    d=disk(r)
    U=ndi.binary_closing(U,structure=d,border_value=0)
    U=ndi.binary_opening(U,structure=d,border_value=0)
    ba=np.asarray(Image.fromarray((U*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(aa))).astype(np.float32)/255.0
    out=a*(1-ba[...,None])+255.0*ba[...,None]
    out=out*(1-talpha[...,None])+textval*talpha[...,None]
    out=np.clip(out,0,255).astype(np.uint8); Image.fromarray(out).save('fx2_box.png')
    ys,xs=np.where(U); y0,y1,x0,x1=ys.min(),ys.max(),xs.min(),xs.max(); m=44
    crop=Image.fromarray(out).crop((max(0,x0-m),max(0,y0-m),min(W,x1+m),min(H,y1+m)))
    cw=520; crop.resize((cw,int(cw*crop.height/crop.width))).save(fname,quality=90)
    print('ok r',r,'padx',padx,'pad_in',pad_in,'lines',lines)
if __name__=='__main__':
    render(**(json.loads(sys.argv[1]) if len(sys.argv)>1 else {}))
