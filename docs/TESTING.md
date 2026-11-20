# Pengujian

## Perintah
| Perintah | Isi |
|---|---|
| `npm run typecheck` | TypeScript strict |
| `npm run lint` | ESLint (Next) |
| `npm test` | **471 tes** unit/integrasi (Vitest) di 25 berkas |
| `npm run check:offline` | memindai `src/` untuk URL eksternal |
| `npm run test:e2e` | **60 skenario** end-to-end (Playwright + Chromium) pada build produksi |
| `npm run verify:offline` | (Linux) seluruh E2E di namespace jaringan tanpa internet/DNS |
| `npm run test:all` | typecheck, lint, tes unit, scan offline, build, E2E |

## Tes unit/integrasi (`tests/`)
Perhitungan murni (jadwal cicilan, mesin proyeksi, simulator pelunasan, strategi, mesin langkah berikutnya, parser/OCR/CSV/PDF/XLSX), aturan buku besar (saldo, transfer, rekonsiliasi, pembatalan, tanpa tanggal masa depan), alokasi pembayaran, laporan yang **harus cocok dengan buku besar**, otomasi berulang (idempoten), anggaran, target, AI lokal terhadap server Ollama tiruan, keamanan (hash, token, lockout, gagal-tertutup), cadangan/pemulihan di disk (termasuk rollback dan path traversal), pemeriksaan integritas (dengan injeksi kerusakan), dan migrasi (naik dari skema lama, checksum). `tests/perf.test.ts` membuat 25.000 transaksi dan memeriksa waktu kueri serta rencana kueri (tanpa pemindaian tabel penuh).

## E2E (`e2e/`)
Dijalankan terhadap **build produksi** di port 3100 dengan folder data sementara (`%TEMP%\pfos-e2e-data`), jadi **tidak menyentuh data asli**. Berkas bernomor dijalankan berurutan pada satu basis data (satu worker); **jalankan seluruh suite**, jangan sebagian, karena skenario berikutnya memakai akun/utang dari yang sebelumnya.

1. smoke (semua halaman, navigasi, 404) 2. buku besar 3. utang & tagihan 4. Catat Cepat, impor CSV, OCR 5. proyeksi & simulasi pelunasan 6. otomasi, anggaran, langkah berikutnya, target 7. laporan & ekspor 8. cadangan/pemulihan/integritas 9. mode demo 10. aksesibilitas (axe, tema terang & gelap) dan tata letak ponsel 11. keamanan PIN (termasuk memutar ulang server action tanpa sesi).

Fixture otomatis: **tiap tes gagal** bila ada permintaan keluar dari `localhost` atau error halaman yang tak tertangkap.

Variabel: `PW_CHROMIUM_PATH` (pakai Chromium yang sudah terpasang), `E2E_SKIP_BUILD=1` (pakai build yang ada), `E2E_DATA_DIR`, `PW_NO_SANDBOX=1` (hanya di dalam namespace "root" palsu). Pertama kali: `npx playwright install chromium`.

## Yang dibuktikan dan yang tidak
Terbukti (Linux, Node 22): semua tes di atas lulus; seluruh E2E lulus **tanpa jaringan**; upgrade skema nyata dari basis data lama; angka laporan = buku besar; PIN ditegakkan di server.
**Belum terbukti:** Windows sungguhan, Ollama asli, mutasi/screenshot/foto nyata (hanya fixture fiktif), akurasi OCR pada foto berderau, browser selain Chromium.

## Bug yang ditemukan lewat pengujian (ringkas)
Lihat `DEVELOPMENT_PROGRESS.md`. Contoh penting Fase 8: verifikasi PIN menerima hash kosong; "Tautkan" jadwal berulang tak pernah berhasil di UI (lolos palsu di uji manual sebelumnya); indeks yang kurang; kontras warna dan kalender tanpa semantik ARIA yang benar; dasbor melebar di ponsel.
