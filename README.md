# Personal Finance OS

Aplikasi keuangan pribadi yang **privat dan berjalan lokal**. Semua data tersimpan di komputer Anda (SQLite). Tidak memerlukan internet setelah instalasi.

**Status:** Fase 2 dari 8 selesai (ledger inti: akun, pemasukan, pengeluaran, transfer, rekonsiliasi, dasbor). Lihat `docs/DEVELOPMENT_PROGRESS.md`.

## Fitur yang sudah tersedia

- **Akun & Saldo:** tambah/ubah/arsipkan akun (Tunai, Bank, E-wallet), rekonsiliasi saldo. Saldo dihitung dari ledger, bukan disimpan.
- **Transaksi:** catat, ubah, batalkan; cari, filter, urutkan, rentang tanggal. Nominal boleh ditulis `25rb`, `9,5jt`, atau `1.250.000`.
- **Transfer** antar akun (tidak dihitung sebagai pemasukan/pengeluaran), biaya admin opsional.
- **Pemasukan** (termasuk konfigurasi pemasukan berulang) dan **Pengeluaran** (grafik per kategori).
- **Dasbor** dengan total kas, pemasukan/pengeluaran bulan ini, saldo akun, dan transaksi terbaru.
- **Mode demo** dengan data fiktif terpisah, dan manajemen kategori di Pengaturan.

Catatan: transaksi tidak boleh bertanggal di masa depan. Tagihan dan cicilan terjadwal hadir di Fase 3.

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
- Cadangan otomatis sebelum migrasi skema: `data\backups\`. Saat memperbarui dari Fase 1 ke Fase 2, periksa folder ini: berkas `.bak` akan dibuat otomatis.
- Cadangan manual: tutup aplikasi, lalu `copy data\finance.db data\backups\finance-manual.bak`.

## Troubleshooting

- **`npm install` gagal pada `better-sqlite3`:** modul ini memakai binary siap pakai untuk Windows. Jika gagal diunduh, install "Desktop development with C++" dari Visual Studio Build Tools lalu jalankan `npm install` lagi.
- **Port 3000 terpakai:** tutup aplikasi lain yang memakai port tersebut, atau cek dengan `netstat -ano | findstr :3000`.
- **Database terkunci:** pastikan hanya satu server aplikasi yang berjalan.

## Dokumentasi

`docs/PRODUCT_REQUIREMENTS.md` · `docs/ARCHITECTURE.md` · `docs/DEVELOPMENT_PROGRESS.md` · `docs/DECISIONS.md` · `docs/NEXT_PHASE.md`

## Keamanan Git

`.gitignore` mengecualikan database, cadangan, unggahan, ekspor, dan berkas `.env`. Jangan pernah meng-commit data keuangan asli.
