# Development Progress

**Current phase:** 5 of 8 complete. Next: Phase 6.

## Phases 1-4: done
Foundation and demo mode; core ledger; debts, installments and bills; smart capture (Catat Cepat, OCR, imports, inbox, rules, matching). See git history.

## Phase 5: done (`feat: implement cash flow forecasting`)
- **Forecast engine** (pure, deterministic): daily projection for 1/3/6/12 months from today's actual cash, recurring income, unpaid installments, bills and habitual spending. Opening and closing reconcile day by day and month by month.
- **/forecast page:** summary cards (cash now, projected closing, lowest balance, negative days), **"Cukup sampai gajian?"** with safe-to-spend per day, deficit periods with suggestions, chart (solid actual vs dashed projection, today marker, lowest-point marker), scenario comparison, assumptions and sources, monthly projection table with surplus/deficit status, financial calendar (month grid with events and projected end-of-day balance), collapsible daily detail.
- **Scenarios:** baseline, conservative, optimistic, custom (income %, spending %, bills %, delay days, cash buffer), payday rule or manual date; save, re-open and delete named scenarios (migration `0005_forecast_scenarios.sql`).
- **Data-quality warnings** shown next to the numbers: no income rules, no/short spending history, pending inbox items not counted, bills with unknown amounts, overdue obligations, income treated as already received.
- Dashboard "Proyeksi 30 hari" card; demo data now includes a fictional monthly salary.

## Verification (Linux sandbox, Node 22)
- `npm run typecheck`, `npm run lint`, `npm run build`: clean.
- `npm test`: **280 tests passing** across 15 files (53 new: 37 engine, 16 data layer).
- Browser E2E (Playwright/Chromium, clean database): empty-state warnings; payday analysis matches a hand calculation (lowest Rp 4.025.000, safe Rp 1.037.500/day); every monthly row reconciles and chains; chart shows a solid and a dashed line; conservative < baseline < optimistic; custom assumptions via form/URL; scenario save/re-open/delete; hostile URL parameters handled; manual payday beyond the display horizon; calendar with salary, installment and bill plus month navigation; low cash produces a deficit from the right day, "Tidak cukup", shortfall and a deficit period; paying an installment removes it from the forecast (Rp 672.000 -> Rp 448.000); viewing forecasts writes nothing (row counts unchanged); dashboard card; persistence after restart; demo mode; dark mode and mobile screenshots.
- Zero non-localhost requests and zero page errors during the E2E run.
- Real upgrade 4 -> 5 on a populated on-disk database: data intact, new index present, pre-migration backup created, forecast immediately used the existing salary rule.

## Not yet verified / known limitations
- Windows CMD with a real `npm install` has not been run.
- Accuracy depends on history: with a few weeks of data the habitual-spending average is rough (the page warns below 14 days). It cannot anticipate large one-off expenses, seasonality, or income that has no recurring rule.
- Income occurrences are matched to money already received with a 5-day / 15% rule; unusual patterns (split salaries, very irregular freelance income) can still be double counted or missed. Phase 7 adds "missing income confirmation".
- Mobile layout of the forecast page was captured but not reviewed in detail; the monthly table scrolls horizontally on narrow screens.
- Interest or fees on overdue installments are not projected (only the unpaid remainder).
