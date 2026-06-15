import { db } from '@tempo/db/client';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from 'express';

export const healthHandler: RequestHandler = async (_req, res) => {
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    // db unreachable — surface in response but still return 200 so Fly's
    // HTTP health check doesn't cycle the VM on transient DB hiccups.
  }
  res.json({ ok: true, version: '0.2.0', db: dbOk });
};
