import { getDb } from '@/lib/mongo';
import { ROLES, withAuth, ok } from '@/lib/auth';

// GET /api/events?request_id=12&event_type=STATUS_CHANGED
// Event timeline from MongoDB (uses the indexes created in db/mongodb/mongo_setup.js).
export const GET = withAuth([ROLES.ADMIN, ROLES.DISPATCHER], async (request) => {
  const sp = new URL(request.url).searchParams;
  const filter = {};
  if (sp.get('request_id')) filter.request_id = Number(sp.get('request_id'));
  if (sp.get('event_type')) filter.event_type = sp.get('event_type');
  const events = await (await getDb()).collection('dispatch_events')
    .find(filter, { projection: { _id: 0 } })
    .sort({ created_at: filter.request_id ? 1 : -1 })   // a single timeline reads oldest -> newest
    .limit(100).toArray();
  return ok(events);
});
