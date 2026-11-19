import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  FileDown,
  MoreHorizontal,
  Scissors,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { InterviewProject } from "../../lib/domain";
import type { AnswerReuseDraft, LibraryAnswerStatus, LibraryQuestion, QuestionLibraryState } from "../../lib/questionLibrary";
import { questionSourceLabel } from "../../lib/questionSource";
import { useSafeNavigation, useUnsavedChanges } from "../shared/UnsavedChanges";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";

type ExportFormat = "docx" | "pdf";
const statusLabel: Record<LibraryAnswerStatus, string> = { unanswered: "未练习", answered: "已回答", final: "已确认" };

/** 与 App.deleteLibraryQuestion 同源的删除影响说明；删除确认改为题库内 AlertDialog。 */
const DELETE_IMPACT = "删除后本题不再出现在题库与训练入口；已有训练记录、原答、点评与最终答案全部保留，可从训练记录查看。未备份的题目本身无法恢复。";

/** 来源分组仅用于筛选展示，不改变题目本身语义。 */
type SourceGroup = "all" | "job" | "foundation" | "recorded" | "ai_prediction" | "third_party" | "ai_set";
const sourceFilters: Array<{ id: SourceGroup; label: string }> = [
  { id: "all", label: "全部来源" },
  { id: "job", label: "岗位训练与推荐" },
  { id: "foundation", label: "基础知识题" },
  { id: "recorded", label: "本人真实面试题" },
  { id: "ai_prediction", label: "AI 预测题" },
  { id: "third_party", label: "第三方资料题" },
  { id: "ai_set", label: "AI 专项练习题" },
];
function sourceGroup(entry: LibraryQuestion): Exclude<SourceGroup, "all"> {
  if (entry.sourceType === "ai_prediction") return "ai_prediction";
  if (entry.recordedQuestionId || entry.sourceType === "user_recorded") return "recorded";
  if (entry.recommendedQuestionId) return "job";
  if (entry.sourceType === "third_party") return "third_party";
  if (entry.sourceType === "foundation" || entry.questionId.startsWith("foundation-")) return "foundation";
  if (entry.sourceType === "experience_practice" || entry.sourceType === "material_derived" || entry.questionId.startsWith("experience-set-") || entry.questionId.startsWith("resume-set-") || entry.questionId.startsWith("collected-question-")) return "ai_set";
  return "job";
}

interface QuestionLibraryProps {
  entries: LibraryQuestion[];
  visibleEntries?: LibraryQuestion[];
  projects: InterviewProject[];
  state: QuestionLibraryState;
  /** 岗位筛选由上层持有，岗位工作台入口与题库复用同一份筛选状态。 */
  jobFilter?: string;
  onJobFilterChange?: (jobId: string) => void;
  onToggleFavorite: (key: string) => void;
  onSaveFinal: (entry: LibraryQuestion, answer: string) => string | null;
  onOpenPractice: (projectId: string) => void;
  onRecordedPractice?: (questionId: string) => void;
  onRecommendedPractice?: (recommendedId: string) => void;
  onDeleteQuestion?: (entry: LibraryQuestion, options?: { skipConfirm?: boolean }) => string | null;
  onStartMultiPractice?: (ids: string[]) => void;
  onBatchSplit?: (entry: LibraryQuestion) => void;
  onCreateReuse: (source: LibraryQuestion, target: LibraryQuestion) => string | null;
  onSaveReuse: (id: string, answer: string) => string | null;
  onConfirmReuse: (draft: AnswerReuseDraft, target: LibraryQuestion) => string | null;
  onExport: (entry: LibraryQuestion, format: ExportFormat) => void;
}

function StatusBadge({ status }: { status: LibraryAnswerStatus }) {
  if (status === "final") return <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">{statusLabel[status]}</Badge>;
  if (status === "answered") return <Badge variant="secondary">{statusLabel[status]}</Badge>;
  return <Badge variant="outline" className="border-border text-muted-foreground">{statusLabel[status]}</Badge>;
}

/** 详情面板内默认折叠的次级信息（原回答 / AI 建议 / 来源说明等）。 */
function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <Collapsible>
    <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-md py-1.5 text-left text-[13px] font-medium text-muted-foreground transition-all outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.99] [&[data-panel-open]>svg]:rotate-180">
      {title}
      <ChevronDown size={15} className="shrink-0 transition-transform duration-150" />
    </CollapsibleTrigger>
    <CollapsibleContent className="overflow-hidden data-[starting-style]:h-0 data-[ending-style]:h-0 transition-[height] duration-150">
      <div className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-[14px] leading-6 text-foreground">{children}</div>
    </CollapsibleContent>
  </Collapsible>;
}

