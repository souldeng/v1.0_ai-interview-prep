import { expect, test, type Page } from "@playwright/test";
import { openDetails } from "./uiActions";
import { createInterviewProject } from "../src/lib/projects";
import { createPreparation } from "../src/lib/interview";

async function enter(page: Page) {
  const menu = page.getByRole("button", { name: "打开导航" }); if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: /AI 面试题库/ }).first().click();
  await page.getByRole("button", { name: "面试资料收集", exact: true }).click();
}
test("八份资料含OCR失败可逐项恢复，分类去重/原件/删除/训练/刷新复用", async ({ page,context,browser },info) => {
  const project=createInterviewProject({company:"虚构企业",jobTitle:"匿名AI岗位",jobDescription:"原始JD：理解检索与生成。",candidateBackground:"",concerns:""},createPreparation("","原始JD：理解检索与生成。"));
  await page.addInitScript(project=>{if(!localStorage.getItem("ai-interview-projects-v1"))localStorage.setItem("ai-interview-projects-v1",JSON.stringify([project]));},project);
  await page.route("**/api/health", r => r.fulfill({json:{modelConfigured:true,provider:"匿名Mock"}}));
  const surface = await browser.newPage(); await surface.setContent('<p style="font:24px sans-serif">虚构岗位要求：理解 RAG。面试官问：如何评估 RAG？</p>');
  const png = await surface.screenshot(); await surface.close();
  let workers = 0;
  await context.route(/tesseract.*\/worker\.min\.js/, route => {
    const n = workers++, text = n === 0 ? "甲公司岗位要求：理解 RAG。立即沟通" : n === 2 ? "混合笔记：检索与生成。点赞评论" : n === 3 ? "知识笔记：检索与生成。" : "第三方面经：我完成20个项目。面试官问：如何评估 RAG？";
    return route.fulfill({contentType:"application/javascript",body:`self.onmessage=({data:m})=>{if(m.action==='recognize'&&${n}===1){self.postMessage({...m,status:'reject',data:'匿名OCR失败'});return} self.postMessage({...m,status:'resolve',data:m.action==='recognize'?{text:${JSON.stringify(text)}}:{}})}`});
  });
  let calls = 0;
  await page.route("**/api/model/chat", route => {
    const req = route.request().postDataJSON();
    if (req.feature === "interview_followup") return route.fulfill({json:{content:'{"action":"next"}'}});
    if (req.feature === "interview_feedback") {
      expect(JSON.stringify(req.messages)).not.toContain('A_用户本人已确认事实\\\":[\\\"我完成20个项目');
      return route.fulfill({json:{content:JSON.stringify({strengths:["区分了检索与生成"],issues:["补充判断依据"],factRisks:[],suggestions:["用匿名例子说明"],answerStructure:"先解释机制",studyTopics:[],optimizedExample:""})}});
    }
    calls++; const data = JSON.parse(req.messages[1].content);
    if(req.feature === "material_organization") return route.fulfill({json:{content:JSON.stringify({materials:data.materials.map((m:any) => {
      const jd = m.text.includes("岗位要求"), third = m.text.includes("面试官");
      return {materialId:m.id,type:jd?"job_description":third?"interview_experience":m.text.includes("混合")?"mixed":"knowledge",jobTitle:"",duties:[],requirements:jd?["理解 RAG"]:[],skills:[],knowledgePoints:[],questions:[{text:jd?"如何设计RAG检索？":third?"如何评估 RAG？":"检索与生成有什么区别？",origin:third?"original":"derived",evidenceQuote:jd?"理解 RAG":third?"如何评估 RAG？":"检索",technical:true}]};
    })})}});
    const jd = data.materials.filter((m:any)=>m.text.includes("岗位要求"));
    return route.fulfill({json:{content:JSON.stringify({commonRequirements:[{text:"理解RAG的工作机制",evidence:jd.slice(0,2).map((m:any)=>({materialId:m.id,quote:"理解 RAG"}))}],topics:[],priorities:[]})}});
  });
  await page.goto("/"); await enter(page);
  await page.getByLabel("上传面试收集资料").setInputFiles([
    ...["JD甲.png","面经失败.png","混合.png","笔记.png"].map(name=>({name,mimeType:"image/png",buffer:png})),
    ...["乙公司岗位要求：理解 RAG。","丙公司岗位要求：理解 RAG。","面试官问：如何评估 RAG？","笔记：检索与生成。"].map((text,i)=>({name:`匿名${i}.txt`,mimeType:"text/plain",buffer:Buffer.from(text)})),
  ]);
  await expect(page.getByRole("heading",{name:"已收集资料（8）"})).toBeVisible();
  await expect(page.getByRole("button",{name:"批量添加文件",exact:true})).toBeEnabled();
  const failed = page.locator("article").filter({has:page.getByRole("heading",{name:/面经失败.png/})});
  await expect(failed).toContainText("识别失败"); await failed.getByRole("button",{name:"重新识别"}).click();
  await expect(failed).toContainText("已识别");
  await failed.getByRole("button",{name:"查看 / 核对"}).click();
  await expect(page.getByRole("img",{name:"面经失败.png 原图"})).toBeVisible();
  await page.getByLabel("核对文字 面经失败.png").fill("第三方面经：面试官问：如何评估 RAG？");
  await page.getByRole("button",{name:"保存并确认文字"}).click();
  await page.getByRole("button",{name:"AI 整理并生成面试题",exact:true}).click();
  await page.getByRole("button",{name:"已整理资料",exact:true}).click();
  await expect(page.getByText("理解RAG的工作机制",{exact:true}).last()).toBeVisible();
  await page.getByRole("button",{name:"面试题集",exact:true}).click();
  const result = page.getByRole("region",{name:"资料整理结果"});
  await expect(result.getByRole("button",{name:"开始练习",exact:true})).toHaveCount(3);
  expect(calls).toBe(3);
  await page.getByRole("button",{name:"新建收集",exact:true}).click();
  await page.getByRole("button",{name:"AI 整理并生成面试题",exact:true}).click(); expect(calls).toBe(3);
  await failed.getByRole("button",{name:"查看 / 核对"}).click();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:info.outputPath("collection-original-preview.png"),fullPage:true});
  await failed.getByRole("button",{name:"收起详情"}).click();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:info.outputPath("collection-organized.png"),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole("button",{name:"面试题集",exact:true}).click();
  await result.getByRole("button",{name:"删除题目",exact:true}).first().click();
  await expect(result.getByRole("button",{name:"开始练习",exact:true})).toHaveCount(2);
  await page.reload(); await enter(page);
  await page.getByRole("button",{name:"面试题集",exact:true}).click();
  await expect(page.getByRole("region",{name:"资料整理结果"}).getByRole("button",{name:"开始练习",exact:true})).toHaveCount(2);
  const question = page.getByRole("region",{name:"资料整理结果"}).locator("article").first();
  const title = await question.getByRole("heading").innerText();
  await question.getByRole("button",{name:"开始练习",exact:true}).click();
  await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();
  await page.getByLabel("本轮回答",{exact:true}).fill("检索找到相关资料，生成基于资料回答问题。");
  await page.getByRole("button",{name:"提交回答",exact:true}).click();
  await expect(page.getByText("区分了检索与生成",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"返回资料题组",exact:true}).click();
  await expect(page.getByRole("region",{name:"资料整理结果"}).getByRole("button",{name:"开始练习",exact:true})).toHaveCount(2);
  const originalHistory=await page.evaluate(()=>localStorage.getItem("ai-interview-prep-history-v1"));
  await page.getByRole("region",{name:"资料整理结果"}).locator("article").filter({has:page.getByRole("heading",{name:title,exact:true})}).getByRole("button",{name:"删除题目",exact:true}).click();
  expect(await page.evaluate(()=>localStorage.getItem("ai-interview-prep-history-v1"))).toBe(originalHistory);
  await page.getByRole("button",{name:"新建收集",exact:true}).click();
  await failed.getByRole("button",{name:"移除本批文件",exact:true}).click();
  expect(await page.evaluate(()=>localStorage.getItem("ai-interview-prep-history-v1"))).toBe(originalHistory);
  await page.reload();await enter(page);await page.getByRole("button",{name:"面试题集",exact:true}).click();
  await expect(page.getByRole("button",{name:"开始练习",exact:true})).toHaveCount(1);
  await page.getByRole("region",{name:"资料整理结果"}).getByRole("button",{name:"开始练习",exact:true}).first().click();
  await page.getByLabel("本轮回答",{exact:true}).fill("匿名待提交草稿");
  const activeHistory=await page.evaluate(()=>localStorage.getItem("ai-interview-prep-history-v1"));
  for (const old of JSON.parse(originalHistory!)) expect(JSON.parse(activeHistory!).find((s:any)=>s.id===old.id)).toEqual(old);
  await page.getByRole("button",{name:"返回资料题组",exact:true}).click();
  await page.getByRole("region",{name:"资料整理结果"}).getByRole("button",{name:"开始练习",exact:true}).first().click();
  await page.getByRole("button",{name:"保留当前训练",exact:true}).click();
  expect(await page.evaluate(()=>localStorage.getItem("ai-interview-prep-history-v1"))).toBe(activeHistory);
  await page.screenshot({path:info.outputPath("collection-after-training.png"),fullPage:true});
  expect(calls).toBe(3);
  await page.getByRole("button",{name:"已整理资料",exact:true}).click();
  await page.getByRole("button",{name:"查看原始资料",exact:true}).click();
  await failed.getByRole("button",{name:"查看 / 核对"}).click();
  await expect(page.getByRole("img",{name:"面经失败.png 原图"})).toBeVisible();
  await page.getByLabel("关联岗位 面经失败.png").selectOption(project.id);
  const linked=await page.evaluate(()=>JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0]);
  expect(linked.jobDescription).toBe(project.jobDescription);expect(linked.materials).toHaveLength(1);expect(linked.materials[0].kind).toBe("interview_experience");
});

