'use client';

import { CreditCard } from 'lucide-react';
import { ComingSoon } from './coming-soon';

export function BillingSection() {
  return (
    <ComingSoon
      title="Billing"
      description="Plan, invoices, and payment methods."
      icon={CreditCard}
      body="Tempo is free during the alpha. Billing and team plans land here once we open paid tiers."
    />
  );
}
