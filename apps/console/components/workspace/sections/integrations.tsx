'use client';

import { Sparkles } from 'lucide-react';
import { ComingSoon } from './coming-soon';

export function IntegrationsSection() {
  return (
    <ComingSoon
      title="Integrations"
      description="Connect Tempo to the rest of your stack."
      icon={Sparkles}
      body="Linear, GitHub, and Slack integrations are in the works. We'll surface them here once they're ready."
    />
  );
}
