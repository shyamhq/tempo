import type { Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { logger } from '../logger';

// Bind an Express response to a contract schema so handlers can only ship a
// payload matching that schema. The `z.infer<T>` (= `z.output<T>`) parameter
// forces the caller to provide the fully-resolved shape — schemas with
// `.default([])` cannot be silently omitted at the type level. Runtime
// `safeParse` catches drift between the schema and the actual data; on
// failure we log a `contract_violation` (distinct from a DB/internal 500) and
// short-circuit the handler before its own catch can mis-attribute the throw.
export function send<T extends ZodTypeAny>(res: Response, schema: T) {
  return (data: z.infer<T>): void => {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      logger.error({ issues: parsed.error.issues, path: res.req.path }, 'contract_violation');
      res.status(500).json({ error: 'contract_violation' });
      return;
    }
    res.json(parsed.data);
  };
}
