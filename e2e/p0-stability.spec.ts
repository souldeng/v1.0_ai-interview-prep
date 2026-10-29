import { libraryArea, openDetails } from "./uiActions";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createPreparation, nextTurn, startSession } from "../src/lib/interview";
import { createInterviewProject, updateProjectFromSession } from "../src/lib/projects";
import { saveFinalAnswer } from "../src/lib/coaching";
import { cjkBody, cjkTextPdf } from "./fixtures/cjkPdf";

// Full Chromium has the PDF viewer; the default headless shell does not.
test.use({ channel: "chromium", launchOptions: { args: ["--disable-features=PdfOopif"] } });

async function openPrimary(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "打开导航" }); if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  if (name === "AI 面试题库") await libraryArea(page, "job");
}

function anonymousProject(id = "anonymous-p0-job", followUps = true) {
  const input = { company: "匿名公司", jobTitle: id, jobDescription: "负责需求分析和 AI 应用。", candidateBackground: "我负责访谈。", concerns: "" };
  const prepared = createPreparation(input.candidateBackground, input.jobDescription);
  prepared.questions = [{ ...prepared.questions[0], id: "anonymous-question", text: "主问题：说明你的需求访谈经验。" }];
  const created = { ...createInterviewProject(input, prepared), id };
  let session = nextTurn(startSession(prepared), "主轮原回答：我负责需求访谈。", followUps ? { action: "follow_up", followUpQuestion: "追问一：具体产物是什么？" } : { action: "next" });
  if (followUps) {
    session = nextTurn(session, "追问一原回答：形成需求记录。", { action: "next" });
    session = { ...session, turns: [...session.turns, { ...session.turns[1], question: "追问二：职责边界是什么？", answer: "追问二原回答：未承担研发。" }] };
  }
  session = saveFinalAnswer(session, 0, "主轮最终答案：说明本人访谈行动。");
  if (followUps) { session = saveFinalAnswer(session, 1, "追问一最终答案：说明需求记录产物。"); session = saveFinalAnswer(session, 2, "追问二最终答案：说明未承担研发的边界。"); }
  return updateProjectFromSession(created, session);
}

