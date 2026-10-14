import { expect, it } from 'vitest';
import { trimSlashes, trimTrailingSlashes } from '@/utils/paths';

it('trims trailing slashes only', () => {
  expect(trimTrailingSlashes('/docs/reports///')).toBe('/docs/reports');
  expect(trimTrailingSlashes('///')).toBe('');
  expect(trimTrailingSlashes('docs')).toBe('docs');
});

it('trims slashes on both ends and keeps the inner ones', () => {
  expect(trimSlashes('//docs/reports//')).toBe('docs/reports');
  expect(trimSlashes('/')).toBe('');
  expect(trimSlashes('docs')).toBe('docs');
});
