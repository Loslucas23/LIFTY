import { useEffect, useState } from 'react';
import { openTxForm } from '../components/TxForm';
import { Field, PageHeader } from '../components/ui';
import { navigate, useQuery } from '../lib/router';
import { readShared } from '../lib/share';

/** Lo que compartiste a Lifty: abre el gasto ya completado con lo que entendió. */
export function Share() {
  const query = useQuery();
  const [empty, setEmpty] = useState(false);
  const [text, setText] = useState('');
  useEffect(() => {
    let alive = true;
    void readShared(query).then(({ text, photo }) => {
      if (!alive) return;
      if (!text && !photo) return setEmpty(true);
      navigate('/', { replace: true });
      openTxForm({ preset: { kind: 'expense' }, sharedText: text || undefined, photo: photo ?? undefined });
    });
    return () => {
      alive = false;
    };
    // Solo al llegar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!empty) return <div className="page narrow" />;
  return (
    <div className="page narrow">
      <PageHeader title="Compartir a Lifty" subtitle="Un mensaje del banco, de WhatsApp o la foto del ticket" />
      <div className="card pad">
        <p>
          Desde WhatsApp, la galería o el aviso del banco tocá <strong>Compartir → Lifty</strong>: se abre el gasto con el monto,
          el comercio y la fecha que encontró en el mensaje. Vos revisás y guardás.
        </p>
        <p className="muted small">
          Para que Lifty aparezca en «Compartir», tiene que estar instalada en el celular (se instala desde el navegador cuando
          entrás con https, por ejemplo con Tailscale). Si no llegó lo que compartiste, abrí Lifty una vez y probá de nuevo.
        </p>
      </div>
      <form
        className="card form pad"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          navigate('/', { replace: true });
          openTxForm({ preset: { kind: 'expense' }, sharedText: text });
        }}
      >
        <Field label="O pegá el mensaje acá">
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ej: BROU informa: Compra por $ 1.234,00 en TIENDA INGLESA…"
          />
        </Field>
        <button className="btn btn-primary" disabled={!text.trim()}>
          Cargar el gasto
        </button>
      </form>
    </div>
  );
}
