export function formatNudge(summary: string, total: number): string {
  return `[Tempo] ${total} new Console event(s): ${summary}. Call tempo_poll with your last cursor to fetch payloads, then act (tempo_post_reply / tempo_pull_plan / tempo_post_discussion_message as needed).`;
}
