import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, FileCode2, HardDrive, LockKeyhole, Search, ShieldCheck } from "lucide-react";
import { useGetTaskOrderCatalog, useQueueTaskOrder } from "@workspace/api-client-react";
import type { TaskOrderTask } from "@workspace/api-client-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const mono = "font-mono";

function HtdocsTaskCard({
  task,
  selected,
  onSelect,
}: {
  task: TaskOrderTask;
  selected: boolean;
  onSelect: () => void;
}) {
  const available = task.status === "available";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative rounded-lg border p-3 text-left transition ${
        selected
          ? "border-[#d9a329] bg-[#302b20] shadow-[0_0_0_1px_rgba(217,163,41,.45)]"
          : "border-[#3a3b40] bg-[#242529] hover:border-[#6a6860] hover:bg-[#2a2b30]"
      }`}
      data-testid={`card-htdocs-task-${task.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[9px] font-bold uppercase tracking-[0.13em] text-[#9b9a92]">{task.category}</div>
          <div className="mt-1 text-[12px] font-bold leading-4 text-[#f2f0e7]">{task.title}</div>
        </div>
        {available ? <CheckCircle2 size={14} className="shrink-0 text-[#62c5a4]" /> : <HardDrive size={14} className="shrink-0 text-[#d9a329]" />}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] ${available ? "bg-[#1d493f] text-[#8fe2c4]" : "bg-[#4a2c2b] text-[#efa49b]"}`}>
          {available ? "available" : "token preview"}
        </span>
        <span className={`${mono} text-[9px] text-[#7e8584]`}>{available ? `${task.defaultItems.toLocaleString()} items` : "preview only"}</span>
      </div>
    </button>
  );
}

export default function HtdocsPreview() {
  const catalogQuery = useGetTaskOrderCatalog();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const queueMutation = useQueueTaskOrder();
  const tasks = catalogQuery.data?.tasks ?? [];
  const categories = ["all", ...Array.from(new Set(tasks.map((task) => task.category)))];
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];
  const visibleTasks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesCategory = category === "all" || task.category === category;
      const matchesSearch = !needle || `${task.title} ${task.description} ${task.category}`.toLowerCase().includes(needle);
      return matchesCategory && matchesSearch;
    });
  }, [category, search, tasks]);

  if (catalogQuery.isLoading) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-[#17181b] text-sm font-bold text-[#bcbdb5]">Loading htdocs preview…</div>;
  }
  if (catalogQuery.isError || !catalogQuery.data) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-[#17181b] text-sm font-bold text-[#e99a8f]">Safe htdocs preview unavailable.</div>;
  }

  return (
    <div className="min-h-[100dvh] bg-[#17181b] text-[#eeece2]">
      <header className="border-b border-[#303136] bg-[#1d1e22]">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-4 px-4 py-4 md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[#695a36] bg-[#302b20]"><FileCode2 size={18} className="text-[#d9a329]" /></div>
            <div>
              <div className="text-[13px] font-extrabold tracking-[0.1em] text-[#f7f4e8]">HTDOCS</div>
              <div className={`${mono} text-[9px] uppercase tracking-[0.15em] text-[#898a83]`}>Reference task console / safe preview</div>
            </div>
          </div>
          <a href={`${basePath}/task-orders`} className="inline-flex items-center gap-2 rounded-md border border-[#4b4c4f] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#c6c6be] transition hover:border-[#d9a329] hover:text-[#f6e0a0]" data-testid="link-back-task-orders">
            <ArrowLeft size={13} /> Task orders
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-4 py-7 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#d9a329]"><span className="h-1.5 w-1.5 rounded-full bg-[#d9a329]" /> PHP archive reference</div>
            <h1 className="mt-2 text-[28px] font-extrabold tracking-[-0.05em] text-[#f4f1e8]">Task console preview</h1>
            <p className="mt-2 max-w-[720px] text-[13px] leading-6 text-[#a4a49d]">
              A safe visual preview of the uploaded htdocs task-selection screen. It uses the Security Mining Console catalog and never runs the archived PHP application.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-[#5c5033] bg-[#2a261c] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#e2c66e]">
            <LockKeyhole size={13} /> Dev preview / synthetic tokens
          </div>
        </div>

        <section className="mt-7 rounded-xl border border-[#343539] bg-[#202125] p-4 shadow-[0_20px_70px_rgba(0,0,0,.24)] md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#36373b] pb-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#858780]">Work / tasks</div>
              <div className="mt-1 text-[15px] font-extrabold text-[#f3f0e5]">Select a task for safe preview</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="flex min-w-[220px] items-center gap-2 rounded-md border border-[#45464a] bg-[#18191c] px-3 py-2 text-[#858780]">
                <Search size={14} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks" className="w-full bg-transparent text-[11px] text-[#f1efe6] outline-none placeholder:text-[#70716e]" aria-label="Search htdocs preview tasks" data-testid="input-htdocs-task-search" />
              </label>
              <select value={category} onChange={(event) => setCategory(event.target.value)} className={`${mono} rounded-md border border-[#45464a] bg-[#18191c] px-3 py-2 text-[10px] font-bold text-[#d7d5cc]`} aria-label="Filter htdocs preview category" data-testid="select-htdocs-task-category">
                {categories.map((value) => <option key={value} value={value}>{value === "all" ? "All categories" : value}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleTasks.map((task) => (
              <HtdocsTaskCard key={task.id} task={task} selected={task.id === selectedTask?.id} onSelect={() => setSelectedTaskId(task.id)} />
            ))}
          </div>

          {visibleTasks.length === 0 && <div className="mt-5 rounded-md border border-dashed border-[#494a4d] p-8 text-center text-sm text-[#8c8e88]">No matching tasks in the safe preview catalog.</div>}

          {selectedTask && (
            <div className="mt-6 grid gap-4 border-t border-[#36373b] pt-5 lg:grid-cols-[1fr_290px]">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#858780]">Selected task</div>
                <h2 className="mt-1 text-[18px] font-extrabold text-[#f3f0e5]">{selectedTask.title}</h2>
                <p className="mt-2 max-w-[700px] text-[12px] leading-6 text-[#a4a49d]">{selectedTask.description}</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-md border border-[#3b3c40] bg-[#18191c] p-3"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#858780]">Boundary</div><div className={`${mono} mt-1 text-[10px] text-[#d5d3ca]`}>{selectedTask.authorizationBoundary}</div></div>
                  <div className="rounded-md border border-[#3b3c40] bg-[#18191c] p-3"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#858780]">Executor</div><div className={`${mono} mt-1 text-[10px] text-[#d5d3ca]`}>{selectedTask.executor}</div></div>
                  <div className="rounded-md border border-[#3b3c40] bg-[#18191c] p-3"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#858780]">Input</div><div className={`${mono} mt-1 text-[10px] text-[#d5d3ca]`}>{selectedTask.status === "available" ? "synthetic items only" : "token preview only"}</div></div>
                </div>
              </div>
              <div className={`rounded-md border p-4 ${selectedTask.status === "available" ? "border-[#37675b] bg-[#1c322d]" : "border-[#5c5033] bg-[#2a261c]"}`}>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#c8c8be]">{selectedTask.status === "available" ? <CheckCircle2 size={13} className="text-[#6bd0ad]" /> : <HardDrive size={13} className="text-[#e2c66e]" />} {selectedTask.status === "available" ? "Preview available" : "Token preview only / dispatch restricted"}</div>
                <p className="mt-3 text-[11px] leading-5 text-[#b4b5ad]">{selectedTask.statusReason}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                    <a href={`${basePath}/task-orders`} className="inline-flex items-center gap-2 rounded-md border border-[#b28721] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#f0ce70] transition hover:bg-[#3b311b]" data-testid="link-open-task-order-preview"><ShieldCheck size={13} /> View token preview</a>
                    {selectedTask.status === "available" && <>
                    <button
                      type="button"
                      onClick={() => queueMutation.mutate({ data: { taskId: selectedTask.id } })}
                      disabled={queueMutation.isPending}
                      className="inline-flex items-center gap-2 rounded-md bg-[#b28721] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#17181b] transition hover:bg-[#d9a329] disabled:cursor-wait disabled:opacity-60"
                      data-testid="button-htdocs-queue-local-job"
                    >
                      <ShieldCheck size={13} /> {queueMutation.isPending ? "Queueing…" : "Queue local job"}
                    </button>
                    </>}
                  </div>
                {queueMutation.data && <div className="mt-3 rounded-md border border-[#37675b] bg-[#1c322d] p-3 text-[10px] leading-5 text-[#a8e4d6]" data-testid="panel-htdocs-queue-result">{queueMutation.data.message}</div>}
                {queueMutation.isError && <div className="mt-3 rounded-md border border-[#633b38] bg-[#322321] p-3 text-[10px] leading-5 text-[#efa49b]">The local task could not be queued.</div>}
              </div>
            </div>
          )}
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] text-[#81837d]">
          <span>Source: inspected archive reference only</span>
          <span>PHP execution: disabled</span>
          <span>Raw hash lists and secrets: not accepted</span>
          <span>External targets: disabled</span>
        </div>
      </main>
    </div>
  );
}