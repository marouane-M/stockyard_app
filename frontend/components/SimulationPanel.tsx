"use client";
import { useEffect, useMemo, useState } from "react";
import type { Api } from "@/lib/api";
import { dateTime, format } from "@/lib/api";
import type { Frame, Product, SimulationJob, SimulationJobConfig, SimulationPassConfig } from "@/lib/types";
import Icon from "./Icon";

const storageLabels: Record<SimulationJobConfig["storage_type"], string> = {
  mound: "Tas progressif — relief naturel",
  gaussian: "Dispersion large",
  longitudinal: "Stockage longitudinal",
  alternating: "Passages alternés",
  conical: "Tas conique"
};
const statusLabels: Record<string,string> = {
  PRET: "Prêt", EN_COURS: "En cours", EN_PAUSE: "En pause", TERMINE: "Terminé", ARRETE: "Arrêté", ERREUR: "Erreur"
};
const statusClass: Record<string,string> = {
  PRET: "neutral", EN_COURS: "teal", EN_PAUSE: "amber", TERMINE: "teal", ARRETE: "neutral", ERREUR: "red"
};

function defaultPass(product: Product | undefined, index: number): SimulationPassConfig {
  return {
    product_id: product?.id ?? "",
    target_tonnage_t: index < 2 ? 2500 : 1500,
    direction: index % 2 === 0 ? "forward" : "backward",
    lane: "auto"
  };
}
function defaultConfig(products: Product[], current?: Frame | null): SimulationJobConfig {
  const fallback = products[0];
  const active = current?.active_product ?? fallback;
  const second = active ? (products.find(p => p.id !== active.id) ?? active) : fallback;
  return {
    name: `Scénario ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`,
    storage_type: "mound",
    start_m: current?.config.machine.travel_min_m ?? 40,
    end_m: current?.config.machine.travel_max_m ?? 300,
    lane: current?.config.machine.lane ?? "south",
    travel_speed_m_s: current?.config.machine.speed_m_s ?? 0.08,
    flow_t_h: current?.config.machine.flow_t_h ?? 1800,
    time_scale: current?.config.machine.time_scale ?? 300,
    reset_before_start: true,
    passes: products.length ? [defaultPass(active, 0), defaultPass(second, 1)] : []
  };
}
function pct(value: number | undefined) {
  return Math.max(0, Math.min(100, Number.isFinite(value ?? NaN) ? Number(value) : 0));
}

