import { libraryArea, openDetails } from "./uiActions";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createPreparation, nextTurn, startSession } from "../src/lib/interview";
import { createInterviewProject } from "../src/lib/projects";

async function openProfile(page: Page) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "个人资料 简历与经历" }).click();
  await expect(page.locator("h1")).toHaveText("个人资料库");
}

async function currentFacts(page: Page): Promise<string[]> {
  return page.evaluate(async () => { const storagePath = "/src/lib/profileStorage.ts", contextPath = "/src/lib/interviewContext.ts"; return (await import(contextPath)).buildInterviewContext({ profile: (await import(storagePath)).loadUserProfile() }).confirmedUserFacts; });
}

test("上传资料默认紧凑，核对文字直接编辑，未保存收起可以取消", async ({ page }, testInfo) => {
  await page.goto("/"); await openProfile(page);
  await page.getByLabel("上传个人资料文件").setInputFiles({ name: "匿名简历.txt", mimeType: "text/plain", buffer: Buffer.from("本人负责客户访谈和需求分析。\n".repeat(40)) });
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名简历.txt", exact: true }) });
  await expect(card).toContainText("待核对");
  await expect(card.getByRole("textbox")).toHaveCount(0);
  await expect(card.locator("pre")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "编辑文字", exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "核对文字", exact: true }).click();
  const text = card.getByRole("textbox", { name: "当前可编辑文字" });
  await expect(text).toHaveValue("本人负责客户访谈和需求分析。\n".repeat(40).trim());
  await text.fill("尚未保存的核对文字：本人访谈，不承担研发。");
  await card.getByRole("button", { name: "核对文字", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "未保存的修改" })).toHaveCount(0);
  await card.getByRole("button", { name: "查看原件", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "未保存的修改" })).toBeVisible();
  await page.getByRole("button", { name: "留在当前页" }).click();
  await expect(text).toHaveValue("尚未保存的核对文字：本人访谈，不承担研发。");
  await card.getByRole("button", { name: "收起", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "未保存的修改" })).toBeVisible();
  await page.getByRole("button", { name: "留在当前页" }).click();
  await expect(text).toHaveValue("尚未保存的核对文字：本人访谈，不承担研发。");
  await card.getByRole("button", { name: "保存核对文字" }).click();
  await expect(card).toContainText("已核对"); await expect(card.getByRole("textbox")).toHaveCount(0);
  await page.reload(); await openProfile(page);
  await card.getByRole("button", { name: "核对文字", exact: true }).click();
  await expect(text).toHaveValue("尚未保存的核对文字：本人访谈，不承担研发。");
  await card.getByRole("button", { name: "收起", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await testInfo.attach("compact-personal-materials.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("个人资料删除不破坏岗位共享附件、独立岗位原件和训练记录", async ({ page }) => {
  const preparation = createPreparation("本人负责需求访谈。", "需要需求分析与访谈能力。"); preparation.job.title = "匿名保留训练";
  const project = createInterviewProject({ company: "匿名公司", jobTitle: "匿名保留岗位", jobDescription: "需要需求分析与访谈能力。", candidateBackground: "本人负责需求访谈。", concerns: "" }, preparation);
  const history = { ...nextTurn(startSession(preparation), "匿名历史原回答：本人负责需求访谈。", { action: "next" }), id: "anonymous-retained-history" };
  await page.goto("/"); await openProfile(page);
  await page.getByLabel("上传个人资料文件").setInputFiles([
    { name: "匿名共享.txt", mimeType: "text/plain", buffer: Buffer.from("共享原件不得被误删。") },
    { name: "匿名独立删除.txt", mimeType: "text/plain", buffer: Buffer.from("此份个人独立原件可以删除。") },
  ]);
  await expect(page.getByRole("heading", { name: "匿名独立删除.txt" })).toBeVisible();
  await page.evaluate(async ({ project, history }) => {
    const profilePath = "/src/lib/profileStorage.ts", filePath = "/src/lib/materialFileStorage.ts", projectPath = "/src/lib/projectStorage.ts", historyPath = "/src/lib/storage.ts";
    const shared = (await import(profilePath)).loadUserProfile().resumes.find((item: { fileName: string }) => item.fileName === "匿名共享.txt");
    await (await import(filePath)).storeMaterialFile("anonymous-job-original", new File(["独立岗位原件必须保留。"], "匿名岗位原件.txt", { type: "text/plain" }));
    const now = project.createdAt;
    (await import(projectPath)).saveProject({ ...project, materials: [
      { id: "anonymous-job-owned", title: "匿名岗位独立资料", kind: "reference", source: "file", sourceFileName: "匿名岗位原件.txt", sourceMimeType: "text/plain", content: "独立岗位原件必须保留。", fileId: "anonymous-job-original", originalSaved: true, reviewedAt: now, createdAt: now, updatedAt: now },
      { id: "anonymous-job-shared", title: "匿名岗位共享资料", kind: "reference", source: "file", sourceFileName: "匿名共享.txt", sourceMimeType: "text/plain", content: "共享原件不得被误删。", fileId: shared.fileId, originalSaved: true, reviewedAt: now, createdAt: now, updatedAt: now },
    ] }); (await import(historyPath)).saveHistory(history);
  }, { project, history });
  await page.reload(); await openProfile(page);
  for (const name of ["匿名独立删除.txt", "匿名共享.txt"]) {
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await card.getByRole("button", { name: "更多操作" }).click(); await page.getByRole("menuitem", { name: "删除资料" }).click(); await page.getByRole("dialog", { name: "删除个人资料" }).getByRole("button", { name: "确认删除", exact: true }).click(); await expect(card).toHaveCount(0);
  }
  const menu = page.getByRole("button", { name: "打开导航" }); if (await menu.isVisible()) await menu.click(); await page.getByRole("button", { name: "我的岗位 岗位与训练" }).click();
  await page.getByRole("button", { name: "查看岗位" }).click();
  for (const [title, expected] of [["匿名岗位独立资料", "独立岗位原件必须保留。"], ["匿名岗位共享资料", "共享原件不得被误删。"]]) {
    const material = page.locator("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await material.getByRole("button", { name: "查看 / 编辑" }).click(); const download = page.waitForEvent("download"); await material.getByRole("link", { name: "下载原件", exact: true }).click();
    expect((await readFile((await (await download).path())!)).toString("utf8")).toBe(expected);
  }
  if (await menu.isVisible()) await menu.click(); await page.getByRole("button", { name: "AI 面试题库 题目与答案" }).click(); await libraryArea(page, "job"); await page.getByRole("button", { name: "整理训练记录" }).click();
  await expect(page.getByRole("heading", { name: "匿名保留训练", exact: true })).toBeVisible();
  expect(await page.evaluate(async () => { const path = "/src/lib/storage.ts"; return (await import(path)).loadHistory()[0].turns[0].answer; })).toBe("匿名历史原回答：本人负责需求访谈。");
});

test("手工新建经历确认保存后默认紧凑，刷新仍可查看和编辑", async ({ page }, testInfo) => {
  await page.goto("/"); await openProfile(page); await page.getByRole("tab", { name: "我的经历" }).click();
  await page.getByRole("button", { name: "手工新建" }).click(); await page.getByRole("textbox", { name: "经历标题" }).fill("匿名用户访谈项目");
  await page.getByRole("textbox", { name: "背景与目标" }).fill("澄清一项应用需求。"); await page.getByRole("textbox", { name: "本人行动" }).fill("本人负责访谈和整理需求，不负责算法研发。");
  await page.getByRole("textbox", { name: "复盘", exact: true }).fill("需要明确职责边界和证据。"); await page.getByRole("checkbox", { name: /我确认这张卡/ }).check(); await page.getByRole("button", { name: "保存经历卡" }).click();
  await page.getByRole("button", { name: "手工新建" }).click(); await page.getByRole("textbox", { name: "经历标题" }).fill("匿名学习记录（待核对）"); await page.getByRole("textbox", { name: "本人行动" }).fill("整理学习笔记，还没有上线成果。"); await page.getByRole("button", { name: "保存经历卡" }).click();
  await page.reload(); await openProfile(page); await page.getByRole("tab", { name: "我的经历" }).click();
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名用户访谈项目", exact: true }) }); await expect(card).toContainText("已确认");
  await expect(page.getByRole("textbox")).toHaveCount(0); await expect(card.getByText("需要明确职责边界和证据。", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await testInfo.attach("compact-personal-experiences.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await card.getByRole("button", { name: "查看详情" }).click(); await expect(card).toContainText("需要明确职责边界和证据。"); await expect(card).toContainText("手工填写，未关联资料。");
  await card.getByRole("button", { name: "编辑", exact: true }).click(); await expect(page.getByRole("textbox", { name: "本人行动" })).toHaveValue("本人负责访谈和整理需求，不负责算法研发。");
});

test("经历卡默认摘要，可查看来源、编辑撤销确认、确认删除且不删资料", async ({ page }, testInfo) => {
  const longResult = "形成需求文档、明确本人职责与未参与范围。".repeat(35);
  await page.goto("/"); await openProfile(page);
  await page.getByLabel("上传个人资料文件").setInputFiles({ name: "匿名经历来源.txt", mimeType: "text/plain", buffer: Buffer.from("本人负责客户访谈，形成需求文档。") });
  await expect(page.getByRole("heading", { name: "匿名经历来源.txt" })).toBeVisible();
  await page.evaluate(async result => {
    const path = "/src/lib/profileStorage.ts"; const { loadUserProfile, saveUserProfile } = await import(path); const profile = loadUserProfile();
    profile.experiences = [{ id: "anonymous-managed-card", title: "匿名访谈经历", type: "工作", situation: "客户需求澄清", action: "本人负责客户访谈", tools: "访谈提纲", result, reflection: "未参与研发与模型训练", notes: "需核对职责边界", confirmed: false, sourceQuotes: [{ materialId: profile.resumes[0].id, quote: "本人负责客户访谈" }], createdAt: profile.updatedAt, updatedAt: profile.updatedAt }]; saveUserProfile(profile);
  }, longResult);
  await page.reload(); await openProfile(page); await page.getByRole("tab", { name: "我的经历" }).click();
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名访谈经历", exact: true, includeHidden: true }) });
  await expect(card.getByText(longResult, { exact: false })).toHaveCount(0);
  await card.getByRole("button", { name: "查看详情", exact: true }).click();
  await expect(card).toContainText("未参与研发与模型训练"); await expect(card).toContainText("访谈提纲"); await expect(card).toContainText("匿名经历来源.txt");
  await card.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("checkbox", { name: /我确认这张卡/ }).check(); await page.getByRole("button", { name: "保存经历卡" }).click();
  await expect(card).toContainText("已确认"); expect((await currentFacts(page)).join("" )).toContain("本人负责客户访谈");
  await card.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("textbox", { name: "本人行动" }).fill("本人负责访谈和整理需求说明。");
  await page.getByRole("button", { name: "取消", exact: true }).click(); await page.getByRole("button", { name: "留在当前页" }).click();
  await expect(page.getByRole("textbox", { name: "本人行动" })).toHaveValue("本人负责访谈和整理需求说明。");
  await page.getByRole("button", { name: "保存经历卡" }).click(); await expect(card).toContainText("待核对"); expect(await currentFacts(page)).toEqual([]);
  await card.getByRole("button", { name: "编辑", exact: true }).click(); await page.getByRole("checkbox", { name: /我确认这张卡/ }).check(); await page.getByRole("button", { name: "保存经历卡" }).click();
  await card.getByRole("button", { name: "删除经历", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "删除经历卡" }); await expect(dialog).toContainText("匿名访谈经历");
  await dialog.getByRole("button", { name: "取消", exact: true }).click(); await expect(card).toContainText("已确认"); expect((await currentFacts(page)).join("" )).toContain("本人负责访谈和整理需求说明。");
  await page.evaluate(() => { const original = Storage.prototype.setItem; let fail = true; Storage.prototype.setItem = function(key, value) { if (key === "ai-interview-profile-v1" && fail) { fail = false; throw new DOMException("匿名经历删除失败", "QuotaExceededError"); } return original.call(this, key, value); }; });
  await card.getByRole("button", { name: "删除经历", exact: true }).click(); await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog).toContainText("匿名经历删除失败"); expect((await currentFacts(page)).join("" )).toContain("本人负责访谈和整理需求说明。");
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click(); await expect(card).toHaveCount(0);
  await page.reload(); await openProfile(page); await page.getByRole("tab", { name: "我的经历" }).click(); await expect(card).toHaveCount(0); expect(await currentFacts(page)).toEqual([]);
  await page.getByRole("tab", { name: "我的资料" }).click();
  const source = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名经历来源.txt" }) }); await source.getByRole("button", { name: "查看原件" }).click();
  const downloaded = page.waitForEvent("download"); await source.getByRole("link", { name: "下载原文件" }).click(); expect((await readFile((await (await downloaded).path())!)).toString("utf8")).toBe("本人负责客户访谈，形成需求文档。");
  await testInfo.attach("experience-source-retained.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("资料写入失败或原件事务中止时保留资料和原件，可明确重试", async ({ page }) => {
  await page.goto("/"); await openProfile(page);
  await page.getByLabel("上传个人资料文件").setInputFiles({ name: "匿名失败保留.txt", mimeType: "text/plain", buffer: Buffer.from("原件失败时必须保留的本人原文。") });
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名失败保留.txt", includeHidden: true }) }); await expect(card).toBeVisible();
  await page.evaluate(() => { const original = Storage.prototype.setItem; let fail = true; Storage.prototype.setItem = function(key, value) { if (key === "ai-interview-profile-v1" && fail) { fail = false; throw new DOMException("匿名资料写入失败", "QuotaExceededError"); } return original.call(this, key, value); }; });
  await card.getByRole("button", { name: "更多操作" }).click(); await page.getByRole("menuitem", { name: "删除资料" }).click(); const dialog = page.getByRole("dialog", { name: "删除个人资料" });
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click(); await expect(dialog).toContainText("匿名资料写入失败"); await expect(card).toBeVisible();
  await page.evaluate(() => { const original = IDBObjectStore.prototype.delete; let abort = true; IDBObjectStore.prototype.delete = function(key) { const request = original.call(this, key); if (abort) { abort = false; const tx = this.transaction; queueMicrotask(() => tx.abort()); } return request; }; });
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog).toContainText("原件删除失败"); await expect(dialog).toContainText("资料记录已恢复"); await expect(card).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.reload(); await openProfile(page); await card.getByRole("button", { name: "查看原件" }).click();
  const original = page.waitForEvent("download"); await card.getByRole("link", { name: "下载原文件" }).click();
  expect((await readFile((await (await original).path())!)).toString("utf8")).toBe("原件失败时必须保留的本人原文。");
  await card.getByRole("button", { name: "更多操作" }).click(); await page.getByRole("menuitem", { name: "删除资料" }).click(); await dialog.getByRole("button", { name: "确认删除", exact: true }).click(); await expect(card).toHaveCount(0);
});

test("批量资料尚在导入时不能并发删除，导入完成后恢复操作", async ({ page }) => {
  await page.goto("/"); await openProfile(page);
  await page.evaluate(() => { const original = File.prototype.text; File.prototype.text = async function() { if (this.name === "匿名稍后.txt") await new Promise<void>(resolve => { (window as any).releaseAnonymousImport = resolve; }); return original.call(this); }; });
  await page.getByLabel("上传个人资料文件").setInputFiles([
    { name: "匿名先导入.txt", mimeType: "text/plain", buffer: Buffer.from("第一份本人文字。") },
    { name: "匿名稍后.txt", mimeType: "text/plain", buffer: Buffer.from("第二份本人文字。") },
  ]);
  const first = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名先导入.txt" }) }); await expect(first).toBeVisible();
  await expect(first.getByRole("button", { name: "更多操作" })).toBeDisabled();
  await page.evaluate(() => (window as any).releaseAnonymousImport());
  await expect(page.getByRole("heading", { name: "匿名稍后.txt" })).toBeVisible(); await expect(first.getByRole("button", { name: "更多操作" })).toBeEnabled();
});

test("关联已确认经历的资料阻止删除，不静默断开来源或删除事实", async ({ page }) => {
  await page.goto("/"); await openProfile(page);
  await page.getByLabel("上传个人资料文件").setInputFiles({ name: "匿名来源.txt", mimeType: "text/plain", buffer: Buffer.from("本人负责客户访谈并形成需求文档。") });
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名来源.txt" }) }); await expect(card).toBeVisible();
  await page.evaluate(async () => {
    const path = "/src/lib/profileStorage.ts"; const { loadUserProfile, saveUserProfile } = await import(path); const profile = loadUserProfile(); const source = profile.resumes[0];
    profile.experiences.push({ id: "anonymous-linked", title: "匿名已确认访谈", situation: "客户需求", action: "本人负责客户访谈", result: "形成需求文档", reflection: "未负责研发", confirmed: true, sourceQuotes: [{ materialId: source.id, quote: "本人负责客户访谈" }], createdAt: profile.updatedAt, updatedAt: profile.updatedAt }); saveUserProfile(profile);
  });
  await page.reload(); await openProfile(page); await card.getByRole("button", { name: "更多操作" }).click(); await page.getByRole("menuitem", { name: "删除资料" }).click();
  const dialog = page.getByRole("dialog", { name: "删除个人资料" }); await expect(dialog).toContainText("匿名已确认访谈"); await expect(dialog.getByRole("button", { name: "确认删除", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click(); await expect(card).toBeVisible();
  await page.getByRole("tab", { name: "我的经历" }).click(); await expect(page.getByRole("heading", { name: "匿名已确认访谈" })).toBeVisible();
  expect(await page.evaluate(async () => { const storagePath = "/src/lib/profileStorage.ts", contextPath = "/src/lib/interviewContext.ts"; return (await import(contextPath)).buildInterviewContext({ profile: (await import(storagePath)).loadUserProfile() }).confirmedUserFacts; })).toEqual(["经历：匿名已确认访谈；背景：客户需求；本人行动：本人负责客户访谈；结果或证据：形成需求文档；复盘：未负责研发"]);
});

test("删除资料须确认，取消保留原件，确认刷新只删对应资料与附件", async ({ page }) => {
  await page.goto("/"); await openProfile(page);
  await page.getByLabel("上传个人资料文件").setInputFiles([
    { name: "匿名待删除.txt", mimeType: "text/plain", buffer: Buffer.from("这份资料仅供删除测试。") },
    { name: "匿名保留.txt", mimeType: "text/plain", buffer: Buffer.from("另一份本人资料与原件必须保留。") },
  ]);
  const target = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名待删除.txt", exact: true }) });
  const other = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名保留.txt", exact: true }) });
  await expect(other).toBeVisible();
  const fileId = await page.evaluate(async () => { const path = "/src/lib/profileStorage.ts"; return (await import(path)).loadUserProfile().resumes.find((item: { fileName: string }) => item.fileName === "匿名待删除.txt").fileId; });
  await target.getByRole("button", { name: "更多操作" }).click(); await page.getByRole("menuitem", { name: "删除资料" }).click();
  const dialog = page.getByRole("dialog", { name: "删除个人资料" }); await expect(dialog).toContainText("匿名待删除.txt");
  await dialog.getByRole("button", { name: "取消", exact: true }).click(); await expect(target).toBeVisible();
  await target.getByRole("button", { name: "查看原件" }).click();
  const original = page.waitForEvent("download"); await target.getByRole("link", { name: "下载原文件" }).click();
  expect((await readFile((await (await original).path())!)).toString("utf8")).toBe("这份资料仅供删除测试。");
  await target.getByRole("button", { name: "更多操作" }).click(); await page.getByRole("menuitem", { name: "删除资料" }).click(); await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(target).toHaveCount(0); await page.reload(); await openProfile(page); await expect(target).toHaveCount(0);
  expect(await page.evaluate(async id => { const path = "/src/lib/materialFileStorage.ts"; return (await import(path)).getMaterialFile(id); }, fileId)).toBeNull();
  await other.getByRole("button", { name: "查看原件" }).click(); const retained = page.waitForEvent("download"); await other.getByRole("link", { name: "下载原文件" }).click();
  expect((await readFile((await (await retained).path())!)).toString("utf8")).toBe("另一份本人资料与原件必须保留。");
});
