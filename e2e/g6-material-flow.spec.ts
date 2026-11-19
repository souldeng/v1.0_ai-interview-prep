import { expect, test } from "@playwright/test";

async function openCollection(page: import("@playwright/test").Page) {
  await page.goto("/");
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: /AI 面试题库/ }).first().click();
  await page.getByRole("button", { name: "面试资料收集", exact: true }).click();
}

test("候选整理题可编辑、采纳或不采纳，保存后不重复发送资料", async ({ page }, testInfo) => {
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: true } }));
  let calls = 0;
  await page.route("**/api/model/chat", route => {
    calls++;
    const request = route.request().postDataJSON();
    const payload = JSON.parse(request.messages[1].content);
    if (request.feature === "material_organization") {
      const material = payload.materials[0];
      return route.fulfill({ json: { content: JSON.stringify({ materials: [{ materialId: material.id, type: "knowledge", jobTitle: "", duties: [], requirements: [], skills: [], knowledgePoints: ["RAG"], questions: [{ text: "RAG 如何工作？", origin: "derived", evidenceQuote: "RAG", technical: true }] }] }) } });
    }
    return route.fulfill({ json: { content: JSON.stringify({ commonRequirements: [], topics: [], priorities: [] }) } });
  });

  await openCollection(page);
  await page.getByLabel("粘贴面试资料").fill("知识笔记：RAG 通过检索补充生成上下文。");
  await page.getByRole("button", { name: "添加文字", exact: true }).click();
  await page.getByRole("button", { name: "开始智能整理", exact: true }).click();
  const candidate = page.getByRole("region", { name: "本批整理结果" });
  await expect(candidate.getByRole("heading", { name: "候选练习题", exact: true })).toBeVisible();
  await candidate.getByRole("button", { name: "不采纳", exact: true }).click();
  await expect(candidate).toContainText("题目 0");
  await candidate.getByRole("button", { name: "恢复采纳", exact: true }).click();
  await candidate.getByLabel("编辑候选题目：RAG 如何工作？").fill("如何评估 RAG 检索效果？");
  await candidate.getByRole("button", { name: "确认保存整理结果", exact: true }).click();
  await candidate.getByRole("button", { name: "查看面试题", exact: true }).click();
  await expect(page.getByRole("heading", { name: "如何评估 RAG 检索效果？", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新建收集", exact: true }).click();
  await page.getByRole("button", { name: "开始智能整理", exact: true }).click();
  expect(calls).toBe(2);

  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 960 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`g6-collection-${width}.png`), fullPage: true });
  }
});
