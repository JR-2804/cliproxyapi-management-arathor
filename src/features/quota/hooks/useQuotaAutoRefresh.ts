import { useEffect } from 'react';
import { useAuthStore, useQuotaStore } from '@/stores';
import { QUOTA_AUTO_REFRESH_MS, selectAutomaticQuotaTargets } from '../autoRefresh';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';

export function useQuotaAutoRefresh(
  entries: QuotaFileEntry[],
  disabled: boolean,
  getQuota: (entry: QuotaFileEntry) => QuotaCardState | undefined,
  loadQuota: (targets: QuotaFileEntry[], options?: { background?: boolean }) => Promise<void>
) {
  const session = useQuotaStore((state) => state.cacheGeneration);

  useEffect(() => {
    if (disabled) return;
    const refresh = () => {
      if (
        document.visibilityState !== 'visible' ||
        useAuthStore.getState().connectionStatus !== 'connected' ||
        useQuotaStore.getState().cacheGeneration !== session
      ) {
        return;
      }
      const targets = selectAutomaticQuotaTargets(entries, getQuota, Date.now());
      if (targets.length > 0) void loadQuota(targets, { background: true });
    };

    refresh();
    const timer = window.setInterval(refresh, QUOTA_AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [disabled, entries, getQuota, loadQuota, session]);
}
