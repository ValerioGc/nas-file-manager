// Trimmed without regular expressions, since `/\/+$/` backtracks on long runs of slashes.
export function trimTrailingSlashes(path: string) {
  let end = path.length;
  while (end > 0 && path[end - 1] === '/') {
    end -= 1;
  }
  return path.slice(0, end);
}

/** UI path as the backend reads it, without leading separators. */
export function toBackendPath(path: string) {
  return path.replace(/^[/\\]+/, '');
}

export function toUiPath(path: string) {
  return `/${toBackendPath(path)}`;
}
