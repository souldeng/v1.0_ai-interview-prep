import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPreparation, nextTurn, startSession } from "../src/lib/interview";
import { createInterviewProject, updateProjectFromSession } from "../src/lib/projects";
import { attachCoachReview } from "../src/lib/coaching";

async function anonymousJDScreenshot(browser: Browser) {
  const surface = await browser.newPage({ viewport: { width: 620, height: 280 } });
  try {
    await surface.setContent('<html lang="zh-CN"><body style="padding:24px;background:white;color:#222;font:24px sans-serif"><h1>虚构企业 · AI 应用岗位</h1><p>理解 RAG 与大模型应用。</p><p>开展客户需求访谈，整理验收标准。</p><p>仅用于匿名测试，不是真实招聘材料。</p></body></html>');
    return await surface.screenshot({ type: "png", scale: "css" });
  } finally { await surface.close(); }
}

async function primary(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: false } }));
  await page.route("**/api/model/**", route => route.abort());
});

test("反馈默认只有当前指导，原答与最终思路按需展开，重大事实风险仍可见", async ({ page }, info) => {
  const prepared = createPreparation("", "理解AI应用");
  prepared.questions = [{ id: "ux-coach", text: "RAG 为什么需要检索？", category: "技术理解", technical: true, source: "匿名", sourceType: "foundation" }];
  let session = nextTurn(startSession(prepared), "匿名完整原回答，只应在历史详情中展开查看。", { action: "next" });
  session = attachCoachReview(session, 0, 1, session.turns[0].answer, { strengths: ["说出了检索的作用"], issues: ["还需区分生成的职责"], factRisks: ["示例中的个人成果尚需确认"], suggestions: ["用查制度再回答的例子说明两步"], studyTopics: ["检索与生成"], answerStructure: "先找相关资料，再基于资料回答。", optimizedExample: "", generatedAt: new Date().toISOString() });
  const project = updateProjectFromSession(createInterviewProject({ company: "虚构", jobTitle: "匿名反馈岗位", jobDescription: "理解AI应用", candidateBackground: "", concerns: "" }, prepared), session);
  await page.addInitScript(item => { if (!localStorage.getItem("ai-interview-projects-v1")) localStorage.setItem("ai-interview-projects-v1", JSON.stringify([item])); }, project);
  await page.goto("/"); await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "面试训练", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("feedback.png"), fullPage: true });
  await expect(page.getByRole("heading", { name: "面试报告", exact: true })).not.toBeVisible();
  await expect(page.getByText(session.turns[0].answer, { exact: true })).not.toBeVisible();
  await expect(page.getByRole("textbox", { name: "同题重答", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "最终确认答案", exact: true })).not.toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "示例中的个人成果尚需确认" })).toBeVisible();
  await page.getByText("历史回答与点评", { exact: true }).click(); await expect(page.getByText(session.turns[0].answer, { exact: true })).toBeVisible();
  await page.getByText("保存我的回答思路", { exact: true }).click(); await page.getByRole("textbox", { name: "最终确认答案", exact: true }).fill("本人确认的核心思路：先检索，再生成。");
  await page.getByRole("button", { name: "保存最终答案", exact: true }).click(); await page.reload();
  await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "面试训练", exact: true }).click();
  await page.getByText("保存我的回答思路", { exact: true }).click(); await expect(page.getByRole("textbox", { name: "最终确认答案", exact: true })).toHaveValue("本人确认的核心思路：先检索，再生成。");
});

