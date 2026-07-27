import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';

const COLLECTIONS = [
  'customers', 'inquiries', 'salesOrders', 'productionPlans', 'templates',
  'machineLogbooks', 'inspections', 'packingRecords', 'inventory',
  'dispatches', 'complaints', 'capas', 'permissions', 'aclRequests'
];

/**
 * Fetches all ERP collections from Firestore
 */
export async function fetchFromFirestore() {
  const data: any = {};
  let hasData = false;

  await Promise.all(COLLECTIONS.map(async (collName) => {
    try {
      const querySnapshot = await getDocs(collection(db, collName));
      data[collName] = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      if (data[collName] && data[collName].length > 0) {
        hasData = true;
      }
    } catch (err) {
      console.error(`[Firestore] Error fetching collection ${collName}:`, err);
      data[collName] = [];
    }
  }));

  return { data, hasData };
}

/**
 * Saves specific ERP collections to Firestore using batches
 */
export async function saveToFirestore(allData: any, changedCollections: string[]) {
  const collectionsToSync = changedCollections.filter(c => COLLECTIONS.includes(c));
  
  await Promise.all(collectionsToSync.map(async (collName) => {
    try {
      const items = allData[collName];
      if (!Array.isArray(items)) return;

      // Fetch current documents to find deletions
      const querySnapshot = await getDocs(collection(db, collName));
      const existingIds = new Set(querySnapshot.docs.map(d => d.id));
      const incomingIds = new Set(items.map((item: any) => item.id).filter(Boolean));

      // Batch size limit is 500 in Firestore
      const batch = writeBatch(db);

      // Add/Update docs
      items.forEach((item: any) => {
        if (!item.id) return;
        const docRef = doc(db, collName, item.id);
        batch.set(docRef, item, { merge: true });
      });

      // Delete removed docs
      existingIds.forEach((id) => {
        if (!incomingIds.has(id)) {
          const docRef = doc(db, collName, id);
          batch.delete(docRef);
        }
      });

      await batch.commit();
      console.log(`[Firestore] Client synced collection '${collName}': ${items.length} items`);
    } catch (err) {
      console.error(`[Firestore] Error syncing collection ${collName}:`, err);
    }
  }));
}
