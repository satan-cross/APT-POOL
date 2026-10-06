import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Beaker,
  CheckCircle2,
  ChevronRight,
  Copy,
  Cpu,
  Database,
  Gauge,
  Globe2,
  LayoutDashboard,
  Menu,
  Moon,
  Network,
  Pause,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Signal,
  Sun,
  TerminalSquare,
  ClipboardList,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  getGetCommandCenterStatusQueryKey,
  getHealthCheckQueryKey,
  useSaveCommandCenterSettings,
  useMigrateCommandCenterDns,
  useRunCommandCenterDemo,
  useGetCommandCenterStatus,
  useHealthCheck,
} from '@workspace/api-client-react';
import type {
  CommandCenterStatus,
  DemoResult,
  LedgerBlock,
  WorkloadTelemetry,
} from '@workspace/api-client-react';
import { ExploitDetectionPanel } from '../components/exploit-detection-panel';

const mono = 'font-mono';
type Difficulty = '00' | '000' | '0000';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function statusLabel(value?: string) {
  return (value || 'unknown').replace(/[_-]/g, ' ').toLowerCase();
}

function isHealthy(value?: string) {
  return ['healthy', 'online', 'active', 'running', 'verified', 'ready', 'ok'].includes(
    statusLabel(value),
  );
}

function statusClass(value?: string) {
  const normalized = statusLabel(value);
  if (isHealthy(value)) return 'bg-[#d7f4eb] text-[#087a62] border-[#a5dfcf]';
  if (['warning', 'degraded', 'stalled', 'pending', 'warming up', 'below floor'].includes(normalized)) {
    return 'bg-[#fff0d1] text-[#9b5d05] border-[#f1d08f]';
  }
  if (['critical', 'offline', 'failed', 'error'].includes(normalized)) {
    return 'bg-[#fbe1de] text-[#a23d34] border-[#eeb4ae]';
  }
  return 'bg-[#e6edf0] text-[#536771] border-[#cad8dd]';
}

function severityClass(value?: string) {
  const normalized = statusLabel(value);
  if (normalized === 'critical') return 'text-[#b33d32] bg-[#fce6e2]';
  if (normalized === 'high') return 'text-[#a66009] bg-[#fff0d1]';
  if (normalized === 'medium') return 'text-[#147b81] bg-[#d8f0f1]';
  return 'text-[#5b6d75] bg-[#e8eef0]';
}

function formatTime(value?: string, includeSeconds = true) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
    hour12: false,
  });
}

function formatDate(value?: string) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function shortHash(value: string) {
  if (value.length < 15) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

type AcceptedReport = Pick<DemoResult, 'answer' | 'details' | 'evidence' | 'executionEvidence'>;
function formatHashRate(value?: number) {
  const rate = Number(value) || 0;
  if (rate >= 1_000_000_000_000_000) return `${(rate / 1_000_000_000_000_000).toFixed(2)} PH/s`;
  if (rate >= 1_000_000_000_000) return `${(rate / 1_000_000_000_000).toFixed(2)} TH/s`;
  if (rate >= 1_000_000_000) return `${(rate / 1_000_000_000).toFixed(2)} GH/s`;
  if (rate >= 1_000_000) return `${(rate / 1_000_000).toFixed(2)} MH/s`;
  if (rate >= 1_000) return `${(rate / 1_000).toFixed(1)} kH/s`;
  return `${rate.toLocaleString()} H/s`;
}

function formatCandidateCount(value: bigint) {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function superscript(value: string) {
  const glyphs: Record<string, string> = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    '-': '⁻',
  };
  return value.split('').map((character) => glyphs[character] ?? character).join('');
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return 'rate unavailable';
  if (seconds < 1) return '< 1 second';
  if (seconds < 60) return `${seconds.toFixed(1)} seconds`;
  if (seconds < 3_600) return `${(seconds / 60).toFixed(1)} minutes`;
  if (seconds < 86_400) return `${(seconds / 3_600).toFixed(1)} hours`;
  if (seconds < 31_557_600) return `${(seconds / 86_400).toFixed(1)} days`;
  return `${(seconds / 31_557_600).toFixed(2)} years`;
}

function parseSolveRate(value?: string) {
  if (!value) return 0;
  const amount = Number.parseFloat(value.replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (value.includes('/hour')) return amount / 3_600;
  if (value.includes('/min')) return amount / 60;
  return amount;
}

function StatPill({
  label,
  value,
  accent = 'teal',
}: {
  label: string;
  value: string;
  accent?: 'teal' | 'amber' | 'slate';
}) {
  return (
    <div
      className={cx(
        'rounded border px-3 py-2',
        accent === 'teal' && 'border-[#a6dfd2] bg-[#e6f8f3]',
        accent === 'amber' && 'border-[#f0d293] bg-[#fff5df]',
        accent === 'slate' && 'border-[#cedce0] bg-[#edf3f4]',
      )}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#60747c]">
        {label}
      </div>
      <div className="mt-1 text-sm font-extrabold tracking-tight text-[#17333b]" data-testid={`text-stat-${label.toLowerCase().replace(/\s/g, '-')}`}>
        {value}
      </div>
    </div>
  );
}

function DifficultyControl({
  value,
  onChange,
  onProduction,
  gpuBackend,
  onGpuBackendChange,
  label = 'Mining difficulty',
  minerCount,
  onMinerCountChange,
  onSave,
  saving,
  saved,
}: {
  value: Difficulty;
  onChange: (value: Difficulty) => void;
  onProduction: () => void;
  gpuBackend?: 'auto' | 'gpu' | 'disabled';
  onGpuBackendChange?: (value: 'auto' | 'gpu' | 'disabled') => void;
  label?: string;
  minerCount?: number;
  onMinerCountChange?: (value: number) => void;
  onSave?: () => void;
  saving?: boolean;
  saved?: boolean;
}) {
  return (
    <section className="rounded-lg border border-[#d2dfe1] bg-[#f8fbfb] p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#66828a]">{label}</div>
          <div className="mt-1 text-xs text-[#71888f]">Leading zeroes on the live TCP proof hash</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={value} onChange={(event) => onChange(event.target.value as Difficulty)} className={`${mono} rounded-md border border-[#bfd3d5] bg-white px-3 py-2 text-xs font-bold text-[#355b63]`} aria-label={label} data-testid="select-difficulty">
            <option value="00">00 · quick</option>
            <option value="000">000 · balanced</option>
            <option value="0000">0000 · production</option>
          </select>
          <button type="button" onClick={onProduction} className="rounded-md border border-[#d5ad4b] bg-[#fff5d9] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#7e5e16] hover:bg-[#ffefbf]" data-testid="button-production-difficulty">Production difficulty</button>
        </div>
      </div>
      {onMinerCountChange && minerCount !== undefined && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#e2ebec] pt-3">
          <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#66828a]">Server miners</div><div className="mt-1 text-xs text-[#71888f]">Real loopback TCP workers to keep connected</div></div>
          <input type="number" min={1} max={16} value={minerCount} onChange={(event) => onMinerCountChange(Math.max(1, Math.min(16, Number(event.target.value) || 1)))} className={`${mono} w-20 rounded-md border border-[#bfd3d5] bg-white px-3 py-2 text-center text-xs font-bold text-[#355b63]`} aria-label="Server miner count" data-testid="input-miner-count" />
        </div>
      )}
      {onGpuBackendChange && gpuBackend && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#e2ebec] pt-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#66828a]">Local GPU backend</div>
            <div className="mt-1 text-xs text-[#71888f]">Auto uses GPU when available, otherwise bounded CPU fallback</div>
          </div>
          <select
            value={gpuBackend}
            onChange={(event) => onGpuBackendChange(event.target.value as 'auto' | 'gpu' | 'disabled')}
            className={`${mono} rounded-md border border-[#bfd3d5] bg-white px-3 py-2 text-xs font-bold text-[#355b63]`}
            aria-label="Local GPU backend"
            data-testid="select-gpu-backend"
          >
            <option value="auto">Auto · GPU when available</option>
            <option value="gpu">GPU · require GPU</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
      )}
      {onSave && (
        <div className="mt-3 flex items-center justify-between border-t border-[#e2ebec] pt-3">
          <span className="text-[10px] text-[#71888f]">{saved ? 'Saved to the command-center database.' : 'Home defaults load from the database on reload.'}</span>
          <button type="button" onClick={onSave} disabled={saving} className="rounded-md bg-[#147f79] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-white hover:bg-[#0f625f] disabled:opacity-60" data-testid="button-save-settings">{saving ? 'Saving…' : 'Save dashboard defaults'}</button>
        </div>
      )}
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  count,
  action,
  onAction,
}: {
  eyebrow: string;
  title: string;
  count?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#64818a]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#e6a329]" />
          {eyebrow}
        </div>
        <h2 className="text-[17px] font-extrabold tracking-[-0.03em] text-[#183943]">{title}</h2>
      </div>
      {(count || action) && (
        <div className="flex items-center gap-3">
          {count && <span className={`${mono} text-[11px] text-[#6a8189]`} data-testid={`text-count-${title.toLowerCase().replace(/\s/g, '-')}`}>{count}</span>}
           {action && <button className="flex items-center gap-1 text-[11px] font-bold text-[#137b76] transition-colors hover:text-[#0e514f]" type="button" onClick={onAction} data-testid={`button-${action.toLowerCase().replace(/\s/g, '-')}`}>{action}<ChevronRight size={13} /></button>}
        </div>
      )}
    </div>
  );
}

