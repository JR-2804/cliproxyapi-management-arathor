import { afterEach, describe, expect, test } from 'bun:test';
import {
  moveQuotaAccount,
  readQuotaAccountOrder,
  sortQuotaAccountOrder,
  writeQuotaAccountOrder,
} from '@/features/quota/accountOrder';
import { filterEntriesBySearch, type QuotaFileEntry } from '@/features/quota/logic';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';

const entries: QuotaFileEntry[] = [
  { type: 'claude', file: { name: 'a.json', type: 'claude', note: 'Support' } },
  { type: 'claude', file: { name: 'b.json', type: 'claude' } },
  { type: 'claude', file: { name: 'c.json', type: 'claude' } },
  { type: 'codex', file: { name: 'd.json', type: 'codex' } },
];
const names = (items: QuotaFileEntry[]) => items.map((entry) => entry.file.name);
const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = originalWindow;
});

describe('quota account presentation', () => {
  test('uses notes as names without changing quota identities or searching secrets', () => {
    const file = { ...entries[0].file, account: 'never-search-this-secret' };
    expect(getQuotaDisplayName(file)).toBe('Support');
    expect(getQuotaCacheKey(file)).toBe('a.json');
    expect(getQuotaDisplayName({ ...file, note: '  ' })).toBe('a.json');
    expect(filterEntriesBySearch(entries, 'support')).toEqual([entries[0]]);
    expect(filterEntriesBySearch([{ type: 'claude', file }], 'never-search')).toEqual([]);
  });

  test('keeps multi-identity credentials distinct when they share a note', () => {
    const file = { name: 'shared.json', type: 'devin', note: 'Work', authIndex: '42' };
    expect(getQuotaDisplayName(file)).toBe('Work · 42');
    expect(getQuotaCacheKey(file)).toBe('shared.json\0' + '42');
  });

  test('retains provider groups and appends unseen credentials in their original order', () => {
    expect(names(sortQuotaAccountOrder(entries, ['d.json', 'b.json', 'deleted.json']))).toEqual([
      'b.json',
      'a.json',
      'c.json',
      'd.json',
    ]);
  });

  test('moves accounts around filtered or paginated neighbours without losing hidden accounts', () => {
    expect(moveQuotaAccount(entries, [], 'a.json', 'b.json')).toEqual([
      'b.json',
      'a.json',
      'c.json',
      'd.json',
    ]);
    expect(moveQuotaAccount(entries, [], 'a.json', 'c.json')).toEqual([
      'b.json',
      'c.json',
      'a.json',
      'd.json',
    ]);
    expect(moveQuotaAccount(entries, [], 'c.json', 'a.json')).toEqual([
      'c.json',
      'a.json',
      'b.json',
      'd.json',
    ]);
    expect(moveQuotaAccount(entries, [], 'a.json', 'c.json', 'after')).toEqual([
      'b.json',
      'c.json',
      'a.json',
      'd.json',
    ]);
    expect(moveQuotaAccount(entries, [], 'a.json', 'd.json')).toEqual(names(entries));
  });

  test('persists across reloads per normalized server and tolerates corrupt storage', () => {
    const values = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    };
    writeQuotaAccountOrder('http://server-a:8317/', ['b.json', 'a.json']);
    expect(readQuotaAccountOrder('http://server-a:8317')).toEqual(['b.json', 'a.json']);
    expect(readQuotaAccountOrder('http://server-b:8317')).toEqual([]);
    const key = [...values.keys()][0];
    values.set(key, '{broken');
    expect(readQuotaAccountOrder('http://server-a:8317')).toEqual([]);
    values.set(key, JSON.stringify(['b.json', null, 'b.json', 3, '']));
    expect(readQuotaAccountOrder('http://server-a:8317')).toEqual(['b.json']);
  });

  test('storage failures keep the feature usable', () => {
    (globalThis as unknown as { window: unknown }).window = {
      get localStorage() {
        throw new Error('Storage disabled');
      },
    };
    expect(readQuotaAccountOrder('http://server-a:8317')).toEqual([]);
    expect(() => writeQuotaAccountOrder('http://server-a:8317', ['a.json'])).not.toThrow();
  });
});
