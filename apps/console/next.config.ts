import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace TS packages Next must transpile.
  transpilePackages: ['@tempo/contracts', '@tempo/db', '@tempo/server'],
  outputFileTracingRoot: process.cwd().replace(/\/apps\/console\/?$/, ''),
  // @tempo/server's barrel pulls in block-html → @blocknote/server-util, which
  // imports @blocknote/react (createContext) + jsdom. Bundling those into the
  // server build breaks RSC; keep them external so the route handlers that import
  // @tempo/server work at runtime.
  serverExternalPackages: ['@blocknote/server-util', 'jsdom'],
};

export default config;
