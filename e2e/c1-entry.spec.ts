import { libraryArea, openDetails } from "./uiActions";
import { expect, test, type Page } from "@playwright/test";
import { createPreparation, nextTurn, startSession } from "../src/lib/interview";
import { createInterviewProject, updateProjectFromSession } from "../src/lib/projects";
import { attachCoachReview, reviseTurn, saveFinalAnswer } from "../src/lib/coaching";
import { emptyUserProfile, PROFILE_KEY } from "../src/lib/profileStorage";

function fixture(id = "anonymous-c1-job", state: "ready" | "active" | "completed" = "active") {
  const input = { company: "匿名企业", jobTitle: id, jobDescription: "负责客户需求分析和 AI 应用方案。", candidateBackground: "旧背景：我负责旧项目需求整理，没有负责模型研发。", concerns: "" };
  const prepared = createPreparation(input.candidateBackground, input.jobDescription);
  prepared.questions = [
    { id: "c1-first", text: "说明本人客户访谈行动。", category: "经历复盘", technical: false, sourceType: "resume", source: "旧背景：本人客户访谈" },
    { id: "c1-second", text: "如何评测知识库助手？", category: "技术理解", technical: true, sourceType: "foundation", source: "内置学习题（非企业面试原题）" },
  ];
  const item = { ...createInterviewProject(input, prepared), id };
  if (state === "ready") return item;
  let session = nextTurn(startSession(prepared), "原答：本人访谈客户并形成需求清单。", { action: "next" });
  session = reviseTurn(session, 0, "重答：访谈后核对需求并形成清单，没有负责研发。");
  session = saveFinalAnswer(session, 0, "本人最终思路：访谈→核对需求→清单→职责边界。");
  session = attachCoachReview(session, 0, 2, session.turns[0].revisions![0].answer, { strengths: ["匿名已有点评"], issues: [], factRisks: [], suggestions: [], studyTopics: [], answerStructure: "行动与边界", optimizedExample: "", generatedAt: "2026-10-14T00:00:00.000Z" });
  if (state === "completed") session = nextTurn(session, "评测检索与生成效果。", { action: "next" });
  return updateProjectFromSession(item, session);
}

async function seed(page: Page, items = [fixture()], configured = false) {
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: configured, provider: "匿名边界替身" } }));
  await page.addInitScript(values => {
    if (!localStorage.getItem("ai-interview-projects-v1")) {
      localStorage.setItem("ai-interview-projects-v1", JSON.stringify(values));
      const current = values[0].session;
      if (current?.status === "active") localStorage.setItem("ai-interview-drafts-v1", JSON.stringify({ [`answer:${current.id}:${current.questions[current.currentQuestionIndex].id}`]: "未提交草稿：检索与生成分别评测。", ...(current.turns.length ? { [`retry:${current.id}:0`]: "未提交重答草稿：本人访谈步骤与职责边界。" } : {}) }));
    }
  }, items);
  await page.goto("/");
  await page.getByRole("button", { name: "查看岗位", exact: true }).first().click();
}

async function primary(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "打开导航" }); if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  if (name === "AI 面试题库") await libraryArea(page, "job");
}

