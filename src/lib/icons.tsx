import React, { forwardRef } from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideProps } from 'lucide-react';

/**
 * Lucide-React Chrome Extension CSP Wrapper
 * As documented extensively on StackOverflow and GitHub issues, 
 * lucide-react occasionally injects inline styles (or empty style objects)
 * which violates Chrome Extension Manifest V3's strict Content Security Policy.
 * We implement this wrapper over the module to force `style={undefined}`
 * ensuring they render cleanly without CSP errors.
 */
function createExtensionSafeIcon(IconComponent: React.ComponentType<LucideProps>) {
  const IconWrapper = forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
    <IconComponent ref={ref} {...props} style={undefined} />
  ));
  IconWrapper.displayName = IconComponent.displayName || 'VaultIcon';
  return IconWrapper;
}

// --- Vault Dashboard Icons ---

// Dashboard/Sidebar
/**
 * The Vault Central brand mark. Was a hand-drawn inline <svg> of the old
 * VaultWares "V"; now just renders the shipped icon so the brand lives in one
 * place (icons/) instead of being duplicated as path data. The `vault-central-logo`
 * class is a stable hook for styling — the raster has no addressable internals.
 *
 * Path is relative to the extension root, which is where dashboard-v2.html and
 * pin-entry.html both live.
 */
export const VaultCentralLogo = forwardRef<HTMLImageElement, { size?: number; className?: string; alt?: string }>(
  ({ size = 26, className = '', alt = 'Vault Central' }, ref) => (
    <img
      ref={ref}
      src="icons/vault-central-128.png"
      width={size}
      height={size}
      alt={alt}
      className={`vault-central-logo ${className}`.trim()}
      draggable={false}
    />
  ),
);
VaultCentralLogo.displayName = 'VaultCentralLogo';
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
