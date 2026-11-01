import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('desktop toolbar structure', () => {
  it('keeps upload and folder creation actions beside search', () => {
    const actionMenu = fs.readFileSync('src/components/desktop/header/ActionMenu.vue', 'utf8');

    expect(actionMenu).toContain('openUploadPicker');
    expect(actionMenu).toContain('@click="createFolder"');
    expect(actionMenu).toContain('@click="createFile"');
    expect(actionMenu).toContain('function handleUpload');
    expect(actionMenu).toContain('const searchModel = computed');
    expect(actionMenu).toContain('function handleSortChange');
    expect(actionMenu).toContain('@change="handleSortChange"');
    expect(actionMenu).toContain('const viewModeModel = computed');
  });
});