test("主问题与多轮旧ID追问可分别修改刷新，单题导出不串答", async ({ page }, testInfo) => {
  const projects = [anonymousProject(), anonymousProject("anonymous-other-job", false)];
  await page.addInitScript(items => { if (!localStorage.getItem("ai-interview-projects-v1")) localStorage.setItem("ai-interview-projects-v1", JSON.stringify(items)); }, projects);
  await page.goto("/");
  await openPrimary(page, "AI 面试题库");
  await page.getByRole("combobox", { name: "按岗位筛选" }).selectOption("anonymous-p0-job");
  const choose = (question: string) => page.getByRole("button").filter({ has: page.getByRole("heading", { name: question, exact: true }) }).click();
  await choose("主问题：说明你的需求访谈经验。");
  await openDetails(page, "保存我的回答思路");
  const final = page.getByRole("textbox", { name: "最终确认答案" });
  await expect(page.getByText("主轮原回答：我负责需求访谈。", { exact: true })).toBeVisible();
  await expect(final).toHaveValue("主轮最终答案：说明本人访谈行动。");
  await final.fill("修改主轮：保留追问一和追问二的成熟答案。");
  await page.getByRole("button", { name: "保存最终答案", exact: true }).click();
  await openDetails(page, "导出准备记录");
  const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "导出 DOCX", exact: true }).click();
  const file = await downloadPromise;
  const bytes = await readFile((await file.path())!);
  expect(bytes.toString("utf8")).toContain("主轮原回答：我负责需求访谈。");
  expect(bytes.toString("utf8")).toContain("修改主轮：保留追问一和追问二的成熟答案。");
  expect(bytes.toString("utf8")).not.toContain("追问一原回答：形成需求记录。");
  await choose("追问二：职责边界是什么？"); await expect(final).toHaveValue("追问二最终答案：说明未承担研发的边界。");
  await final.fill("修改追问二：继续保留主轮及追问一。"); await page.getByRole("button", { name: "保存最终答案", exact: true }).click();
  await page.reload(); 
  await openPrimary(page, "AI 面试题库");
  await page.getByRole("combobox", { name: "按岗位筛选" }).selectOption("anonymous-p0-job");
  await choose("主问题：说明你的需求访谈经验。"); await expect(final).toHaveValue("修改主轮：保留追问一和追问二的成熟答案。");
  await choose("追问一：具体产物是什么？"); await expect(final).toHaveValue("追问一最终答案：说明需求记录产物。");
  await choose("追问二：职责边界是什么？"); await expect(final).toHaveValue("修改追问二：继续保留主轮及追问一。");
  await page.getByRole("combobox", { name: "按岗位筛选" }).selectOption("anonymous-other-job");
  await expect(final).toHaveValue("主轮最终答案：说明本人访谈行动。");
  await testInfo.attach("precise-answer-rounds.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("GB1中文文字层PDF完整提取并可打开原件，不覆盖人工核对文字", async ({ page }, testInfo) => {
  await page.goto("/"); 
  await openPrimary(page, "个人资料");
  await page.getByLabel("上传个人资料文件").setInputFiles({ name: "匿名GB1简历.pdf", mimeType: "application/pdf", buffer: cjkTextPdf() });
  await page.getByRole("button", { name: "核对文字", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "当前可编辑文字" });
  await expect(editor).toHaveValue(cjkBody);
  await testInfo.attach("cjk-extracted-body.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.getByRole("button", { name: "预览 PDF", exact: true }).click();
  const popupPromise = page.waitForEvent("popup"); await page.getByRole("link", { name: "打开 PDF 预览" }).click();
  const popup = await popupPromise;
  await expect.poll(() => popup.url()).toMatch(/^blob:/);
  await expect(popup.locator('embed[type="application/pdf"]')).toBeVisible();
  await popup.waitForLoadState("networkidle");
  // Native PDF painting has no web DOM readiness event; allow it to paint before visual evidence.
  await popup.waitForTimeout(1500);
  await testInfo.attach("cjk-pdf-open.png", { body: await popup.screenshot(), contentType: "image/png" }); await popup.close();
  await page.getByRole("button", { name: "核对文字", exact: true }).click();
  await editor.fill("用户核对补充：本人负责客户访谈，没有承担研发。");
  await page.getByRole("button", { name: "保存核对文字" }).click(); await page.reload();
  
  await openPrimary(page, "个人资料");
  await page.getByRole("button", { name: "核对文字", exact: true }).click();
  await page.getByText("初始提取文字", { exact: true }).click();
  await expect(editor).toHaveValue("用户核对补充：本人负责客户访谈，没有承担研发。");
  await expect(page.locator("pre")).toHaveText(cjkBody);
  await testInfo.attach("cjk-extraction-and-review.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("只有英文页眉可提取的混合PDF明确提示部分提取和图片OCR回退", async ({ page, browser }) => {
  const source = await browser.newPage();
  await source.setContent('<html><body style="font:30px sans-serif">中文正文：匿名候选人负责客户访谈和需求分析。</body></html>');
  const image = await source.screenshot();
  await source.setContent(`<html><body><p>Anonymous Resume - 2026</p><img style="width:500px" src="data:image/png;base64,${image.toString("base64")}"/></body></html>`);
  const pdf = await source.pdf({ format: "A4" }); await source.close();
  await page.goto("/"); 
  await openPrimary(page, "个人资料");
  await page.getByLabel("上传个人资料文件").setInputFiles({ name: "匿名混合正文.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "核对文字", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "当前可编辑文字" })).toHaveValue("Anonymous Resume - 2026");
  await expect(page.getByRole("status")).toContainText("PDF 文字可能不完整，请核对后使用");
  await page.getByText("提取说明与扫描件处理", { exact: true }).click();
  await expect(page.getByText(/PDF 仅提取可读取的文字层/)).toContainText("部分文字");
  await expect(page.getByText(/PDF 仅提取可读取的文字层/)).toContainText("图片 OCR");
});

test("独立历史满20条可备份、取消或确认选择删除，再返回继续提交", async ({ page }) => {
  const fixture = anonymousProject();
  const records = Array.from({ length: 20 }, (_, index) => ({ ...fixture.session!, id: `anonymous-history-${index}`, preparation: { ...fixture.session!.preparation, job: { ...fixture.session!.preparation.job, title: `匿名旧训练 ${index}` } } }));
  await page.addInitScript(({ records, fixture }) => {
    if (!localStorage.getItem("ai-interview-prep-history-v1")) localStorage.setItem("ai-interview-prep-history-v1", JSON.stringify(records));
    if (!localStorage.getItem("ai-interview-projects-v1")) localStorage.setItem("ai-interview-projects-v1", JSON.stringify([fixture]));
  }, { records, fixture });
  await page.goto("/"); 
  await openPrimary(page, "个人资料");
  await page.getByLabel("上传个人资料文件").setInputFiles({ name: "匿名保留原件.txt", mimeType: "text/plain", buffer: Buffer.from("个人文字与原件不能因历史整理丢失。") });
  await page.getByRole("button", { name: "核对文字", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "当前可编辑文字" })).toHaveValue("个人文字与原件不能因历史整理丢失。");
  await openPrimary(page, "AI 面试题库");
  await page.getByRole("button", { name: "返回题库入口", exact: true }).click();
  await libraryArea(page, "foundation");
  await page.getByRole("button", { name: "开始回答", exact: true }).click(); await page.getByRole("button", { name: "进入回答练习" }).click();
  const text = "匿名新回答：先说明知识理解，再解释可验证的边界和学习计划。";
  // Zero-answer daily sessions are now persisted before opening, so the same limit is reported earlier.
  await expect(page.getByRole("textbox", { name: "本轮回答" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("20 条上限");
  await page.getByRole("button", { name: "整理训练记录", exact: true }).click();
  await page.getByText("文字与训练备份及恢复", { exact: true }).click();
  const exported = page.waitForEvent("download"); await page.getByRole("button", { name: "导出文字与训练备份" }).click(); await exported;
  await expect(page.getByRole("textbox", { name: "可复制的文字与训练备份" })).toHaveValue(/anonymous-history-19/);
  const oldRecord = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名旧训练 0", exact: true }) });
  page.once("dialog", dialog => dialog.dismiss()); await oldRecord.getByRole("button", { name: "删除记录" }).click(); await expect(oldRecord).toBeVisible();
  page.once("dialog", dialog => dialog.accept()); await oldRecord.getByRole("button", { name: "删除记录" }).click(); await expect(oldRecord).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "匿名旧训练 19", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回AI 面试题库", exact: true }).click();
  await page.getByRole("button", { name: "开始回答", exact: true }).click(); await page.getByRole("button", { name: "进入回答练习" }).click();
  await page.getByRole("textbox", { name: "本轮回答" }).fill(text);
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByRole("heading", { name: "点评 → 重答 → 对比" })).toBeVisible();
  await openPrimary(page, "我的岗位"); await expect(page.getByRole("heading", { name: "anonymous-p0-job", exact: true })).toBeVisible();
  await openPrimary(page, "个人资料"); await page.getByRole("button", { name: "核对文字", exact: true }).click(); await expect(page.getByRole("textbox", { name: "当前可编辑文字" })).toHaveValue("个人文字与原件不能因历史整理丢失。");
  await page.getByRole("button", { name: "查看原件", exact: true }).click();
  const originalPromise = page.waitForEvent("download"); await page.getByRole("link", { name: "下载原文件" }).click();
  expect((await readFile((await (await originalPromise).path())!)).toString("utf8")).toBe("个人文字与原件不能因历史整理丢失。");
});

test("个人文字未保存切页可取消，保存失败留文，保存离开后刷新恢复", async ({ page }) => {
  await page.goto("/"); 
  await openPrimary(page, "个人资料");
  await page.getByLabel("上传个人资料文件").setInputFiles({ name: "匿名草稿.txt", mimeType: "text/plain", buffer: Buffer.from("已保存原文：本人负责客户访谈。") });
  await page.getByRole("button", { name: "核对文字", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "当前可编辑文字" });
  await expect(editor).toHaveValue("已保存原文：本人负责客户访谈。");
  await editor.fill("尚未保存的核对修改：本人负责访谈，但未承担研发。");
  await openPrimary(page, "AI 面试题库");
  const dialog = page.getByRole("dialog", { name: "未保存的修改" }); await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "留在当前页" }).click();
  await expect(editor).toHaveValue("尚未保存的核对修改：本人负责访谈，但未承担研发。");
  await page.evaluate(() => { const original = Storage.prototype.setItem; let fail = true; Storage.prototype.setItem = function(key, value) { if (key === "ai-interview-profile-v1" && fail) { fail = false; throw new DOMException("匿名保存失败", "QuotaExceededError"); } return original.call(this, key, value); }; });
  await openPrimary(page, "AI 面试题库"); await page.getByRole("button", { name: "保存后离开" }).click();
  await expect(dialog).toContainText("匿名保存失败"); await page.getByRole("button", { name: "留在当前页" }).click();
  await expect(editor).toHaveValue("尚未保存的核对修改：本人负责访谈，但未承担研发。");
  await openPrimary(page, "AI 面试题库"); await page.getByRole("button", { name: "保存后离开" }).click();
  await expect(page.locator("h1")).toHaveText("AI 面试题库"); await page.reload();
  
  await openPrimary(page, "个人资料");
  await page.getByRole("button", { name: "核对文字", exact: true }).click();
  await expect(editor).toHaveValue("尚未保存的核对修改：本人负责访谈，但未承担研发。");
});

test("岗位批量待核对文字切模块可取消、保存或明确放弃，保存失败不丢字", async ({ page }) => {
  await page.addInitScript(project => localStorage.setItem("ai-interview-projects-v1", JSON.stringify([project])), anonymousProject());
  await page.goto("/"); await page.getByRole("button", { name: "查看岗位" }).click();
  const input = page.getByRole("textbox", { name: "直接粘贴岗位资料文字" });
  await input.fill("匿名岗位要求：需要需求访谈能力。"); await page.getByRole("button", { name: "加入核对" }).click();
  const text = page.getByRole("textbox", { name: "当前文件核对文字" }); await text.fill("人工修改岗位要求：需要访谈与边界意识。");
  await page.getByRole("button", { name: "岗位分析", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "未保存的修改" })).toBeVisible(); await page.getByRole("button", { name: "留在当前页" }).click();
  await expect(text).toHaveValue("人工修改岗位要求：需要访谈与边界意识。");
  await page.getByRole("button", { name: "确认当前文字" }).click(); await page.getByRole("textbox", { name: "资料名称" }).fill("匿名核对批次");
  await page.evaluate(() => { const original = Storage.prototype.setItem; let fail = true; Storage.prototype.setItem = function(key,value) { if(key === "ai-interview-projects-v1" && fail) { fail=false;throw new DOMException("匿名批次保存失败","QuotaExceededError"); }return original.call(this,key,value); }; });
  await page.getByRole("button", { name: "岗位分析", exact: true }).click(); await page.getByRole("button", { name: "保存后离开" }).click();
  await expect(page.getByRole("dialog")).toContainText("匿名批次保存失败"); await page.getByRole("button", { name: "留在当前页" }).click(); await expect(text).toHaveValue("人工修改岗位要求：需要访谈与边界意识。");
  await page.getByRole("button", { name: "岗位分析", exact: true }).click(); await page.getByRole("button", { name: "保存后离开" }).click();
  await expect(page.getByRole("heading", { name: "基于已确认经历的分析" })).toBeVisible();
  await page.getByRole("button", { name: "岗位资料", exact: true }).click(); await expect(page.getByRole("heading", { name: "匿名核对批次" })).toBeVisible();
  await input.fill("应当明确放弃的匿名批次"); await page.getByRole("button", { name: "加入核对" }).click();
  await page.getByRole("button", { name: "岗位分析", exact: true }).click(); await page.getByRole("button", { name: "放弃修改" }).click();
  await page.getByRole("button", { name: "岗位资料", exact: true }).click(); await expect(page.getByRole("heading", { name: "集中核对" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "匿名核对批次" })).toBeVisible();
});

test("题库编辑在切题和筛选时可取消、保存或放弃，不影响其他答案", async ({ page }) => {
  await page.addInitScript(project => { if (!localStorage.getItem("ai-interview-projects-v1")) localStorage.setItem("ai-interview-projects-v1", JSON.stringify([project])); }, anonymousProject());
  await page.goto("/"); 
  await openPrimary(page, "AI 面试题库");
  const choose = (question: string) => page.getByRole("button").filter({ has: page.getByRole("heading", { name: question, exact: true }) }).click();
  await openDetails(page, "保存我的回答思路");
  await choose("主问题：说明你的需求访谈经验。"); const final = page.getByRole("textbox", { name: "最终确认答案" });
  await final.fill("尚未保存的主答：只使用真实的访谈行动。"); await choose("追问一：具体产物是什么？");
  await expect(page.getByRole("dialog", { name: "未保存的修改" })).toBeVisible(); await page.getByRole("button", { name: "留在当前页" }).click();
  await expect(final).toHaveValue("尚未保存的主答：只使用真实的访谈行动。");
  await choose("追问一：具体产物是什么？"); await page.getByRole("button", { name: "保存后离开" }).click();
  await expect(final).toHaveValue("追问一最终答案：说明需求记录产物。");
  await final.fill("这段追问修改应当明确放弃，不替换已保存答案。");
  await page.getByPlaceholder("搜索题目、岗位或已有回答").fill("职责边界"); await page.getByRole("button", { name: "放弃修改" }).click();
  await expect(final).toHaveValue("追问二最终答案：说明未承担研发的边界。");
  await page.getByPlaceholder("搜索题目、岗位或已有回答").fill(""); await choose("主问题：说明你的需求访谈经验。"); await expect(final).toHaveValue("尚未保存的主答：只使用真实的访谈行动。");
  await choose("追问一：具体产物是什么？"); await expect(final).toHaveValue("追问一最终答案：说明需求记录产物。");
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "追问一：具体产物是什么？", exact: true }) });
  await card.getByRole("button", { name: "收藏题目" }).click(); await page.getByRole("checkbox", { name: "仅看收藏" }).check();
  await final.fill("取消收藏前仍未保存的追问文字。"); await card.getByRole("button", { name: "取消收藏" }).click();
  await expect(page.getByRole("dialog", { name: "未保存的修改" })).toBeVisible(); await page.getByRole("button", { name: "留在当前页" }).click();
  await expect(final).toHaveValue("取消收藏前仍未保存的追问文字。");
  await card.getByRole("button", { name: "取消收藏" }).click(); await page.getByRole("button", { name: "放弃修改" }).click();
  await page.getByRole("checkbox", { name: "仅看收藏" }).uncheck(); await choose("追问一：具体产物是什么？");
  await expect(final).toHaveValue("追问一最终答案：说明需求记录产物。");
});

