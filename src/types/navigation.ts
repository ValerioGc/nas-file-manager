export type DesktopNavigation = 'all-files' | 'favorites' | 'shared' | 'trash';

export interface Breadcrumb {
  label: string;
  path: string;
}

export interface NavigationItem {
  id: DesktopNavigation;
  label: string;
  icon: string;
  active: boolean;
}

/** History entry for the back button, with the list and, for all files, the folder. */
export interface Visit {
  navigation: DesktopNavigation;
  path: string;
  name: string;
}
