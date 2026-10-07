import { useState, useSyncExternalStore } from 'react';
import { debtReminderText, debtStatus, whatsappLink, type ReminderTone } from '@lifty/core';
import { money } from '../lib/format';
import { useData, useToday } from '../lib/store';
import { mutate } from '../lib/sync';
import { Chips, Field, Sheet, toast } from './ui';

/** Recordar con amabilidad a quien te debe: un toque y queda armado el mensaje de WhatsApp. */
let current: string | null = null;
const listeners = new Set<() => void>();
function set(id: string | null) {
  current = id;
  listeners.forEach((fn) => fn());
}
export const openDebtReminder = (debtId: string) => set(debtId);

export function DebtReminderHost() {
  const id = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
  const data = useData();
  const debt = id ? data.debts.find((d) => d.id === id) : null;
  if (!debt) return null;
  return <ReminderSheet key={debt.id} debtId={debt.id} onClose={() => set(null)} />;
}

const TONES: { value: ReminderTone; label: string }[] = [
  { value: 'amable', label: '🙂 Amable' },
  { value: 'directo', label: '👉 Directo' },
  { value: 'divertido', label: '😅 Con humor' },
];

function ReminderSheet({ debtId, onClose }: { debtId: string; onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const debt = data.debts.find((d) => d.id === debtId)!;
  const owner = data.settings.ownerName;
  const [tone, setTone] = useState<ReminderTone>('amable');
  const [text, setText] = useState(() => debtReminderText(debt, 'amable', owner));
  const [phone, setPhone] = useState(debt.phone ?? '');
  const s = debtStatus(debt);
  const remember = () => {
    mutate('debt', 'upsert', { ...debt, phone: phone.trim(), remindedAt: today });
    toast(`Listo: te aviso de nuevo en una semana si ${debt.person.split(' ')[0]} no te pagó`);
    onClose();
  };
  const days = debt.remindedAt ? Math.round((Date.parse(today) - Date.parse(debt.remindedAt)) / 86_400_000) : null;
  return (
    <Sheet
      title={`Recordale a ${debt.person}`}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(
                () => toast('Mensaje copiado'),
                () => toast('No se pudo copiar', { tone: 'error' }),
              );
            }}
          >
            Copiar
          </button>
          <a
            className="btn btn-primary grow"
            href={whatsappLink(text, phone)}
            target="_blank"
            rel="noreferrer"
            onClick={remember}
          >
            Abrir WhatsApp
          </a>
        </>
      }
    >
      <div className="form">
        <p className="muted small">
          Te debe <strong>{money(s.remaining, debt.currency)}</strong>
          {s.paid > 0 ? ` (de ${money(debt.amount, debt.currency)}; ya te pasó ${money(s.paid, debt.currency)})` : ''}.
          {days !== null ? ` Le recordaste hace ${days === 0 ? 'un rato' : `${days} día${days === 1 ? '' : 's'}`}.` : ''}
        </p>
        <Field label="Tono">
          <Chips
            label="Tono"
            value={tone}
            onChange={(t) => {
              setTone(t);
              setText(debtReminderText(debt, t, owner));
            }}
            options={TONES}
          />
        </Field>
        <Field label="Mensaje" hint="Lo podés cambiar antes de mandarlo">
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label="Celular (opcional)" hint="Con el celular se abre su chat directo; si no, elegís a quién en WhatsApp">
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ej: 099 123 456" />
        </Field>
      </div>
    </Sheet>
  );
}
