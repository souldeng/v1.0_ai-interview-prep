import assert from "node:assert/strict";
import { test } from "node:test";
import { organizeCollectionMaterials } from "./modelClient";
import { createCollectedMaterial } from "../lib/materialCollection";
test("坏证据只隔离对应资料；成功项和识别失败项可归档，重试只请求未完成项",async(t)=>{
  const good=createCollectedMaterial("无标题JD","要求：理解检索"),bad=createCollectedMaterial("无标题面经","面试官问：如何评测？"),ocr={...createCollectedMaterial("失败截图"),processing:"failed" as const,error:"识别失败"};
  const sent:string[][]=[];let invalid=true;
  t.mock.method(globalThis,"fetch",async(_url:any,options:RequestInit)=>{
    const req=JSON.parse(String(options.body)), data=JSON.parse(req.messages[1].content);
    if(req.feature==="material_organization")sent.push(data.materials.map((m:any)=>m.id));
    const result=req.feature==="material_organization"?{materials:data.materials.map((m:any)=>({materialId:m.id,type:m.id===good.id?"job_description":"interview_experience",jobTitle:"",duties:[],requirements:m.id===good.id?["理解检索"]:[],skills:[],knowledgePoints:[],questions:m.id===bad.id?[{text:"如何评测？",origin:"original",evidenceQuote:invalid?"不存在的证据":"如何评测？",technical:true}]:[]}))}:{commonRequirements:[],topics:[],priorities:[]};
    return new Response(JSON.stringify({content:JSON.stringify(result)}));
  });
  const first=await organizeCollectionMaterials([good,bad,ocr]);
  assert.equal(first.items.length,1);assert.equal(first.failures?.length,2);
  assert.match(first.failures!.find(f=>f.materialId===bad.id)!.message,/无标题面经.*依据/);
  invalid=false;
  const second=await organizeCollectionMaterials([good,bad],{cached:first.items});
  assert.equal(second.items.length,2);assert.equal(second.questions.length,1);
  assert.deepEqual(sent,[[good.id,bad.id],[bad.id]]);
});
test("八份匿名资料分批整理、汇总来源隔离，复用有效分析不再请求", async (t) => {
  const materials = Array.from({ length: 8 }, (_, i) => createCollectedMaterial(`匿名资料${i}`, i % 2 ? "面试官问：如何评估RAG？" : "岗位要求：理解RAG检索与评测"));
  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: any, options: RequestInit) => {
    const body = JSON.parse(String(options.body)); requests.push(body);
    const source = JSON.parse(body.messages[1].content);
    const result = body.feature === "material_organization" ? { materials: source.materials.map((m: any) => ({ materialId: m.id, type: m.text.includes("面试官") ? "interview_experience" : "job_description", jobTitle: "", duties: [], requirements: [], skills: [], knowledgePoints: [], questions: m.text.includes("面试官") ? [{ text: "如何评估RAG？", origin: "original", evidenceQuote: "如何评估RAG？", technical: true }] : [] })) } : { commonRequirements: [{ text: "理解RAG", evidence: [0,2].map(i => ({ materialId: materials[i].id, quote: "理解RAG" })) }], topics: [], priorities: [] };
    return new Response(JSON.stringify({ content: JSON.stringify(result) }));
  });
  const result = await organizeCollectionMaterials(materials);
  assert.equal(result.items.length, 8); assert.equal(result.questions.length, 1);
  assert.equal(requests.filter(r => r.feature === "material_organization").length, 2);
  assert.equal(requests.filter(r => r.feature === "material_summary").length, 1);
  assert.ok(requests.every(r => !JSON.stringify(r).includes("confirmedUserFacts")));
});
test("后续批次失败保留已完成提取，主动重试仅请求失败批次和汇总",async(t)=>{
  const materials=Array.from({length:5},(_,i)=>createCollectedMaterial(`匿名${i}`,"知识：检索"));let cached:any[]=[];let calls=0;
  t.mock.method(globalThis,"fetch",async(_url:any,options:RequestInit)=>{
    calls++;if(calls===2)return new Response('{}',{status:503});
    const request=JSON.parse(String(options.body)),data=JSON.parse(request.messages[1].content);
    return new Response(JSON.stringify({content:JSON.stringify(request.feature==="material_organization"?{materials:data.materials.map((m:any)=>({materialId:m.id,type:"knowledge",jobTitle:"",duties:[],requirements:[],skills:[],knowledgePoints:["检索"],questions:[]}))}:{commonRequirements:[],topics:[],priorities:[]})}));
  });
  const partial=await organizeCollectionMaterials(materials,{onBatch:batch=>cached.push(...batch)});
  assert.equal(partial.items.length,4);assert.equal(partial.failures?.length,1);assert.match(partial.failures![0].message,/503/);assert.ok(partial.summaryError);
  assert.equal(cached.length,4);
  const result=await organizeCollectionMaterials(materials,{cached});assert.equal(result.items.length,5);assert.equal(calls,4);
});
test("取消的迟到整理结果不作为成功返回，未自动重发；超长原文在发送前拒绝",async(t)=>{
  let calls=0;const controller=new AbortController();
  t.mock.method(globalThis,"fetch",async()=>{calls++;controller.abort();return new Response(JSON.stringify({content:'{"materials":[]}'}))});
  await assert.rejects(()=>organizeCollectionMaterials([createCollectedMaterial("匿名","检索")],{signal:controller.signal}),/取消/);
  assert.equal(calls,1);
  await assert.rejects(()=>organizeCollectionMaterials([createCollectedMaterial("过长","检索".repeat(7000))]),/过长/);assert.equal(calls,1);
});
test("综合汇总503仍返回可保存题目，缓存后只重试汇总；全无效指出具体资料",async(t)=>{
  const m=createCollectedMaterial("匿名无标题JD","理解检索");let summaryFails=true;const features:string[]=[];
  t.mock.method(globalThis,"fetch",async(_url:any,options:RequestInit)=>{
    const req=JSON.parse(String(options.body));features.push(req.feature);
    if(req.feature==="material_summary" && summaryFails)return new Response('{}',{status:503});
    return new Response(JSON.stringify({content:JSON.stringify(req.feature==="material_summary"?{commonRequirements:[],topics:[],priorities:[]}:{materials:[{materialId:m.id,type:"job_description",jobTitle:null,duties:[],requirements:["理解检索"],skills:[],knowledgePoints:[],questions:[{text:"如何设计检索？",origin:"derived",evidenceQuote:"理解检索",technical:true}]}]})}));
  });
  const partial=await organizeCollectionMaterials([m]);assert.equal(partial.questions.length,1);assert.match(partial.summaryError??"",/503/);
  summaryFails=false;const retry=await organizeCollectionMaterials([m],{cached:partial.items});
  assert.equal(retry.summaryError,undefined);assert.deepEqual(features,["material_organization","material_summary","material_summary"]);
  const invalid={...m,processing:"failed" as const,error:"未识别文字"};
  await assert.rejects(()=>organizeCollectionMaterials([invalid]),/匿名无标题JD.*未识别文字/);
  assert.equal(features.length,3);
});
test("两个失败项可分别重试，不重新调用已成功资料或未选择的失败项",async(t)=>{
  const materials=["甲","乙","丙"].map(n=>createCollectedMaterial(n,"知识：检索"));const sent:string[][]=[];
  const item=(id:string)=>({materialId:id,type:"knowledge",jobTitle:"",duties:[],requirements:[],skills:[],knowledgePoints:["检索"],questions:[]});
  t.mock.method(globalThis,"fetch",async(_url:any,options:RequestInit)=>{
    const req=JSON.parse(String(options.body)), data=JSON.parse(req.messages[1].content);
    if(req.feature==="material_organization")sent.push(data.materials.map((m:any)=>m.id));
    return new Response(JSON.stringify({content:JSON.stringify(req.feature==="material_organization"?{materials:data.materials.map((m:any)=>item(m.id))}:{commonRequirements:[],topics:[],priorities:[]})}));
  });
  const {validateMaterialExtractions}=await import("../lib/materialCollection");
  const result=await organizeCollectionMaterials(materials,{cached:validateMaterialExtractions([materials[0]],[item(materials[0].id)]),retryIds:[materials[1].id],previousFailures:[{materialId:materials[2].id,stage:"extraction",message:"丙：证据待检查"}]});
  assert.deepEqual(sent,[[materials[1].id]]);assert.equal(result.items.length,2);assert.equal(result.failures?.[0].message,"丙：证据待检查");
});
