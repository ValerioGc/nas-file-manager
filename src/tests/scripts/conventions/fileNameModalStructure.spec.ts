import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateFileName } from '@/utils/fileNameValidation';

describe('file name modal', () => {
  it('uses the shared base modal and validates filesystem names', () => {
    const modal = readFileSync('src/components/common/FileNameModal.vue', 'utf8');
    const validation = readFileSync('src/utils/fileNameValidation.ts', 'utf8');
    const desktopApp = readFileSync('src/apps/desktop/DesktopApp.vue', 'utf8');
    const dialog = readFileSync('src/composables/useNameDialog.ts', 'utf8');

    expect(existsSync('src/components/common/FileNameModal.vue')).toBe(true);
    expect(modal).toContain("import BaseModal from '@/components/common/BaseModal.vue';");
    expect(modal).toContain('validateFileName');
    expect(modal).toContain(':deep(.file_name_modal)');
    expect(modal).toContain("emit('submit', draftName.value.trim())");
    expect(modal).toContain('error?: string');
    expect(modal).toContain('hint?: string');
    expect(modal).toContain('requireExtension?: boolean');
    expect(validation).toContain('reservedNames');
    expect(validation).toContain('nameTooLong');
    // Names come from the window of the app: nothing asks the browser.
    expect(desktopApp).toContain('<FileNameModal');
    expect(desktopApp).toContain('useNameDialog({');
    expect(desktopApp).not.toMatch(/window\.(prompt|confirm)/);
    expect(desktopApp).toContain('openRenameModal');
    expect(dialog).toContain('actions.createFolder(actions.directory(), name)');
    expect(dialog).toContain('actions.createFile(actions.directory(), name)');
  });

  it('rejects invalid filesystem names', () => {
    expect(validateFileName('')).toBe('nameRequired');
    expect(validateFileName('report/name')).toBe('invalidName');
    expect(validateFileName('CON')).toBe('reservedName');
    expect(validateFileName(`${'a'.repeat(256)}`)).toBe('nameTooLong');
    expect(validateFileName('valid-name')).toBeNull();
    expect(validateFileName('notes', true)).toBe('fileExtensionRequired');
    expect(validateFileName('notes.txt', true)).toBeNull();
  });
});
