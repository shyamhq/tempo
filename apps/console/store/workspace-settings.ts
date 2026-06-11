'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export type SettingsSection = 'general' | 'members' | 'billing' | 'integrations' | 'danger';

interface WorkspaceSettingsState {
  open: boolean;
  section: SettingsSection;
  selectedMemberId: string | null;
  openModal: (section?: SettingsSection) => void;
  closeModal: () => void;
  setSection: (section: SettingsSection) => void;
  selectMember: (id: string | null) => void;
}

export const useWorkspaceSettings = create<WorkspaceSettingsState>()(
  devtools(
    (set) => ({
      open: false,
      section: 'general',
      selectedMemberId: null,
      openModal: (section = 'general') =>
        set({ open: true, section, selectedMemberId: null }, undefined, 'ws-settings/open'),
      closeModal: () => set({ open: false }, undefined, 'ws-settings/close'),
      setSection: (section) =>
        set({ section, selectedMemberId: null }, undefined, 'ws-settings/setSection'),
      selectMember: (id) => set({ selectedMemberId: id }, undefined, 'ws-settings/selectMember'),
    }),
    { name: 'workspace-settings', enabled: process.env.NODE_ENV !== 'production' },
  ),
);
