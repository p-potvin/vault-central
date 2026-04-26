import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'vault-themes'))
from theme_manager import VaultThemeManager

def adjust_color(hex_color, amount):
    hex_color = hex_color.lstrip('#')
    r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    r = max(0, min(255, r + amount))
    g = max(0, min(255, g + amount))
    b = max(0, min(255, b + amount))
    return f"#{r:02x}{g:02x}{b:02x}"

tm = VaultThemeManager()
themes = tm.get_themes()

css_lines = []
ts_lines = [
    "// AUTO-GENERATED FROM vault-themes",
    "export type VaultTheme = { id: number; name: string; mode: 'light' | 'dark'; };",
    "export const VAULT_THEMES: Record<number, VaultTheme> = {"
]

for idx, t in enumerate(themes):
    theme_id = idx + 1
    safe_name = t.name.lower().replace(' ', '-')
    ts_lines.append(f"  {theme_id}: {{ id: {theme_id}, name: '{safe_name}', mode: '{t.mode}' }},")
    
    css_lines.append(f'[data-theme="vault-theme-{safe_name}"] {{')
    css_lines.append(f'  --vault-bg: {t.primary};')

    if t.mode == 'dark':
        css_lines.append(f'  --vault-text: #F3F4F6;')
        css_lines.append(f'  --vault-border: {adjust_color(t.primary, 20)};')
        css_lines.append(f'  --vault-card-bg: rgba(0,0,0,0.5);')
        css_lines.append(f'  --vault-muted: #A0AEC0;')
    else:
        css_lines.append(f'  --vault-text: #1A202C;')
        css_lines.append(f'  --vault-border: {adjust_color(t.primary, -20)};')
        css_lines.append(f'  --vault-card-bg: rgba(255,255,255,0.7);')
        css_lines.append(f'  --vault-muted: #718096;')

    css_lines.append(f'  --vault-accent: {t.accent};')
    css_lines.append(f'  --vault-accent-hover: {adjust_color(t.accent, 20 if t.mode == "dark" else -20)};')
    css_lines.append('}')
    css_lines.append('')

ts_lines.append("};")
ts_lines.append("export const getThemeClass = (id: number) => `vault-theme-${VAULT_THEMES[id]?.name || 'cyberpunk-cinder'}`;")

with open(os.path.join(os.path.dirname(__file__), '..', 'src', 'lib', 'themes.ts'), 'w') as f:
    f.write('\n'.join(ts_lines))

with open(os.path.join(os.path.dirname(__file__), '..', 'src', 'styles', 'vault-themes.css'), 'w') as f:
    f.write('\n'.join(css_lines))
