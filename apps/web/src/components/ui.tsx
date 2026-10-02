import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { addMonths, monthLabel, type Currency } from '@lifty/core';
import { money } from '../lib/format';
import { Icon, type IconName } from './Icon';

// ---------- Avisos (toasts) ----------

type Toast = { id: number; text: string; tone: 'ok' | 'error'; action?: { label: string; run: () => void } };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
let toastSeq = 0;

export function toast(text: string, opts: { tone?: Toast['tone']; action?: Toast['action'] } = {}) {
  const t: Toast = { id: ++toastSeq, text, tone: opts.tone ?? 'ok', action: opts.action };
  toasts = [...toasts, t];
  toastListeners.forEach((fn) => fn());
  setTimeout(
    () => {
      toasts = toasts.filter((x) => x.id !== t.id);
      toastListeners.forEach((fn) => fn());
    },
    opts.action ? 6000 : 3200,
  );
}

export function Toasts() {
  const list = useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn);
      return () => toastListeners.delete(fn);
    },
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span>{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                toasts = toasts.filter((x) => x.id !== t.id);
                toastListeners.forEach((fn) => fn());
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- Hoja modal ----------

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}

// ---------- Formularios ----------

export function Field({
  label,
  hint,
  children,
  error,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  error?: string | null;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string | null>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: string; color?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`chip ${value === o.value ? 'on' : ''}`}
          style={o.color ? ({ '--chip': o.color } as React.CSSProperties) : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <span className="chip-icon">{o.icon}</span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

// ---------- Selector de mes ----------

export function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="month-picker">
      <button className="icon-btn" onClick={() => onChange(addMonths(month, -1))} aria-label="Mes anterior">
        <Icon name="left" />
      </button>
      <label className="month-picker-label">
        <span>{monthLabel(month)}</span>
        <input type="month" value={month} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Elegir mes" />
      </label>
      <button className="icon-btn" onClick={() => onChange(addMonths(month, 1))} aria-label="Mes siguiente">
        <Icon name="right" />
      </button>
    </div>
  );
}

// ---------- Presentación ----------

export function Amount({
  value,
  currency = 'UYU',
  tone,
  className = '',
}: {
  value: number;
  currency?: Currency;
  tone?: 'auto' | 'income' | 'expense' | 'muted';
  className?: string;
}) {
  const t = tone === 'auto' ? (value < 0 ? 'expense' : 'income') : tone;
  return <span className={`amount ${t ? `amount-${t}` : ''} ${className}`}>{money(value, currency)}</span>;
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? value / max : 0;
  const tone = ratio > 1 ? 'over' : ratio > 0.85 ? 'warn' : 'ok';
  return (
    <div
      className={`progress progress-${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
    >
      <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} />
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section ${className}`}>
      {(title || action) && (
        <div className="section-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ icon = 'info', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-title">
        {back && (
          <a className="icon-btn" href={`#${back}`} aria-label="Volver">
            <Icon name="left" />
          </a>
        )}
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}
