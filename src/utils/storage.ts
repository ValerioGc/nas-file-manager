export function calculateUsagePercentage(used: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((used / total) * 100)));
}

export function formatStorageBytes(value: number) {
  if (value < 1_000_000_000) {
    return `${Math.round(value / 1_000_000)} MB`;
  }

  return `${Math.round(value / 1_000_000_000)} GB`;
}
