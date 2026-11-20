# Personal Finance OS

Aplikasi keuangan pribadi yang **privat dan berjalan lokal**. Semua data tersimpan di komputer Anda (SQLite). Tidak memerlukan internet setelah instalasi.

**Status:** Fase 1 dari 8 selesai (fondasi, database, kerangka UI). Lihat `docs/DEVELOPMENT_PROGRESS.md`.

## Instalasi (Windows CMD)

Prasyarat: [Node.js](https://nodejs.org) 20 atau lebih baru (LTS) dan Git.

```bat
git clone https://github.com/resandadezcaasyam/personal-finance-os.git
cd personal-finance-os
npm install
npm run dev
```

Buka http://localhost:3000.

Mode produksi lokal:

```bat
npm run build
npm start
```

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Server pengembangan di localhost:3000 |
| `npm run build` / `npm start` | Build dan jalankan versi produksi |
| `npm test` | Unit test |
| `npm run typecheck` | Pemeriksaan TypeScript |
| `npm run lint` | ESLint |
| `npm run check:offline` | Memastikan tidak ada URL eksternal di kode |

## Data

- Database pribadi: `data\finance.db` (dibuat otomatis, tidak masuk Git).
- Mode demo: `data\demo.db` (data fiktif, aktifkan di Pengaturan).
- Cadangan otomatis sebelum migrasi: `data\backups\`.
- Cadangan manual: tutup aplikasi, lalu `copy data\finance.db data\backups\finance-manual.bak`.

## Troubleshooting

- **`npm install` gagal pada `better-sqlite3`:** modul ini memakai binary siap pakai untuk Windows. Jika gagal diunduh, install "Desktop development with C++" dari Visual Studio Build Tools lalu jalankan `npm install` lagi.
- **Port 3000 terpakai:** tutup aplikasi lain yang memakai port tersebut, atau cek dengan `netstat -ano | findstr :3000`.
- **Database terkunci:** pastikan hanya satu server aplikasi yang berjalan.

## Dokumentasi

`docs/PRODUCT_REQUIREMENTS.md` · `docs/ARCHITECTURE.md` · `docs/DEVELOPMENT_PROGRESS.md` · `docs/DECISIONS.md` · `docs/NEXT_PHASE.md`

## Keamanan Git

`.gitignore` mengecualikan database, cadangan, unggahan, ekspor, dan berkas `.env`. Jangan pernah meng-commit data keuangan asli.
