/* Dependency-light tests for the actual display geometry module, not a mock. */
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const ts = require(process.env.TYPESCRIPT_MODULE || "../frontend/node_modules/typescript");
const input = path.resolve(__dirname, "../frontend/three/stockpileGeometry.ts");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parc-relief-"));
let count = 0;
function test(name, fn) { fn(); count++; console.log(`OK ${count} — ${name}`); }
function close(a,b) { assert.ok(Math.abs(a-b)<1e-5, `${a} != ${b}`); }
try {
  const program = ts.createProgram([input], {strict:true,target:ts.ScriptTarget.ES2020,
    module:ts.ModuleKind.CommonJS,skipLibCheck:true,outDir:dir});
  const errors = ts.getPreEmitDiagnostics(program);
  if(errors.length) throw Error(ts.formatDiagnosticsWithColorAndContext(errors,{
    getCanonicalFileName:f=>f,getCurrentDirectory:()=>process.cwd(),getNewLine:()=>"\n"}));
  program.emit();
  const {buildStockpileSurface:build,writeInterpolatedHeights:write,sampleStockpileHeight:sample,
    SURFACE_OFFSET_M:offset} = require(path.join(dir,"stockpileGeometry.js"));
  const peakIndex = s => {
    let best = 0;
    for (let i = 1; i < s.heights.length; i++) if (s.heights[i] > s.heights[best]) best = i;
    return best;
  };
  const empty = () => ({nx:5,ny:5,cell_m:2,x0:0,y0:-10,heights_m:Array(25).fill(0),product_indices:Array(25).fill(-1)});
  const mound = () => {const g=empty();g.heights_m[12]=8;g.product_indices[12]=2;return g;};
  test("parc vide : aucun triangle de produit",()=>{
    const s=build(empty()); assert.equal(s.indices.length,0);assert.equal(s.peak.height,0);
  });
  test("le sommet conserve 8 mètres, sans division par quatre",()=>{
    const s=build(mound());assert.equal(s.peak.height,8);
    const i=peakIndex(s);close(s.positions[i*3+2]-offset,8);
    close(Math.max(...s.heights),8);
  });
  test("flancs continus et couronne extérieure au sol",()=>{
    const s=build(mound());assert.ok(s.heights.some(h=>h>0 && h<8));
    const rowLength = Math.sqrt(s.heights.length); assert.equal(Number.isInteger(rowLength), true);
    for(let x=0;x<rowLength;x++){assert.equal(s.heights[x],0);assert.equal(s.heights[s.heights.length-rowLength+x],0);}
  });
  test("les indices sont valides et les triangles orientés vers le haut",()=>{
    const s=build(mound());
    for(let i=0;i<s.indices.length;i+=3){
      const [a,b,c]=Array.from(s.indices.slice(i,i+3));
      assert.ok(a<s.heights.length && b<s.heights.length && c<s.heights.length);
      const p=s.positions;
      assert.ok((p[b*3]-p[a*3])*(p[c*3+1]-p[a*3+1])-(p[b*3+1]-p[a*3+1])*(p[c*3]-p[a*3])>0);
    }
  });
  test("croissance progressive, bornée entre les surfaces reçues",()=>{
    const s=build(mound()),from=new Float32Array(s.heights.length);let previous=0;
    for(let n=0;n<=20;n++){const peak=write(s.positions,from,s.heights,n/20);assert.ok(peak>=previous&&peak<=8);previous=peak;}
    write(s.positions,from,s.heights,.5);const i=peakIndex(s);close(s.positions[i*3+2]-offset,4);
  });
  test("aucun dépassement après la fin de l'interpolation",()=>{
    const s=build(mound());close(write(s.positions,new Float32Array(s.heights.length),s.heights,10),8);
  });
  test("arrêt et relecture : application exacte de la hauteur cible",()=>{
    const s=build(mound());write(s.positions,s.heights,s.heights,1);
    close(s.positions[peakIndex(s)*3+2]-offset,8);
    const zero=new Float32Array(s.heights.length);write(s.positions,s.heights,zero,1);
    close(Math.max(...s.positions.filter((_,i)=>i%3===2))-offset,0);
  });
  test("le produit tombant atteint le sommet affiché",()=>{
    const g=mound(),s=build(g);close(sample(g,s.positions,5,-5),8+offset);
    const from=new Float32Array(s.heights.length);write(s.positions,from,s.heights,.5);
    close(sample(g,s.positions,5,-5),4+offset);assert.equal(sample(g,s.positions,-2,0),0);
  });
  test("échantillonnage de flanc : interpolation dans le triangle",()=>{
    const g=mound(),s=build(g),h=sample(g,s.positions,5,-5.5);
    assert.ok(h>2+offset && h<8+offset);
  });
  test("couleurs de produit conservées et grille source non modifiée",()=>{
    const g=mound(),before=JSON.stringify(g),s=build(g);
    assert.equal(s.productIndices[peakIndex(s)],2);assert.equal(JSON.stringify(g),before);
  });
  test("les dimensions et valeurs non finies sont refusées",()=>{
    assert.throws(()=>build({...empty(),nx:0}));
    const g=mound();g.heights_m[12]=NaN;assert.throws(()=>build(g));
  });
  test("nouveau parc vide : aucune ancienne géométrie ne subsiste",()=>{
    const original=build(mound());const reset=build(empty());
    assert.equal(reset.indices.length,0);assert.ok(original.indices.length>0);
  });
  console.log(`${count} tests réussis ; typage strict du module de géométrie réussi (TypeScript ${ts.version}).`);
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
