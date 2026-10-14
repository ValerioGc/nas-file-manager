import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('settings tabs', () => {
  it('groups settings into accessible category tabs', () => {
    const settings = fs.readFileSync('src/components/desktop/settings/SettingsModal.vue', 'utf8');

    expect(settings).toContain(
      "type SettingsTab = 'general' | 'previews' | 'file-list' | 'appearance';",
    );
    // Inside the launcher theme and language follow it, so their tab is not shown at all.
    expect(settings).toContain("...(nasContextActive.value ? [] : [{ id: 'appearance' as const");
    expect(settings).not.toContain('v-if="!nasContextActive"');
    expect(settings).toContain("activeTab === 'general'");
    expect(settings).toContain('role="tablist"');
    expect(settings).toContain('role="tab"');
    expect(settings).toContain('role="tabpanel"');
    expect(settings).toContain("activeTab === 'previews'");
    expect(settings).toContain('settings-panel-file-list');
    expect(settings).toContain("event.key === 'ArrowRight'");
    expect(settings).not.toContain('<label>{{ t.theme }}</label>');
    expect(settings).toContain("setTheme('auto')");
    expect(settings).toContain('@/assets/icons/flag-it.svg?url');
    expect(settings).toContain('@/assets/icons/flag-en.svg?url');
    expect(settings).toContain('class="language_flag"');
    expect(settings).toContain('align-items: center;');
    expect(settings).toContain('grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));');
    expect(settings).toContain('border: 1px solid var(--border);');
    expect(settings).toContain('border-color: var(--accent);');
    expect(settings).toContain('background: var(--accent);');
  });
});
