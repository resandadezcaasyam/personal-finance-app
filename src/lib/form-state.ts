/**
 * The general message of a failed form action, or undefined when there is nothing to add. It is hidden only when the same
 * text is already shown under a field, so a failure can never be silent (e.g. an error on a field the form does not render).
 */
export function bannerMessage(s: { ok: boolean; message?: string; errors?: Record<string, string> }): string | undefined {
  if (s.ok || !s.message) return undefined;
  return Object.values(s.errors ?? {}).includes(s.message) ? undefined : s.message;
}
