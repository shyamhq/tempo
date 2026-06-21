'use client';

import { ArrowRight, Search, Settings, Star } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CodeInline } from '@/components/ui/code-inline';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Pill } from '@/components/ui/pill';
import { Segmented } from '@/components/ui/segmented';

type Theme = 'light' | 'dark';
type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'actor' | 'neutral';

const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const;
const BUTTON_SIZES = ['sm', 'md', 'lg'] as const;
const BADGE_TONES: Tone[] = ['accent', 'success', 'warning', 'danger', 'actor', 'neutral'];
const PILL_TONES: Tone[] = ['accent', 'success', 'warning', 'danger', 'actor', 'neutral'];
const BANNER_TONES = ['accent', 'warning', 'danger', 'success'] as const;

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <p className="tp-eyebrow">{label}</p>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

export default function KitchenSinkPage() {
  const [theme, setTheme] = useState<Theme>('light');
  const [segNeutral, setSegNeutral] = useState('comfortable');
  const [segAccent, setSegAccent] = useState('light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="min-h-dvh bg-bg px-8 py-10">
      <div className="mx-auto flex max-w-[1000px] flex-col gap-10">
        <header className="flex items-center justify-between border-b border-border pb-5">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
              Kitchen sink
            </h1>
            <p className="text-sm text-ink-2">Every design-system primitive, light and dark.</p>
          </div>
          <Segmented
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={theme}
            onChange={(v) => setTheme(v as Theme)}
          />
        </header>

        <Section label="Button — variants × sizes">
          {BUTTON_SIZES.map((size) => (
            <Row key={size}>
              {BUTTON_VARIANTS.map((variant) => (
                <Button key={variant} variant={variant} size={size}>
                  {variant} {size}
                </Button>
              ))}
            </Row>
          ))}
          <Row>
            <Button variant="primary" icon={<Star />}>
              With icon
            </Button>
            <Button variant="secondary" kbd="⌘↵">
              With kbd
            </Button>
            <Button variant="primary" icon={<ArrowRight />} kbd="↵">
              Icon + kbd
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
          </Row>
          <div className="max-w-xs">
            <Button variant="primary" fullWidth>
              Full width
            </Button>
          </div>
        </Section>

        <Section label="IconButton — sizes + active">
          <Row>
            <IconButton size="sm" title="Search">
              <Search />
            </IconButton>
            <IconButton size="md" title="Search">
              <Search />
            </IconButton>
            <IconButton size="lg" title="Search">
              <Search />
            </IconButton>
            <IconButton size="md" title="Settings" active>
              <Settings />
            </IconButton>
            <IconButton size="md" title="Settings" disabled>
              <Settings />
            </IconButton>
          </Row>
        </Section>

        <Section label="Input — sizes, icon, mono">
          <div className="flex max-w-md flex-col gap-3">
            <Input size="sm" placeholder="Small input" />
            <Input size="md" placeholder="Medium input" />
            <Input icon={<Search />} placeholder="Search threads" />
            <Input mono placeholder="github.com/org/repo" defaultValue="github.com/tempo/console" />
            <Input placeholder="Disabled" disabled />
          </div>
        </Section>

        <Section label="Segmented — neutral + accent">
          <Row>
            <Segmented
              options={['compact', 'comfortable']}
              value={segNeutral}
              onChange={setSegNeutral}
            />
            <Segmented
              variant="accent"
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'auto', label: 'Auto' },
              ]}
              value={segAccent}
              onChange={setSegAccent}
            />
          </Row>
        </Section>

        <Section label="Badge — tones">
          <Row>
            {BADGE_TONES.map((tone) => (
              <Badge key={tone} tone={tone}>
                {tone}
              </Badge>
            ))}
          </Row>
          <Row>
            <Badge tone="accent" mono>
              tier 2
            </Badge>
            <Badge tone="danger" uppercase>
              high
            </Badge>
            <Badge tone="warning" uppercase>
              medium
            </Badge>
            <Badge tone="neutral" mono>
              PROJ-123
            </Badge>
          </Row>
        </Section>

        <Section label="Pill — tones, dot, pulse">
          <Row>
            {PILL_TONES.map((tone) => (
              <Pill key={tone} tone={tone}>
                {tone}
              </Pill>
            ))}
          </Row>
          <Row>
            <Pill tone="success" pulse>
              Agent live
            </Pill>
            <Pill tone="warning">Disconnected</Pill>
            <Pill tone="neutral" dot={false}>
              No dot
            </Pill>
          </Row>
        </Section>

        <Section label="Card — flat, interactive, with header">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card>
              <p className="text-base text-ink">Flat card — canvas, 1px border, no shadow.</p>
            </Card>
            <Card interactive>
              <p className="text-base text-ink">Interactive — hover lifts the border.</p>
            </Card>
            <Card title="Plan" meta="App.tsx:62">
              <p className="text-base text-ink-2">Card with a display title and mono meta.</p>
            </Card>
            <Card title="Tighter" padding={10}>
              <p className="text-base text-ink-2">Custom 10px padding.</p>
            </Card>
          </div>
        </Section>

        <Section label="Banner — tones, icon, action">
          <Banner tone="warning" action={{ label: 'Reconnect' }}>
            Disconnected — reconnect to keep planning.
          </Banner>
          {BANNER_TONES.map((tone) => (
            <Banner key={tone} tone={tone} icon={<Star />}>
              This is a {tone} banner notice.
            </Banner>
          ))}
        </Section>

        <Section label="Avatar — user, agent, sizes">
          <Row>
            <Avatar name="Ada Lovelace" size={20} />
            <Avatar name="Ada Lovelace" size={28} />
            <Avatar name="Ada Lovelace" size={36} />
            <Avatar kind="agent" name="Tempo agent" size={20} />
            <Avatar kind="agent" name="Tempo agent" size={28} />
            <Avatar kind="agent" name="Tempo agent" size={36} />
          </Row>
        </Section>

        <Section label="CodeInline — default + accent">
          <p className="text-base text-ink-2">
            Run <CodeInline>tempo thread new</CodeInline> to start, then cite{' '}
            <CodeInline accent>PROJ-123</CodeInline> in the plan.
          </p>
        </Section>
      </div>
    </div>
  );
}