export function QuestionLibrary({ entries, visibleEntries = entries, projects, state, jobFilter, onJobFilterChange, onToggleFavorite, onSaveFinal, onOpenPractice, onRecordedPractice, onRecommendedPractice, onDeleteQuestion, onStartMultiPractice, onBatchSplit, onCreateReuse, onSaveReuse, onConfirmReuse, onExport }: QuestionLibraryProps) {
  const navigate = useSafeNavigation();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState(""); const [internalJobId, setInternalJobId] = useState("all"); const [category, setCategory] = useState("all");
  // 单份筛选状态：优先使用上层受控值，未传入时保持组件内状态。
  const jobId = jobFilter ?? internalJobId;
  const selectJob = (value: string) => { if (jobFilter === undefined) setInternalJobId(value); onJobFilterChange?.(value); };
  const jobCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of entries) { const owner = item.associatedProjectId ?? item.projectId; if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1); }
    return counts;
  }, [entries]);
  const [status, setStatus] = useState<"all" | LibraryAnswerStatus>("all"); const [favoritesOnly, setFavoritesOnly] = useState(false); const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceGroup>("all");
  const [multiIds, setMultiIds] = useState<string[]>([]);
  const [showMultiPreview, setShowMultiPreview] = useState(false);
  const [finalDraft, setFinalDraft] = useState(""); const [reuseTargetKey, setReuseTargetKey] = useState(""); const [reuseEdits, setReuseEdits] = useState<Record<string, string>>({});
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<LibraryQuestion | null>(null);
  const categories = useMemo(() => [...new Set(visibleEntries.map(item => item.category))].sort(), [visibleEntries]);
  const filtered = useMemo(() => visibleEntries.filter(item => {
    const keywords = `${item.question}\n${item.projectName}\n${item.originalAnswer}\n${item.finalAnswer}`.toLocaleLowerCase();
    return (jobId === "all" || (item.associatedProjectId ?? item.projectId) === jobId) && (category === "all" || item.category === category) && (status === "all" || item.answerStatus === status)
      && (sourceFilter === "all" || sourceGroup(item) === sourceFilter)
      && (!favoritesOnly || item.favorite) && (!search.trim() || keywords.includes(search.trim().toLocaleLowerCase()));
  }), [visibleEntries, jobId, category, status, favoritesOnly, search, sourceFilter]);
  const selected = filtered.find(item => item.key === selectedKey) ?? filtered[0] ?? null;
  useEffect(() => {
    if (selected && selected.key !== selectedKey) {
      setSelectedKey(selected.key);
      setFinalDraft(selected.finalAnswer);
    }
  }, [selected?.key, selected?.finalAnswer, selectedKey]);
  const targetOptions = selected?.projectId ? entries.filter(item => item.projectId && item.projectId !== selected.projectId) : [];
  const reuseDrafts = selected ? state.reuseDrafts.filter(draft => draft.targetKey === selected.key) : [];
  const canSaveFinal = Boolean(selected?.sessionId) && selected?.turnIndex !== undefined;
  const primaryAction: "practice" | "save" | null = !selected?.recordedQuestionId ? null : selected.answerStatus === "answered" ? "save" : "practice";
  const jobName = jobId === "all" ? "全部岗位与记录" : projects.find(project => project.id === jobId)?.jobTitle || "未命名岗位";
  const reuseTargetName = reuseTargetKey ? (() => { const target = entries.find(item => item.key === reuseTargetKey); return target ? `${target.projectName}｜${target.question.slice(0, 28)}` : "选择目标岗位题目"; })() : "选择目标岗位题目";
  const choose = (entry: LibraryQuestion) => navigate(() => { setSelectedKey(entry.key); setFinalDraft(entry.finalAnswer); setReuseTargetKey(""); if (isMobile) setMobileDetailOpen(true); });
  const saveFinal = () => { if (!selected) return "请先选择题目。"; const message = onSaveFinal(selected, finalDraft); if (message) toast.error(message); else { toast.success("最终确认答案已保存到对应训练记录。"); setFinalDraft(finalDraft.trim()); } return message; };
  const changedReuse = state.reuseDrafts.some(draft => reuseEdits[draft.id] !== undefined && reuseEdits[draft.id] !== draft.answer);
  useUnsavedChanges("library-answers", Boolean(selected && finalDraft !== selected.finalAnswer) || changedReuse, {
    label: "题库答案", save: () => changedReuse ? "请先逐份保存引用草稿，再离开；修改仍保留。" : saveFinal(),
    discard: () => { setFinalDraft(selected?.finalAnswer ?? ""); setReuseEdits({}); },
  });
  const createReuse = () => {
    if (!selected || !reuseTargetKey) return;
    const target = entries.find(item => item.key === reuseTargetKey); if (!target) return;
    const message = onCreateReuse(selected, target);
    if (message) toast.error(message); else { toast.success("已建立目标岗位的独立答案草稿；来源答案不会被修改。"); setReuseTargetKey(""); }
  };
  const saveReuse = (draft: AnswerReuseDraft) => { const message = onSaveReuse(draft.id, reuseEdits[draft.id] ?? draft.answer); if (message) toast.error(message); else toast.success("目标岗位答案草稿已保存。"); };
  const confirmReuse = (draft: AnswerReuseDraft) => {
    if (!selected) return; const message = onConfirmReuse({ ...draft, answer: reuseEdits[draft.id] ?? draft.answer }, selected);
    if (message) toast.error(message); else { toast.success("已由你确认并保存为目标岗位的最终答案。"); setFinalDraft((reuseEdits[draft.id] ?? draft.answer).trim()); }
  };
  const confirmDelete = () => {
    const entry = deleteCandidate; if (!entry) return;
    setDeleteCandidate(null);
    const message = onDeleteQuestion?.(entry, { skipConfirm: true });
    if (message) toast.error(message); else toast.success("题目已从题库移除；已有训练记录与最终答案仍保留。");
  };
  // 多题训练：仅手动导入题目可勾选；按勾选顺序组成本轮题组。
  const toggleMulti = (entry: LibraryQuestion) => navigate(() => {
    if (!entry.recordedQuestionId) return;
    setMultiIds(current => current.includes(entry.recordedQuestionId!) ? current.filter(id => id !== entry.recordedQuestionId) : [...current, entry.recordedQuestionId!]);
    setShowMultiPreview(true);
  });
  const multiEntries = multiIds.map(id => entries.find(entry => entry.recordedQuestionId === id)).filter((entry): entry is LibraryQuestion => Boolean(entry));
  const practiceLabel = selected?.answerStatus === "final" ? "再次练习这道题" : "练习这道题";

  /** 详情面板正文：桌面/窄屏渲染进 aside，手机渲染进底部 Sheet。 */
  const renderDetail = (selected: LibraryQuestion) => <>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] text-muted-foreground">{selected.projectName} · {selected.company}</p>
        <h2 className="mt-1.5 text-[17px] font-semibold leading-6 text-card-foreground">{selected.question}</h2>
      </div>
      {selected.projectId && <Button variant="ghost" size="icon-sm" aria-label="进入对应岗位训练" title="进入对应岗位训练" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => navigate(() => onOpenPractice(selected.projectId!))}><ExternalLink size={17} /></Button>}
    </div>
    <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground"><StatusBadge status={selected.answerStatus} /><span aria-hidden className="text-border">·</span><span>{questionSourceLabel(selected)}</span><span aria-hidden className="text-border">·</span><span>{selected.category}</span>{selected.recordedOrder !== undefined && <><span aria-hidden className="text-border">·</span><span>原始顺序第 {selected.recordedOrder} 题</span></>}</p>
    <div className="mt-4 flex flex-wrap gap-2">
      {selected.recommendedQuestionId && <Button data-cta="primary" onClick={() => navigate(() => onRecommendedPractice?.(selected.recommendedQuestionId!))}>练习这道题</Button>}
      {selected.recordedQuestionId && primaryAction === "practice" && <Button data-cta="primary" onClick={() => navigate(() => onRecordedPractice?.(selected.recordedQuestionId!))}>{practiceLabel}</Button>}
      {selected.recordedQuestionId && primaryAction === "save" && <Button data-cta="primary" onClick={saveFinal} disabled={!canSaveFinal}>保存最终答案</Button>}
      {selected.recordedQuestionId && primaryAction !== "practice" && <Button variant="outline" onClick={() => navigate(() => onRecordedPractice?.(selected.recordedQuestionId!))}>{practiceLabel}</Button>}
      {selected.recordedQuestionId && primaryAction === "practice" && canSaveFinal && <Button variant="outline" onClick={saveFinal}>保存最终答案</Button>}
    </div>
    {selected.recordedQuestionId && <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{selected.sessionId ? "已保存回答与点评；保存最终答案后会成为本题的确认版本。" : "本题尚无已提交回答；先练习作答，再保存本人认可的思路。"}</p>}
    <label className="mt-4 block text-[14px] font-medium text-card-foreground">最终确认答案<Textarea value={finalDraft} onChange={event => setFinalDraft(event.target.value)} maxLength={12000} placeholder="只有手动保存的内容才会成为最终确认答案。" className="mt-2 min-h-32 w-full bg-white" /></label>
    {primaryAction !== "save" && <Button variant="outline" onClick={saveFinal} disabled={!canSaveFinal} className="mt-3">保存最终答案</Button>}
    {!canSaveFinal && !selected.recommendedQuestionId && <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{selected.recordedQuestionId ? "本题还没有已提交回答，提交后才能保存最终答案。" : "该题只有岗位题目、尚无对应训练轮次；请先进入岗位作答后再保存最终答案。"}</p>}
    <div className="mt-4 space-y-1 border-t border-border pt-2">
      <InfoSection title="原回答">{selected.originalAnswer || "（未填写）"}</InfoSection>
      {selected.suggestion && <InfoSection title="既有改进建议">{selected.suggestion}</InfoSection>}
      {(selected.recordedQuestionId || selected.recommendedQuestionId) && <InfoSection title="来源说明">{selected.recordedQuestionId ? `${selected.sourceType === "ai_prediction" ? "本题来自 AI 预测题库，仅供练习；不是企业真实面试记录、第三方面经或个人经历。" : "本题来自你本人记录的真实面试；平台未独立核实面试官原话。"}${selected.splitFromId ? "由一道历史超长题目拆分而来。" : ""}${selected.recordedCategory ? `面经分类：${selected.recordedCategory}。` : ""}` : "本题来自岗位分析推荐（AI 建议，非企业面试原题），已加入岗位专项题库。"}</InfoSection>}
    </div>
    {selected && <div className="mt-3 border-t border-border pt-3">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground"><MoreHorizontal size={16} />更多操作</Button>} aria-label="更多操作" />
        <DropdownMenuContent align="end" className="w-48">
          {selected.recordedQuestionId && onBatchSplit && <DropdownMenuItem onClick={() => navigate(() => onBatchSplit(selected))}><Scissors size={15} />拆分为多道题</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => onExport(selected, "docx")}><FileDown size={15} />导出 DOCX</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExport(selected, "pdf")}><FileDown size={15} />导出 PDF</DropdownMenuItem>
          {(selected.recordedQuestionId || selected.recommendedQuestionId) && onDeleteQuestion && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => setDeleteCandidate(selected)}><Trash2 size={15} />删除这道题</DropdownMenuItem></>}
        </DropdownMenuContent>
      </DropdownMenu>
      {(selected.recordedQuestionId || selected.recommendedQuestionId) && onDeleteQuestion && <p className="mt-1 text-[12px] leading-5 text-muted-foreground">删除仅移除题库条目；已有训练记录、回答与最终答案保留，可从训练记录查看。</p>}
    </div>}
    {selected.finalAnswer.trim() && targetOptions.length > 0 && <div className="mt-3 border-t border-border pt-3">
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-md py-1.5 text-left text-[13px] font-medium text-muted-foreground transition-all outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&[data-panel-open]>svg]:rotate-180">跨岗位引用<ChevronDown size={15} className="shrink-0 transition-transform duration-150" /></CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[starting-style]:h-0 data-[ending-style]:h-0 transition-[height] duration-150">
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">复制为目标岗位的独立草稿，不会改动来源答案，也不会自动标记为最终答案。</p>
          <div className="mt-2 flex gap-2">
            <Select value={reuseTargetKey || "none"} onValueChange={value => setReuseTargetKey(value === "none" ? "" : String(value))}>
              <SelectTrigger aria-label="选择引用目标题目" className="w-full min-w-0"><SelectValue>{reuseTargetName}</SelectValue></SelectTrigger>
              <SelectContent className="max-h-72"><SelectItem value="none">选择目标岗位题目</SelectItem>{targetOptions.map(item => <SelectItem key={item.key} value={item.key}>{item.projectName}｜{item.question.slice(0, 28)}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" onClick={createReuse} disabled={!reuseTargetKey} className="shrink-0 text-primary">创建草稿</Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>}
    {reuseDrafts.length > 0 && <div className="mt-3 border-t border-border pt-3">
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-md py-1.5 text-left text-[13px] font-medium text-muted-foreground transition-all outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&[data-panel-open]>svg]:rotate-180">来自其他岗位的答案草稿（{reuseDrafts.length}）<ChevronDown size={15} className="shrink-0 transition-transform duration-150" /></CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[starting-style]:h-0 data-[ending-style]:h-0 transition-[height] duration-150">
          {reuseDrafts.map(draft => <div key={draft.id} className="mt-2 rounded-md bg-muted/50 p-3">
            <Textarea aria-label="跨岗位答案草稿" value={reuseEdits[draft.id] ?? draft.answer} onChange={event => setReuseEdits(current => ({ ...current, [draft.id]: event.target.value }))} className="min-h-24 w-full bg-white" />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => saveReuse(draft)}>保存草稿</Button>
              <Button variant="outline" size="sm" disabled={!canSaveFinal} onClick={() => confirmReuse(draft)} className="border-emerald-200 text-emerald-700 hover:bg-emerald-50">本人确认并保存最终答案</Button>
            </div>
            {draft.confirmedAt && <p className="mt-2 text-[13px] text-emerald-700">已于 {new Date(draft.confirmedAt).toLocaleDateString("zh-CN")} 保存为目标岗位最终答案。</p>}
          </div>)}
        </CollapsibleContent>
      </Collapsible>
    </div>}
  </>;

  if (!visibleEntries.length) return <p className="py-4 text-[15px] text-muted-foreground">这里还没有已保存的题目或回答。</p>;
  return <div className="space-y-6">
    {multiIds.length > 0 && showMultiPreview && <section aria-label="多题训练预览" className="rounded-xl border border-primary/30 bg-accent/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-card-foreground">本轮将训练 {multiIds.length} 道题</h3>
        <div className="flex gap-2">
          <Button data-cta="primary" disabled={!onStartMultiPractice} onClick={() => onStartMultiPractice?.(multiIds)}>开始多题训练</Button>
          <Button variant="outline" onClick={() => navigate(() => { setMultiIds([]); setShowMultiPreview(false); })}>清空选择</Button>
        </div>
      </div>
      <ol className="mt-3 max-h-56 space-y-1.5 overflow-auto text-[14px] leading-6 text-card-foreground">{multiEntries.map((entry, index) => <li key={entry.key} className="break-words">{index + 1}. {entry.question}</li>)}</ol>
      <p className="mt-2 text-[13px] text-muted-foreground">选中几道就训练几道；顺序与上方一致，不会自动补入其他题目，也不会覆盖正在进行的训练。</p>
    </section>}
    <section aria-label="题目筛选" className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="relative block w-full sm:min-w-[220px] sm:flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={event => { const value = event.target.value; navigate(() => setSearch(value)); }} placeholder="搜索题目、岗位或已有回答" aria-label="搜索题目、岗位或已有回答" className="pl-9" />
        </label>
        <Select value={jobId} onValueChange={value => navigate(() => selectJob(String(value)))}>
          <SelectTrigger aria-label="按岗位筛选" className="w-full sm:w-[200px]"><SelectValue>{jobName}</SelectValue></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">全部岗位与记录</SelectItem>
            {projects.map(project => <SelectItem key={project.id} value={project.id}>{project.jobTitle || "未命名岗位"}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={value => navigate(() => setCategory(String(value)))}>
          <SelectTrigger aria-label="按题型筛选" className="w-full sm:w-[160px]"><SelectValue>{category === "all" ? "全部题型" : category}</SelectValue></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">全部题型</SelectItem>
            {categories.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={value => navigate(() => setSourceFilter(String(value) as SourceGroup))}>
          <SelectTrigger aria-label="按来源筛选" className="w-full sm:w-[170px]"><SelectValue>{sourceFilters.find(filter => filter.id === sourceFilter)?.label}</SelectValue></SelectTrigger>
          <SelectContent className="max-h-72">
            {sourceFilters.map(filter => <SelectItem key={filter.id} value={filter.id}>{filter.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={value => navigate(() => setStatus(String(value) as "all" | LibraryAnswerStatus))}>
          <SelectTrigger aria-label="按答案状态筛选" className="w-full sm:w-[150px]"><SelectValue>{status === "all" ? "全部答案状态" : statusLabel[status]}</SelectValue></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">全部答案状态</SelectItem>
            <SelectItem value="unanswered">未练习</SelectItem>
            <SelectItem value="answered">已回答</SelectItem>
            <SelectItem value="final">已确认</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="inline-flex cursor-pointer items-center gap-2 text-[14px] text-muted-foreground transition-colors hover:text-foreground">
          <Checkbox checked={favoritesOnly} onCheckedChange={checked => { const value = checked === true; navigate(() => setFavoritesOnly(value)); }} aria-label="仅看收藏" />
          仅看收藏
        </label>
        {jobId !== "all" && <button type="button" onClick={() => navigate(() => selectJob("all"))} aria-label={`清除岗位筛选：${jobName}`} title="清除岗位筛选" className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[13px] font-medium text-accent-foreground transition-all outline-none hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]">
          当前岗位 · {jobName}
          <X size={13} aria-hidden />
        </button>}
      </div>
    </section>
    <div className="grid gap-5 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.9fr)]">
      <section className="space-y-2" aria-label="题目列表">
        {filtered.length ? filtered.map(entry => {
          const isRecorded = Boolean(entry.recordedQuestionId);
          const isSelected = selected?.key === entry.key;
          return <article key={entry.key} className={`rounded-lg p-3 transition-all ${isSelected ? "bg-accent ring-1 ring-primary/25" : "ring-1 ring-transparent hover:bg-accent/40"}`}>
            <div className="flex items-start justify-between gap-3">
              {isRecorded && <Checkbox className="mt-1.5" aria-label={`勾选参加多题训练：${entry.question.slice(0, 30)}`} checked={multiIds.includes(entry.recordedQuestionId!)} onCheckedChange={() => toggleMulti(entry)} />}
              <button onClick={() => choose(entry)} className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                <StatusBadge status={entry.answerStatus} />
                <h2 className="mt-1.5 font-medium leading-6 text-card-foreground">{entry.question}</h2>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground">
                  <span className="font-medium">{entry.projectName}</span>
                  <span aria-hidden>·</span>
                  <span>{questionSourceLabel(entry)}</span>
                  <span aria-hidden>·</span>
                  <span>{entry.category}</span>
                </p>
              </button>
              <Button variant="ghost" size="icon-sm" aria-label={entry.favorite ? "取消收藏" : "收藏题目"} title={entry.favorite ? "取消收藏" : "收藏题目"} onClick={() => { if (favoritesOnly && selected?.key === entry.key) navigate(() => onToggleFavorite(entry.key)); else onToggleFavorite(entry.key); }} className={`shrink-0 ${entry.favorite ? "text-primary hover:text-primary" : "text-muted-foreground hover:text-primary"}`}>
                <Star size={18} className={entry.favorite ? "fill-current" : ""} />
              </Button>
            </div>
          </article>;
        }) : <p className="rounded-lg border border-dashed border-input bg-card p-6 text-[15px] text-muted-foreground">没有符合当前筛选条件的既有题目。</p>}
      </section>
      {!isMobile && selected && <aside className="min-w-0 h-fit rounded-xl border border-border bg-card p-5 shadow-sm xl:sticky xl:top-24">{renderDetail(selected)}</aside>}
    </div>
    {isMobile && selected && <Sheet open={mobileDetailOpen} onOpenChange={setMobileDetailOpen}>
      <SheetContent side="bottom" aria-label="题目详情" className="h-[88dvh] gap-0 p-0">
        <aside className="min-h-0 flex-1 overflow-y-auto p-5">{renderDetail(selected)}</aside>
      </SheetContent>
    </Sheet>}
    {deleteCandidate && <AlertDialog open onOpenChange={open => { if (!open) setDeleteCandidate(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除这道题？</AlertDialogTitle>
          <AlertDialogDescription>「{deleteCandidate.question.slice(0, 40)}」{DELETE_IMPACT}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/30" onClick={confirmDelete}>删除这道题</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>}
  </div>;
}
