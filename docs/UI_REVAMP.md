# UI/UX revamp (Stage 1–6)

Revamp visual saja. Tidak ada perubahan pada logika bisnis, perhitungan keuangan, skema/migrasi database, API, atau server action
(selisih terhadap `pre-ui-revamp` untuk `src/lib`, `src/app/actions`, `src/app/api` hanya menyentuh tiga helper tampilan: `src/lib/nav.ts`, `format.ts`
dan `chart-colors.ts`). Aplikasi tetap lokal dan offline: font Inter dipasang lewat paket npm,
tanpa CDN.

## Arah desain
Fintech modern berlapis: latar netral berpendar biru-cyan, kartu kaca (translusen + blur), bayangan lembut bernuansa biru, dan
gradien biru→cyan pada elemen penting. Warna **semantik** tetap bermakna keuangan: hijau (masuk/sehat), merah (keluar/defisit),
kuning (peringatan). Biru hanya warna merek.

## Token (`src/app/globals.css`, `tailwind.config.ts`)
| Token | Terang | Gelap |
|---|---|---|
| `--brand` (isian) | `#155DFC` | `#60A5FA` |
| `--brand-text` (teks biru) | `#1D4ED8` | `#60A5FA` |
| `--bg` / `--surface` / `--line` | `#F8FAFC` / `#FFFFFF` / `#E2E8F0` | `#080E1C` / `#101A2E` / `#22304A` |
| `--muted` | `#526077` | `#94A3B8` |
| `--grad-accent` (tanpa teks) | `#2563EB → #3B82F6 → #06B6D4` (135°) | `#3B82F6 → #60A5FA → #22D3EE` |
| `--grad-fill` (membawa teks) | `#1D4ED8 → #2563EB → #0B7C9A` | sama dengan `--grad-accent` + teks navy |

**Mengapa dua gradien?** Teks putih di atas `#3B82F6` hanya 3,7:1 dan di atas `#06B6D4` 2,4:1 (di bawah WCAG AA 4,5:1). Gradien
persis dari brief dipakai untuk elemen tanpa teks (indikator menu aktif, isian progres, aksen grafik, donat). Permukaan yang
memuat teks (tombol utama, kartu sorotan, ikon KPI) memakai `--grad-fill`: teks putih ≥ 4,8:1 pada setiap titik di tema terang;
di tema gelap gradien cerah memakai teks navy `--brand-ink` (≥ 5:1). Kartu sorotan memakai `text-brand-ink` agar benar di
kedua tema.

Warna teks hijau/merah/kuning satu tingkat lebih gelap dari palet murni agar lolos AA; `--warn-fill` dipakai untuk ikon/grafik.

## Kartu kaca
Aturan tunggal di `globals.css` (`@layer components`) berlaku untuk setiap elemen `rounded-card bg-surface`: isian translusen
(`--glass-alpha`), `backdrop-filter: blur(14px) saturate(1.3)`, sorotan tepi atas, bayangan berlapis, dan hover lembut. Warna
border tetap dari utilitas, jadi keadaan (merah/biru) tetap menang. Kartu interaktif (akun, utang, target, KPI) terangkat 2px saat
hover; `prefers-reduced-motion` mematikan transisi. Hanya kartu yang diblur, bukan baris tabel, agar performa tetap baik.

## Komponen yang diubah
`ui/button` (gradien + glow), `ui/card`, `ui/progress`, `ui/dialog` (kaca), `ui/form-field` (fokus berpendar), `ui/tab-nav`,
`layout/app-shell` (sidebar dan topbar kaca, logo dan indikator gradien), `dashboard/*` (KPI, sorotan, grafik tren),
`ledger/*`, `debts/debt-cards`, `settings/settings-section`, grafik (palet `src/lib/chart-colors.ts`, gradien SVG).

## Verifikasi (Stage 6)
- `npm run test:all` : typecheck, lint, 471 tes unit, scan offline, build, E2E.
- `npm run verify:offline` (Linux): seluruh E2E dalam namespace tanpa internet/DNS.
- E2E mencakup: semua rute, alur formulir dan dialog (akun, transaksi, utang, tagihan, impor, otomasi, anggaran, target, simulasi,
  cadangan/pemulihan, PIN), axe WCAG 2 A/AA tema terang dan gelap, kunci keyboard, dan tidak ada luapan horizontal di ponsel,
  tablet, dan laptop (lihat `e2e/10-a11y-responsive.spec.ts`).
- Tidak ada permintaan jaringan keluar: tiap tes E2E gagal bila ada.

## Batas yang diketahui
- axe tidak bisa menghitung kontras teks di atas **gradien**; kontras permukaan bergradien dihitung manual (angka di atas).
- `backdrop-filter` tidak didukung browser yang sangat lama; kartu tetap terbaca (isian translusen 72–80%).
- Belum dicoba di Windows, dan hanya Chromium yang dicakup E2E.