function LoadingDashboard() {
  return (
    <div className="min-h-[100dvh] bg-[#eaf2f3] p-4 md:p-8">
      <div className="mx-auto max-w-[1520px] space-y-5">
        <div className="h-20 animate-pulse rounded-lg bg-[#dce8e9]" />
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="h-52 animate-pulse rounded-lg bg-[#dce8e9]" />
          <div className="h-52 animate-pulse rounded-lg bg-[#dce8e9]" />
        </div>
        <div className="h-80 animate-pulse rounded-lg bg-[#dce8e9]" />
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#eaf2f3] p-6">
      <div className="w-full max-w-md rounded-xl border border-[#e4b9b2] bg-[#fff8f5] p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#fce6e2] text-[#ac433a]">
          <XCircle size={23} />
        </div>
        <h1 className="mt-5 text-xl font-extrabold text-[#472b2a]">Telemetry unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-[#765c59]">
          The coordinator snapshot could not be read. Check the service connection and try again.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-[#b24a3e] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#963b32] focus:outline-none focus:ring-2 focus:ring-[#b24a3e] focus:ring-offset-2"
          data-testid="button-retry-telemetry"
        >
          <RefreshCw size={15} /> Retry connection
        </button>
      </div>
    </div>
  );
}

function Sidebar({
  mobileOpen,
  onClose,
  darkMode,
  onToggleDark,
}: {
  mobileOpen: boolean;
  onClose: () => void;
  darkMode: boolean;
  onToggleDark: () => void;
}) {
  return (
    <>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-[#07181c]/55 md:hidden" onClick={onClose} aria-label="Close navigation" data-testid="button-close-navigation" />}
      <aside className={cx(
        'fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-[#263e45] bg-[#102a32] text-[#dcecef] transition-transform duration-200 md:static md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        <div className="flex h-[76px] items-center justify-between border-b border-[#29444c] px-5">
          <div className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border border-[#3d8c88] bg-[#18464d]">
              <div className="absolute h-20 w-1 -rotate-45 bg-[#d9a329]" />
              <ShieldCheck className="relative z-10 text-[#8be1ce]" size={20} />
            </div>
            <div>
              <div className="text-[13px] font-extrabold tracking-[0.08em] text-white">ARGUS</div>
              <div className={`${mono} text-[9px] uppercase tracking-[0.16em] text-[#7ea7ad]`}>Defensive control</div>
            </div>
          </div>
          <button className="text-[#86aeb4] hover:text-white md:hidden" onClick={onClose} aria-label="Close navigation" data-testid="button-close-sidebar"><ChevronRight size={17} /></button>
        </div>
        <div className="px-4 pt-7">
          <div className="mb-2 px-2 text-[9px] font-bold uppercase tracking-[0.22em] text-[#6e949b]">Workspace</div>
          <nav className="space-y-1" aria-label="Primary navigation">
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex w-full items-center gap-3 rounded-md bg-[#1a4a50] px-3 py-2.5 text-left text-[12px] font-bold text-[#b8f0e4]" type="button" aria-current="page" data-testid="button-nav-command-center">
              <LayoutDashboard size={16} /> Command center <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#d9a329]" />
            </button>
            <button onClick={() => document.getElementById('workloads-section')?.scrollIntoView({ behavior: 'smooth' })} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[12px] font-semibold text-[#9dbbc0] transition hover:bg-[#183b43] hover:text-white" type="button" data-testid="button-nav-workloads">
              <Cpu size={16} /> Workload registry
            </button>
            <button onClick={() => window.location.assign(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/task-orders`)} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[12px] font-semibold text-[#9dbbc0] transition hover:bg-[#183b43] hover:text-white" type="button" data-testid="button-nav-task-orders">
              <ClipboardList size={16} /> Task orders
            </button>
            <button onClick={() => document.getElementById('ledger-section')?.scrollIntoView({ behavior: 'smooth' })} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[12px] font-semibold text-[#9dbbc0] transition hover:bg-[#183b43] hover:text-white" type="button" data-testid="button-nav-ledger">
              <Database size={16} /> Proof ledger
            </button>
          </nav>
        </div>
        <div className="mt-auto space-y-4 border-t border-[#29444c] p-4">
          <div className="rounded-md border border-[#31535b] bg-[#15363e] p-3">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#82b5b7]"><Signal size={12} /> Ingest link</div>
            <div className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-[#d3f1eb]"><span className="status-pulse h-2 w-2 rounded-full bg-[#54d2b4]" /> Streaming telemetry</div>
            <div className={`${mono} mt-2 text-[10px] text-[#739ba1]`}>TLS / INTERNAL BUS</div>
          </div>
          <button type="button" onClick={onToggleDark} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-[11px] font-semibold text-[#9dbbc0] transition hover:bg-[#183b43] hover:text-white" data-testid="button-toggle-theme">
            {darkMode ? <Sun size={15} /> : <Moon size={15} />} {darkMode ? 'Light instrument' : 'Night instrument'}
          </button>
        </div>
      </aside>
    </>
  );
}

function Topbar({
  refreshedAt,
  onRefresh,
  refreshing,
  autoRefresh,
  onToggleAutoRefresh,
  onOpenMenu,
}: {
  refreshedAt?: string;
  onRefresh: () => void;
  refreshing: boolean;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onOpenMenu: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-[#d5e2e3] bg-[#eaf2f3]/95 backdrop-blur">
      <div className="flex min-h-[76px] items-center justify-between gap-4 px-4 py-3 md:px-8">
        <div className="flex items-center gap-3">
          <button className="rounded-md border border-[#cadcdf] p-2 text-[#3c5a63] md:hidden" onClick={onOpenMenu} aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={18} /></button>
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#618089]"><span className="h-1.5 w-1.5 rounded-full bg-[#159d8d]" /> Live operations</div>
            <h1 className="mt-1 text-[21px] font-extrabold tracking-[-0.045em] text-[#173741] md:text-[24px]">Defensive workload command center</h1>
          </div>
        </div>
        <div className="hidden items-center gap-5 md:flex">
          <div className="text-right">
            <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#789098]">Last coordinator frame</div>
            <div className={`${mono} mt-1 text-[11px] font-medium text-[#365660]`} data-testid="text-last-coordinator-frame">{formatTime(refreshedAt)}</div>
          </div>
          <div className="h-8 w-px bg-[#d0dfe1]" />
          <div className="flex items-center gap-2">
            <button type="button" onClick={onToggleAutoRefresh} className={cx('flex items-center gap-2 rounded-md border px-3 py-2 text-[11px] font-bold transition', autoRefresh ? 'border-[#a8dcd2] bg-[#e8f8f4] text-[#13776f]' : 'border-[#cddbdd] bg-[#f6f9f9] text-[#718389]')} aria-pressed={autoRefresh} data-testid="button-toggle-auto-refresh">
              <span className={cx('h-1.5 w-1.5 rounded-full', autoRefresh ? 'status-pulse bg-[#159d8d]' : 'bg-[#9daeb2]')} /> {autoRefresh ? 'Auto refresh' : 'Paused'}
            </button>
            <button type="button" onClick={onRefresh} className="rounded-md border border-[#c8d8da] bg-[#f8fbfb] p-2 text-[#3b6970] transition hover:border-[#7dbbb3] hover:bg-white disabled:opacity-60" disabled={refreshing} aria-label="Refresh telemetry" data-testid="button-refresh-telemetry">
              <RefreshCw className={cx(refreshing && 'animate-spin')} size={15} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

function CoordinatorCard({ status }: { status: CommandCenterStatus }) {
  const { coordinator } = status;
  const gpuUnavailable = coordinator.gpuMining.requestedBackend === 'gpu'
    && !coordinator.gpuMining.active
    && coordinator.gpuMining.backend === 'disabled';
  return (
    <section className="relative overflow-hidden rounded-lg border border-[#1d555b] bg-[#123e46] p-5 text-[#e4fbf4] shadow-sm md:p-6">
      <div className="absolute right-0 top-0 h-full w-2/5 opacity-30" style={{ backgroundImage: 'linear-gradient(120deg, transparent 10%, rgba(91,220,194,.28) 10.5%, transparent 11%)', backgroundSize: '12px 12px' }} />
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#86ccc3]"><Server size={13} /> Coordinator</div>
          <div className="mt-4 flex items-center gap-3">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-full border border-[#52bca9] bg-[#1e5b60]"><Radio size={20} className="text-[#9bf2dc]" /><span className="status-pulse absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-[#d9a329]" /></div>
            <div>
              <div className="text-[25px] font-extrabold tracking-[-0.05em]">Command link</div>
              <div className={`${mono} mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[#8cc6c3]`}>{statusLabel(coordinator.status)} / policy enforced</div>
            </div>
          </div>
        </div>
        <span className="rounded border border-[#65c5b3] bg-[#1b5c5c] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#a7f1df]" data-testid="status-coordinator">{statusLabel(coordinator.status)}</span>
      </div>
      <div className="relative z-10 mt-7 grid grid-cols-2 gap-3 border-t border-[#2c6870] pt-4 sm:grid-cols-4">
        <StatPill label="Live miners" value={String(coordinator.activeMiners)} accent="teal" />
        <StatPill label="Pool port" value={`:${coordinator.poolPort}`} accent="teal" />
        <StatPill label="Accepted shares" value={String(coordinator.acceptedShares)} accent="teal" />
        <StatPill label="Difficulty" value={coordinator.difficulty} accent="amber" />
      </div>
      <div className="relative z-10 mt-4 rounded-md border border-[#3d7c7d] bg-[#164b53] p-3" data-testid="panel-throughput-health">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#a8e4d6]">
            <Gauge size={13} /> Release-floor health
          </div>
          <span className={cx('rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em]', statusClass(coordinator.throughputHealth.status))} data-testid="status-throughput-health">
            {statusLabel(coordinator.throughputHealth.status)}
          </span>
        </div>
        <div className="mt-2 text-[10px] leading-4 text-[#b9d9d6]">
          Minimum health indicator, not an exact speed target.
        </div>
        <div className={`${mono} mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[#d5efeb]`}>
          <span>Observed {formatHashRate(coordinator.throughputHealth.observedHashRate)}</span>
          <span>Floor {formatHashRate(coordinator.throughputHealth.releaseFloorHashRate)}</span>
          <span>Accepted {coordinator.throughputHealth.acceptedShares.toLocaleString()}</span>
          <span>
            Evidence {coordinator.throughputHealth.evidenceAgeMs === null
              ? '—'
              : `${Math.round(coordinator.throughputHealth.evidenceAgeMs / 1000)}s ago`}
          </span>
        </div>
        <div className="mt-2 text-[10px] leading-4 text-[#8fc4c0]">{coordinator.throughputHealth.explanation}</div>
      </div>
      <div className="relative z-10 mt-3 rounded-md border border-[#3d7c7d] bg-[#164b53] p-3" data-testid="panel-gpu-mining">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#a8e4d6]">
            <Cpu size={13} /> GPU process miner
          </div>
          <span
            className={cx(
              'rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em]',
              statusClass(
                gpuUnavailable
                  ? 'offline'
                  : coordinator.gpuMining.backend === 'gpu'
                    ? 'healthy'
                    : coordinator.gpuMining.backend === 'cpu-fallback'
                      ? 'warming-up'
                      : coordinator.gpuMining.available
                        ? 'warming-up'
                        : 'offline',
              ),
            )}
            data-testid="status-gpu-mining"
          >
            {coordinator.gpuMining.requestedBackend === 'gpu' && !coordinator.gpuMining.active && coordinator.gpuMining.backend === 'disabled'
              ? 'unavailable'
              : coordinator.gpuMining.active
                ? coordinator.gpuMining.backend
                : coordinator.gpuMining.available
                  ? 'ready'
                  : 'not detected'}
          </span>
        </div>
        <div className={`${mono} mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[#d5efeb]`}>
          <span>Mode {coordinator.gpuMining.requestedBackend}</span>
          <span>Device {coordinator.gpuMining.device || '—'}</span>
          <span>Process {coordinator.gpuMining.processCount}</span>
          <span>Events {coordinator.gpuMining.stdoutLines}</span>
          <span>Measured {formatHashRate(coordinator.gpuMining.measuredHashRate)}</span>
          <span>Process {formatHashRate(coordinator.gpuMining.effectiveHashRateMhs * 1_000_000)}</span>
        </div>
        <div className="mt-2 text-[10px] leading-4 text-[#8fc4c0]">{coordinator.gpuMining.explanation}</div>
      </div>
    </section>
  );
}

function DnsCard({ status }: { status: CommandCenterStatus }) {
  const { dns } = status;
  return (
    <section className="rounded-lg border border-[#d2dfe1] bg-[#f8fbfb] p-5 shadow-sm md:p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#66828a]"><Globe2 size={14} className="text-[#168c83]" /> DNS probe</div>
        <span className={cx('rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em]', statusClass(dns.status))} data-testid="status-dns-probe">{statusLabel(dns.status)}</span>
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <div className={`${mono} text-[18px] font-medium tracking-[-0.04em] text-[#173943]`} data-testid="text-dns-domain">{dns.domain}</div>
          <div className={`${mono} mt-1 text-[11px] text-[#739099]`}>{dns.ip}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#e5f4f1] text-[#188c83]"><Network size={19} /></div>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-2 border-t border-[#e2ebec] pt-4">
        <StatPill label="TTL" value={`${dns.ttl}s`} accent="slate" />
        <StatPill label="Port" value={`:${dns.port}`} accent="slate" />
        <StatPill label="Queries" value={String(dns.queries)} accent="slate" />
      </div>
      <div className="mt-3 flex items-center justify-between text-[10px] text-[#71888f]"><span>Record serial</span><span className={`${mono} text-[#355b63]`}>{dns.serial}</span></div>
    </section>
  );
}

function WorkloadCard({ workload, index, onDemo, onOpenTask, demoRunning }: { workload: WorkloadTelemetry; index: number; onDemo: (workloadId: string) => void; onOpenTask: (workloadId: string) => void; demoRunning: boolean }) {
  const progress = Math.min(100, Math.max(0, Number(workload.progress) || 0));
  const publicKeyValidation = isPublicKeyWorkload(workload);
  const acceptedReport = acceptedReportFor(workload);
  const evidenceDigest = acceptedReport?.executionEvidence.evidenceDigest || workload.evidenceDigest;
  return (
    <article className="group rounded-lg border border-[#d4e0e2] bg-[#f9fbfb] p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-[#9dc9c5] hover:shadow-md" data-testid={`card-workload-${workload.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#e1f3ef] text-[#19877e]"><Activity size={16} /></div>
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-extrabold text-[#1b3d46]" data-testid={`text-workload-name-${workload.id}`}>{workload.name}</h3>
             <div className={`${mono} mt-1 truncate text-[10px] uppercase tracking-[0.1em] text-[#779098]`}>{workload.id} · {workload.category}</div>
          </div>
        </div>
        <span className={cx('shrink-0 rounded border px-1.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em]', severityClass(workload.severity))} data-testid={`status-workload-severity-${workload.id}`}>{statusLabel(workload.severity)}</span>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-bold text-[#42636a]"><span className={cx('h-1.5 w-1.5 rounded-full', workload.completionState === 'complete' ? 'bg-[#159d8d]' : workload.completionState === 'running' ? 'bg-[#d99b23] status-pulse' : 'bg-[#9aadb2]')} /> {completionLabel(workload)}</div>
        <span className={`${mono} text-[11px] font-medium text-[#355b63]`} data-testid={`text-workload-progress-${workload.id}`}>{progress}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#dce9e9]"><div className="bar-rise h-full rounded-full bg-[#159d8d]" style={{ width: `${progress}%`, animationDelay: `${index * 70}ms` }} /></div>
      {publicKeyValidation ? (
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[#e5eded] pt-3">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#80959b]">Assessment</div>
            <div className={`${mono} mt-1 text-[11px] text-[#355b63]`} data-testid={`text-workload-assessment-${workload.id}`}>{completionLabel(workload)}</div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#80959b]">Evidence digest</div>
            <div className={`${mono} mt-1 truncate text-[11px] text-[#355b63]`} title={evidenceDigest || undefined} data-testid={`text-workload-evidence-digest-${workload.id}`}>{evidenceDigest ? shortHash(evidenceDigest) : '—'}</div>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[#e5eded] pt-3 sm:grid-cols-4">
          <div><div className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#80959b]">Proofs</div><div className={`${mono} mt-1 text-[11px] text-[#355b63]`} data-testid={`text-workload-proofs-${workload.id}`}>{workload.verifiedShares}</div></div>
          <div><div className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#80959b]">Hashes / attempts</div><div className={`${mono} mt-1 text-[11px] text-[#355b63]`}>{workload.hashes.toLocaleString()}</div></div>
          <div><div className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#80959b]">Hash rate</div><div className={`${mono} mt-1 text-[11px] text-[#355b63]`}>{formatHashRate(workload.hashRate)}</div></div>
          <div><div className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#80959b]">Last hash</div><div className={`${mono} mt-1 text-[11px] text-[#355b63]`}>{workload.lastProof ? shortHash(workload.lastProof) : '—'}</div></div>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-md border border-[#dce7e8] bg-white p-2.5">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#80959b]">Executor</div>
          <div className={`${mono} mt-1 truncate text-[10px] text-[#355b63]`} title={workload.executor}>{workload.executor}</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#80959b]">Accepted evidence</div>
          <div className={`${mono} mt-1 truncate text-[10px] text-[#355b63]`} title={workload.evidenceSource}>{workload.evidenceSource === 'none' ? 'pending executor' : workload.evidenceSource}</div>
        </div>
       </div>
      {publicKeyValidation && (
        <div className="mt-3 grid gap-2 rounded-md border border-[#dce7e8] bg-white p-2.5 sm:grid-cols-2">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#80959b]">Completion reason</div>
            <div className="mt-1 text-[10px] leading-4 text-[#355b63]" data-testid={`text-workload-completion-reason-${workload.id}`}>{acceptedReport?.answer || (workload.completionState === 'complete' ? 'Accepted assessment report recorded.' : 'No accepted assessment yet.')}</div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#80959b]">Evidence digest</div>
            <div className={`${mono} mt-1 truncate text-[10px] text-[#355b63]`} title={evidenceDigest || undefined}>{evidenceDigest || '—'}</div>
          </div>
        </div>
      )}
        <div className="mt-3 flex items-center gap-1.5 text-[10px] leading-4 text-[#688087]"><ArrowUpRight size={12} className="shrink-0 text-[#d49c27]" /> <span className="truncate">{workload.note || 'No operator note attached.'}</span></div>
       <div className={`${mono} mt-2 truncate text-[10px] text-[#527078]`} title={workload.algorithm}>algorithm · {workload.algorithm}</div>
      <div className="mt-4 flex items-center gap-2 border-t border-[#e5eded] pt-3">
        <button type="button" onClick={() => workload.executor === 'public-key-validator' ? onOpenTask(workload.id) : onDemo(workload.id)} disabled={demoRunning} className="flex-1 rounded-md bg-[#147f79] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-white transition hover:bg-[#0f625f] disabled:cursor-wait disabled:opacity-60" data-testid={`button-demo-${workload.id}`}>
          {publicKeyValidation ? 'Validate public key' : demoRunning ? 'Running…' : 'Demo task'}
        </button>
        <button type="button" onClick={() => onOpenTask(workload.id)} className="rounded-md border border-[#bfd3d5] bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#3d6870] transition hover:border-[#7dbbb3] hover:text-[#147f79]" data-testid={`button-open-task-${workload.id}`}>Open page</button>
      </div>
    </article>
  );
}

function Workloads({ workloads, onDemo, onOpenTask, demoRunning }: { workloads: WorkloadTelemetry[]; onDemo: (workloadId: string) => void; onOpenTask: (workloadId: string) => void; demoRunning: boolean }) {
  const [categoryFilter, setCategoryFilter] = useState('all');
  const categories = Array.from(new Set(workloads.map((workload) => workload.category))).sort();
  const visibleWorkloads = categoryFilter === 'all'
    ? workloads
    : workloads.filter((workload) => workload.category === categoryFilter);

  return (
    <section id="workload-registry">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          eyebrow="Execution layer"
          title="Workload telemetry"
          count={`${visibleWorkloads.length} of ${workloads.length} tracked`}
          action="View registry"
          onAction={() => {
            setCategoryFilter('all');
            document.getElementById('workload-registry')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        />
        <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#66828a]">
          Category
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className={`${mono} rounded-md border border-[#bfd3d5] bg-white px-2 py-2 text-[10px] font-bold normal-case tracking-normal text-[#355b63]`}
            aria-label="Filter workload category"
            data-testid="select-workload-category"
          >
            <option value="all">All categories</option>
            {categories.map((category) => <option key={category} value={category}>{category.replace(/-/g, ' ')}</option>)}
          </select>
        </label>
      </div>
      {workloads.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-[#c4d6d9] bg-[#f7fbfb] p-6 text-center">
          <div><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#e2eeee] text-[#638088]"><Pause size={17} /></div><div className="mt-3 text-sm font-bold text-[#3d5b62]">No workloads reporting</div><p className="mt-1 text-xs text-[#789098]">The registry is empty for this coordinator frame.</p></div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visibleWorkloads.map((workload, index) => <WorkloadCard key={workload.id} workload={workload} index={index} onDemo={onDemo} onOpenTask={onOpenTask} demoRunning={demoRunning} />)}</div>
      )}
    </section>
  );
}

function Ledger({ ledger }: { ledger: LedgerBlock[] }) {
  return (
    <section className="min-w-0">
      <SectionHeading eyebrow="Proof of work" title="Ledger stream" count={`${ledger.length} recent blocks`} />
      <div className="overflow-hidden rounded-lg border border-[#d2dfe1] bg-[#f8fbfb] shadow-sm">
        {ledger.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#71878d]">No proof blocks in the current stream.</div>
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead className="border-b border-[#dbe7e8] bg-[#edf5f5]">
                <tr className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#6c858c]">
                  <th className="px-4 py-3">Height</th><th className="px-4 py-3">Workload / task</th><th className="px-4 py-3">Hash</th><th className="px-4 py-3">Miner</th><th className="px-4 py-3 text-right">Observed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2ebec]">
                {ledger.map((block) => (
                  <tr className="group transition-colors hover:bg-[#eef8f6]" key={`${block.height}-${block.hash}`} data-testid={`row-ledger-${block.height}`}>
                    <td className="px-4 py-3"><div className={`${mono} flex items-center gap-2 text-[11px] font-medium text-[#38636b]`}><span className="h-1.5 w-1.5 rounded-full bg-[#159d8d]" />{block.height}</div></td>
                    <td className="max-w-[220px] px-4 py-3"><div className="truncate text-[12px] font-bold text-[#294c55]" data-testid={`text-ledger-task-${block.height}`}>{block.task}</div><div className={cx('mt-1 inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]', severityClass(block.severity))}>{statusLabel(block.severity)}</div></td>
                    <td className="px-4 py-3"><div className={`${mono} flex items-center gap-2 text-[10px] text-[#58747b]`}><span>{shortHash(block.hash)}</span><button type="button" onClick={() => navigator.clipboard?.writeText(block.hash)} className="opacity-0 transition group-hover:opacity-100 hover:text-[#127e78] focus:opacity-100" aria-label={`Copy hash for block ${block.height}`} data-testid={`button-copy-hash-${block.height}`}><Copy size={12} /></button></div><div className={`${mono} mt-1 text-[9px] text-[#8da0a5]`}>nonce {block.nonce}</div></td>
                    <td className="px-4 py-3"><div className="flex items-center gap-2 text-[11px] font-semibold text-[#41656b]"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#d9ebeb] text-[9px] font-extrabold text-[#1c7475]">{block.miner.slice(0, 2).toUpperCase()}</span>{block.miner}</div></td>
                    <td className="whitespace-nowrap px-4 py-3 text-right"><div className={`${mono} text-[10px] text-[#4e7077]`}>{formatTime(block.timestamp, false)}</div><div className="mt-1 text-[9px] text-[#8b9da2]">{formatDate(block.timestamp)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function ReportEvidence({
  report,
  evidenceAccepted = true,
  evidenceRejectionReason,
  safety,
}: {
  report: AcceptedReport;
  evidenceAccepted?: boolean;
  evidenceRejectionReason?: string;
  safety?: string;
}) {
  return (
    <>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {report.details.map((item) => (
          <div key={`${item.label}-${item.value}`} className="rounded border border-[#e0e9ea] bg-white px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">{item.label}</div>
            <div className={`${mono} mt-1 break-words text-[11px] text-[#355b63]`}>{item.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-[#e2ebec] pt-3">
        <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#82969b]">Evidence</div>
        <div className="mt-2 flex flex-wrap gap-2">{report.evidence.map((item) => <span key={item} className={`${mono} rounded bg-[#edf3f4] px-2 py-1 text-[10px] text-[#527078]`}>{item}</span>)}</div>
        <div className="mt-3 grid gap-2 rounded border border-[#cfe2e2] bg-white p-3 sm:grid-cols-3">
          <div><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Executor</div><div className={`${mono} mt-1 break-all text-[10px] text-[#355b63]`}>{report.executionEvidence.executor}</div></div>
          <div><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Accepted source</div><div className={`${mono} mt-1 text-[10px] text-[#355b63]`}>{evidenceAccepted ? report.executionEvidence.source : 'none'}</div></div>
          <div><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Evidence digest</div><div className={`${mono} mt-1 truncate text-[10px] text-[#355b63]`} title={report.executionEvidence.evidenceDigest}>{shortHash(report.executionEvidence.evidenceDigest)}</div></div>
        </div>
        {!evidenceAccepted && <p className="mt-2 rounded border border-[#eadcae] bg-[#fff9e8] px-3 py-2 text-[10px] text-[#7a683d]">Completion pending: {evidenceRejectionReason}</p>}
        {safety && <p className="mt-3 text-[10px] leading-5 text-[#71888f]">{safety}</p>}
      </div>
    </>
  );
}
function DemoResultPanel({ result, running, error, publicKeyValidation = false }: { result?: DemoResult; running?: boolean; error?: string; publicKeyValidation?: boolean }) {
  if (publicKeyValidation) {
    return <PublicKeyDemoResultPanel result={result} running={running} error={error} publicKeyValidation />;
  }
  if (!result && !running && !error) return null;
  return (
    <section className="mb-7 rounded-lg border border-[#cbdedf] bg-[#f8fbfb] p-5 shadow-sm" data-testid="panel-demo-result">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#66828a]"><Beaker size={14} className="text-[#d09a25]" /> Live demo response</div>
          <h2 className="mt-2 text-[17px] font-extrabold text-[#183943]">{running ? 'Running workload fixture…' : result?.workloadName || 'Demo error'}</h2>
        </div>
        {result && <span className="rounded border border-[#a5dfcf] bg-[#d7f4eb] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#087a62]">{result.status}</span>}
      </div>
      {running && <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#dce9e9]"><div className="h-full w-2/3 animate-pulse rounded-full bg-[#159d8d]" /></div>}
      {error && <p className="mt-4 rounded border border-[#eeb4ae] bg-[#fbe1de] p-3 text-sm text-[#8e3d35]">{error}</p>}
      {result && (
        <>
          <div className="mt-4 rounded-md border border-[#a6dfd2] bg-[#e6f8f3] p-4">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#39716d]">Answer</div>
            <div className="mt-1 text-sm font-extrabold text-[#115f5b]" data-testid="text-demo-answer">{result.answer}</div>
          </div>
          {result.mnemonic && (
            <div className="mt-4 rounded border border-[#d8bb78] bg-[#fff8e8] p-3" data-testid="generated-mnemonic">
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Generated {result.mnemonic.trim().split(/\s+/).length}-word BIP39 phrase</div>
              <div className={`${mono} mt-2 break-words text-[12px] leading-6 text-[#355b63]`}>{result.mnemonic}</div>
              <p className="mt-2 text-[10px] leading-4 text-[#8e5a35]">This is a valid generated phrase with a derived seed. It is returned for this demo only; do not use it for funds or share it.</p>
            </div>
          )}
          {(result.dnsSerial !== undefined || result.dnsTarget || result.dnsRedirect || result.dnsRecordProof) && (
            <div className="mt-4 rounded-md border border-[#b9d8d8] bg-[#f0f8f7] p-4" data-testid="panel-dns-migration-proof">
              <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#39716d]">DNS migration proof</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {result.dnsSerial !== undefined && (
                  <div className="rounded border border-[#cfe2e2] bg-white px-3 py-2" data-testid="dns-proof-serial">
                    <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Authoritative serial</div>
                    <div className={`${mono} mt-1 text-[11px] text-[#355b63]`}>{result.dnsSerial}</div>
                  </div>
                )}
                {result.dnsTarget && (
                  <div className="rounded border border-[#cfe2e2] bg-white px-3 py-2" data-testid="dns-proof-target">
                    <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Resolved target</div>
                    <div className={`${mono} mt-1 break-words text-[11px] text-[#355b63]`}>{result.dnsTarget}</div>
                  </div>
                )}
                {result.dnsRedirect && (
                  <div className="rounded border border-[#cfe2e2] bg-white px-3 py-2 sm:col-span-2" data-testid="dns-proof-redirect">
                    <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Redirect probe</div>
                    <div className={`${mono} mt-1 break-words text-[11px] text-[#355b63]`}>
                      {result.dnsRedirect.statusCode} · {result.dnsRedirect.url} · {result.dnsRedirect.body}
                    </div>
                  </div>
                )}
                {result.dnsRecordProof && (
                  <div className="rounded border border-[#cfe2e2] bg-white px-3 py-2 sm:col-span-2" data-testid="dns-proof-record">
                    <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Signed record proof</div>
                    <div className={`${mono} mt-1 space-y-1 break-all text-[11px] text-[#355b63]`}>
                      <div>canonical · {result.dnsRecordProof.canonical}</div>
                      <div>record hash · {result.dnsRecordProof.recordHash}</div>
                      <div>key fingerprint · {result.dnsRecordProof.keyFingerprint}</div>
                      <div>signature · {result.dnsRecordProof.signature}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {result.details.map((item) => (
              <div key={`${item.label}-${item.value}`} className="rounded border border-[#e0e9ea] bg-white px-3 py-2">
                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">{item.label}</div>
                <div className={`${mono} mt-1 break-words text-[11px] text-[#355b63]`}>{item.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-[#e2ebec] pt-3">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#82969b]">Evidence</div>
            <div className="mt-2 flex flex-wrap gap-2">{result.evidence.map((item) => <span key={item} className={`${mono} rounded bg-[#edf3f4] px-2 py-1 text-[10px] text-[#527078]`}>{item}</span>)}</div>
            <div className="mt-3 grid gap-2 rounded border border-[#cfe2e2] bg-white p-3 sm:grid-cols-3">
              <div><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Executor</div><div className={`${mono} mt-1 break-all text-[10px] text-[#355b63]`}>{result.executionEvidence.executor}</div></div>
              <div><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Accepted source</div><div className={`${mono} mt-1 text-[10px] text-[#355b63]`}>{result.evidenceAccepted ? result.executionEvidence.source : 'none'}</div></div>
              <div><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Evidence digest</div><div className={`${mono} mt-1 truncate text-[10px] text-[#355b63]`} title={result.executionEvidence.evidenceDigest}>{shortHash(result.executionEvidence.evidenceDigest)}</div></div>
            </div>
            {!result.evidenceAccepted && <p className="mt-2 rounded border border-[#eadcae] bg-[#fff9e8] px-3 py-2 text-[10px] text-[#7a683d]">Completion pending: {result.evidenceRejectionReason}</p>}
            <p className="mt-3 text-[10px] leading-5 text-[#71888f]">{result.safety}</p>
          </div>
          <div className="mt-4 rounded-md border border-[#d7c38f] bg-[#fff9e8] p-4">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#8d6c25]">Live miner response</div>
             <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
              <StatPill label="TCP miners" value={String(result.mining.activeMiners)} accent="teal" />
              <StatPill label="Accepted shares" value={String(result.mining.acceptedShares)} accent="teal" />
              <StatPill label="Jobs issued" value={String(result.mining.jobsIssued)} accent="slate" />
               <StatPill label="Hashes / attempts" value={result.mining.hashes.toLocaleString()} accent="slate" />
                <StatPill label="Measured hash rate" value={formatHashRate(result.mining.hashRate)} accent="teal" />
                <StatPill label="Miner process rate" value={formatHashRate(result.mining.effectiveHashRateMhs * 1_000_000)} accent="amber" />
              <StatPill label="Difficulty" value={result.mining.difficulty} accent="amber" />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded border border-[#eadcae] bg-white px-3 py-2"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8d8057]">Workload shares</div><div className={`${mono} mt-1 text-[11px] text-[#62552d]`}>{result.mining.workloadShares} / fresh accepted response</div></div>
              <div className="rounded border border-[#eadcae] bg-white px-3 py-2"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8d8057]">Miner</div><div className={`${mono} mt-1 text-[11px] text-[#62552d]`}>{result.mining.lastMiner || '—'}</div></div>
            </div>
            <div className="mt-3 rounded border border-[#eadcae] bg-white px-3 py-2"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8d8057]">Accepted hash</div><div className={`${mono} mt-1 break-all text-[11px] text-[#62552d]`}>{result.mining.lastHash || '—'}</div></div>
            <p className="mt-3 text-[10px] leading-5 text-[#7a683d]">Mining telemetry is partition attribution only. It cannot complete this workload without accepted executor evidence.</p>
          </div>
        </>
      )}
    </section>
  );
}
function PublicKeyDemoResultPanel({ result, running, error, publicKeyValidation = false }: { result?: DemoResult; running?: boolean; error?: string; publicKeyValidation?: boolean }) {
  if (!result && !running && !error) return null;
  return (
    <section className="mb-7 rounded-lg border border-[#cbdedf] bg-[#f8fbfb] p-5 shadow-sm" data-testid="panel-demo-result">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#66828a]"><Beaker size={14} className="text-[#d09a25]" /> {publicKeyValidation ? 'Public-key validation response' : 'Live demo response'}</div>
          <h2 className="mt-2 text-[17px] font-extrabold text-[#183943]">{running ? (publicKeyValidation ? 'Validating supplied public key…' : 'Running workload fixture…') : result?.workloadName || (publicKeyValidation ? 'Validation error' : 'Demo error')}</h2>
        </div>
        {result && <span className="rounded border border-[#a5dfcf] bg-[#d7f4eb] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#087a62]">{publicKeyValidation ? 'Assessment complete' : result.status}</span>}
      </div>
      {running && <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#dce9e9]"><div className="h-full w-2/3 animate-pulse rounded-full bg-[#159d8d]" /></div>}
      {error && <p className="mt-4 rounded border border-[#eeb4ae] bg-[#fbe1de] p-3 text-sm text-[#8e3d35]">{error}</p>}
      {result && (
        <>
          <div className="mt-4 rounded-md border border-[#a6dfd2] bg-[#e6f8f3] p-4">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#39716d]">{publicKeyValidation ? 'Assessment outcome' : 'Answer'}</div>
            <div className="mt-1 text-sm font-extrabold text-[#115f5b]" data-testid="text-demo-answer">{result.answer}</div>
          </div>
          {(result.dnsSerial !== undefined || result.dnsTarget || result.dnsRedirect || result.dnsRecordProof) && (
            <div className="mt-4 rounded-md border border-[#b9d8d8] bg-[#f0f8f7] p-4" data-testid="panel-dns-migration-proof">
              <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#39716d]">DNS migration proof</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {result.dnsSerial !== undefined && (
                  <div className="rounded border border-[#cfe2e2] bg-white px-3 py-2" data-testid="dns-proof-serial">
                    <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Authoritative serial</div>
                    <div className={`${mono} mt-1 text-[11px] text-[#355b63]`}>{result.dnsSerial}</div>
                  </div>
                )}
                {result.dnsTarget && (
                  <div className="rounded border border-[#cfe2e2] bg-white px-3 py-2" data-testid="dns-proof-target">
                    <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Resolved target</div>
                    <div className={`${mono} mt-1 break-words text-[11px] text-[#355b63]`}>{result.dnsTarget}</div>
                  </div>
                )}
                {result.dnsRedirect && (
                  <div className="rounded border border-[#cfe2e2] bg-white px-3 py-2 sm:col-span-2" data-testid="dns-proof-redirect">
                    <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Redirect probe</div>
                    <div className={`${mono} mt-1 break-words text-[11px] text-[#355b63]`}>
                      {result.dnsRedirect.statusCode} · {result.dnsRedirect.url} · {result.dnsRedirect.body}
                    </div>
                  </div>
                )}
                {result.dnsRecordProof && (
                  <div className="rounded border border-[#cfe2e2] bg-white px-3 py-2 sm:col-span-2" data-testid="dns-proof-record">
                    <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#82969b]">Signed record proof</div>
                    <div className={`${mono} mt-1 space-y-1 break-all text-[11px] text-[#355b63]`}>
                      <div>canonical · {result.dnsRecordProof.canonical}</div>
                      <div>record hash · {result.dnsRecordProof.recordHash}</div>
                      <div>key fingerprint · {result.dnsRecordProof.keyFingerprint}</div>
                      <div>signature · {result.dnsRecordProof.signature}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <ReportEvidence report={result} evidenceAccepted={result.evidenceAccepted} evidenceRejectionReason={result.evidenceRejectionReason} safety={result.safety} />
          {!publicKeyValidation && <div className="mt-4 rounded-md border border-[#d7c38f] bg-[#fff9e8] p-4">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#8d6c25]">Live miner response</div>
             <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
              <StatPill label="TCP miners" value={String(result.mining.activeMiners)} accent="teal" />
              <StatPill label="Accepted shares" value={String(result.mining.acceptedShares)} accent="teal" />
              <StatPill label="Jobs issued" value={String(result.mining.jobsIssued)} accent="slate" />
               <StatPill label="Hashes / attempts" value={result.mining.hashes.toLocaleString()} accent="slate" />
                <StatPill label="Measured hash rate" value={formatHashRate(result.mining.hashRate)} accent="teal" />
                <StatPill label="Miner process rate" value={formatHashRate(result.mining.effectiveHashRateMhs * 1_000_000)} accent="amber" />
              <StatPill label="Difficulty" value={result.mining.difficulty} accent="amber" />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded border border-[#eadcae] bg-white px-3 py-2"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8d8057]">Workload shares</div><div className={`${mono} mt-1 text-[11px] text-[#62552d]`}>{result.mining.workloadShares} / fresh accepted response</div></div>
              <div className="rounded border border-[#eadcae] bg-white px-3 py-2"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8d8057]">Miner</div><div className={`${mono} mt-1 text-[11px] text-[#62552d]`}>{result.mining.lastMiner || '—'}</div></div>
            </div>
            <div className="mt-3 rounded border border-[#eadcae] bg-white px-3 py-2"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8d8057]">Accepted hash</div><div className={`${mono} mt-1 break-all text-[11px] text-[#62552d]`}>{result.mining.lastHash || '—'}</div></div>
            <p className="mt-3 text-[10px] leading-5 text-[#7a683d]">Mining telemetry is partition attribution only. It cannot complete this workload without accepted executor evidence.</p>
          </div>}
        </>
      )}
    </section>
  );
}

function AcceptedReportPanel({ report }: { report?: AcceptedReport }) {
  if (!report) return null;
  return (
    <section className="mb-7 rounded-lg border border-[#cbdedf] bg-[#f8fbfb] p-5 shadow-sm" data-testid="panel-accepted-report">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#66828a]"><CheckCircle2 size={14} className="text-[#168c83]" /> Accepted assessment report</div>
          <h2 className="mt-2 text-[17px] font-extrabold text-[#183943]">Latest validated public-key assessment</h2>
          <p className="mt-1 text-[10px] text-[#71888f]">Loaded from the latest accepted report.</p>
        </div>
        <span className="rounded border border-[#a5dfcf] bg-[#d7f4eb] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#087a62]">Assessment complete</span>
      </div>
      <div className="mt-4 rounded-md border border-[#a6dfd2] bg-[#e6f8f3] p-4">
        <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#39716d]">Assessment outcome</div>
        <div className="mt-1 text-sm font-extrabold text-[#115f5b]" data-testid="text-accepted-report-answer">{report.answer}</div>
      </div>
      <ReportEvidence report={report} />
    </section>
  );
}

function SyntheticCapacityEstimator({
  coordinator,
  workload,
}: {
  coordinator: CommandCenterStatus['coordinator'];
  workload?: WorkloadTelemetry;
}) {
  const [base, setBase] = useState('2048');
  const [exponent, setExponent] = useState('12');
  const [targetHours, setTargetHours] = useState('1');
  const [targetMinutes, setTargetMinutes] = useState('0');
  const liveHashRate = Number(coordinator.hashRate) || 0;
  const hasLiveResult = coordinator.activeMiners > 0 && liveHashRate > 0;
  const liveSolveRate = parseSolveRate(workload?.rate);
  const targetSeconds = Math.max(
    60,
    (Number.parseInt(targetHours, 10) || 0) * 3_600
      + (Number.parseInt(targetMinutes, 10) || 0) * 60,
  );
  const estimate = useMemo(() => {
    const parsedBase = Math.min(65_536, Math.max(2, Number.parseInt(base, 10) || 2));
    const parsedExponent = Math.min(200, Math.max(0, Number.parseInt(exponent, 10) || 0));
    const candidateCount = BigInt(parsedBase) ** BigInt(parsedExponent);
    const seconds = hasLiveResult ? Number(candidateCount) / liveHashRate : Number.POSITIVE_INFINITY;
    const solveSeconds = liveSolveRate > 0 ? Number(candidateCount) / liveSolveRate : Number.POSITIVE_INFINITY;
    const perMinerHashRate = hasLiveResult ? liveHashRate / coordinator.activeMiners : 0;
    const requiredHashMiners = perMinerHashRate > 0
      ? Math.ceil(Number(candidateCount) / (perMinerHashRate * targetSeconds))
      : Number.POSITIVE_INFINITY;
    const perMinerSolveRate = liveSolveRate > 0 ? liveSolveRate / Math.max(1, coordinator.activeMiners) : 0;
    const requiredSolveMiners = perMinerSolveRate > 0
      ? Math.ceil(Number(candidateCount) / (perMinerSolveRate * targetSeconds))
      : Number.POSITIVE_INFINITY;
    return {
      parsedBase,
      parsedExponent,
      candidateCount,
      seconds,
      solveSeconds,
      requiredHashMiners,
      requiredSolveMiners,
      expression: `${parsedBase}^${parsedExponent}`,
    };
  }, [base, exponent, coordinator.activeMiners, hasLiveResult, liveHashRate, liveSolveRate, targetSeconds]);

  return (
    <section className="mb-5 rounded-lg border border-[#d7c38f] bg-[#fff9e8] p-5 shadow-sm" data-testid="panel-capacity-estimator">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#8d6c25]"><Gauge size={14} /> Live capacity estimator</div>
          <h2 className="mt-2 text-[17px] font-extrabold text-[#4f421f]">How long would this bounded space take?</h2>
          <p className="mt-1 max-w-2xl text-[10px] leading-5 text-[#7a683d]">Uses the live measured hash rate and accepted solve rate. The possible-value count is exact math for the selected bounded space; this panel does not start a job.</p>
        </div>
        <div className={`${mono} rounded border border-[#eadcae] bg-white px-3 py-2 text-xs font-bold text-[#62552d]`} data-testid="text-capacity-expression">
          {estimate.expression} · {estimate.parsedBase}{superscript(String(estimate.parsedExponent))}
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[150px_150px_1fr]">
        <label className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8d8057]">
          Base x
          <input type="number" min={2} max={65536} value={base} onChange={(event) => setBase(event.target.value)} className={`${mono} mt-1 w-full rounded border border-[#d7c38f] bg-white px-3 py-2 text-sm font-bold text-[#4f421f] outline-none focus:border-[#b28721]`} aria-label="Synthetic capacity base" data-testid="input-capacity-base" />
        </label>
        <label className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8d8057]">
          Exponent y
          <input type="number" min={0} max={200} value={exponent} onChange={(event) => setExponent(event.target.value)} className={`${mono} mt-1 w-full rounded border border-[#d7c38f] bg-white px-3 py-2 text-sm font-bold text-[#4f421f] outline-none focus:border-[#b28721]`} aria-label="Synthetic capacity exponent" data-testid="input-capacity-exponent" />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded border border-[#eadcae] bg-white px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8d8057]">Possible values · {estimate.parsedBase}{superscript(String(estimate.parsedExponent))}</div>
            <div className={`${mono} mt-1 break-all text-xs font-bold text-[#62552d]`} data-testid="text-capacity-count">{formatCandidateCount(estimate.candidateCount)}</div>
          </div>
          <div className="rounded border border-[#eadcae] bg-white px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8d8057]">Hash-rate time</div>
            <div className={`${mono} mt-1 text-sm font-bold text-[#62552d]`} data-testid="text-capacity-duration">{formatDuration(estimate.seconds)}</div>
            <div className="mt-0.5 text-[9px] text-[#927845]">{hasLiveResult ? `${formatHashRate(liveHashRate)} live` : 'Waiting for live result'}</div>
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded border border-[#eadcae] bg-white px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8d8057]">Solve-rate time</div>
          <div className={`${mono} mt-1 text-sm font-bold text-[#62552d]`} data-testid="text-capacity-solve-duration">{formatDuration(estimate.solveSeconds)}</div>
          <div className="mt-0.5 text-[9px] text-[#927845]">{liveSolveRate > 0 ? `${workload?.rate} live` : 'Waiting for accepted solve rate'}</div>
        </div>
        <div className="rounded border border-[#eadcae] bg-white px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8d8057]">Target duration</div>
          <div className="mt-1 flex items-center gap-2">
            <input type="number" min={0} max={8760} value={targetHours} onChange={(event) => setTargetHours(event.target.value)} className={`${mono} w-20 rounded border border-[#d7c38f] bg-white px-2 py-1 text-xs font-bold text-[#4f421f]`} aria-label="Target hours" data-testid="input-capacity-hours" />
            <span className="text-[10px] text-[#927845]">hours</span>
            <input type="number" min={0} max={59} value={targetMinutes} onChange={(event) => setTargetMinutes(event.target.value)} className={`${mono} w-16 rounded border border-[#d7c38f] bg-white px-2 py-1 text-xs font-bold text-[#4f421f]`} aria-label="Target minutes" data-testid="input-capacity-minutes" />
            <span className="text-[10px] text-[#927845]">minutes</span>
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded border border-[#eadcae] bg-white px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8d8057]">Live miners</div>
          <div className={`${mono} mt-1 text-sm font-bold text-[#62552d]`}>{coordinator.activeMiners.toLocaleString()}</div>
        </div>
        <div className="rounded border border-[#eadcae] bg-white px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8d8057]">Total miners · hash rate</div>
          <div className={`${mono} mt-1 break-all text-sm font-bold text-[#62552d]`} data-testid="text-required-hash-miners">{Number.isFinite(estimate.requiredHashMiners) ? estimate.requiredHashMiners.toLocaleString() : 'waiting for live result'}</div>
        </div>
        <div className="rounded border border-[#eadcae] bg-white px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8d8057]">Total miners · solve rate</div>
          <div className={`${mono} mt-1 break-all text-sm font-bold text-[#62552d]`} data-testid="text-required-solve-miners">{Number.isFinite(estimate.requiredSolveMiners) ? estimate.requiredSolveMiners.toLocaleString() : 'waiting for live solve rate'}</div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 border-t border-[#eadcae] pt-3 text-[9px] text-[#927845] sm:grid-cols-3">
        <span>Source: {hasLiveResult ? coordinator.minerSource : 'no live telemetry'}</span>
        <span>Accepted solves: {coordinator.acceptedShares.toLocaleString()}</span>
        <span>Latest result: {workload?.lastProof ? shortHash(workload.lastProof) : 'waiting for accepted proof'}</span>
      </div>
    </section>
  );
}

function LiveMiningStrip({ coordinator, workload }: { coordinator: CommandCenterStatus['coordinator']; workload?: WorkloadTelemetry }) {
  return (
    <section className="mb-5 rounded-lg border border-[#cbdedf] bg-[#f8fbfb] p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#66828a]"><Radio size={13} className="text-[#168c83]" /> Live TCP miner stream</div>
        <span className="text-[10px] text-[#71888f]">{coordinator.minerSource}</span>
      </div>
       <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-8">
        <StatPill label="Connections" value={String(coordinator.activeMiners)} accent="teal" />
        <StatPill label="Shares" value={String(coordinator.acceptedShares)} accent="teal" />
        <StatPill label="Jobs" value={String(coordinator.jobsIssued)} accent="slate" />
         <StatPill label="Total hashes" value={coordinator.totalHashes.toLocaleString()} accent="slate" />
          <StatPill label="Measured total rate" value={formatHashRate(coordinator.hashRate)} accent="teal" />
          <StatPill label="Miner process rate" value={formatHashRate(coordinator.gpuMining.effectiveHashRateMhs * 1_000_000)} accent="amber" />
        <StatPill label="Difficulty" value={coordinator.difficulty} accent="amber" />
        <StatPill label="Selected proofs" value={String(workload?.verifiedShares ?? 0)} accent="slate" />
      </div>
      {workload?.lastProof && <div className={`${mono} mt-3 break-all text-[10px] text-[#58747b]`}>last accepted hash · {workload.lastProof}</div>}
    </section>
  );
}

function Dashboard({ status, healthStatus, onRefresh, refreshing, demoResult, demoRunning, demoError, onDemo, onOpenTask, difficulty, minerCount, gpuBackend, onDifficultyChange, onMinerCountChange, onGpuBackendChange, onSaveSettings, onProductionDifficulty, savingSettings, settingsSaved }: { status: CommandCenterStatus; healthStatus?: string; onRefresh: () => void; refreshing: boolean; demoResult?: DemoResult; demoRunning: boolean; demoError?: string; onDemo: (workloadId: string) => void; onOpenTask: (workloadId: string) => void; difficulty: Difficulty; minerCount: number; gpuBackend: 'auto' | 'gpu' | 'disabled'; onDifficultyChange: (value: Difficulty) => void; onMinerCountChange: (value: number) => void; onGpuBackendChange: (value: 'auto' | 'gpu' | 'disabled') => void; onSaveSettings: () => void; onProductionDifficulty: () => void; savingSettings: boolean; settingsSaved: boolean }) {
  const proofCount = useMemo(() => status.workloads.reduce((sum, workload) => sum + (Number(workload.verifiedShares) || 0), 0), [status.workloads]);
  const activeWorkloads = status.workloads.filter((workload) => isHealthy(workload.status)).length;
  return (
    <div className="instrument-grid min-h-[calc(100dvh-77px)] bg-[#eaf2f3] px-4 py-6 md:px-8 md:py-7">
      <div className="mx-auto max-w-[1520px]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#5d777f]"><span className="status-pulse h-1.5 w-1.5 rounded-full bg-[#159d8d]" /> {healthStatus || 'service'} link nominal</div>
        </div>
        <div className="mb-5"><DifficultyControl value={difficulty} onChange={onDifficultyChange} onProduction={onProductionDifficulty} minerCount={minerCount} onMinerCountChange={onMinerCountChange} gpuBackend={gpuBackend} onGpuBackendChange={onGpuBackendChange} onSave={onSaveSettings} saving={savingSettings} saved={settingsSaved} label="Home default difficulty" /></div>
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <CoordinatorCard status={status} />
          <DnsCard status={status} />
        </div>
        <LiveMiningStrip coordinator={status.coordinator} workload={status.workloads[0]} />
        <SyntheticCapacityEstimator coordinator={status.coordinator} workload={status.workloads[0]} />
        <ExploitDetectionPanel />
        <div className="my-7 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-[#d4e0e2] bg-[#f8fbfb] p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#71888f]"><Gauge size={14} className="text-[#168c83]" /> Coverage</div><div className="mt-2 text-2xl font-extrabold tracking-[-0.05em] text-[#1b424a]" data-testid="text-coverage-count">{activeWorkloads}<span className="ml-1 text-sm font-semibold text-[#789097]">/ {status.workloads.length}</span></div><div className="mt-1 text-[10px] text-[#71888f]">active workloads</div></div>
          <div className="rounded-lg border border-[#d4e0e2] bg-[#f8fbfb] p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#71888f]"><CheckCircle2 size={14} className="text-[#168c83]" /> Verified shares</div><div className="mt-2 text-2xl font-extrabold tracking-[-0.05em] text-[#1b424a]" data-testid="text-verified-shares">{proofCount.toLocaleString()}</div><div className="mt-1 text-[10px] text-[#71888f]">across tracked work</div></div>
          <div className="rounded-lg border border-[#d4e0e2] bg-[#f8fbfb] p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#71888f]"><TerminalSquare size={14} className="text-[#168c83]" /> Proof blocks</div><div className="mt-2 text-2xl font-extrabold tracking-[-0.05em] text-[#1b424a]" data-testid="text-ledger-count">{status.ledger.length}</div><div className="mt-1 text-[10px] text-[#71888f]">latest ledger window</div></div>
          <div className="rounded-lg border border-[#e7d29b] bg-[#fff8e7] p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#8d6c25]"><Zap size={14} className="text-[#d09a25]" /> Refresh cadence</div><div className="mt-2 text-2xl font-extrabold tracking-[-0.05em] text-[#674d1a]">05<span className="ml-1 text-sm font-semibold text-[#9b7c3f]">sec</span></div><div className="mt-1 text-[10px] text-[#927845]">coordinator polling</div></div>
        </div>
        <DemoResultPanel result={demoResult} running={demoRunning} error={demoError} publicKeyValidation={demoResult?.workloadId === 'w-69' || status.workloads.some((workload) => workload.id === demoResult?.workloadId && isPublicKeyWorkload(workload))} />
        <div id="workloads-section"><Workloads workloads={status.workloads} onDemo={onDemo} onOpenTask={onOpenTask} demoRunning={demoRunning} /></div>
        <div className="my-7 border-t border-[#cddcde]" />
        <div id="ledger-section"><Ledger ledger={status.ledger} /></div>
        <div className="mt-5 flex items-center justify-between border-t border-[#cddcde] pt-4 text-[10px] text-[#789098]">
          <span className={`${mono}`}>ARGUS / defensive telemetry plane</span>
          <button type="button" onClick={onRefresh} disabled={refreshing} className="flex items-center gap-1.5 font-bold text-[#197c78] hover:text-[#0c5755] disabled:opacity-60" data-testid="button-refresh-footer"><RefreshCw size={12} className={cx(refreshing && 'animate-spin')} /> Refresh frame</button>
        </div>
      </div>
    </div>
  );
}

export default function CommandCenter() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [demoResult, setDemoResult] = useState<DemoResult>();
  const [difficulty, setDifficulty] = useState<Difficulty>('000');
  const [minerCount, setMinerCount] = useState(1);
  const [gpuBackend, setGpuBackend] = useState<'auto' | 'gpu' | 'disabled'>('auto');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const demoMutation = useRunCommandCenterDemo({
    mutation: {
      onSuccess: (result) => setDemoResult(result),
    },
  });
  const settingsMutation = useSaveCommandCenterSettings();
  const statusQuery = useGetCommandCenterStatus({
    query: {
      queryKey: getGetCommandCenterStatusQueryKey(),
      refetchInterval: autoRefresh ? 5000 : false,
      refetchOnWindowFocus: true,
    },
  });
  const healthQuery = useHealthCheck({
    query: {
      queryKey: getHealthCheckQueryKey(),
      refetchInterval: 30000,
      refetchOnWindowFocus: true,
    },
  });

  useEffect(() => {
    if (statusQuery.data && !settingsLoaded) {
      setDifficulty(statusQuery.data.coordinator.difficulty as Difficulty);
      setMinerCount(statusQuery.data.coordinator.configuredMiners);
      setGpuBackend(statusQuery.data.coordinator.gpuMining.requestedBackend);
      setSettingsLoaded(true);
    }
  }, [settingsLoaded, statusQuery.data]);

  const toggleDark = () => {
    setDarkMode((previous) => {
      const next = !previous;
      document.documentElement.classList.toggle('dark', next);
      return next;
    });
  };

  const saveSettings = (nextDifficulty = difficulty) => {
    setDifficulty(nextDifficulty);
    setSettingsSaved(false);
    settingsMutation.mutate({ data: { difficulty: nextDifficulty, minerCount, gpuBackend } }, {
      onSuccess: (saved) => {
        setDifficulty(saved.difficulty as Difficulty);
        setMinerCount(saved.minerCount);
        setGpuBackend(saved.gpuBackend);
        setSettingsSaved(true);
        void statusQuery.refetch();
      },
    });
  };

  const runDemo = (workloadId: string) => {
    setDemoResult(undefined);
    demoMutation.mutate({ data: { workloadId, difficulty } }, {
      onSuccess: (result) => {
        setDemoResult(result);
        void statusQuery.refetch();
      },
    });
  };

  const openTask = (workloadId: string) => {
    window.location.assign(`/task/${workloadId}`);
  };

  if (statusQuery.isLoading) return <LoadingDashboard />;
  if (statusQuery.isError || !statusQuery.data) return <ErrorState onRetry={() => statusQuery.refetch()} />;

  return (
    <div className={cx('min-h-[100dvh] bg-[#eaf2f3]', darkMode && 'dark')}>
      <div className="flex min-h-[100dvh]">
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} darkMode={darkMode} onToggleDark={toggleDark} />
        <main className="min-w-0 flex-1">
          <Topbar refreshedAt={statusQuery.data.generatedAt} onRefresh={() => statusQuery.refetch()} refreshing={statusQuery.isFetching} autoRefresh={autoRefresh} onToggleAutoRefresh={() => setAutoRefresh((value) => !value)} onOpenMenu={() => setMobileOpen(true)} />
          <Dashboard status={statusQuery.data} healthStatus={healthQuery.data?.status} onRefresh={() => statusQuery.refetch()} refreshing={statusQuery.isFetching} demoResult={demoResult} demoRunning={demoMutation.isPending} demoError={demoMutation.error ? 'The coordinator rejected this demo request.' : undefined} onDemo={runDemo} onOpenTask={openTask} difficulty={difficulty} minerCount={minerCount} gpuBackend={gpuBackend} onDifficultyChange={(value) => { setDifficulty(value); setSettingsSaved(false); }} onMinerCountChange={(value) => { setMinerCount(value); setSettingsSaved(false); }} onGpuBackendChange={(value) => { setGpuBackend(value); setSettingsSaved(false); }} onSaveSettings={() => saveSettings()} onProductionDifficulty={() => saveSettings('0000')} savingSettings={settingsMutation.isPending} settingsSaved={settingsSaved} />
        </main>
      </div>
    </div>
  );
}

export function TaskDetail() {
  const taskId = window.location.pathname.split('/').filter(Boolean).at(-1) ?? 'w-01';
  const [darkMode, setDarkMode] = useState(false);
  const [demoResult, setDemoResult] = useState<DemoResult>();
  const [difficulty, setDifficulty] = useState<Difficulty>('000');
  const [pageDifficultyLoaded, setPageDifficultyLoaded] = useState(false);
  const [publicKeyArtifact, setPublicKeyArtifact] = useState('');
  const [mnemonicWords, setMnemonicWords] = useState<12 | 24>(24);
  const statusQuery = useGetCommandCenterStatus({
    query: {
      queryKey: getGetCommandCenterStatusQueryKey(),
      refetchInterval: 5000,
    },
  });
  const demoMutation = useRunCommandCenterDemo({
    mutation: {
      onSuccess: (result) => {
        setDemoResult(result);
        if (taskId === 'w-69') setPublicKeyArtifact('');
        void statusQuery.refetch();
      },
    },
  });
  const migrateMutation = useMigrateCommandCenterDns({
    mutation: {
      onSuccess: (result) => {
        setDemoResult(result);
        void statusQuery.refetch();
      },
    },
  });
  const task = statusQuery.data?.workloads.find((item) => item.id === taskId);

  useEffect(() => {
    if (statusQuery.data && !pageDifficultyLoaded) {
      setDifficulty(statusQuery.data.coordinator.difficulty as Difficulty);
      setPageDifficultyLoaded(true);
    }
  }, [pageDifficultyLoaded, statusQuery.data]);

  if (statusQuery.isLoading) return <LoadingDashboard />;
  if (!statusQuery.data || !task) return <ErrorState onRetry={() => statusQuery.refetch()} />;
  const liveStatus = statusQuery.data!;
  const publicKeyValidation = isPublicKeyWorkload(task);
  const mnemonicFixture = task.id === 'w-01';
  const acceptedReport = acceptedReportFor(task);
  const privateKeyMaterial = publicKeyHasPrivateMaterial(publicKeyArtifact);

  const toggleDark = () => {
    setDarkMode((previous) => {
      const next = !previous;
      document.documentElement.classList.toggle('dark', next);
      return next;
    });
  };

  return (
    <div className={cx('min-h-[100dvh] bg-[#eaf2f3]', darkMode && 'dark')}>
      <div className="flex min-h-[100dvh]">
        <Sidebar mobileOpen={false} onClose={() => undefined} darkMode={darkMode} onToggleDark={toggleDark} />
        <main className="min-w-0 flex-1">
          <Topbar refreshedAt={statusQuery.data?.generatedAt} onRefresh={() => statusQuery.refetch()} refreshing={statusQuery.isFetching} autoRefresh onToggleAutoRefresh={() => undefined} onOpenMenu={() => undefined} />
          <div className="instrument-grid min-h-[calc(100dvh-77px)] bg-[#eaf2f3] px-4 py-6 md:px-8 md:py-8">
            <div className="mx-auto max-w-[1100px]">
              <a href="/" className="text-[11px] font-bold text-[#147f79] hover:text-[#0d5e5b]">← Back to command center</a>
              <div className="mt-5 rounded-lg border border-[#1d555b] bg-[#123e46] p-6 text-[#e4fbf4]">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#86ccc3]">Workload detail / {task.id}</div>
                    <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.04em]">{task.name}</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[#a8d5d1]">{task.note}</p>
                   <div className={`${mono} mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] uppercase tracking-[0.12em] text-[#8cc6c3]`}>
                     <span>{task.category}</span>
                     <span>{task.algorithm}</span>
                     <span>{task.executionMode}</span>
                   </div>
                  </div>
                  <span className="rounded border border-[#65c5b3] bg-[#1b5c5c] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#a7f1df]">{statusLabel(task.severity)}</span>
                </div>
                {task.executor === 'public-key-validator' && (
                  <div className="mt-6 rounded-md border border-[#4a8784] bg-[#164b53] p-4">
                     <label htmlFor="public-key-artifact" className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#a8e4d6]">Public key only</label>
                     <p id="public-key-artifact-help" className="mt-1 text-[11px] leading-5 text-[#a8d5d1]">Paste a PEM SPKI, base64 DER, or hex DER public key. It is parsed in memory, hashed for evidence, and never retained. Private-key recovery is not performed.</p>
                    <textarea
                      id="public-key-artifact"
                      value={publicKeyArtifact}
                      onChange={(event) => setPublicKeyArtifact(event.target.value)}
                      maxLength={16384}
                      rows={7}
                      placeholder="-----BEGIN PUBLIC KEY-----"
                       aria-describedby="public-key-artifact-help"
                      className={`${mono} mt-3 w-full rounded border border-[#5a9894] bg-[#0f3c44] px-3 py-2 text-[11px] leading-5 text-[#e4fbf4] outline-none placeholder:text-[#729c9b] focus:border-[#b4eee0]`}
                      data-testid="textarea-public-key-artifact"
                    />
                     {privateKeyMaterial && <p className="mt-2 rounded border border-[#d29c75] bg-[#4b332b] px-3 py-2 text-[10px] leading-4 text-[#ffd9bf]">Private-key material is not accepted. Remove it and supply public-key material only; no recovery is performed.</p>}
                  </div>
                )}
                 {mnemonicFixture && (
                   <div className="mb-3 w-full rounded-md border border-[#4a8784] bg-[#164b53] p-4">
                     <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#a8e4d6]">Safe fixture mode</div>
                     <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                       <p className="max-w-2xl text-[11px] leading-5 text-[#a8d5d1]">Generates and displays a fresh valid BIP39 phrase, derives public secp256k1 material, then discards entropy and private derivation values. Demo phrases are exposed in this response; never use them for funds or share them. Mnemonic recovery from a public key is not attempted.</p>
                       <select value={mnemonicWords} onChange={(event) => setMnemonicWords(Number(event.target.value) as 12 | 24)} className={`${mono} rounded-md border border-[#5a9894] bg-[#0f3c44] px-3 py-2 text-xs font-bold text-[#e4fbf4]`} aria-label="Mnemonic word count" data-testid="select-mnemonic-words">
                         <option value={12}>12 words</option>
                         <option value={24}>24 words</option>
                       </select>
                     </div>
                   </div>
                 )}
                 <div className="mt-6 flex flex-wrap gap-2">
                   <button type="button" onClick={() => { setDemoResult(undefined); demoMutation.mutate({ data: { workloadId: task.id, ...(publicKeyValidation ? { publicKeyArtifact } : { difficulty, ...(mnemonicFixture ? { mnemonicWords } : {}) }) } }); }} disabled={demoMutation.isPending || migrateMutation.isPending || (publicKeyValidation && (!publicKeyArtifact.trim() || privateKeyMaterial))} className="rounded-md bg-[#d9a329] px-4 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#2d2917] transition hover:bg-[#efbf4f] disabled:opacity-60" data-testid={publicKeyValidation ? 'button-validate-public-key' : mnemonicFixture ? 'button-generate-mnemonic-fixture' : 'button-demo-task-detail'}>{demoMutation.isPending ? (publicKeyValidation ? 'Validating…' : mnemonicFixture ? 'Generating fixture…' : 'Running demo…') : publicKeyValidation ? 'Validate public key' : mnemonicFixture ? `Generate ${mnemonicWords}-word fixture` : 'Run live demo'}</button>
                  {(task.id === 'w-07' || task.id === 'w-18') && <button type="button" onClick={() => { setDemoResult(undefined); migrateMutation.mutate({ data: { targetIp: '127.0.0.2', difficulty } }); }} disabled={demoMutation.isPending || migrateMutation.isPending} className="rounded-md border border-[#65c5b3] px-4 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#a7f1df] transition hover:bg-[#1b5c5c] disabled:opacity-60" data-testid="button-migrate-dns">{migrateMutation.isPending ? 'Propagating…' : 'Migrate lab record'}</button>}
                </div>
              </div>
              {!publicKeyValidation && <div className="mt-5"><DifficultyControl value={difficulty} onChange={setDifficulty} onProduction={() => setDifficulty('0000')} label="This page difficulty" /></div>}
              {!publicKeyValidation && <div className="mt-6"><LiveMiningStrip coordinator={liveStatus.coordinator} workload={task} /></div>}
              <div className="mt-6"><DemoResultPanel result={demoResult} running={demoMutation.isPending || migrateMutation.isPending} error={demoMutation.error || migrateMutation.error ? (publicKeyValidation ? 'The coordinator rejected this public-key validation.' : 'The coordinator rejected this demo request.') : undefined} publicKeyValidation={publicKeyValidation} /></div>
              {publicKeyValidation && !demoResult && <div className="mt-6"><AcceptedReportPanel report={acceptedReport} /></div>}
              {publicKeyValidation ? (
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <StatPill label="Assessment status" value={completionLabel(task)} accent="teal" />
                  <StatPill label="Completion" value={acceptedReport ? 'accepted report' : 'awaiting report'} accent="slate" />
                  <StatPill label="Evidence digest" value={acceptedReport?.executionEvidence.evidenceDigest ? shortHash(acceptedReport.executionEvidence.evidenceDigest) : task.evidenceDigest ? shortHash(task.evidenceDigest) : '—'} accent="slate" />
                </div>
              ) : (
                <div className="mt-6 grid gap-3 sm:grid-cols-5">
                  <StatPill label="Status" value={statusLabel(task.status)} accent="teal" />
                  <StatPill label="Verified shares" value={String(task.verifiedShares)} accent="slate" />
                  <StatPill label="Progress" value={`${task.progress}%`} accent="amber" />
                  <StatPill label="Hashes / attempts" value={task.hashes.toLocaleString()} accent="slate" />
                  <StatPill label="Measured hash rate" value={formatHashRate(task.hashRate)} accent="teal" />
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function publicKeyHasPrivateMaterial(value: string) {
  return /-----BEGIN[^-]*PRIVATE KEY-----/i.test(value);
}

function isPublicKeyWorkload(workload?: Pick<WorkloadTelemetry, 'executor'>) {
  return workload?.executor === 'public-key-validator';
}

function completionLabel(workload: WorkloadTelemetry) {
  if (isPublicKeyWorkload(workload)) {
    if (workload.completionState === 'complete') return 'assessment complete';
    if (workload.completionState === 'running') return 'validation in progress';
    return statusLabel(workload.completionState);
  }
  return statusLabel(workload.completionState);
}

function acceptedReportFor(workload?: WorkloadTelemetry) {
  return (workload as WorkloadWithAcceptedReport | undefined)?.acceptedReport ?? undefined;
}

type WorkloadWithAcceptedReport = WorkloadTelemetry & {
  acceptedReport?: AcceptedReport | null;
};
