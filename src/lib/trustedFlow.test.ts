import assert from "node:assert/strict";
import test from "node:test";
import { createPreparation, evaluateAnswer, finishSession, nextTurn, startSession } from "./interview";
import { compareFeedback, questionForTurn, reviseTurn, reviewTurn } from "./coaching";
import { buildEvidenceTasks, getEvidenceNotes, isEvidenceReady, updateEvidenceNote } from "./careerPlan";
import { createInterviewProject, updateProjectFromSession } from "./projects";
import { deleteProject, loadProjects, saveProject, type StorageLike } from "./projectStorage";
import { exportBackup, importBackup, parseBackup } from "./backup";
import { DRAFT_KEY, loadDrafts, saveDraft } from "./drafts";
import { emptyUserProfile, loadUserProfile, saveUserProfile } from "./profileStorage";
import { emptyQuestionLibrary, loadQuestionLibrary, saveQuestionLibrary } from "./questionLibrary";
import { decideInterviewTurn } from "../services/modelClient";
const input = { jobTitle: "AI 产品", company: "测试", jobDescription: "要求理解 RAG。要求设计模型评测指标。要求监控线上业务指标。", candidateBackground: "我负责 RAG 项目。", concerns: "" };
const prep = () => createPreparation(input.candidateBackground, input.jobDescription);
const project = () => createInterviewProject(input, prep());
function memory(): StorageLike { const map = new Map<string,string>(); return { getItem:k=>map.get(k)??null, setItem:(k,v)=>{map.set(k,v);}, removeItem:k=>{map.delete(k);} }; }

