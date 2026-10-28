# Sharing, clinician accounts and invitations (v1.1)

## Why invitations were not reaching clinicians (v1.0)

In v1.0 an invitation was stored with only the clinician's **email**. A clinician saw it only if **all** of these were true: their account had the clinician role (`/roles/{uid}`), their email was **verified**, and they had signed out and in after the role was granted. If any was missing the invitation sat in Firestore unseen, and the patient was never told: the app never checked that the email belonged to a clinician.

## How it works now

```
Patient                         Firestore                              Clinician
───────                         ─────────                              ─────────
types clinician email ──► get /clinicians/{email} ── not found ──► "Clinician account not found"
                                     │ found (uid, name)
create /invites/{id} ──────► { clinicianUid, status: pending, createdAt }
   rules: clinicianUid must hold the clinician role
                                     │
                                     └──► query invites where clinicianUid == me ──► Pending list
                                                                                       │ Accept / Decline
accept (one batch): create /shares/{patient}_{clinician} + invite.status = accepted ◄──┘
   rules: addressed to me, still pending, < 14 days old
decline: invite.status = declined
revoke (patient): invite.status = revoked + delete share ──► access ends immediately
```

| Status | Meaning |
|---|---|
| Pending | Waiting for the clinician; expires 14 days after it was sent |
| Accepted | Clinician has read-only access (while the share exists) |
| Declined | Clinician declined; no access |
| Revoked | Patient cancelled the invitation or revoked access |
| Expired | Derived: pending for 14 days. The rules refuse acceptance after expiry |
| Access ended | Accepted, but the clinician later removed the patient |

- **No email is sent.** The invitation appears in the clinician's RheumaTrack account; the UI says so.
- **Duplicates:** a new invitation is blocked while one to the same clinician is pending or access is active.
- **What the clinician can see:** movement sessions, symptom check-ins, calibration records, phone sensor recordings, trends and reports — read-only.
- **Verified email** is no longer required for invitations addressed by account ID. It is still required for legacy (v1.0) invitations, which keep working.

## Clinician directory — `/clinicians/{email}`

Document ID = lower-case email; fields `uid`, `email`, `displayName`, `updatedAt`.
- Any signed-in user may **get** one entry by exact email; **listing** the directory is denied.
- Entries are created by the Admin SDK (`npm run grant-clinician`) **or automatically** when a clinician signs in (the app writes the entry for the clinician's own email; the rules only allow this for accounts holding the clinician role).
- The invite rule also checks the addressee's role directly, so a stale directory entry cannot be used to invite someone who is no longer a clinician.

## Separate sign-in pages

| Page | URL | After sign-in |
|---|---|---|
| Patient sign-in | `/login` | patient dashboard (a clinician account goes to the clinician area) |
| Clinician sign-in | `/clinician/login` | clinician area if the account has the role; otherwise **Clinician access** page |

The choice of page **never grants a role**. Roles come only from `/roles/{uid}`, which no browser can write. The role is watched live: when an administrator grants or removes it, the app switches without signing out.

## Becoming a clinician

1. Sign up (`/signup?portal=clinician` or the link on the clinician sign-in page).
2. On the **Clinician access** page, submit the request: name, organisation, professional registration number, optional note. This creates `/clinicianRequests/{uid}` (status `pending`).
3. An administrator verifies the person and approves:
   - **Firebase console:** Firestore → `roles` → Add document, ID = the user's UID, field `role` = `clinician`. Optionally set the request's `status` to `approved`. The clinician's screen switches automatically and their directory entry is created on the next page load.
   - **Script:** `npm run grant-clinician -- --project <project-id> doctor@example.com` (writes the role, the directory entry, and marks the request approved).
4. Revoke: delete the `roles` document (and the `clinicians` entry), or `npm run grant-clinician -- --project <id> --revoke doctor@example.com`, which also removes all of that clinician's shares.

## Upgrading an existing deployment to v1.1

1. Deploy the new rules: `npm run deploy:rules` (or `npx firebase deploy --only firestore`).
2. Push the code; Vercel redeploys the site.
3. Existing clinicians: sign in once (directory entry is created automatically), or run the grant script for them.
4. Existing pending invitations keep working for clinicians with a verified email. Patients can cancel them and send a new one to get the new flow.

## Troubleshooting

| Patient sees | Cause | Fix |
|---|---|---|
| "Clinician account not found" | No directory entry for that email | Clinician signs in once after the role is granted, or run the grant script; check the email spelling |
| "This clinician account is not active" | Directory entry exists but the role was removed | Re-grant the role or ask the clinician |
| Status stays "Pending" | Clinician has not opened the Patients page | Tell them; invitations expire after 14 days |

| Clinician sees | Cause | Fix |
|---|---|---|
| "This account doesn't have clinician access" | No `/roles/{uid}` document | Administrator grants the role |
| Invitation missing | It was addressed to a different email/account, cancelled or expired | Patient sends a new one to the correct email |