test("等待点评期间保留题目、本次回答和上轮内容，显示计时且取消可恢复", async ({ page }, info) => {
  const prepared = createPreparation("", "理解AI应用");
  prepared.questions = [
    { id: "ux-first", text: "RAG 为什么先检索再生成？", category: "技术理解", technical: true, source: "匿名测试", sourceType: "foundation" },
    { id: "ux-next", text: "Agent 如何选择工具？", category: "技术理解", technical: true, source: "匿名测试", sourceType: "foundation" },
  ];
  const previous = nextTurn(startSession(prepared), "上一轮原答：先找到相关资料。", { action: "next" });
  const project = updateProjectFromSession(createInterviewProject({ company: "虚构", jobTitle: "匿名体验岗位", jobDescription: "理解AI应用", candidateBackground: "", concerns: "" }, prepared), previous);
  await page.addInitScript(item => localStorage.setItem("ai-interview-projects-v1", JSON.stringify([item])), project);
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: true } }));
  let received = false;
  await page.route("**/api/model/chat", async route => { received = true; await new Promise<void>(resolve => setTimeout(resolve, 30000)); await route.abort().catch(() => {}); });
  await page.clock.install(); await page.goto("/"); await page.getByRole("button", { name: "查看岗位", exact: true }).click();
  await page.getByRole("button", { name: "面试训练", exact: true }).click();
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("本次原答：根据任务目标选择可用工具。");
  await page.getByRole("button", { name: "提交回答", exact: true }).click(); await expect.poll(() => received).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("waiting.png"), fullPage: true });
  await expect(page.getByRole("region", { name: "当前回答反馈" })).toBeVisible();
  const waiting = page.getByRole("region", { name: "AI请求等待状态" });
  await expect(waiting).toContainText("Agent 如何选择工具？");
  await expect(waiting).toContainText("本次原答：根据任务目标选择可用工具。");
  await page.clock.fastForward(21000);
  await expect.poll(async () => Number((await waiting.innerText()).match(/已等待 (\d+) 秒/)?.[1])).toBeGreaterThanOrEqual(21);
  await expect(waiting).toContainText("仍在处理");
  await waiting.getByRole("button", { name: "取消AI等待", exact: true }).click();
  await expect(waiting).toHaveCount(0);
  await expect(page.getByText("AI 点评未完成，目前显示的是本地辅助提示", { exact: true })).toBeVisible();
});

test("题库首次只展示三个用途入口，进入后才显示该区操作", async ({ page }, info) => {
  await page.goto("/"); await primary(page, "AI 面试题库");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("library-entry.png"), fullPage: true });
  for (const name of ["AI 基础学习", "岗位专项训练", "真实面试题复练"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.getByRole("button", { name: "AI 基础学习", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "搜索内置题" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "真实面试问题" })).toHaveCount(0);
  await page.getByRole("button", { name: "返回题库入口", exact: true }).click();
  await page.getByRole("button", { name: "真实面试题复练", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "真实面试问题" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "搜索内置题" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("创建与空分析默认简洁，训练问题利用内容宽度", async ({ page }, info) => {
  await page.goto("/"); await page.getByRole("button", { name: /创建岗位/ }).first().click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("create.png"), fullPage: true });
  await expect(page.getByRole("button", { name: "填入可复现演示数据", exact: true })).toHaveCount(0);
  await expect(page.getByText("资料保存在当前浏览器。数据备份不包含原始附件，请另外保存原文件。", { exact: true })).not.toBeVisible();
  await page.getByPlaceholder("例如：AI 产品经理").fill("匿名简洁岗位");
  await page.getByPlaceholder("粘贴完整的岗位职责与任职要求").fill("理解大模型应用，能够分析客户需求。");
  await page.getByRole("button", { name: "创建岗位准备方案", exact: true }).click();
  await expect(page.getByRole("heading", { name: "第三方面经：仅作准备参考" })).toHaveCount(0);
  await expect(page.getByText("尚无已确认的经历卡，因此不输出个人匹配结论。", { exact: false })).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("analysis-empty.png"), fullPage: true });
  await page.getByRole("button", { name: "面试训练", exact: true }).click();
  await page.getByRole("button", { name: "开始新训练", exact: true }).click();
  const answer = page.getByRole("textbox", { name: "本轮回答", exact: true }); await expect(answer).toBeVisible();
  if (info.project.name === "desktop") {
    const width = await answer.evaluate(el => el.getBoundingClientRect().width / el.closest("main")!.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(.8);
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("training-wide.png"), fullPage: true });
});

