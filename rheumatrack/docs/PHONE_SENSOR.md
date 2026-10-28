# Phone sensor monitor

Page: **Phone sensor** (`/sensor`). Code: `src/features/sensor/`, maths in `src/domain/sensor.ts` (tested in `sensor.test.ts`).

## What it reads

Browser motion-sensor events, stored exactly as received:

| Value | Source | Unit |
|---|---|---|
| α heading, β front–back tilt, γ left–right tilt | `deviceorientation` | degrees |
| rotation rate α, β, γ | `devicemotion.rotationRate` | degrees per second |
| acceleration including gravity x, y, z | `devicemotion.accelerationIncludingGravity` | m/s² |

Acceleration and rotation rate are never displayed as angles.

## The one derived value

**"Phone orientation change — estimated, not a validated joint angle."** It is the angle between the phone's long axis now and during the still baseline:

- Long axis from the W3C orientation angles: `[−sin α·cos β, cos α·cos β, sin β]` (`R = Rz(α)·Rx(β)·Ry(γ)` applied to the device y-axis). Rolling the phone about its own long axis (γ) does not change it.
- If orientation is unavailable, the angle between current and baseline **gravity** directions is used instead (noisier during fast movement). The method is stored with each recording.

With the phone strapped lengthwise on a limb segment, this approximates how far that segment rotated. It is not the joint angle (the other segment may move too), it is not calibrated against a goniometer, and consumer phone sensors drift. It is stored as a **separate record type** and is never mixed with imported movement sessions or observed ROM figures.

## Workflow and states

1. **Place the phone** — body segment and side; placement hints per segment.
2. **Connect** — states: not supported · needs https · waiting for permission (iPhone prompt) · permission denied · waiting for readings · no readings (after 3 s) · live.
3. **Baseline** — hold still 2 s; passes with ≥ 15 readings and ≤ 3° movement, otherwise explains why and offers a retry.
4. **Record** — Start · Pause · Resume · Stop; timer counts active time only; live chart of the last 15 s; auto-stop at 5 minutes or 30 000 samples; the screen is kept awake where supported.
5. **Review** — summary (duration, samples and rate, change range, peak rotation rate, method), full chart, notes → **Save**, **Export CSV**, or **Discard** (confirmed).

Saved recordings: list with view, CSV export and delete; clinicians with an accepted share see them read-only.

## Requirements and limits

- A phone with motion sensors; **https** (the deployed Vercel site). `http://` local addresses on a phone will show "needs https".
- iPhone (iOS 13+): Safari asks for permission after tapping **Connect**. If denied, close and reopen the tab, or check Settings → Safari → Motion & Orientation Access.
- Android: Chrome provides the sensors without a prompt; some browsers block them in site settings.
- Desktop computers normally have no motion sensors → "No sensor readings received".
- Events closer than 15 ms are merged into one sample (≈ 66 samples/s maximum); nothing is invented or interpolated.

## Storage

`users/{uid}/sensorRecordings/{id}` (metadata, summary, baseline, method, device info, notes) with readings in `chunks/{n}` (≤ 3000 samples per chunk, one array per field). Security Rules: owner writes; owner or accepted clinician reads; immutable except notes.

## Verification status

Logic is tested with **simulated** sensor events (permissions, states, baseline, pause/resume, saving, export, clean-up). It has **not** been verified on a physical phone in this environment — test it on your phone on the deployed site (see VERIFICATION.md).
