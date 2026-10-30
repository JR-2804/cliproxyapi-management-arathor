import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  XaiQuotaState,
} from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { parseUnixToMs } from '@/utils/quota/resetInstants';
import { QUOTA_TAB_ORDER } from './constants';
import type { QuotaFileEntry } from './logic';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';

export interface QuotaBandWindow {
  id: string;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  remaining: number | null;
  resetAtMs: number | null;
  periodHours: number | null;
}

export interface QuotaBandAccount {
  entry: QuotaFileEntry;
  key: string;
  windows: QuotaBandWindow[];
  status: QuotaCardState['status'];
  refreshing: boolean;
  stale: boolean;
  error?: string;
}

export interface QuotaBandRow {
  id: string;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  accounts: Array<{ account: QuotaBandAccount; window: QuotaBandWindow | null }>;
  withMargin: number;
  knownCount: number;
}

export interface QuotaBandGroup {
  type: QuotaProviderType;
  accounts: QuotaBandAccount[];
  rows: QuotaBandRow[];
}

type RowMetadata = Pick<QuotaBandRow, 'id' | 'label' | 'labelKey' | 'labelParams'>;
type StandardWindow = { id: string; labelKey: string };

/** A provider window before status and reset-boundary checks; `remaining` is raw percent. */
type BandSource = Omit<QuotaBandWindow, 'remaining'> & { remaining: number | null };

const STANDARD_WINDOWS: Partial<Record<QuotaProviderType, readonly StandardWindow[]>> = {
  claude: [
    { id: 'five-hour', labelKey: 'claude_quota.five_hour' },
    { id: 'seven-day', labelKey: 'claude_quota.seven_day' },
    { id: 'seven-day-fable', labelKey: 'claude_quota.seven_day_fable' },
  ],
  codex: [
    { id: 'five-hour', labelKey: 'codex_quota.primary_window' },
    { id: 'weekly', labelKey: 'codex_quota.secondary_window' },
    { id: 'monthly', labelKey: 'codex_quota.team_secondary_window' },
  ],
  devin: [
    { id: 'daily', labelKey: 'devin_quota.daily' },
    { id: 'weekly', labelKey: 'devin_quota.weekly' },
  ],
  meta: [
    { id: 'window', labelKey: 'meta_quota.window' },
    { id: 'weekly', labelKey: 'meta_quota.weekly' },
  ],
};

/** Stands in for providers whose windows are only known once an account has loaded. */
const PLACEHOLDER_WINDOW: StandardWindow = {
  id: 'quota',
  labelKey: 'quota_management.bands_quota',
};