test("训练选题等待有计时且能取消，迟到选题不创建或覆盖会话", async ({ page }, info) => {
  const prepared = createPreparation("", "理解大模型应用，能够分析客户需求。");
  const project = createInterviewProject({ company: "虚构", jobTitle: "匿名选题岗位", jobDescription: prepared.job.raw, candidateBackground: "", concerns: "" }, prepared);
  await page.addInitScript(item => localStorage.setItem("ai-interview-projects-v1", JSON.stringify([item])), project);
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: true } }));
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let received = false;
  await page.route("**/api/model/chat", async route => { received = true; await delayed; await route.fulfill({ json: { content: '{"ids":["trusted-jd-0"]}' } }).catch(() => {}); });
  try {
    await page.clock.install(); await page.goto("/"); await page.getByRole("button", { name: "查看岗位", exact: true }).click();
    await page.getByRole("button", { name: "面试训练", exact: true }).click(); await page.getByRole("button", { name: "开始新训练", exact: true }).click();
    await expect.poll(() => received).toBe(true);
    const waiting = page.getByRole("region", { name: "训练启动状态" }); await expect(waiting).toBeVisible();
    await page.clock.fastForward(21000);
    await expect.poll(async () => Number((await waiting.innerText()).match(/已等待 (\d+) 秒/)?.[1])).toBeGreaterThanOrEqual(21);
    await page.screenshot({ path: info.outputPath("starting.png"), fullPage: true });
    await waiting.getByRole("button", { name: "取消AI等待", exact: true }).click(); await expect(waiting).toHaveCount(0);
    release(); await expect(page.getByRole("alert")).toContainText("已取消");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0])).toEqual(project);
    await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveCount(0);
  } finally { release(); }
});

