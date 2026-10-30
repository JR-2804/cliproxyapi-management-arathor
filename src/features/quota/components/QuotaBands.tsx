import { useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconInfo,
  IconLoader2,
  IconPencil,
  IconRefreshCw,
  IconSlidersHorizontal,
} from '@/components/ui/icons';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import { formatRelativeInstant, TYPE_COLORS } from '@/utils/quota';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import type { QuotaBandAccount, QuotaBandGroup, QuotaBandWindow } from '../bands';
import type { QuotaFileEntry } from '../logic';
import styles from './QuotaBands.module.scss';

export interface QuotaBandsProps {
  groups: QuotaBandGroup[];
  now: number;
  resolvedTheme: ResolvedTheme;
  disableControls: boolean;
  manualOrder: boolean;
  onRename: (file: AuthFileItem) => void;
  onReorder: (sourceKey: string, targetKey: string) => void;
  onMove: (key: string, direction: -1 | 1) => void;
  onRefresh: (entry: QuotaFileEntry) => void;
  onDetails: (entry: QuotaFileEntry) => void;
}

const initialsFor = (name: string) => {
  const words = name
    .trim()
    .split(/[\s._@-]+/u)
    .filter(Boolean);
  const first = Array.from(words[0] ?? '')[0] ?? '';
  const last =
    words.length > 1 ? Array.from(words[words.length - 1])[0] : Array.from(words[0] ?? '')[1];
  return `${first}${last ?? ''}`.toLocaleUpperCase();
};

