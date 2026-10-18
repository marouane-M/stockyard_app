import { expect, test } from "@playwright/test";
const backend = process.env.E2E_API_URL || "http://localhost:8000";

test("le tas monte réellement dans le maillage, puis reste figé à l'arrêt", async ({ page, request }) => {
  const initial = await (await request.get(backend+"/api/config")).json();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await request.post(backend+"/api/control", {data:{action:"empty",confirm:true}});
    const configuration = await request.patch(backend+"/api/config", {data:{
      machine:{...initial.machine,travel_min_m:120,travel_max_m:144,speed_m_s:.02,
        time_scale:300,flow_t_h:1800,auto_products:false,alternate_lanes:false,
        oscillation_deg:0,deposition_profile:"mound",repose_angle_deg:34},
      operator:"Recette automatique",reason:"Vérification du relief après un aller-retour"}});
    expect(configuration.ok()).toBeTruthy();
    await page.goto("/");
    const canvas=page.getByTestId("yard-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId("start-machine")).toBeEnabled();
    await expect(canvas).toHaveAttribute("data-stockpile-peak-m", /^0(?:\.0+)?$/);
    await page.getByTestId("start-machine").click();
    await expect.poll(async()=>Number(await canvas.getAttribute("data-stockpile-peak-m"))).toBeGreaterThan(1);
    const early=await (await request.get(backend+"/api/snapshot")).json();
    await expect.poll(async()=> (await (await request.get(backend+"/api/snapshot")).json()).sequence).toBeGreaterThan(65);
    await page.getByTestId("stop-machine").click();
    const final=await (await request.get(backend+"/api/snapshot")).json();
    expect(final.totals.max_height_m).toBeGreaterThan(early.totals.max_height_m);
    await expect.poll(async()=>Math.abs(Number(await canvas.getAttribute("data-stockpile-peak-m"))-
      Math.max(...final.grid.heights_m))).toBeLessThan(.001);
    await expect(page.getByTestId("stockpile-height")).toContainText("Hauteur max.");
    await page.getByRole("button",{name:"Voir le relief",exact:true}).click();
    await page.waitForTimeout(500);
    await page.screenshot({path:test.info().outputPath("relief-3d.png"),fullPage:true});
    const held=await canvas.getAttribute("data-stockpile-peak-m");
    await page.waitForTimeout(600);
    expect(await canvas.getAttribute("data-stockpile-peak-m")).toBe(held);
    await page.getByRole("button",{name:"Vue 2D",exact:true}).last().click();
    await expect(page.getByTestId("stockpile-height")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    // Isolated acceptance instance only: restore settings for the existing suite.
    await request.post(backend+"/api/control", {data:{action:"stop"}});
    await request.post(backend+"/api/control", {data:{action:"empty",confirm:true}});
    await request.patch(backend+"/api/config", {data:{machine:initial.machine,
      operator:"Recette automatique",reason:"Restauration des réglages après recette"}});
  }
});
