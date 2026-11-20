/** A user-correctable problem (validation, business rule). Messages are shown in the UI as-is. */
export class LedgerError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = "LedgerError";
  }
}
