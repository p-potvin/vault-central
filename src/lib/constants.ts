export const STORAGE_KEYS = {
  SAVED_VIDEOS: 'savedVideos',
  PIN_SETTINGS: 'pinSettings',
  CUSTOM_THEME: 'customTheme',
  ACTIVE_TAB_ID: 'activeDashboardTabId'
} as const;

export const VAULT_CONFIG = {
  DEFAULT_LOCK_TIMEOUT: 3600000, // 1 hour
  NEVER_LOCK_TIMEOUT: -1,
  DEFAULT_PIN_LENGTH: 4,
} as const;

export const NOTIFICATION_CONFIG = {
  DURATION: 3000,
  STACK_OFFSET: 60,
  Z_INDEX: 9999,
} as const;
