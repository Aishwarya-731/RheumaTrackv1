# Changelog

## 1.1.0 — 2026-10-27

### Fixed
- **Clinician invitations did not reach clinicians.** Invitations are now addressed to the clinician's account (found by exact email in a clinician directory) instead of an email string that only matched if the clinician's email was verified and their role was loaded. The patient now sees **"Clinician account not found"** immediately when no clinician uses that email.
- Phones zoomed the whole page out on History and other pages with wide tables (a hidden screen-reader label escaped the table's scroll box). Wide tables now scroll inside their card, with edge shadows.

### Added
- **Separate sign-in pages:** `/login` (patients) and `/clinician/login` (clinicians). The page never grants a role; roles come from `/roles/{uid}` only, and are now watched live.
- **Request clinician access** page for accounts without the role; administrators approve in the Firebase console or with `npm run grant-clinician`.
- Clinician inbox with **Accept / Decline**, requested-access description, 14-day expiry, history; patient view shows Pending, Accepted, Declined, Expired, Revoked, Access ended. Duplicate invitations are blocked.
- **Phone sensor monitor** (`/sensor`): live DeviceOrientation/DeviceMotion readings, permission handling (including iPhone), baseline, start/pause/resume/stop, review, save, CSV export, saved-recording list (read-only for clinicians). The one derived value is labelled "Phone orientation change — estimated, not a validated joint angle" and is stored separately from movement sessions.
- Responsive refinements: compact icon sidebar on tablets, 44 px touch targets on touch screens, bottom-sheet dialogs and single-column details on phones, safe-area padding for notched phones.
- `npm run deploy:rules`; docs `SHARING.md`, `PHONE_SENSOR.md`.

### Security Rules
- New: `/clinicians/{email}` (get-only lookup; clinicians write their own), `/clinicianRequests/{uid}`, `users/{uid}/sensorRecordings/**`.
- Invites must target an account holding the clinician role; acceptance only by that account, while pending and within 14 days; clinicians can decline. Legacy email-addressed invitations still work for verified clinicians.
- **Deploy the rules after updating:** `npm run deploy:rules`.
