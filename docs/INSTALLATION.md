# Instalasi (Windows CMD)

> **Catatan jujur:** seluruh pengembangan dan pengujian dilakukan di Linux (Node 22). Langkah Windows di bawah adalah yang diharapkan berfungsi, tetapi **belum dijalankan di Windows sungguhan**. Jika ada kendala, lihat `TROUBLESHOOTING.md`.

## Prasyarat
- Windows 10/11 64-bit.
- **Node.js LTS** (versi 20 atau 22) dari <https://nodejs.org>. Cek di Command Prompt: `node -v` dan `npm -v`.
- Koneksi internet **hanya** saat `npm install`. Setelah itu aplikasi berjalan sepenuhnya offline (termasuk OCR; data bahasa Indonesia/Inggris ikut terpasang lewat npm).

## Pasang dan jalankan
```bat
cd C:\personal-finance-os
npm install
npm run build
npm start
```
Buka **http://localhost:3000**. Aplikasi hanya mendengarkan di `localhost`, jadi tidak terlihat dari perangkat lain.

Mode pengembangan (lebih lambat, memantau perubahan kode): `npm run dev`.

`better-sqlite3` biasanya terpasang dari berkas biner siap pakai. Jika `npm install` gagal membangunnya, pasang *Visual Studio Build Tools* (beban kerja "Desktop development with C++") lalu ulangi.

## Lokasi data
Semua data ada di folder `data\` di dalam proyek:

| Berkas | Isi |
|---|---|
| `data\finance.db` | data keuangan pribadi (SQLite) |
| `data\demo.db` | data demo fiktif (dibuat saat mode demo dipakai) |
| `data\backups\` | cadangan (manual, sebelum pemulihan, sebelum pembaruan skema) |
| `data\auth.json` | PIN (hash) bila diaktifkan |
| `data\active-profile.json` | profil aktif (pribadi/demo) |

Folder `data` **tidak masuk git**. Untuk menyimpan data di tempat lain:
```bat
set FINANCE_DATA_DIR=D:\FinanceData
npm start
```
(setel variabel yang sama setiap kali menjalankan aplikasi).

## Port 3000 sudah dipakai
```bat
node node_modules\next\dist\bin\next start -H localhost -p 3001
```

## Memperbarui versi
1. Buka **Cadangan & Kesehatan Data** dan buat cadangan. Salin satu berkas cadangan ke tempat lain.
2. Hentikan aplikasi (Ctrl+C).
3. Ganti berkas proyek dengan versi baru, **kecuali folder `data`**.
4. `npm install`, lalu `npm run build`, lalu `npm start`.

Skema basis data diperbarui otomatis. Sebelum tiap pembaruan skema, aplikasi menyimpan salinan `finance.db.pre-migration-...bak` di `data\backups`. Migrasi lama tidak pernah diubah (dijaga checksum); aplikasi menolak membuka basis data yang dibuat versi yang lebih baru.

## Memindahkan ke komputer lain
Buat cadangan, salin berkasnya, pasang aplikasi di komputer baru, letakkan berkas cadangan di `data\backups\` (nama harus berakhiran `.db`, huruf/angka/`.`/`-`/`_` saja), buka **Cadangan & Kesehatan Data**, periksa, lalu **Pulihkan**. Detail di `BACKUP_RESTORE.md`.

## Menghapus
Hapus folder proyek. **Folder `data` ikut terhapus**: salin dulu bila masih diperlukan.
