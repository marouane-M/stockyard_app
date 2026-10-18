"use client";
import dynamic from "next/dynamic";
const StockyardApp = dynamic(() => import("@/components/StockyardApp"), {
  ssr: false,
  loading: () => <main className="boot"><span className="boot-mark">P</span><h1>Ouverture du parc</h1><p>Chargement de la supervision…</p></main>,
});
export default function Page() { return <StockyardApp />; }
