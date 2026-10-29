import { useState, type ReactNode } from "react";
import { BrainCircuit, BriefcaseBusiness, LibraryBig, Menu, PanelLeftClose, PanelLeftOpen, Settings2, UserRound, X, type LucideIcon } from "lucide-react";

export type PrimaryPage = "jobs" | "profile" | "library";

const navigation: Array<{ id: PrimaryPage; label: string; description: string; icon: LucideIcon }> = [
  { id: "jobs", label: "我的岗位", description: "岗位与训练", icon: BriefcaseBusiness },
  { id: "profile", label: "个人资料", description: "简历与经历", icon: UserRound },
  { id: "library", label: "AI 面试题库", description: "题目与答案", icon: LibraryBig },
];

interface AppShellProps {
  activePage: PrimaryPage;
  title: string;
  description: string;
  breadcrumbs?: string[];
  children: ReactNode;
  navigationDisabled?: boolean;
  onNavigate: (page: PrimaryPage) => void;
  onSettings: () => void;
}

export function AppShell({ activePage, title, description, breadcrumbs = [], children, navigationDisabled = false, onNavigate, onSettings }: AppShellProps) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const selectPage = (page: PrimaryPage) => {
    if (navigationDisabled) return;
    onNavigate(page);
    setMobileNavigationOpen(false);
  };

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    {mobileNavigationOpen && <button aria-label="关闭导航遮罩" className="fixed inset-0 z-30 bg-slate-950/20 lg:hidden" onClick={() => setMobileNavigationOpen(false)} />}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white px-3 py-4 shadow-xl transition-transform lg:translate-x-0 lg:shadow-none ${collapsed ? "lg:w-20" : "lg:w-64"} ${mobileNavigationOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className={`mb-7 flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
        <button onClick={() => selectPage("jobs")} disabled={navigationDisabled} className="flex min-w-0 items-center gap-3 text-left disabled:cursor-not-allowed" aria-label="返回我的岗位">
          <span className="rounded-xl bg-blue-700 p-2 text-white"><BrainCircuit size={20}/></span>
          {!collapsed && <span className="min-w-0"><span className="block truncate font-semibold tracking-tight">AI 面试通</span><span className="mt-0.5 block text-xs text-slate-500">真实经历，轻量准备</span></span>}
        </button>
        <button aria-label="折叠侧栏" className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:block" onClick={() => setCollapsed(value => !value)}>{collapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button>
        <button aria-label="关闭导航" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setMobileNavigationOpen(false)}><X size={18}/></button>
      </div>
      <nav aria-label="一级导航" className="space-y-1">
        {navigation.map(item => {
          const Icon = item.icon;
          const active = activePage === item.id;
          return <button key={item.id} title={collapsed ? item.label : undefined} aria-current={active ? "page" : undefined} disabled={navigationDisabled} onClick={() => selectPage(item.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${active ? "bg-blue-50 text-blue-800" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}>
            <Icon size={19} className={active ? "text-blue-700" : "text-slate-400"}/>
            {!collapsed && <span className="min-w-0"><span className="block font-medium">{item.label}</span><span className="mt-0.5 block truncate text-xs text-slate-600">{item.description}</span></span>}
          </button>;
        })}
      </nav>
      {!collapsed && <details className="mt-auto p-3 text-xs leading-5 text-slate-500"><summary className="cursor-pointer">数据与隐私</summary><p className="mt-2">资料保存在当前浏览器。数据备份不包含原始附件，请另外保存原文件。</p></details>}
    </aside>
    <div className={`min-h-screen transition-[margin] ${collapsed ? "lg:ml-20" : "lg:ml-64"}`}>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <button aria-label="打开导航" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileNavigationOpen(true)}><Menu size={20}/></button>
          <div className="min-w-0 flex-1 lg:hidden"><p className="truncate text-sm font-semibold">AI 面试通</p><p className="truncate text-xs text-slate-500">个人求职与面试准备</p></div>
          <p className="hidden text-sm text-slate-500 lg:block">把真实经历整理为可持续复用的面试准备材料</p>
          <button aria-label="设置" onClick={onSettings} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950"><Settings2 size={17}/><span className="hidden sm:inline">设置</span></button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
        <div className="mb-7 border-b border-slate-200 pb-5">
          {breadcrumbs.length > 0 && <p className="mb-2 text-sm text-slate-500">{breadcrumbs.join(" / ")}</p>}
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
          {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>}
        </div>
        {children}
      </main>
    </div>
  </div>;
}
