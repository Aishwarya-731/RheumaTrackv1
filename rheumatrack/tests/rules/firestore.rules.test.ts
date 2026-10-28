/**
 * Firestore Security Rules tests (run against the local Firestore emulator):
 *   npm run test:rules
 */
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { deleteDoc, doc, getDoc, getDocs, collection, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';

let env: RulesTestEnvironment;
const PATIENT = 'patient-uid';
const CLINICIAN = 'clinician-uid';
const OTHER_CLINICIAN = 'clinician-2';
const STRANGER = 'stranger-uid';

const authCtx = (uid: string, email: string, verified = true) => env.authenticatedContext(uid, { email, email_verified: verified });
const patientDb = () => authCtx(PATIENT, 'patient@example.test').firestore();
const clinicianDb = () => authCtx(CLINICIAN, 'doc@example.test').firestore();
const otherClinicianDb = () => authCtx(OTHER_CLINICIAN, 'doc2@example.test').firestore();
const strangerDb = () => authCtx(STRANGER, 'stranger@example.test').firestore();

const reminders = { enabled: false, time: '09:00', days: [1, 2, 3], timezone: 'UTC' };
const metrics = {
  sampleCount: 100, minDeg: 5, maxDeg: 95, romDeg: 90, meanDeg: 50, durationMs: 9900,
  interval: { min: 100, max: 100, mean: 100, median: 100, sd: 0, rateHz: 10 },
  quality: { irregularIntervals: 0, irregularIntervalPct: 0 }, repetitions: 3, repetitionNote: null,
};
function session(overrides: Record<string, unknown> = {}) {
  return {
    joint: 'knee', side: 'left', movement: 'flexion', source: 'imported', isSynthetic: false,
    sourceFileName: 'k.csv', sourceFormat: 'csv',
    startedAt: Timestamp.fromMillis(1_700_000_000_000), endedAt: Timestamp.fromMillis(1_700_000_010_000),
    createdAt: serverTimestamp(), createdBy: PATIENT, metrics, calibrationId: null, calibrationStatus: 'not-calibrated',
    notes: '', chunkCount: 1, schemaVersion: 1, ...overrides,
  };
}
function assessment(overrides: Record<string, unknown> = {}) {
  return {
    joint: 'knee', side: 'left', pain: 3, stiffness: 4, discomfort: 2, durationMinutes: 30, notes: '',
    assessedAt: Timestamp.fromMillis(Date.now() - 60_000), createdAt: serverTimestamp(), updatedAt: null,
    createdBy: PATIENT, isSynthetic: false, schemaVersion: 1, ...overrides,
  };
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rheumatrack-rules',
    firestore: { rules: readFileSync('firebase/firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'roles', CLINICIAN), { role: 'clinician' });
    await setDoc(doc(db, 'roles', OTHER_CLINICIAN), { role: 'clinician' });
    await setDoc(doc(db, 'users', PATIENT), { displayName: 'Pat', email: 'patient@example.test', createdAt: Timestamp.now(), reminders, preferredJoint: null, preferredSide: null, schemaVersion: 1 });
    await setDoc(doc(db, 'users', PATIENT, 'sessions', 's1'), { ...session(), createdAt: Timestamp.now() });
    await setDoc(doc(db, 'users', PATIENT, 'assessments', 'a1'), { ...assessment(), createdAt: Timestamp.now() });
  });
});

describe('roles', () => {
  it('a user cannot grant themselves the clinician role', async () => {
    await assertFails(setDoc(doc(strangerDb(), 'roles', STRANGER), { role: 'clinician' }));
  });
  it('a user can read only their own role', async () => {
    await assertSucceeds(getDoc(doc(clinicianDb(), 'roles', CLINICIAN)));
    await assertFails(getDoc(doc(strangerDb(), 'roles', CLINICIAN)));
  });
});

