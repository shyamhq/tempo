import type { NextConfig } from 'next';

const config: NextConfig = {
  outputFileTracingRoot: process.cwd().replace(/\/apps\/console-redo\/?$/, ''),
};

export default config;
