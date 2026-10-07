import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Calculator,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Gauge,
  ShieldCheck,
  WalletCards,
  XCircle,
} from "lucide-react";
import {
  getGetCommandCenterStatusQueryKey,
  useGetTaskOrderCatalog,
  useQueueTaskOrder,
  useQuoteTaskOrder,
  useGetCommandCenterStatus,
} from "@workspace/api-client-react";
import type { TaskOrderQueueResult, TaskOrderQuote, TaskOrderTask } from "@workspace/api-client-react";

const mono = "font-mono";
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function formatRate(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} GH/s`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} MH/s`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} kH/s`;
  return `${value.toLocaleString()} H/s`;
}

function TaskCard({
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
      className={`text-left rounded-lg border p-4 transition ${
        selected
          ? "border-[#147f79] bg-[#eef9f6] shadow-[0_0_0_2px_rgba(20,127,121,.12)]"
          : "border-[#d4e1e2] bg-white hover:border-[#91c8c0] hover:bg-[#f8fcfb]"
      }`}
      data-testid={`card-order-task-${task.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#7d969c]">
            {task.category}
          </div>
          <h3 className="mt-1 text-[13px] font-extrabold text-[#214751]">{task.title}</h3>
        </div>
        {available ? (
          <CheckCircle2 size={16} className="shrink-0 text-[#159d8d]" aria-label="Available" />
        ) : (
          <XCircle size={16} className="shrink-0 text-[#b24a3e]" aria-label="Not available" />
        )}
      </div>
      <p className="mt-2 text-[11px] leading-5 text-[#668087]">{task.description}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] ${
            available
              ? "border-[#a8dcd2] bg-[#e8f8f4] text-[#13776f]"
              : "border-[#eeb4ae] bg-[#fbe1de] text-[#a23d34]"
          }`}
        >
          {available ? "Available" : "Not available"}
        </span>
        {available && (
          <span className={`${mono} text-[9px] text-[#6d858b]`}>
            {task.creditsPerThousand} credits / 1k items
          </span>
        )}
      </div>
      {!available && <div className="mt-2 text-[10px] leading-4 text-[#a23d34]">{task.statusReason}</div>}
    </button>
  );
}