const resetDateFormatter = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function QuotaBands({
  groups,
  now,
  resolvedTheme,
  disableControls,
  manualOrder,
  onRename,
  onReorder,
  onMove,
  onRefresh,
  onDetails,
}: QuotaBandsProps) {
  const { t } = useTranslation();
  const draggedKey = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const reorder = (source: string, target: string, group: QuotaBandGroup) => {
    if (
      !manualOrder ||
      disableControls ||
      source === target ||
      !group.accounts.some((account) => account.key === source)
    ) {
      return;
    }
    onReorder(source, target);
    setAnnouncement(t('quota_management.bands_reordered'));
  };

  const beginDrag = (event: DragEvent<HTMLDivElement>, key: string) => {
    if ((event.target as HTMLElement).closest('button')) {
      event.preventDefault();
      return;
    }
    draggedKey.current = key;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', key);
  };

  const endDrag = () => {
    draggedKey.current = null;
    setDropTarget(null);
  };

  return (
    <div className={styles.bands}>
      <span className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </span>
      {groups.map((group) => {
        const providerName = getTypeLabel(t, group.type);
        const providerIcon = getAuthFileIcon(group.type, resolvedTheme);
        const colors = TYPE_COLORS[group.type] || TYPE_COLORS.unknown;
        const color = resolvedTheme === 'dark' && colors.dark ? colors.dark : colors.light;
        const groupStyle = {
          '--account-count': group.accounts.length,
          '--provider-accent': group.type === 'codex' ? 'var(--text-secondary)' : color.text,
        } as CSSProperties;

        return (
          <section
            key={group.type}
            className={styles.provider}
            style={groupStyle}
            aria-label={providerName}
          >
            <header className={styles.providerHeading}>
              {providerIcon && <img src={providerIcon} alt="" className={styles.providerIcon} />}
              <h3>{providerName}</h3>
              <span className={styles.providerCount}>{group.accounts.length}</span>
            </header>

            <div className={styles.scroll} tabIndex={0} aria-label={providerName}>
              <div className={styles.table} role="table" aria-label={providerName}>
                <div className={`${styles.row} ${styles.headerRow}`} role="row">
                  <div className={styles.headerLabel} role="columnheader" />
                  {group.accounts.map((account, index) => {
                    const file = account.entry.file;
                    const name = getQuotaDisplayName(file);
                    const loading = account.status === 'loading' || account.refreshing;
                    const canRefresh = !disableControls && !file.disabled && !loading;

                    return (
                      <div
                        key={account.key}
                        className={`${styles.accountHeader} ${
                          dropTarget === account.key ? styles.dropTarget : ''
                        }`}
                        role="columnheader"
                        draggable={manualOrder && !disableControls}
                        onDragStart={(event) => beginDrag(event, account.key)}
                        onDragEnd={endDrag}
                        onDragOver={(event) => {
                          if (
                            !manualOrder ||
                            disableControls ||
                            !draggedKey.current ||
                            !group.accounts.some((item) => item.key === draggedKey.current)
                          ) {
                            return;
                          }
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          setDropTarget(account.key);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const source = draggedKey.current;
                          if (source) reorder(source, account.key, group);
                          endDrag();
                        }}
                      >
                        <div className={styles.accountIdentity}>
                          {manualOrder && (
                            <span
                              className={styles.dragHandle}
                              title={t('quota_management.bands_drag', { name })}
                            >
                              <IconSlidersHorizontal size={12} aria-hidden="true" />
                            </span>
                          )}
                          <span className={styles.avatar} aria-hidden="true">
                            {initialsFor(name)}
                          </span>
                          <button
                            type="button"
                            className={styles.accountName}
                            title={name}
                            aria-label={t('quota_management.bands_rename', { name })}
                            onClick={() => onRename(file)}
                            disabled={disableControls || file.runtimeOnly === true}
                          >
                            {name}
                          </button>
                        </div>
                        <div className={styles.accountActions}>
                          {manualOrder && (
                            <>
                              <button
                                type="button"
                                className={styles.iconButton}
                                onClick={() => {
                                  onMove(account.key, -1);
                                  setAnnouncement(t('quota_management.bands_reordered'));
                                }}
                                disabled={disableControls || index === 0}
                                aria-label={t('quota_management.bands_move_left', { name })}
                                title={t('quota_management.bands_move_left', { name })}
                              >
                                <IconChevronLeft size={13} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className={`${styles.iconButton} ${styles.moveRight}`}
                                onClick={() => {
                                  onMove(account.key, 1);
                                  setAnnouncement(t('quota_management.bands_reordered'));
                                }}
                                disabled={disableControls || index === group.accounts.length - 1}
                                aria-label={t('quota_management.bands_move_right', { name })}
                                title={t('quota_management.bands_move_right', { name })}
                              >
                                <IconChevronLeft size={13} aria-hidden="true" />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            className={styles.iconButton}
                            onClick={() => onRename(file)}
                            disabled={disableControls || file.runtimeOnly === true}
                            aria-label={t('quota_management.bands_rename', { name })}
                            title={t('quota_management.bands_rename', { name })}
                          >
                            <IconPencil size={13} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className={styles.iconButton}
                            onClick={() => onRefresh(account.entry)}
                            disabled={!canRefresh}
                            aria-label={t('quota_management.bands_refresh', { name })}
                            title={t('quota_management.bands_refresh', { name })}
                          >
                            <IconRefreshCw
                              size={13}
                              aria-hidden="true"
                              className={loading ? styles.spinning : undefined}
                            />
                          </button>
                          <button
                            type="button"
                            className={styles.iconButton}
                            onClick={() => onDetails(account.entry)}
                            aria-label={t('quota_management.bands_details', { name })}
                            title={t('quota_management.bands_details', { name })}
                          >
                            <IconInfo size={13} aria-hidden="true" />
                          </button>
                        </div>
                        {(file.disabled || account.stale) && (
                          <span className={styles.accountState}>
                            {file.disabled
                              ? t('quota_management.bands_disabled')
                              : t('quota_management.bands_stale')}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {group.rows.map((row) => {
                  const rowLabel = row.labelKey ? t(row.labelKey, row.labelParams) : row.label;

                  return (
                    <div className={styles.row} role="row" key={row.id}>
                      <div className={styles.rowHeading} role="rowheader">
                        <span className={styles.rowLabel}>{rowLabel}</span>
                        <span className={styles.summary}>
                          <strong>{row.knownCount === 0 ? '—' : row.withMargin}</strong>
                          <span> / {group.accounts.length}</span>
                        </span>
                        <span className={styles.summaryCaption}>
                          {t('quota_management.bands_with_margin')}
                        </span>
                        {row.knownCount < group.accounts.length && (
                          <span className={styles.knownCount}>
                            {t('quota_management.bands_known', {
                              count: row.knownCount,
                              total: group.accounts.length,
                            })}
                          </span>
                        )}
                      </div>
                      {row.accounts.map(({ account, window }) => (
                        <div className={styles.cell} role="cell" key={account.key}>
                          <BandSegment
                            account={account}
                            window={window}
                            label={rowLabel}
                            now={now}
                            disabled={disableControls}
                            onRefresh={onRefresh}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
            <footer className={styles.legend}>
              <span className={styles.legendFill} aria-hidden="true" />
              <span className={styles.legendConsumed} aria-hidden="true" />
              <span>{t('quota_management.bands_legend')}</span>
            </footer>
          </section>
        );
      })}
    </div>
  );
}

interface BandSegmentProps {
  account: QuotaBandAccount;
  window: QuotaBandWindow | null;
  label: string;
  now: number;
  disabled: boolean;
  onRefresh: (entry: QuotaFileEntry) => void;
}

function BandSegment({ account, window, label, now, disabled, onRefresh }: BandSegmentProps) {
  const { t, i18n } = useTranslation();
  const name = getQuotaDisplayName(account.entry.file);
  const loading = account.status === 'loading';
  const remaining = window?.remaining ?? null;
  const resetAtMs = window?.resetAtMs ?? null;
  const resetLabel =
    resetAtMs !== null && resetAtMs > now
      ? formatRelativeInstant(resetAtMs, now, i18n.resolvedLanguage)
      : null;
  const remainingLabel =
    remaining === null
      ? t('quota_management.bands_unknown')
      : t('quota_management.bands_remaining', { percent: remaining });
  const stateLabel = account.entry.file.disabled
    ? t('quota_management.bands_disabled')
    : loading
      ? t(`${account.entry.type}_quota.loading`)
      : account.status === 'idle'
        ? t('quota_management.bands_idle')
        : account.stale
          ? t('quota_management.bands_stale')
          : remainingLabel;
  const title = [
    name,
    label,
    remainingLabel,
    account.stale ? t('quota_management.bands_stale') : null,
    resetAtMs !== null ? resetDateFormatter.format(resetAtMs) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (remaining === null) {
    return (
      <button
        type="button"
        className={`${styles.segment} ${styles.unknownSegment}`}
        onClick={() => onRefresh(account.entry)}
        disabled={disabled || account.entry.file.disabled || loading}
        aria-label={`${name} · ${label} · ${stateLabel}`}
        aria-busy={loading}
        title={title}
      >
        {loading ? (
          <IconLoader2 size={13} className={styles.spinning} aria-hidden="true" />
        ) : account.status === 'error' || account.stale ? (
          <IconAlertTriangle size={13} aria-hidden="true" />
        ) : (
          <IconRefreshCw size={13} aria-hidden="true" />
        )}
        <span className={styles.emptyLabel}>{stateLabel}</span>
      </button>
    );
  }

  return (
    <div
      className={`${styles.segment} ${account.entry.file.disabled ? styles.disabledSegment : ''}`}
      role="img"
      aria-label={title}
      title={title}
    >
      <span className={styles.segmentFill} style={{ width: `${remaining}%` }} aria-hidden="true" />
      <span className={styles.percent}>{remaining}%</span>
      {resetLabel && (
        <span className={styles.reset}>
          <IconRefreshCw size={11} aria-hidden="true" />
          <span>{resetLabel}</span>
        </span>
      )}
    </div>
  );
}
