import type { QuotaFileEntry } from './logic';
import type { QuotaCardState } from './providers';

export const QUOTA_AUTO_REFRESH_MS = 60_000;

/**
 * Providers whose quota lookup is a read with no side effects. Meta's lookup posts to the key
 * endpoint, which returns the existing key rather than issuing a new one.
 */
const AUTO_REFRESH_TYPES: ReadonlySet<QuotaFileEntry['type']> = new Set([
  'claude',
  'codex',
  'meta',
]);

export const isQuotaRequestPending = (quota: QuotaCardState | undefined): boolean =>
  quota?.status === 'loading' || quota?.refreshing === true;

export function selectAutomaticQuotaTargets(
  entries: QuotaFileEntry[],
  getQuota: (entry: QuotaFileEntry) => QuotaCardState | undefined,
  now: number
): QuotaFileEntry[] {
  return entries.filter((entry) => {
    if (!AUTO_REFRESH_TYPES.has(entry.type) || entry.file.disabled) return false;
    const quota = getQuota(entry);
    if (isQuotaRequestPending(quota)) return false;
    return (
      !Number.isFinite(quota?.checkedAt) ||
      now < (quota?.checkedAt ?? 0) ||
      now - (quota?.checkedAt ?? 0) >= QUOTA_AUTO_REFRESH_MS
    );
  });
}
