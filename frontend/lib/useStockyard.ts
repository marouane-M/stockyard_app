"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Api, connectApi } from "./api";
import type { Area, Frame, MapManifest, Report } from "./types";
export const FULL_AREA: Area = { x0: 0, x1: 360, y0: -54, y1: 54 };
export function useStockyard() {
  const [api, setApi] = useState<Api | null>(null);
  const [live, setLive] = useState<Frame | null>(null);
  const [historical, setHistorical] = useState<Frame | null>(null);
  const [until, setUntil] = useState<number | null>(null);
  const [area, setArea] = useState<Area>(FULL_AREA);
  const [report, setReport] = useState<Report | null>(null);
  const [map, setMap] = useState<MapManifest | null>(null);
  const [connection, setConnection] = useState<"connecting" | "live" | "offline" | "stale">("connecting");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lastMessage = useRef(0);
  const merge = useCallback((frame: Frame) => {
    setLive(old => ({ ...frame, grid: frame.grid ?? old?.grid ?? null,
      measured_heights_m: frame.measured_heights_m ?? old?.measured_heights_m ?? null }));
  }, []);
  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry = 600;
    const run = async () => {
      try {
        const client = await connectApi();
        if (disposed) return;
        setApi(client);
        const [frame, manifest] = await Promise.all([client.get<Frame>("/api/snapshot"), client.get<MapManifest>("/api/map")]);
        if (disposed) return;
        merge(frame); setMap(manifest);
        const open = () => {
          if (disposed) return;
          const address = new URL(client.base+"/ws/live");
          address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
          ws = new WebSocket(address.toString());
          ws.onopen = () => { retry = 600; lastMessage.current = Date.now(); setConnection("live"); };
          ws.onmessage = event => {
            try {
              const frame = JSON.parse(event.data) as Frame;
              if (frame.kind !== "snapshot" || disposed) return;
              lastMessage.current = Date.now(); setConnection("live"); merge(frame);
            } catch { setError("Message temps réel non valide ; la dernière vue est conservée."); }
          };
          ws.onerror = () => ws?.close();
          ws.onclose = () => {
            if (disposed) return;
            setConnection("offline");
            timer = setTimeout(open, retry); retry = Math.min(retry*1.8, 10000);
          };
        };
        open();
      } catch (err) {
        if (disposed) return;
        setError(err instanceof Error ? err.message : "Connexion au serveur impossible.");
        setConnection("offline"); timer = setTimeout(run, 3000);
      }
    };
    void run();
    const watchdog = setInterval(() => {
      if (lastMessage.current && Date.now()-lastMessage.current>3500) setConnection("stale");
    }, 1000);
    return () => { disposed = true; clearTimeout(timer); clearInterval(watchdog); if (ws) { ws.onclose = null; ws.close(); } };
  }, [merge]);
  useEffect(() => {
    if (!api) return;
    let ignore = false;
    let inFlight = false;
    const request = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const r = await api.post<Report>("/api/inventory/selection", { ...area, until_sequence: until });
        if (!ignore) setReport(r);
      } catch (err) { if (!ignore) setError(err instanceof Error ? err.message : "Calcul de sélection indisponible."); }
      finally { inFlight = false; }
    };
    setReport(null);
    void request();
    const timer = setInterval(request, 850);
    return () => { ignore = true; clearInterval(timer); };
  }, [api, area, until]);
  useEffect(() => {
    if (until === null) { setHistorical(null); return; }
    if (!api) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.get<Frame>(`/api/snapshot?until_sequence=${until}`, controller.signal)
        .then(setHistorical).catch(err => { if (err.name !== "AbortError") setError("La relecture n'a pas pu être chargée."); });
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [until, api]);
  const command = async (action: string, confirm = false) => {
    if (!api) return;
    setBusy(true);
    try {
      merge(await api.post<Frame>("/api/control", { action, confirm }));
      if (action === "empty") { setUntil(null); setArea({ ...FULL_AREA }); setHistorical(null); }
    } catch (err) { setError(err instanceof Error ? err.message : "La commande a échoué."); }
    finally { setBusy(false); }
  };
  const refreshMap = async () => { if (api) setMap(await api.get<MapManifest>("/api/map")); };
  return { api, frame: historical ?? live, live, report, area, setArea, until, setUntil,
    map, refreshMap, connection, error, setError, busy, command, merge };
}
