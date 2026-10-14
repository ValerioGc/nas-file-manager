import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('desktop explorer structure', () => {
  it('navigates folders on click and keeps the details panel collapsible, closed at start', () => {
    const mainView = fs.readFileSync('src/components/desktop/layout/MainView.vue', 'utf8');
    const explorerView = fs.readFileSync(
      'src/components/desktop/explorer/ExplorerView.vue',
      'utf8',
    );
    const fileBrowser = fs.readFileSync('src/components/desktop/explorer/FileBrowser.vue', 'utf8');
    const preferences = fs.readFileSync('src/composables/usePreferences.ts', 'utf8');

    expect(mainView).toContain(
      "import ExplorerView from '@/components/desktop/explorer/ExplorerView.vue';",
    );
    expect(fileBrowser).toContain('function handleFileClick(file: FileEntry, event: MouseEvent)');
    expect(fileBrowser).toContain('function handleFileDoubleClick(file: FileEntry)');
    expect(fileBrowser).toContain('navigate(file.path, file.name)');
    expect(fileBrowser).toContain("emit('select-files', nextSelection)");
    expect(fileBrowser).toContain('event.shiftKey');
    expect(fileBrowser).toContain('event.ctrlKey');
    expect(fileBrowser).toContain('event.metaKey');
    expect(fileBrowser).toContain('fileActions(action, selectedFiles)');
    expect(explorerView).toContain('function handleFileSelect');
    expect(explorerView).toContain('isDetailsCollapsed');
    expect(explorerView).toContain('selectedFiles');
    // The panel shows only where the settings want it, and only with files to describe.
    expect(explorerView).toContain('files.value.length > 0 && showsDetails(preferences.value');
    expect(explorerView).toContain('v-if="!isNarrowDesktop && details"');
    expect(explorerView).toContain('no_details: !details || isNarrowDesktop');
    expect(explorerView).toContain('show-actions');
    expect(explorerView).toContain('show-collapse');
    expect(explorerView).toContain('expandDetails');
    expect(explorerView).toContain('show-close');
    expect(explorerView).toContain('const isDetailsCollapsed = ref(true);');
    expect(explorerView).toContain('class="browser_column"');
    expect(explorerView).not.toContain('margin-top: 40px');
    expect(explorerView).toContain('border-top-left-radius: 0;');
    expect(explorerView).toContain('border-bottom-left-radius: 0;');
    expect(explorerView).toContain('align-self: stretch;');
    expect(explorerView).toContain('box-sizing: border-box;');
    expect(explorerView).toContain('background: var(--surface);');
    expect(explorerView).toContain(':deep(.preview)');
    expect(fileBrowser).toContain('position: sticky;');
    expect(fileBrowser).toContain('top: 0;');
    expect(fileBrowser).toContain('min-height: 40px;');
    expect(mainView).not.toContain('function handleFileClick');
    expect(mainView).not.toContain('defineProps');
    expect(preferences).not.toContain('showDetailsPanel');
  });
});
