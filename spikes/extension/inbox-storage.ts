import type { Job } from './inbox-types';
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ai-inbox-jobs', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('jobs', { keyPath: 'tabId' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('LOCAL_QUEUE_UNAVAILABLE'));
  });
}
export async function jobStore(tabId: number, action: 'get' | 'delete' | 'put', job?: Job): Promise<Job | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('jobs', action === 'get' ? 'readonly' : 'readwrite'); const store = tx.objectStore('jobs');
      const request = action === 'get' ? store.get(tabId) : action === 'put' ? store.put(job) : store.delete(tabId);
      tx.oncomplete = () => resolve(action === 'get' ? request.result as Job | undefined : undefined);
      tx.onerror = tx.onabort = () => reject(new Error('LOCAL_QUEUE_UNAVAILABLE'));
    });
  } finally { db.close(); }
}
export async function queuedFor(pageUrl: string, vaultId: string): Promise<Job | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('jobs', 'readonly').objectStore('jobs').getAll();
      request.onsuccess = () => resolve((request.result as Job[]).find(job => job.pageUrl === pageUrl && job.vaultId === vaultId));
      request.onerror = () => reject(new Error('LOCAL_QUEUE_UNAVAILABLE'));
    });
  } finally { db.close(); }
}
