import type Database from "better-sqlite3";

export function writeAudit(db: Database.Database, entity: string, entityId: number | null, action: string, before: unknown, after: unknown) {
  db.prepare("INSERT INTO audit_logs (entity, entity_id, action, before_json, after_json) VALUES (?,?,?,?,?)").run(
    entity,
    entityId,
    action,
    before === undefined || before === null ? null : JSON.stringify(before),
    after === undefined || after === null ? null : JSON.stringify(after),
  );
}
