/**
 * 混合提供商批量额度加载（原 useQuotaLoader 的跨分区泛化）。
 *
 * 保留的三道守卫与旧实现逐一对应：
 * - loadingRef：并发批量加载去重；
 * - requestIdRef：被超越的响应直接丢弃；
 * - cacheGeneration：断线重连后过期请求不得写入新会话缓存。
 * 提交按 provider 分组进行 —— 快的提供商先落地，不等慢的。
 */

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent, useQuotaStore } from '@/stores';
import { getStatusFromError } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, getQuotaMap, getQuotaSetter, type QuotaCardState } from '../providers';
import { isQuotaRequestPending } from '../autoRefresh';
import { enrichQuotaInBackground } from '../quotaEnrichment';
import type { QuotaProviderType } from '../providers/types';

interface BatchFetchResult {
  name: string;
  cacheKey: string;
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
  errorStatus?: number;
}

export function useQuotaBatchLoader() {
  const { t } = useTranslation();
  const session = useQuotaStore((state) => state.cacheGeneration);
  const [batchState, setBatchState] = useState({ session, loading: false });
  const loadingRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  const loadQuota = useCallback(
    async (targets: QuotaFileEntry[], options?: { background?: boolean }) => {
      const cacheGeneration = captureQuotaCacheGeneration();
      if (loadingRef.current === cacheGeneration.cacheGeneration) return;
      targets = targets.filter(
        (entry) =>
          !entry.file.disabled &&
          !isQuotaRequestPending(
            getQuotaMap(QUOTA_ADAPTERS[entry.type])[getQuotaCacheKey(entry.file)]
          )
      );
      if (targets.length === 0) return;
      loadingRef.current = cacheGeneration.cacheGeneration;
      const requestId = ++requestIdRef.current;
      const checkedAt = Date.now();
      setBatchState({ session: cacheGeneration.cacheGeneration, loading: true });

      try {
        const groups = new Map<QuotaProviderType, QuotaFileEntry[]>();
        targets.forEach((entry) => {
          const group = groups.get(entry.type) ?? [];
          group.push(entry);
          groups.set(entry.type, group);
        });

        await Promise.all(
          Array.from(groups.entries()).map(async ([type, entries]) => {
            const adapter = QUOTA_ADAPTERS[type];
            const setQuota = getQuotaSetter(adapter);

            commitIfQuotaCacheCurrent(cacheGeneration, () => {
              setQuota((prev) => {
                const nextState = { ...prev };
                entries.forEach(({ file }) => {
                  const key = getQuotaCacheKey(file);
                  const previous = prev[key];
                  nextState[key] =
                    options?.background && previous?.status === 'success'
                      ? { ...previous, checkedAt, refreshing: true }
                      : { ...adapter.buildLoadingState(), checkedAt };
                });
                return nextState;
              });
            });

            const results = await Promise.all(
              entries.map(async ({ file }): Promise<BatchFetchResult> => {
                const cacheKey = getQuotaCacheKey(file);
                try {
                  const data = await adapter.fetchQuota(file, t);
                  return { name: file.name, cacheKey, status: 'success', data };
                } catch (err: unknown) {
                  const message = err instanceof Error ? err.message : t('common.unknown_error');
                  return {
                    name: file.name,
                    cacheKey,
                    status: 'error',
                    error: message,
                    errorStatus: getStatusFromError(err),
                  };
                }
              })
            );

            if (requestId !== requestIdRef.current) return;

            const committedStates = new Map<string, QuotaCardState>();
            setQuota((prev) => {
              const nextState = { ...prev };
              results.forEach((result) => {
                commitIfQuotaCacheCurrent(
                  cacheGeneration,
                  () => {
                    nextState[result.cacheKey] = {
                      ...(result.status === 'success'
                        ? adapter.buildSuccessState(result.data)
                        : adapter.buildErrorState(
                            result.error || t('common.unknown_error'),
                            result.errorStatus
                          )),
                      checkedAt,
                    };
                    committedStates.set(result.cacheKey, nextState[result.cacheKey]);
                  },
                  result.name
                );
              });
              return nextState;
            });
            results.forEach((result, index) => {
              const state = committedStates.get(result.cacheKey);
              if (result.status === 'success' && state) {
                void enrichQuotaInBackground(adapter, entries[index].file, result.data, state, t);
              }
            });
          })
        );
      } finally {
        if (requestId === requestIdRef.current) {
          setBatchState({ session: cacheGeneration.cacheGeneration, loading: false });
          loadingRef.current = null;
        }
      }
    },
    [t]
  );

  return { batchLoading: batchState.session === session && batchState.loading, loadQuota };
}
