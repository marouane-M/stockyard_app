export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({
    apiUrl: process.env.PUBLIC_API_URL ?? "",
    apiPort: process.env.PUBLIC_API_PORT ?? "8000",
  }, { headers: { "Cache-Control": "no-store" } });
}
