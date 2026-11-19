import { expect, test, type Page } from "@playwright/test";
import { libraryArea, openLibraryActions, pickSelectOption } from "./uiActions";

test.setTimeout(90_000);

// 匿名样例：与解析器单元测试同一结构（分类标题 + 连续编号问题 + 面试反馈），
// 仅用于回归验证批量导入流程，不将具体题目写死在解析代码中。
const sampleRecord = [
  "## 面试基本信息",
  "面试时间：某周三下午",
  "",
  "## A. 个人背景与职业选择",
  "1. 请先做一个自我介绍，介绍教育背景与工作经历。",
  "2. 为什么从上一家公司离职？",
  "3. 对未来职业发展有什么规划？",
  "4. 为什么选择到北京发展？",
  "5. 目前面试了多少家公司？",
  "6. 之前有些面试没有通过，你认为原因是什么？",
  "",
  "## B. 工作经历与个人贡献",
  "7. 在之前的项目中主要承担什么角色，负责哪些工作？",
  "",
  "## C. 两个 AI 项目的来源与价值",
  "8. 为什么想到做 Bid-Writer？",
  "9. 为什么想到做 AI 面试通？",
  "10. AI 生成技术对政府科技项目申报工作有什么影响？",
  "11. 如果 AI 生成内容不符合预期，如何解决？",
  "",
  "## D. 面试官反馈",
  "面试官认为候选人可能更适合产品相关工作。",
].join("\n");

const aiPredictionRecord = [
  "岗位方向：匿名 AI 应用岗位",
  "资料来源：匿名 AI 预测题库",
  "题目性质：AI 预测题，仅供练习",
  "",
  "## A. 岗位理解",
  ...Array.from({ length: 12 }, (_, index) => `${index + 1}. 岗位理解预测问题 ${index + 1}？`),
  "",
  "## B. 项目方案",
  ...Array.from({ length: 7 }, (_, index) => `${index + 13}. 项目方案预测问题 ${index + 1}？`),
  "",
  "## C. 技术判断",
  ...Array.from({ length: 11 }, (_, index) => `${index + 20}. 技术判断预测问题 ${index + 1}？`),
  "",
  "## D. 复盘与发展规划",
  ...Array.from({ length: 6 }, (_, index) => `${index + 31}. 复盘与发展规划预测问题 ${index + 1}？`),
  "",
  "## 训练要求",
  "每题先独立回答，再复盘表达；这一段不是面试题。",
].join("\n");

async function openBatchImport(page: Page) {
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: false } }));
  await page.goto("/");
  const menu = page.getByRole("button", { name: "打开导航" }); if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: /AI 面试题库/ }).first().click();
  await libraryArea(page, "recorded");
  await page.getByRole("button", { name: "批量导入题目", exact: true }).click();
}

let modelCalls = 0;
test.beforeEach(() => { modelCalls = 0; });

test("整份面经批量导入：解析11题、分类与反馈正确、人工勾选后保存为独立题目", async ({ page }, info) => {
  await page.route("**/api/model/chat", route => { modelCalls += 1; return route.fulfill({ json: { content: "{}" } }); });
  await openBatchImport(page);
  await page.getByRole("textbox", { name: "粘贴题目原文" }).fill(sampleRecord);
  await page.getByRole("button", { name: "解析并预览候选题目" }).click();
  await expect(page.getByText(/候选题目 11 道/)).toBeVisible();
  await expect(page.getByText(/面试反馈 1 段/)).toBeVisible();
  // 分类标签出现在预览中，Markdown 标记不进入候选题干（粘贴原文允许保留原样）。
  await expect(page.getByText("A. 个人背景与职业选择").first()).toBeVisible();
  const editors = page.getByRole("textbox", { name: /编辑第\d+题/ });
  await expect(editors).toHaveCount(11);
  for (const editor of await editors.all()) expect(await editor.inputValue()).not.toMatch(/##|\*\*/);
  await page.screenshot({ path: info.outputPath("batch-preview.png"), fullPage: true });
  await page.getByRole("button", { name: "确认保存所选题目" }).click();
  await expect(page.getByText(/已保存 11 道独立题目/)).toBeVisible();
  expect(modelCalls).toBe(0);
  // 保存后进入题库，题目逐条可见且来源语义正确。
  await expect(page.getByText("本人记录的真实面试问题").first()).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!));
  expect(saved.recordedQuestions).toHaveLength(11);
  expect(saved.recordedQuestions.every((item: any) => item.question.length <= 600 && !/##|\*\*/.test(item.question))).toBe(true);
  expect(saved.importSources).toHaveLength(1);
  expect(saved.recordedQuestions.filter((item: any) => item.category?.includes("个人背景")).length).toBe(6);
  // 刷新后题库数据正常恢复。
  await page.reload();
  const menu2 = page.getByRole("button", { name: "打开导航" }); if (await menu2.isVisible()) await menu2.click();
  await page.getByRole("button", { name: /AI 面试题库/ }).first().click();
  await libraryArea(page, "recorded");
  await expect(page.getByText(/已选/)).toHaveCount(0);
  const saved2 = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!));
  expect(saved2.recordedQuestions).toHaveLength(11);
});

