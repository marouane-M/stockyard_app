/** Display-only heightfield geometry. Inventory remains authoritative in Python.
 * Coordinates here are yard metres: X rail, Y lateral, Z up. YardScene applies
 * the single existing scene-root conversion to Three.js coordinates.
 */
export type HeightGrid = {
  nx: number; ny: number; cell_m: number; x0: number; y0: number;
  heights_m: readonly number[]; product_indices: readonly number[];
};
export const SURFACE_OFFSET_M = 0.025;
export const STOCKPILE_DISPLAY_DETAIL = 3;
export type SurfaceGroup = { productIndex: number; start: number; count: number };
export type StockpileSurface = {
  positions: Float32Array; heights: Float32Array; productIndices: Int16Array;
  indices: Uint32Array; groups: SurfaceGroup[];
  peak: { x: number; y: number; height: number };
  maxIndexCount: number;
};

function assertGrid(grid: HeightGrid) {
  const { nx, ny, cell_m: cell, x0, y0 } = grid;
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 1 || ny < 1 ||
      !Number.isFinite(cell) || cell <= 0 || !Number.isFinite(x0) || !Number.isFinite(y0) ||
      grid.heights_m.length !== nx * ny || grid.product_indices.length !== nx * ny ||
      grid.heights_m.some(h => !Number.isFinite(h) || h < 0)) {
    throw new Error("Grille de surface invalide.");
  }
}

const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const idx=(nx:number,x:number,y:number)=>y*nx+x;

function median(values:number[]):number{
  const clean=values.filter(Number.isFinite).sort((a,b)=>a-b);
  return clean.length?clean[Math.floor(clean.length/2)]:0;
}

/**
 * Robust display smoothing. It suppresses isolated LiDAR spikes and square cell
 * edges without touching the backend grid, volume or tonnage.
 */
function smoothDisplayGrid(grid: HeightGrid): Float32Array {
  const {nx,ny}=grid;
  const source=Float32Array.from(grid.heights_m);
  const medianPass=new Float32Array(source.length);
  for(let y=0;y<ny;y++) for(let x=0;x<nx;x++){
    const values:number[]=[];
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
      const px=x+dx,py=y+dy;
      if(px>=0&&py>=0&&px<nx&&py<ny){
        const h=source[idx(nx,px,py)];
        if(h>0.001)values.push(h);
      }
    }
    const current=source[idx(nx,x,y)];
    medianPass[idx(nx,x,y)]=current>0.001?median(values):0;
  }
  let input=medianPass;
  for(let pass=0;pass<2;pass++){
    const output=new Float32Array(input.length);
    for(let y=0;y<ny;y++) for(let x=0;x<nx;x++){
      const center=input[idx(nx,x,y)];
      let weighted=0,total=0,positive=0;
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
        const px=clamp(x+dx,0,nx-1),py=clamp(y+dy,0,ny-1);
        const h=input[idx(nx,px,py)];
        const w=(dx===0?2:1)*(dy===0?2:1);
        if(h>0.001){weighted+=h*w;total+=w;positive++;}
      }
      // Never spread a lone point into a wide flat plate. A small connected
      // neighbourhood is required before a cell is displayed as material.
      output[idx(nx,x,y)]=center>0.001 || positive>=3 ? (total?weighted/total:0) : 0;
    }
    input=output;
  }
  return input;
}

function sourceHeight(smooth:Float32Array,nx:number,ny:number,x:number,y:number):number{
  return smooth[idx(nx,clamp(x,0,nx-1),clamp(y,0,ny-1))]??0;
}
function cubic(p0:number,p1:number,p2:number,p3:number,t:number):number{
  const t2=t*t,t3=t2*t;
  return .5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3);
}
function sampleHeight(smooth:Float32Array,grid:HeightGrid,gx:number,gy:number):number{
  if(gx<=0||gy<=0||gx>=grid.nx||gy>=grid.ny)return 0;
  const sx=gx-.5,sy=gy-.5;
  const x1=Math.floor(sx),y1=Math.floor(sy),tx=sx-x1,ty=sy-y1;
  const rows:number[]=[];
  for(let r=-1;r<=2;r++){
    rows.push(cubic(
      sourceHeight(smooth,grid.nx,grid.ny,x1-1,y1+r),
      sourceHeight(smooth,grid.nx,grid.ny,x1,y1+r),
      sourceHeight(smooth,grid.nx,grid.ny,x1+1,y1+r),
      sourceHeight(smooth,grid.nx,grid.ny,x1+2,y1+r),tx));
  }
  const value=cubic(rows[0],rows[1],rows[2],rows[3],ty);
  return Math.max(0,value);
}
function productAt(grid:HeightGrid,x:number,y:number):number{
  if(x<0||y<0||x>=grid.nx||y>=grid.ny)return -1;
  return grid.product_indices[idx(grid.nx,x,y)]??-1;
}
function nearestProduct(grid:HeightGrid,gx:number,gy:number):number{
  const x=clamp(Math.floor(gx),0,grid.nx-1),y=clamp(Math.floor(gy),0,grid.ny-1);
  const direct=productAt(grid,x,y);if(direct>=0)return direct;
  let best=-1,bestH=0;
  for(let radius=1;radius<=2;radius++) for(let dy=-radius;dy<=radius;dy++) for(let dx=-radius;dx<=radius;dx++){
    const px=x+dx,py=y+dy;if(px<0||py<0||px>=grid.nx||py>=grid.ny)continue;
    const h=grid.heights_m[idx(grid.nx,px,py)]??0,p=productAt(grid,px,py);
    if(p>=0&&h>bestH){best=p;bestH=h;}
  }
  return best;
}
function triangleProduct(a:number,b:number,c:number,products:Int16Array,heights:Float32Array):number{
  const scores=new Map<number,number>();
  for(const v of [a,b,c]){
    const p=products[v];if(p<0||heights[v]<=.001)continue;
    scores.set(p,(scores.get(p)??0)+Math.max(.05,heights[v]));
  }
  let best=-1,score=-1;for(const [p,s] of scores)if(s>score){best=p;score=s;}
  return best;
}

