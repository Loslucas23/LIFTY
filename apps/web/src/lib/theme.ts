/** Tema de la app en este dispositivo: automático (según el sistema), claro u oscuro. */
export type Theme = 'auto' | 'light' | 'dark';
const KEY = 'lifty-theme';

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export function setTheme(theme: Theme) {
  try {
    if (theme === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* sin almacenamiento: vale solo para esta sesión */
  }
  applyTheme(theme);
}
