import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('move dialog structure', () => {
  it('provides a searchable folder tree and destination confirmation', () => {
    const moveDialog = fs.readFileSync('src/components/common/MoveDialog.vue', 'utf8');

    expect(moveDialog).toContain('BaseModal');
    expect(moveDialog).toContain('FolderTree');
    expect(moveDialog).toContain('v-model="search"');
    expect(moveDialog).toContain(':expand-all="Boolean(search)"');
    expect(moveDialog).toContain('confirm: [destination: string]');
    expect(moveDialog).toContain("emit('confirm', selectedPath.value)");
    expect(moveDialog).toContain("action?: 'copy' | 'move'");

    // Copy and move go through the same window.
    const app = fs.readFileSync('src/apps/desktop/DesktopApp.vue', 'utf8');
    expect(app).toContain('useTransferDialog({');
    expect(app).toContain('<MoveDialog');
    expect(app).toContain(':action="transferAction"');
    expect(fs.readFileSync('src/composables/useFileOperations.ts', 'utf8')).not.toMatch(
      /window\.(prompt|confirm)/,
    );

    const conflictDialog = fs.readFileSync('src/components/common/ConflictDialog.vue', 'utf8');
    expect(conflictDialog).toContain('validateFileName');
    expect(conflictDialog).toContain('value="overwrite"');
    expect(conflictDialog).toContain('value="rename"');
    expect(conflictDialog).toContain('value="skip"');
  });
});
