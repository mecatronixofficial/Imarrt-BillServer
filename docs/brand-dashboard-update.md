# Imarrt branding, navigation and dashboard — 2 November 2026

The frontend in `../../Imarrt Bill Ui/Imarrt-BillUi` now uses the public Imarrt website's palette: yellow `#F8E22A`, charcoal `#111111` / `#1E1E1E`, cream `#FFF8D6`, and green `#2B7A2B`. Status colors remain meaningful for payments, errors and warnings.

The shared toolbar provides a labeled Back button. Settings has its own desktop Back control because that layout hides the normal toolbar; smaller screens use the shared toolbar. Fullscreen invoice/document editors have labeled Back controls and retain their existing busy/close handlers. In-app navigation returns through browser history; directly opened pages have parent-page fallbacks, using replacement navigation to avoid a back-navigation cycle.

The dashboard includes financial summary cards, recent invoices, overdue and stock alerts, report shortcuts, and two chart panels. Sales/purchase charts switch between area and bar modes and support metric selection, date ranges, keyboard exploration and a data table. The expense chart groups actual recorded general expenses and production costs. Dates and monetary totals use existing billing/report helpers; sales and purchase returns are included in the trend totals. All-time trends include the earliest recorded activity rather than only the current month. Loading and error states are visible above the detailed overview.

The existing production/detailed dashboard remains available. This update requires no additional database migration.

The frontend production build includes lint and TypeScript validation. Eleven frontend regression tests pass, including chart/date/return reconciliation. The browser results and screenshots are recorded under the frontend's `docs/brand-verification.json` and `.work/brand-final-qa`. Browser verification uses isolated fixtures and blocks business-data writes.

All 82 final browser checks passed: visible and clickable Back controls on 45 pages, eight screen widths, chart mode/metric/date controls, brand-color checks, settings return navigation, repeated direct-link fallbacks, overdue filtering, and keyboard chart exploration. No browser errors or live business-data writes occurred.
