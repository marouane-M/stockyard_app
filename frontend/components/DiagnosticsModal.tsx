"use client";
import { useEffect,useState } from "react";
import type { Api } from "@/lib/api";
import { dateTime,format } from "@/lib/api";
import type { AuditEvent,Frame } from "@/lib/types";
import Icon from "./Icon";
import Modal from "./Modal";
export default function DiagnosticsModal({api,frame,onClose,onCommand}:{api:Api;frame:Frame;onClose:()=>void;onCommand:(action:string)=>void}){
  const [events,setEvents]=useState<AuditEvent[]>([]),[error,setError]=useState("");
  useEffect(()=>{api.get<AuditEvent[]>("/api/audit").then(setEvents).catch(()=>setError("Le journal des modifications est indisponible."));},[api,frame.config.version,frame.communication.online]);
  const c=frame.communication;
  const status={OPEN:"Écart ouvert",RECOVERING:"Rattrapage en cours",RECONCILED:"Continuité vérifiée"};
  const type=(e:AuditEvent)=>e.type==="config"?"Configuration":e.type==="correction"?"Correction de mesure":e.type==="transport"?e.online?"Liaison rétablie":"Coupure simulée":e.action==="start"?"Démarrage du simulateur":"Arrêt du simulateur";
  return <Modal title="Communication & traçabilité" subtitle="Liaisons et composants de démonstration — aucun équipement réel connecté" onClose={onClose} wide><div className="modal-body">
    <div className="pipeline"><span><Icon name="scanner"/>Acquisition simulée</span><Icon name="arrow"/><span><Icon name="layers"/>Journal durable</span><Icon name="arrow"/><span><Icon name="network"/>Projection centrale</span></div>
    <div className="scan-metadata"><div><span>Acquisitions capturées</span><strong>{format(c.captured_records,0)}</strong></div><div><span>Reçues par le central</span><strong>{format(c.accepted_records,0)}</strong></div><div><span>En attente de transfert</span><strong>{format(c.pending_records,0)}</strong></div><div><span>Continuité</span><strong>{status[c.gap_state]}</strong></div></div>
    <div className="note amber"><Icon name="info"/>Une coupure arrête le transfert, pas la simulation d'acquisition. Le direct reprend avant la fin du rattrapage. L'inventaire ne compte chaque acquisition qu'une fois.</div>
    <div className="scan-toolbar"><button className={`button ${c.online?"danger-outline":"primary"}`} onClick={()=>onCommand(c.online?"outage":"restore")}><Icon name="network"/>{c.online?"Simuler une coupure":"Rétablir la liaison"}</button><span className="muted">Dernière interruption : {format(c.last_outage_duration_s)} s</span></div>
    <h3>Journal des modifications</h3>{error&&<p className="form-error">{error}</p>}
    <div className="audit-list">{events.length?events.map((e,index)=><article className="audit-entry" key={`${e.at}:${index}`}><time>{dateTime(e.at)}</time><strong>{type(e)}</strong><span>{e.reason??"Commande limitée au simulateur."}</span>{e.operator&&<small>{e.operator}</small>}</article>):<p className="muted">Aucune modification enregistrée.</p>}</div>
    <p className="muted">Les événements JSONL sont conservés dans le volume Docker du backend. Ce journal local ne remplace pas une architecture d'acquisition Edge multi-nœuds ni une gestion des droits de production.</p>
  </div><footer className="modal-footer"><span>État réseau ≠ état de récupération des données</span><button className="button" onClick={onClose}>Fermer</button></footer></Modal>;
}
