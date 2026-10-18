"use client";
import type { JobArea, JobValidation } from "@/lib/types";
import { format } from "@/lib/api";
import Icon from "./Icon";
import Modal from "./Modal";

export default function JobValidationModal({validation,busy,onClose,onUseSuggestion,onConfirm}:{
  validation: JobValidation;
  busy: boolean;
  onClose: ()=>void;
  onUseSuggestion: (area:JobArea)=>void;
  onConfirm: ()=>void;
}) {
  const m=validation.metrics;
  return <Modal title={validation.valid?"Aperçu du job":"Job impossible"}
    subtitle={validation.valid?"Vérification de la capacité et de l'occupation":"Corrigez la zone ou les paramètres avant de lancer la simulation."}
    onClose={onClose} wide>
    <div className="modal-body job-validation-body">
      <div className={`note ${validation.valid?"success":"amber"}`}>
        <Icon name={validation.valid?"check":"warning"}/><strong>{validation.summary}</strong>
      </div>
      {validation.errors.length>0&&<div className="validation-issues">
        {validation.errors.map(issue=><article key={issue.code} className="validation-issue error">
          <Icon name="warning"/><div><strong>{issue.title}</strong><p>{issue.message}</p></div>
        </article>)}
      </div>}
      <dl className="validation-metrics">
        <div><dt>Zone sélectionnée</dt><dd>{format(m.length_m,1)} × {format(m.width_m,1)} m</dd></div>
        <div><dt>Surface</dt><dd>{format(m.selected_area_m2,0)} m²</dd></div>
        <div><dt>Tonnage demandé</dt><dd>{format(m.requested_tonnage_t,0)} t</dd></div>
        <div><dt>Volume demandé</dt><dd>{format(m.requested_volume_m3,0)} m³</dd></div>
        <div><dt>Capacité libre estimée</dt><dd>{format(m.free_capacity_m3,0)} m³</dd></div>
        <div><dt>Hauteur prévue</dt><dd>{format(m.estimated_max_height_m,2)} / {format(m.max_height_m,2)} m</dd></div>
        <div><dt>Surface déjà occupée</dt><dd>{format(m.occupied_area_m2,0)} m²</dd></div>
        <div><dt>Durée estimée</dt><dd>{format(m.estimated_duration_s/60,1)} min</dd></div>
      </dl>
      {validation.planned_passes.length>0&&<section className="planned-products">
        <h3>Répartition prévue des produits</h3>
        {validation.planned_passes.map(plan=><div className="planned-product" key={plan.index}>
          <i className="product-dot" style={{background:plan.color}}/><span><strong>{plan.product_name}</strong><small>{format(plan.x0,1)} → {format(plan.x1,1)} m · {format(plan.target_tonnage_t,0)} t</small></span><em>{format(plan.estimated_z0_m,1)} → {format(plan.estimated_z1_m,1)} m</em>
        </div>)}
      </section>}
      {validation.suggested_area&&<div className="suggested-area">
        <div><strong>Zone libre proposée</strong><span>{format(validation.suggested_area.x0,1)} → {format(validation.suggested_area.x1,1)} m</span></div>
        <button className="button" onClick={()=>onUseSuggestion(validation.suggested_area!)}><Icon name="map" size={15}/>Utiliser cette zone</button>
      </div>}
      <p className="inventory-footnote">Aperçu de simulation non certifié. La validation est recalculée au moment du lancement afin de tenir compte des nouveaux dépôts.</p>
    </div>
    <footer className="modal-footer">
      <button className="button" onClick={onClose}>Fermer</button>
      {validation.valid&&<button className="button primary" disabled={busy} onClick={onConfirm}><Icon name="play" size={16}/>Valider et lancer le job</button>}
    </footer>
  </Modal>;
}