export default function SimulationPanel({ api, frame, disabled, onFrame, onError }:{
  api: Api | null;
  frame: Frame | null;
  disabled: boolean;
  onFrame: (frame: Frame)=>void;
  onError: (message: string)=>void;
}) {
  const products = frame?.config.products ?? [];
  const [draft, setDraft] = useState<SimulationJobConfig>(() => defaultConfig(products, frame));
  const [jobs, setJobs] = useState<SimulationJob[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [operator, setOperator] = useState("Opérateur démo");
  const selected = jobs.find(job => job.id === selectedId) ?? jobs[0] ?? null;

  useEffect(() => {
    if (products.length && !draft.passes.length) setDraft(defaultConfig(products, frame));
  }, [products.length]);

  const loadJobs = async () => {
    if (!api) return;
    try {
      const data = await api.get<SimulationJob[]>("/api/simulation/jobs");
      setJobs(data);
      if (!selectedId && data[0]) setSelectedId(data[0].id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Les jobs de simulation sont indisponibles.");
    }
  };
  useEffect(() => {
    void loadJobs();
    const timer = setInterval(() => void loadJobs(), 1200);
    return () => clearInterval(timer);
  }, [api?.base, selectedId]);

  const totalTarget = useMemo(() => draft.passes.reduce((sum, step) => sum + (Number(step.target_tonnage_t) || 0), 0), [draft.passes]);
  const update = <K extends keyof SimulationJobConfig>(key: K, value: SimulationJobConfig[K]) => setDraft(d => ({ ...d, [key]: value }));
  const updatePass = <K extends keyof SimulationPassConfig>(index: number, key: K, value: SimulationPassConfig[K]) => setDraft(d => ({ ...d, passes: d.passes.map((step, i) => i === index ? { ...step, [key]: value } : step) }));
  const addPass = () => setDraft(d => ({ ...d, passes: [...d.passes, defaultPass(products[d.passes.length % Math.max(1, products.length)] ?? products[0], d.passes.length)] }));
  const removePass = (index: number) => setDraft(d => ({ ...d, passes: d.passes.filter((_, i) => i !== index) }));
  const duplicate = (job: SimulationJob) => {
    setDraft({ ...job.config, name: `${job.name} — copie`, reset_before_start: true });
  };

  const createJob = async (startNow: boolean) => {
    if (!api) return;
    if (!products.length) { onError("Aucun produit configuré pour créer un job."); return; }
    setBusy(true);
    try {
      const job = await api.post<SimulationJob>("/api/simulation/jobs", { config: draft, operator, reason: "Création depuis l'interface de simulation" });
      setSelectedId(job.id);
      await loadJobs();
      if (startNow) {
        await api.post<SimulationJob>(`/api/simulation/jobs/${job.id}/command`, { action: "start", confirm: true });
        onFrame(await api.get<Frame>("/api/snapshot"));
        await loadJobs();
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Le job n'a pas été créé.");
    } finally { setBusy(false); }
  };
  const command = async (job: SimulationJob, action: "start" | "pause" | "resume" | "stop") => {
    if (!api) return;
    setBusy(true);
    try {
      await api.post<SimulationJob>(`/api/simulation/jobs/${job.id}/command`, { action, confirm: true });
      onFrame(await api.get<Frame>("/api/snapshot"));
      await loadJobs();
    } catch (err) { onError(err instanceof Error ? err.message : "Commande de job refusée."); }
    finally { setBusy(false); }
  };

  return <div className="simulation-panel">
    <section className="simulation-builder">
      <header className="section-title"><div><span className="eyebrow">CONFIGURATION</span><h3>Créer un job de simulation</h3></div><span className="pill neutral">Snapshot des paramètres</span></header>
      <div className="field-grid compact-fields">
        <label className="field"><span>Nom du job</span><input value={draft.name} maxLength={100} onChange={e=>update("name", e.target.value)}/></label>
        <label className="field"><span>Type de stockage</span><select value={draft.storage_type} onChange={e=>update("storage_type", e.target.value as SimulationJobConfig["storage_type"])}>{Object.entries(storageLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <label className="field"><span>Parc</span><select value={draft.lane} onChange={e=>update("lane", e.target.value as "north"|"south")}><option value="south">Parc sud — lavé</option><option value="north">Parc nord — brut</option></select></label>
        <label className="field"><span>Distance début (m)</span><input type="number" min={0} max={350} step={1} value={draft.start_m} onChange={e=>update("start_m", Number(e.target.value))}/></label>
        <label className="field"><span>Distance fin (m)</span><input type="number" min={10} max={360} step={1} value={draft.end_m} onChange={e=>update("end_m", Number(e.target.value))}/></label>
        <label className="field"><span>Vitesse stacker (m/s)</span><input type="number" min={0.005} max={0.3} step={0.005} value={draft.travel_speed_m_s} onChange={e=>update("travel_speed_m_s", Number(e.target.value))}/></label>
        <label className="field"><span>Débit produit (t/h)</span><input type="number" min={0} max={6000} step={50} value={draft.flow_t_h} onChange={e=>update("flow_t_h", Number(e.target.value))}/></label>
        <label className="field"><span>Accélération temps (×)</span><input type="number" min={1} max={600} step={10} value={draft.time_scale} onChange={e=>update("time_scale", Number(e.target.value))}/></label>
      </div>
      <label className="layer-toggle reset-line"><input type="checkbox" checked={draft.reset_before_start} onChange={e=>update("reset_before_start", e.target.checked)}/><span>Vider le parc avant ce job pour voir l'impact des paramètres</span></label>
      <div className="pass-table">
        <div className="pass-head"><span>Passages et produits</span><button className="text-button" type="button" onClick={addPass} disabled={draft.passes.length>=12||!products.length}><Icon name="plus" size={14}/>Ajouter un passage</button></div>
        {draft.passes.map((step,index)=><div className="pass-row" key={index}>
          <strong>#{index+1}</strong>
          <select aria-label={`Produit du passage ${index+1}`} value={step.product_id} onChange={e=>updatePass(index,"product_id",e.target.value)}>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <input aria-label={`Tonnage cible ${index+1}`} type="number" min={0} max={100000} step={100} value={step.target_tonnage_t} onChange={e=>updatePass(index,"target_tonnage_t",Number(e.target.value))}/>
          <select aria-label={`Direction ${index+1}`} value={step.direction} onChange={e=>updatePass(index,"direction",e.target.value as SimulationPassConfig["direction"])}><option value="auto">Direction automatique</option><option value="forward">Aller</option><option value="backward">Retour</option></select>
          <button className="icon-button" type="button" title="Retirer ce passage" disabled={draft.passes.length<=1} onClick={()=>removePass(index)}><Icon name="close" size={14}/></button>
        </div>)}
      </div>
      <div className="job-summary-line"><span>Total cible : <strong>{format(totalTarget,0)} t</strong></span><label className="field inline-field"><span>Opérateur</span><input value={operator} onChange={e=>setOperator(e.target.value)} maxLength={80}/></label></div>
      <div className="control-buttons"><button className="button" disabled={!api||busy||disabled} onClick={()=>void createJob(false)}><Icon name="save" size={16}/>Enregistrer le job</button><button className="button primary" disabled={!api||busy||disabled} onClick={()=>void createJob(true)}><Icon name="play" size={16}/>Créer et lancer</button></div>
    </section>

    <section className="simulation-results">
      <header className="section-title"><div><span className="eyebrow">RÉSULTATS</span><h3>Jobs et comparaison rapide</h3></div><button className="text-button" disabled={!selected} onClick={()=>selected&&duplicate(selected)}><Icon name="copy" size={14}/>Dupliquer</button></header>
      <div className="jobs-list">
        {jobs.length===0?<p className="muted">Aucun job créé. Lancez un premier scénario pour voir les résultats.</p>:jobs.map(job=><button key={job.id} className={`job-card ${selected?.id===job.id?"active":""}`} onClick={()=>setSelectedId(job.id)}>
          <span><strong>{job.name}</strong><small>{dateTime(job.created_at)}</small></span><i className={`pill ${statusClass[job.status]??"neutral"}`}>{statusLabels[job.status]??job.status}</i><em>{format(job.results?.total_tonnage_t,0)} t</em><div className="progress"><b style={{width:`${pct(job.progress_pct)}%`}}/></div>
        </button>)}
      </div>
      {selected&&<div className="job-detail">
        <div className="job-title-row"><div><h4>{selected.name}</h4><span>{storageLabels[selected.config.storage_type]} · {selected.config.start_m} → {selected.config.end_m} m</span></div><span className={`pill ${statusClass[selected.status]??"neutral"}`}>{statusLabels[selected.status]??selected.status}</span></div>
        <dl className="result-grid"><div><dt>Tonnage</dt><dd>{format(selected.results.total_tonnage_t,0)} t</dd></div><div><dt>Volume</dt><dd>{format(selected.results.total_volume_m3,0)} m³</dd></div><div><dt>Hauteur max.</dt><dd>{format(selected.results.max_height_m,2)} m</dd></div><div><dt>Durée</dt><dd>{format(selected.results.duration_s/60,1)} min</dd></div></dl>
        <div className="control-buttons small"><button className="button primary" disabled={busy||selected.status==="EN_COURS"} onClick={()=>void command(selected, selected.status==="EN_PAUSE"?"resume":"start")}><Icon name="play" size={14}/>{selected.status==="EN_PAUSE"?"Reprendre":"Lancer"}</button><button className="button" disabled={busy||selected.status!=="EN_COURS"} onClick={()=>void command(selected,"pause")}><Icon name="pause" size={14}/>Pause</button><button className="button stop-button" disabled={busy||!["EN_COURS","EN_PAUSE"].includes(selected.status)} onClick={()=>void command(selected,"stop")}><Icon name="stop" size={14}/>Arrêter</button></div>
        <div className="product-breakdown">{Object.values(selected.results.products??{}).length===0?<p className="muted">Les produits apparaîtront ici pendant le dépôt.</p>:Object.values(selected.results.products).map(product=><div key={product.product_id} className="product-result"><i className="product-dot" style={{background:product.color}}/><span>{product.name}</span><strong>{format(product.tonnage_t,0)} t</strong></div>)}</div>
        <div className="pass-progress">{selected.results.passes.map(step=>{const product=products.find(p=>p.id===step.product_id);const ratio=step.target_tonnage_t?step.deposited_tonnage_t/step.target_tonnage_t*100:0;return <div key={step.index}><span>#{step.index+1} {product?.name??step.product_id}</span><em>{format(step.deposited_tonnage_t,0)} / {format(step.target_tonnage_t,0)} t</em><div className="progress"><b style={{width:`${pct(ratio)}%`, background:product?.color}}/></div></div>;})}</div>
      </div>}
    </section>
  </div>;
}
