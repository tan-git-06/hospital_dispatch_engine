import { MongoClient } from 'mongodb';

// Lazy singleton: connects on first use (not at build/import time).
// Changes vs. the original: (1) 3 s server-selection timeout, so a stopped MongoDB fails fast instead of
// hanging every request for 30 s; (2) a failed connection is NOT cached, so starting MongoDB later works
// without restarting Next.js.
const g = globalThis;

function client() {
  if (!g.__mongoClient) {
    const p = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 }).connect();
    p.catch(() => { if (g.__mongoClient === p) g.__mongoClient = null; });
    g.__mongoClient = p;
  }
  return g.__mongoClient;
}

export async function getDb() {
  return (await client()).db(process.env.MONGODB_DB || 'hospital_dispatch_nosql');
}

/** Best-effort audit log. MySQL is the source of truth, so a Mongo outage
 *  must never fail a request whose SQL transaction already committed. */
export async function logEvent(event_type, actor, fields = {}) {
  try {
    const db = await getDb();
    await db.collection('dispatch_events').insertOne({
      request_id: null, call_id: null, ...fields,
      event_type, actor, created_at: new Date(),
    });
  } catch (err) {
    console.error('[mongo] logEvent failed:', err.message);
  }
}