test("两个个人资料同时核对后保存离开标签，不互相覆盖", async ({ page }) => {
  await page.goto("/"); 
  await openPrimary(page, "个人资料");
  await page.getByLabel("上传个人资料文件").setInputFiles([
    { name: "匿名一.txt", mimeType: "text/plain", buffer: Buffer.from("第一份原文：本人访谈。") },
    { name: "匿名二.txt", mimeType: "text/plain", buffer: Buffer.from("第二份原文：本人整理记录。") },
  ]);
  for (const name of ["匿名一.txt", "匿名二.txt"]) await page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) }).getByRole("button", { name: "核对文字", exact: true }).click();
  const first = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名一.txt", exact: true }) }).getByRole("textbox");
  const second = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名二.txt", exact: true }) }).getByRole("textbox");
  await expect(second).toHaveValue("第二份原文：本人整理记录。");
  await first.fill("第一份核对后的文字：本人负责访谈。"); await second.fill("第二份核对后的文字：本人整理需求记录。");
  await page.getByRole("tab", { name: "我的经历" }).click(); await page.getByRole("button", { name: "保存后离开" }).click();
  await page.getByRole("tab", { name: "我的资料" }).click();
  for (const name of ["匿名一.txt", "匿名二.txt"]) await page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) }).getByRole("button", { name: "核对文字", exact: true }).click();
  await expect(first).toHaveValue("第一份核对后的文字：本人负责访谈。"); await expect(second).toHaveValue("第二份核对后的文字：本人整理需求记录。");
});

