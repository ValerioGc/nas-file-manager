// Slash trimming without regular expressions: `/\/+$/` backtracks on long runs of slashes.

export function trimTrailingSlashes(path: string) {
  let end = path.length;
  while (end > 0 && path[end - 1] === '/') {
    end -= 1;
  }
  return path.slice(0, end);
}

export function trimSlashes(path: string) {
  let start = 0;
  while (start < path.length && path[start] === '/') {
    start += 1;
  }
  return trimTrailingSlashes(path.slice(start));
}
