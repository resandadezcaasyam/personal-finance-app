# Cadangan dan pemulihan

Menu: **Cadangan & Kesehatan Data**.

## Membuat cadangan
Tekan **Buat cadangan sekarang**. Berkas `finance-<tanggal>_<jam>-manual.db` dibuat di `data\backups\` dengan `VACUUM INTO`: salinan lengkap yang konsisten, aman dibuat saat aplikasi dipakai (menyalin langsung `finance.db` saat berjalan **tidak** aman karena mode WAL).

Cadangan berisi **seluruh data keuangan Anda tanpa enkripsi**. Simpan salinannya di tempat aman (flash disk, penyimpanan terenkripsi). Ikon ↓ mengunduh berkas ke folder lain.

Aplikasi mengingatkan di *Langkah Keuangan Berikutnya* jika ada ≥ 10 transaksi dan belum ada cadangan dalam 30 hari.

## Jenis berkas di `data\backups`
| Nama | Dibuat saat |
|---|---|
| `finance-...-manual.db` | Anda menekan "Buat cadangan" |
| `finance-...-pre-restore.db` | otomatis, tepat sebelum pemulihan |
| `finance.db.pre-migration-...bak` | otomatis, sebelum pembaruan skema |

## Memeriksa cadangan
Ikon perisai membuka cadangan **hanya-baca** dan memeriksa: struktur berkas (`integrity_check`), keterkaitan data, bahwa ini basis data aplikasi ini, bahwa skemanya tidak lebih baru dari aplikasi, dan bahwa migrasinya tidak berbeda dari aplikasi.

## Memulihkan
1. Pilih cadangan, tekan ikon pulihkan, baca penjelasannya, lalu **Ya, pulihkan**.
2. Aplikasi memeriksa cadangan. Jika rusak atau terlalu baru, pemulihan **dibatalkan tanpa mengubah apa pun**.
3. Kondisi sekarang disimpan sebagai cadangan `pre-restore`.
4. Basis data diganti, dibuka ulang, dan (jika cadangan lebih lama) skemanya dinaikkan otomatis.
5. Jika langkah 4 gagal, data semula dikembalikan otomatis dan pesan galat ditampilkan.

Mau membatalkan pemulihan? Pulihkan cadangan `pre-restore` yang baru dibuat.

Pemulihan hanya untuk **data pribadi**; saat mode demo aktif tombolnya dinonaktifkan. PIN (`auth.json`) **tidak** berubah oleh pemulihan.

## Memulihkan cadangan dari komputer lain / berkas manual
Letakkan berkas `.db` di `data\backups\` (nama: huruf, angka, `.`, `-`, `_`, berakhiran `.db` atau `.bak`; tanpa spasi), muat ulang halaman, lalu periksa dan pulihkan seperti biasa. Aplikasi sengaja tidak menerima jalur berkas dari browser (mencegah akses ke berkas lain).

## Salinan manual tanpa tombol (tidak disarankan)
Hentikan aplikasi dulu, lalu salin `data\finance.db` (dan jika ada, `finance.db-wal`, `finance.db-shm`) bersama-sama.

## Ekspor semua data
**Ekspor semua data (JSON)** menghasilkan seluruh tabel dalam satu berkas JSON yang bisa dibaca manusia, untuk arsip atau berpindah alat. Ini bukan pengganti cadangan basis data untuk pemulihan.

## Kesehatan data
**Periksa integritas** menjalankan: struktur SQLite, keterkaitan antar data, nominal terbayar tiap cicilan = riwayat pembayaran, tiap pembayaran utang/tagihan punya pengeluaran yang sesuai di buku besar, dana tiap target tabungan = catatannya, dan jadwal berulang yang dikonfirmasi menunjuk transaksi yang ada. Hanya membaca. Jika ada yang gagal, jangan panik: catat pesannya, buat cadangan, dan pertimbangkan memulihkan cadangan terakhir yang sehat.