test("已保存岗位资料收起前保护修改，放弃不删除旧文字", async ({ page }) => {
  const fixture = anonymousProject();
  fixture.materials = [{ id: "anonymous-material", kind: "job_description", title: "匿名已保存资料", content: "已经核对的岗位文字。", source: "manual_text", createdAt: fixture.createdAt, updatedAt: fixture.updatedAt, reviewedAt: fixture.updatedAt }];
  await page.addInitScript(project => localStorage.setItem("ai-interview-projects-v1", JSON.stringify([project])), fixture);
  await page.goto("/"); await page.getByRole("button", { name: "查看岗位" }).click(); await page.getByRole("button", { name: "查看 / 编辑" }).click();
  const editor = page.getByRole("textbox", { name: "核对文字" }); await editor.fill("未保存的岗位修改，不能直接丢失。");
  await page.getByRole("button", { name: "收起", exact: true }).click(); await expect(page.getByRole("dialog", { name: "未保存的修改" })).toBeVisible();
  await page.getByRole("button", { name: "留在当前页" }).click(); await expect(editor).toHaveValue("未保存的岗位修改，不能直接丢失。");
  await page.getByRole("button", { name: "收起", exact: true }).click(); await page.getByRole("button", { name: "放弃修改" }).click();
  await page.getByRole("button", { name: "查看 / 编辑" }).click(); await expect(editor).toHaveValue("已经核对的岗位文字。");
});

