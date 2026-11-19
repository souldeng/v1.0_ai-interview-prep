import { expect, test } from "@playwright/test";

async function openProfile(page: import("@playwright/test").Page) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "简历与经历", exact: true }).click();
}

test("AI 候选经历刷新后仍可继续核对，且不自动成为已确认事实", async ({ page }) => {
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: true, provider: "匿名Mock" } }));
  await page.route("**/api/model/chat", async route => {
    const profile = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-profile-v1")!));
    await route.fulfill({ json: { content: JSON.stringify([{
      title: "匿名需求核对候选", type: "工作", situation: "匿名客户需求", action: "本人访谈并整理需求清单", tools: "访谈提纲", result: "形成需求清单", reflection: "未参与模型研发",
      sourceQuotes: [{ materialId: profile.resumes[0].id, quote: "本人访谈并整理需求清单" }],
    }]) } });
  });

  await page.goto("/");
  await openProfile(page);
  await page.getByRole("button", { name: "上传简历资料", exact: true }).click();
  await page.getByLabel("上传个人资料文件").setInputFiles({ name: "匿名候选来源.txt", mimeType: "text/plain", buffer: Buffer.from("本人访谈并整理需求清单，未参与模型研发。") });
  const source = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名候选来源.txt", exact: true }) });
  await source.getByRole("button", { name: "核对文字", exact: true }).click();
  await source.getByRole("button", { name: "保存核对文字", exact: true }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "AI 提取经历", exact: true }).click();
  await expect(page.getByText("匿名需求核对候选", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-profile-v1")!).experiences)).toEqual([]);

  await page.reload();
  await openProfile(page);
  await expect(page.getByText(/已恢复.*候选/)).toBeVisible();
  await expect(page.getByText("匿名需求核对候选", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-profile-v1")!).experiences)).toEqual([]);
  await page.getByRole("button", { name: "核对经历", exact: true }).click();
  await page.getByLabel("经历标题", { exact: true }).fill("已编辑的匿名需求核对");
  await page.getByRole("button", { name: "保存草稿并返回", exact: true }).click();
  await page.reload(); await openProfile(page);
  await expect(page.getByText("已编辑的匿名需求核对", { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-profile-v1")!));
  expect(saved.experiences).toHaveLength(1);
  expect(saved.experiences[0].confirmed).toBe(false);
  expect(saved.experienceCandidates ?? []).toHaveLength(0);
});
