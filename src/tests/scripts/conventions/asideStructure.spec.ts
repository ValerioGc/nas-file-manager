import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('desktop aside structure', () => {
  it('keeps the storage summary sticky, collapsible, and preference-driven', () => {
    const aside = fs.readFileSync('src/components/desktop/navigation/AsideMenu.vue', 'utf8');
    const storageUsage = fs.readFileSync(
      'src/components/desktop/navigation/StorageUsage.vue',
      'utf8',
    );
    const combined = `${aside}\n${storageUsage}`;

    expect(combined).toContain('preferences.showFreeSpace');
    expect(combined).toContain('isStorageCollapsed');
    expect(combined).toContain('position: sticky');
    expect(combined).toContain('storageUsagePercentage');
    expect(combined).toContain('{{ storageUsagePercentage }}%');
    expect(combined).toContain('storage_compact_indicator');
    expect(combined).toContain('storage_compact_bar');
    expect(aside).toContain('if (isOpen.value)');
    expect(aside).toContain('class="sidebar_toggle_icon"');
    expect(aside).toContain('stroke="currentColor"');
    expect(aside).toContain('v-if="isOpen || !isCollapsed"');
    expect(aside).toContain('v-else d="M14 12h5M16 9l3 3-3 3"');
    expect(aside).toContain('width: 20px;');
    expect(aside).toContain('height: 20px;');
    expect(combined).toContain('t.collapseStorage');
    expect(aside).not.toContain("'open-settings'");
    expect(aside).not.toContain(':global(');
    expect(aside.match(/^\.sidebar \{/gm) ?? []).toHaveLength(1);
    expect(aside).toContain("from '@/assets/icons/star.svg?url'");
    expect(aside).not.toContain('recent');
    expect(aside).toContain('type NavigationItem');
    expect(aside).toContain('const navigationItems = computed<NavigationItem[]>(');
    expect(aside).toContain("'select-navigation': [navigation: DesktopNavigation]");
    expect(aside).toContain('@click="handleNavigationClick(item)"');
    expect(aside).toContain(':key="item.id"');
    expect(aside).toContain(':class="{ active: item.active }"');
    expect(aside).not.toContain('index === 1');
    expect(aside).not.toContain('class="nav_item active"');
  });

  it('opens collapsed folders from a single tree item click', () => {
    const treeItem = fs.readFileSync('src/components/FolderTreeItem.vue', 'utf8');

    expect(treeItem).toContain('function handleItemClick()');
    expect(treeItem).toContain('function handleToggle()');
    expect(treeItem).toContain("emit('select', props.node)");
    expect(treeItem).toContain("emit('toggle', props.node.path)");
    expect(treeItem).toContain('@click.stop="handleToggle"');
    expect(treeItem).toContain('@click="handleItemClick"');
  });
});