test("整理存储失败保留生成结果，重试保存不重复请求", async ({page},info)=>{
  await page.route("**/api/health",r=>r.fulfill({json:{modelConfigured:true}}));
  let count=0;
  await page.route("**/api/model/chat",route=>{
    count++; const req=route.request().postDataJSON(),data=JSON.parse(req.messages[1].content), m=data.materials[0];
    return route.fulfill({json:{content:JSON.stringify(req.feature==="material_organization"?{materials:[{materialId:m.id,type:"knowledge",jobTitle:"",duties:[],requirements:[],skills:[],knowledgePoints:["RAG"],questions:[{text:"RAG如何工作？",origin:"derived",evidenceQuote:"RAG",technical:true}]}]}:{commonRequirements:[],topics:[],priorities:[]})}});
  });
  await page.goto("/");await enter(page);
  await page.getByLabel("粘贴面试资料").fill("知识笔记：RAG先检索再生成。");await page.getByRole("button",{name:"添加文字",exact:true}).click();
  await page.evaluate(()=>{const old=Storage.prototype.setItem;(window as any).restore=()=>{Storage.prototype.setItem=old};Storage.prototype.setItem=function(k,v){if(k==="ai-interview-question-library-v1"&&JSON.parse(v).collection?.analyses?.length)throw new Error("匿名保存失败");old.call(this,k,v)}});
  await page.getByRole("button",{name:"AI 整理并生成面试题",exact:true}).click();
  await expect(page.getByRole("button",{name:"重试保存整理结果",exact:true})).toBeVisible();expect(count).toBe(2);
  await expect(page.getByRole("region",{name:"本批整理结果"})).toContainText("尚未保存");
  const failedSave=await page.evaluate(()=>JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!).collection);
  expect(failedSave.analyses).toHaveLength(0);expect(failedSave.materials).toHaveLength(1);
  await page.screenshot({path:info.outputPath("collection-save-failed.png"),fullPage:true});
  await page.evaluate(()=>(window as any).restore());await page.getByRole("button",{name:"重试保存整理结果",exact:true}).click();
  await page.getByRole("button",{name:"查看面试题",exact:true}).click();
  await expect(page.getByRole("heading",{name:"RAG如何工作？",exact:true})).toBeVisible();expect(count).toBe(2);
  await page.reload();await enter(page);await page.getByRole("button",{name:"面试题集",exact:true}).click();
  await expect(page.getByRole("heading",{name:"RAG如何工作？",exact:true})).toBeVisible();expect(count).toBe(2);
});
test("取消整理保留资料和旧结果，迟到响应不保存，主动重试可恢复",async({page})=>{
  await page.route("**/api/health",r=>r.fulfill({json:{modelConfigured:true}}));let count=0;let release:()=>void=()=>{};
  await page.route("**/api/model/chat",async route=>{
    count++;const req=route.request().postDataJSON(),data=JSON.parse(req.messages[1].content),m=data.materials[0];
    if(count===1)await new Promise<void>(resolve=>{release=resolve});
    await route.fulfill({json:{content:JSON.stringify(req.feature==="material_organization"?{materials:[{materialId:m.id,type:"knowledge",jobTitle:"",duties:[],requirements:[],skills:[],knowledgePoints:[],questions:[]}]}:{commonRequirements:[],topics:[],priorities:[]})}}).catch(()=>{});
  });
  await page.goto("/");await enter(page);await page.getByLabel("粘贴面试资料").fill("笔记：理解检索。");await page.getByRole("button",{name:"添加文字",exact:true}).click();
  await page.getByRole("button",{name:"AI 整理并生成面试题",exact:true}).click();await expect(page.getByRole("button",{name:"取消整理",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"取消整理",exact:true}).click();release();
  await expect(page.getByRole("button",{name:"AI 整理并生成面试题",exact:true})).toBeEnabled();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!).collection);expect(saved.materials).toHaveLength(1);expect(saved.analyses).toHaveLength(0);
  await page.getByRole("button",{name:"AI 整理并生成面试题",exact:true}).click();await expect(page.getByText("已保存 0 道可练习题。",{exact:true})).toBeVisible();expect(count).toBe(3);
});
test("连续截图由用户显式分组并换序，刷新保留原件与顺序",async({page,context,browser},info)=>{
  await page.route("**/api/health",r=>r.fulfill({json:{modelConfigured:false}}));
  const surface=await browser.newPage();await surface.setContent("<p>虚构同一JD的连续截图</p>");const png=await surface.screenshot();await surface.close();let workers=0;
  await context.route(/tesseract.*\/worker\.min\.js/,route=>{const text=workers++?"要求：理解检索。":"职责：开展需求访谈。";return route.fulfill({contentType:"application/javascript",body:`self.onmessage=({data:m})=>self.postMessage({...m,status:'resolve',data:m.action==='recognize'?{text:${JSON.stringify(text)}}:{}})`})});
  await page.goto("/");await enter(page);await page.getByLabel("上传面试收集资料").setInputFiles(["连续1.png","连续2.png"].map(name=>({name,mimeType:"image/png",buffer:png})));
  await expect(page.getByRole("button",{name:"批量添加文件",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"所选为连续截图",exact:true}).click();
  const second=page.locator("article").filter({has:page.getByRole("heading",{name:/连续2.png/})});await second.getByRole("button",{name:"上移",exact:true}).click();
  const m=await page.evaluate(()=>JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!).collection.materials);
  expect(m.map((i:any)=>i.title)).toEqual(["连续2.png","连续1.png"]);expect(m[0].groupId).toBe(m[1].groupId);expect(m.map((i:any)=>i.groupOrder)).toEqual([0,1]);
  await page.reload();await enter(page);await page.locator("article").filter({has:page.getByRole("heading",{name:/连续2.png/})}).getByRole("button",{name:"查看 / 核对"}).click();
  await expect(page.getByRole("img",{name:"连续2.png 原图"})).toBeVisible();await expect(page.getByLabel("核对文字 连续2.png")).toHaveValue("要求：理解检索。");
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:info.outputPath("collection-group-preview.png"),fullPage:true});
});
