import { ServerBlockNoteEditor } from '@blocknote/server-util';
import { planSchema } from '@/lib/plan-schema';

// Module-level singleton. ServerBlockNoteEditor spins up a JSDOM instance on
// construction; one per process keeps that cost off the request path. The
// editor itself is stateless across calls — every method takes blocks as input
// and returns blocks/markdown/html as output, no internal document is mutated.
export const serverPlanEditor = ServerBlockNoteEditor.create({ schema: planSchema });
