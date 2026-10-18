import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Area, Frame, Grid, LaneScope, Layers, MapManifest, Mode, Picked, SelectionTool } from "@/lib/types";

import { buildStockpileSurface, sampleStockpileHeight, SURFACE_OFFSET_M, writeInterpolatedHeights } from "./stockpileGeometry";

const rad = THREE.MathUtils.degToRad;
function dispose(object: THREE.Object3D) {
  object.traverse(child => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    if (mesh.material) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        (material as THREE.MeshBasicMaterial).map?.dispose(); material.dispose();
      }
    }
  });
}

function roundPointTexture(color = "#25cfc4"): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32,32,2,32,32,30);
  gradient.addColorStop(0, color);
  gradient.addColorStop(.55, color);
  gradient.addColorStop(1, "rgba(37,207,196,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath(); ctx.arc(32,32,30,0,Math.PI*2); ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function textSprite(text: string, width = 35, color = "#223b40", background = "transparent"): THREE.Sprite {
  const canvas = document.createElement("canvas"); canvas.width = 768; canvas.height = 112;
  const ctx = canvas.getContext("2d")!;
  if (background !== "transparent") { ctx.fillStyle = background; ctx.fillRect(0,0,768,112); }
  ctx.fillStyle = color; ctx.font = "600 52px Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text,384,58,744);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent:true, depthTest:false }));
  sprite.scale.set(width,width*112/768,1); sprite.renderOrder = 6;
  return sprite;
}

