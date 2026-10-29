import { describe, expect, test } from 'bun:test';
import { buildQuotaBandGroups } from '@/features/quota/bands';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';
import type { ClaudeQuotaState, ClaudeQuotaWindow, CodexQuotaState } from '@/types';

const NOW = 1_800_000_000_000;

const entry = (
  name: string,
  type: QuotaFileEntry['type'] = 'claude',
  disabled = false
): QuotaFileEntry => ({ type, file: { name, type, disabled } });

const window = (
  id: string,
  usedPercent: number | null,
  resetAtMs: number | null = NOW + 60_000
): ClaudeQuotaWindow => ({
  id,
  label: id,
  usedPercent,
  resetLabel: '-',
  resetAtMs,
  periodHours: id === 'five-hour' ? 5 : 168,
});

const success = (windows: ClaudeQuotaWindow[]): ClaudeQuotaState => ({
  status: 'success',
  windows,
});

function groups(entries: QuotaFileEntry[], states: Record<string, QuotaCardState | undefined>) {
  return buildQuotaBandGroups(entries, ({ file }) => states[file.name], NOW);
}

describe('quota band groups', () => {
  test('preserves the incoming account order within each provider', () => {
    const input = [
      entry('codex-b', 'codex'),
      entry('claude-b'),
      entry('other', 'meta'),
      entry('claude-a'),
      entry('codex-a', 'codex'),
    ];
    const result = groups(input, {});

    expect(result.map((group) => group.type)).toEqual(['claude', 'codex']);
    expect(result[0].accounts.map((account) => account.key)).toEqual(['claude-b', 'claude-a']);
    expect(result[1].accounts.map((account) => account.key)).toEqual(['codex-b', 'codex-a']);
    expect(input.map(({ file }) => file.name)).toEqual([
      'codex-b',
      'claude-b',
      'other',
      'claude-a',
      'codex-a',
    ]);
  });

  test('shows explicit unknown standard rows until an account has loaded', () => {
    const result = groups([entry('claude'), entry('codex', 'codex')], {});

    expect(result[0].rows.map((row) => row.id)).toEqual(['five-hour', 'seven-day']);
    expect(result[1].rows.map((row) => row.id)).toEqual(['five-hour', 'weekly']);
    for (const group of result) {
      expect(group.accounts[0].status).toBe('idle');
      for (const row of group.rows) {
        expect(row.accounts[0].window).toBeNull();
        expect(row.labelKey).toBeDefined();
        expect(row.knownCount).toBe(0);
        expect(row.withMargin).toBe(0);
      }
    }
  });

  test('aligns missing windows without inventing percentages and keeps Fable independent', () => {
    const result = groups([entry('a'), entry('b')], {
      a: success([window('seven-day-fable', 0), window('five-hour', 100)]),
      b: success([window('seven-day', 29), window('five-hour', 2)]),
    })[0];

    expect(result.rows.map((row) => row.id)).toEqual(['five-hour', 'seven-day', 'seven-day-fable']);
    expect(result.rows[0].accounts.map(({ window }) => window?.remaining)).toEqual([0, 98]);
    expect(result.rows[1].accounts.map(({ window }) => window?.remaining ?? null)).toEqual([
      null,
      71,
    ]);
    expect(result.rows[2].accounts.map(({ window }) => window?.remaining ?? null)).toEqual([
      100,
      null,
    ]);
    expect(result.rows[1].knownCount).toBe(1);
  });

  test('preserves model-scoped and monthly Codex windows instead of merging equal periods', () => {
    const state: CodexQuotaState = {
      status: 'success',
      windows: [
        window('weekly', 18),
        window('spark-weekly', 70),
        window('code-review-weekly', 10),
        { ...window('monthly', 32), periodHours: 720 },
      ],
    };
    const result = groups([entry('codex', 'codex')], { codex: state })[0];

    expect(result.rows.map((row) => row.id)).toEqual([
      'weekly',
      'monthly',
      'spark-weekly',
      'code-review-weekly',
    ]);
    expect(result.rows.map((row) => row.accounts[0].window?.remaining)).toEqual([82, 68, 30, 90]);
    expect(result.rows[1].accounts[0].window?.periodHours).toBe(720);
    expect(result.rows.some((row) => row.id === 'five-hour')).toBe(false);
  });

  test('counts accounts with margin without averaging different plan capacities', () => {
    const result = groups([entry('team'), entry('max'), entry('empty')], {
      team: { ...success([window('seven-day', 29)]), planType: 'team' } as ClaudeQuotaState,
      max: { ...success([window('seven-day', 15)]), planType: 'max' } as ClaudeQuotaState,
      empty: success([window('seven-day', 100)]),
    })[0].rows[0];

    expect(result.knownCount).toBe(3);
    expect(result.withMargin).toBe(2);
    expect(result.accounts.map(({ window }) => window?.remaining)).toEqual([71, 85, 0]);
  });

  test('keeps null and nonfinite usage unknown instead of showing full capacity', () => {
    const input = [entry('null'), entry('nan'), entry('infinite')];
    const result = groups(input, {
      null: success([window('weekly', null)]),
      nan: success([window('weekly', Number.NaN)]),
      infinite: success([window('weekly', Number.POSITIVE_INFINITY)]),
    })[0].rows[0];

    expect(result.accounts.map(({ window }) => window?.remaining)).toEqual([null, null, null]);
    expect(result.knownCount).toBe(0);
    expect(result.withMargin).toBe(0);
  });

  test('invalidates a percentage at its reset boundary until a new response arrives', () => {
    const result = groups([entry('past'), entry('boundary'), entry('future')], {
      past: success([window('five-hour', 20, NOW - 1)]),
      boundary: success([window('five-hour', 20, NOW)]),
      future: success([window('five-hour', 20, NOW + 1)]),
    })[0].rows[0];

    expect(result.accounts.map(({ window }) => window?.remaining)).toEqual([null, null, 80]);
    expect(result.knownCount).toBe(1);
    expect(result.withMargin).toBe(1);
  });

  test('does not count disabled, stale, loading or failed snapshots as fresh margin', () => {
    const result = groups(
      [
        entry('disabled', 'claude', true),
        entry('stale'),
        entry('loading'),
        entry('error'),
        entry('ok'),
      ],
      {
        disabled: success([window('seven-day', 15)]),
        stale: { ...success([window('seven-day', 15)]), stale: true } as ClaudeQuotaState,
        loading: { status: 'loading', windows: [window('seven-day', 15)] } as ClaudeQuotaState,
        error: {
          status: 'error',
          error: 'Refresh failed',
          windows: [window('seven-day', 15)],
        } as ClaudeQuotaState,
        ok: success([window('seven-day', 15)]),
      }
    )[0];

    expect(result.rows[0].knownCount).toBe(1);
    expect(result.rows[0].withMargin).toBe(1);
    expect(result.accounts[1].stale).toBe(true);
    expect(result.accounts[1].windows[0].remaining).toBe(85);
    expect(result.accounts[2].windows[0].remaining).toBeNull();
    expect(result.accounts[3].windows[0].remaining).toBeNull();
    expect(result.accounts[3].error).toBe('Refresh failed');
  });

  test('clamps finite overflows while keeping a missing reset explicitly unknown', () => {
    const result = groups([entry('a'), entry('b')], {
      a: success([{ ...window('five-hour', -20, Number.NaN), periodHours: Number.NaN }]),
      b: success([window('five-hour', 120, null)]),
    })[0].rows[0];

    expect(result.accounts.map(({ window }) => window?.remaining)).toEqual([100, 0]);
    expect(result.accounts[0].window?.resetAtMs).toBeNull();
    expect(result.accounts[0].window?.periodHours).toBeNull();
    expect(result.knownCount).toBe(2);
  });

  test('retains translation metadata for dynamic labels', () => {
    const state: CodexQuotaState = {
      status: 'success',
      windows: [
        {
          ...window('spark-weekly', 10),
          label: 'Spark weekly',
          labelKey: 'codex_quota.additional_secondary_window',
          labelParams: { name: 'Spark' },
        },
      ],
    };
    const row = groups([entry('codex', 'codex')], { codex: state })[0].rows[0];

    expect(row.label).toBe('Spark weekly');
    expect(row.labelKey).toBe('codex_quota.additional_secondary_window');
    expect(row.labelParams).toEqual({ name: 'Spark' });
    expect(row.accounts[0].window?.labelParams).toEqual({ name: 'Spark' });
  });
});