test("错误技术回答不再得到技术准确性或能力分数，引用均来自回答", () => {
  const p = prep(); const answer = "我负责 RAG 项目。结果提升了 100%，RAG 不需要检索，所有模型都永远正确。";
  const feedback = evaluateAnswer(answer, p.questions[0], p);
  assert.equal(feedback.technicalAccuracy, undefined);
  assert.equal(feedback.observations?.find(o=>o.id === "technical")?.status,"unknown");
  for(const o of feedback.observations ?? []) for(const quote of o.quotes) assert.ok(answer.includes(quote));
  assert.equal(feedback.overall,0); // deprecated storage field, never displayed as a score
});
test("否定和计划不当作正向项目匹配；同主题多要求全部保留", () => {
  const p = createPreparation("我从未负责 RAG 项目，也没有评测经验。",input.jobDescription);
  assert.equal(p.matrix[0].status,"gap");
  const tasks = buildEvidenceTasks(input);
  assert.equal(tasks.filter(t=>t.id.startsWith("evaluation")).length,2);
  assert.ok(tasks.some(t=>t.requirement.includes("线上业务指标")));
});
test("直接矛盾附上双方原句，不把未发现冲突说成核验通过", () => {
  const p = prep();
  const result = evaluateAnswer("我没有负责 RAG 项目。结果尚无数据。",p.questions[0],p);
  const conflict = result.observations!.find(o=>o.id==="consistency")!;
  assert.equal(conflict.status,"contradiction");
  assert.deepEqual(conflict.materialQuotes,["我负责 RAG 项目"]);
  assert.equal(evaluateAnswer("我负责其他项目。",p.questions[0],p).observations!.find(o=>o.id==="consistency")!.status,"unknown");
});
test("重答保留原文、不推进进度、报告依照最新回答改变", () => {
  const preparation = prep();
  preparation.questions[0] = { ...preparation.questions[0], category: "经历复盘", technical: false, sourceType: "resume", text: "请说明一个真实项目中你负责的行动与实际产物。" };
  let s = nextTurn(startSession(preparation),"我还没有这方面的经历。",{action:"next"});
  const original = JSON.stringify(s); const before = finishSession(s);
  const revised = reviseTurn(s,0,"我负责需求访谈。产出是访谈纪要。模型训练由团队负责。");
  assert.equal(JSON.stringify(s),original); assert.equal(revised.currentQuestionIndex,s.currentQuestionIndex);
  assert.equal(revised.turns.length,s.turns.length); assert.equal(revised.turns[0].answer,s.turns[0].answer);
  assert.equal(revised.turns[0].revisions?.length,1);
  const comparison = compareFeedback(reviewTurn(s,s.turns[0]),reviewTurn(revised,revised.turns[0]));
  assert.ok(comparison.added.includes("个人行动")); assert.ok(comparison.added.includes("结果或产物"));
  assert.notDeepEqual(finishSession(revised).strengths,before.strengths);
  assert.doesNotMatch(finishSession(revised).overall,/\/5|平均表现/);
  assert.notEqual(updateProjectFromSession(project(),revised).questions[0].status,"mastered");
});
test("追问题重答仍使用原追问题文本", () => {
  const s = nextTurn(nextTurn(startSession(prep()),"这方面我还没有经验。"),"我准备先学习后再实践。");
  assert.equal(questionForTurn(s,s.turns[1]).text,s.turns[1].question);
  const next = reviseTurn(s,1,"我负责整理学习笔记。产出是案例清单。尚未参与生产项目。");
  assert.equal(next.turns[0].revisions,undefined); assert.equal(next.turns[1].revisions?.length,1);
});
test("共享案例更新多个要求，原独立材料仍保存", () => {
  const note = {action:"访谈",result:"纪要",reflection:"未负责研发",confirmed:true,updatedAt:new Date().toISOString()};
  const p = {...project(),cases:{shared:{...note,title:"客户访谈"}},caseLinks:{ai:"shared",evaluation:"shared"},evidenceNotes:{ai:{...note,action:"原独立动作"}}};
  const updated = updateEvidenceNote(p,"ai",{...note,action:"我负责需求访谈",confirmed:false});
  assert.equal(getEvidenceNotes(updated).evaluation.action,"我负责需求访谈");
  assert.equal(updated.evidenceNotes.ai.action,"原独立动作"); assert.equal(getEvidenceNotes(updated).evaluation.confirmed,false);
});
test("嵌套损坏记录不进入可渲染项目，保存不覆盖坏数据", () => {
  const st=memory(); const p={...project(),evidenceNotes:{ai:{confirmed:true}}};
  st.setItem("ai-interview-projects-v1",JSON.stringify([p])); const raw=st.getItem("ai-interview-projects-v1");
  assert.deepEqual(loadProjects(st),[]); assert.equal(isEvidenceReady(p.evidenceNotes.ai as any),false);
  assert.throws(()=>saveProject(project(),st),/损坏/); assert.equal(st.getItem("ai-interview-projects-v1"),raw);
});
test("完整备份往返保留案例、重答及草稿，导入副本不覆盖旧记录", () => {
  const st=memory(); let p=project();
  const s=reviseTurn(nextTurn(startSession(p.preparation!),"我暂时还没有实际经验。",{action:"next"}),0,"我负责整理案例。产出是清单。没有生产经验。");
  p=updateProjectFromSession(p,s); p.cases={one:{title:"学习案例",action:"整理",result:"清单",reflection:"无生产经验",confirmed:true,updatedAt:new Date().toISOString()}}; p.caseLinks={ai:"one"}; saveProject(p,st);
  st.setItem("ai-interview-prep-history-v1",JSON.stringify([s])); st.setItem(DRAFT_KEY,JSON.stringify({[`answer:${s.id}:jd-1`]:"未提交回答",create:JSON.stringify(input)}));
  const backup=exportBackup(st); assert.equal(parseBackup(backup).projects.length,1);
  importBackup(backup,st); const projects=loadProjects(st); assert.equal(projects.length,2); assert.equal(projects[0].id,p.id); assert.notEqual(projects[1].id,p.id);
  assert.equal(projects[1].session?.turns[0].revisions?.length,1); assert.equal(getEvidenceNotes(projects[1]).ai.action,"整理");
  assert.match(st.getItem(DRAFT_KEY)!,/未提交回答/);
});
test("新版完整备份保留个人资料，并仍可导入旧版备份", () => {
  const st=memory(); const profile=emptyUserProfile();
  profile.resumes.push({id:"resume",fileName:"简历.txt",mimeType:"text/plain",size:12,extractedText:"本人经历",parser:"plain-text",createdAt:profile.updatedAt});
  profile.experiences.push({id:"card",title:"真实项目",situation:"背景",action:"本人行动",result:"结果",reflection:"复盘",confirmed:true,createdAt:profile.updatedAt,updatedAt:profile.updatedAt});
  saveUserProfile(profile,st); saveQuestionLibrary({ ...emptyQuestionLibrary(), favorites: ["project:source:question:jd-1"] }, st); const backup=JSON.parse(exportBackup(st));
  assert.equal(backup.version,3); assert.equal(backup.profile.experiences[0].confirmed,true);
  assert.deepEqual(backup.library.favorites,["project:source:question:jd-1"]);
  importBackup(JSON.stringify(backup),st); assert.equal(loadUserProfile(st).experiences.length,2); assert.deepEqual(loadQuestionLibrary(st).favorites,["project:source:question:jd-1"]);
  const legacy={...backup,version:1}; delete legacy.profile;
  importBackup(JSON.stringify(legacy),st); assert.equal(loadUserProfile(st).experiences.length,2);
});
test("备份副本保留文字且不引用原浏览器的 IndexedDB 附件", () => {
  const st = memory();
  const p = project();
  p.materials = [{ id: "m", projectId: p.id, kind: "job_description", title: "JD", content: "要求理解 RAG", source: "file", fileId: "job-file-1", originalSaved: true, reviewedAt: p.updatedAt, parts: [{ id: "part", fileId: "job-file-1", fileName: "jd.pdf", mimeType: "application/pdf", size: 30, initialText: "要求理解 RAG", reviewedText: "要求理解 RAG", originalSaved: true }], createdAt: p.createdAt, updatedAt: p.updatedAt }];
  saveProject(p, st);
  const profile = emptyUserProfile();
  profile.resumes.push({ id: "resume", fileName: "resume.pdf", mimeType: "application/pdf", size: 30, extractedText: "本人项目", parser: "pdf", fileId: "resume-file", originalSaved: true, createdAt: profile.updatedAt });
  saveUserProfile(profile, st);
  importBackup(exportBackup(st), st);
  const imported = loadProjects(st)[1];
  assert.equal(imported.materials?.[0].content, "要求理解 RAG");
  assert.equal(imported.materials?.[0].projectId, imported.id);
  assert.equal(imported.materials?.[0].parts?.[0].fileId, undefined);
  assert.equal(imported.materials?.[0].parts?.[0].originalSaved, false);
  assert.equal(loadUserProfile(st).resumes[1].fileId, undefined);
});
test("格式错误、未知备份版本、超过容量均不改变原数据", () => {
  const st=memory(); saveProject(project(),st); const raw=st.getItem("ai-interview-projects-v1");
  const b=JSON.parse(exportBackup(st)); b.version=4; assert.throws(()=>importBackup(JSON.stringify(b),st));
  b.version=1; b.projects[0].session={bad:true}; assert.throws(()=>importBackup(JSON.stringify(b),st));
  assert.equal(st.getItem("ai-interview-projects-v1"),raw);
});
test("导入中途配额失败回滚先前写入", () => {
  const st=memory(); saveProject(project(),st); const raw=exportBackup(st); let writes=0;
  const failing={...st,setItem:(k:string,v:string)=>{ writes++; if(writes===2) throw new Error("quota"); st.setItem(k,v); }};
  assert.throws(()=>importBackup(raw,failing),/回滚/);
  const before=JSON.parse(raw),after=JSON.parse(exportBackup(st)); assert.deepEqual(after.projects,before.projects); assert.deepEqual(after.history,before.history);
});
test("导入超过项目上限不静默删除现有项目", () => {
  const st=memory(); for(let i=0;i<20;i++) saveProject({...project(),id:`p${i}`},st);
  const raw=st.getItem("ai-interview-projects-v1"); const b=JSON.parse(exportBackup(st)); b.projects=[b.projects[0]];
  assert.throws(()=>importBackup(JSON.stringify(b),st),/上限/); assert.equal(st.getItem("ai-interview-projects-v1"),raw);
});
test("删除项目只清理其草稿且保留其他项目；失败能回滚", () => {
  const st=memory(); const p=project(); saveProject(p,st); const other={...project(),id:"other"}; saveProject(other,st);
  st.setItem(DRAFT_KEY,JSON.stringify({[`edit:${p.id}`]:"旧草稿",'edit:other':"别的草稿"}));
  const raw=st.getItem("ai-interview-projects-v1"); let writes=0;
  const failing={...st,setItem:(k:string,v:string)=>{writes++;if(writes===2)throw new Error("quota");st.setItem(k,v);}};
  assert.throws(()=>deleteProject(p.id,failing),/回滚/); assert.equal(st.getItem("ai-interview-projects-v1"),raw);
  assert.equal(deleteProject(p.id,st).length,1); assert.equal(JSON.parse(st.getItem(DRAFT_KEY)!)['edit:other'],"别的草稿"); assert.equal(JSON.parse(st.getItem(DRAFT_KEY)!)[`edit:${p.id}`],undefined);
});
test("草稿写入可读回，失败不覆盖原草稿", () => {
  const prior=Object.getOwnPropertyDescriptor(globalThis,"localStorage"); const st=memory();
  try { Object.defineProperty(globalThis,"localStorage",{configurable:true,value:st}); saveDraft("create",JSON.stringify(input)); assert.equal(loadDrafts().create,JSON.stringify(input));
    assert.throws(()=>saveDraft("create","大".repeat(600000))); assert.equal(loadDrafts().create,JSON.stringify(input));
  } finally { if(prior) Object.defineProperty(globalThis,"localStorage",prior); else delete (globalThis as any).localStorage; }
});
test("模型追问非字符串安全降级，无外部请求",async () => {
  const prior=globalThis.fetch;
  try { globalThis.fetch=async()=>new Response(JSON.stringify({content:JSON.stringify({action:"follow_up",followUpQuestion:{invalid:true}})}));
    const p=prep(); assert.equal(await decideInterviewTurn(p.questions[0],"我需要更多练习。",p),null);
  } finally { globalThis.fetch=prior; }
});
