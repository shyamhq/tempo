'use client';

// The hover-revealed kebab menu on a space / thread row: rename, move-to (thread
// only), delete. Presentational — it emits a MenuAction the parent row maps to a
// sidebar slice action.

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { Space } from '@tempo/contracts';
import { ChevronRight, MoreHorizontal, MoveRight, Pencil, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { colorForSpace } from '@/lib/space-color';
import { cn } from '@/lib/utils';

export type MenuAction =
  | { kind: 'rename' }
  | { kind: 'delete' }
  | { kind: 'move'; toSpaceId: string };

export function RowMenu({
  kind,
  spaceId,
  spaces,
  onAction,
}: {
  kind: 'space' | 'thread';
  spaceId?: string;
  spaces?: Space[];
  onAction: (a: MenuAction) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Row options"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          className="inline-flex size-6 items-center justify-center rounded-sm text-ink-3 hover:bg-canvas hover:text-ink data-[state=open]:bg-canvas data-[state=open]:text-ink"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[190px] rounded-md border border-border bg-canvas p-[5px] shadow-[var(--tp-shadow-lg)]"
        >
          <MenuItem onSelect={() => onAction({ kind: 'rename' })}>
            <Pencil className="size-[15px] text-ink-3" />
            Rename
          </MenuItem>

          {kind === 'thread' && spaces ? (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className={subTriggerCls}>
                <MoveRight className="size-[15px] text-ink-3" />
                Move to
                <ChevronRight className="ml-auto size-3 text-ink-3" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  sideOffset={6}
                  className="z-50 min-w-[180px] rounded-md border border-border bg-canvas p-[5px] shadow-[var(--tp-shadow-lg)]"
                >
                  {spaces
                    .filter((s) => s.id !== spaceId)
                    .map((s) => (
                      <MenuItem
                        key={s.id}
                        onSelect={() => onAction({ kind: 'move', toSpaceId: s.id })}
                      >
                        <span
                          className="size-[9px] rounded-xs"
                          style={{ background: colorForSpace(s.id) }}
                        />
                        <span className="truncate">{s.name}</span>
                      </MenuItem>
                    ))}
                  {spaces.length <= 1 ? (
                    <div className="px-2 py-2 text-2xs text-ink-3">No other spaces</div>
                  ) : null}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          ) : null}

          <DropdownMenu.Separator className="my-1 h-px bg-border" />

          <MenuItem danger onSelect={() => onAction({ kind: 'delete' })}>
            <Trash2 className="size-[15px]" />
            Delete
          </MenuItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const subTriggerCls = cn(
  'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-sm text-ink-2 outline-none',
  'data-[state=open]:bg-inset data-[highlighted]:bg-inset data-[highlighted]:text-ink',
);

function MenuItem({
  children,
  onSelect,
  danger,
}: {
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm outline-none',
        danger
          ? 'text-danger data-[highlighted]:bg-danger-bg'
          : 'text-ink-2 data-[highlighted]:bg-inset data-[highlighted]:text-ink',
      )}
    >
      {children}
    </DropdownMenu.Item>
  );
}