describe('per-user isolation', () => {
  it('the owner can read their records; others cannot, even with the exact document path', async () => {
    await assertSucceeds(getDoc(doc(patientDb(), 'users', PATIENT, 'sessions', 's1')));
    await assertFails(getDoc(doc(strangerDb(), 'users', PATIENT, 'sessions', 's1')));
    await assertFails(getDocs(collection(strangerDb(), 'users', PATIENT, 'assessments')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users', PATIENT)));
  });
  it('a clinician without a share cannot read a patient by changing the ID', async () => {
    await assertFails(getDoc(doc(clinicianDb(), 'users', PATIENT, 'sessions', 's1')));
    await assertFails(getDoc(doc(clinicianDb(), 'users', PATIENT)));
  });
  it('nobody can write into another person’s records', async () => {
    await assertFails(setDoc(doc(strangerDb(), 'users', PATIENT, 'assessments', 'x'), assessment({ createdBy: STRANGER })));
  });
});

describe('record validation', () => {
  it('accepts a valid session and rejects invalid ones', async () => {
    const db = patientDb();
    await assertSucceeds(setDoc(doc(db, 'users', PATIENT, 'sessions', 'ok'), session()));
    await assertFails(setDoc(doc(db, 'users', PATIENT, 'sessions', 'hw'), session({ source: 'hardware' })));
    await assertFails(setDoc(doc(db, 'users', PATIENT, 'sessions', 'syn'), session({ source: 'simulation', isSynthetic: false })));
    await assertFails(setDoc(doc(db, 'users', PATIENT, 'sessions', 'mv'), session({ joint: 'knee', movement: 'abduction' })));
    await assertFails(setDoc(doc(db, 'users', PATIENT, 'sessions', 'rom'), session({ metrics: { ...metrics, romDeg: 95 } })));
    await assertFails(setDoc(doc(db, 'users', PATIENT, 'sessions', 'cal'), session({ calibrationStatus: 'reference-available', calibrationId: null })));
  });
  it('only notes can change on a session', async () => {
    const db = patientDb();
    await assertSucceeds(updateDoc(doc(db, 'users', PATIENT, 'sessions', 's1'), { notes: 'ok', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, 'users', PATIENT, 'sessions', 's1'), { 'metrics.romDeg': 120, updatedAt: serverTimestamp() }));
  });
  it('validates assessment scores, duration and timestamps', async () => {
    const db = patientDb();
    await assertSucceeds(setDoc(doc(db, 'users', PATIENT, 'assessments', 'ok'), assessment()));
    await assertFails(setDoc(doc(db, 'users', PATIENT, 'assessments', 'p11'), assessment({ pain: 11 })));
    await assertFails(setDoc(doc(db, 'users', PATIENT, 'assessments', 'frac'), assessment({ pain: 2.5 })));
    await assertFails(setDoc(doc(db, 'users', PATIENT, 'assessments', 'dur'), assessment({ durationMinutes: 2000 })));
    await assertFails(setDoc(doc(db, 'users', PATIENT, 'assessments', 'fut'), assessment({ assessedAt: Timestamp.fromMillis(Date.now() + 3600_000) })));
    await assertFails(setDoc(doc(db, 'users', PATIENT, 'assessments', 'ts'), assessment({ createdAt: Timestamp.fromMillis(0) })));
  });
  it('an assessment edit cannot change its creation metadata', async () => {
    const db = patientDb();
    await assertSucceeds(updateDoc(doc(db, 'users', PATIENT, 'assessments', 'a1'), { pain: 5, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, 'users', PATIENT, 'assessments', 'a1'), { createdBy: 'x', updatedAt: serverTimestamp() }));
  });
  it('calibration records are immutable', async () => {
    const db = patientDb();
    const cal = { joint: 'knee', side: 'left', movement: 'flexion', inputSource: 'static-reference-file', sourceFileName: 'hold.csv', outcome: 'completed', referenceAngleDeg: 2, holdSdDeg: 0.3, holdDurationMs: 3000, sampleCount: 150, validationMessages: [], config: { maxHoldSdDeg: 2, minHoldDurationMs: 2000, minSamples: 20 }, createdAt: serverTimestamp(), createdBy: PATIENT, schemaVersion: 1 };
    await assertSucceeds(setDoc(doc(db, 'users', PATIENT, 'calibrations', 'c1'), cal));
    await assertFails(updateDoc(doc(db, 'users', PATIENT, 'calibrations', 'c1'), { referenceAngleDeg: 0 }));
  });
});

describe('phone sensor recordings', () => {
  const rec = (o: Record<string, unknown> = {}) => ({
    segment: 'shin', side: 'left', method: 'orientation',
    startedAt: Timestamp.fromMillis(1_700_000_000_000), endedAt: Timestamp.fromMillis(1_700_000_030_000),
    createdAt: serverTimestamp(), createdBy: PATIENT,
    summary: { sampleCount: 1500, activeDurationMs: 30000, meanRateHz: 50, changeMinDeg: 0, changeMaxDeg: 80, changeRangeDeg: 80, peakRotationRateDegS: 120, peakAccelerationMs2: 12 },
    baseline: { vector: [0, 1, 0], durationMs: 2000, maxDeviationDeg: 0.8 },
    deviceInfo: 'test', notes: '', chunkCount: 1, schemaVersion: 1, ...o,
  });
  it('only the owner can create; values are validated; clinicians need a share to read', async () => {
    await assertSucceeds(setDoc(doc(patientDb(), 'users', PATIENT, 'sensorRecordings', 'r1'), rec()));
    await assertFails(setDoc(doc(patientDb(), 'users', PATIENT, 'sensorRecordings', 'r2'), rec({ segment: 'tail' })));
    await assertFails(setDoc(doc(patientDb(), 'users', PATIENT, 'sensorRecordings', 'r3'), rec({ chunkCount: 50 })));
    await assertFails(setDoc(doc(strangerDb(), 'users', PATIENT, 'sensorRecordings', 'r4'), rec({ createdBy: STRANGER })));
    await assertFails(getDoc(doc(clinicianDb(), 'users', PATIENT, 'sensorRecordings', 'r1')));
    await assertFails(updateDoc(doc(patientDb(), 'users', PATIENT, 'sensorRecordings', 'r1'), { 'summary.changeMaxDeg': 170 }));
  });
});

describe('clinician directory', () => {
  it('any signed-in user can look up one clinician by exact email, but cannot list the directory', async () => {
    await assertSucceeds(getDoc(doc(patientDb(), 'clinicians', 'doc@example.test')));
    await assertFails(getDocs(collection(patientDb(), 'clinicians')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'clinicians', 'doc@example.test')));
  });
  it('only a clinician can create the entry for their own email', async () => {
    const entry = (uid: string, email: string) => ({ uid, email, displayName: 'X', updatedAt: serverTimestamp() });
    await assertSucceeds(setDoc(doc(clinicianDb(), 'clinicians', 'doc@example.test'), entry(CLINICIAN, 'doc@example.test')));
    await assertFails(setDoc(doc(strangerDb(), 'clinicians', 'stranger@example.test'), entry(STRANGER, 'stranger@example.test')));
    await assertFails(setDoc(doc(clinicianDb(), 'clinicians', 'other@example.test'), entry(CLINICIAN, 'other@example.test')));
    await assertFails(setDoc(doc(otherClinicianDb(), 'clinicians', 'doc@example.test'), entry(OTHER_CLINICIAN, 'doc@example.test')));
  });
});

describe('clinician access requests', () => {
  const req = (email: string) => ({ email, displayName: 'S', organisation: 'Clinic', professionalId: 'REG-1', note: '', status: 'pending', createdAt: serverTimestamp() });
  it('a user can request access for themself only, and cannot approve it', async () => {
    await assertSucceeds(setDoc(doc(strangerDb(), 'clinicianRequests', STRANGER), req('stranger@example.test')));
    await assertFails(setDoc(doc(strangerDb(), 'clinicianRequests', PATIENT), req('stranger@example.test')));
    await assertFails(updateDoc(doc(strangerDb(), 'clinicianRequests', STRANGER), { status: 'approved' }));
    await assertFails(getDoc(doc(patientDb(), 'clinicianRequests', STRANGER)));
  });
  it('a request cannot be created already approved', async () => {
    await assertFails(setDoc(doc(strangerDb(), 'clinicianRequests', STRANGER), { ...req('stranger@example.test'), status: 'approved' }));
  });
});

describe('consent-based sharing', () => {
  function inviteData(overrides: Record<string, unknown> = {}) {
    return { patientUid: PATIENT, patientName: 'Pat', clinicianUid: CLINICIAN, clinicianEmail: 'doc@example.test', clinicianName: 'Dr Doc', status: 'pending', createdAt: serverTimestamp(), respondedAt: null, ...overrides };
  }
  async function invite(id = 'inv1', overrides: Record<string, unknown> = {}) {
    await assertSucceeds(setDoc(doc(patientDb(), 'invites', id), inviteData(overrides)));
  }
  async function accept(db = clinicianDb(), uid = CLINICIAN, email = 'doc@example.test', id = 'inv1') {
    const b = writeBatch(db);
    b.set(doc(db, 'shares', `${PATIENT}_${uid}`), { patientUid: PATIENT, clinicianUid: uid, clinicianEmail: email, patientName: 'Pat', inviteId: id, createdAt: serverTimestamp() });
    b.update(doc(db, 'invites', id), { status: 'accepted', respondedAt: serverTimestamp() });
    return b.commit();
  }

  it('an invitation must be addressed to an account that holds the clinician role', async () => {
    await assertFails(setDoc(doc(patientDb(), 'invites', 'x'), inviteData({ clinicianUid: STRANGER, clinicianEmail: 'stranger@example.test' })));
    await assertFails(setDoc(doc(patientDb(), 'invites', 'y'), inviteData({ clinicianUid: PATIENT })));
  });
  it('a patient cannot create an invite on someone else’s behalf or pre-accepted', async () => {
    await assertFails(setDoc(doc(strangerDb(), 'invites', 'x'), inviteData()));
    await assertFails(setDoc(doc(patientDb(), 'invites', 'z'), inviteData({ status: 'accepted' })));
  });
  it('the invited clinician sees it by account ID and can accept, then read records read-only', async () => {
    await invite();
    await assertSucceeds(getDocs(query(collection(clinicianDb(), 'invites'), where('clinicianUid', '==', CLINICIAN))));
    await assertFails(getDoc(doc(clinicianDb(), 'users', PATIENT, 'sessions', 's1')));
    await assertSucceeds(accept());
    await assertSucceeds(getDoc(doc(clinicianDb(), 'users', PATIENT, 'sessions', 's1')));
    await assertFails(setDoc(doc(clinicianDb(), 'users', PATIENT, 'assessments', 'c'), assessment({ createdBy: CLINICIAN })));
    await assertFails(deleteDoc(doc(clinicianDb(), 'users', PATIENT, 'sessions', 's1')));
  });
  it('an unverified clinician email can still accept an invitation addressed to their account ID', async () => {
    await invite();
    await assertSucceeds(accept(authCtx(CLINICIAN, 'doc@example.test', false).firestore()));
  });
  it('a different clinician cannot see, accept or decline someone else’s invitation', async () => {
    await invite();
    await assertFails(getDoc(doc(otherClinicianDb(), 'invites', 'inv1')));
    await assertFails(accept(otherClinicianDb(), OTHER_CLINICIAN, 'doc2@example.test'));
    await assertFails(updateDoc(doc(otherClinicianDb(), 'invites', 'inv1'), { status: 'declined', respondedAt: serverTimestamp() }));
  });
  it('the invited clinician can decline; a declined invitation cannot then be accepted', async () => {
    await invite();
    await assertSucceeds(updateDoc(doc(clinicianDb(), 'invites', 'inv1'), { status: 'declined', respondedAt: serverTimestamp() }));
    await assertFails(accept());
  });
  it('an expired invitation cannot be accepted', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'invites', 'old'), { ...inviteData(), createdAt: Timestamp.fromMillis(Date.now() - 15 * 86_400_000) }),
    );
    await assertFails(accept(clinicianDb(), CLINICIAN, 'doc@example.test', 'old'));
  });
  it('a share cannot be created without an invite', async () => {
    const db = clinicianDb();
    await assertFails(setDoc(doc(db, 'shares', `${PATIENT}_${CLINICIAN}`), { patientUid: PATIENT, clinicianUid: CLINICIAN, clinicianEmail: 'doc@example.test', patientName: 'Pat', inviteId: 'nope', createdAt: serverTimestamp() }));
  });
  it('legacy email-addressed invitations still work for the verified clinician', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'invites', 'legacy'), { patientUid: PATIENT, patientName: 'Pat', clinicianEmail: 'doc@example.test', status: 'pending', createdAt: Timestamp.now() }),
    );
    await assertSucceeds(getDocs(query(collection(clinicianDb(), 'invites'), where('clinicianEmail', '==', 'doc@example.test'), where('status', '==', 'pending'))));
    await assertSucceeds(accept(clinicianDb(), CLINICIAN, 'doc@example.test', 'legacy'));
  });
  it('revocation by the patient removes access immediately', async () => {
    await invite();
    await accept();
    const b = writeBatch(patientDb());
    b.update(doc(patientDb(), 'invites', 'inv1'), { status: 'revoked', respondedAt: serverTimestamp() });
    b.delete(doc(patientDb(), 'shares', `${PATIENT}_${CLINICIAN}`));
    await assertSucceeds(b.commit());
    await assertFails(getDoc(doc(clinicianDb(), 'users', PATIENT, 'sessions', 's1')));
  });
  it('if the clinician role is revoked, an existing share no longer grants access', async () => {
    await invite();
    await accept();
    await env.withSecurityRulesDisabled(async (ctx) => deleteDoc(doc(ctx.firestore(), 'roles', CLINICIAN)));
    await assertFails(getDoc(doc(clinicianDb(), 'users', PATIENT, 'sessions', 's1')));
  });
});