test("C1 旧分析默认收起，展开仍可查看旧背景、矩阵及历史题目", async ({ page }, info) => {
  const item = fixture("anonymous-c1-job", "ready");
  item.preparation!.matrix[0].capability = "旧矩阵已保存主题（原值）";
  await seed(page, [item]);
  await page.getByRole("button", { name: "岗位分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: "基于已确认经历的分析" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "原有岗位分析（兼容材料）" })).not.toBeVisible();
  await page.getByText("历史分析与旧材料（兼容查看）", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "原有岗位分析（兼容材料）" })).toBeVisible();
  await page.getByText("查看基础能力矩阵与历史题目", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "能力矩阵", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "旧矩阵已保存主题（原值）", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "说明本人客户访谈行动。", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始文字模拟面试", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "用此题库开始模拟", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("c1-legacy-analysis.png"), fullPage: true });
});

test("C1 只有旧分析和历史题目的岗位仍可展开查看，不补造来源", async ({ page }) => {
  const item = fixture("anonymous-c1-legacy-only", "ready");
  delete item.preparation;
  item.analysis = { coreCapabilities: ["旧岗位能力主题"], keywords: ["需求"], strengths: ["旧分析保存的材料线索，不能改称已确认事实"], risks: ["旧资料需要核对"], preparationPlan: [{ category: "旧准备分类", questionCount: 3 }] };
  await seed(page, [item]);
  await page.getByRole("button", { name: "查看岗位分析", exact: true }).click();
  await page.getByText("历史分析与旧材料（兼容查看）", { exact: true }).click();
  await expect(page.getByText("旧分析保存的材料线索，不能改称已确认事实", { exact: true })).toBeVisible();
  await expect(page.getByText("旧准备分类：3 题（历史建议）", { exact: true })).toBeVisible();
  await page.getByText("查看历史题目", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "说明本人客户访谈行动。", exact: true })).toBeVisible();
  await expect(page.getByText("来源未确认", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0])).toEqual(item);
  await page.getByRole("button", { name: "面试训练", exact: true }).click();
  await page.getByRole("button", { name: "开始新训练", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("缺少训练准备快照");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0])).toEqual(item);
});

test("C1 新训练保留岗位旧准备对象及未作答历史题目，新会话使用独立准备数据", async ({ page }) => {
  const item = fixture("anonymous-c1-retain-preparation", "ready");
  await seed(page, [item]);
  await page.getByRole("button", { name: "查看岗位分析", exact: true }).click();
  await page.getByRole("button", { name: "进入面试训练", exact: true }).click();
  await page.getByRole("button", { name: "开始新训练", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答" })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0]);
  expect(saved.preparation).toEqual(item.preparation);
  expect(saved.session.preparation.id).not.toBe(item.preparation!.id);
  await page.getByRole("button", { name: "岗位分析", exact: true }).click();
  await page.getByText("历史分析与旧材料（兼容查看）", { exact: true }).click();
  await page.getByText("查看基础能力矩阵与历史题目", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "说明本人客户访谈行动。", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-prep-history-v1") || "[]"))).toEqual([]);
});

test("C1 继续原会话不重新选题，原答重答最终答案点评及草稿刷新保留", async ({ page }, info) => {
  const item = fixture();
  const external: string[] = [];
  await page.route("**/api/model/chat", route => { external.push(route.request().postData()!); return route.fulfill({ status: 503 }); });
  await seed(page, [item], true);
  await page.screenshot({ path: info.outputPath("c1-job-next-step.png") });
  await page.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("未提交草稿：检索与生成分别评测。");
  await expect(page.getByRole("heading", { name: "如何评测知识库助手？", exact: true })).toBeVisible();
  await openDetails(page, "保存我的回答思路");
  await expect(page.getByRole("textbox", { name: "最终确认答案", exact: true })).toHaveValue(item.session!.turns[0].finalAnswer!);
  await expect(page.getByRole("textbox", { name: "同题重答", exact: true })).toHaveValue("未提交重答草稿：本人访谈步骤与职责边界。");
  await expect(page.getByRole("region", { name: "当前回答反馈" }).getByText("匿名已有点评", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await page.reload(); await page.getByRole("button", { name: "查看岗位", exact: true }).click();
  await page.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("未提交草稿：检索与生成分别评测。");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0])).toEqual(item);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("c1-training-continue.png"), fullPage: true });
  await info.attach("c1-training-continue.png", { path: info.outputPath("c1-training-continue.png"), contentType: "image/png" });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("c1-training-entry.png") });
});

