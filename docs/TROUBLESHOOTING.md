# Pemecahan masalah

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| `npm install` gagal di `better-sqlite3` (`No prebuilt binaries found`, `gyp ERR! find VS`) | versi Node tidak didukung (Node 20 atau lebih lama, atau 25+) atau instalasi ke folder yang dikunci OneDrive/antivirus | pakai Node **22 LTS atau 24** x64 (`node -v`); pasang di jalur pendek seperti `C:\personal-finance-os`; hapus `node_modules` lalu ulangi; terakhir: Visual Studio Build Tools |
| `EADDRINUSE` / port 3000 dipakai | ada aplikasi lain atau instans lama | tutup yang lama, atau `node node_modules\next\dist\bin\next start -H localhost -p 3001` |
| Halaman "Aplikasi terkunci" | PIN aktif dan sesi habis (12 jam) / dikeluarkan | masukkan PIN. Lupa PIN: tutup aplikasi, hapus `data\auth.json` (data tetap aman) |
| "Terlalu banyak percobaan" | 5+ PIN salah | tunggu waktu yang ditampilkan (30 dtk sampai 15 mnt), atau hapus `data\auth.json` jika Anda yakin pemiliknya |
| `database is locked` / `SQLITE_BUSY` | dua instans memakai `data\finance.db` | jalankan hanya satu instans aplikasi per folder data |
| "Basis data dibuat versi yang lebih baru" | berkas dari aplikasi versi lebih tinggi | pakai aplikasi versi yang sama atau lebih baru; jangan menurunkan versi |
| Pemeriksaan awal menemukan masalah (banner merah) | berkas rusak (mis. listrik mati saat menulis, disk bermasalah) | buka Cadangan & Kesehatan Data → Periksa integritas → pulihkan cadangan terakhir yang sehat |
| Pemulihan ditolak | cadangan rusak/terlalu baru/migrasi berbeda | pilih cadangan lain; pesan menyebut alasannya. Tidak ada yang berubah saat ditolak |
| Tombol cadangan nonaktif | sedang mode demo | Pengaturan → Kembali ke data pribadi |
| OCR lama saat pertama kali | model bahasa dimuat sekali per sesi | wajar (puluhan detik); OCR berjalan di komputer ini tanpa internet. Gambar yang sangat buram hasilnya tak akurat: periksa di Kotak Masuk sebelum menyetujui |
| Impor ditolak "sudah pernah diimpor" | berkas yang sama (isi identik) sudah diimpor | memang disengaja (cegah duplikat); ubah isi atau lihat batch di Riwayat |
| Item inbox tak bisa disetujui | belum ada akun/kategori, tanggal di masa depan | lengkapi di baris itu; transaksi tidak boleh bertanggal di masa depan |
| Tanggal "hari ini" salah | jam/zona waktu komputer | aplikasi memakai WIB (Asia/Jakarta) dari jam sistem; periksa jam Windows |
| Tombol "Baca dengan AI lokal" tidak ada | AI nonaktif (default) | Pengaturan → AI lokal. Pastikan Ollama berjalan di komputer ini dan modelnya terpasang (Tes koneksi) |
| AI gagal, hasil dari pembaca bawaan | Ollama tidak aktif / lambat / jawaban tidak valid | wajar: aplikasi otomatis memakai pembaca bawaan dan memberi tahu |
| Grafik kosong | belum ada data pada periode itu | pilih periode lebih panjang, atau catat transaksi |
| Layar putih setelah pembaruan | build lama | `npm run build` ulang, lalu `npm start` |

## Mengatur ulang tanpa kehilangan data
Jangan menghapus `data\finance.db`. Untuk memulai dari nol, **buat cadangan dulu**, lalu hapus `data\finance.db` (aplikasi membuat yang baru). Demo: Pengaturan → Atur ulang data demo.

## Mengumpulkan informasi untuk bantuan
- `http://localhost:3000/api/health` menampilkan profil dan versi skema (saat tidak terkunci).
- Log server ada di jendela CMD tempat `npm start` berjalan; jangan membagikan isinya jika memuat data pribadi.
