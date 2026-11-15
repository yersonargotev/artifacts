export const themes = ['dark', 'light'] as const;
export type Theme = typeof themes[number];
export const themeCookie = 'panel_theme';
export const isTheme = (value: unknown): value is Theme => themes.some((theme) => theme === value);

/** The cookie that the toggle writes decides the theme; anything else renders the dark default. */
export const readTheme = (cookie: string | undefined): Theme => isTheme(cookie) ? cookie : 'dark';

/** The browser chrome takes the page background, which `--bg` sets in `tokens.css`. */
export const themeColors: Record<Theme, string> = { dark: '#1e1e2e', light: '#eff1f5' };

export const themeToggle: Record<Theme, { next: Theme; label: string; icon: 'sun' | 'moon' }> = {
  dark: { next: 'light', label: 'Cambiar a tema claro', icon: 'sun' },
  light: { next: 'dark', label: 'Cambiar a tema oscuro', icon: 'moon' },
};
