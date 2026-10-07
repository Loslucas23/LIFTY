import { useEffect, useRef } from 'react';
import { autopilot, autopilotMutations, undoAutopilot, type AutoLog } from '@lifty/core';
import { toast } from '../components/ui';
import { navigate } from './router';
import { useData, useMonth, useSync, useToday } from './store';
import { mutateMany } from './sync';

/**
 * Corre el piloto automático cuando cambian los datos (con una pausa, para no correr a cada
 * tecla). Lo que hace queda en el historial y se puede deshacer.
 */
export function useAutopilot() {
  const data = useData();
  const today = useToday();
  const b = useMonth(today.slice(0, 7));
  const { status } = useSync();
  /** Lo que ya se aplicó en esta sesión (hasta que llega al estado, no se repite). */
  const applied = useRef(new Set<string>());
  useEffect(() => {
    if (status === 'loading' || status === 'unauthorized') return;
    const t = setTimeout(() => {
      const actions = autopilot(data, b, today).filter((a) => !applied.current.has(a.key));
      if (!actions.length) return;
      for (const a of actions) applied.current.add(a.key);
      mutateMany(autopilotMutations(actions, today));
      toast(
        actions.length === 1 ? `🤖 ${actions[0].title}` : `🤖 Lifty hizo ${actions.length} cosas solo: ${actions[0].title}…`,
        { action: { label: 'Ver', run: () => navigate('/piloto') } },
      );
    }, 1500);
    return () => clearTimeout(t);
  }, [data, b, today, status]);
}

export function undoAuto(log: AutoLog) {
  mutateMany(undoAutopilot(log));
  toast('Deshecho: no se va a volver a hacer');
}
