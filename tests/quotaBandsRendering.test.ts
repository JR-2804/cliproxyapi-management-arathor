import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { buildQuotaBandGroups } from '@/features/quota/bands';
import { QuotaBands, type QuotaBandsProps } from '@/features/quota/components/QuotaBands';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';

const now = new Date('2099-07-29T10:00:00Z').getTime();
const resetAtMs = now + 3 * 60 * 60 * 1000;
const entries: QuotaFileEntry[] = [
  { type: 'claude', file: { name: 'Support', type: 'claude', account: 'secret-api-key' } },
  { type: 'claude', file: { name: 'Personal', type: 'claude' } },
];

const success: QuotaCardState = {
  status: 'success',
  windows: [
    {
      id: 'seven-day',
      label: 'Weekly',
      usedPercent: 29,
      resetAtMs,
      resetLabel: '',
      periodHours: 168,
    },
  ],
};

const propsFor = (
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined,
  overrides: Partial<QuotaBandsProps> = {}
): QuotaBandsProps => ({
  groups: buildQuotaBandGroups(entries, quotaFor, now),
  now,
  resolvedTheme: 'dark',
  disableControls: false,
  manualOrder: true,
  onRename: () => {},
  onReorder: () => {},
  onMove: () => {},
  onRefresh: () => {},
  onDetails: () => {},
  ...overrides,
});

const english = i18n.cloneInstance({ lng: 'en' });
const renderBands = (props: QuotaBandsProps) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: english }, createElement(QuotaBands, props))
  );

describe('QuotaBands rendering', () => {
  test('renders remaining quota and Madrid reset time without displaying account secrets', () => {
    const markup = renderBands(propsFor(() => success));

    expect(markup).toContain('width:71%');
    expect(markup).toContain('71%');
    expect(markup).toContain('29/07/2099, 15:00');
    expect(markup).toContain('in 3 hours');
    expect(markup).not.toContain('secret-api-key');
  });

  test('keeps missing quota unknown while retaining every account column', () => {
    const markup = renderBands(
      propsFor((entry) => (entry.file.name === 'Support' ? success : undefined))
    );

    expect(markup).toContain('Support');
    expect(markup).toContain('Personal');
    expect(markup).toContain('aria-busy="false"');
    expect(markup).toContain(english.t('quota_management.bands_idle'));
    expect(markup).toContain(english.t('quota_management.bands_known', { count: 1, total: 2 }));
    expect(markup).not.toContain('width:100%');
  });

  test('marks retained stale values and disabled accounts instead of counting them as fresh', () => {
    const stale = { ...success, stale: true } as QuotaCardState;
    const disabledEntries: QuotaFileEntry[] = [
      entries[0],
      { ...entries[1], file: { ...entries[1].file, disabled: true } },
    ];
    const props = propsFor(() => stale, {
      groups: buildQuotaBandGroups(disabledEntries, () => stale, now),
    });
    const markup = renderBands(props);

    expect(markup).toContain(english.t('quota_management.bands_stale'));
    expect(markup).toContain(english.t('quota_management.bands_disabled'));
    expect(markup).toContain('<strong>—</strong>');
  });

  test('only exposes drag and keyboard movement controls in custom order mode', () => {
    const manual = renderBands(propsFor(() => success));
    const automatic = renderBands(propsFor(() => success, { manualOrder: false }));
    const movementLabel = english.t('quota_management.bands_move_left', { name: 'Support' });

    expect(manual).toContain('draggable="true"');
    expect(manual).toContain(`aria-label="${movementLabel}"`);
    expect(manual).toMatch(
      new RegExp(`disabled="" aria-label="${movementLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)
    );
    expect(automatic).toContain('draggable="false"');
    expect(automatic).not.toContain(`aria-label="${movementLabel}"`);
  });

  test('does not allow renaming a runtime-only identity', () => {
    const runtimeEntry: QuotaFileEntry = {
      type: 'claude',
      file: { name: 'Runtime', type: 'claude', runtimeOnly: true },
    };
    const markup = renderBands(
      propsFor(() => success, {
        groups: buildQuotaBandGroups([runtimeEntry], () => success, now),
      })
    );
    const renameLabel = english.t('quota_management.bands_rename', { name: 'Runtime' });

    expect(markup).toContain(`aria-label="${renameLabel}"`);
    expect(markup).toMatch(
      new RegExp(`disabled="" aria-label="${renameLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)
    );
  });
});
