import type { QuotaFileEntry } from './logic';
import type { QuotaCardState } from './providers';

export const QUOTA_AUTO_REFRESH_MS = 60_000;

export const isQuotaRequestPending = (quota: QuotaCardState | undefined): boolean =>
  quota?.status === 'loading' || quota?.refreshing === true;

export function selectAutomaticQuotaTargets(
  entries: QuotaFileEntry[],
  getQuota: (entry: QuotaFileEntry) => QuotaCardState | undefined,
  now: number
): QuotaFileEntry[] {
  return entries.filter((entry) => {
    if ((entry.type !== 'claude' && entry.type !== 'codex') || entry.file.disabled) return false;
    const quota = getQuota(entry);
    if (isQuotaRequestPending(quota)) return false;
    return (
      !Number.isFinite(quota?.checkedAt) ||
      now < (quota?.checkedAt ?? 0) ||
      now - (quota?.checkedAt ?? 0) >= QUOTA_AUTO_REFRESH_MS
    );
  });
}
