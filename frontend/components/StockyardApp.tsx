"use client";

import { useEffect, useState } from "react";
import { clock, format } from "@/lib/api";
import { FULL_AREA, useStockyard } from "@/lib/useStockyard";
import type { Area, Frame, LaneScope, Layer, Layers, Mode, ProductFilterMode, SelectionTool } from "@/lib/types";
import Icon from "./Icon";
import Viewport from "./Viewport";
import ConfigModal from "./ConfigModal";
import ScanModal from "./ScanModal";
import Modal from "./Modal";
import InventoryTable from "./InventoryTable";
import DiagnosticsModal from "./DiagnosticsModal";
import SimulationPanel from "./SimulationPanel";

const layerLabels: { id: Layer; label: string }[] = [
  { id: "map", label: "Fond satellite" },
  { id: "piles", label: "Surfaces des dépôts" },
  { id: "machine", label: "Stacker & convoyeur" },
  { id: "scanner", label: "Scanner & champ de vision" },
  { id: "points", label: "Points scanner (debug)" },
  { id: "measured", label: "Surface LiDAR observée" },
  { id: "grid", label: "Grille de repérage" },
  { id: "labels", label: "Repères & étiquettes" },
];


const jobStatusLabels: Record<string,string> = {
  PRET:"Prêt", REFUSE:"Refusé", EN_DEPLACEMENT:"En déplacement", EN_POSITIONNEMENT:"En positionnement",
  EN_COURS:"En cours", EN_PAUSE:"En pause", TERMINE:"Terminé", ARRETE:"Arrêté", ERREUR:"Erreur"
};

function isFullArea(area: Area) {
  return area.x0 === 0 && area.x1 === 360 && area.y0 === -54 && area.y1 === 54;
}

