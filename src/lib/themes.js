export const VAULT_THEMES = {
    1: { id: 1, name: 'golden-slate', mode: 'dark' },
    2: { id: 2, name: 'codex-solar-light', mode: 'light' },
    3: { id: 3, name: 'catppuccin-·-latte', mode: 'light' },
    4: { id: 4, name: 'catppuccin-·-mocha', mode: 'dark' },
    5: { id: 5, name: 'monokai-vault', mode: 'dark' },
    6: { id: 6, name: 'dracula-vault', mode: 'dark' },
    7: { id: 7, name: 'nord-vault', mode: 'dark' },
    8: { id: 8, name: 'tokyo-night-vault', mode: 'dark' },
    9: { id: 9, name: 'gruvbox-vault-·-dark', mode: 'dark' },
    10: { id: 10, name: 'gruvbox-vault-·-light', mode: 'light' },
    11: { id: 11, name: 'rosé-pine', mode: 'dark' },
    12: { id: 12, name: 'one-dark-vault', mode: 'dark' },
    13: { id: 13, name: 'ayu-vault-·-light', mode: 'light' },
    14: { id: 14, name: 'github-vault-·-light', mode: 'light' },
};
export const getThemeClass = (id) => `vault-theme-${VAULT_THEMES[id]?.name || 'cyberpunk-cinder'}`;
