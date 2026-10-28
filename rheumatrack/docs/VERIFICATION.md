# Verification report

## v1.1 (27 October 2026) — invitations, sign-in pages, phone sensor, responsive layout

Environment: Ubuntu 24.04 cloud workspace, Node 22.23, Chromium (Playwright) with software WebGL. Run on the code in this repository.

| Check | Result |
|---|---|
| Strict TypeScript (`npm run typecheck`) | **PASSED** — 0 errors |
| Unit + integration tests (`npm test`) | **PASSED** — 169 / 169 (was 135); repeated runs stable |
| — new: invitation lifecycle, clinician-not-found, duplicates, decline, expiry, other clinician blocked, revoke ends access | **PASSED** — 10 tests |
| — new: separate sign-in pages, role-based landing, request access, live role grant, URL protection | **PASSED** — 7 tests |
| — new: sensor maths (long axis, baseline, change, summary, CSV) | **PASSED** — 12 tests |
| — new: sensor page with **simulated** events (unsupported, https, permission denied, no data, baseline failure, record/pause/resume/stop, save, export, listener clean-up, clinician read-only) | **PASSED** — 6 tests |
| Production build (`npm run build`); test harness absent from it | **PASSED** |
| Browser E2E in Chromium (`npm run test:e2e:harness`) | **PASSED** — 11 / 11 (1 emulator-only test skipped), including invite → accept across the two sign-in pages and the sensor page driven by genuine `deviceorientation`/`devicemotion` browser events with simulated values |
| Responsive audit — every page as guest, patient and clinician at 320, 360, 375, 390, 430, 768, 1024, 1280, 1440 px in dark **and** light (396 page loads) | **PASSED** — no horizontal overflow or phone zoom-out, nothing off-screen, no clipped labels, no console errors. Remaining small targets: 24 px checkboxes inside 44 px-tall clickable labels |
| Firestore Security Rules tests (`npm run test:rules`, 30 tests incl. new directory, requests, invites, sensor recordings) | **NOT RUN** — the Firestore emulator download is blocked in this workspace. **Run before deploying the rules.** |
| Phone sensor on a **physical phone** (Android Chrome, iPhone Safari) | **NOT RUN** — no device here. Test on the deployed https site (checklist below) |
| Live site / real Firebase project | **NOT RUN** from here (no access) |

Bugs found and fixed during this round: invitations not reaching clinicians (root cause in SHARING.md); phones zooming out on pages with wide tables (absolutely positioned screen-reader label escaping the table scroller); orientation readings lagging one event behind when motion and orientation events arrived together; 3D viewer badges overlapping buttons on phones; cramped animation controls at 320 px; squeezed checkboxes.

### Your checklist after deploying v1.1
1. `npm run test:rules` (Java 21) → all pass. Then `npm run deploy:rules`.
2. Push to GitHub → Vercel redeploys.
3. Clinician account: open `/clinician/login`, sign in once (creates the directory entry).
4. Patient: Sharing → invite the clinician's email → "Invitation sent". Clinician: Patients → Accept → patient appears. Patient: Revoke → clinician loses access.
5. Phone (https site): Phone sensor → Connect → allow → readings move when you tilt the phone → baseline → record → stop → save → export CSV.

---

## v1.0

Date: 26 October 2026 · Environment: Ubuntu 24.04 (cloud workspace), Node 22.23.4, npm 10.9.9, Java 21, Python 3.13.
Every result marked **PASSED** was executed and observed. Nothing marked **NOT RUN** was claimed to work.

## Summary

| Check | Command | Result |
|---|---|---|
| Strict TypeScript (app, scripts, tests) | `npm run typecheck` | **PASSED** — 0 errors |
| Unit + integration tests | `npm test` | **PASSED** — 135 / 135 tests, 8 files |
| Golden cross-check TypeScript vs Python reference | part of `npm test` (`golden.test.ts`) | **PASSED** — 4 datasets, tolerance 1e-9 |
| Production build | `npm run build` | **PASSED** — no errors or warnings |
| Browser E2E, in-memory harness build | `npm run test:e2e:harness` | **PASSED** — 8 / 8 workflow tests (covering all 10 required workflows), 1 skipped (clinician share test is emulator-only) |
| Browser console errors on all pages (harness, dark + light) | scripted headless Chromium walk | **PASSED** — none recorded |
| Horizontal overflow at 1440 px and 390 px | scripted measurement | **PASSED** — 0 px |
| 3D viewer renders with WebGL, joint click/diagram zoom, observed-range arc | visual check of screenshots + E2E test 2 | **PASSED** |
| Setup screen without Firebase config | headless check of `dist/` | **PASSED** — "Setup required" shown, no fake sign-in |
| Emulator-mode build without running emulators | headless check | **PASSED** — sign-in shows "Network error…" (no crash) |
| Test-harness code excluded from production build | grep of `dist/assets` | **PASSED** — absent |
| Firestore Security Rules tests | `npm run test:rules` | **NOT RUN** — the Firestore emulator JAR could not be downloaded in the build environment (network allowlist). 18 tests written. |
| E2E against Firebase emulators (real Auth + Firestore + rules) | `npm run test:e2e` | **NOT RUN** — same reason. 9 tests written. |
| Seed script against emulators | `npm run seed` | **NOT RUN** — same reason; its guard path was run (refuses without emulator variables). |
| MATLAB scripts (`matlab/*.m`) | MATLAB Online | **NOT RUN** — MATLAB not available. Logic mirrors the tested TypeScript/Python implementations line by line. |
| Deployment to Firebase Hosting | `npm run deploy` | **NOT RUN** — no Firebase project exists. |
| Physical sensor integration | — | **NOT APPLICABLE** — none exists; interface documented only. |
| Clinical validation | — | **NOT DONE** — out of scope; nothing in the app claims it. |

