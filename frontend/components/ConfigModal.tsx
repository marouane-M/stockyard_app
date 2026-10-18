"use client";
import { useState } from "react";
import type { Api } from "@/lib/api";
import type { Config, Frame, MachineConfig, Product, ScannerConfig, Site } from "@/lib/types";
import Modal from "./Modal";
import Icon from "./Icon";
function NumberField({label,value,onChange,min,max,step=.1}:{label:string;value:number;onChange:(n:number)=>void;min?:number;max?:number;step?:number}){
  return <label className="field"><span>{label}</span><input type="number" value={Number.isFinite(value)?value:""} min={min} max={max} step={step} onChange={e=>onChange(e.target.value===""?NaN:Number(e.target.value))}/></label>;
}
function Toggle({label,value,onChange}:{label:string;value:boolean;onChange:(v:boolean)=>void}){return <label className="toggle-line"><span>{label}</span><input type="checkbox" checked={value} onChange={e=>onChange(e.target.checked)}/></label>;}
export default function ConfigModal({config,api,onClose,onSaved,initialTab="machine"}:{config:Config;api:Api;onClose:()=>void;onSaved:(frame:Frame)=>void;initialTab?:string}){
  const [tab,setTab]=useState(initialTab),[draft,setDraft]=useState<Config>(()=>structuredClone(config));
  const [reason,setReason]=useState(""),[operator,setOperator]=useState("Opérateur démo"),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const m=(key:keyof MachineConfig,value:unknown)=>setDraft(d=>({...d,machine:{...d.machine,[key]:value}}));
  const s=(key:keyof ScannerConfig,value:unknown)=>setDraft(d=>({...d,scanner:{...d.scanner,[key]:value}}));
  const g=(key:keyof Site,value:unknown)=>setDraft(d=>({...d,site:{...d.site,[key]:value}}));
  const p=(index:number,key:keyof Product,value:unknown)=>setDraft(d=>({...d,products:d.products.map((product,i)=>i===index?{...product,[key]:value}:product)}));
  const save=async()=>{
    setBusy(true);setError("");
    try{const frame=await api.post<Frame>("/api/config",{machine:draft.machine,scanner:draft.scanner,products:draft.products,site:draft.site,operator,reason},"PATCH");onSaved(frame);}
    catch(err){setError(err instanceof Error?err.message:"La configuration n'a pas été enregistrée.");}finally{setBusy(false);}
  };
  const scannerFields: {key:keyof ScannerConfig;label:string;min:number;max:number;step:number}[]=[
    {key:"rate_hz",label:"Fréquence d'acquisition (Hz)",min:1,max:10,step:1},
    {key:"samples",label:"Rayons par balayage",min:9,max:241,step:1},
    {key:"fov_deg",label:"Champ de vision (°)",min:10,max:120,step:1},
    {key:"min_range_m",label:"Portée minimale (m)",min:.1,max:10,step:.1},
    {key:"max_range_m",label:"Portée maximale (m)",min:15,max:120,step:1},
    {key:"noise_std_m",label:"Écart-type du bruit simulé (m)",min:0,max:1,step:.005},
    {key:"dropout_pct",label:"Retours absents simulés (%)",min:0,max:80,step:1},
    {key:"range_bias_m",label:"Correction additive de distance (m)",min:-3,max:3,step:.01},
    {key:"range_scale",label:"Facteur de correction de distance",min:.8,max:1.2,step:.001},
    {key:"min_quality",label:"Seuil de qualité des retours (%)",min:0,max:100,step:1},
    {key:"z_min_m",label:"Altitude locale minimale retenue (m)",min:-10,max:0,step:.1},
    {key:"z_max_m",label:"Altitude locale maximale retenue (m)",min:1,max:100,step:1},
  ];
  return <Modal title="Configuration du parc" subtitle={`Version ${config.version} · paramètres de simulation uniquement`} onClose={onClose} wide>
    <nav className="tabbar">{[["machine","Machine"],["scanner","Scanner"],["products","Produits & qualité"],["site","Carte & repère"]].map(([id,label])=><button key={id} onClick={()=>setTab(id)} className={tab===id?"active":""}>{label}</button>)}</nav>
    <div className="modal-body">
      {tab==="machine"&&<><div className="note"><Icon name="info"/>Le temps est accéléré pour rendre les dépôts visibles. Débit et vitesse sont exprimés dans le temps simulé.</div><div className="field-grid">
        <NumberField label="Début de translation (m)" value={draft.machine.travel_min_m} min={18} max={330} onChange={v=>m("travel_min_m",v)}/>
        <NumberField label="Fin de translation (m)" value={draft.machine.travel_max_m} min={30} max={342} onChange={v=>m("travel_max_m",v)}/>
        <NumberField label="Vitesse de translation (m/s)" value={draft.machine.speed_m_s} step={.005} min={.005} max={.3} onChange={v=>m("speed_m_s",v)}/>
        <NumberField label="Débit du convoyeur (t/h)" value={draft.machine.flow_t_h} step={50} min={0} max={6000} onChange={v=>m("flow_t_h",v)}/>
        <NumberField label="Accélération du temps (×)" value={draft.machine.time_scale} step={10} min={1} max={600} onChange={v=>m("time_scale",v)}/>
        <NumberField label="Orientation de référence, valeur absolue (°)" value={Math.abs(draft.machine.slew_deg)} step={1} min={70} max={110} onChange={v=>m("slew_deg",v)}/>
        <NumberField label="Inclinaison de flèche (°)" value={draft.machine.luff_deg} min={0} max={30} onChange={v=>m("luff_deg",v)}/>
        <NumberField label="Oscillation latérale (°)" value={draft.machine.oscillation_deg} min={0} max={10} onChange={v=>m("oscillation_deg",v)}/>
        <NumberField label="Longueur de flèche (m)" value={draft.machine.boom_length_m} min={24} max={35} onChange={v=>m("boom_length_m",v)}/>
        <NumberField label="Hauteur du pivot (m)" value={draft.machine.pivot_height_m} min={6} max={15} onChange={v=>m("pivot_height_m",v)}/>
        <label className="field"><span>Formation du stock</span><select value={draft.machine.deposition_profile??"mound"} onChange={e=>m("deposition_profile",e.target.value)}><option value="mound">Tas progressif — relief conique</option><option value="gaussian">Dispersion large — ancien modèle v2</option></select></label>
        {draft.machine.deposition_profile==="gaussian"?<NumberField label="Dispersion du dépôt, sigma (m)" value={draft.machine.footprint_sigma_m} min={2} max={8} onChange={v=>m("footprint_sigma_m",v)}/>:<NumberField label="Angle du talus simulé (°)" value={draft.machine.repose_angle_deg??34} min={20} max={45} step={1} onChange={v=>m("repose_angle_deg",v)}/>}
        <label className="field"><span>Parc du premier aller-retour</span><select value={draft.machine.lane} onChange={e=>m("lane",e.target.value)}><option value="south">Parc sud — lavé</option><option value="north">Parc nord — brut</option></select></label>
        <label className="field"><span>Premier produit de la séquence</span><select value={draft.machine.product_id} onChange={e=>m("product_id",e.target.value)}>{draft.products.map(product=><option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
      </div><p className="muted">Le tas grandit en hauteur et s'élargit selon le volume ajouté. Angle illustratif, pas une mesure du matériau. Les réglages concernent uniquement les prochains dépôts ; l'historique et les tonnages existants sont conservés.</p><Toggle label="Changer de produit à chaque passage" value={draft.machine.auto_products} onChange={v=>m("auto_products",v)}/><Toggle label="Changer de parc après chaque aller-retour" value={draft.machine.alternate_lanes} onChange={v=>m("alternate_lanes",v)}/></>}
      {tab==="scanner"&&<><div className="note"><Icon name="info"/>Les nouveaux réglages s'appliquent aux futures acquisitions. Les balayages existants conservent leur pose et leur étalonnage d'origine.</div>
        <Toggle label="Activer l'acquisition du scanner" value={draft.scanner.enabled} onChange={v=>s("enabled",v)}/>
        <h3>Acquisition & traitement</h3><div className="field-grid">{scannerFields.map(f=><NumberField key={f.key} label={f.label} value={draft.scanner[f.key] as number} min={f.min} max={f.max} step={f.step} onChange={v=>s(f.key,v)}/>)}</div>
        <h3>Montage sur la flèche</h3><p className="muted">Translations relatives à l'extrémité de flèche, puis rotations X → Y → Z. Repère du parc : X translation, Y latéral, Z vertical.</p>
        <div className="field-grid">{([['mount_x_m','Décalage X (m)'],['mount_y_m','Décalage Y (m)'],['mount_z_m','Décalage Z (m)'],['mount_roll_deg','Roulis X (°)'],['mount_pitch_deg','Tangage Y (°)'],['mount_yaw_deg','Lacet Z (°)']] as const).map(([key,label])=><NumberField key={key} label={label} value={draft.scanner[key]} min={key.endsWith("_m")?-3:-25} max={key.endsWith("_m")?3:25} step={.01} onChange={v=>s(key,v)}/>)}</div>
      </>}
      {tab==="products"&&<><div className="note amber"><Icon name="info"/>Valeurs fictives pour la démonstration, non issues d'un laboratoire. La densité et les analyses sont figées à chaque dépôt : les modifications ne réécrivent pas l'historique.</div>
        {draft.products.map((product,index)=><section className="product-editor" key={product.id}><header><i className="product-dot" style={{background:product.color}}/><h3>{product.id}</h3><span className="pill neutral">Simulé</span></header><div className="field-grid">
          <label className="field"><span>Nom du produit</span><input value={product.name} maxLength={70} onChange={e=>p(index,"name",e.target.value)}/></label>
          <label className="field"><span>Couleur de la surface</span><input type="color" value={product.color} onChange={e=>p(index,"color",e.target.value)}/></label>
          {([['density_t_m3','Masse volumique apparente (t/m³)'],['bpl_pct','BPL (%)'],['co2_pct','CO₂ (%)'],['mgo_pct','MgO (%)'],['sio2_pct','SiO₂ (%)'],['cao_pct','CaO (%)'],['moisture_pct','Humidité (%)']] as const).map(([key,label])=><NumberField key={key} label={label} value={product[key]} min={key==="density_t_m3"?.1:0} max={key==="density_t_m3"?5:100} step={.01} onChange={v=>p(index,key,v)}/>)}</div></section>)}
      </>}
      {tab==="site"&&<><div className="note amber"><Icon name="map"/>L'image est géoréférencée, mais les rails et le parc sont synthétiques. La coordonnée initiale est un exemple, pas une identification du site photographié. Modifiez le repère uniquement dans un parc vide.</div><div className="field-grid">
        <label className="field"><span>Nom du site</span><input value={draft.site.name} maxLength={80} onChange={e=>g("name",e.target.value)}/></label>
        <NumberField label="Latitude de l'origine (WGS84)" value={draft.site.latitude} min={-80} max={80} step={.000001} onChange={v=>g("latitude",v)}/>
        <NumberField label="Longitude de l'origine (WGS84)" value={draft.site.longitude} min={-180} max={180} step={.000001} onChange={v=>g("longitude",v)}/>
        <NumberField label="Altitude ellipsoïdale de l'origine (m)" value={draft.site.altitude_m} min={-500} max={9000} step={.01} onChange={v=>g("altitude_m",v)}/>
        <NumberField label="Angle du rail depuis l'Est, sens anti-horaire (°)" value={draft.site.heading_deg} min={-180} max={180} step={.01} onChange={v=>g("heading_deg",v)}/>
      </div><p className="muted">Le fournisseur d'images et son attribution se règlent côté serveur, dans .env. Les images nécessitent Internet et les droits d'utilisation appropriés. La surface du sol est plane ; aucun modèle de terrain topographique n'est fourni.</p></>}
      <div className="audit-fields"><label className="field"><span>Opérateur</span><input value={operator} onChange={e=>setOperator(e.target.value)} maxLength={80}/></label><label className="field"><span>Motif de modification <b>*</b></span><input placeholder="Ex. Ajustement de la densité pour le prochain lot" value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/></label></div>
      {error&&<p className="form-error" role="alert">{error}</p>}
    </div><footer className="modal-footer"><span><Icon name="clock" size={15}/>Chaque modification est journalisée.</span><button className="button" onClick={onClose}>Annuler</button><button className="button primary" disabled={busy||reason.trim().length<3||!operator.trim()} onClick={save}>{busy?"Enregistrement…":"Appliquer les réglages"}</button></footer>
  </Modal>;
}
