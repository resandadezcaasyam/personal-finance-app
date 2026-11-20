import path from "node:path";

/** Where all local data lives. Override with FINANCE_DATA_DIR (used by the end-to-end tests). */
export const dataDir = () => path.resolve(process.env.FINANCE_DATA_DIR ?? path.join(process.cwd(), "data"));
export const backupDir = () => path.join(dataDir(), "backups");