test("经历卡文字切标签前保护，保存草稿不会自动确认为个人事实", async ({ page }) => {
  await page.goto("/"); await openPrimary(page, "个人资料"); await page.getByRole("tab", { name: "我的经历" }).click();
  await page.getByRole("button", { name: "手工新建" }).click();
  await page.getByRole("textbox", { name: "经历标题" }).fill("匿名待核对经历");
  await page.getByRole("textbox", { name: "本人行动" }).fill("本人负责访谈，此处是未确认草稿。");
  await page.getByRole("tab", { name: "我的资料" }).click(); await expect(page.getByRole("dialog", { name: "未保存的修改" })).toBeVisible();
  await page.getByRole("button", { name: "留在当前页" }).click(); await expect(page.getByRole("textbox", { name: "本人行动" })).toHaveValue("本人负责访谈，此处是未确认草稿。");
  await page.getByRole("tab", { name: "我的资料" }).click(); await page.getByRole("button", { name: "保存后离开" }).click();
  await page.getByRole("tab", { name: "我的经历" }).click();
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名待核对经历" }) });
  await expect(card).toContainText("待核对"); await expect(card).not.toContainText("已确认"); await expect(card).toContainText("本人负责访谈，此处是未确认草稿。");
});

test("确认引用草稿后编辑框同步已保存答案，切页不误当旧文字为新修改", async ({ page }) => {
  const projects = [anonymousProject("anonymous-source", false), anonymousProject("anonymous-target", false)];
  await page.addInitScript(items => {
    localStorage.setItem("ai-interview-projects-v1", JSON.stringify(items));
    localStorage.setItem("ai-interview-question-library-v1", JSON.stringify({ version: 1, favorites: [], reuseDrafts: [{ id: "anonymous-reuse", sourceKey: "project:anonymous-source:question:anonymous-question", targetKey: "project:anonymous-target:question:anonymous-question", sourceProjectId: "anonymous-source", targetProjectId: "anonymous-target", answer: "引用待核对草稿：说明本人访谈行动。", createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z" }] }));
  }, projects);
  await page.goto("/"); await openPrimary(page, "AI 面试题库");
  await page.getByRole("combobox", { name: "按岗位筛选" }).selectOption("anonymous-target");
  await page.getByRole("textbox", { name: "跨岗位答案草稿" }).fill("用户本轮确认的目标答案：强调自己的真实访谈职责。");
  const confirmation = page.getByRole("button", { name: "本人确认并保存最终答案" });
  await confirmation.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "本人确认并保存最终答案" }).click();
  await openDetails(page, "保存我的回答思路");
  await expect(page.getByRole("textbox", { name: "最终确认答案" })).toHaveValue("用户本轮确认的目标答案：强调自己的真实访谈职责。");
  await openPrimary(page, "个人资料"); await expect(page.getByRole("dialog", { name: "未保存的修改" })).toHaveCount(0);
});
