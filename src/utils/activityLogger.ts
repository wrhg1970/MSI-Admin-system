import { collection, doc, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';

export interface ActivityLogInput {
  insuranceId: string;
  type?: string;
  description: string;
  date?: any;
  createdBy?: string;
  [key: string]: any;
}

/**
 * Safely logs an activity to the `insuranceActivities` collection.
 * Uses `setDoc` with merge to prevent "Document already exists" collisions
 * and silently catches non-fatal log errors so primary workflows are not blocked.
 */
export async function logInsuranceActivity(activity: ActivityLogInput): Promise<void> {
  if (!activity.insuranceId) return;
  try {
    const actRef = doc(collection(db, 'insuranceActivities'));
    await setDoc(actRef, {
      ...activity,
      type: activity.type || 'manual',
      date: activity.date || new Date(),
      createdBy: activity.createdBy || auth.currentUser?.email || 'Sistema'
    }, { merge: true });
  } catch (err) {
    console.warn('Non-fatal: failed to log activity to bitácora:', err);
  }
}
