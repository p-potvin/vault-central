import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { forwardRef } from 'react';
import * as LucideIcons from 'lucide-react';
/**
 * Lucide-React Chrome Extension CSP Wrapper
 * As documented extensively on StackOverflow and GitHub issues,
 * lucide-react occasionally injects inline styles (or empty style objects)
 * which violates Chrome Extension Manifest V3's strict Content Security Policy.
 * We implement this wrapper over the module to force `style={undefined}`
 * ensuring they render cleanly without CSP errors.
 */
function createExtensionSafeIcon(IconComponent) {
    const IconWrapper = forwardRef((props, ref) => (_jsx(IconComponent, { ref: ref, ...props, style: undefined })));
    IconWrapper.displayName = IconComponent.displayName || 'VaultIcon';
    return IconWrapper;
}
// --- Vault Dashboard Icons ---
// Dashboard/Sidebar
export const VaultWaresIcon = forwardRef((props, ref) => {
    const { size = 26, className, ...rest } = props;
    return (_jsxs("svg", { ref: ref, viewBox: "0 0 120 120", width: size, height: size, className: className, ...rest, style: undefined, children: [_jsx("path", { d: "M20 15 L38 15 L60 82 L82 15 L100 15 L67 108 L53 108 Z", fill: "var(--vault-accent, #CC9B21)" }), _jsx("ellipse", { cx: "60", cy: "58", rx: "12", ry: "11", fill: "none", stroke: "currentColor", strokeWidth: "2.5", className: "opacity-80" }), _jsx("circle", { cx: "60", cy: "58", r: "4", fill: "var(--vault-accent, #CC9B21)" })] }));
});
VaultWaresIcon.displayName = 'VaultWaresIcon';
export const ViewModeIcon = createExtensionSafeIcon(LucideIcons.SlidersHorizontal); // for view mode
export const ThemeIcon = createExtensionSafeIcon(LucideIcons.Palette); // for theme
export const SettingsIcon = createExtensionSafeIcon(LucideIcons.Settings); // for settings/advanced
export const SearchIcon = createExtensionSafeIcon(LucideIcons.Search); // for search
export const GroupIcon = createExtensionSafeIcon(LucideIcons.FolderTree); // for group by
export const SortIcon = createExtensionSafeIcon(LucideIcons.ArrowDownAZ); // for sort
export const PinIcon = createExtensionSafeIcon(LucideIcons.Lock); // for PIN protection
export const ExportIcon = createExtensionSafeIcon(LucideIcons.FileJson); // for export
export const ImportIcon = createExtensionSafeIcon(LucideIcons.FileUp); // for import
export const DebugIcon = createExtensionSafeIcon(LucideIcons.Bug); // for debug logs
export const DeleteIcon = createExtensionSafeIcon(LucideIcons.Trash); // for delete
export const EditIcon = createExtensionSafeIcon(LucideIcons.SquarePen); // for edit (was FileEdit, deprecated in v0.462)
export const PlayIcon = createExtensionSafeIcon(LucideIcons.CirclePlay); // for play/open (was PlayCircle, deprecated in v0.462)
export const BackIcon = createExtensionSafeIcon(LucideIcons.ArrowLeft); // for back
export const ChevronLeftIcon = createExtensionSafeIcon(LucideIcons.ChevronLeft);
export const ChevronRightIcon = createExtensionSafeIcon(LucideIcons.ChevronRight);
export const CloseIcon = createExtensionSafeIcon(LucideIcons.CircleX); // for close/cancel
export const AlertIcon = createExtensionSafeIcon(LucideIcons.CircleAlert); // for alert/warning (was AlertCircle, deprecated in v0.462)
export const LoaderIcon = createExtensionSafeIcon(LucideIcons.Loader2); // for loading
export const RefreshIcon = createExtensionSafeIcon(LucideIcons.RefreshCw); // for refresh
// Pin Entry
export const UnlockIcon = createExtensionSafeIcon(LucideIcons.Unlock);
export const KeyIcon = createExtensionSafeIcon(LucideIcons.Key);
export const FingerprintIcon = createExtensionSafeIcon(LucideIcons.Fingerprint);
export const EyeIcon = createExtensionSafeIcon(LucideIcons.Eye);
export const EyeOffIcon = createExtensionSafeIcon(LucideIcons.EyeOff);
export const HashIcon = createExtensionSafeIcon(LucideIcons.Hash);
