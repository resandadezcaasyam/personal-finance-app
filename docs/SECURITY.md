# Keamanan dan privasi

## Model ancaman (apa yang dilindungi, apa yang tidak)
Aplikasi ini untuk **satu orang di satu komputer**. Ia melindungi dari:
- orang lain yang membuka aplikasi di komputer Anda yang sedang menyala/tidak terkunci (dengan PIN),
- situs web lain di browser yang sama (hanya `localhost`, pemeriksaan asal permintaan, cookie `SameSite=Strict`),
- data keluar tanpa sepengetahuan Anda (tidak ada telemetri, font/skrip/CDN eksternal, atau analitik; setiap tes E2E gagal bila ada permintaan keluar komputer).

Aplikasi **tidak** melindungi dari orang yang bisa membaca berkas Anda: `data\finance.db`, cadangan, dan ekspor adalah berkas biasa tanpa enkripsi. **PIN bukan enkripsi basis data.** Untuk perlindungan itu gunakan enkripsi disk (mis. BitLocker) dan akun Windows yang diberi kata sandi.

## PIN
- Opsional: Pengaturan → Keamanan (PIN). 4–64 karakter; PIN yang sangat mudah ditebak (`1234`, `0000`, angka berulang) ditolak.
- Disimpan hanya sebagai **hash scrypt** bergaram di `data\auth.json` (di luar basis data, sehingga berpindah profil atau memulihkan cadangan tidak bisa melewati atau menghapusnya).
- Sesi: cookie bertanda tangan HMAC, `HttpOnly`, `SameSite=Strict`, berlaku 12 jam. Mengubah PIN atau "Keluarkan semua sesi" membatalkan semua sesi lain. Tombol gembok di header mengunci segera.
- Percobaan salah: 5 kali bebas, lalu terkunci 30 detik, berlipat ganda hingga maksimal 15 menit; tersimpan di disk sehingga restart tidak mengatur ulang. Selama terkunci, PIN yang benar pun ditolak.
- **Ditegakkan di server, bukan hanya UI:** setiap akses basis data (halaman *dan* server action) gagal-tertutup tanpa sesi, dan rute API (`/api/export`, `/api/backup/download`, `/api/import/*`, `/api/ocr/receipt`) mengembalikan 401. `/api/health` tidak membocorkan apa pun saat terkunci. Ada tes yang memutar ulang server action tanpa sesi dan membuktikan ditolak.
- **Lupa PIN:** tutup aplikasi, hapus `data\auth.json`, jalankan lagi. Data tidak ikut terhapus. (Ini juga berarti siapa pun yang memegang folder data dapat menghapus PIN: lagi-lagi, PIN bukan enkripsi.)

## Data sensitif yang perlu diperhatikan
- `data\finance.db` memuat semua transaksi, juga teks hasil OCR (`inbox_items.raw_payload`).
- Cadangan, ekspor CSV/JSON/PDF memuat data yang sama apa adanya.
- Ekspor CSV menetralkan sel yang diawali `= + - @` agar tidak dijalankan sebagai rumus oleh spreadsheet.

## AI lokal (opsional)
Nonaktif secara default. Jika diaktifkan, alamat harus `http://127.0.0.1` / `localhost` (diperiksa saat menyimpan, memuat, dan sebelum tiap permintaan; redirect ditolak). Yang dikirim hanya kalimat yang Anda ketik dan **nama** akun/kategori, tidak pernah saldo atau riwayat. Keluaran AI divalidasi dan selalu melewati pratinjau yang bisa Anda ubah.

## Praktik yang disarankan
1. Aktifkan PIN dan enkripsi disk jika komputer dipakai bersama.
2. Buat cadangan berkala dan simpan salinannya di media terenkripsi.
3. Jangan membuka aplikasi ke jaringan (jangan mengubah `-H localhost`).
4. Jangan membagikan berkas `data\`, cadangan, atau ekspor.
