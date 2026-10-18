import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Parc — Inventaire & supervision",
  description: "Jumeau numérique de parc de stockage : simulation, scanner et inventaire spatial.",
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
