/* Parse every TS/TSX file. This is deliberately NOT a substitute for tsc + next build. */
const fs=require("node:fs"),path=require("node:path");
const ts=require(process.env.TYPESCRIPT_MODULE || "../frontend/node_modules/typescript");
const root=path.resolve(__dirname,"../frontend");let files=0,errors=[];
function walk(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){
  if(["node_modules",".next","playwright-report","test-results"].includes(f.name))continue;
  const p=path.join(dir,f.name);
  if(f.isDirectory())walk(p);else if(/\.tsx?$/.test(p)&&!p.endsWith(".d.ts")){
    files++;const source=ts.createSourceFile(p,fs.readFileSync(p,"utf8"),ts.ScriptTarget.Latest,true,p.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    errors.push(...source.parseDiagnostics.map(d=>`${path.relative(root,p)}: ${ts.flattenDiagnosticMessageText(d.messageText," ")}`));
  }
}}
walk(root);console.log(`TypeScript ${ts.version} — ${files} fichiers — ${errors.length} erreur(s) de syntaxe.`);
if(errors.length){console.error(errors.join("\n"));process.exit(1);}
console.log("La résolution des dépendances, le typage complet et le rendu Next.js ne sont PAS vérifiés par ce script.");
