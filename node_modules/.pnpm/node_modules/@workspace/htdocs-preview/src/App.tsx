import { useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Activity, Archive, ArrowUpRight, Ban, Check, CheckCircle2, ChevronRight,
  CircleAlert, CircleCheck, Cpu, Database, FileArchive, HardDrive,
  LockKeyhole, LoaderCircle, Radio, RefreshCw, Search, Server, ShieldCheck,
  SquareTerminal, X, XCircle,
} from 'lucide-react';
import {
  useGetCommandCenterStatus,
  useGetTaskOrderCatalog,
  useQueueTaskOrder,
  type TaskOrderQueueResult,
  type TaskOrderTask,
} from '@workspace/api-client-react';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const SYNTHETIC_TOKEN_ALLOCATION = 10_000;
const artifactBasePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function pageHref(page: string) {
  return `${artifactBasePath}/${page}`;
}

function pageFromLocation(location: string) {
  const withoutBase = location.startsWith(artifactBasePath)
    ? location.slice(artifactBasePath.length)
    : location;
  const page = withoutBase.split('/').filter(Boolean)[0] ?? 'dashboard';
  return ['dashboard', 'shop', 'tokens', 'orders', 'support', 'security-mining'].includes(page)
    ? page
    : 'dashboard';
}

function Home() {
  const [location] = useLocation();
  const catalogQuery = useGetTaskOrderCatalog();
  const statusQuery = useGetCommandCenterStatus();
  const queueTaskOrder = useQueueTaskOrder();
  const [selectedTask, setSelectedTask] = useState<TaskOrderTask | null>(null);
  const [queueResult, setQueueResult] = useState<TaskOrderQueueResult | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [showUnavailable, setShowUnavailable] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [selectedPreviewTaskId, setSelectedPreviewTaskId] = useState('');
  const catalog = catalogQuery.data;
  const status = statusQuery.data;
  const availableTasks = useMemo(() => catalog?.tasks.filter((task) => task.status === 'available') ?? [], [catalog?.tasks]);
  const unavailableTasks = useMemo(() => catalog?.tasks.filter((task) => task.status !== 'available') ?? [], [catalog?.tasks]);
  const categories = useMemo(() => ['all', ...Array.from(new Set(catalog?.tasks.map((task) => task.category) ?? []))], [catalog?.tasks]);
  const needle = search.trim().toLowerCase();
  const matchesFilter = (task: TaskOrderTask) => {
    const matchesCategory = category === 'all' || task.category === category;
    const matchesSearch = !needle || `${task.title} ${task.description} ${task.category} ${task.id}`.toLowerCase().includes(needle);
    return matchesCategory && matchesSearch;
  };
   const visibleTasks = useMemo(() => (catalog?.tasks ?? []).filter(matchesFilter), [catalog?.tasks, category, needle]);
  const visibleUnavailableTasks = useMemo(() => unavailableTasks.filter(matchesFilter), [unavailableTasks, category, needle]);
  const selectedPreviewTask = useMemo(() => {
    const selected = catalog?.tasks.find((task) => task.id === selectedPreviewTaskId);
     return selected ?? visibleTasks[0] ?? catalog?.tasks[0] ?? null;
   }, [catalog?.tasks, selectedPreviewTaskId, visibleTasks]);
  const activePage = pageFromLocation(location);
  const isPage = (...pages: string[]) => pages.includes(activePage);

  const refreshAll = () => {
    void catalogQuery.refetch();
    void statusQuery.refetch();
  };
  const requestQueue = (task: TaskOrderTask) => {
    setQueueError(null);
    setQueueResult(null);
    setSelectedTask(task);
  };
  const confirmQueue = () => {
    if (!selectedTask) return;
    queueTaskOrder.mutate({ data: { taskId: selectedTask.id } }, {
      onSuccess: (result) => {
        setQueueResult(result);
        setSelectedTask(null);
        void statusQuery.refetch();
      },
      onError: (error) => setQueueError(error instanceof Error ? error.message : 'Queue request was rejected by the local coordinator.'),
    });
  };

  if (catalogQuery.isLoading || statusQuery.isLoading) return <LoadingConsole />;
  if (catalogQuery.isError || statusQuery.isError || !catalog || !status) {
    return (
      <div className="min-h-[100dvh] bg-background p-6 md:p-10">
        <div className="mx-auto flex min-h-[70dvh] max-w-2xl flex-col items-center justify-center rounded-sm border border-destructive/30 bg-card p-8 text-center soft-shadow">
          <CircleAlert className="mb-5 h-10 w-10 text-destructive" />
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-destructive">Telemetry unavailable</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">The preview catalog could not be read.</h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">This surface only reads the local API. No archive content was executed. Check the API server and retry.</p>
          <button type="button" data-testid="button-retry-console" onClick={refreshAll} className="focus-console mt-7 inline-flex items-center gap-2 rounded-sm border border-primary bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:-translate-y-0.5 hover:bg-primary/90"><RefreshCw className="h-4 w-4" /> Retry read</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="flex min-h-screen">
        <aside className="hidden w-[220px] shrink-0 flex-col border-r border-border bg-sidebar px-3 py-4 md:flex">
          <div className="flex items-center gap-2 border-b border-border px-2 pb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-xs font-black text-primary-foreground shadow-[0_0_16px_rgba(219,20,60,.35)]">BP</div>
            <div><p className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">BytePool</p><p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Task console</p></div>
          </div>
          <p className="px-2 pb-2 pt-5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Workspace</p>
          <a href={pageHref('dashboard')} className={`flex items-center gap-2 rounded-sm border px-3 py-2 text-xs transition ${isPage('dashboard') ? 'border-primary/20 bg-primary/10 font-semibold text-primary' : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground'}`}><Activity className="h-3.5 w-3.5" /> Dashboard</a>
          <a href={pageHref('shop')} className={`mt-1 flex items-center gap-2 rounded-sm border px-3 py-2 text-xs transition ${isPage('shop') ? 'border-primary/20 bg-primary/10 font-semibold text-primary' : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground'}`}><Archive className="h-3.5 w-3.5" /> Shop</a>
          <a href={pageHref('tokens')} className={`mt-1 flex items-center gap-2 rounded-sm border px-3 py-2 text-xs transition ${isPage('tokens') ? 'border-primary/20 bg-primary/10 font-semibold text-primary' : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground'}`}><HardDrive className="h-3.5 w-3.5" /> Token wallet</a>
          <a href={pageHref('orders')} className={`mt-1 flex items-center gap-2 rounded-sm border px-3 py-2 text-xs transition ${isPage('orders') ? 'border-primary/20 bg-primary/10 font-semibold text-primary' : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground'}`}><FileArchive className="h-3.5 w-3.5" /> Orders</a>
          <a href={pageHref('support')} className={`mt-1 flex items-center gap-2 rounded-sm border px-3 py-2 text-xs transition ${isPage('support') ? 'border-primary/20 bg-primary/10 font-semibold text-primary' : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground'}`}><CircleAlert className="h-3.5 w-3.5" /> Support</a>
          <a href={pageHref('security-mining')} className={`mt-1 flex items-center gap-2 rounded-sm border px-3 py-2 text-xs transition ${isPage('security-mining') ? 'border-primary/20 bg-primary/10 font-semibold text-primary' : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground'}`}><Radio className="h-3.5 w-3.5" /> Mining console</a>
          <div className="flex-1" />
          <div className="rounded-sm border border-border bg-card p-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-primary">Dev session</p>
            <p className="mt-1 text-xs font-semibold text-foreground">Autologin active</p>
            <p className="mt-1 font-mono text-lg font-semibold text-foreground">{formatNumber(SYNTHETIC_TOKEN_ALLOCATION)}</p>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">Synthetic tokens for local preview.</p>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
      <header className="border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_0_16px_rgba(219,20,60,.35)]"><ShieldCheck className="h-5 w-5" /></div>
            <div><p className="font-mono text-[10px] uppercase tracking-[0.28em] text-sidebar-primary">BYTEPOOL / HTDOCS</p><h1 className="mt-0.5 text-base font-semibold tracking-tight">Task console preview</h1></div>
          </div>
          <div className="flex items-center gap-2">
            <a href="/" data-testid="link-security-console" className="hidden items-center gap-2 rounded-sm border border-sidebar-border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/80 transition hover:border-sidebar-primary hover:text-sidebar-primary sm:inline-flex"><Radio className="h-3.5 w-3.5" /> Security mining console</a>
            <div className="flex items-center gap-2 rounded-sm border border-sidebar-primary/40 bg-sidebar-primary/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-sidebar-primary"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sidebar-primary" /> DEV AUTOLOGIN</div>
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto border-t border-sidebar-border px-3 py-2 md:hidden" aria-label="Htdocs workspace menu">
          <a href={pageHref('dashboard')} className={`shrink-0 rounded-sm px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.08em] transition ${isPage('dashboard') ? 'bg-sidebar-primary/10 text-sidebar-primary' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'}`}>Dashboard</a>
          <a href={pageHref('shop')} className={`shrink-0 rounded-sm px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.08em] transition ${isPage('shop') ? 'bg-sidebar-primary/10 text-sidebar-primary' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'}`}>Shop</a>
          <a href={pageHref('tokens')} className={`shrink-0 rounded-sm px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.08em] transition ${isPage('tokens') ? 'bg-sidebar-primary/10 text-sidebar-primary' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'}`}>Token wallet</a>
          <a href={pageHref('orders')} className={`shrink-0 rounded-sm px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.08em] transition ${isPage('orders') ? 'bg-sidebar-primary/10 text-sidebar-primary' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'}`}>Orders</a>
          <a href={pageHref('support')} className={`shrink-0 rounded-sm px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.08em] transition ${isPage('support') ? 'bg-sidebar-primary/10 text-sidebar-primary' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'}`}>Support</a>
        </nav>
        <div className="scanline h-px opacity-70" />
      </header>

      <main className="console-grid mx-auto max-w-[1500px] px-5 py-6 md:px-8 md:py-9">
         <section id="dashboard" className={`${isPage('dashboard') ? '' : 'hidden'} grid gap-5 lg:grid-cols-[1.45fr_0.55fr]`}>
           <div className="rounded-sm border border-border bg-card/95 p-6 soft-shadow md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div>
                 <div className="mb-5 inline-flex items-center gap-2 border border-primary/30 bg-primary/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-primary"><Archive className="h-3.5 w-3.5" /> Preview available</div>
                 <h2 className="max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.03em] text-foreground md:text-5xl">Review the task surface.<br /><span className="text-primary">Route safe work to mining.</span></h2>
                 <p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">A dev-only preview derived from the uploaded <span className="font-mono text-foreground">htdocs</span> attachment. Autologin is enabled, synthetic tokens are used for estimates, and approved workloads stay loopback-bound.</p>
              </div>
              <div className="hidden border-l border-border pl-5 text-right md:block"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">catalog mode</p><p data-testid="text-catalog-mode" className="mt-2 font-mono text-sm font-semibold text-primary">{catalog.mode}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">vetted task map</p></div>
            </div>
          </div>
           <SafetyNotice />
        </section>

         <section id="security-mining" className={`${isPage('dashboard', 'security-mining') ? '' : 'hidden'} mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4`}>
          <Metric label="Local miners" value={status.coordinator.activeMiners} detail={`${status.coordinator.minerSource} source`} icon={<Cpu />} testId="metric-active-miners" />
          <Metric label="Measured rate" value={formatHashRate(status.coordinator.hashRate)} detail="hashes / second" icon={<Activity />} testId="metric-hash-rate" />
          <Metric label="Jobs issued" value={status.coordinator.jobsIssued} detail="coordinator counter" icon={<Database />} testId="metric-jobs-issued" />
          <Metric label="Dispatch boundary" value={catalog.dispatchMode.replaceAll('-', ' ')} detail="no external targets" icon={<Radio />} testId="metric-dispatch-mode" compact />
        </section>

         <section id="tokens" className={`${isPage('tokens') ? '' : 'hidden'} mt-5 grid gap-4 lg:grid-cols-[1fr_1.4fr]`}>
           <div className="rounded-sm border border-primary/30 bg-primary/10 p-5">
             <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">02 / token wallet</p>
             <div className="mt-2 flex items-end justify-between gap-4"><div><p className="font-mono text-3xl font-semibold text-foreground">{formatNumber(SYNTHETIC_TOKEN_ALLOCATION)}</p><p className="mt-1 text-xs text-muted-foreground">synthetic tokens available for preview estimates</p></div><HardDrive className="h-6 w-6 text-primary" /></div>
           </div>
           <div className="rounded-sm border border-border bg-card/80 p-5"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Token rules</p><p className="mt-2 text-sm leading-6 text-foreground">Token rates are display-only estimates. They never create a stored balance, unlock restricted execution, or leave the loopback preview.</p></div>
         </section>

          <section id="task-shop" className={`${isPage('shop') ? '' : 'hidden'} mt-9`}>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
             <div><p className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">03 / shop</p><h2 className="mt-1.5 text-2xl font-semibold tracking-tight">Archive task catalog</h2></div>
             <div className="flex items-center gap-3"><span className="font-mono text-xs text-muted-foreground">{catalog.tasks.length} listed / {availableTasks.length} executable</span><button type="button" data-testid="button-refresh-console" onClick={refreshAll} className="focus-console inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition hover:border-primary hover:text-primary"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button></div>
          </div>
           <div className="mb-5 flex flex-wrap gap-2 rounded-sm border border-border bg-card/80 p-3">
             <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-sm border border-border bg-background px-3 py-2 text-muted-foreground">
               <Search className="h-3.5 w-3.5" />
               <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks" className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground" aria-label="Search htdocs preview tasks" data-testid="input-htdocs-task-search" />
             </label>
             <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-sm border border-border bg-background px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground" aria-label="Filter htdocs preview category" data-testid="select-htdocs-task-category">
               {categories.map((value) => <option key={value} value={value}>{value === 'all' ? 'All categories' : value}</option>)}
             </select>
           </div>
             {visibleTasks.length === 0 ? <EmptyState filtered={Boolean(search.trim() || category !== 'all')} /> : <div className="overflow-x-auto rounded-sm border border-border"><div className="min-w-[980px]"><div className="grid grid-cols-[minmax(280px,1.7fr)_140px_90px_90px_80px_110px_170px] border-b border-border bg-card"><ShopColumn label="Task" /><ShopColumn label="Category" /><ShopColumn label="Items" /><ShopColumn label="Tokens / 1k" /><ShopColumn label="Solve" /><ShopColumn label="Boundary" /><ShopColumn label="Action" /></div>{visibleTasks.map((task) => <TaskShopRow key={task.id} task={task} selected={task.id === selectedPreviewTask?.id} onSelect={() => setSelectedPreviewTaskId(task.id)} onQueue={requestQueue} />)}</div></div>}
           {selectedPreviewTask && <TaskDetails task={selectedPreviewTask} onQueue={requestQueue} />}
        </section>

         <section id="orders" className={`${isPage('orders') ? '' : 'hidden'} mt-8 rounded-sm border border-border bg-card/80 p-5`}>
           <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">04 / orders</p>
           <div className="mt-2 flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold tracking-tight">Local order queue</h2><p className="mt-1 text-sm text-muted-foreground">Executable tasks create loopback-local jobs only. Restricted entries remain token-preview pages.</p></div>{queueResult ? <span className="rounded-sm border border-primary/30 bg-primary/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-primary">Latest order queued</span> : <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">No local orders yet</span>}</div>
           {queueResult && <div className="mt-4 rounded-sm border border-primary/30 bg-primary/10 p-4"><p className="text-sm font-semibold text-foreground">{queueResult.taskName}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{queueResult.message}</p></div>}
         </section>

          <section id="support" className={`${isPage('support') ? '' : 'hidden'} mt-8 rounded-sm border border-border bg-card/80`}>
          <button type="button" data-testid="button-toggle-unavailable" onClick={() => setShowUnavailable((visible) => !visible)} className="focus-console flex w-full items-center justify-between px-5 py-4 text-left">
             <span className="flex items-center gap-3"><Ban className="h-4 w-4 text-destructive" /><span><span className="block text-sm font-semibold">Support and restricted archive notes</span><span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{unavailableTasks.length} preview-only entries · no dispatch</span></span></span>
            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${showUnavailable ? 'rotate-90' : ''}`} />
          </button>
           {showUnavailable && <div className="border-t border-border px-5 pb-5 pt-3">{visibleUnavailableTasks.length === 0 ? <p data-testid="text-no-unavailable-tasks" className="py-4 text-sm text-muted-foreground">{unavailableTasks.length === 0 ? 'No restricted entries are present in this catalog.' : 'No restricted entries match the current filter.'}</p> : <div className="divide-y divide-border">{visibleUnavailableTasks.map((task) => <button type="button" key={task.id} data-testid={`row-unavailable-task-${task.id}`} onClick={() => setSelectedPreviewTaskId(task.id)} className={`grid w-full gap-3 py-4 text-left transition md:grid-cols-[1fr_auto] md:items-center ${selectedPreviewTask?.id === task.id ? 'bg-destructive/5' : 'hover:bg-muted/40'}`}><div><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-foreground">{task.id}</span><PreviewBadge /></div><p className="mt-1 text-sm font-medium">{task.title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{task.statusReason}</p></div><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground"><LockKeyhole className="h-3.5 w-3.5" /> token preview</div></button>)}</div>}</div>}
        </section>

         <footer className="mt-8 border-t border-border py-5"><div className="flex flex-col gap-3 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between"><p className="flex items-center gap-2"><FileArchive className="h-3.5 w-3.5" /> htdocs archive retained as reference material; PHP execution is disabled.</p><p className="font-mono text-[10px] uppercase tracking-[0.14em]">synthetic tokens · no secrets · loopback only</p></div></footer>
       </main>
        </div>
      </div>
      {queueResult && <QueueResult result={queueResult} onDismiss={() => setQueueResult(null)} />}
      {queueError && <QueueError message={queueError} onDismiss={() => setQueueError(null)} />}
      {selectedTask && <QueueConfirm task={selectedTask} pending={queueTaskOrder.isPending} onCancel={() => setSelectedTask(null)} onConfirm={confirmQueue} />}
    </div>
  );
}

function LoadingConsole() {
  return <div className="min-h-[100dvh] bg-background"><div className="border-b border-sidebar-border bg-sidebar px-5 py-5 md:px-8"><div className="mx-auto max-w-[1500px]"><div className="h-3 w-44 animate-pulse rounded-sm bg-sidebar-accent" /><div className="mt-3 h-5 w-64 animate-pulse rounded-sm bg-sidebar-accent" /></div></div><div className="mx-auto max-w-[1500px] space-y-5 p-5 md:p-8"><div className="h-52 animate-pulse rounded-sm bg-muted" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-24 animate-pulse rounded-sm bg-muted" />)}</div><div className="h-8 w-64 animate-pulse rounded-sm bg-muted" /><div className="grid gap-4 lg:grid-cols-2"><div className="h-52 animate-pulse rounded-sm bg-muted" /><div className="h-52 animate-pulse rounded-sm bg-muted" /></div></div></div>;
}

function SafetyNotice() {
  return <aside data-testid="notice-safety" className="relative overflow-hidden rounded-sm border border-accent/50 bg-accent/10 p-6"><div className="absolute inset-y-0 left-0 w-1 bg-accent" /><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-accent-foreground" /><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-accent-foreground">Operator safety boundary</p><p className="mt-3 text-sm font-medium leading-6 text-foreground">Synthetic tokens are for preview estimates only. Approved tasks stay bounded to the local loopback executor.</p><div className="mt-4 grid gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground sm:grid-cols-2"><span className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> PHP execution disabled</span><span className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> synthetic tokens only</span><span className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> no secrets or raw hash lists</span><span className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> loopback-local queue only</span></div></div></div></aside>;
}

function Metric({ label, value, detail, icon, testId, compact = false }: { label: string; value: string | number; detail: string; icon: ReactNode; testId: string; compact?: boolean }) {
  return <div data-testid={testId} className="rounded-sm border border-border bg-card px-4 py-4 transition hover:-translate-y-0.5 hover:border-primary/60 soft-shadow"><div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{label}</span><span className="text-primary [&>svg]:h-4 [&>svg]:w-4">{icon}</span></div><p className={`mt-3 font-mono font-semibold tracking-tight text-foreground ${compact ? 'text-sm capitalize' : 'text-2xl'}`}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

function ShopColumn({ label }: { label: string }) {
  return <div className="border-r border-border px-3 py-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground last:border-r-0">{label}</div>;
}

function TaskShopRow({ task, selected, onSelect, onQueue }: { task: TaskOrderTask; selected: boolean; onSelect: () => void; onQueue: (task: TaskOrderTask) => void }) {
  return <div data-testid={`row-shop-task-${task.id}`} className={`grid grid-cols-[minmax(280px,1.7fr)_140px_90px_90px_80px_110px_170px] border-b border-border transition last:border-b-0 ${selected ? 'bg-primary/10' : 'hover:bg-muted/60'}`}>
    <button type="button" onClick={onSelect} className="min-w-0 border-r border-border px-3 py-3 text-left">
      <div className="flex items-center gap-2"><span className="truncate text-xs font-semibold text-foreground">{task.title}</span>{task.status === 'available' ? <StatusBadge status={task.status} /> : <PreviewBadge />}</div>
      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{task.id} · {task.description}</p>
    </button>
    <div className="border-r border-border px-3 py-3 text-[10px] text-muted-foreground">{task.category}</div>
    <div className="border-r border-border px-3 py-3 font-mono text-[10px] text-foreground">{formatNumber(task.defaultItems)}</div>
    <div className="border-r border-border px-3 py-3 font-mono text-[10px] text-foreground">{formatNumber(task.creditsPerThousand)}</div>
    <div className="border-r border-border px-3 py-3 font-mono text-[10px] text-foreground">{task.estimatedSolvePercent}%</div>
    <div className="border-r border-border px-3 py-3 font-mono text-[10px] text-muted-foreground">{task.authorizationBoundary}</div>
    <div className="flex items-center gap-2 px-3 py-2.5"><button type="button" onClick={onSelect} data-testid={`button-inspect-shop-task-${task.id}`} className="focus-console rounded-sm border border-border px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground transition hover:border-primary hover:text-primary">Inspect</button>{task.status === 'available' ? <button type="button" onClick={() => onQueue(task)} data-testid={`button-queue-shop-task-${task.id}`} className="focus-console rounded-sm bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-primary-foreground transition hover:bg-primary/90">Queue</button> : <span className="rounded-sm border border-accent/40 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.06em] text-accent-foreground">Token preview</span>}</div>
  </div>;
}

function TaskCard({ task, selected, onSelect, onQueue }: { task: TaskOrderTask; selected: boolean; onSelect: () => void; onQueue: (task: TaskOrderTask) => void }) {
  return <article data-testid={`card-task-${task.id}`} className={`group relative overflow-hidden rounded-sm border bg-card p-5 transition hover:-translate-y-0.5 soft-shadow md:p-6 ${selected ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-primary/60'}`}><div className="absolute right-0 top-0 h-20 w-20 border-l border-b border-border/50 opacity-60" /><div className="relative flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-primary">{task.id}</span><StatusBadge status={task.status} /><span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{task.category}</span></div><h3 className="mt-3 text-lg font-semibold tracking-tight">{task.title}</h3><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{task.description}</p></div><ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" /></div><div className="relative mt-5 grid grid-cols-2 gap-px overflow-hidden border border-border bg-border sm:grid-cols-4"><DataPoint label="default items" value={formatNumber(task.defaultItems)} /><DataPoint label="tokens / 1k" value={formatNumber(task.creditsPerThousand)} /><DataPoint label="solve est." value={`${task.estimatedSolvePercent}%`} /><DataPoint label="boundary" value={task.authorizationBoundary} /></div><div className="relative mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><SquareTerminal className="h-3.5 w-3.5 text-primary" /><span className="font-mono">{task.executor}</span></div><div className="flex items-center gap-2"><button type="button" data-testid={`button-inspect-task-${task.id}`} onClick={onSelect} className="focus-console rounded-sm border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:border-primary hover:text-primary">Inspect</button><button type="button" data-testid={`button-queue-task-${task.id}`} onClick={() => onQueue(task)} className="focus-console inline-flex items-center gap-2 rounded-sm border border-primary bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition hover:-translate-y-0.5 hover:bg-primary/90">Queue locally <ChevronRight className="h-3.5 w-3.5" /></button></div></div></article>;
}

function DataPoint({ label, value }: { label: string; value: string }) {
  return <div className="bg-card px-3 py-2.5"><p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-1 truncate font-mono text-xs font-semibold text-foreground">{value}</p></div>;
}

function StatusBadge({ status }: { status: string }) {
  const available = status === 'available';
  return <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${available ? 'border-primary/30 bg-primary/10 text-primary' : 'border-accent/40 bg-accent/10 text-accent-foreground'}`}><span className={`h-1.5 w-1.5 rounded-full ${available ? 'bg-primary' : 'bg-accent'}`} /> {available ? 'available' : 'preview'}</span>;
}

function PreviewBadge() {
  return <span className="inline-flex items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-accent-foreground"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> preview</span>;
}

function EmptyState({ filtered = false }: { filtered?: boolean }) {
  return <div data-testid="empty-available-tasks" className="rounded-sm border border-dashed border-border bg-card/60 p-10 text-center"><HardDrive className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-4 text-sm font-medium">{filtered ? 'No tasks match this preview filter.' : 'No tasks are available for local preview.'}</p><p className="mt-1 text-sm text-muted-foreground">{filtered ? 'Try a different search term or category.' : 'The archive map is present, but every task is currently outside the authorization boundary.'}</p></div>;
}

function TaskDetails({ task, onQueue }: { task: TaskOrderTask; onQueue: (task: TaskOrderTask) => void }) {
  const available = task.status === 'available';
  return <section data-testid="panel-selected-task" className={`mt-6 grid gap-4 border-t border-border pt-5 lg:grid-cols-[1fr_290px]`}>
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Selected task</p>
      <h3 className="mt-1.5 text-xl font-semibold tracking-tight">{task.title}</h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{task.description}</p>
       <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <DataPoint label="boundary" value={task.authorizationBoundary} />
        <DataPoint label="executor" value={task.executor} />
         <DataPoint label="tokens / 1k" value={available ? formatNumber(task.creditsPerThousand) : 'preview only'} />
      </div>
    </div>
       <div className={`rounded-sm border p-4 ${available ? 'border-primary/30 bg-primary/10' : 'border-accent/30 bg-accent/10'}`}>
       <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.15em]">{available ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : <HardDrive className="h-3.5 w-3.5 text-accent-foreground" />}{available ? 'Preview available · queueable' : 'Token preview only · dispatch restricted'}</div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{task.statusReason}</p>
       <div className="mt-4 flex flex-wrap gap-2"><a href="/task-orders" className="focus-console inline-flex items-center gap-2 rounded-sm border border-primary/60 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-primary transition hover:bg-primary/10" data-testid="link-open-task-order-preview"><ShieldCheck className="h-3.5 w-3.5" /> View token preview</a>{available && <button type="button" onClick={() => onQueue(task)} className="focus-console inline-flex items-center gap-2 rounded-sm bg-primary px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-primary-foreground transition hover:bg-primary/90" data-testid="button-selected-task-queue"><ShieldCheck className="h-3.5 w-3.5" /> Queue local job</button>}</div>
    </div>
  </section>;
}

function QueueConfirm({ task, pending, onCancel, onConfirm }: { task: TaskOrderTask; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/30 p-4 backdrop-blur-[2px] md:items-center"><div role="dialog" aria-modal="true" data-testid="dialog-queue-confirm" className="w-full max-w-lg rounded-sm border border-primary/50 bg-card p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Confirm local dispatch</p><h2 className="mt-2 text-xl font-semibold tracking-tight">{task.title}</h2></div><button type="button" data-testid="button-cancel-queue" onClick={onCancel} className="focus-console rounded-sm p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button></div><p className="mt-4 text-sm leading-6 text-muted-foreground">This will pin <span className="font-mono text-foreground">{task.id}</span> to the loopback-local miner pool. It does not execute PHP or contact an external target. Token accounting remains synthetic and local.</p><div className="mt-4 grid gap-2 rounded-sm border border-border bg-muted/40 p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground"><span className="flex items-center gap-2"><Server className="h-3.5 w-3.5 text-primary" /> executor: {task.executor}</span><span className="flex items-center gap-2"><LockKeyhole className="h-3.5 w-3.5 text-primary" /> boundary: {task.authorizationBoundary}</span></div><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" data-testid="button-dismiss-queue" onClick={onCancel} className="focus-console rounded-sm border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground">Cancel</button><button type="button" data-testid="button-confirm-queue" disabled={pending} onClick={onConfirm} className="focus-console inline-flex items-center justify-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70">{pending && <LoaderCircle className="h-4 w-4 animate-spin" />} {pending ? 'Queueing…' : 'Confirm loopback queue'}</button></div></div></div>;
}

function QueueResult({ result, onDismiss }: { result: TaskOrderQueueResult; onDismiss: () => void }) {
  return <div role="status" data-testid="status-queue-result" className="fixed bottom-5 right-5 z-40 w-[min(420px,calc(100vw-2.5rem))] rounded-sm border border-primary/40 bg-card p-5 shadow-2xl"><div className="flex items-start gap-3"><CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Queue accepted</p><p className="mt-2 text-sm font-semibold">{result.taskName}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{result.message}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground"><span>{result.jobsIssued} jobs issued</span><span>{result.activeMiners} active miners</span></div></div><button type="button" data-testid="button-dismiss-queue-result" onClick={onDismiss} className="focus-console text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button></div></div>;
}

function QueueError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return <div role="alert" data-testid="alert-queue-error" className="fixed bottom-5 right-5 z-40 flex w-[min(420px,calc(100vw-2.5rem))] items-start gap-3 rounded-sm border border-destructive/40 bg-card p-5 shadow-2xl"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" /><div className="min-w-0 flex-1"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">Queue rejected</p><p className="mt-2 text-sm leading-5 text-muted-foreground">{message}</p></div><button type="button" data-testid="button-dismiss-queue-error" onClick={onDismiss} className="focus-console text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button></div>;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function formatHashRate(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} MH/s`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} kH/s`;
  return `${formatNumber(value)} H/s`;
}

function Router() {
  return <RoutedErrorBoundary><Switch>
    <Route path="/" component={Home} />
    <Route path="/dashboard" component={Home} />
    <Route path="/shop" component={Home} />
    <Route path="/tokens" component={Home} />
    <Route path="/orders" component={Home} />
    <Route path="/support" component={Home} />
    <Route path="/security-mining" component={Home} />
    <Route component={NotFound} />
  </Switch></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;