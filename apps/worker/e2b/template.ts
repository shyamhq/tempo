import { Template } from 'e2b';

// hosted-package.json brings in the Vercel AI SDK + Anthropic provider +
// the official MCP filesystem server. ripgrep is apt-installed for the
// native Grep tool. No 251 MB Claude Code binary; no libc workaround.
export const template = Template().fromDockerfile(`FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates ripgrep && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /workspace && chown user:user /workspace
WORKDIR /app
COPY hosted-package.json /app/package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY hosted-runner.js /app/runner.js`);
