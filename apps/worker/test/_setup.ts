import { plugin } from 'bun';

// Global test preload (see bunfig.toml). Seeds dummy values for every required
// worker env var BEFORE any module imports src/env.ts, so unit tests can import
// worker modules without standing up real secrets. `??=` never clobbers a value
// a real .env provided. Connector vars are intentionally left unset — tests
// mock the connector clients rather than calling out.
const defaults: Record<string, string> = {
  DATABASE_URL: 'postgres://test:test@localhost:5432/tempo_test',
  REDIS_URL: 'redis://localhost:6379',
  CLI_AUTH_SECRET: 'test-cli-secret-0000000000000000000000',
  HOSTED_AUTH_SECRET: 'test-hosted-secret-0000000000000000000',
  WORKER_INTERNAL_TOKEN: 'test-internal-token-000000000000000000',
  TOKEN_HASH_PEPPER: 'test-pepper-00000000000000000000000000',
  CLERK_SECRET_KEY: 'sk_clerk_test_placeholder',
  E2B_API_KEY: 'e2b_test',
  MOONSHOT_API_KEY: 'sk-moonshot-test',
  TAVILY_API_KEY: 'tvly-test',
  NODE_ENV: 'test',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}

// `bun test` doesn't get the `--loader=.md:text` flag the dev/build scripts use,
// so register it here — otherwise modules that inline bundled skills
// (src/skills/index.ts) fail to import the markdown as text.
plugin({
  name: 'md-text',
  setup(build) {
    build.onLoad({ filter: /\.md$/ }, async (args) => ({
      exports: { default: await Bun.file(args.path).text() },
      loader: 'object',
    }));
  },
});
