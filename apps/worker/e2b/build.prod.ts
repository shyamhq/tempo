import { Template, defaultBuildLogger } from 'e2b';
import { template } from './template';

await Template.build(template, 'tempo-hosted-runner', {
  cpuCount: 1,
  memoryMB: 1024,
  onBuildLogs: defaultBuildLogger(),
});
