export type Api = {
  base: string;
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body: unknown, method?: "POST" | "PATCH"): Promise<T>;
  download(path: string, body: unknown, filename: string): Promise<void>;
};
async function requireOk(response: Response) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === "string" ? data.detail : "Le serveur n'a pas pu traiter la demande.");
  }
  return response;
}
export async function connectApi(): Promise<Api> {
  const config = await fetch("/api/runtime", { cache: "no-store" }).then(requireOk).then(r => r.json());
  const url = new URL(window.location.href);
  url.port = String(config.apiPort || "8000"); url.pathname = "/"; url.search = ""; url.hash = "";
  const base = String(config.apiUrl || url.origin).replace(/\/$/, "");
  return {
    base,
    async get<T>(path: string, signal?: AbortSignal): Promise<T> {
      return fetch(base+path, { signal, cache: "no-store" }).then(requireOk).then(r => r.json());
    },
    async post<T>(path: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<T> {
      return fetch(base+path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(requireOk).then(r => r.json());
    },
    async download(path: string, body: unknown, filename: string) {
      const result = await fetch(base+path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(requireOk);
      saveBlob(await result.blob(), filename);
    },
  };
}
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function format(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}
export function clock(value: number | null | undefined): string {
  return value == null ? "—" : new Date(value*1000).toLocaleTimeString("fr-FR", { hour12: false });
}
export function dateTime(value: number | null | undefined): string {
  return value == null ? "—" : new Date(value*1000).toLocaleString("fr-FR", { hour12: false });
}
