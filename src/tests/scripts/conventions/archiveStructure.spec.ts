import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('archive opening', () => {
  it('exposes archive listing through the NAS backend', () => {
    const filesystem = readFileSync('src/services/filesystem.ts', 'utf8');
    const core = readFileSync('backend/core/src/lib.rs', 'utf8');
    const axum = readFileSync('backend/axum/src/lib.rs', 'utf8');

    expect(filesystem).toContain("'api/archives/list'");
    expect(core).toContain('ArchiveReader::read_path_with_options');
    expect(core).toContain('Archive::open_with_password');
    expect(core).toContain('by_index_decrypt');
    expect(core).not.toContain('find_archive_tool');
    expect(core).not.toContain('FS_EXPLORER_ARCHIVER');
    expect(axum).toContain('"/api/archives/list"');
  });

  it('opens archives on every screen with the dialog of the explorer', () => {
    const dialog = readFileSync('src/components/common/ArchiveDialog.vue', 'utf8');
    const desktop = readFileSync('src/apps/desktop/DesktopApp.vue', 'utf8');
    const browser = readFileSync('src/components/desktop/explorer/FileBrowser.vue', 'utf8');

    expect(dialog).toContain('type="password"');
    expect(dialog).toContain('@submit.prevent="submit"');
    expect(desktop).toContain('<ArchiveDialog');
    expect(browser).toContain("if (file.kind === 'archive')");
  });
});
