/** localStorage que nunca rompe (modo privado, almacenamiento bloqueado): solo para preferencias de esta pantalla. */
export const local = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  },
};