test("AI 预测题批量导入：四类36题保持顺序和来源，可进入多题训练且不调用模型", async ({ page }, info) => {
  await page.route("**/api/model/chat", route => { modelCalls += 1; return route.fulfill({ json: { content: "{}" } }); });
  await openBatchImport(page);
  await page.getByLabel("AI 预测题").check();
  await page.getByRole("textbox", { name: "粘贴题目原文" }).fill(aiPredictionRecord);
  await page.getByRole("button", { name: "解析并预览候选题目" }).click();
  await expect(page.getByText(/候选题目 36 道/)).toBeVisible();
  await expect(page.getByText("D. 复盘与发展规划").first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: /编辑第\d+题/ })).toHaveCount(36);
  await page.screenshot({ path: info.outputPath("ai-prediction-preview.png"), fullPage: true });
  await page.getByRole("button", { name: "确认保存所选题目" }).click();
  await expect(page.getByText(/已保存 36 道独立题目/)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!));
  expect(saved.importSources).toHaveLength(1);
  expect(saved.importSources[0].sourceType).toBe("ai_prediction");
  expect(saved.recordedQuestions).toHaveLength(36);
  expect(saved.recordedQuestions.every((item: any) => item.sourceType === "ai_prediction")).toBe(true);
  expect(saved.recordedQuestions.map((item: any) => item.order)).toEqual(Array.from({ length: 36 }, (_, index) => index + 1));
  expect(saved.recordedQuestions.slice(0, 12).every((item: any) => item.category === "A. 岗位理解")).toBe(true);
  expect(saved.recordedQuestions.slice(-6).every((item: any) => item.category === "D. 复盘与发展规划")).toBe(true);
  expect(saved.recordedQuestions.some((item: any) => /训练要求|独立回答/.test(item.question))).toBe(false);
  expect(modelCalls).toBe(0);

  const menu = page.getByRole("button", { name: "打开导航" }); if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: /AI 面试题库/ }).first().click();
  await libraryArea(page, "recorded");
  await pickSelectOption(page, "按来源筛选", "AI 预测题");
  await expect(page.getByText("AI 预测题").first()).toBeVisible();
  const boxes = page.getByRole("checkbox", { name: /勾选参加多题训练/ });
  await boxes.nth(0).click(); await boxes.nth(11).click(); await boxes.nth(35).click();
  await page.getByRole("button", { name: "开始多题训练" }).click();
  const dialog = page.getByRole("dialog", { name: "开始新一轮训练" });
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole("button", { name: "暂存并开始新练习", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toBeVisible();
  const training = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-prep-history-v1")!).at(-1));
  expect(training.questions).toHaveLength(3);
  expect(training.questions.every((item: any) => item.sourceType === "ai_prediction")).toBe(true);
  expect(modelCalls).toBe(0);
});

test("批量预览可编辑、取消选择；重复题与超长题有提示，保存失败保留预览可重试", async ({ page }, info) => {
  await openBatchImport(page);
  await page.getByRole("textbox", { name: "粘贴题目原文" }).fill(sampleRecord);
  await page.getByRole("button", { name: "解析并预览候选题目" }).click();
  await expect(page.getByText(/候选题目 11 道/)).toBeVisible();
  // 编辑第 2 题：改成与第 3 题相同 → 重复提示；改回后提示消失。
  const second = page.getByRole("textbox", { name: "编辑第2题" });
  await second.fill("对未来职业发展有什么规划？");
  await expect(page.getByText("与其他候选题重复，请核对")).toHaveCount(2);
  await second.fill("为什么从上一家公司离职？（补充：跨行业转岗的真实原因）");
  await expect(page.getByText("与其他候选题重复，请核对")).toHaveCount(0);
  // 取消勾选第 11 题 → 只保存 10 道。
  await page.getByRole("checkbox", { name: "选择第11题" }).uncheck();
  await page.getByRole("button", { name: "确认保存所选题目" }).click();
  await expect(page.getByText(/已保存 10 道独立题目/)).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!).recordedQuestions.length)).toBe(10);
  await page.screenshot({ path: info.outputPath("batch-edit-save.png"), fullPage: true });
});

