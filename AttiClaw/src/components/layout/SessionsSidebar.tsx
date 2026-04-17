import {
  Archive,
  ArchiveX,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PawPrint,
  Pencil,
  Pin,
  PinOff,
  Settings,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import type { ConversationSession } from "@/stores/sessions";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 select-none">
      {label}
    </p>
  );
}

// ── Session Item ─────────────────────────────────────────────────────────────

function SessionItem({
  session,
  isActive,
  collapsed,
  onSelect,
  onRename,
  onPin,
  onArchive,
  onDelete,
}: {
  session: ConversationSession;
  isActive: boolean;
  collapsed: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  const commitRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.title) {
      onRename(trimmed);
    } else {
      setEditValue(session.title);
    }
    setEditing(false);
  };

  if (collapsed) {
    return (
      <button
        onClick={onSelect}
        title={session.title}
        className={cn(
          "w-full flex items-center justify-center h-9 rounded-md transition-colors",
          isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
        )}
      >
        <span className="text-xs font-bold">
          {session.title.slice(0, 2).toUpperCase()}
        </span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex items-center gap-1 rounded-md px-2 py-1.5 cursor-pointer transition-colors",
        isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
      onClick={() => !editing && onSelect()}
    >
      {editing ? (
        <Input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setEditValue(session.title);
              setEditing(false);
            }
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          className="h-6 px-1 py-0 text-sm border-none bg-transparent focus-visible:ring-1 w-full"
          autoFocus
        />
      ) : (
        <span className="flex-1 text-sm truncate leading-snug">{session.title}</span>
      )}

      {/* 3-dot menu — visible on hover or when active */}
      {!editing && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "shrink-0 h-6 w-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent",
                isActive && "opacity-100",
              )}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-44">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
                setEditValue(session.title);
              }}
            >
              <Pencil className="h-4 w-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onPin();
              }}
            >
              {session.isPinned ? (
                <>
                  <PinOff className="h-4 w-4" /> Unpin
                </>
              ) : (
                <>
                  <Pin className="h-4 w-4" /> Pin
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onArchive();
              }}
            >
              {session.isArchived ? (
                <>
                  <ArchiveX className="h-4 w-4" /> Unarchive
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4" /> Archive
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SessionsSidebar() {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const {
    sessions,
    activeSessionId,
    setActiveSession,
    createSession,
    renameSession,
    deleteSession,
    pinSession,
    archiveSession,
    unarchiveSession,
  } = useSessionsStore();

  const profile = useSettingsStore((s) => s.profile);

  // Split sessions into categories
  const pinned = sessions.filter((s) => s.isPinned && !s.isArchived);
  const active = sessions.filter((s) => !s.isPinned && !s.isArchived);
  const archived = sessions.filter((s) => s.isArchived);

  const handleNewChat = () => {
    createSession();
    navigate("/chat");
  };

  const handleSelectSession = (id: string) => {
    setActiveSession(id);
    navigate("/chat");
  };

  const handleGearClick = () => {
    navigate("/settings");
  };

  return (
    <aside
      className={cn(
        "flex flex-col bg-card border-r border-border transition-all duration-200 shrink-0",
        collapsed ? "w-14" : "w-64",
      )}
    >
      {/* ── Top: Logo + collapse toggle ──────────────────────────────── */}
      <div
        className={cn(
          "flex items-center h-14 border-b border-border px-3 shrink-0",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <PawPrint className="h-6 w-6 shrink-0 text-primary" />
          {!collapsed && (
            <span className="text-lg font-semibold tracking-tight truncate">AttiClaw</span>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground transition-colors"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── New Chat button ───────────────────────────────────────────── */}
      <div className={cn("p-2 shrink-0", collapsed && "flex justify-center")}>
        {collapsed ? (
          <button
            onClick={handleNewChat}
            title="New conversation"
            className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground transition-colors"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 justify-start"
            onClick={handleNewChat}
          >
            <MessageSquarePlus className="h-4 w-4" />
            New conversation
          </Button>
        )}
      </div>

      {/* ── Session list ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1 py-1">
        {/* Pinned */}
        {pinned.length > 0 && (
          <div className="space-y-0.5">
            {!collapsed && <SectionLabel label="Pinned" />}
            {pinned.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                collapsed={collapsed}
                onSelect={() => handleSelectSession(session.id)}
                onRename={(title) => renameSession(session.id, title)}
                onPin={() => pinSession(session.id)}
                onArchive={() => archiveSession(session.id)}
                onDelete={() => deleteSession(session.id)}
              />
            ))}
          </div>
        )}

        {/* Active conversations */}
        {active.length > 0 && (
          <div className="space-y-0.5">
            {!collapsed && <SectionLabel label="Conversations" />}
            {active.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                collapsed={collapsed}
                onSelect={() => handleSelectSession(session.id)}
                onRename={(title) => renameSession(session.id, title)}
                onPin={() => pinSession(session.id)}
                onArchive={() => archiveSession(session.id)}
                onDelete={() => deleteSession(session.id)}
              />
            ))}
          </div>
        )}

        {/* Archived */}
        {archived.length > 0 && (
          <div className="space-y-0.5">
            {!collapsed && <SectionLabel label="Archived" />}
            {archived.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                collapsed={collapsed}
                onSelect={() => handleSelectSession(session.id)}
                onRename={(title) => renameSession(session.id, title)}
                onPin={() => pinSession(session.id)}
                onArchive={() => unarchiveSession(session.id)}
                onDelete={() => deleteSession(session.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Bottom: Avatar + name + gear ─────────────────────────────── */}
      <div className={cn("border-t border-border p-3 shrink-0")}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            {/* Expand button */}
            <button
              onClick={() => setCollapsed(false)}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground transition-colors"
              title="Expand sidebar"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
            {/* Avatar */}
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold select-none">
              {getInitials(profile.name)}
            </div>
            {/* Gear */}
            <button
              onClick={handleGearClick}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground transition-colors"
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {/* Avatar */}
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold shrink-0 select-none">
              {getInitials(profile.name)}
            </div>
            {/* Name */}
            <span className="flex-1 text-sm font-medium truncate" title={profile.name}>
              {profile.name}
            </span>
            {/* Gear icon */}
            <button
              onClick={handleGearClick}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground transition-colors shrink-0"
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