test("创建岗位复用截图核对与原件保存，失败重试和刷新不丢失 JD", async ({ page, browser }, info) => {
  await page.route(/cdn\.jsdelivr\.net/, route => route.abort());
  await page.goto("/"); await page.getByRole("button", { name: /创建岗位/ }).first().click();
  await page.getByText("从截图或文档填写 JD", { exact: true }).click();
  await page.getByLabel("选择岗位资料文件").setInputFiles({ name: "匿名JD.png", mimeType: "image/png", buffer: await anonymousJDScreenshot(browser) });
  await expect(page.getByRole("button", { name: "1. 匿名JD.png", exact: true }).locator("../..")).toContainText("OCR 失败");
  await page.getByRole("textbox", { name: "当前文件核对文字" }).fill("匿名岗位需要理解 RAG 并开展客户需求分析。");
  await page.getByRole("button", { name: "使用此 JD", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("先逐张核对");
  await page.getByRole("button", { name: "确认当前文字", exact: true }).click();
  await page.evaluate(() => { const original = Storage.prototype.setItem; let fail = true; Storage.prototype.setItem = function(key,value) { if (key === "ai-interview-drafts-v1" && fail) { fail = false; throw new Error("匿名草稿容量失败"); } return original.call(this,key,value); }; });
  await page.getByRole("button", { name: "使用此 JD", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("匿名草稿容量失败");
  await expect(page.getByRole("textbox", { name: "当前文件核对文字" })).toHaveValue("匿名岗位需要理解 RAG 并开展客户需求分析。");
  await page.getByRole("button", { name: "使用此 JD", exact: true }).click();
  await expect(page.getByPlaceholder("粘贴完整的岗位职责与任职要求")).toHaveValue("匿名岗位需要理解 RAG 并开展客户需求分析。");
  await page.reload(); await page.getByRole("button", { name: /创建岗位/ }).first().click();
  await expect(page.getByPlaceholder("粘贴完整的岗位职责与任职要求")).toHaveValue("匿名岗位需要理解 RAG 并开展客户需求分析。");
  await page.getByPlaceholder("例如：AI 产品经理").fill("匿名截图创建岗位");
  await page.evaluate(() => { const original = Storage.prototype.setItem; let fail = true; Storage.prototype.setItem = function(key,value) { if (key === "ai-interview-projects-v1" && fail) { fail = false; throw new Error("匿名岗位保存失败"); } return original.call(this,key,value); }; });
  await page.getByRole("button", { name: "创建岗位准备方案", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "匿名岗位保存失败" }).first()).toBeVisible();
  await expect(page.getByPlaceholder("粘贴完整的岗位职责与任职要求")).toHaveValue("匿名岗位需要理解 RAG 并开展客户需求分析。");
  await page.getByRole("button", { name: "创建岗位准备方案", exact: true }).click();
  await page.getByRole("button", { name: "岗位资料", exact: true }).click();
  await page.getByRole("heading", { name: "JD · 匿名JD.png", exact: true }).locator("../..").getByRole("button", { name: "查看 / 编辑", exact: true }).click();
  await expect(page.getByRole("img", { name: "匿名JD.png 原图", exact: true })).toBeVisible();
  await expect.poll(() => page.getByRole("img", { name: "匿名JD.png 原图", exact: true }).evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(620);
  const download = page.waitForEvent("download"); await page.getByRole("link", { name: "下载原件", exact: true }).click(); expect((await download).suggestedFilename()).toBe("匿名JD.png");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("created-jd-original.png"), fullPage: true });
  await page.reload(); await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "岗位资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "JD · 匿名JD.png", exact: true })).toBeVisible();
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0]);
  expect(project.materials[0].projectId).toBe(project.id); expect(project.materials[0].reviewedAt).toBeTruthy();
  expect(project.materials[0].kind).toBe("job_description"); expect(project.materials[0].parts[0].fileId).toBeTruthy();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("核对简历后直接提取候选，编辑确认前不成为个人事实，创建岗位复用确认结果", async ({ page }, info) => {
  await page.goto("/"); await primary(page, "个人资料");
  await page.getByLabel("上传个人资料文件").setInputFiles({ name: "匿名需求简历.txt", mimeType: "text/plain", buffer: Buffer.from("本人负责客户需求访谈并整理需求清单，没有负责模型研发或上线。") });
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名需求简历.txt", exact: true }) });
  await card.getByRole("button", { name: "核对文字", exact: true }).click();
  await card.getByRole("button", { name: "保存核对文字", exact: true }).click();
  let requests = 0;
  await page.route("**/api/model/chat", async route => {
    requests++;
    const id = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-profile-v1")!).resumes[0].id);
    expect(route.request().postDataJSON().messages[1].content).toContain("本人负责客户需求访谈");
    return route.fulfill({ json: { content: JSON.stringify([{ title: "匿名客户访谈", situation: "客户需求", action: "本人负责客户需求访谈", result: "整理需求清单", reflection: "没有负责模型研发或上线", sourceQuotes: [{ materialId: id, quote: "本人负责客户需求访谈并整理需求清单" }] }]) } });
  });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "从已核对简历提取经历", exact: true }).click();
  await expect(page.getByRole("heading", { name: "候选经历（尚未保存为事实）", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-profile-v1")!).experiences.length)).toBe(0);
  await page.getByRole("button", { name: "选择并编辑", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "我确认这张卡中的个人贡献、结果和边界真实可用。" })).not.toBeChecked();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-profile-v1")!).experiences[0].confirmed)).toBe(false);
  await page.getByRole("checkbox", { name: "我确认这张卡中的个人贡献、结果和边界真实可用。" }).check();
  await page.getByRole("button", { name: "保存经历卡", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("resume-confirmed.png"), fullPage: true });
  await page.reload(); await primary(page, "我的岗位"); await page.getByRole("button", { name: /创建岗位/ }).first().click();
  await expect(page.getByText("将复用个人资料中的 1 条已确认经历，无需重复填写。", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /个人经历/ })).not.toBeVisible();
  expect(requests).toBe(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("岗位资料长篇原始 JD 按需展开，不挤占上传与资料入口", async ({ page }, info) => {
  const jd = "匿名长篇岗位要求：理解大模型与需求澄清。".repeat(30);
  const project = createInterviewProject({ company: "虚构", jobTitle: "匿名资料阅读岗位", jobDescription: jd, candidateBackground: "", concerns: "" }, createPreparation("", jd));
  await page.addInitScript(item => localStorage.setItem("ai-interview-projects-v1", JSON.stringify([item])), project);
  await page.goto("/"); await page.getByRole("button", { name: "查看岗位", exact: true }).click();
  await page.getByRole("button", { name: "岗位资料", exact: true }).click();
  await expect(page.getByText(jd, { exact: true })).not.toBeVisible();
  await page.getByText("原始岗位 JD", { exact: true }).click();
  await expect(page.getByText(jd, { exact: true })).toBeVisible();
  await page.getByText("原始岗位 JD", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "添加岗位资料", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("job-materials-compact.png"), fullPage: true });
});

test("提交后先呈现该回答的点评与重答，再显示下一题", async ({ page }) => {
  const prepared = createPreparation("", "理解 AI 应用");
  prepared.questions = [
    { id: "order-first", text: "RAG 为什么需要检索？", category: "技术理解", technical: true, source: "匿名", sourceType: "foundation" },
    { id: "order-next", text: "Agent 如何使用工具？", category: "技术理解", technical: true, source: "匿名", sourceType: "foundation" },
  ];
  const session = nextTurn(startSession(prepared), "先查相关资料，再组织回答。", { action: "next" });
  const project = updateProjectFromSession(createInterviewProject({ company: "虚构", jobTitle: "匿名阅读顺序岗位", jobDescription: "理解 AI 应用", candidateBackground: "", concerns: "" }, prepared), session);
  await page.addInitScript(item => localStorage.setItem("ai-interview-projects-v1", JSON.stringify([item])), project);
  await page.goto("/"); await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "面试训练", exact: true }).click();
  const review = await page.getByRole("region", { name: "当前回答反馈" }).boundingBox();
  const question = await page.getByRole("heading", { name: "Agent 如何使用工具？", exact: true }).boundingBox();
  expect(review!.y).toBeLessThan(question!.y);
});

test("JD 附件写入期间继续编辑岗位字段，不被异步保存的旧表单覆盖", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: /创建岗位/ }).first().click();
  await page.getByPlaceholder("例如：AI 产品经理").fill("保存前岗位名称");
  await page.getByText("从截图或文档填写 JD", { exact: true }).click();
  await page.getByLabel("选择岗位资料文件").setInputFiles({ name: "匿名补充JD.txt", mimeType: "text/plain", buffer: Buffer.from("附件核对后的岗位要求。") });
  await expect(page.getByRole("textbox", { name: "当前文件核对文字" })).toHaveValue("附件核对后的岗位要求。");
  await page.getByRole("button", { name: "确认当前文字", exact: true }).click();
  // Delay the external database completion event, not an application collaborator.
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, "oncomplete")!;
    Object.defineProperty(IDBTransaction.prototype, "oncomplete", { ...descriptor, set(listener) { descriptor.set!.call(this, listener ? function(event: Event) { setTimeout(() => listener.call(this,event), 1800); } : listener); } });
  });
  await page.getByRole("button", { name: "使用此 JD", exact: true }).click();
  await page.getByPlaceholder("例如：AI 产品经理").fill("异步等待中修改的岗位名称");
  await page.getByPlaceholder("粘贴完整的岗位职责与任职要求").fill("等待期间手工补充的要求。");
  await expect(page.getByRole("status").filter({ hasText: "已填入岗位 JD" }).first()).toBeVisible();
  await expect(page.getByPlaceholder("例如：AI 产品经理")).toHaveValue("异步等待中修改的岗位名称");
  await expect(page.getByPlaceholder("粘贴完整的岗位职责与任职要求")).toHaveValue("等待期间手工补充的要求。\n\n附件核对后的岗位要求。");
});