export class YardScene {
  private mount: HTMLDivElement;
  private scene = new THREE.Scene();
  private root = new THREE.Group();
  private renderer: THREE.WebGLRenderer;
  private perspective = new THREE.PerspectiveCamera(44,1,.1,2000);
  private top = new THREE.OrthographicCamera(-220,220,100,-100,.1,1500);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private controls: OrbitControls;
  private mode: Mode = "3d";
  private tool: SelectionTool = "navigate";
  private scope: LaneScope = "all";
  private map = new THREE.Group();
  private labels = new THREE.Group();
  private gridLines = new THREE.Group();
  private machine = new THREE.Group();
  private slew = new THREE.Group();
  private luff = new THREE.Group();
  private scannerMount = new THREE.Group();
  private mountRoll = new THREE.Group();
  private mountPitch = new THREE.Group();
  private mountYaw = new THREE.Group();
  private scannerVisual = new THREE.Group();
  private fan = new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:0x16b5ba,transparent:true,opacity:.12,side:THREE.DoubleSide,depthWrite:false}));
  private beam = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({color:0x40ede3,transparent:true,opacity:.9}));
  private surface = new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88,metalness:0,side:THREE.DoubleSide,flatShading:false}));
  private scannerPointTexture = roundPointTexture();
  private points = new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({
    color:0x25cfc4,size:.22,sizeAttenuation:true,transparent:true,opacity:.28,depthWrite:false,alphaTest:.04
  }));
  private observed = new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({color:0x125bf0,size:.45,sizeAttenuation:true,transparent:true,opacity:.38,depthWrite:false}));
  private stream = new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({color:0xdd39b5,size:.62,sizeAttenuation:true}));
  private selection = new THREE.Group();
  private pointPositions = new Float32Array(20000*3);
  private pointCount = 0;
  private pointCursor = 0;
  private lastScanKey = "";
  private poseTween: { at:number; from:number[]; to:number[] } | null = null;
  private frame: Frame | null = null;
  private currentGrid: Grid | null = null;
  private surfaceTween: { at: number; from: Float32Array; to: Float32Array } | null = null;
  private surfaceTargets: Float32Array | null = null;
  private surfaceSignature = "";
  private geometrySignature = "";
  private fanSignature = "";
  private instance = "";
  private lastMode = "LIVE";
  private drag: { x: number; y: number; screenX: number; screenY: number } | null = null;
  private pointerOrigin: { x: number; y: number } | null = null;
  private area: Area | null = null;
  private layers: Layers = { map:true,piles:true,machine:true,scanner:true,points:false,measured:false,grid:false,labels:true };
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private generation = 0;
  private disposed = false;
  private onArea: (area: Area) => void;
  private onPick: (type: Picked) => void;
  private onMapStatus: (loaded: number, total: number, failed: number) => void;

  constructor(mount: HTMLDivElement, onArea: (area: Area) => void, onPick: (type: Picked) => void,
              onMapStatus: (loaded: number,total: number,failed: number)=>void) {
    this.mount=mount; this.onArea=onArea; this.onPick=onPick; this.onMapStatus=onMapStatus;
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:"high-performance"});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.8));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.18;
    this.renderer.shadowMap.enabled=true; this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute("aria-label","Vue interactive du parc de stockage");
    this.renderer.domElement.setAttribute("data-testid","yard-canvas");
    this.renderer.domElement.tabIndex=0;
    mount.appendChild(this.renderer.domElement);
    this.scene.background=new THREE.Color(0xdce7e9);
    this.scene.fog=new THREE.Fog(0xdce7e9,650,1350);
    // This is the ONLY industrial-to-render coordinate conversion.
    this.root.rotation.x=-Math.PI/2; this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xf5fbff,0x777c66,2.1));
    const sun=new THREE.DirectionalLight(0xfff8eb,2.8); sun.position.set(90,260,180); sun.castShadow=true;
    sun.shadow.camera.left=-260; sun.shadow.camera.right=260; sun.shadow.camera.top=180; sun.shadow.camera.bottom=-180;
    sun.shadow.camera.far=800; sun.shadow.mapSize.set(2048,2048); sun.shadow.bias=-.0007;
    sun.target.position.set(180,0,0); this.scene.add(sun,sun.target);
    this.top.up.set(0,0,-1); // OrbitControls captures camera.up when constructed.
    this.camera=this.perspective;
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.configureControls(); this.center();
    this.buildGround();
    this.root.add(this.map,this.labels,this.gridLines,this.machine,this.surface,this.points,this.observed,this.stream,this.selection);
    this.surface.receiveShadow=true; this.surface.castShadow=true; this.surface.userData.kind="pile";
    (this.points.material as THREE.PointsMaterial).map=this.scannerPointTexture;
    (this.points.material as THREE.PointsMaterial).needsUpdate=true;
    this.points.renderOrder=2;
    this.observed.renderOrder=2;
    this.points.geometry.setAttribute("position",new THREE.BufferAttribute(this.pointPositions,3));
    this.points.geometry.setDrawRange(0,0); this.points.frustumCulled=false;
    this.stream.geometry.setAttribute("position",new THREE.BufferAttribute(new Float32Array(60*3),3));
    this.stream.frustumCulled=false; this.stream.visible=false;
    this.observed.frustumCulled=false;
    this.renderer.domElement.addEventListener("pointerdown",this.pointerDown);
    this.renderer.domElement.addEventListener("pointermove",this.pointerMove);
    this.renderer.domElement.addEventListener("pointerup",this.pointerUp);
    this.renderer.domElement.addEventListener("pointercancel",this.pointerCancel);
    this.resizeObserver=new ResizeObserver(()=>this.resize()); this.resizeObserver.observe(mount); this.resize();
    const animate=(now: number)=>{
      if(this.disposed) return;
      this.controls.update(); this.animateSurface(now*.001); this.animateSource(now*.001);
      this.renderer.render(this.scene,this.camera); this.raf=requestAnimationFrame(animate);
    };
    this.raf=requestAnimationFrame(animate);
  }
  private configureControls() {
    this.controls.enableDamping=true; this.controls.dampingFactor=.12;
    this.controls.maxPolarAngle=this.mode==="3d"?Math.PI*.47:Math.PI; this.controls.minPolarAngle=this.mode==="3d"?.1:0;
    this.controls.minDistance=40; this.controls.maxDistance=750;
    this.controls.minZoom=.5; this.controls.maxZoom=8;
    this.controls.enableRotate=this.mode==="3d";
    this.controls.screenSpacePanning=true;
    this.controls.enabled=!(this.mode==="2d" && this.tool!=="navigate");
  }
  private box(group: THREE.Group, size: [number,number,number], position: [number,number,number], color: number, metalness=.25) {
    const object=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshStandardMaterial({color,roughness:.68,metalness}));
    object.position.set(...position); object.castShadow=true; object.receiveShadow=true; group.add(object); return object;
  }
  private rod(group: THREE.Group,a: number[],b: number[],radius: number,color: number) {
    const v1=new THREE.Vector3(...a as [number,number,number]),v2=new THREE.Vector3(...b as [number,number,number]);
    const direction=v2.clone().sub(v1);
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,direction.length(),5),new THREE.MeshStandardMaterial({color,roughness:.7}));
    mesh.position.copy(v1.add(v2).multiplyScalar(.5)); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
    mesh.castShadow=true; group.add(mesh); return mesh;
  }
  private buildGround() {
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(1250,1050),new THREE.MeshStandardMaterial({color:0xa6a48e,roughness:1}));
    ground.position.set(180,0,-.32); ground.receiveShadow=true; this.root.add(ground);
    const paving=new THREE.Group(); this.root.add(paving);
    for(const y of [-31,31]) {
      const slab=new THREE.Mesh(new THREE.PlaneGeometry(360,34),new THREE.MeshStandardMaterial({color:0xeaf0f0,roughness:1,transparent:true,opacity:.81}));
      slab.position.set(180,y,0); slab.receiveShadow=true; paving.add(slab);
      for(const edge of [-17,17]) this.box(paving,[360,.32,.18],[180,y+edge,.12],0x9caaa7);
      for(let x=0;x<=360;x+=60) this.box(paving,[.18,34,.08],[x,y,.06],0xb7c3c0);
    }
    for(const y of [-52,0,52]) {
      this.box(paving,[366,5,.1],[180,y,-.03],0x9a9b8d);
      for(const edge of [-1.65,1.65]) this.box(paving,[364,.28,.34],[180,y+edge,.2],0x566265,.7);
      for(let x=0;x<=360;x+=7) this.box(paving,[.45,4.8,.2],[x,y,.03],0x747971);
    }
    for(let x=0;x<=360;x+=30) {
      const tick=textSprite(`${x} m`,11,"#3e5251","#f1f5f2cc"); tick.position.set(x,-60,.3); this.labels.add(tick);
      const line=this.rod(this.gridLines,[x,-54,.2],[x,54,.2],.06,0x9aa99e); line.castShadow=false;
    }
    const upper=textSprite("PARC NORD  /  BRUT",44,"#2b5555");upper.position.set(58,58,.5);this.labels.add(upper);
    const lower=textSprite("PARC SUD  /  LAVÉ",44,"#2b5555");lower.position.set(58,-69,.5);this.labels.add(lower);
    const origin=textSprite("0  ·  REPÈRE DU PARC",30,"#446566");origin.position.set(-22,0,1);this.labels.add(origin);
  }
  private buildMachine(frame: Frame) {
    dispose(this.machine); this.machine.clear();
    this.machine.userData.kind="machine";
    const red=0xbc342f,dark=0x374146;
    for(const x of [-4.3,4.3]) for(const y of [-1.65,1.65]) {
      this.box(this.machine,[3.1,1.0,1.0],[x,y,1],dark);
      for(const dx of [-.95,.95]) {
        const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.64,.64,.55,12),new THREE.MeshStandardMaterial({color:0x2d393d,metalness:.8,roughness:.55}));
        wheel.position.set(x+dx,y,.7); this.machine.add(wheel);
      }
      this.rod(this.machine,[x,y,1.4],[x*.65,y*.72,4.4],.42,red);
    }
    this.box(this.machine,[10,5.5,.7],[0,0,4.5],red);
    this.box(this.machine,[7.6,2.3,1.35],[0,0,5.25],red);
    for(const y of [-2.5,2.5]) {
      this.rod(this.machine,[-4.8,y,5.15],[4.8,y,5.15],.09,0xddb567);
      this.rod(this.machine,[-4.8,y,6.1],[4.8,y,6.1],.07,0xddb567);
      for(const x of [-4.8,-2.4,0,2.4,4.8]) this.rod(this.machine,[x,y,5],[x,y,6.1],.07,0xddb567);
    }
    const turntable=new THREE.Mesh(new THREE.CylinderGeometry(2.1,2.4,.8,20),new THREE.MeshStandardMaterial({color:dark,metalness:.65,roughness:.6}));
    turntable.rotation.x=Math.PI/2;turntable.position.z=6.05;this.machine.add(turntable);
    this.slew=new THREE.Group();this.slew.position.z=frame.machine_rig.pivot_height_m;this.machine.add(this.slew);
    this.box(this.slew,[3,3,3],[0,0,-1.5],red);
    this.box(this.slew,[2.5,2.9,2.2],[-.5,-2.6,-1],0xdddad0);
    this.box(this.slew,[2.1,.07,1.25],[-.5,-4.09,-.7],0x376474);
    for(const y of [-.95,.95]) this.rod(this.slew,[-.9,y,0],[0,y,6.4],.15,red);
    this.rod(this.slew,[0,-.95,6.4],[0,.95,6.4],.16,red);
    this.luff=new THREE.Group();this.slew.add(this.luff);
    const length=frame.machine_rig.boom_length_m;
    for(const y of [-.9,.9]) {
      for(const z of [-.6,.9]) this.rod(this.luff,[-10,y,z],[length,y,z],.12,red);
      for(let x=-10;x<length;x+=3) {
        this.rod(this.luff,[x,y,-.6],[Math.min(x+3,length),y,.9],.075,dark);
        this.rod(this.luff,[x,y,.9],[Math.min(x+3,length),y,-.6],.075,dark);
      }
    }
    this.box(this.luff,[length+10,1.35,.16],[(length-10)/2,0,.22],dark);
    this.box(this.luff,[4.3,3.1,2.2],[-9,0,-1.4],0x747a76);
    for(const y of [-.6,.6]) this.rod(this.luff,[1,y,5.6],[length-2,y,1.0],.045,dark);
    this.scannerMount=new THREE.Group();this.mountRoll=new THREE.Group();this.mountPitch=new THREE.Group();this.mountYaw=new THREE.Group();
    this.luff.add(this.scannerMount);this.scannerMount.add(this.mountRoll);this.mountRoll.add(this.mountPitch);this.mountPitch.add(this.mountYaw);
    this.scannerVisual=new THREE.Group();this.scannerVisual.userData.kind="scanner";this.mountYaw.add(this.scannerVisual);
    this.box(this.scannerVisual,[1.2,1.35,1.2],[0,0,0],0x09a9ac);
    this.box(this.scannerVisual,[1.25,.18,.44],[0,-.71,0],0xb6f6ed);
    const hitArea=new THREE.Mesh(new THREE.SphereGeometry(2.2,8,8),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));
    this.scannerVisual.add(hitArea);
    // Recreate materials after the previous model was disposed.
    this.fan=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:0x16b5ba,transparent:true,opacity:.12,side:THREE.DoubleSide,depthWrite:false}));
    this.beam=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x36fff1}));
    this.scannerVisual.add(this.fan,this.beam);this.fanSignature="";
    const label=textSprite("STK-001",19,"#b72a28","#ffffffdc");label.position.set(0,0,17);this.machine.add(label);
  }
  setFrame(frame: Frame) {
    const previousFrame=this.frame;this.frame=frame;
    if(this.instance!==frame.instance || this.lastMode!==frame.mode) {
      this.pointCount=0;this.pointCursor=0;this.lastScanKey="";this.points.geometry.setDrawRange(0,0);
      this.instance=frame.instance;this.lastMode=frame.mode;
    }
    const signature=`${frame.machine_rig.boom_length_m}:${frame.machine_rig.pivot_height_m}`;
    if(signature!==this.geometrySignature) {this.buildMachine(frame);this.geometrySignature=signature;}
    const target=[frame.machine.travel_m,rad(frame.machine.slew_deg),rad(-frame.machine.luff_deg)];
    if(previousFrame && previousFrame.instance===frame.instance && previousFrame.mode===frame.mode && frame.mode==="LIVE"){
      if(previousFrame.machine.sequence!==frame.machine.sequence){
        this.poseTween={at:performance.now()*.001,from:[this.machine.position.x,this.slew.rotation.z,this.luff.rotation.y],to:target};
      }
    }else{
      this.poseTween=null;this.machine.position.set(target[0],0,0);this.slew.rotation.z=target[1];this.luff.rotation.y=target[2];
    }
    const cfg=frame.scanner_mount;
    this.scannerMount.position.set(frame.machine_rig.boom_length_m+cfg.mount_x_m,cfg.mount_y_m,cfg.mount_z_m);
    this.mountRoll.rotation.x=rad(cfg.mount_roll_deg);this.mountPitch.rotation.y=rad(cfg.mount_pitch_deg);this.mountYaw.rotation.z=rad(cfg.mount_yaw_deg);
    this.scannerVisual.visible=this.layers.scanner;
    const fanSignature=String(cfg.fov_deg);
    if(fanSignature!==this.fanSignature) {
      const positions=[0,0,0],indices:number[]=[];
      for(let i=0;i<=24;i++){const a=rad(-cfg.fov_deg/2+cfg.fov_deg*i/24);positions.push(Math.sin(a)*21,0,-Math.cos(a)*21);if(i<24)indices.push(0,i+1,i+2);}
      this.fan.geometry.dispose();this.fan.geometry=new THREE.BufferGeometry();
      this.fan.geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));this.fan.geometry.setIndex(indices);this.fanSignature=fanSignature;
    }
    this.fan.visible=frame.scanner.enabled;this.beam.visible=frame.scanner.acquiring && frame.mode==="LIVE" && frame.communication.online;
    if(frame.grid && frame.grid!==this.currentGrid){
      const animate=!!previousFrame && previousFrame.instance===frame.instance &&
        previousFrame.mode===frame.mode && frame.mode==="LIVE" && frame.running && frame.communication.online;
      this.updateSurface(frame.grid,frame,animate);this.currentGrid=frame.grid;
    }
    // Stops, disconnections and replay show the last authoritative shape exactly.
    if(!frame.running || frame.mode!=="LIVE" || !frame.communication.online) this.settleSurface();
    if(frame.measured_heights_m && frame.grid){
      const positions:number[]=[];
      frame.measured_heights_m.forEach((h,i)=>{if(h!==null)positions.push(frame.grid!.x0+(i%frame.grid!.nx+.5)*frame.grid!.cell_m,frame.grid!.y0+(Math.floor(i/frame.grid!.nx)+.5)*frame.grid!.cell_m,h+.12);});
      this.observed.geometry.dispose();this.observed.geometry=new THREE.BufferGeometry();this.observed.geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    }
    const scanKey=`${frame.scanner.record_id}:${JSON.stringify(frame.scanner.points)}`;
    if(scanKey!==this.lastScanKey && frame.scanner.points.length){
      if(frame.mode==="HISTORICAL"){this.pointCursor=0;this.pointCount=0;}
      for(const point of frame.scanner.points){this.pointPositions.set([point[0],point[1],point[2]+.12],this.pointCursor*3);this.pointCursor=(this.pointCursor+1)%20000;this.pointCount=Math.min(20000,this.pointCount+1);}
      this.points.geometry.attributes.position.needsUpdate=true;this.points.geometry.setDrawRange(0,this.pointCount);this.lastScanKey=scanKey;
    }
    (this.stream.material as THREE.PointsMaterial).color.set(frame.active_product.color);
    this.stream.visible=frame.running && frame.config.machine.flow_t_h>0 && frame.mode==="LIVE" && this.layers.machine && frame.communication.online;
  }
  private updateSurface(grid: Grid, frame: Frame, animate: boolean) {
    const signature=`${grid.nx}:${grid.ny}:${grid.cell_m}:${grid.x0}:${grid.y0}`;
    const sameLayout=signature===this.surfaceSignature;
    const previous=this.surface.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const from=sameLayout && previous ? Float32Array.from({length:previous.count},(_,i)=>
      Math.max(0,previous.getZ(i)-SURFACE_OFFSET_M)) : undefined;
    const data=buildStockpileSurface(grid,animate?from:undefined);
    const palette=frame.config.products.map(p=>new THREE.Color(p.color));
    const neutral=new THREE.Color(0xb9c7c1),colors=new Float32Array(data.positions.length);
    for(let i=0;i<data.heights.length;i++){
      const color=palette[data.productIndices[i]]??neutral;
      colors.set([color.r,color.g,color.b],i*3);
    }
    let geometry=this.surface.geometry;
    if(!sameLayout || previous?.count!==data.heights.length){
      geometry.dispose();geometry=new THREE.BufferGeometry();this.surface.geometry=geometry;
      geometry.setAttribute("position",new THREE.BufferAttribute(data.positions,3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute("color",new THREE.BufferAttribute(colors,3).setUsage(THREE.DynamicDrawUsage));
      // Allocate maximum topology once; subsequent acquisitions update in place.
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(data.maxIndexCount),1).setUsage(THREE.DynamicDrawUsage));
    }else{
      (geometry.attributes.color as THREE.BufferAttribute).array.set(colors);geometry.attributes.color.needsUpdate=true;
    }
    const index=geometry.getIndex()!;
    if ((index.array as Uint32Array).length < data.indices.length) {
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(data.maxIndexCount),1).setUsage(THREE.DynamicDrawUsage));
    }
    const indexArray=(geometry.getIndex()!.array as Uint32Array);
    indexArray.fill(0);indexArray.set(data.indices);
    geometry.getIndex()!.needsUpdate=true;geometry.setDrawRange(0,data.indices.length);
    this.surfaceSignature=signature;this.surfaceTargets=data.heights;
    const source=animate && from?.length===data.heights.length ? from : data.heights;
    const positions=geometry.attributes.position as THREE.BufferAttribute;
    writeInterpolatedHeights(positions.array as Float32Array,source,data.heights,0);
    this.surfaceTween=animate ? {at:performance.now()*.001,from:source,to:data.heights} : null;
    this.refreshSurface();
  }
  private refreshSurface() {
    const geometry=this.surface.geometry;
    geometry.attributes.position.needsUpdate=true;
    geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
    // Diagnostic reflects the actual vertex buffer, not a parallel CSS animation.
    const peak=Math.max(0,(geometry.boundingBox?.max.z??SURFACE_OFFSET_M)-SURFACE_OFFSET_M);
    this.renderer.domElement.dataset.stockpilePeakM=String(peak<1e-6?0:peak);
  }
  private animateSurface(time: number) {
    const tween=this.surfaceTween;if(!tween)return;
    const t=Math.min(1,Math.max(0,(time-tween.at)/.28));
    const positions=this.surface.geometry.attributes.position as THREE.BufferAttribute;
    writeInterpolatedHeights(positions.array as Float32Array,tween.from,tween.to,t);
    this.refreshSurface();if(t===1)this.surfaceTween=null;
  }
  private settleSurface() {
    if(!this.surfaceTween || !this.surfaceTargets)return;
    const positions=this.surface.geometry.attributes.position as THREE.BufferAttribute;
    writeInterpolatedHeights(positions.array as Float32Array,this.surfaceTargets,this.surfaceTargets,1);
    this.surfaceTween=null;this.refreshSurface();
  }
  focusPile() {
    const grid=this.currentGrid;if(!grid || this.mode!=="3d")return;
    let peak=-1;
    for(let i=0;i<grid.heights_m.length;i++)if(grid.heights_m[i]>0 && (peak<0 || grid.heights_m[i]>grid.heights_m[peak]))peak=i;
    if(peak<0)return;
    const x=grid.x0+(peak%grid.nx+.5)*grid.cell_m;
    const y=grid.y0+(Math.floor(peak/grid.nx)+.5)*grid.cell_m,h=grid.heights_m[peak];
    // View the true metre-scale relief at a lower angle; never scale the stock.
    this.controls.target.set(x,h*.35,-y);
    this.perspective.position.set(x+43,Math.max(22,h+17),-y+55);
    this.controls.update();
  }
  private animateSource(time: number) {
    const frame=this.frame;if(!frame)return;
    if(this.poseTween){
      const t=Math.min(1,Math.max(0,(time-this.poseTween.at)/.18));
      const {from,to}=this.poseTween;
      this.machine.position.x=THREE.MathUtils.lerp(from[0],to[0],t);
      this.slew.rotation.z=THREE.MathUtils.lerp(from[1],to[1],t);
      this.luff.rotation.y=THREE.MathUtils.lerp(from[2],to[2],t);
      if(t===1)this.poseTween=null;
    }
    const angle=rad(Math.sin(time*2.4)*frame.scanner_mount.fov_deg/2);
    const beamPositions=new Float32Array([0,0,0,Math.sin(angle)*21,0,-Math.cos(angle)*21]);
    const attr=this.beam.geometry.getAttribute("position");
    if(attr){(attr as THREE.BufferAttribute).array.set(beamPositions);attr.needsUpdate=true;}
    else this.beam.geometry.setAttribute("position",new THREE.BufferAttribute(beamPositions,3));
    if(this.stream.visible){
      const pos=this.stream.geometry.attributes.position as THREE.BufferAttribute;
      // Cosmetic flow follows the interpolated boom; inventory uses Python's acquired pose.
      const tip=this.root.worldToLocal(this.luff.localToWorld(new THREE.Vector3(frame.machine_rig.boom_length_m,0,0)));
      const {x,y,z}=tip;
      let floor=0;
      if(this.currentGrid && this.surface.geometry.getAttribute("position")){
        floor=sampleStockpileHeight(this.currentGrid,(this.surface.geometry.attributes.position as THREE.BufferAttribute).array,x,y);
      }
      // No reverse/upward falling particles when a demo pile exceeds the chute.
      floor=Math.min(z,Math.max(0,floor));
      for(let i=0;i<60;i++){
        const t=(time*1.1+i/60)%1;
        pos.setXYZ(i,x+Math.sin(i*2.4)*.45*t,y+Math.cos(i*3.7)*.45*t,z-(z-floor)*t);
      }pos.needsUpdate=true;
    }
  }
  setLayers(layers: Layers) {
    this.layers=layers;this.map.visible=layers.map;this.surface.visible=layers.piles;this.machine.visible=layers.machine;
    this.scannerVisual.visible=layers.scanner;this.points.visible=layers.points;this.observed.visible=layers.measured;
    this.gridLines.visible=layers.grid;this.labels.visible=layers.labels;
  }
  setMode(mode: Mode) {
    if(this.mode===mode)return;this.mode=mode;this.controls.dispose();
    this.camera=mode==="2d"?this.top:this.perspective;this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.configureControls();this.center();this.resize();
  }
  setTool(tool: SelectionTool, scope: LaneScope) {
    this.tool=tool;this.scope=scope;this.configureControls();
    this.renderer.domElement.style.cursor=this.mode==="2d"&&tool!=="navigate"?"crosshair":"grab";
  }
  center() {
    if(this.mode==="2d"){
      this.top.position.set(180,600,0);this.top.up.set(0,0,-1);this.top.zoom=1;this.top.lookAt(180,0,0);this.top.updateProjectionMatrix();
    }else{this.perspective.position.set(210,205,245);this.perspective.up.set(0,1,0);}
    this.controls.target.set(180,0,0);this.controls.update();
  }
  private resize(){
    const width=Math.max(1,this.mount.clientWidth),height=Math.max(1,this.mount.clientHeight),aspect=width/height;
    this.renderer.setSize(width,height,false);this.perspective.aspect=aspect;this.perspective.updateProjectionMatrix();
    const span=Math.max(156,415/aspect);this.top.left=-span*aspect/2;this.top.right=span*aspect/2;this.top.top=span/2;this.top.bottom=-span/2;this.top.updateProjectionMatrix();
  }
  selectArea(area: Area | null) {
    this.area=area;dispose(this.selection);this.selection.clear();if(!area)return;
    const {x0,x1,y0,y1}=area;
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(x1-x0,y1-y0),new THREE.MeshBasicMaterial({color:0xf3ce3c,transparent:true,opacity:.16,depthWrite:false,side:THREE.DoubleSide}));
    plane.position.set((x0+x1)/2,(y0+y1)/2,22);plane.renderOrder=4;this.selection.add(plane);
    const border=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0,y0,22.1),new THREE.Vector3(x1,y0,22.1),new THREE.Vector3(x1,y1,22.1),new THREE.Vector3(x0,y1,22.1)]),new THREE.LineBasicMaterial({color:0xe6b829,depthTest:false}));
    border.renderOrder=5;this.selection.add(border);
    for(const [x,sign]of [[x0,1],[x1,-1]]){
      const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.Float32BufferAttribute([x,(y0+y1)/2,22.2,x-sign*5,(y0+y1)/2-6,22.2,x-sign*5,(y0+y1)/2+6,22.2],3));
      this.selection.add(new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0xe7c139,side:THREE.DoubleSide,depthTest:false})));
      const label=textSprite(`${x.toLocaleString("fr-FR",{maximumFractionDigits:1})} m`,18,"#243538","#fff6caff");label.position.set(x,y0-4,23);this.selection.add(label);
    }
  }
  setMap(manifest: MapManifest, base: string){
    const gen=++this.generation;dispose(this.map);this.map.clear();let loaded=0,failed=0;
    this.onMapStatus(0,manifest.tiles.length,0);
    const loader=new THREE.TextureLoader();loader.setCrossOrigin("anonymous");
    for(const tile of manifest.tiles){
      loader.load(`${base}/api/map/tiles/${tile.z}/${tile.x}/${tile.y}`,texture=>{
        if(this.disposed||this.generation!==gen){texture.dispose();return;}
        texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
        const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.Float32BufferAttribute(tile.corners.flatMap(p=>[p[0],p[1],-.23]),3));
        geo.setAttribute("uv",new THREE.Float32BufferAttribute([0,1,1,1,1,0,0,0],2));geo.setIndex([0,3,1,1,3,2]);geo.computeVertexNormals();
        const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));this.map.add(mesh);loaded++;this.onMapStatus(loaded,manifest.tiles.length,failed);
      },undefined,()=>{if(!this.disposed&&this.generation===gen){failed++;this.onMapStatus(loaded,manifest.tiles.length,failed);}});
    }
  }
  private yardPoint(event: PointerEvent){
    const rect=this.renderer.domElement.getBoundingClientRect();
    const mouse=new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    const ray=new THREE.Raycaster();ray.setFromCamera(mouse,this.camera);
    const point=new THREE.Vector3();if(!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),point))return null;
    return {x:THREE.MathUtils.clamp(point.x,0,360),y:THREE.MathUtils.clamp(-point.z,-54,54),ray};
  }
  private areaFromDrag(x: number,y: number): Area | null {
    if(!this.drag)return null;
    let y0=-54,y1=54;
    if(this.scope==="north"){y0=14;y1=48;}if(this.scope==="south"){y0=-48;y1=-14;}
    if(this.tool==="rectangle"){y0=Math.min(this.drag.y,y);y1=Math.max(this.drag.y,y);}
    const x0=Math.min(this.drag.x,x),x1=Math.max(this.drag.x,x);
    return x1-x0<.2||y1-y0<.2?null:{x0:Math.round(x0*10)/10,x1:Math.round(x1*10)/10,y0:Math.round(y0*10)/10,y1:Math.round(y1*10)/10};
  }
  private pointerDown=(event: PointerEvent)=>{
    this.pointerOrigin={x:event.clientX,y:event.clientY};
    if(event.button!==0||this.mode!=="2d"||this.tool==="navigate")return;
    const p=this.yardPoint(event);if(!p)return;
    this.drag={x:p.x,y:p.y,screenX:event.clientX,screenY:event.clientY};this.renderer.domElement.setPointerCapture(event.pointerId);event.preventDefault();
  };
  private pointerMove=(event: PointerEvent)=>{if(this.drag){const p=this.yardPoint(event);const area=p?this.areaFromDrag(p.x,p.y):null;if(area)this.selectArea(area);}};
  private pointerUp=(event: PointerEvent)=>{
    if(this.drag){
      const p=this.yardPoint(event),area=p?this.areaFromDrag(p.x,p.y):null;
      this.drag=null;if(this.renderer.domElement.hasPointerCapture(event.pointerId))this.renderer.domElement.releasePointerCapture(event.pointerId);
      if(area){this.selectArea(area);this.onArea(area);}return;
    }
    if(!this.pointerOrigin||Math.hypot(event.clientX-this.pointerOrigin.x,event.clientY-this.pointerOrigin.y)>5)return;
    const p=this.yardPoint(event);if(!p)return;
    const hits=p.ray.intersectObjects([this.machine,this.surface],true);
    for(const hit of hits){
      let object:THREE.Object3D|null=hit.object;
      while(object&&!object.userData.kind)object=object.parent;
      let ancestor:THREE.Object3D|null=hit.object, visible=true;
      while(ancestor){if(!ancestor.visible){visible=false;break;}ancestor=ancestor.parent;}
      if(!object||!visible)continue;
      const kind=object.userData.kind as Picked;this.onPick(kind);
      if(kind==="pile"){
        const world=this.root.worldToLocal(hit.point.clone());
        const x0=Math.max(0,world.x-30),x1=Math.min(360,world.x+30);
        const area={x0:Math.round(x0*10)/10,x1:Math.round(x1*10)/10,y0:world.y<0?-48:14,y1:world.y<0?-14:48};
        this.onArea(area);this.selectArea(area);
      }break;
    }
  };
  private pointerCancel=()=>{this.drag=null;this.pointerOrigin=null;};
  destroy(){
    this.disposed=true;cancelAnimationFrame(this.raf);this.resizeObserver.disconnect();this.controls.dispose();
    this.renderer.domElement.removeEventListener("pointerdown",this.pointerDown);this.renderer.domElement.removeEventListener("pointermove",this.pointerMove);
    this.renderer.domElement.removeEventListener("pointerup",this.pointerUp);this.renderer.domElement.removeEventListener("pointercancel",this.pointerCancel);
    dispose(this.scene);this.renderer.dispose();this.renderer.domElement.remove();
  }
}
