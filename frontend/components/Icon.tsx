import type { CSSProperties } from "react";
const paths: Record<string,string> = {
  layers:"m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  cube:"m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 10 9-5M12 13 3 8m9 5v8m-4-15 9 5",
  map:"m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15",
  scanner:"M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4m2-4h12m-9-4 3-2 3 2m-6 8 3 2 3-2",
  machine:"M3 18h12v3H3v-3Zm4 0V9h4v9m-7-4 13-9m-7 4 11 5M9 3v6m-3-6h6m-7 18v1m8-1v1m5-17 3-1",
  select:"M5 8V5h3m8 0h3v3m0 8v3h-3m-8 0H5v-3M3 12h18M12 3v18",
  play:"m8 5 11 7-11 7V5Z",
  pause:"M8 5v14m8-14v14",
  stop:"M6 6h12v12H6V6Z",
  reset:"M3 10a9 9 0 1 1 2 8M3 4v6h6",
  settings:"M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-2-5h4l1 3 3 1 3-1 2 4-2 2 1 3-2 3-3-1-2 2-1 3h-4l-1-3-3-1-3 1-2-4 2-2-1-3 2-3 3 1 2-2 1-3Z",
  download:"M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  chevron:"m9 5 7 7-7 7",
  chevronDown:"m5 9 7 7 7-7",
  close:"m6 6 12 12M18 6 6 18",
  check:"m5 12 4 4L19 6",
  info:"M12 11v6m0-10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  warning:"m12 3 10 18H2L12 3Zm0 6v5m0 3h.01",
  clock:"M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  table:"M3 4h18v16H3V4Zm0 5h18M3 14h18M9 4v16",
  network:"M8 3h8v5H8V3Zm4 5v5M4 17v-4h16v4M1 17h6v4H1v-4Zm8 0h6v4H9v-4Zm8 0h6v4h-6v-4Z",
  center:"M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h8m-4-4v8",
  arrow:"M4 12h16m-6-6 6 6-6 6",
  plus:"M12 5v14M5 12h14",
  save:"M5 4h12l2 2v14H5V4Zm3 0v6h8V4M8 20v-6h8v6",
  copy:"M8 8h12v12H8V8Zm-4 8H3V3h13v1",
  chart:"M4 3v18h17M7 15l4-5 4 2 5-7",
  eye:"M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
};
export default function Icon({name,size=18,style}:{name:string;size?:number;style?:CSSProperties}){
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]??paths.cube}/></svg>;
}
