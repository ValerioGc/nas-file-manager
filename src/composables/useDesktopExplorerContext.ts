import { inject, provide, type InjectionKey } from 'vue';
import type { DesktopExplorerContext } from '@/types/explorer';

export const desktopExplorerContextKey: InjectionKey<DesktopExplorerContext> =
  Symbol('desktopExplorerContext');

export function provideDesktopExplorerContext(context: DesktopExplorerContext) {
  provide(desktopExplorerContextKey, context);
}

export function useDesktopExplorerContext() {
  const context = inject(desktopExplorerContextKey);
  if (!context) {
    throw new Error('Desktop explorer context is unavailable');
  }

  return context;
}
