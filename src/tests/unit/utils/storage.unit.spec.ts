import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateUsagePercentage, formatStorageBytes } from '@/utils/storage';

describe('storage usage percentage', () => {
  it('calculates a bounded rounded percentage', () => {
    expect(calculateUsagePercentage(68_400_000_000, 100_000_000_000)).toBe(68);
    expect(calculateUsagePercentage(120, 100)).toBe(100);
    expect(calculateUsagePercentage(-10, 100)).toBe(0);
  });

  it('returns zero when storage has no capacity', () => {
    expect(calculateUsagePercentage(10, 0)).toBe(0);
  });

  it('formats real storage values for the UI', () => {
    expect(formatStorageBytes(512_000_000)).toBe('512 MB');
    expect(formatStorageBytes(71_300_000_000)).toBe('71 GB');
  });

  it('renders the percentage at the end of the storage bar', () => {
    const desktopAside = readFileSync('src/components/desktop/navigation/AsideMenu.vue', 'utf8');
    const desktopStorage = readFileSync(
      'src/components/desktop/navigation/StorageUsage.vue',
      'utf8',
    );

    expect(`${desktopAside}\n${desktopStorage}`).toContain('{{ storageUsagePercentage }}%');
  });
});
