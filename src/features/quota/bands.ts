import type { ClaudeQuotaState, CodexQuotaState } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from './logic';
import type { QuotaCardState } from './providers';

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
  type: 'claude' | 'codex';
  accounts: QuotaBandAccount[];
  rows: QuotaBandRow[];
}

type BandQuotaState = ClaudeQuotaState | CodexQuotaState;
type BandWindow = BandQuotaState['windows'][number];
type RowMetadata = Pick<QuotaBandRow, 'id' | 'label' | 'labelKey' | 'labelParams'>;

const STANDARD_WINDOWS = {
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
} as const;

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildWindow(window: BandWindow, status: QuotaCardState['status'], now: number) {
  const resetAtMs = finiteNumber(window.resetAtMs);
  const usedPercent = finiteNumber(window.usedPercent);
  const expired = resetAtMs !== null && resetAtMs <= now;

  return {
    id: window.id,
    label: window.label,
    ...(window.labelKey ? { labelKey: window.labelKey } : {}),
    ...('labelParams' in window && window.labelParams ? { labelParams: window.labelParams } : {}),
    remaining:
      status === 'success' && !expired && usedPercent !== null
        ? Math.min(100, Math.max(0, 100 - usedPercent))
        : null,
    resetAtMs,
    periodHours:
      typeof window.periodHours === 'number' &&
      Number.isFinite(window.periodHours) &&
      window.periodHours > 0
        ? window.periodHours
        : null,
  } satisfies QuotaBandWindow;
}

function buildAccount(
  entry: QuotaFileEntry,
  quota: QuotaCardState | undefined,
  now: number
): QuotaBandAccount {
  const state = quota as BandQuotaState | undefined;
  const status = state?.status ?? 'idle';
  const windows = Array.isArray(state?.windows) ? state.windows : [];

  return {
    entry,
    key: getQuotaCacheKey(entry.file),
    windows: windows.map((window) => buildWindow(window, status, now)),
    status,
    refreshing: quota?.refreshing === true,
    stale: Boolean(state && 'stale' in state && state.stale),
    ...(state?.error ? { error: state.error } : {}),
  };
}

function buildRows(type: QuotaBandGroup['type'], accounts: QuotaBandAccount[]): QuotaBandRow[] {
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

  const standard = STANDARD_WINDOWS[type];
  if (metadata.size === 0) {
    for (const window of standard.slice(0, 2)) {
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
  for (const type of ['claude', 'codex'] as const) {
    const accounts = entries
      .filter((entry) => entry.type === type)
      .map((entry) => buildAccount(entry, quotaFor(entry), now));
    if (accounts.length === 0) continue;
    result.push({ type, accounts, rows: buildRows(type, accounts) });
  }
  return result;
}
