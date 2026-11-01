/** Message of a failure, or `fallback` when it carries none the user can read. */
export function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}
