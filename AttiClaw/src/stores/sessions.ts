import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ConversationSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  isPinned: boolean;
  isArchived: boolean;
}

interface SessionsState {
  sessions: ConversationSession[];
  activeSessionId: string | null;

  setActiveSession: (id: string | null) => void;
  createSession: () => ConversationSession;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
  pinSession: (id: string) => void;
  archiveSession: (id: string) => void;
  unarchiveSession: (id: string) => void;
}

const now = Date.now();

const DEFAULT_SESSIONS: ConversationSession[] = [
  {
    id: "session-1",
    title: "Getting started with AttiClaw",
    createdAt: now - 1000 * 60 * 60 * 24 * 2,
    updatedAt: now - 1000 * 60 * 60 * 24 * 2,
    isPinned: true,
    isArchived: false,
  },
  {
    id: "session-2",
    title: "Model comparison: Llama vs Mistral",
    createdAt: now - 1000 * 60 * 60 * 24,
    updatedAt: now - 1000 * 60 * 60 * 24,
    isPinned: true,
    isArchived: false,
  },
  {
    id: "session-3",
    title: "NVMe cache configuration",
    createdAt: now - 1000 * 60 * 60 * 5,
    updatedAt: now - 1000 * 60 * 60 * 5,
    isPinned: false,
    isArchived: false,
  },
  {
    id: "session-4",
    title: "Repository import workflow",
    createdAt: now - 1000 * 60 * 60 * 3,
    updatedAt: now - 1000 * 60 * 60 * 3,
    isPinned: false,
    isArchived: false,
  },
  {
    id: "session-5",
    title: "SMB storage setup",
    createdAt: now - 1000 * 60 * 90,
    updatedAt: now - 1000 * 60 * 90,
    isPinned: false,
    isArchived: false,
  },
  {
    id: "session-6",
    title: "Skills directory exploration",
    createdAt: now - 1000 * 60 * 30,
    updatedAt: now - 1000 * 60 * 30,
    isPinned: false,
    isArchived: false,
  },
  {
    id: "session-7",
    title: "Old embedding experiment",
    createdAt: now - 1000 * 60 * 60 * 24 * 7,
    updatedAt: now - 1000 * 60 * 60 * 24 * 7,
    isPinned: false,
    isArchived: true,
  },
];

export const useSessionsStore = create<SessionsState>()(
  persist(
    (set, get) => ({
      sessions: DEFAULT_SESSIONS,
      activeSessionId: DEFAULT_SESSIONS[2].id,

      setActiveSession: (id) => set({ activeSessionId: id }),

      createSession: () => {
        const session: ConversationSession = {
          id: `session-${Date.now()}`,
          title: "New conversation",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isPinned: false,
          isArchived: false,
        };
        set((state) => ({ sessions: [session, ...state.sessions], activeSessionId: session.id }));
        return session;
      },

      renameSession: (id, title) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, title, updatedAt: Date.now() } : s,
          ),
        }));
      },

      deleteSession: (id) => {
        set((state) => {
          const remaining = state.sessions.filter((s) => s.id !== id);
          const activeId =
            state.activeSessionId === id
              ? (remaining.find((s) => !s.isArchived)?.id ?? null)
              : state.activeSessionId;
          return { sessions: remaining, activeSessionId: activeId };
        });
      },

      pinSession: (id) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, isPinned: !s.isPinned, isArchived: false } : s,
          ),
        }));
      },

      archiveSession: (id) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, isArchived: true, isPinned: false } : s,
          ),
        }));
      },

      unarchiveSession: (id) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, isArchived: false } : s,
          ),
        }));
      },
    }),
    {
      name: "atticlaw-sessions",
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
    },
  ),
);