test("旧草稿恢复造成原件被两个岗位引用时，删除一份资料不破坏另一岗位原件", async ({ page }) => {
  const now = "2026-10-21T00:00:00.000Z";
  const jobs = ["匿名原岗位", "匿名恢复草稿岗位"].map((title, index) => ({
    ...createInterviewProject({ company: "虚构", jobTitle: title, jobDescription: "理解 AI 应用", candidateBackground: "", concerns: "" }, createPreparation("", "理解 AI 应用")),
    id: `shared-job-${index}`, materials: [{ id: `shared-material-${index}`, projectId: `shared-job-${index}`, kind: "job_description", title: "匿名共享JD", content: "仅作匿名原件引用测试。", source: "file", sourceFileName: "匿名共享JD.txt", sourceMimeType: "text/plain", fileId: "anonymous-shared-jd-file", originalSaved: true, reviewedAt: now, createdAt: now, updatedAt: now }],
  }));
  await page.addInitScript(async jobs => {
    if (localStorage.getItem("ai-interview-projects-v1")) return;
    localStorage.setItem("ai-interview-projects-v1", JSON.stringify(jobs));
    const open = indexedDB.open("ai-interview-material-files-v1", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("files", { keyPath: "id" });
    const db = await new Promise<IDBDatabase>((resolve,reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    await new Promise<void>((resolve,reject) => { const tx = db.transaction("files", "readwrite"); tx.objectStore("files").put({ id: "anonymous-shared-jd-file", blob: new Blob(["匿名共享原件不能被另一岗位删除。"], { type: "text/plain" }), name: "匿名共享JD.txt", type: "text/plain", size: 54, createdAt: "2026-10-21T00:00:00.000Z" }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, jobs);
  await page.goto("/");
  await page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名恢复草稿岗位", exact: true }) }).getByRole("button", { name: "查看岗位", exact: true }).click();
  await page.getByRole("button", { name: "岗位资料", exact: true }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("heading", { name: "匿名共享JD", exact: true }).locator("../..").getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("heading", { name: "匿名共享JD", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "返回岗位列表", exact: true }).click();
  await page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名原岗位", exact: true }) }).getByRole("button", { name: "查看岗位", exact: true }).click();
  await page.getByRole("button", { name: "岗位资料", exact: true }).click();
  await page.getByRole("button", { name: "查看 / 编辑", exact: true }).click();
  await expect(page.getByRole("link", { name: "下载原件", exact: true })).toBeVisible();
});

test("核对修改保存后立即提取使用最新文字，模型无候选也不能反写旧资料", async ({ page }) => {
  const original = "原始核对文字：本人负责旧产品需求访谈。";
  const revised = "最新核对文字：本人负责新产品需求访谈并形成清单。";
  await page.goto("/"); await primary(page, "个人资料");
  await page.getByLabel("上传个人资料文件").setInputFiles({ name: "匿名核对修订.txt", mimeType: "text/plain", buffer: Buffer.from(original) });
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名核对修订.txt", exact: true }) });
  await card.getByRole("button", { name: "核对文字", exact: true }).click(); await card.getByRole("button", { name: "保存核对文字", exact: true }).click();
  await card.getByRole("button", { name: "核对文字", exact: true }).click();
  await card.getByRole("textbox", { name: "当前可编辑文字", exact: true }).fill(revised);
  let input = "";
  await page.route("**/api/model/chat", route => { input = route.request().postDataJSON().messages[1].content; return route.fulfill({ json: { content: "[]" } }); });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "从已核对简历提取经历", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "未保存的修改", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保存后离开", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("未找到有可靠文字依据");
  expect(input).toContain(revised); expect(input).not.toContain(original);
  await page.reload(); await primary(page, "个人资料");
  await card.getByRole("button", { name: "核对文字", exact: true }).click();
  await expect(card.getByRole("textbox", { name: "当前可编辑文字", exact: true })).toHaveValue(revised);
});
