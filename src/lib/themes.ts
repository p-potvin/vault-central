// AUTO-GENERATED FROM vault-themes
export type VaultTheme = { id: number; name: string; mode: 'light' | 'dark'; };
export const VAULT_THEMES: Record<number, VaultTheme> = {
  1: { id: 1, name: 'golden-slate', mode: 'dark' },
  2: { id: 2, name: 'codex-solarized-light-revisited', mode: 'light' },
  3: { id: 3, name: 'cyberpunk-cinder', mode: 'dark' },
  4: { id: 4, name: 'vintage-velvet', mode: 'light' },
  5: { id: 5, name: 'modern-monolith', mode: 'light' },
  6: { id: 6, name: 'neon-void', mode: 'dark' },
  7: { id: 7, name: 'ocean-mist', mode: 'light' },
  8: { id: 8, name: 'royal-tangerine', mode: 'dark' },
  9: { id: 9, name: 'crimson-bloom', mode: 'dark' },
  10: { id: 10, name: 'amethyst-frost', mode: 'light' },
  11: { id: 11, name: 'catppuccin-mocha', mode: 'dark' },
  12: { id: 12, name: 'dracula', mode: 'dark' },
  13: { id: 13, name: 'tokyo-night-storm', mode: 'dark' },
  14: { id: 14, name: 'github-light-default', mode: 'light' },
  15: { id: 15, name: 'monokai-pro', mode: 'dark' },
};
export const getThemeClass = (id: number) => `vault-theme-${VAULT_THEMES[id]?.name || 'cyberpunk-cinder'}`;