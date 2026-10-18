"use client";
import { useEffect, useState } from "react";
import type { Api } from "@/lib/api";
import { dateTime, format, saveBlob } from "@/lib/api";
import type { ScanDetail } from "@/lib/types";
import Modal from "./Modal";
import Icon from "./Icon";
type Edit={index:number;range_m:number|null;quality:number};
export default function ScanModal({api,onClose,recordId}:{api:Api;onClose:()=>void;recordId?:string|null}){
  const [scan,setScan]=useState<ScanDetail|null>(null),[edits,setEdits]=useState<Record<number,Edit>>({});
  const [error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const [operator,setOperator]=useState("Opérateur démo"),[reason,setReason]=useState("");
  const load=async()=>{setBusy(true);setError("");try{if(recordId===null)throw new Error("Aucun balayage reçu à cette étape de la relecture.");setScan(await api.get<ScanDetail>(recordId===undefined?"/api/scans/latest":`/api/scans/${recordId}`));setEdits({});setMessage("");}catch(err){setError(err instanceof Error?err.message:"Aucun balayage disponible.");}finally{setBusy(false);}};
  useEffect(()=>{void load();},[]); // Deliberately freeze a specific acquisition for editing.
  const update=(index:number,key:"range_m"|"quality",value:number|null)=>{
    if(!scan)return;const beam=scan.beams[index];setEdits(e=>({...e,[index]:{...(e[index]??{index,range_m:beam.range_m,quality:beam.quality}),[key]:value}}));setMessage("");
  };
  const save=async()=>{
    if(!scan)return;setBusy(true);setError("");
    try{const result=await api.post<ScanDetail>(`/api/scans/${scan.id}/corrections`,{operator,reason,updates:Object.values(edits)});setScan(result);setEdits({});setReason("");setMessage("Correction enregistrée. Surface observée recalculée ; brut et bilan des dépôts conservés.");}
    catch(err){setError(err instanceof Error?err.message:"Correction refusée.");}finally{setBusy(false);}
  };
  const importChanges=async(file:File|undefined)=>{
    if(!file||!scan)return;
    try{
      if(file.size>1_000_000)throw new Error("Le fichier dépasse 1 Mo.");
      const input=JSON.parse(await file.text());const rows=input.updates;
      if(!Array.isArray(rows)||!rows.length||rows.length>scan.beams.length)throw new Error("Le JSON doit contenir une liste « updates » de rayons existants.");
      const next:Record<number,Edit>={};
      for(const row of rows){
        if(!Number.isInteger(row.index)||row.index<0||row.index>=scan.beams.length||next[row.index])throw new Error("Indice de rayon incorrect ou dupliqué.");
        if(row.range_m!==null&&(!Number.isFinite(row.range_m)||row.range_m<0||row.range_m>120))throw new Error("Distance hors limites : 0 à 120 m, ou null.");
        if(!Number.isInteger(row.quality)||row.quality<0||row.quality>100)throw new Error("Qualité attendue : entier de 0 à 100.");
        next[row.index]={index:row.index,range_m:row.range_m,quality:row.quality};
      }
      setEdits(next);setError("");setMessage("Modifications importées dans la copie de travail. Renseignez un motif, puis appliquez la correction.");
    }catch(err){setError(err instanceof Error?err.message:"Fichier JSON non valide.");}
  };
  const values=scan?.beams.map(b=>edits[b.index]??{index:b.index,range_m:b.range_m,quality:b.quality})??[];
  const maxRange=Math.max(1,...(scan?.beams.map(b=>b.raw_range_m??0)??[]),...values.map(v=>v.range_m??0));
  const curve=(array:(number|null)[])=>{let pen=false;return array.map((v,i)=>{if(v===null){pen=false;return "";}const cmd=pen?"L":"M";pen=true;return `${cmd}${(i/Math.max(1,array.length-1)*660+10).toFixed(1)},${(88-v/maxRange*75).toFixed(1)}`;}).join(" ");};
  return <Modal title="Données du scanner" subtitle="LIDAR-001 · inspection et corrections traçables" onClose={onClose} wide>
    <div className="modal-body">
      <div className="note"><Icon name="info"/>Le scanner mesure le stock ; le stacker dépose le produit. Une correction de mesure ne modifie pas le tonnage du registre de dépôt. Les identifiants, horodatages et mesures brutes restent immuables.</div>
      <div className="scan-toolbar"><button className="button" onClick={load} disabled={busy||Object.keys(edits).length>0}><Icon name="reset" size={15}/>{recordId===undefined?"Lire le dernier balayage":"Relire ce balayage"}</button>
        <button className="button" disabled={!scan} onClick={()=>scan&&saveBlob(new Blob([JSON.stringify({id:scan.id,acquired_at:scan.acquired_at,pose:scan.pose,config_version:scan.config_version,scanner_config:scan.scanner_config,raw:scan.raw},null,2)],{type:"application/json"}),`balayage-brut-${scan.sequence}.json`)}><Icon name="download" size={15}/>Exporter le brut</button>
        <label className="button import-button">Importer des corrections<input type="file" accept="application/json,.json" onChange={e=>void importChanges(e.target.files?.[0])} disabled={!scan}/></label>
      </div>
      {scan&&<><div className="scan-metadata"><div><span>Acquisition figée</span><strong>#{scan.sequence}</strong></div><div><span>Horodatage d'acquisition</span><strong>{dateTime(scan.acquired_at)}</strong></div><div><span>Position à l'acquisition</span><strong>{format(scan.pose.travel_m)} m</strong></div><div><span>Retours retenus</span><strong>{scan.valid_count} / {scan.beams.length}</strong></div></div>
        <div className="scan-chart"><div><span>Distance par rayon (m)</span><span><i className="legend-dot raw"/>Brut <i className="legend-dot adjusted"/>Copie de travail</span></div><svg viewBox="0 0 680 100" role="img" aria-label="Profil des distances brutes et révisées"><path d="M10 88H670M10 50H670M10 12H670" stroke="#e8ecec" fill="none"/><path d={curve(scan.beams.map(b=>b.raw_range_m))} stroke="#abbabf" strokeWidth="2" fill="none"/><path d={curve(values.map(v=>v.range_m))} stroke="#178b86" strokeWidth="1.4" fill="none"/></svg></div>
        <div className="scan-table-wrap"><table className="data-table scan-table"><thead><tr><th>Rayon</th><th>Angle (°)</th><th>Distance brute (m)</th><th>Distance révisée (m)</th><th>Qualité brute (%)</th><th>Qualité révisée (%)</th><th>X / Y / Z du parc (m)</th><th>État traité</th></tr></thead><tbody>{scan.beams.map(b=>{
          const edited=edits[b.index];return <tr key={b.index} className={edited?"edited-row":""}><td>{b.index}</td><td>{format(b.angle_deg,2)}</td><td>{format(b.raw_range_m,3)}</td>
            <td><input aria-label={`Distance rayon ${b.index}`} type="number" step=".001" min={0} max={120} value={edited?edited.range_m??"":b.range_m??""} onChange={e=>update(b.index,"range_m",e.target.value===""?null:Number(e.target.value))}/></td>
            <td>{format(b.raw_quality,0)}</td><td><input aria-label={`Qualité rayon ${b.index}`} type="number" min={0} max={100} step={1} value={edited?edited.quality:b.quality} onChange={e=>update(b.index,"quality",Number(e.target.value))}/></td>
            <td className="mono">{b.world_xyz?.map(v=>format(v,2)).join(" / ")??"—"}</td><td><span className={`pill ${edited?"amber":b.accepted?"good":"neutral"}`}>{edited?"À recalculer":b.accepted?b.corrected?"Révisé":"Retenu":"Écarté"}</span></td></tr>;
        })}</tbody></table></div>
        <p className="muted">Une distance vide signifie « aucun retour ». Une qualité inférieure au seuil configuré écarte le rayon. Les coordonnées traitées se mettent à jour après validation.</p>
        <details className="trace-details"><summary>Provenance & historique des corrections</summary><dl className="properties"><dt>Instance d'acquisition</dt><dd className="mono">{scan.acquisition_instance}</dd><dt>Identité du balayage</dt><dd className="mono">{scan.id}</dd><dt>Configuration à l'acquisition</dt><dd>Version {scan.config_version}</dd><dt>Origine globale du scanner</dt><dd>{scan.origin.map(v=>format(v,3)).join(" / ")} m</dd></dl>
          {scan.corrections.length?scan.corrections.map(c=><p key={c.revision_id} className="audit-entry"><strong>{dateTime(c.at)} · {c.operator}</strong><span>{c.reason}</span></p>):<p className="muted">Aucune correction pour ce balayage.</p>}
        </details>
        <div className="audit-fields"><label className="field"><span>Opérateur</span><input value={operator} onChange={e=>setOperator(e.target.value)} maxLength={80}/></label><label className="field"><span>Motif de correction <b>*</b></span><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Ex. Rejet d'un retour parasite identifié" maxLength={500}/></label></div>
      </>}
      {error&&<p className="form-error" role="alert">{error}</p>}{message&&<p className="form-success" role="status">{message}</p>}
    </div><footer className="modal-footer"><span>{Object.keys(edits).length} rayon(s) modifié(s)</span><button className="button" onClick={()=>setEdits({})} disabled={!Object.keys(edits).length}>Annuler les modifications</button><button className="button primary" disabled={busy||!Object.keys(edits).length||reason.trim().length<3||!operator.trim()} onClick={save}>{busy?"Recalcul…":"Appliquer la correction"}</button></footer>
  </Modal>;
}
