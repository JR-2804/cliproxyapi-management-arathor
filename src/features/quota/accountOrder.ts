import { normalizeApiBase } from '@/utils/connection';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { QUOTA_TAB_ORDER } from './constants';
import type { QuotaFileEntry } from './logic';

const storageKey = (apiBase: string) =>
  `quotaPage.accountOrder:${encodeURIComponent(normalizeApiBase(apiBase))}`;

export function readQuotaAccountOrder(apiBase: string): string[] {
  if (!apiBase || typeof window === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey(apiBase)) || '[]');
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((key): key is string => typeof key === 'string' && !!key))];
  } catch {
    return [];
  }
}

export function writeQuotaAccountOrder(apiBase: string, order: readonly string[]): void {
  if (!apiBase || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(apiBase), JSON.stringify(order));
  } catch {
    // The current page can still use its in-memory order when storage is unavailable.
  }
}

export function sortQuotaAccountOrder(
  entries: QuotaFileEntry[],
  order: readonly string[]
): QuotaFileEntry[] {
  const ranks = new Map(order.map((key, index) => [key, index]));
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const group = QUOTA_TAB_ORDER.indexOf(a.entry.type) - QUOTA_TAB_ORDER.indexOf(b.entry.type);
      if (group !== 0) return group;
      const left = ranks.get(getQuotaCacheKey(a.entry.file)) ?? Infinity;
      const right = ranks.get(getQuotaCacheKey(b.entry.file)) ?? Infinity;
      return left === right ? a.index - b.index : left - right;
    })
    .map(({ entry }) => entry);
}

export function moveQuotaAccount(
  entries: QuotaFileEntry[],
  order: readonly string[],
  sourceKey: string,
  targetKey: string,
  placement?: 'before' | 'after'
): string[] {
  const sorted = sortQuotaAccountOrder(entries, order);
  const source = sorted.find((entry) => getQuotaCacheKey(entry.file) === sourceKey);
  const target = sorted.find((entry) => getQuotaCacheKey(entry.file) === targetKey);
  const keys = sorted.map((entry) => getQuotaCacheKey(entry.file));
  if (!source || !target || source === target || source.type !== target.type) return keys;
  const side =
    placement ?? (keys.indexOf(sourceKey) < keys.indexOf(targetKey) ? 'after' : 'before');
  const next = keys.filter((key) => key !== sourceKey);
  const targetIndex = next.indexOf(targetKey);
  next.splice(targetIndex + (side === 'after' ? 1 : 0), 0, sourceKey);
  return next;
}
