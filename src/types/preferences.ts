export type ThemeMode = 'auto' | 'dark' | 'light';

export interface Preferences {
  animatedPreviews: boolean;
  coloredNavigation: boolean;
  compactList: boolean;
  confirmBeforeDelete: boolean;
  detailsPanel: boolean;
  detailsInGrid: boolean;
  detailsInList: boolean;
  generatePreviews: boolean;
  showFileExtensions: boolean;
  showFreeSpace: boolean;
  showHiddenFiles: boolean;
}

/** The preferences and the theme as they are saved. */
export interface StoredSettings {
  preferences: Preferences;
  themeMode: ThemeMode;
}