test("C1 未提交首答也须明确确认新轮次，取消不变，确认后旧草稿可恢复", async ({ page }) => {
  const item = fixture("anonymous-c1-draft", "ready");
  item.session = startSession(item.preparation!);
  await seed(page, [item]);
  await page.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("尚未提交的真实思路草稿：本人访谈与需求清单。");
  const before = await page.evaluate(() => ({ projects: localStorage.getItem("ai-interview-projects-v1"), drafts: localStorage.getItem("ai-interview-drafts-v1") }));
  await page.getByRole("button", { name: "开始新一轮训练", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "开始新一轮训练" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "保留当前训练", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("尚未提交的真实思路草稿：本人访谈与需求清单。");
  expect(await page.evaluate(() => ({ projects: localStorage.getItem("ai-interview-projects-v1"), drafts: localStorage.getItem("ai-interview-drafts-v1") }))).toEqual(before);
  await page.getByRole("button", { name: "开始新一轮训练", exact: true }).click();
  await dialog.getByRole("button", { name: "保存旧轮次并开始", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0].session.id)).not.toBe(item.session.id);
  expect(await page.evaluate(() => localStorage.getItem("ai-interview-drafts-v1"))).toBe(before.drafts);
  await primary(page, "AI 面试题库"); await page.getByRole("button", { name: "整理训练记录", exact: true }).click();
  await page.getByRole("button", { name: "查看", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("尚未提交的真实思路草稿：本人访谈与需求清单。");
});

test("C1 来源字段精确区分六类，不凭题目文字或当前经历反推旧来源", async ({ page }, info) => {
  const item = fixture("anonymous-c1-sources", "ready");
  const base = item.preparation!.questions[0];
  item.preparation!.questions = [
    { ...base, id: "source-jd", text: "来源样例一", sourceType: "jd", source: "岗位 JD 原文" },
    { ...base, id: "source-confirmed", text: "来源样例二", sourceType: "resume", source: "已确认个人经历：本人访谈" },
    { ...base, id: "source-old", text: "来源样例三", sourceType: "resume", source: "本人旧背景" },
    { ...base, id: "source-third", text: "来源样例四", sourceType: "third_party", source: "第三方面经原题" },
    { ...base, id: "source-foundation", text: "来源样例五", sourceType: "foundation", source: "内置学习题" },
    { ...base, id: "source-follow", text: "来源样例六", sourceType: "ai_follow_up", source: "AI 基于本轮回答的追问" },
    { ...base, id: "source-unknown", text: "JD 简历 本人已确认 RAG（词语不证明来源）", sourceType: undefined as any, source: "旧导入来源" },
  ];
  // The confirmed label is explicitly present in the existing source string; no new field is invented.
  item.questions = item.preparation!.questions.map(q => ({ id: q.id, category: q.category, question: q.text, whyAsk: q.source, answerGuide: [], difficulty: "medium", status: "unanswered", userAnswer: "", feedback: null, followUpQuestions: [], score: null }));
  await seed(page, [item]);
  await page.getByRole("button", { name: "面试训练", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始新训练", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "继续当前训练", exact: true })).toHaveCount(0);
  await page.getByText("查看历史题目", { exact: true }).click();
  for (const label of ["JD 要求", "已确认个人经历", "历史个人背景线索", "第三方面经", "内置基础题", "AI 追问", "来源未确认"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: info.outputPath("c1-sources.png"), fullPage: true });
  await primary(page, "AI 面试题库");
  for (const label of ["已确认个人经历", "历史个人背景线索", "第三方面经", "内置基础题", "AI 追问", "来源未确认"]) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
});

test("C1 完成会话的新训练保持事实隔离，选题及保存失败不覆盖旧版本", async ({ page }) => {
  const item = fixture("anonymous-c1-completed", "completed");
  const profile = emptyUserProfile(new Date("2026-10-14T00:00:00.000Z"));
  profile.experiences = [
    { id: "confirmed", title: "本人访谈", situation: "客户需求", action: "我负责访谈", result: "需求清单", reflection: "", confirmed: true, createdAt: profile.updatedAt, updatedAt: profile.updatedAt },
    { id: "unconfirmed", title: "待确认", situation: "", action: "我完成50个AI项目", result: "", reflection: "", confirmed: false, createdAt: profile.updatedAt, updatedAt: profile.updatedAt },
  ];
  item.jobDescription = "需要3年AI项目经验，负责需求分析。";
  item.materials = [{ id: "third", kind: "interview_experience", title: "他人面经", content: "他人完成20个AI项目。如何评估知识库助手效果？", source: "manual_text", reviewedAt: profile.updatedAt, createdAt: profile.updatedAt, updatedAt: profile.updatedAt }];
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value)); }, { key: PROFILE_KEY, value: profile });
  let failModel = true;
  let context: any;
  await page.route("**/api/model/chat", route => {
    const prompt = route.request().postDataJSON().messages[1].content as string;
    const [prefix, choices] = prompt.split("\n候选题：");
    context = JSON.parse(prefix.slice(prefix.indexOf("\n") + 1));
    if (failModel) return route.fulfill({ status: 503 });
    const candidates = JSON.parse(choices);
    return route.fulfill({ json: { content: JSON.stringify({ ids: candidates.slice(0, 3).map((q: any) => q.id) }) } });
  });
  await seed(page, [item], true);
  await page.getByRole("button", { name: "面试训练", exact: true }).click();
  await expect(page.getByRole("button", { name: "继续当前训练", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "选择已回答的问题" }).selectOption("0");
  await openDetails(page, "保存我的回答思路");
  await expect(page.getByRole("textbox", { name: "最终确认答案" })).toHaveValue(item.session!.turns[0].finalAnswer!);
  const before = await page.evaluate(() => localStorage.getItem("ai-interview-projects-v1"));
  await page.evaluate(() => {
    (window as any).c1NativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === "ai-interview-projects-v1") throw new Error("匿名项目保存失败"); return (window as any).c1NativeSetItem.call(this, key, value); };
  });
  await page.getByRole("button", { name: "开始新一轮训练", exact: true }).click();
  await page.getByRole("button", { name: "保存旧轮次并开始", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("匿名项目保存失败");
  expect(await page.evaluate(() => localStorage.getItem("ai-interview-projects-v1"))).toBe(before);
  await openDetails(page, "保存我的回答思路");
  await expect(page.getByRole("textbox", { name: "最终确认答案" })).toHaveValue(item.session!.turns[0].finalAnswer!);
  expect(context["A_用户本人已确认事实"].join(" ")).toContain("我负责访谈");
  expect(context["A_用户本人已确认事实"].join(" ")).not.toMatch(/3年|20个|50个|旧背景/);
  expect(context["B_当前岗位JD"].jd).toContain("3年");
  expect(context["C_第三方面经_绝非当前用户经历"][0].text).toContain("20个");
  await page.evaluate(() => { Storage.prototype.setItem = (window as any).c1NativeSetItem; });
  // Local fallback is explicit on a successful save; it is never described as AI selection success.
  await page.getByRole("button", { name: "开始新一轮训练", exact: true }).click();
  await page.getByRole("button", { name: "保存旧轮次并开始", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("模型选题失败或超时，已使用本地选题");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-prep-history-v1")!).find((s: any) => s.id === JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0].session.id))).toBeUndefined();
  const archived = await page.evaluate(id => JSON.parse(localStorage.getItem("ai-interview-prep-history-v1")!).find((s: any) => s.id === id), item.session!.id);
  expect(archived).toEqual(item.session);
  // Exercise the same public selection boundary with a valid network response.
  failModel = false;
  await page.getByRole("button", { name: "开始新一轮训练", exact: true }).click();
  await page.getByRole("button", { name: "保存旧轮次并开始", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0].session.questions.length)).toBe(3);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), PROFILE_KEY)).toEqual(profile);
});

