import { withAuth, ok } from '@/lib/auth';

// The UI calls this to know who is logged in (the cookie itself is httpOnly).
export const GET = withAuth(null, async (_req, _ctx, user) =>
  ok({ username: user.username, role: user.role, hospital_id: user.hospital_id }));