No check **FAILED** in the final run. Failures found during development (four test-query issues, URL/selection sync, E2E selectors, collapsed-sidebar labels hidden on mobile, datetime field truncation) were fixed at the root and the suites re-run.

## What the automated tests cover

**Domain (`src/domain/*.test.ts`, 108 tests):** ROM = max − min (positive and negative angles; not max alone), mean, duration, interval statistics, quality indicators; timestamp parsing (timezone required, ms precision, calendar validity, offsets); CSV/JSON validation (empty, header-only, missing/unknown/duplicate columns, unit hint, bad numbers, NaN/Infinity, out-of-range angles, unsupported movement, mixed identity, duplicates, out-of-order, gaps, irregular sampling, rate limits, size/type limits, row shape, BOM/CRLF/column order); repetition counting (full cycles, trailing excursion, starting high, hysteresis noise, small ROM); Spearman ranks/ties, p-value against reference tables, pairing window and one-to-one matching, insufficient-data refusal; symptom form validation; history filtering and date ranges; export column order, exact numeric round-trip, formula neutralisation, raw-sample export re-import; synthetic generator determinism; calibration static-hold checks; reminder schedule/timezone/due logic and ICS; dashboard aggregations; all shipped sample files (valid accepted, invalid rejected); golden datasets vs Python.

**3D conventions (`rig.test.ts`, 6 tests):** pose directions for every joint/movement and side; illustrative animation sweep.

**UI integration (`src/app/app.test.tsx`, 21 tests, in-memory services with the same permission logic as the rules):** protected routes and role routing; sign-in success/failure; clinician cannot open an unshared patient by URL; read-only clinician view; theme toggle + persistence; sidebar collapse + persistence + accessible labels; joint selection sync across diagram/dropdown/side toggle/movement options/URL; symptom form validation and non-overwriting save; CSV import (valid → metrics → source required → saved with provenance) and rejection with row errors; history filtering and confirmed deletion; dashboard empty state and own-data-only figures; full sharing workflow (invite with consent → accept → revoke); removing only synthetic data; reminder validation and save; session detail metrics, playback controls and "How is this calculated?".

**E2E (`tests/e2e/workflows.spec.ts`):** 1 sign-in, 2 joint + side selection with 3D canvas and zoom, 3 valid import, 4 invalid rejection, 5 ROM review + playback, 6 symptom assessment, 7 history and trends, 8 theme switch persisted across reload, 9 sidebar collapse/expand, 10 CSV export content + record deletion; plus clinician read-only access (emulator project).

**Security Rules (`tests/rules/firestore.rules.test.ts`, written, not run):** role self-grant denied; per-user isolation incl. unauthenticated and exact-path access; clinician without share denied; validation of sessions (hardware source, synthetic flag, joint/movement, ROM consistency, calibration link), assessments (ranges, integers, future time, server timestamps, immutable metadata), immutable calibrations; invite creation by owner only; accept only by the invited verified clinician; no share without invite; revocation and role removal end access.

## How to run the checks that were not run here

```bash
# Java 21+ required
npm run test:rules
npm run emulators            # terminal 1
npm run seed                 # terminal 2
npm run test:e2e:install
npm run test:e2e             # terminal 2
# MATLAB Online: see matlab/README.md → rt_verify_golden
```

## Known dependency advisory

`npm audit --omit=dev` reports 4 high-severity advisories in `@grpc/grpc-js`, pulled in by `@firebase/firestore`'s **Node.js** transport (also used by `firebase-admin`/`firebase-tools`). The browser bundle uses Firestore's WebChannel transport and does not include grpc-js. The only fix npm offers is a downgrade to firebase 9 (breaking); not applied. Re-check when Firebase publishes an update.
