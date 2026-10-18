"use client";
import { useEffect, useRef, useState } from "react";
import { YardScene } from "@/three/YardScene";
import type { Area, Frame, LaneScope, Layers, MapManifest, Mode, Picked, SelectionTool } from "@/lib/types";
import Icon from "./Icon";
type Props={frame:Frame|null;mode:Mode;tool:SelectionTool;scope:LaneScope;layers:Layers;area:Area|null;map:MapManifest|null;apiBase:string;
  onArea:(area:Area)=>void;onPick:(type:Picked)=>void;onStart:()=>void;centerKey:number;disabled:boolean};
export default function Viewport(props:Props){
  const mount=useRef<HTMLDivElement>(null),scene=useRef<YardScene|null>(null),callbacks=useRef(props);
  callbacks.current=props;
  const [error,setError]=useState(""),[mapStatus,setMapStatus]=useState({loaded:0,total:0,failed:0});
  useEffect(()=>{
    if(!mount.current)return;
    try{scene.current=new YardScene(mount.current,a=>callbacks.current.onArea(a),kind=>callbacks.current.onPick(kind),(loaded,total,failed)=>setMapStatus({loaded,total,failed}));}
    catch {setError("Le rendu 3D nécessite WebGL 2. Activez l'accélération graphique du navigateur. L'inventaire reste accessible ci-dessous.");}
    return()=>{scene.current?.destroy();scene.current=null;};
  },[]);
  useEffect(()=>{if(props.frame)scene.current?.setFrame(props.frame);},[props.frame]);
  useEffect(()=>{scene.current?.setMode(props.mode);},[props.mode]);
  useEffect(()=>{scene.current?.setTool(props.tool,props.scope);},[props.tool,props.scope,props.mode]);
  useEffect(()=>{scene.current?.setLayers(props.layers);},[props.layers]);
  useEffect(()=>{scene.current?.selectArea(props.area);},[props.area]);
  useEffect(()=>{if(props.map&&props.apiBase)scene.current?.setMap(props.map,props.apiBase);},[props.map,props.apiBase]);
  useEffect(()=>{scene.current?.center();},[props.centerKey]);
  const empty=props.frame?.totals.total_tonnage_t===0&&!props.frame.running;
  return <div className={`viewport ${props.mode==="2d"?"plan-view":""}`}>
    <div ref={mount} className="canvas-mount"/>
    <div className="viewport-top"><span className="viewport-tag"><i className="dot teal"/>{props.frame?.mode==="HISTORICAL"?"RELECTURE":"JUMEAU NUMÉRIQUE"}</span><span className="viewport-tag subtle">{props.mode==="2d"?"Vue en plan · mètres":"Perspective · mètres"}</span></div>
    {props.mode==="3d"&&props.frame&&<div className="stock-height-tools">
      <span className="viewport-tag" data-testid="stockpile-height" title="Hauteur maximale de la grille modélisée, sans exagération verticale">Hauteur max. {props.frame.totals.max_height_m.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} m</span>
      <button className="button" disabled={props.frame.totals.total_tonnage_t<=0} onClick={()=>scene.current?.focusPile()} title="Approcher la caméra du sommet du tas ; Recentrer retrouve la vue générale">Voir le relief</button>
    </div>}
    {props.mode==="2d"&&<div className="compass"><span>N</span><span className="compass-arrow" style={{transform:`rotate(${props.map?.site.heading_deg??0}deg)`}}>↑</span><small>NORD GÉOGRAPHIQUE</small></div>}
    {empty&&!error&&<div className="empty-viewport"><div className="empty-symbol"><Icon name="layers" size={28}/></div><h3>Le parc est prêt.</h3><p>Démarrez le stacker pour déposer le premier produit.<br/>Le scanner mesurera la surface au fil des passages.</p><button className="button primary" onClick={props.onStart} disabled={props.disabled}><Icon name="play" size={16}/>Démarrer la simulation</button><span>Parc vide · aucun stock préchargé</span></div>}
    {error&&<div className="viewport-error" role="alert"><Icon name="warning"/>{error}</div>}
    <div className="viewport-bottom"><span className="hint">{props.mode==="2d"&&props.tool!=="navigate"?"Cliquez-glissez pour sélectionner "+(props.tool==="interval"?"un intervalle":"une zone"):props.mode==="3d"?"Glisser : orbite · molette : zoom · clic : détails":"Glisser : déplacement · molette : zoom"}</span><span className="scale-bar">Distances en mètres</span></div>
    <div className="attribution">{props.layers.map&&mapStatus.loaded>0?(props.map?.attribution??"Fond cartographique"):mapStatus.failed>0?"Fond satellite indisponible · schéma local affiché":!props.layers.map?"Fond cartographique masqué":props.map?.enabled?"Chargement du fond satellite…":"Fond cartographique désactivé"}{mapStatus.failed>0&&mapStatus.loaded>0?" · couverture partielle":""}</div>
  </div>;
}
