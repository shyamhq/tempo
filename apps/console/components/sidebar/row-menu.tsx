'use client';

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
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-subtle hover:bg-canvas hover:text-ink data-[state=open]:bg-canvas data-[state=open]:text-ink"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[190px] rounded-md border border-hairline bg-canvas p-[5px] shadow-[0_1px_2px_rgba(10,11,13,0.04),0_12px_32px_-8px_rgba(10,11,13,0.22)]"
        >
          <MenuItem onSelect={() => onAction({ kind: 'rename' })}>
            <Pencil className="size-icon-sm text-ink-subtle" />
            Rename
          </MenuItem>

          {kind === 'thread' && spaces ? (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className={subTriggerCls}>
                <MoveRight className="size-icon-sm text-ink-subtle" />
                Move to
                <ChevronRight className="ml-auto h-3 w-3 text-ink-tertiary" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  sideOffset={6}
                  className="z-50 min-w-[180px] rounded-md border border-hairline bg-canvas p-[5px] shadow-[0_1px_2px_rgba(10,11,13,0.04),0_12px_32px_-8px_rgba(10,11,13,0.22)]"
                >
                  {spaces
                    .filter((s) => s.id !== spaceId)
                    .map((s) => (
                      <MenuItem
                        key={s.id}
                        onSelect={() => onAction({ kind: 'move', toSpaceId: s.id })}
                      >
                        <span
                          className="h-[9px] w-[9px] rounded-xs"
                          style={{ background: colorForSpace(s.id) }}
                        />
                        <span className="truncate">{s.name}</span>
                      </MenuItem>
                    ))}
                  {spaces.length <= 1 ? (
                    <div className="px-2 py-2 text-micro font-normal text-ink-tertiary">
                      No other spaces
                    </div>
                  ) : null}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          ) : null}

          <DropdownMenu.Separator className="my-1 h-px bg-hairline" />

          <MenuItem danger onSelect={() => onAction({ kind: 'delete' })}>
            <Trash2 className="size-icon-sm" />
            Delete
          </MenuItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const subTriggerCls = cn(
  'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-body-sm text-ink-muted outline-none',
  'data-[state=open]:bg-surface-2 data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink',
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
        'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-body-sm outline-none cursor-pointer',
        danger
          ? 'text-danger data-[highlighted]:bg-danger-soft'
          : 'text-ink-muted data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink',
      )}
    >
      {children}
    </DropdownMenu.Item>
  );
}
