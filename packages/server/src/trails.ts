import { deriveTrails, type Trail, ZERO_EVENT_CURSOR } from '@tempo/contracts';
import { readEventsAfter } from './event-log';

export async function listTrailsForThread(threadId: string): Promise<Trail[]> {
  const events = await readEventsAfter(threadId, ZERO_EVENT_CURSOR);
  return deriveTrails(events);
}