test("C1 两岗位切换及返回历史会话不串题、不改原记录", async ({ page }) => {
  const first = fixture("anonymous-c1-A"); const second = fixture("anonymous-c1-B");
  second.session!.questions[1].text = "B岗位专属当前题";
  await seed(page, [first, second]);
  await page.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await page.getByRole("textbox", { name: "本轮回答" }).fill("A岗位独立未提交草稿：检索与生成。");
  await page.getByRole("button", { name: "返回岗位列表", exact: true }).click();
  await page.getByRole("button", { name: "查看岗位", exact: true }).nth(1).click();
  await page.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await expect(page.getByRole("heading", { name: "B岗位专属当前题", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "本轮回答" })).toHaveValue("");
  await page.getByRole("button", { name: "返回岗位列表", exact: true }).click();
  await page.getByRole("button", { name: "查看岗位", exact: true }).first().click();
  await page.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答" })).toHaveValue("A岗位独立未提交草稿：检索与生成。");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!))).toEqual([first, second]);
});

test("C1 日常基础题仍无需JD及简历，独立作答后可保存短思路", async ({ page }) => {
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: false } }));
  await page.goto("/"); await primary(page, "AI 面试题库");
  await page.getByRole("button", { name: "返回题库入口", exact: true }).click();
  await libraryArea(page, "foundation");
  await page.getByRole("button", { name: "开始回答", exact: true }).click();
  await page.getByRole("button", { name: "进入回答练习", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答" })).toBeVisible();
  await page.getByRole("textbox", { name: "本轮回答" }).fill("匿名基础题回答：先定义概念，再解释原理和应用边界。");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await openDetails(page, "保存我的回答思路");
  await page.getByRole("textbox", { name: "最终确认答案" }).fill("核心思路：定义→原理→应用→局限。");
  await page.getByRole("button", { name: "保存最终答案", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1") || "[]"))).toEqual([]);
});

test("C1 未保存编辑及点评等待仍保护导航和新训练，取消后文字保留", async ({ page }) => {
  await seed(page, [fixture()], true);
  const materialDraft = page.getByRole("textbox", { name: "直接粘贴岗位资料文字" });
  await materialDraft.fill("尚未保存的岗位资料草稿，需要先核对。");
  await page.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await expect(page.getByRole("heading", { name: "未保存的修改" })).toBeVisible();
  await page.getByRole("button", { name: "留在当前页", exact: true }).click();
  await expect(materialDraft).toHaveValue("尚未保存的岗位资料草稿，需要先核对。");
  await page.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await openDetails(page, "保存我的回答思路");
  const final = page.getByRole("textbox", { name: "最终确认答案" });
  await final.fill("尚未保存的最终思路：必须保留本人访谈和真实职责。");
  await page.getByRole("button", { name: "开始新一轮训练", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "开始新一轮训练" })).toBeVisible();
  await page.getByRole("button", { name: "保留当前训练", exact: true }).click();
  await expect(final).toHaveValue("尚未保存的最终思路：必须保留本人访谈和真实职责。");
  await page.getByRole("button", { name: "保存最终答案", exact: true }).click();
  await page.getByRole("textbox", { name: "同题重答" }).fill("新版本：我负责客户访谈并记录需求清单，没有承担研发。");
  await page.getByRole("button", { name: "保存重答并对比", exact: true }).click();
  let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/model/chat", async route => { await ready; await route.fulfill({ status: 503 }); });
  await page.getByRole("button", { name: "请求 AI 点评", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始新一轮训练", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "岗位分析", exact: true })).toBeDisabled();
  release();
  await expect(page.getByText("AI 点评未完成，目前显示的是本地辅助提示", { exact: true })).toBeVisible();
  await expect(final).toHaveValue("尚未保存的最终思路：必须保留本人访谈和真实职责。");
});