const WEEK_MINUTES = 7 * 24 * 60;

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: number | null | undefined): number | null {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

/** Percent left from a percent used, or null when the provider reported no usage. */
function percentLeft(usedPercent: number | null | undefined): number | null {
  const used = finiteNumber(usedPercent);
  return used === null ? null : 100 - used;
}

function rounded(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

function claudeCodexSources(state: ClaudeQuotaState | CodexQuotaState): BandSource[] {
  const windows: Array<ClaudeQuotaState['windows'][number] | CodexQuotaState['windows'][number]> =
    Array.isArray(state.windows) ? state.windows : [];
  return windows.map((window) => ({
    id: window.id,
    label: window.label,
    ...(window.labelKey ? { labelKey: window.labelKey } : {}),
    ...('labelParams' in window && window.labelParams ? { labelParams: window.labelParams } : {}),
    remaining: percentLeft(window.usedPercent),
    resetAtMs: finiteNumber(window.resetAtMs),
    periodHours: positiveNumber(window.periodHours),
  }));
}

function metaSources(state: MetaQuotaState): BandSource[] {
  return (state.data?.windows ?? []).map((window) => {
    // The upstream weekly bucket has no duration field; its scope defines seven days.
    const minutes = window.id === 'weekly' ? WEEK_MINUTES : positiveNumber(window.durationMinutes);
    const sized = window.id === 'window' && minutes !== null;
    const labelKey = sized
      ? minutes % 60 === 0
        ? 'meta_quota.window_duration_hours'
        : 'meta_quota.window_duration'
      : `meta_quota.${window.id}`;
    const labelParams: Record<string, number> | null = sized
      ? minutes % 60 === 0
        ? { hours: minutes / 60 }
        : { minutes }
      : null;
    return {
      id: window.id,
      label: labelKey,
      labelKey,
      ...(labelParams ? { labelParams } : {}),
      remaining: rounded(percentLeft(window.usedPercent)),
      resetAtMs: parseUnixToMs(window.resetAt),
      periodHours: minutes === null ? null : minutes / 60,
    };
  });
}

function devinSources(state: DevinQuotaState): BandSource[] {
  return (Array.isArray(state.windows) ? state.windows : []).map((window) => ({
    id: window.id,
    label: `devin_quota.${window.id}`,
    labelKey: `devin_quota.${window.id}`,
    remaining: rounded(finiteNumber(window.remainingPercent)),
    resetAtMs: finiteNumber(window.resetAtMs),
    periodHours: positiveNumber(window.periodHours),
  }));
}

function kimiSources(state: KimiQuotaState): BandSource[] {
  return (Array.isArray(state.rows) ? state.rows : []).map((row) => ({
    id: row.id,
    label: row.label ?? row.labelKey ?? row.id,
    ...(row.labelKey ? { labelKey: row.labelKey } : {}),
    ...(row.labelParams ? { labelParams: row.labelParams } : {}),
    // Kimi reports raw counts; remaining is derived.
    remaining:
      row.limit > 0 && Number.isFinite(row.used)
        ? Math.round(((row.limit - row.used) / row.limit) * 100)
        : null,
    resetAtMs: finiteNumber(row.resetAtMs),
    periodHours: positiveNumber(row.periodHours),
  }));
}

function antigravitySources(state: AntigravityQuotaState): BandSource[] {
  return (Array.isArray(state.groups) ? state.groups : []).flatMap((group) => {
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    return buckets.map((bucket) => {
      const fraction = finiteNumber(bucket.remainingFraction);
      return {
        id: `${group.id}:${bucket.id}`,
        label: buckets.length > 1 ? `${group.label} · ${bucket.label}` : group.label,
        // Antigravity reports the fraction REMAINING, not percent used.
        remaining: fraction === null ? null : Math.round(fraction * 100),
        resetAtMs: finiteNumber(bucket.resetAtMs),
        periodHours: positiveNumber(bucket.periodHours),
      };
    });
  });
}

function xaiSources(state: XaiQuotaState): BandSource[] {
  const billing = state.billing;
  if (!billing || billing.periodType === 'unknown') return [];
  const labelKey =
    billing.periodType === 'weekly' ? 'xai_quota.weekly_limit' : 'xai_quota.monthly_credits';
  return [
    {
      id: billing.periodType,
      label: labelKey,
      labelKey,
      remaining: rounded(percentLeft(billing.usagePercent)),
      resetAtMs: finiteNumber(billing.resetAtMs),
      periodHours: positiveNumber(billing.periodHours),
    },
  ];
}

/**
 * Each provider stores its windows in a different shape and meaning (percent used, percent
 * left, a 0..1 fraction or raw counts); this is the one place they become band windows.
 */
function bandSources(type: QuotaProviderType, state: QuotaCardState): BandSource[] {
  switch (type) {
    case 'claude':
    case 'codex':
      return claudeCodexSources(state as ClaudeQuotaState | CodexQuotaState);
    case 'meta':
      return metaSources(state as MetaQuotaState);
    case 'devin':
      return devinSources(state as DevinQuotaState);
    case 'kimi':
      return kimiSources(state as KimiQuotaState);
    case 'antigravity':
    case 'plugin':
      return antigravitySources(state as AntigravityQuotaState);
    case 'xai':
      return xaiSources(state as XaiQuotaState);
  }
}

function buildWindow(source: BandSource, status: QuotaCardState['status'], now: number) {
  const expired = source.resetAtMs !== null && source.resetAtMs <= now;

  return {
    ...source,
    remaining:
      status === 'success' && !expired && source.remaining !== null
        ? Math.min(100, Math.max(0, source.remaining))
        : null,
  } satisfies QuotaBandWindow;
}

function buildAccount(
  entry: QuotaFileEntry,
  quota: QuotaCardState | undefined,
  now: number
): QuotaBandAccount {
  const status = quota?.status ?? 'idle';
  const sources = quota ? bandSources(entry.type, quota) : [];

  return {
    entry,
    key: getQuotaCacheKey(entry.file),
    windows: sources.map((source) => buildWindow(source, status, now)),
    status,
    refreshing: quota?.refreshing === true,
    stale: Boolean(quota && 'stale' in quota && quota.stale),
    ...(quota?.error ? { error: quota.error } : {}),
  };
}

function buildRows(type: QuotaProviderType, accounts: QuotaBandAccount[]): QuotaBandRow[] {
  const metadata = new Map<string, RowMetadata>();
  for (const account of accounts) {
    for (const window of account.windows) {
      if (!metadata.has(window.id)) {
        metadata.set(window.id, {
          id: window.id,
          label: window.label,
          labelKey: window.labelKey,
          labelParams: window.labelParams,
        });
      }
    }
  }

  const standard = STANDARD_WINDOWS[type] ?? [];
  if (metadata.size === 0) {
    const placeholders = standard.length > 0 ? standard.slice(0, 2) : [PLACEHOLDER_WINDOW];
    for (const window of placeholders) {
      metadata.set(window.id, { ...window, label: window.labelKey });
    }
  }

  const standardIds: readonly string[] = standard.map((window) => window.id);
  const sorted = [
    ...standard.flatMap((window) => {
      const row = metadata.get(window.id);
      return row ? [row] : [];
    }),
    ...Array.from(metadata.values()).filter((window) => !standardIds.includes(window.id)),
  ];

  return sorted.map((row) => {
    const slots = accounts.map((account) => ({
      account,
      window: account.windows.find((window) => window.id === row.id) ?? null,
    }));
    const fresh = slots.filter(
      ({ account, window }) =>
        account.status === 'success' &&
        !account.stale &&
        !account.entry.file.disabled &&
        window?.remaining !== null &&
        window?.remaining !== undefined
    );

    return {
      ...row,
      accounts: slots,
      withMargin: fresh.filter(({ window }) => (window?.remaining ?? 0) > 0).length,
      knownCount: fresh.length,
    };
  });
}

export function buildQuotaBandGroups(
  entries: QuotaFileEntry[],
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined,
  now: number
): QuotaBandGroup[] {
  const result: QuotaBandGroup[] = [];
  for (const type of QUOTA_TAB_ORDER) {
    const accounts = entries
      .filter((entry) => entry.type === type)
      .map((entry) => buildAccount(entry, quotaFor(entry), now));
    if (accounts.length === 0) continue;
    result.push({ type, accounts, rows: buildRows(type, accounts) });
  }
  return result;
}
