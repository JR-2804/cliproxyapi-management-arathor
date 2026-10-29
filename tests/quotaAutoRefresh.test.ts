import { afterEach, describe, expect, test } from 'bun:test';
import { isQuotaRequestPending, selectAutomaticQuotaTargets } from '@/features/quota/autoRefresh';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { getQuotaCacheKey } from '@/utils/quota/identity';

const NOW = 1_800_000_000_000;
const entry = (
  name: string,
  type: QuotaFileEntry['type'] = 'claude',
  disabled = false
): QuotaFileEntry => ({ type, file: { name, type, disabled } });

const targets = (
  entries: QuotaFileEntry[],
  states: Record<string, QuotaCardState | undefined> = {},
  now = NOW
) => selectAutomaticQuotaTargets(entries, ({ file }) => states[file.name], now);

afterEach(() => {
  useQuotaStore.getState().clearQuotaCache();
});

describe('automatic quota refresh selection', () => {
  test('loads visible Claude and Codex accounts without a prior quota request', () => {
    const entries = [entry('claude'), entry('codex', 'codex')];
    expect(targets(entries)).toEqual(entries);
    expect(targets(entries, { claude: { status: 'success' } })).toEqual(entries);
    expect(targets(entries, { claude: { status: 'idle' } })).toEqual(entries);
  });

  test('leaves disabled accounts and providers with other loading policies alone', () => {
    const input = [
      entry('claude'),
      entry('codex', 'codex'),
      entry('off', 'claude', true),
      entry('antigravity', 'antigravity'),
      entry('devin', 'devin'),
      entry('kimi', 'kimi'),
      entry('meta', 'meta'),
      entry('plugin', 'plugin'),
      entry('xai', 'xai'),
    ];
    expect(targets(input)).toEqual(input.slice(0, 2));
  });

  test('respects the minute boundary for results from either manual or automatic requests', () => {
    const input = [entry('a')];
    const states = { a: { status: 'success' as const, checkedAt: NOW } };
    expect(targets(input, states, NOW + 59_999)).toEqual([]);
    expect(targets(input, states, NOW + 60_000)).toEqual(input);
    expect(targets(input, states, NOW + 120_000)).toEqual(input);
  });

  test('selects stale accounts independently without refreshing a newer account', () => {
    const input = [entry('stale'), entry('new', 'codex'), entry('missing')];
    const states: Record<string, QuotaCardState> = {
      stale: { status: 'success', checkedAt: NOW - 60_000 },
      new: { status: 'success', checkedAt: NOW - 5_000 },
    };
    expect(targets(input, states)).toEqual([input[0], input[2]]);
  });

  test('waits a minute before retrying errors, including rate limits', () => {
    const input = [entry('error')];
    const states: Record<string, QuotaCardState> = {
      error: { status: 'error', error: 'rate limited', errorStatus: 429, checkedAt: NOW },
    };
    expect(targets(input, states, NOW + 1)).toEqual([]);
    expect(targets(input, states, NOW + 59_999)).toEqual([]);
    expect(targets(input, states, NOW + 60_000)).toEqual(input);
  });

  test('does not duplicate an initial request or a refresh retaining successful data', () => {
    const input = [entry('initial'), entry('background')];
    const states: Record<string, QuotaCardState> = {
      initial: { status: 'loading', checkedAt: NOW - 120_000 },
      background: { status: 'success', refreshing: true, checkedAt: NOW - 120_000 },
    };
    expect(targets(input, states)).toEqual([]);
    expect(isQuotaRequestPending(states.initial)).toBe(true);
    expect(isQuotaRequestPending(states.background)).toBe(true);
    expect(isQuotaRequestPending({ status: 'success', refreshing: false })).toBe(false);
    expect(isQuotaRequestPending(undefined)).toBe(false);
  });

  test('recovers when the system clock moves behind a recorded attempt', () => {
    const input = [entry('a')];
    expect(targets(input, { a: { status: 'success', checkedAt: NOW + 3_600_000 } })).toEqual(input);
  });

  test('queries again when a previous timestamp is invalid', () => {
    const input = [entry('a')];
    for (const checkedAt of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(targets(input, { a: { status: 'success', checkedAt } })).toEqual(input);
    }
  });

  test('does not mutate incoming account order or cached states', () => {
    const input = [entry('b', 'codex'), entry('a')];
    const states = { a: { status: 'success' as const, checkedAt: NOW } };
    const before = structuredClone({ input, states });
    expect(targets(input, states)).toEqual([input[0]]);
    expect({ input, states }).toEqual(before);
  });

  test('a new session has no timestamps inherited from the previous server', () => {
    const input = [entry('shared.json')];
    const state = { status: 'success' as const, windows: [], checkedAt: NOW };
    useQuotaStore.getState().setClaudeQuota({ 'shared.json': state });
    const read = (item: QuotaFileEntry) =>
      useQuotaStore.getState().claudeQuota[getQuotaCacheKey(item.file)];
    expect(selectAutomaticQuotaTargets(input, read, NOW)).toEqual([]);

    useQuotaStore.getState().clearQuotaCache();

    expect(selectAutomaticQuotaTargets(input, read, NOW)).toEqual(input);
  });

  test('file invalidation reloads that account while preserving another account timestamp', () => {
    const input = [entry('changed.json'), entry('unchanged.json'), entry('new.json')];
    const state = { status: 'success' as const, windows: [], checkedAt: NOW };
    useQuotaStore.getState().setClaudeQuota({
      'changed.json': state,
      'unchanged.json': state,
    });
    useQuotaStore.getState().clearQuotaCache(['changed.json']);
    const read = (item: QuotaFileEntry) =>
      useQuotaStore.getState().claudeQuota[getQuotaCacheKey(item.file)];

    expect(selectAutomaticQuotaTargets(input, read, NOW)).toEqual([input[0], input[2]]);
  });
});
