import { expect, test } from "@playwright/test";
const backend = process.env.E2E_API_URL || "http://localhost:8000";
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ request }) => {
  const response = await request.post(backend+"/api/control", { data: { action: "empty", confirm: true } });
  expect(response.ok()).toBeTruthy();
});

test("parc vide → dépôt → arrêt → intervalle → export et correction", async ({ page, request }) => {
  const failures: string[] = [];
  page.on("pageerror", err => failures.push(err.message));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("heading", { name: "Inventaire du parc", exact: true })).toBeVisible();
  await expect(page.getByTestId("yard-canvas")).toBeVisible();
  await expect(page.getByTestId("start-machine")).toBeEnabled();
  await page.getByTestId("start-machine").click();
  await expect.poll(async () => (await (await request.get(backend+"/api/snapshot")).json()).sequence).toBeGreaterThan(25);
  await page.getByTestId("stop-machine").click();
  await expect(page.getByTestId("start-machine")).toBeEnabled();
  const stopped = await (await request.get(backend+"/api/snapshot")).json();
  await page.waitForTimeout(450);
  expect((await (await request.get(backend+"/api/snapshot")).json()).sequence).toBe(stopped.sequence);
  await page.getByRole("button", { name: "Vue 2D", exact: true }).last().click();
  await page.getByRole("spinbutton", { name: "Début de l'intervalle" }).fill("31.3");
  await page.getByRole("spinbutton", { name: "Fin de l'intervalle" }).fill("70.7");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(page.getByTestId("selection-tonnage")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter CSV" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("inventaire-selection.csv");
  await page.getByRole("button", { name: "Données du scanner", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Données du scanner" })).toBeVisible();
  await page.getByRole("spinbutton", { name: "Distance rayon 0", exact: true }).fill("");
  await page.getByRole("spinbutton", { name: "Qualité rayon 0", exact: true }).fill("0");
  await page.getByPlaceholder("Ex. Rejet d'un retour parasite identifié").fill("Rejet volontaire de recette automatisée");
  await page.getByRole("button", { name: "Appliquer la correction" }).click();
  await expect(page.getByText("Correction enregistrée.", { exact: false })).toBeVisible();
  const after = await (await request.get(backend+"/api/snapshot")).json();
  expect(after.totals.total_tonnage_t).toBe(stopped.totals.total_tonnage_t);
  expect(failures).toEqual([]);
});

test("sélection par glisser et retour au direct", async ({ page, request }) => {
  await request.post(backend+"/api/control", { data: { action: "start" } });
  await page.goto("/");
  await expect.poll(async () => (await (await request.get(backend+"/api/snapshot")).json()).sequence).toBeGreaterThan(15);
  await request.post(backend+"/api/control", { data: { action: "stop" } });
  await page.getByRole("button", { name: "Intervalle", exact: true }).click();
  const rect = await page.getByTestId("yard-canvas").boundingBox();
  expect(rect).not.toBeNull();
  await page.mouse.move(rect!.x+rect!.width*.24, rect!.y+rect!.height*.50);
  await page.mouse.down();
  await page.mouse.move(rect!.x+rect!.width*.47, rect!.y+rect!.height*.50, { steps: 18 });
  await page.mouse.up();
  await expect(page.getByRole("heading", { name: "Inventaire de la zone sélectionnée", exact: false })).toBeVisible();
  const slider=page.getByRole("slider", { name: "Relecture des acquisitions" });
  await slider.focus();
  await slider.press("Home");
  for(let i=0;i<3;i++)await slider.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Revenir en direct" })).toBeVisible();
  await expect(page.getByTestId("start-machine")).toHaveCount(0); // selection inspector is active
  await page.getByRole("button", { name: "Revenir en direct" }).click();
  await expect(page.getByRole("button", { name: "DIRECT", exact: true })).toBeVisible();
});
