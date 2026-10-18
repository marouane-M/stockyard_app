const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require(process.env.TYPESCRIPT_MODULE || '../frontend/node_modules/typescript');
const source=fs.readFileSync(path.join(__dirname,'../frontend/three/stratifiedGeometry.ts'),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const mod={exports:{}};vm.runInNewContext(`(function(require,module,exports){${code}\n})(require,module,module.exports)`,{require,module:mod,console,Float32Array,Int16Array,Uint32Array,Map,Math,Number,Array,Error});
const {buildStratifiedGeometry}=mod.exports;
const grid={nx:1,ny:1,cell_m:2,x0:0,y0:0,heights_m:[4],product_indices:[1],stratigraphy:{
  version:'DEPOSIT_STRATIGRAPHY_V1',cell_indices:[0],layer_offsets:[0,2],product_indices:[0,1],
  bottom_m:[0,3],top_m:[3,4],first_sequences:[1,2],last_sequences:[1,2],cell_count:1,layer_count:2,max_layers:2,products:[]
}};
const result=buildStratifiedGeometry(grid);
if(!result)throw new Error('La géométrie stratifiée est absente.');
if(result.layerCount!==2)throw new Error(`Deux couches attendues, reçu ${result.layerCount}.`);
if(result.groups.length!==2)throw new Error(`Deux groupes produit attendus, reçu ${result.groups.length}.`);
if(!result.groups.some(g=>g.productIndex===0)||!result.groups.some(g=>g.productIndex===1))throw new Error('Les deux couleurs produit ne sont pas séparées.');
if(result.positions.length===0||result.indices.length===0)throw new Error('La géométrie de couches est vide.');
console.log(JSON.stringify({status:'PASS',layers:result.layerCount,groups:result.groups.length,vertices:result.positions.length/3,indices:result.indices.length},null,2));