test("保存写入失败时提示且预览保留，重试成功；旧题目拆分保留原记录", async ({ page }, info) => {
  await openBatchImport(page);
  await page.getByRole("textbox", { name: "粘贴题目原文" }).fill(sampleRecord);
  await page.getByRole("button", { name: "解析并预览候选题目" }).click();
  await page.evaluate(() => { let fail = true; const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === "ai-interview-question-library-v1" && fail) { fail = false; throw new DOMException("匿名批量写入失败", "QuotaExceededError"); } original.call(this, key, value); }; });
  await page.getByRole("button", { name: "确认保存所选题目" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "匿名批量写入失败" })).toBeVisible();
  await expect(page.getByText(/候选题目 11 道/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("ai-interview-question-library-v1"))).toBeNull();
  await page.getByRole("button", { name: "确认保存所选题目" }).click();
  await expect(page.getByText(/已保存 11 道独立题目/)).toBeVisible();
  // 历史超长题目拆分：从题库详情打开拆分，原题目保留且新题可追溯。
  const longQuestion = [sampleRecord.replace(/^## /gm, "### ")].join("\n");
  await page.evaluate(text => {
    const key = "ai-interview-question-library-v1";
    const state = JSON.parse(localStorage.getItem(key)!);
    state.recordedQuestions.push({ id: "recorded-legacy-long", question: text.slice(0, 600), createdAt: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(state));
  }, longQuestion);
  await page.reload();
  const menu = page.getByRole("button", { name: "打开导航" }); if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: /AI 面试题库/ }).first().click();
  await libraryArea(page, "recorded");
  await page.getByText(/面试基本信息/).first().click();
  await openLibraryActions(page);
  await page.getByRole("menuitem", { name: "拆分为多道题", exact: true }).click();
  await expect(page.getByRole("heading", { name: "把这道历史题目拆分为多道题" })).toBeVisible();
  // 拆分模式自动带入原题全文并完成解析，直接进入候选确认。
  await expect(page.getByText(/候选题目 \d+ 道/)).toBeVisible();
  await page.getByRole("button", { name: "确认保存所选题目" }).click();
  await expect(page.getByText(/已保存 \d+ 道独立题目/)).toBeVisible();
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!));
  expect(state.recordedQuestions.some((item: any) => item.id === "recorded-legacy-long")).toBe(true);
  expect(state.recordedQuestions.filter((item: any) => item.splitFromId === "recorded-legacy-long").length).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("batch-split.png"), fullPage: true });
});

test("重复导入同一面经：预览提示已有导入源与重复题目，人工决定后保存行为可追溯", async ({ page }, info) => {
  await openBatchImport(page);
  await page.getByRole("textbox", { name: "粘贴题目原文" }).fill(sampleRecord);
  await page.getByRole("button", { name: "解析并预览候选题目" }).click();
  await page.getByRole("button", { name: "确认保存所选题目" }).click();
  await expect(page.getByText(/已保存 11 道独立题目/)).toBeVisible();
  // 第二次导入同一面经：跨批次重复提示（P2-1）
  await page.getByRole("button", { name: "批量导入题目", exact: true }).click();
  await page.getByRole("textbox", { name: "粘贴题目原文" }).fill(sampleRecord);
  await page.getByRole("button", { name: "解析并预览候选题目" }).click();
  await expect(page.getByText(/这份记录与已有导入源/)).toBeVisible();
  await expect(page.getByText("与已有题目重复，请核对").first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("dup-import-warning.png"), fullPage: true });
  // 人工保留决定权：取消勾选一道后保存，数量可追溯（不静默、不强制阻止）。
  await page.getByRole("checkbox", { name: "选择第1题" }).uncheck();
  await page.getByRole("button", { name: "确认保存所选题目" }).click();
  await expect(page.getByText(/已保存 10 道独立题目/)).toBeVisible();
  const total = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!).recordedQuestions.length);
  expect(total).toBe(21);
});

test("多题训练：勾选3道题按顺序组成一轮，题目数量与选择一致且不调用模型", async ({ page }, info) => {  let interviewerCalls = 0;
  await page.route("**/api/model/chat", route => { modelCalls += 1; interviewerCalls += 1; return route.fulfill({ json: { content: JSON.stringify({ action: "next" }) } }); });
  await openBatchImport(page);
  await page.getByRole("textbox", { name: "粘贴题目原文" }).fill(sampleRecord);
  await page.getByRole("button", { name: "解析并预览候选题目" }).click();
  await page.getByRole("button", { name: "确认保存所选题目" }).click();
  await expect(page.getByText(/已保存 11 道独立题目/)).toBeVisible();
  // 回到题库主列表勾选 3 道题（经「真实面试题复练」入口进入 recorded 区）。
  const menu = page.getByRole("button", { name: "打开导航" }); if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: /AI 面试题库/ }).first().click();
  await libraryArea(page, "recorded");
  await pickSelectOption(page, "按来源筛选", "本人真实面试题");
  const boxes = page.getByRole("checkbox", { name: /勾选参加多题训练/ });
  await expect(boxes.first()).toBeVisible();
  await boxes.nth(0).click(); await boxes.nth(2).click(); await boxes.nth(4).click();
  await expect(page.getByText("本轮将训练 3 道题")).toBeVisible();
  await page.screenshot({ path: info.outputPath("multi-preview.png"), fullPage: false });
  await page.getByRole("button", { name: "开始多题训练" }).click();
  // 无进行中的旧训练时，题库预览确认后直接开始；有旧训练时会出现确认弹窗。
  const dialog = page.getByRole("dialog", { name: "开始新一轮训练" });
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole("button", { name: "暂存并开始新练习", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-prep-history-v1")!).at(-1).questions.length)).toBe(3);
  expect(modelCalls).toBe(0); expect(interviewerCalls).toBe(0);
});
