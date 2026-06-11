'use client';

import { useOrganizationList } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function OnboardingPage() {
  const { userMemberships, setActive, isLoaded } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;
    const first = userMemberships.data?.[0];
    if (first) {
      setActive({ organization: first.organization.id }).then(() => {
        router.replace('/');
      });
    }
  }, [isLoaded, userMemberships.data]);

  return <p className="text-caption text-ink-subtle">Setting up your workspace…</p>;
}
