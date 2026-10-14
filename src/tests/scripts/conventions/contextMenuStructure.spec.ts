import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('context menu structure', () => {
  it('uses typed visible actions and a safe first-action ref', () => {
    const contextMenu = readFileSync('src/components/common/ContextMenu.vue', 'utf8');

    expect(contextMenu).toContain('type ContextAction');
    expect(contextMenu).toContain("'favorite'");
    expect(contextMenu).toContain('useFavorites');
    expect(contextMenu).toContain('visible: boolean');
    expect(contextMenu).toContain('const actions = computed<MenuAction[]>');
    expect(contextMenu).toContain('function setFirstAction(element: unknown)');
    expect(contextMenu).toContain('function manageAction(action: ContextAction)');
    expect(contextMenu).toContain('index === 0 ? setFirstAction : undefined');
    expect(contextMenu).not.toContain('action.switch');
    expect(contextMenu).not.toContain(':ref="{');
  });

  it('provides an SVG for every context menu action', () => {
    const contextMenu = readFileSync('src/components/common/ContextMenu.vue', 'utf8');
    const actions = ['rename', 'favorite', 'copy', 'cut', 'paste', 'move', 'download', 'delete'];

    actions.forEach((action) => {
      const icon = action === 'favorite' ? 'star' : action;
      expect(contextMenu).toContain(`@/assets/icons/${icon}.svg?url`);
    });
    expect(contextMenu).not.toContain('detailsIcon');
    expect(contextMenu).not.toContain("type: 'details'");
    expect(contextMenu).not.toContain("type: 'open'");
    expect(contextMenu).toContain("type: 'copy-to-clipboard'");
    expect(contextMenu).toContain("type: 'cut-to-clipboard'");
    expect(contextMenu).toContain("type: 'paste'");
    expect(contextMenu).toContain('canPaste?: boolean');

    const fileBrowser = readFileSync('src/components/desktop/explorer/FileBrowser.vue', 'utf8');
    expect(fileBrowser).toContain(':can-paste="canPaste"');
  });
});