export default function StockyardApp() {
  const store = useStockyard();
  const { frame, live, api, report, area, setArea, connection, until } = store;
  const [mode, setMode] = useState<Mode>("3d");
  const [tool, setTool] = useState<SelectionTool>("navigate");
  const [scope, setScope] = useState<LaneScope>("all");
  const [tab, setTab] = useState("simulation");
  const [modal, setModal] = useState<"config" | "scan" | "empty" | "diagnostics" | null>(null);
  const [configTab, setConfigTab] = useState("machine");
  const [centerKey, setCenterKey] = useState(0);
  const [toast, setToast] = useState("");
  const [jobArea, setJobArea] = useState<Area | null>(null);
  const [jobAreaToken, setJobAreaToken] = useState(0);
  const [clockNow, setClockNow] = useState(Date.now());
  const [layers, setLayers] = useState<Layers>({ map: true, piles: true, machine: true, scanner: true, points: false, measured: false, grid: false, labels: true });
  const [productFilter, setProductFilter] = useState<string[]>([]);
  const [productFilterMode, setProductFilterMode] = useState<ProductFilterMode>("dim");
  const [productFilterInitialized, setProductFilterInitialized] = useState(false);
  const full = isFullArea(area);
  const blocked = !api || store.busy || until !== null;
  const connectionLabels = { connecting: "Connexion…", live: "Connecté au central", offline: "Central déconnecté", stale: "Données figées" };

  useEffect(() => { const t = setInterval(() => setClockNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const ids=frame?.config.products.map(product=>product.id)??[];
    if(ids.length && !productFilterInitialized){setProductFilter(ids);setProductFilterInitialized(true);}
  }, [frame?.config.products, productFilterInitialized]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 6000); return () => clearTimeout(t); }, [toast]);

  const openConfig = (section = "machine") => { setConfigTab(section); setModal("config"); };
  const select = (selected: Area) => { setArea(selected); setTab("selection"); setTool("navigate"); };
  const clearSelection = () => { setArea({ ...FULL_AREA }); setTool("navigate"); setTab("selection"); };
  const createJobFromSelection = () => {
    if (full) { setToast("Sélectionnez d'abord un intervalle ou un rectangle dans une seule base de stockage."); setMode("2d"); setTool("interval"); return; }
    setJobArea({ ...area }); setJobAreaToken(token => token + 1); setTab("simulation");
    setToast("La zone sélectionnée a été transférée dans le formulaire du job.");
  };
  const setView = (view: Mode) => { setMode(view); if (view === "3d") setTool("navigate"); };
  const chooseTool = (value: SelectionTool) => { setTool(value); if (value !== "navigate") setMode("2d"); };
  const chooseScope = (value: LaneScope) => {
    setScope(value);
    setArea({ ...area, y0: value === "north" ? 14 : value === "south" ? -48 : -54, y1: value === "north" ? 48 : value === "south" ? -14 : 54 });
  };
  const updateMachine = async (part: Record<string, unknown>, reason: string) => {
    if (!api || !frame) return;
    try { store.merge(await api.post<Frame>("/api/config", { machine: { ...frame.config.machine, ...part }, reason, operator: "Opérateur démo" }, "PATCH")); }
    catch (err) { store.setError(err instanceof Error ? err.message : "Le réglage a échoué."); }
  };
  const exportReport = async () => {
    try { await api?.download("/api/inventory/export", { ...area, until_sequence: until }, "inventaire-selection.csv"); }
    catch (err) { store.setError(err instanceof Error ? err.message : "Export impossible."); }
  };
  const saved = async (updated: Frame) => {
    store.merge(updated); setModal(null); setToast("Configuration enregistrée et tracée.");
    try { await store.refreshMap(); } catch { store.setError("Configuration enregistrée ; le fond de carte n'a pas pu être rechargé."); }
  };

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="Parc — accueil"><span className="brand-mark"><Icon name="layers" size={25} /></span><span>PARC<span className="brand-sub">SUPERVISION INDUSTRIELLE</span></span></a>
      <div className="topbar-divider" />
      <div className="site-label"><Icon name="map" size={17} /><span>{frame?.config.site.name ?? "Parc de démonstration"}</span><span className="pill neutral">Implantation d'exemple</span></div>
      <div className="topbar-right"><span className="pill amber">SIMULATION</span><time>{new Date(clockNow).toLocaleString("fr-FR", { hour12: false })}</time><button className="icon-button" onClick={() => openConfig("site")} disabled={!api}><Icon name="settings" /></button></div>
    </header>

    <main className="workspace">
      <aside className="sidebar">
        <section className="panel card"><span className="eyebrow">MENU</span><nav className="side-nav">
          <button className={tab === "simulation" ? "active" : ""} onClick={() => setTab("simulation")}><Icon name="chart" size={16} />Simulation</button>
          <button className={tab === "pilot" ? "active" : ""} onClick={() => setTab("pilot")}><Icon name="machine" size={16} />Pilotage</button>
          <button className={tab === "scanner" ? "active" : ""} onClick={() => setTab("scanner")}><Icon name="scanner" size={16} />Scanner</button>
          <button className={tab === "selection" ? "active" : ""} onClick={() => setTab("selection")}><Icon name="select" size={16} />Inventaire sélection</button>
        </nav></section>
        <section className="panel card"><div className="panel-title"><span className="eyebrow">COUCHES</span><button onClick={() => setLayers({ map: true, piles: true, machine: true, scanner: true, points: false, measured: false, grid: false, labels: true })}>Défaut</button></div>{layerLabels.map(layer => <label className="layer-toggle" key={layer.id}><input type="checkbox" checked={layers[layer.id]} onChange={e => setLayers({ ...layers, [layer.id]: e.target.checked })} /><span>{layer.label}</span></label>)}</section>
        <section className="panel card product-filter-panel"><div className="panel-title"><span className="eyebrow">FILTRE PRODUITS 3D</span><button onClick={()=>setProductFilter(frame?.config.products.map(p=>p.id)??[])}>Tous</button></div>
          <label className="field compact"><span>Affichage des produits non sélectionnés</span><select value={productFilterMode} onChange={e=>setProductFilterMode(e.target.value as ProductFilterMode)}><option value="dim">Transparents</option><option value="isolate">Masqués</option></select></label>
          {(frame?.config.products??[]).map(product=><label className="product-filter-row" key={product.id}><input type="checkbox" checked={productFilter.includes(product.id)} onChange={e=>setProductFilter(current=>e.target.checked?[...new Set([...current,product.id])]:current.filter(id=>id!==product.id))}/><i className="product-dot" style={{background:product.color}}/><span>{product.name}</span></label>)}
          <div className="filter-actions"><button onClick={()=>setProductFilter([])}>Aucun</button><button onClick={()=>setProductFilter(frame?.config.products.map(p=>p.id)??[])}>Tout afficher</button></div>
          {!!frame?.grid?.stratigraphy?.layer_count&&<p className="inspector-help">{frame.grid.stratigraphy.layer_count} couche(s) matière dans {frame.grid.stratigraphy.cell_count} cellule(s). Choisissez <strong>Masqués</strong> pour révéler un produit enfoui.</p>}
        </section>
        <section className="panel card metrics"><span className="eyebrow">ÉTAT DU JOB</span><strong>{frame?.active_job?.name ?? "Aucun job actif"}</strong><small>{frame?.active_job ? `${jobStatusLabels[frame.active_job.status]??frame.active_job.status} · ${format(frame.active_job.progress_pct, 0)} %` : "Créez un scénario puis lancez-le"}</small><div className="progress"><b style={{ width: `${Math.max(0, Math.min(100, frame?.active_job?.progress_pct ?? 0))}%` }} /></div></section>
        <section className="panel card metrics"><span className="eyebrow">INVENTAIRE GLOBAL</span><strong>{format(frame?.totals.total_tonnage_t, 0)} t</strong><small>{format(frame?.totals.total_volume_m3, 0)} m³ · hauteur max. {format(frame?.totals.max_height_m, 2)} m</small></section>
        <section className="panel card"><span className="eyebrow">CONFIGURATION</span><button className="text-button" onClick={() => openConfig("machine")} disabled={blocked}><Icon name="settings" size={15} />Machine & stockage</button><button className="text-button" onClick={() => openConfig("products")} disabled={blocked}><Icon name="layers" size={15} />Produits & couleurs</button><button className="text-button" onClick={() => setModal("empty")} disabled={blocked}><Icon name="reset" size={15} />Parc vide</button></section>
      </aside>

      <div className="main-stage">
        <section className="viewport-card">
          <div className="view-toolbar"><div className="segmented"><button className={mode === "3d" ? "active" : ""} onClick={() => setView("3d")}><Icon name="cube" size={16} />Vue 3D</button><button className={mode === "2d" ? "active" : ""} onClick={() => setView("2d")}><Icon name="map" size={16} />Vue 2D</button></div>
            <button className={tool === "interval" ? "tool-button active" : "tool-button"} onClick={() => chooseTool(tool === "interval" ? "navigate" : "interval")}>Intervalle</button>
            <button className={tool === "rectangle" ? "tool-button active" : "tool-button"} onClick={() => chooseTool(tool === "rectangle" ? "navigate" : "rectangle")}>Rectangle</button>
            {mode === "2d" && <select className="scope-select" aria-label="Parc à sélectionner" value={scope} onChange={e => chooseScope(e.target.value as LaneScope)}><option value="all">Les deux parcs</option><option value="south">Parc sud</option><option value="north">Parc nord</option></select>}
            {mode === "2d" && !full && <button className="tool-button" onClick={clearSelection}><Icon name="reset" size={16} />Effacer la sélection</button>}
            <button className="icon-button recenter" aria-label="Recentrer la vue" title="Recentrer la vue" onClick={() => setCenterKey(k => k + 1)}><Icon name="center" /></button></div>
          <Viewport frame={frame} mode={mode} tool={tool} scope={scope} layers={layers} area={full ? null : area} map={store.map} apiBase={api?.base ?? ""} productFilter={productFilter} productFilterMode={productFilterMode} onArea={select} onPick={kind => setTab(kind === "scanner" ? "scanner" : kind === "machine" ? "pilot" : "selection")} onStart={() => void store.command("start")} centerKey={centerKey} disabled={blocked || connection !== "live"} />
          <div className="timeline-bar"><Icon name="clock" size={15} /><span>Relecture</span><input aria-label="Relecture des acquisitions" type="range" min={1} max={Math.max(1, live?.sequence ?? 1)} value={until ?? Math.max(1, live?.sequence ?? 1)} disabled={!live?.sequence} onChange={e => store.setUntil(Number(e.target.value))} /><span className="timeline-number">#{until ?? frame?.machine.sequence ?? 0}</span><button className={`live-button ${until === null ? "active" : ""}`} onClick={() => store.setUntil(null)}><i className="dot" />{until === null ? "DIRECT" : "Revenir en direct"}</button></div>
        </section>

        {tab === "simulation" && <SimulationPanel api={api} frame={frame} disabled={blocked || connection !== "live"} onFrame={store.merge} onError={store.setError} selectedArea={jobArea} selectionToken={jobAreaToken} />}
        {tab === "pilot" && <section className="panel card inspector-wide"><header className="section-title"><div><span className="eyebrow">PILOTAGE</span><h3>STK-001</h3></div><span className="pill neutral">Commandes du simulateur uniquement</span></header><div className="control-buttons"><button className="button primary" data-testid="start-machine" disabled={blocked || frame?.running || connection !== "live"} onClick={() => void store.command("start")}><Icon name="play" size={16} />Démarrer</button><button className="button stop-button" data-testid="stop-machine" disabled={blocked || !frame?.running} onClick={() => void store.command("stop")}><Icon name="stop" size={15} />Arrêter</button></div><div className="field-grid"><label className="field"><span>Produit à déposer</span><select disabled={blocked} value={frame?.config.machine.product_id ?? ""} onChange={e => void updateMachine({ product_id: e.target.value, auto_products: false }, "Sélection manuelle du prochain produit")}><option value="" disabled>Chargement…</option>{frame?.config.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field"><span>Accélération du temps</span><select aria-label="Accélération du temps" disabled={blocked} value={frame?.config.machine.time_scale ?? 300} onChange={e => void updateMachine({ time_scale: Number(e.target.value) }, "Ajustement de la vitesse de démonstration")}>{[1, 50, 150, 300, 600, ...(frame && ![1, 50, 150, 300, 600].includes(frame.config.machine.time_scale) ? [frame.config.machine.time_scale] : [])].map(n => <option value={n} key={n}>× {n}</option>)}</select></label></div><label className="layer-toggle"><input type="checkbox" disabled={blocked} checked={frame?.config.machine.auto_products ?? true} onChange={e => void updateMachine({ auto_products: e.target.checked }, "Modification de l'alternance des produits")} /><span>Alterner les produits à chaque passage</span></label><div className="active-product"><i className="product-dot" style={{ background: frame?.active_product?.color ?? "#64748b" }} /><span>{frame?.active_product.name ?? "—"}</span><small>En cours</small></div><dl className="properties"><dt>Translation</dt><dd>{format(frame?.machine.travel_m)} m</dd><dt>Orientation</dt><dd>{format(frame?.machine.slew_deg)}°</dd><dt>Inclinaison</dt><dd>{format(frame?.machine.luff_deg)}°</dd><dt>Débit du convoyeur</dt><dd>{format(frame?.config.machine.flow_t_h, 0)} t/h</dd><dt>Vitesse sur rail</dt><dd>{format(frame?.config.machine.speed_m_s, 3)} m/s</dd><dt>Passage / direction</dt><dd>{(frame?.pass_number ?? 0) + 1} / {frame?.machine.direction === -1 ? "retour" : "aller"}</dd></dl><button className="text-button" onClick={() => openConfig("machine")} disabled={blocked}>Réglages de la machine <Icon name="arrow" size={14} /></button></section>}
        {tab === "scanner" && <section className="panel card inspector-wide"><header className="section-title"><div><span className="eyebrow">SCANNER</span><h3>LIDAR-001</h3></div><span className="pill neutral">Source simulée</span></header><div className="status-card"><i className={`dot ${frame?.scanner.acquiring ? "teal" : "gray"}`} /><strong>{frame?.scanner.acquiring ? "Acquisition active" : "Acquisition à l'arrêt"}</strong><small>Monté sur la flèche</small></div><dl className="properties"><dt>Fréquence</dt><dd>{format(frame?.scanner.rate_hz, 0)} Hz</dd><dt>Dernier balayage reçu</dt><dd>{clock(frame?.scanner.last_acquired_at)}</dd><dt>Séquence reçue</dt><dd>#{frame?.scanner.sequence ?? "—"}</dd><dt>Retours retenus</dt><dd>{frame?.scanner.valid_count ?? 0} / {frame?.scanner.total_count ?? 0}</dd><dt>Champ de vision</dt><dd>{format(frame?.config.scanner.fov_deg, 0)}°</dd><dt>Tampon d'acquisition</dt><dd>{frame?.communication.pending_records ?? 0} acquisition(s)</dd></dl><div className="control-buttons"><button className="button primary" disabled={!api} onClick={() => setModal("scan")}><Icon name="table" size={16} />Mesures & corrections</button><button className="button" disabled={blocked} onClick={() => openConfig("scanner")}><Icon name="settings" size={16} />Paramétrer le scanner</button></div><p className="inspector-help">Mesures transformées avec la pose à l'instant d'acquisition. Les données brutes ne sont jamais écrasées.</p></section>}
        {tab === "selection" && <section className="panel card inspector-wide"><header className="section-title"><div><span className="eyebrow">SÉLECTION 2D</span><h3>{full ? "Emprise complète" : "Zone sélectionnée"}</h3></div><span className="pill amber">Inventaire simulé</span></header><div className="selection-hero"><strong>{format(report?.total_tonnage_t)} <small>t</small></strong><span>{format(report?.total_volume_m3)} m³ de matière modélisée</span></div><dl className="properties"><dt>Intervalle longitudinal</dt><dd>{format(area.x0)} – {format(area.x1)} m</dd><dt>Emprise latérale</dt><dd>{format(area.y0)} – {format(area.y1)} m</dd><dt>Surface de la sélection</dt><dd>{format(report?.area_m2, 0)} m²</dd><dt>Hauteur maximale</dt><dd>{format(report?.max_height_m, 2)} m</dd><dt>Produits / lots</dt><dd>{report?.products.length ?? 0} / {report?.lots.length ?? 0}</dd><dt>Volume LiDAR partiel</dt><dd>{format(report?.observed_lidar_volume_m3)} m³</dd></dl><div className="control-buttons"><button className="button" onClick={() => chooseTool("interval")}><Icon name="select" size={16} />Sélectionner en 2D</button>{!full&&<button className="button primary" onClick={createJobFromSelection}><Icon name="plus" size={16}/>Créer un job dans cette zone</button>}{!full && <button className="button" onClick={clearSelection}><Icon name="reset" size={16} />Effacer la sélection</button>}</div><p className="inspector-help">Cliquez directement sur un produit dans la vue 2D ou 3D pour sélectionner sa cellule. Le détail des produits, couches, tonnages et analyses se trouve dans le tableau ci-dessous.</p></section>}
      </div>

      <InventoryTable report={report} area={area} onArea={select} onExport={() => void exportReport()} historical={until !== null} />
      <p className="workspace-disclaimer">Démonstrateur — ni pilotage d'automate, ni inventaire certifié. La photo de fond et les stocks simulés sont deux sources distinctes.</p>
    </main>

    <footer className="statusbar"><span><i className={`dot ${connection === "live" ? "teal" : "amber"}`} />{connectionLabels[connection]}</span><span>Automate : simulé</span><span>Scanner : {frame?.scanner.acquiring ? "actif (simulé)" : "à l'arrêt"}</span><button onClick={() => setModal("diagnostics")} disabled={!api}><i className={`dot ${frame?.communication.online ? "teal" : "amber"}`} />Liaison : {frame?.communication.online ? "disponible" : "coupée"}</button><span>Rattrapage : {frame?.communication.gap_state === "RECOVERING" ? "en cours" : frame?.communication.gap_state === "OPEN" ? "écart ouvert" : "continuité vérifiée"}</span><span>Tampon : {frame?.communication.pending_records ?? 0}</span><span className="statusbar-end">Repère local · mètres · {until !== null ? "RELECTURE" : "DIRECT"}</span></footer>

    {(store.error || toast) && <div className={`toast ${store.error ? "error" : ""}`} role={store.error ? "alert" : "status"}><Icon name={store.error ? "warning" : "check"} /><span>{store.error || toast}</span><button aria-label="Fermer le message" onClick={() => { store.setError(""); setToast(""); }}><Icon name="close" size={16} /></button></div>}
    {modal === "config" && frame && api && <ConfigModal config={frame.config} api={api} initialTab={configTab} onClose={() => setModal(null)} onSaved={updated => void saved(updated)} />}
    {modal === "scan" && api && <ScanModal api={api} recordId={until === null ? undefined : frame?.scanner.record_id ?? null} onClose={() => setModal(null)} />}
    {modal === "diagnostics" && frame && api && <DiagnosticsModal api={api} frame={live ?? frame} onClose={() => setModal(null)} onCommand={action => void store.command(action)} />}
    {modal === "empty" && <Modal title="Créer un parc vide ?" subtitle="Une nouvelle session de simulation sera créée." onClose={() => setModal(null)}><div className="modal-body"><div className="note amber"><Icon name="warning" />Le stacker sera arrêté et les stocks visibles seront remis à zéro. Le journal des acquisitions de la session précédente reste conservé sur le serveur.</div><p>Le prochain clic sur <strong>Démarrer</strong> lancera le premier dépôt, sans stock préchargé.</p></div><footer className="modal-footer"><button className="button" onClick={() => setModal(null)}>Annuler</button><button className="button primary" disabled={store.busy} onClick={async () => { await store.command("empty", true); setModal(null); }}>Confirmer le parc vide</button></footer></Modal>}
  </div>;
}