function QuotePanel({
  task,
  hashRate,
  solvedPercent,
  totalItems,
  onHashRateChange,
  onSolvedPercentChange,
  onTotalItemsChange,
  onQuote,
  onQueue,
  pending,
  queuePending,
  quote,
  queueResult,
}: {
  task?: TaskOrderTask;
  hashRate: number;
  solvedPercent: number;
  totalItems: number;
  onHashRateChange: (value: number) => void;
  onSolvedPercentChange: (value: number) => void;
  onTotalItemsChange: (value: number) => void;
  onQuote: () => void;
  onQueue: () => void;
  pending: boolean;
  queuePending: boolean;
  quote?: TaskOrderQuote;
  queueResult?: TaskOrderQueueResult;
}) {
  const available = task?.status === "available";
  return (
    <section className="rounded-lg border border-[#cbdedf] bg-[#f8fbfb] p-5 shadow-sm" data-testid="panel-order-quote">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#d9efeb] text-[#147f79]">
          <Calculator size={17} />
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#66828a]">Preview quote</div>
          <h2 className="mt-1 text-[17px] font-extrabold text-[#183943]">
            {task?.title ?? "Select a task"}
          </h2>
          <p className="mt-1 text-[11px] leading-5 text-[#71878d]">
            Estimates use synthetic items and measured work rate. They do not represent password recovery or a mining payout.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#789098]">Hash rate / work units</span>
          <input
            type="number"
            min={1}
            max={1_000_000_000_000_000}
            value={hashRate}
            onChange={(event) => onHashRateChange(Math.max(1, Number(event.target.value) || 1))}
            className={`${mono} mt-2 w-full rounded-md border border-[#bfd3d5] bg-white px-3 py-2 text-xs text-[#355b63] outline-none focus:border-[#147f79]`}
            data-testid="input-order-hash-rate"
          />
          <span className={`${mono} mt-1 block text-[9px] text-[#8ba0a5]`}>{formatRate(hashRate)}</span>
        </label>
        <label className="block">
          <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#789098]">Projected solved %</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={solvedPercent}
            onChange={(event) => onSolvedPercentChange(Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
            className={`${mono} mt-2 w-full rounded-md border border-[#bfd3d5] bg-white px-3 py-2 text-xs text-[#355b63] outline-none focus:border-[#147f79]`}
            data-testid="input-order-solved-percent"
          />
          <span className="mt-1 block text-[9px] text-[#8ba0a5]">Projection only</span>
        </label>
        <label className="block">
          <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#789098]">Total integer items</span>
          <input
            type="number"
            min={1}
            max={100_000_000}
            value={totalItems}
            onChange={(event) => onTotalItemsChange(Math.max(1, Number(event.target.value) || 1))}
            className={`${mono} mt-2 w-full rounded-md border border-[#bfd3d5] bg-white px-3 py-2 text-xs text-[#355b63] outline-none focus:border-[#147f79]`}
            data-testid="input-order-total-items"
          />
          <span className="mt-1 block text-[9px] text-[#8ba0a5]">Synthetic records / units</span>
        </label>
      </div>

      <button
        type="button"
        onClick={onQuote}
        disabled={!available || pending}
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-[#147f79] px-4 py-2.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white transition hover:bg-[#0f625f] disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="button-preview-order"
      >
        <Calculator size={13} /> {pending ? "Calculating…" : "Calculate preview"}
      </button>

      {!available && task && (
        <div className="mt-4 rounded-md border border-[#eeb4ae] bg-[#fbe1de] p-3 text-[11px] leading-5 text-[#8e3d35]">
          This task is listed for transparency only. {task.statusReason}
        </div>
      )}

      {quote && (
        <div className="mt-5 border-t border-[#dce8e9] pt-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-md border border-[#a6dfd2] bg-[#e6f8f3] p-3">
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#39716d]">Credits required</div>
              <div className={`${mono} mt-1 text-[18px] font-extrabold text-[#115f5b]`}>{quote.balanceRequiredCredits.toLocaleString()}</div>
              <div className="mt-1 text-[9px] text-[#56817d]">synthetic only</div>
            </div>
            <div className="rounded-md border border-[#d4e1e2] bg-white p-3">
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Projected solved</div>
              <div className={`${mono} mt-1 text-[18px] font-extrabold text-[#355b63]`}>{quote.estimatedSolvedItems.toLocaleString()}</div>
              <div className="mt-1 text-[9px] text-[#71878d]">of {quote.totalItems.toLocaleString()} items</div>
            </div>
            <div className="rounded-md border border-[#d4e1e2] bg-white p-3">
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Estimated time</div>
              <div className={`${mono} mt-1 text-[18px] font-extrabold text-[#355b63]`}>{quote.estimatedTime}</div>
              <div className="mt-1 text-[9px] text-[#71878d]">at {formatRate(quote.hashRate)}</div>
            </div>
            <div className="rounded-md border border-[#d4e1e2] bg-white p-3">
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Dispatch</div>
              <div className="mt-2 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#147f79]">{queueResult ? "Queued locally" : "Preview only"}</div>
              <div className="mt-1 text-[9px] text-[#71878d]">{queueResult ? `${queueResult.activeMiners} active miner(s)` : "not dispatched"}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[#71878d]">
            <span className="flex items-center gap-1"><Clock3 size={12} /> {quote.estimatedSeconds.toLocaleString()} seconds</span>
            <span className="flex items-center gap-1"><Gauge size={12} /> {formatRate(quote.hashRate)} measured input</span>
            <span className="flex items-center gap-1"><WalletCards size={12} /> deposit required: no</span>
          </div>
          <button
            type="button"
            onClick={onQueue}
            disabled={!available || queuePending}
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-[#147f79] bg-white px-4 py-2.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#147f79] transition hover:bg-[#e8f8f4] disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="button-queue-local-job"
          >
            <ShieldCheck size={13} /> {queuePending ? "Queueing…" : "Queue local job"}
          </button>
          {queueResult && (
            <div className="mt-3 rounded-md border border-[#a6dfd2] bg-[#e6f8f3] p-3 text-[10px] leading-5 text-[#39716d]" data-testid="panel-queue-result">
              {queueResult.message} Future local workers stay on this task until another task is queued.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function TaskOrdersPage() {
  const catalogQuery = useGetTaskOrderCatalog();
  const statusQuery = useGetCommandCenterStatus({
    query: { queryKey: getGetCommandCenterStatusQueryKey(), refetchInterval: 10_000 },
  });
  const quoteMutation = useQuoteTaskOrder();
  const queueMutation = useQueueTaskOrder();
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [category, setCategory] = useState("all");
  const [hashRate, setHashRate] = useState(1_000_000);
  const [solvedPercent, setSolvedPercent] = useState(85);
  const [totalItems, setTotalItems] = useState(10_000);

  useEffect(() => {
    if (catalogQuery.data && !selectedTaskId) {
      const firstAvailable = catalogQuery.data.tasks.find((task) => task.status === "available");
      setSelectedTaskId(firstAvailable?.id ?? catalogQuery.data.tasks[0]?.id ?? "");
      setHashRate(Math.max(1, catalogQuery.data.defaultHashRate));
      if (firstAvailable) setTotalItems(firstAvailable.defaultItems);
    }
  }, [catalogQuery.data, selectedTaskId]);

  const tasks = catalogQuery.data?.tasks ?? [];
  const categories = useMemo(() => ["all", ...Array.from(new Set(tasks.map((task) => task.category)))], [tasks]);
  const visibleTasks = category === "all" ? tasks : tasks.filter((task) => task.category === category);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const availableCount = tasks.filter((task) => task.status === "available").length;
  const measuredHashRate = statusQuery.data?.coordinator.hashRate ?? catalogQuery.data?.defaultHashRate ?? 0;

  const calculateQuote = () => {
    if (!selectedTask) return;
    quoteMutation.mutate({
      data: {
        taskId: selectedTask.id,
        hashRate: Math.max(1, Math.round(hashRate)),
        solvedPercent: Math.max(0, Math.min(100, solvedPercent)),
        totalItems: Math.max(1, Math.round(totalItems)),
      },
    });
  };

  const queueLocalJob = () => {
    if (!selectedTask || !quoteMutation.data) return;
    queueMutation.mutate({ data: { taskId: selectedTask.id } });
  };

  if (catalogQuery.isLoading) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-[#eaf2f3] text-sm font-bold text-[#55737a]">Loading task-order catalog…</div>;
  }
  if (catalogQuery.isError || !catalogQuery.data) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-[#eaf2f3] text-sm font-bold text-[#a23d34]">Task-order catalog unavailable.</div>;
  }

  return (
    <div className="min-h-[100dvh] bg-[#eaf2f3] text-[#214751]">
      <header className="border-b border-[#d5e2e3] bg-[#102a32] text-white">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-4 px-4 py-4 md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[#3d8c88] bg-[#18464d]"><ShieldCheck size={19} className="text-[#8be1ce]" /></div>
            <div>
              <div className="text-[13px] font-extrabold tracking-[0.08em]">ARGUS</div>
              <div className={`${mono} text-[9px] uppercase tracking-[0.16em] text-[#7ea7ad]`}>Task order preview</div>
            </div>
          </div>
          <a href={`${basePath}/`} className="inline-flex items-center gap-2 rounded-md border border-[#41636a] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#b8d9d9] transition hover:border-[#86cfc1] hover:text-white" data-testid="link-back-command-center">
            <ArrowLeft size={13} /> Command center
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-4 py-7 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#618089]"><span className="h-1.5 w-1.5 rounded-full bg-[#159d8d]" /> Safe catalog bridge</div>
            <h1 className="mt-2 text-[28px] font-extrabold tracking-[-0.05em] text-[#173741]">Task orders</h1>
            <p className="mt-2 max-w-[680px] text-[13px] leading-6 text-[#668087]">
              Archive-inspired lab and blue-team tasks mapped to the Security Mining Console. Preview mode is local and creditless: no deposit, payout, credential recovery, or external target access.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded border border-[#a8dcd2] bg-[#e8f8f4] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#13776f]">Preview mode</span>
            <span className="rounded border border-[#d4e1e2] bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#637d83]">No deposit required</span>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-[#cbdedf] bg-white p-4"><div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#82969b]">Available tasks</div><div className={`${mono} mt-2 text-2xl font-extrabold text-[#147f79]`}>{availableCount}</div><div className="mt-1 text-[10px] text-[#71878d]">bounded local executors</div></div>
          <div className="rounded-lg border border-[#cbdedf] bg-white p-4"><div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#82969b]">Listed, unavailable</div><div className={`${mono} mt-2 text-2xl font-extrabold text-[#a23d34]`}>{tasks.length - availableCount}</div><div className="mt-1 text-[10px] text-[#71878d]">blocked by safety boundary</div></div>
          <div className="rounded-lg border border-[#cbdedf] bg-white p-4"><div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#82969b]">Measured rate</div><div className={`${mono} mt-2 text-2xl font-extrabold text-[#355b63]`}>{formatRate(measuredHashRate)}</div><div className="mt-1 text-[10px] text-[#71878d]">from live coordinator</div></div>
          <div className="rounded-lg border border-[#cbdedf] bg-white p-4"><div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#82969b]">Accounting</div><div className="mt-2 text-lg font-extrabold text-[#355b63]">Synthetic credits</div><div className="mt-1 text-[10px] text-[#71878d]">no funds are moved</div></div>
        </div>

        <div className="mt-7 grid gap-6 xl:grid-cols-[1.35fr_.9fr]">
          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#66828a]">Catalog</div>
                <h2 className="mt-1 text-[18px] font-extrabold text-[#214751]">Choose an authorized task</h2>
              </div>
              <select value={category} onChange={(event) => setCategory(event.target.value)} className={`${mono} rounded-md border border-[#bfd3d5] bg-white px-3 py-2 text-[10px] font-bold text-[#355b63]`} aria-label="Filter task order category" data-testid="select-order-category">
                {categories.map((value) => <option key={value} value={value}>{value === "all" ? "All categories" : value}</option>)}
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {visibleTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  selected={task.id === selectedTaskId}
                  onSelect={() => {
                    setSelectedTaskId(task.id);
                    setTotalItems(task.defaultItems || 10_000);
                    quoteMutation.reset();
                    queueMutation.reset();
                  }}
                />
              ))}
            </div>
          </section>

          <div className="space-y-4">
            <QuotePanel
              task={selectedTask}
              hashRate={hashRate}
              solvedPercent={solvedPercent}
              totalItems={totalItems}
              onHashRateChange={setHashRate}
              onSolvedPercentChange={setSolvedPercent}
              onTotalItemsChange={setTotalItems}
              onQuote={calculateQuote}
              onQueue={queueLocalJob}
              pending={quoteMutation.isPending}
              queuePending={queueMutation.isPending}
              quote={quoteMutation.data}
              queueResult={queueMutation.data}
            />
            {quoteMutation.isError && <div className="rounded-md border border-[#eeb4ae] bg-[#fbe1de] p-3 text-[11px] text-[#8e3d35]">The coordinator rejected this preview request.</div>}
            <div className="rounded-lg border border-[#d4e1e2] bg-white p-4">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#66828a]"><ExternalLink size={13} /> Source boundary</div>
              <p className="mt-2 text-[11px] leading-5 text-[#71878d]">
                The uploaded PHP archive was inspected read-only. Its payment, card, wallet, seller, and deposit databases are not connected. These task names are mapped to local safe executors instead.
              </p>
              <a href={`${basePath}/htdocs-preview`} className="mt-3 inline-flex items-center gap-2 rounded-md border border-[#bfd3d5] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#3d6870] transition hover:border-[#147f79] hover:text-[#147f79]" data-testid="link-open-htdocs-preview">
                <ExternalLink size={12} /> Open htdocs preview
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}