import { ArrowRight, DatabaseBackup, Download } from "lucide-react";

type SettingsArea = "backup" | "export";

export function SettingsCenter({ onOpen, onBack }: { onOpen: (area: SettingsArea) => void; onBack: () => void }) {
  const actionClass = "mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A84E22]";

  return <div className="space-y-4">
    <p className="text-sm leading-6 text-muted-foreground">管理当前浏览器中的准备资料，或把已保存的内容带到线下复习。数据不会自动上传。</p>
    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-[14px] border border-border bg-white p-6">
        <DatabaseBackup className="text-primary" size={22} />
        <h2 className="mt-4 text-lg font-semibold text-foreground">备份与恢复</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">创建本地 JSON 备份，或先检查备份内容再导入。导入会保留现有资料并追加副本。</p>
        <button type="button" className={actionClass} onClick={() => onOpen("backup")}>打开备份与恢复<ArrowRight size={16} /></button>
      </section>
      <section className="rounded-[14px] border border-border bg-white p-6">
        <Download className="text-primary" size={22} />
        <h2 className="mt-4 text-lg font-semibold text-foreground">导出准备资料</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">选择题目或训练记录，勾选需要的回答与反馈，并生成 DOCX 或 PDF。</p>
        <button type="button" className={actionClass} onClick={() => onOpen("export")}>选择导出内容<ArrowRight size={16} /></button>
      </section>
    </div>
    <p className="rounded-[10px] border border-border bg-card p-4 text-sm leading-6 text-muted-foreground">备份不包含 IndexedDB 中的原始附件。需要原件时，请另外保存原文件；密钥和服务端环境变量不会作为备份字段导出。</p>
  </div>;
}
