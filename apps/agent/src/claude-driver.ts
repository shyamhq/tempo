import { query, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { logger } from './logger';

export async function runClaudeSession(
  initialPrompt: string,
  mcpServer: McpSdkServerConfigWithInstance,
): Promise<void> {
  const session = query({
    prompt: initialPrompt,
    options: {
      mcpServers: { tempo: mcpServer },
    },
  });

  for await (const message of session) {
    streamToTerminal(message);
  }
}

function streamToTerminal(message: unknown): void {
  if (!message || typeof message !== 'object') return;
  const m = message as { type?: string; message?: { content?: unknown } };

  if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
    for (const block of m.message.content as Array<{ type?: string; text?: string; name?: string }>) {
      if (block.type === 'text' && typeof block.text === 'string') {
        process.stdout.write(block.text);
      } else if (block.type === 'tool_use' && block.name) {
        process.stdout.write(`\n[${block.name}]\n`);
      }
    }
    process.stdout.write('\n');
    return;
  }

  if (m.type === 'result') {
    process.stdout.write('\n[session ended]\n');
    return;
  }

  logger.debug({ type: m.type }, 'sdk message');
}
