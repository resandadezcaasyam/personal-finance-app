import type Database from "better-sqlite3";

/** Fictional records only. Lives in demo.db, never in the personal database. */
export function seedDemo(db: Database.Database) {
  db.transaction(() => {
    const acc = db.prepare("INSERT INTO accounts (name, type, initial_balance, sort_order) VALUES (?,?,?,?)");
    acc.run("Demo Bank", "bank", 5_000_000, 1);
    acc.run("Demo Dompet Digital", "ewallet", 350_000, 2);
    acc.run("Demo Tunai", "cash", 200_000, 3);
    const cat = db.prepare("INSERT INTO categories (name, kind) VALUES (?, ?)");
    for (const n of ["Makanan", "Transportasi", "Tagihan", "Hiburan"]) cat.run(n, "expense");
    for (const n of ["Gaji", "Lainnya"]) cat.run(n, "income");
    db.prepare("INSERT INTO settings (key, value) VALUES ('demo_seeded','1')").run();
  })();
}
