const formatSize = (size: number | null) => {
  if (size === null) {
    return '-';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${Math.round(size / (1024 * 1024))} MB`;
};

export default formatSize;