export function buildStockpileSurface(grid: HeightGrid, previous?: ArrayLike<number>): StockpileSurface {
  assertGrid(grid);
  const {nx,ny,cell_m:cell,x0,y0}=grid;
  const smooth=smoothDisplayGrid(grid),detail=STOCKPILE_DISPLAY_DETAIL;
  const vx=nx*detail+1,vy=ny*detail+1,count=vx*vy;
  const positions=new Float32Array(count*3),heights=new Float32Array(count),productIndices=new Int16Array(count);productIndices.fill(-1);
  const peak={x:x0,y:y0,height:0};
  for(let row=0;row<vy;row++)for(let col=0;col<vx;col++){
    const i=row*vx+col,gx=col/detail,gy=row/detail,x=x0+gx*cell,y=y0+gy*cell;
    const h=sampleHeight(smooth,grid,gx,gy);
    heights[i]=h;positions.set([x,y,h+SURFACE_OFFSET_M],i*3);
    productIndices[i]=h>.001?nearestProduct(grid,gx,gy):-1;
    if(h>peak.height)Object.assign(peak,{x,y,height:h});
  }
  // Keep the measured/source maximum exact while its neighbours remain smooth.
  let sourcePeak=0,sourcePeakIndex=-1;
  for(let i=0;i<grid.heights_m.length;i++)if(grid.heights_m[i]>sourcePeak){sourcePeak=grid.heights_m[i];sourcePeakIndex=i;}
  if(sourcePeakIndex>=0){
    const sx=sourcePeakIndex%nx,sy=Math.floor(sourcePeakIndex/nx),col=Math.round((sx+.5)*detail),row=Math.round((sy+.5)*detail),i=row*vx+col;
    heights[i]=sourcePeak;positions[i*3+2]=sourcePeak+SURFACE_OFFSET_M;productIndices[i]=grid.product_indices[sourcePeakIndex]??-1;
    if(sourcePeak>=peak.height)Object.assign(peak,{x:x0+(sx+.5)*cell,y:y0+(sy+.5)*cell,height:sourcePeak});
  }

  // Two-pass grouping avoids allocating very large JavaScript number arrays.
  // At full-yard scale, those temporary arrays were the main source of browser
  // memory spikes when a new LiDAR profile arrived several times per second.
  const counts=new Map<number,number>();
  const visitTriangles=(consumer:(product:number,a:number,b:number,c:number)=>void)=>{
    for(let row=0;row<vy-1;row++)for(let col=0;col<vx-1;col++){
      const a=row*vx+col,b=a+1,c=a+vx,d=c+1;
      if(![a,b,c,d].some(v=>heights[v]>.001||(previous?.[v]??0)>.001))continue;
      for(const tri of [[a,b,c],[b,d,c]] as const){
        const product=triangleProduct(tri[0],tri[1],tri[2],productIndices,heights);
        consumer(product,tri[0],tri[1],tri[2]);
      }
    }
  };
  visitTriangles(product=>counts.set(product,(counts.get(product)??0)+3));
  const ordered=[...counts.keys()].sort((a,b)=>a-b),groups:SurfaceGroup[]=[];
  let total=0;
  for(const productIndex of ordered){const count=counts.get(productIndex)!;groups.push({productIndex,start:total,count});total+=count;}
  const indices=new Uint32Array(total),cursor=new Map<number,number>();
  for(const group of groups)cursor.set(group.productIndex,group.start);
  visitTriangles((product,a,b,c)=>{
    const at=cursor.get(product)!;indices[at]=a;indices[at+1]=b;indices[at+2]=c;cursor.set(product,at+3);
  });
  return {positions,heights,productIndices,indices,groups,peak,maxIndexCount:(vx-1)*(vy-1)*6};
}

export function writeInterpolatedHeights(positions:Float32Array,from:ArrayLike<number>,to:ArrayLike<number>,progress:number):number{
  if(positions.length!==to.length*3||from.length!==to.length)throw new Error("Tailles de surface incompatibles.");
  const t=Math.max(0,Math.min(1,progress)),blend=t*t*(3-2*t);let peak=0;
  for(let i=0;i<to.length;i++){const h=from[i]+(to[i]-from[i])*blend;positions[i*3+2]=h+SURFACE_OFFSET_M;peak=Math.max(peak,h);}return peak;
}
export function sampleStockpileHeight(grid:HeightGrid,positions:ArrayLike<number>,x:number,y:number):number{
  const gx=(x-grid.x0)/grid.cell_m,gy=(y-grid.y0)/grid.cell_m;if(gx<0||gy<0||gx>grid.nx||gy>grid.ny)return 0;
  const detail=STOCKPILE_DISPLAY_DETAIL,vx=grid.nx*detail+1,col=clamp(Math.round(gx*detail),0,vx-1),row=clamp(Math.round(gy*detail),0,grid.ny*detail),i=row*vx+col;
  const z=positions[i*3+2];return Number.isFinite(z)?Math.max(0,z):0;
}
