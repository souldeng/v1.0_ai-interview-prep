import { useEffect, useState, type ReactNode } from "react";
import { BookOpenText, BrainCircuit, ClipboardList, FileText, FolderOpenDot, LayoutDashboard, Menu, X, type LucideIcon } from "lucide-react";

export type NavigationTarget = "dashboard" | "prepare" | "library" | "history" | "profile" | "materials" | "settings";

const primaryNavigation: Array<{ id: NavigationTarget; label: string; description: string; icon: LucideIcon }> = [
  { id: "dashboard", label: "工作台", description: "今日任务", icon: LayoutDashboard },
  { id: "prepare", label: "准备", description: "岗位 · 资料 · 题组", icon: FolderOpenDot },
  { id: "library", label: "题库", description: "AI 面试题库", icon: BookOpenText },
  { id: "history", label: "训练记录", description: "记录与复盘", icon: ClipboardList },
];

const materialNavigation: Array<{ id: "profile"; label: string; description: string; icon: LucideIcon }> = [
  { id: "profile", label: "个人资料", description: "简历与经历", icon: FileText },
];

interface AppShellProps {
  activeTarget: NavigationTarget;
  title: string;
  description: string;
  breadcrumbs?: string[];
  children: ReactNode;
  hidePageHeader?: boolean;
  navigationDisabled?: boolean;
  activeJobLabel?: string | null;
  /** Formal training keeps the same application state but removes global navigation. */
  immersive?: boolean;
  onNavigate: (target: NavigationTarget) => void;
  onOpenBackup: () => void;
}

export function AppShell({ activeTarget, title, description, breadcrumbs = [], children, hidePageHeader = false, navigationDisabled = false, activeJobLabel, immersive = false, onNavigate, onOpenBackup }: AppShellProps) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  useEffect(() => { setMobileNavigationOpen(false); }, [activeTarget]);
  const selectTarget = (target: NavigationTarget) => {
    if (navigationDisabled) return;
    setMobileNavigationOpen(false);
    onNavigate(target);
  };

  const navButtonClass = (active: boolean) => `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[16px] transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${active
    ? "bg-accent text-accent-foreground"
    : "text-muted-foreground hover:bg-muted hover:text-foreground"}`;

  if (immersive) return <div className="min-h-screen bg-background text-foreground"><main>{children}</main></div>;

  return <div className="min-h-screen bg-background text-foreground">
    {mobileNavigationOpen && <button aria-label="关闭导航遮罩" className="fixed inset-0 z-30 bg-foreground/20 lg:hidden" onClick={() => setMobileNavigationOpen(false)} />}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card px-3 py-4 shadow-xl transition-transform lg:translate-x-0 lg:shadow-none ${mobileNavigationOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="mb-7 flex items-center justify-between px-1">
        <button onClick={() => selectTarget("dashboard")} disabled={navigationDisabled} className="flex min-w-0 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed" aria-label="返回工作台">
          <span className="rounded-[10px] bg-primary p-2 text-white"><BrainCircuit size={20}/></span>
          <span className="min-w-0"><span className="block truncate text-[16px] font-semibold tracking-tight text-foreground">AI 面试通</span><span className="mt-0.5 block text-[13px] text-muted-foreground">真实经历，轻量准备</span></span>
        </button>
        <button aria-label="关闭导航" className="rounded-md p-2 text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-[0.98] lg:hidden" onClick={() => setMobileNavigationOpen(false)}><X size={18}/></button>
      </div>

      <nav aria-label="主要导航" className="space-y-1">
        {primaryNavigation.map(item => {
          const Icon = item.icon;
          const active = activeTarget === item.id;
          return <button key={item.id} aria-current={active ? "page" : undefined} disabled={navigationDisabled} onClick={() => selectTarget(item.id)} className={navButtonClass(active)}>
            <Icon size={19} className={active ? "text-primary" : "text-muted-foreground"}/>
            <span className="min-w-0"><span className="block font-medium">{item.label}</span><span className={`mt-0.5 block truncate text-[13px] ${active ? "text-primary" : "text-muted-foreground"}`}>{item.description}</span></span>
          </button>;
        })}
      </nav>

      <div className="mt-6 border-t border-border pt-5">
        <p className="px-3 text-[12px] font-medium tracking-wide text-muted-foreground">资料</p>
        <nav aria-label="资料导航" className="mt-2 space-y-1">
          {materialNavigation.map(item => {
            const Icon = item.icon;
            const active = activeTarget === item.id;
            return <button key={item.id} aria-current={active ? "page" : undefined} disabled={navigationDisabled} onClick={() => selectTarget(item.id)} className={navButtonClass(active)}>
              <Icon size={18} className={active ? "text-primary" : "text-muted-foreground"}/><span className="min-w-0"><span className="block font-medium">{item.label}</span><span className={`mt-0.5 block truncate text-[13px] ${active ? "text-primary" : "text-muted-foreground"}`}>{item.description}</span></span>
            </button>;
          })}
        </nav>
      </div>

      <div className="mt-auto space-y-3 px-1 pt-6">
        {activeJobLabel && <button disabled={navigationDisabled} onClick={() => selectTarget("prepare")} className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-all outline-none hover:border-[#94A3B8] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"><span className="block text-[12px] text-muted-foreground">当前岗位</span><span className="mt-1 block truncate text-[13px] font-medium text-foreground">{activeJobLabel}</span></button>}
        <button aria-current={activeTarget === "settings" ? "page" : undefined} onClick={() => { onOpenBackup(); setMobileNavigationOpen(false); }} disabled={navigationDisabled} className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${activeTarget === "settings" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><ClipboardList size={16}/>设置与备份</button>
        <p className="px-3 text-[12px] leading-5 text-muted-foreground">资料保存在当前浏览器；备份不含原始附件。</p>
      </div>
    </aside>

    <div className="min-h-screen lg:ml-64">
      <header className="sticky top-0 z-20 h-14 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6 lg:hidden">
        <div className="mx-auto flex h-full max-w-[1120px] items-center gap-4">
          <button aria-label="打开导航" className="rounded-md p-2 text-muted-foreground transition-all hover:bg-white hover:text-foreground active:scale-[0.98] lg:hidden" onClick={() => setMobileNavigationOpen(true)}><Menu size={20}/></button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1120px] px-6 py-5 md:px-8 md:py-6">
        {!hidePageHeader && <div className="mb-8">
          {breadcrumbs.length > 0 && <p className="mb-2 text-[13px] text-muted-foreground">{breadcrumbs.join(" / ")}</p>}
          {title ? <h1 className="text-[28px] font-semibold tracking-tight text-foreground">{title}</h1> : null}
          {description && <p className="mt-2 max-w-3xl text-[16px] leading-7 text-muted-foreground">{description}</p>}
        </div>}
        {children}
      </main>
    </div>
  </div>;
}
