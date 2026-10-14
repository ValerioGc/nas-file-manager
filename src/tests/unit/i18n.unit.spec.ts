import { describe, expect, it, vi } from 'vitest';
import { messages, setLocale, useI18n } from '@/i18n';
import { nasContextActive } from '@/composables/useNasLauncherContext';

describe('i18n', () => {
  it('starts in English when no locale has been persisted', () => {
    const { locale, t } = useI18n();

    expect(locale.value).toBe('en');
    expect(t.value.appName).toBe('Explorer');
    expect(t.value.emptyPreview).toBe('No file selected');
  });

  it('keeps the same translation keys in Italian and English', () => {
    expect(Object.keys(messages.it).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it('persists the chosen locale unless the launcher owns it', () => {
    setLocale('it');
    expect(localStorage.getItem('fs-explorer-locale')).toBe('it');
    expect(document.documentElement.lang).toBe('it');

    nasContextActive.value = true;
    setLocale('en');
    expect(useI18n().locale.value).toBe('it');
    setLocale('en', true);
    expect(useI18n().locale.value).toBe('en');
    nasContextActive.value = false;
  });

  it('restores the persisted locale when it loads', async () => {
    localStorage.setItem('fs-explorer-locale', 'it');
    vi.resetModules();

    const { locale } = await import('@/i18n');

    expect(locale.value).toBe('it');
    expect(document.documentElement.lang).toBe('it');
  });

  it('works without a document or a storage', async () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('localStorage', undefined);
    vi.resetModules();

    const i18n = await import('@/i18n');
    i18n.setLocale('it');

    expect(i18n.locale.value).toBe('it');
  });
});
