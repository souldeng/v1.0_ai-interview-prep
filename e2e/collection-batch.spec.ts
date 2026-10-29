import { expect, test, type Page } from "@playwright/test";
async function enter(page:Page) {
  const menu=page.getByRole("button",{name:"打开导航"});if(await menu.isVisible())await menu.click();
  await page.getByRole("button",{name:/AI 面试题库/}).first().click();
  await page.getByRole("button",{name:"面试资料收集",exact:true}).click();
}
test("混合批次局部失败可恢复，归档与下一批分离，来源和练习持续可读",async({page},info)=>{
  const photo=async(name:string)=>{await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:info.outputPath(name),fullPage:true});};
  const pageErrors:string[]=[];page.on("pageerror",e=>pageErrors.push(e.message));
  await page.route("**/api/health",r=>r.fulfill({json:{modelConfigured:true}}));
  const inputs:string[][]=[];let bad=true;
  await page.route("**/api/model/chat",r=>{
    const req=r.request().postDataJSON(),data=JSON.parse(req.messages[1].content);
    if(req.feature==="material_organization")inputs.push(data.materials.map((m:any)=>m.name));
    const result=req.feature==="material_organization"?{materials:data.materials.map((m:any)=>({materialId:m.id,type:m.text.includes("面试官")?"interview_experience":"job_description",jobTitle:"无依据岗位名",duties:[],requirements:m.text.includes("面试官")?[]:bad&&m.name==="待补充.txt"?["不存在的要求"]:["理解检索"],skills:[],knowledgePoints:[],questions:[{text:m.text.includes("面试官")?"如何评估RAG？":"如何设计检索？",origin:m.text.includes("面试官")?"original":"derived",evidenceQuote:m.text.includes("面试官")?"如何评估RAG？":"理解检索",technical:true}]}))}:{commonRequirements:[],topics:[{text:"检索质量与评估",evidence:[{materialId:data.materials[0].id,quote:"理解检索"}]}],priorities:[]};
    return r.fulfill({json:{content:JSON.stringify(result)}});
  });
  await page.goto("/");await enter(page);
  await expect(page.getByRole("button",{name:"新建收集",exact:true})).toBeVisible();
  await page.getByLabel("上传面试收集资料").setInputFiles([
    {name:"无标题JD.txt",mimeType:"text/plain",buffer:Buffer.from("要求：理解检索")},
    {name:"无标题面经.txt",mimeType:"text/plain",buffer:Buffer.from("面试官问：如何评估RAG？")},
    {name:"待补充.txt",mimeType:"text/plain",buffer:Buffer.from("要求：理解检索")},
  ]);
  await expect(page.getByRole("button",{name:"批量添加文件",exact:true})).toBeEnabled();
  await photo("batch-new.png");
  await page.getByRole("button",{name:"AI 整理并生成面试题",exact:true}).click();
  const completed=page.getByRole("region",{name:"本批整理结果"});
  await expect(completed).toContainText("部分完成");await expect(completed).toContainText("已保存");
  await expect(completed).toContainText("失败 1");await expect(completed).toContainText("题目 2");
  await photo("batch-partial.png");
  await completed.getByRole("button",{name:"查看并核对资料",exact:true}).click();
  await expect(page.getByRole("heading",{name:"已归档批次（1）",exact:true})).toBeVisible();
  await expect(page.getByRole("textbox",{name:"核对文字 待补充.txt",exact:true})).toHaveValue("要求：理解检索");
  await page.getByRole("button",{name:"新建收集",exact:true}).click();
  bad=false;
  await completed.getByRole("button",{name:"重试此项整理",exact:true}).click();
  await expect(completed).toContainText("失败 0");
  expect(inputs).toEqual([["无标题JD.txt","无标题面经.txt","待补充.txt"],["待补充.txt"]]);
  await photo("batch-saved.png");
  await completed.getByRole("button",{name:"查看面试题",exact:true}).click();
  await expect(page.getByRole("heading",{name:"本批原始资料",exact:true})).toHaveCount(0);
  await expect(page.getByRole("region",{name:"资料整理结果"}).getByRole("button",{name:"开始练习",exact:true})).toHaveCount(2);
  await photo("batch-questions.png");
  await page.getByRole("button",{name:"新建收集",exact:true}).click();
  const beforeRemove=await page.evaluate(()=>JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!).collection);
  await page.locator("article").filter({has:page.getByRole("heading",{name:/无标题面经.txt/})}).getByRole("button",{name:"移除本批文件",exact:true}).click();
  await expect(page.getByRole("heading",{name:"已收集资料（2）",exact:true})).toBeVisible();
  const afterRemove=await page.evaluate(()=>JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!).collection);
  expect(afterRemove.materials).toEqual(beforeRemove.materials);expect(afterRemove.analyses).toEqual(beforeRemove.analyses);
  await page.getByRole("button",{name:"开始下一批",exact:true}).click();
  await expect(page.getByRole("heading",{name:"已收集资料（0）",exact:true})).toBeVisible();
  await page.reload();await enter(page);
  await expect(page.getByRole("heading",{name:"已收集资料（0）",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"已整理资料",exact:true}).click();
  await expect(page.getByRole("region",{name:"资料整理结果"})).toContainText("检索质量与评估");
  await page.getByRole("button",{name:"查看原始资料",exact:true}).click();
  await expect(page.getByRole("heading",{name:/无标题面经.txt/})).toBeVisible();
  await photo("batch-archive.png");
  await page.getByRole("button",{name:"面试题集",exact:true}).click();
  await page.getByRole("region",{name:"资料整理结果"}).getByRole("button",{name:"删除题目",exact:true}).first().click();
  await page.reload();await enter(page);await page.getByRole("button",{name:"面试题集",exact:true}).click();
  await expect(page.getByRole("button",{name:"开始练习",exact:true})).toHaveCount(1);
  const article=page.getByRole("region",{name:"资料整理结果"}).locator("article").first(),title=await article.getByRole("heading").innerText();
  await article.getByRole("button",{name:"开始练习",exact:true}).click();
  await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();
  await page.getByRole("button",{name:"返回资料题组",exact:true}).click();
  await expect(page.getByRole("button",{name:"开始练习",exact:true})).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(pageErrors).toEqual([]);
});
