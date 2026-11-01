import { expect, it } from 'vitest';
import { toBackendPath, toUiPath, trimTrailingSlashes } from '@/utils/paths';

it('trims trailing slashes only', () => {
  expect(trimTrailingSlashes('/docs/reports///')).toBe('/docs/reports');
  expect(trimTrailingSlashes('///')).toBe('');
  expect(trimTrailingSlashes('docs')).toBe('docs');
});

it('converts between UI and backend paths', () => {
  expect(toBackendPath('//docs/reports')).toBe('docs/reports');
  expect(toBackendPath('\\docs')).toBe('docs');
  expect(toUiPath('docs/reports')).toBe('/docs/reports');
  expect(toUiPath('')).toBe('/');
});
