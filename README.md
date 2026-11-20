# Personal Finance OS

Aplikasi keuangan pribadi yang **privat dan berjalan lokal**. Semua data tersimpan di komputer Anda (SQLite). Tidak memerlukan internet setelah instalasi.

**Status:** Fase 5 dari 8 selesai (ledger, utang/tagihan, pencatatan cerdas, dan proyeksi arus kas). Lihat `docs/DEVELOPMENT_PROGRESS.md`.

## Fitur yang sudah tersedia

- **Akun & Saldo:** tambah/ubah/arsipkan akun (Tunai, Bank, E-wallet), rekonsiliasi saldo. Saldo dihitung dari ledger, bukan disimpan.
- **Transaksi:** catat, ubah, batalkan; cari, filter, urutkan, rentang tanggal. Nominal boleh ditulis `25rb`, `9,5jt`, atau `1.250.000`.
- **Transfer** antar akun (tidak dihitung sebagai pemasukan/pengeluaran), biaya admin opsional.
- **Pemasukan** (termasuk konfigurasi pemasukan berulang) dan **Pengeluaran** (grafik per kategori).
- **Dasbor** dengan total kas, pemasukan/pengeluaran bulan ini, saldo akun, dan transaksi terbaru.
- **Utang & Cicilan:** jadwal otomatis (tanpa bunga, flat, menurun/anuitas, atau manual), pembayaran penuh/sebagian/terlambat (denda)/dipercepat/pelunasan, ringkasan kewajiban, jadwal bulanan, dan kalender.
- **Tagihan & Langganan:** listrik, internet, sewa, langganan, dll. Bayar (tercatat sebagai satu pengeluaran), lewati, batalkan, dan lihat riwayat. Nominal boleh berubah tiap periode.
- **Catat Cepat:** ketik `kopi 25rb gopay` atau `gaji masuk 9.5jt seabank`; beberapa transaksi sekaligus, pratinjau yang bisa diedit, template favorit. Dibaca offline.
- **Pusat Impor:** screenshot/foto struk (OCR offline, bisa banyak sekaligus) dan mutasi CSV, XLSX, atau PDF (termasuk PDF hasil pindai). Pemetaan kolom bisa disimpan sebagai template.
- **Kotak Masuk Pintar:** semua hasil impor/OCR berhenti di sini dulu. Tinjau, ubah, setujui massal. Hanya yang disetujui memengaruhi saldo. Duplikat ditandai, dan pembayaran yang cocok dengan cicilan, tagihan, atau transfer antar akun dicatat dengan benar (tanpa pengeluaran ganda).
- **Aturan merchant:** 90+ aturan bawaan (Fore Coffee → Kopi, PLN → Listrik, Netflix → Langganan) dan aturan buatan Anda dari koreksi kategori.
- **Proyeksi Arus Kas:** perkiraan saldo harian untuk 1, 3, 6, atau 12 bulan dari saldo sekarang, pemasukan berulang, cicilan yang belum dibayar, tagihan, dan kebiasaan belanja. Ada analisis "cukup sampai gajian?" lengkap dengan batas belanja aman per hari, saldo terendah, periode defisit, skenario baseline/konservatif/optimis/kustom yang bisa disimpan, grafik (garis padat = aktual, putus-putus = proyeksi), tabel bulanan, dan kalender keuangan. Semua angka proyeksi diberi label dan tidak mengubah saldo Anda.
- **Mode demo** dengan data fiktif terpisah, dan manajemen kategori di Pengaturan.

Catatan: transaksi tidak boleh bertanggal di masa depan. Jadwal cicilan dan tagihan adalah rencana, bukan pembayaran: saldo baru berubah saat Anda mencatat pembayaran. Rumus bunga adalah konvensi umum; jika berbeda dari kontrak penyedia, gunakan jadwal manual.

## Catatan proyeksi

Proyeksi membutuhkan: pemasukan berulang (halaman Pemasukan, mis. gaji tiap tanggal 25), tagihan dan cicilan yang sudah dicatat, dan riwayat pengeluaran (makin panjang makin akurat). Halaman ini menampilkan peringatan bila data kurang. Proyeksi adalah perkiraan, bukan jaminan: pengeluaran besar yang tidak rutin tidak bisa diantisipasi.

## Catatan OCR dan PDF

Data bahasa OCR (Indonesia dan Inggris, sekitar 20 MB) dan pustaka PDF ikut terpasang saat `npm install`. Setelah itu semuanya berjalan **tanpa internet**: OCR memakai WebAssembly, jadi tidak ada kompilasi tambahan di Windows. Gambar struk tidak disimpan; hanya hash dan teks hasil bacaan. Akurasi OCR pada foto yang buram atau miring lebih rendah, karena itu hasil yang meragukan selalu masuk ke "Perlu ditinjau". Format bank tertentu belum dijamin: periksa pemetaan kolom pada impor pertama lalu simpan sebagai template.

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
