import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('global scrollbar styling', () => {
  it('uses thin themed scrollbars with an accent hover state', () => {
    const mainStyles = fs.readFileSync('src/styles/main.scss', 'utf8');
    const styles = fs.readFileSync(
      'node_modules/@valeriogc/nas-base-app/dist/styles/_nas-scrollbar.scss',
      'utf8',
    );

    expect(mainStyles).toContain("@use '@valeriogc/nas-base-app/styles/_nas-scrollbar.scss'");
    expect(styles).toContain('scrollbar-width: thin');
    expect(styles).toContain('scrollbar-color: var(--border) transparent');
    expect(styles).toContain('*::-webkit-scrollbar-thumb:hover');
    expect(styles).toContain('background: var(--accent)');
  });
});
