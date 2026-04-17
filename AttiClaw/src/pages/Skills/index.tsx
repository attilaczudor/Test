import {
  CheckCircle2,
  Clock,
  ExternalLink,
  FolderGit2,
  GitFork,
  Globe,
  Layers,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Download,
  Zap,
  CalendarDays,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import UpdateSidebar from "@/components/UpdateSidebar";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useReposStore } from "@/stores/repos";
import type { RepoLabel, RepoSource } from "@/stores/repos";

// ── Label color mapping ─────────────────────────────────────────────────────

const LABEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  orange: {
    bg: "bg-orange-500/15",
    text: "text-orange-400",
    border: "border-orange-500/30",
  },
  purple: {
    bg: "bg-purple-500/15",
    text: "text-purple-400",
    border: "border-purple-500/30",
  },
  blue: {
    bg: "bg-blue-500/15",
    text: "text-blue-400",
    border: "border-blue-500/30",
  },
  green: {
    bg: "bg-green-500/15",
    text: "text-green-400",
    border: "border-green-500/30",
  },
  red: {
    bg: "bg-red-500/15",
    text: "text-red-400",
    border: "border-red-500/30",
  },
  yellow: {
    bg: "bg-yellow-500/15",
    text: "text-yellow-400",
    border: "border-yellow-500/30",
  },
  pink: {
    bg: "bg-pink-500/15",
    text: "text-pink-400",
    border: "border-pink-500/30",
  },
  cyan: {
    bg: "bg-cyan-500/15",
    text: "text-cyan-400",
    border: "border-cyan-500/30",
  },
};

const AVAILABLE_COLORS = Object.keys(LABEL_COLORS);

function getLabelStyle(color: string) {
  return LABEL_COLORS[color] ?? LABEL_COLORS.blue;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ParsedRepo {
  name: string;
  owner: string;
  host: string;
  description: string;
}

function parseRepoUrl(url: string): ParsedRepo | null {
  try {
    const u = new URL(url.trim());
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const owner = parts[0];
      const name = parts[1].replace(/\.git$/, "");
      return {
        owner,
        name,
        host: u.hostname,
        description: `${owner}/${name} — repository hosted on ${u.hostname}`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── Label Badge Component ───────────────────────────────────────────────────

function LabelBadge({
  label,
  removable,
  onRemove,
}: {
  label: RepoLabel;
  removable?: boolean;
  onRemove?: () => void;
}) {
  const style = getLabelStyle(label.color);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border",
        style.bg,
        style.text,
        style.border,
      )}
    >
      {label.name}
      {removable && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 hover:opacity-70"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

// ── Plugin capabilities strip ────────────────────────────────────────────────

function CapabilityStrip({ source }: { source: RepoSource }) {
  const { t } = useTranslation("skills");
  const caps = source.pluginMeta?.capabilities ?? [];
  const isCore = source.pluginMeta?.isCore;

  if (caps.length === 0 && !isCore) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {isCore && (
        <span className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold bg-primary/15 text-primary border border-primary/30 uppercase tracking-wide">
          <Shield className="h-2.5 w-2.5" />
          {t("plugin.core")}
        </span>
      )}
      {caps.slice(0, 3).map((cap) => (
        <span
          key={cap.id}
          title={cap.description}
          className="inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground border border-border"
        >
          {cap.name}
        </span>
      ))}
      {caps.length > 3 && (
        <span className="inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground border border-border">
          +{caps.length - 3}
        </span>
      )}
    </div>
  );
}

// ── Implementation Status Badge ─────────────────────────────────────────────

function ImplementationBadge({ status }: { status?: "implemented" | "deferred" }) {
  if (status === "implemented") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border bg-green-500/15 text-green-400 border-green-500/30">
        <CheckCircle2 className="h-3 w-3" />
        Implemented
      </span>
    );
  }
  if (status === "deferred") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border bg-yellow-500/15 text-yellow-400 border-yellow-500/30">
        <Clock className="h-3 w-3" />
        Not Implemented
      </span>
    );
  }
  return null;
}

// ── Source Card Component ────────────────────────────────────────────────────

function SourceCard({
  source,
  labels,
  implementingId,
  onTogglePin,
  onRemove,
  onManageLabels,
  onUpdate,
}: {
  source: RepoSource;
  labels: RepoLabel[];
  implementingId: string | null;
  onTogglePin: () => void;
  onRemove: () => void;
  onManageLabels: () => void;
  onUpdate: () => void;
}) {
  const { t } = useTranslation("skills");
  const sourceLabels = labels.filter((l) => source.labels.includes(l.id));
  const isUpdating = implementingId === source.id;

  return (
    <Card className="group relative flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {source.isSubmodule ? (
              <FolderGit2 className="h-5 w-5 shrink-0 text-muted-foreground" />
            ) : (
              <Globe className="h-5 w-5 shrink-0 text-muted-foreground" />
            )}
            <CardTitle className="text-base truncate">{source.name}</CardTitle>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onTogglePin}>
              {source.isPinned ? (
                <PinOff className="h-3.5 w-3.5" />
              ) : (
                <Pin className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Plugin capability badges */}
        <CapabilityStrip source={source} />
      </CardHeader>

      <CardContent className="flex flex-col flex-1 space-y-3">
        <p className="text-sm text-muted-foreground line-clamp-2">{source.description}</p>

        {/* Labels */}
        <div className="flex flex-wrap gap-1.5">
          {sourceLabels.map((label) => (
            <LabelBadge key={label.id} label={label} />
          ))}
        </div>

        {/* Implementation status + dates */}
        <div className="flex flex-wrap items-center gap-2">
          <ImplementationBadge status={source.implementationStatus} />
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <CalendarDays className="h-3 w-3" />
            Added {formatDate(source.addedAt)}
          </span>
          {source.implementedAt && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {source.implementationStatus === "implemented" ? "Implemented" : "Deferred"}{" "}
              {formatDate(source.implementedAt)}
            </span>
          )}
        </div>

        {/* Metadata row */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {source.stars !== undefined && source.stars > 0 && (
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" />
              {source.stars.toLocaleString()}
            </span>
          )}
          {source.language && <span>{source.language}</span>}
          {source.isSubmodule && source.submodulePath && (
            <span className="flex items-center gap-1">
              <GitFork className="h-3 w-3" />
              {source.submodulePath}
            </span>
          )}
          {source.currentVersion && (
            <span className="font-mono">
              {t("plugin.version", { version: source.currentVersion })}
            </span>
          )}
        </div>

        {/* Last updated */}
        {source.lastUpdated && (
          <p className="text-[11px] text-muted-foreground">
            {t("plugin.lastUpdated", {
              date: new Date(source.lastUpdated).toLocaleDateString(),
            })}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1 mt-auto flex-wrap">
          <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3 mr-1" />
              {t("actions.open")}
            </a>
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onManageLabels}>
            <Tag className="h-3 w-3 mr-1" />
            {t("actions.labels")}
          </Button>

          {/* Update button — available for all plugins including openclaw core */}
          <Button
            size="sm"
            variant="outline"
            className={cn(
              "h-7 text-xs",
              source.pluginMeta?.isCore
                ? "border-primary/40 text-primary hover:bg-primary/10"
                : "border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10",
            )}
            onClick={onUpdate}
            disabled={isUpdating}
          >
            {isUpdating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <RefreshCw className="h-3 w-3 mr-1" />
                {t("actions.update")}
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive ml-auto"
            onClick={onRemove}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Import Preview Sidebar ───────────────────────────────────────────────────

function ImportPreviewSidebar({
  preview,
  url,
  onImplementNow,
  onImplementLater,
  onClose,
  isImplementing,
}: {
  preview: ParsedRepo;
  url: string;
  onImplementNow: () => void;
  onImplementLater: () => void;
  onClose: () => void;
  isImplementing: boolean;
}) {
  return (
    <div className="w-80 shrink-0 border-l border-border bg-card flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold">Repository Preview</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Summary */}
      <div className="flex-1 p-4 space-y-4">
        {/* Repo icon + name */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Globe className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{preview.name}</p>
            <p className="text-xs text-muted-foreground truncate">{preview.owner}</p>
          </div>
        </div>

        <Separator />

        {/* Details */}
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Description
            </p>
            <p className="text-sm text-foreground">{preview.description}</p>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              URL
            </p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline break-all flex items-start gap-1"
            >
              <LinkIcon className="h-3 w-3 mt-0.5 shrink-0" />
              {url}
            </a>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Host
            </p>
            <p className="text-sm">{preview.host}</p>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Owner
            </p>
            <p className="text-sm">{preview.owner}</p>
          </div>
        </div>

        <Separator />

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            The repository will be saved to your list. Choose how you'd like to proceed:
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="p-4 border-t border-border space-y-2">
        <Button
          className="w-full gap-2"
          onClick={onImplementNow}
          disabled={isImplementing}
        >
          {isImplementing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Zap className="h-4 w-4" />
          )}
          Implement Now
        </Button>
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={onImplementLater}
          disabled={isImplementing}
        >
          <Clock className="h-4 w-4" />
          Implement Later
        </Button>
      </div>
    </div>
  );
}

// ── Skills-only tab (within Repositories page) ───────────────────────────────

type SkillFilter = "all" | "active" | "inactive";

function RepoSkillDetailPanel({
  skill,
  onClose,
}: {
  skill: RepoSource;
  onClose: () => void;
}) {
  const { toggleActive } = useReposStore();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      toast.success(`${skill.name} refreshed`);
    }, 1000);
  };

  const handleToggle = () => {
    toggleActive(skill.id);
    toast.success(skill.isActive ? `${skill.name} deactivated` : `${skill.name} activated`);
  };

  return (
    <div className="w-80 shrink-0 border-l border-border bg-card flex flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold truncate pr-2">{skill.name}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 p-4 space-y-5 overflow-y-auto">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-purple-500/15 flex items-center justify-center shrink-0">
            <Layers className="h-6 w-6 text-purple-400" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm">{skill.name}</p>
            <span
              className={cn(
                "inline-block mt-0.5 rounded-full px-2 py-0.5 text-xs font-medium",
                skill.isActive ? "bg-green-500/15 text-green-400" : "bg-muted text-muted-foreground",
              )}
            >
              {skill.isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </div>

        <Separator />

        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Description</p>
          <p className="text-sm">{skill.description || "No description available."}</p>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">URL</p>
          <a
            href={skill.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline break-all flex items-start gap-1"
          >
            <LinkIcon className="h-3 w-3 mt-0.5 shrink-0" />
            {skill.url}
          </a>
        </div>

        {(skill.owner || skill.language || (skill.stars !== undefined && skill.stars > 0)) && (
          <div className="grid grid-cols-2 gap-3">
            {skill.owner && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Owner</p>
                <p className="text-sm">{skill.owner}</p>
              </div>
            )}
            {skill.language && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Language</p>
                <p className="text-sm">{skill.language}</p>
              </div>
            )}
            {skill.stars !== undefined && skill.stars > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Stars</p>
                <p className="text-sm flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 text-yellow-400" />
                  {skill.stars.toLocaleString()}
                </p>
              </div>
            )}
          </div>
        )}

        {skill.upstreamUrl && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Upstream</p>
            <a
              href={skill.upstreamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1 truncate"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{skill.upstreamUrl}</span>
            </a>
          </div>
        )}

        <Separator />

        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Implementation</p>
          <ImplementationBadge status={skill.implementationStatus} />
          {!skill.implementationStatus && (
            <span className="text-xs text-muted-foreground">Not set</span>
          )}
        </div>
      </div>

      <div className="p-4 border-t border-border space-y-2">
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          Refresh
        </Button>
        <Button
          className={cn(
            "w-full gap-2",
            skill.isActive ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" : "",
          )}
          onClick={handleToggle}
        >
          <Layers className="h-4 w-4" />
          {skill.isActive ? "Deactivate" : "Activate"}
        </Button>
      </div>
    </div>
  );
}

function RepoSkillCard({
  skill,
  isSelected,
  onClick,
}: {
  skill: RepoSource;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { toggleActive } = useReposStore();

  return (
    <Card
      onClick={onClick}
      className={cn(
        "cursor-pointer transition-colors hover:border-purple-500/50",
        isSelected && "border-purple-500 ring-1 ring-purple-500/30",
      )}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
              <Layers className="h-4 w-4 text-purple-400" />
            </div>
            <p className="font-medium text-sm truncate">{skill.name}</p>
          </div>
          <Switch
            checked={!!skill.isActive}
            onCheckedChange={() => {
              toggleActive(skill.id);
              toast.success(skill.isActive ? `${skill.name} deactivated` : `${skill.name} activated`);
            }}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0"
          />
        </div>

        <p className="text-xs text-muted-foreground line-clamp-2">
          {skill.description || "No description."}
        </p>

        <div className="flex items-center justify-between">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              skill.isActive ? "bg-green-500/15 text-green-400" : "bg-muted text-muted-foreground",
            )}
          >
            {skill.isActive ? "Active" : "Inactive"}
          </span>
          <div className="flex items-center gap-2">
            {skill.stars !== undefined && skill.stars > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Star className="h-3 w-3" />
                {skill.stars.toLocaleString()}
              </span>
            )}
            {skill.implementationStatus && (
              <ImplementationBadge status={skill.implementationStatus} />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SkillsOnlyTab() {
  const { sources: liveSources, labels } = useReposStore();

  const skillLabel = labels.find((l) => l.id === "skill");
  const allSkills = skillLabel ? liveSources.filter((s) => s.labels.includes(skillLabel.id)) : [];

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedSkill = selectedId ? liveSources.find((s) => s.id === selectedId) ?? null : null;

  const filtered = allSkills.filter((s) => {
    const matchesSearch =
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase());
    const matchesFilter =
      filter === "all" ||
      (filter === "active" && s.isActive) ||
      (filter === "inactive" && !s.isActive);
    return matchesSearch && matchesFilter;
  });

  const activeCount = allSkills.filter((s) => s.isActive).length;
  const inactiveCount = allSkills.filter((s) => !s.isActive).length;

  const chips: { key: SkillFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: allSkills.length },
    { key: "active", label: "Active", count: activeCount },
    { key: "inactive", label: "Inactive", count: inactiveCount },
  ];

  return (
    <div className="flex gap-0">
      <div className="flex-1 min-w-0 space-y-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex gap-2">
          {chips.map((chip) => (
            <button
              key={chip.key}
              onClick={() => setFilter(chip.key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                filter === chip.key
                  ? "bg-purple-500/15 text-purple-400 border-purple-500/40"
                  : "bg-muted text-muted-foreground border-border hover:bg-accent",
              )}
            >
              {chip.label} ({chip.count})
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Layers className="h-10 w-10 opacity-30 mb-3" />
            <p>No skills match your filters.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((skill) => (
              <RepoSkillCard
                key={skill.id}
                skill={skill}
                isSelected={selectedId === skill.id}
                onClick={() => setSelectedId((prev) => (prev === skill.id ? null : skill.id))}
              />
            ))}
          </div>
        )}
      </div>

      {selectedSkill && (
        <RepoSkillDetailPanel
          skill={selectedSkill}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

// ── Main Repositories Page ──────────────────────────────────────────────────

export default function SkillsPage() {
  const { t } = useTranslation("skills");
  const {
    labels,
    selectedLabel,
    searchQuery,
    updatePlan,
    pendingUpdateId,
    implementingUpdateId,
    setSelectedLabel,
    setSearchQuery,
    getFilteredSources,
    addSource,
    removeSource,
    togglePin,
    createLabel,
    updateLabel,
    deleteLabel,
    addLabelToSource,
    removeLabelFromSource,
    triggerUpdate,
    implementUpdate,
    dismissUpdate,
    setImplementationStatus,
  } = useReposStore();

  const filteredSources = getFilteredSources();

  // Dialog states
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [manageLabelOpen, setManageLabelOpen] = useState(false);
  const [createLabelOpen, setCreateLabelOpen] = useState(false);
  const [sourceLabelTarget, setSourceLabelTarget] = useState<string | null>(null);

  // Add source form
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [newSourceDesc, setNewSourceDesc] = useState("");
  const [newSourceLabels, setNewSourceLabels] = useState<string[]>([]);

  // Create label form
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("blue");

  // Edit label
  const [editingLabel, setEditingLabel] = useState<RepoLabel | null>(null);

  // Import URL state
  const [importUrl, setImportUrl] = useState("");
  const [importPreview, setImportPreview] = useState<ParsedRepo | null>(null);
  const [pendingImportUrl, setPendingImportUrl] = useState("");
  const [isImplementing, setIsImplementing] = useState(false);

  const resetAddForm = () => {
    setNewSourceName("");
    setNewSourceUrl("");
    setNewSourceDesc("");
    setNewSourceLabels([]);
  };

  const handleAddSource = () => {
    if (!newSourceName.trim() || !newSourceUrl.trim()) {
      return;
    }
    addSource({
      id: `custom-${newSourceName.toLowerCase().replace(/\s+/g, "-")}`,
      name: newSourceName.trim(),
      url: newSourceUrl.trim(),
      description: newSourceDesc.trim(),
      labels: newSourceLabels,
      isPinned: false,
      isSubmodule: false,
    });
    resetAddForm();
    setAddSourceOpen(false);
  };

  const handleCreateLabel = () => {
    if (!newLabelName.trim()) {
      return;
    }
    createLabel(newLabelName.trim(), newLabelColor);
    setNewLabelName("");
    setNewLabelColor("blue");
    setCreateLabelOpen(false);
  };

  const handleUpdateLabel = () => {
    if (!editingLabel || !newLabelName.trim()) {
      return;
    }
    updateLabel(editingLabel.id, { name: newLabelName.trim(), color: newLabelColor });
    setEditingLabel(null);
    setNewLabelName("");
    setNewLabelColor("blue");
  };

  // ── Import flow ────────────────────────────────────────────────────────────

  const handleImportPreview = () => {
    const url = importUrl.trim();
    if (!url) return;

    const parsed = parseRepoUrl(url);
    if (!parsed) {
      toast.error("Invalid URL", {
        description: "Please enter a valid repository URL (e.g. https://github.com/owner/repo)",
      });
      return;
    }

    setPendingImportUrl(url);
    setImportPreview(parsed);
  };

  const saveImportedRepo = (status: "implemented" | "deferred") => {
    if (!importPreview || !pendingImportUrl) return;

    const id = `import-${importPreview.owner}-${importPreview.name}-${Date.now()}`;
    addSource({
      id,
      name: importPreview.name,
      url: pendingImportUrl,
      description: importPreview.description,
      labels: [],
      owner: importPreview.owner,
      isPinned: false,
      isSubmodule: false,
      implementationStatus: status,
    });
    setImplementationStatus(id, status);
    return id;
  };

  const handleImplementNow = () => {
    if (!importPreview) return;
    setIsImplementing(true);

    // Simulate council implementation trigger
    setTimeout(() => {
      saveImportedRepo("implemented");
      toast.success(`Implementing ${importPreview.name}`, {
        description:
          "The council has been tasked with implementing this repository. Check back shortly.",
      });
      setIsImplementing(false);
      setImportPreview(null);
      setImportUrl("");
      setPendingImportUrl("");
    }, 1200);
  };

  const handleImplementLater = () => {
    if (!importPreview) return;
    saveImportedRepo("deferred");
    toast.success(`${importPreview.name} saved`, {
      description: "Repository added to your list. You can implement it later.",
    });
    setImportPreview(null);
    setImportUrl("");
    setPendingImportUrl("");
  };

  const handleClosePreview = () => {
    setImportPreview(null);
    setPendingImportUrl("");
  };

  // Sort: pinned first, then by name
  const sortedSources = [...filteredSources].toSorted((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex h-full min-h-screen">
      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-6 p-6 overflow-y-auto min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground">{t("description")}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setManageLabelOpen(true)}>
              <Tag className="h-4 w-4 mr-1.5" />
              {t("actions.manageLabels")}
            </Button>
            <Button size="sm" onClick={() => setAddSourceOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              {t("actions.addSource")}
            </Button>
          </div>
        </div>

        {/* Tabs: Skills / Repositories / Labels */}
        <Tabs defaultValue="skills">
          <TabsList>
            <TabsTrigger value="skills" className="gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              Skills
            </TabsTrigger>
            <TabsTrigger value="sources">Repositories</TabsTrigger>
            <TabsTrigger value="labels">{t("tabs.labels")}</TabsTrigger>
          </TabsList>

          {/* ── Skills Tab ────────────────────────────────────────────── */}
          <TabsContent value="skills" className="space-y-4">
            <SkillsOnlyTab />
          </TabsContent>

          {/* ── Repositories Tab ──────────────────────────────────────────── */}
          <TabsContent value="sources" className="space-y-4">
            {/* Search + Label Filter */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("search.placeholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Label filter chips */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setSelectedLabel(null)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                    selectedLabel === null
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border hover:bg-accent",
                  )}
                >
                  {t("filters.all")} ({useReposStore.getState().sources.length})
                </button>
                {labels.map((label) => {
                  const style = getLabelStyle(label.color);
                  const count = useReposStore
                    .getState()
                    .sources.filter((s) => s.labels.includes(label.id)).length;
                  return (
                    <button
                      key={label.id}
                      onClick={() =>
                        setSelectedLabel(selectedLabel === label.id ? null : label.id)
                      }
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                        selectedLabel === label.id
                          ? cn(style.bg, style.text, style.border)
                          : "bg-muted text-muted-foreground border-border hover:bg-accent",
                      )}
                    >
                      {label.name} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Repository grid */}
            {sortedSources.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sortedSources.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    labels={labels}
                    implementingId={implementingUpdateId}
                    onTogglePin={() => togglePin(source.id)}
                    onRemove={() => removeSource(source.id)}
                    onManageLabels={() => setSourceLabelTarget(source.id)}
                    onUpdate={() => triggerUpdate(source.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Globe className="h-12 w-12 mb-3 opacity-40" />
                <p className="text-lg font-medium">{t("search.noResults")}</p>
                <p className="text-sm">{t("search.noResultsHint")}</p>
              </div>
            )}

            {/* ── URL Import bar ────────────────────────────────────────── */}
            <div className="pt-2">
              <Separator className="mb-4" />
              <p className="text-sm font-medium mb-2 text-muted-foreground">
                Import repository by URL
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1 max-w-xl">
                  <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="https://github.com/owner/repository"
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    className="pl-9"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleImportPreview();
                    }}
                  />
                </div>
                <Button
                  onClick={handleImportPreview}
                  disabled={!importUrl.trim()}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  Import
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* ── Labels Tab ───────────────────────────────────────────────── */}
          <TabsContent value="labels" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{t("labels.description")}</p>
              <Button size="sm" onClick={() => setCreateLabelOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                {t("labels.create")}
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {labels.map((label) => {
                const style = getLabelStyle(label.color);
                const count = useReposStore
                  .getState()
                  .sources.filter((s) => s.labels.includes(label.id)).length;
                return (
                  <Card key={label.id}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <span
                          className={cn("h-3 w-3 rounded-full", style.bg, style.border, "border")}
                        />
                        <div>
                          <span className="font-medium text-sm">{label.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {count} {count === 1 ? t("labels.source") : t("labels.sources")}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!label.isBuiltIn && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => {
                                setEditingLabel(label);
                                setNewLabelName(label.name);
                                setNewLabelColor(label.color);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => deleteLabel(label.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {label.isBuiltIn && (
                          <Badge variant="secondary" className="text-xs">
                            {t("labels.builtIn")}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Import Preview Sidebar ────────────────────────────────────────── */}
      {importPreview && (
        <ImportPreviewSidebar
          preview={importPreview}
          url={pendingImportUrl}
          onImplementNow={handleImplementNow}
          onImplementLater={handleImplementLater}
          onClose={handleClosePreview}
          isImplementing={isImplementing}
        />
      )}

      {/* ── Add Source Dialog ─────────────────────────────────────────── */}
      <Dialog open={addSourceOpen} onOpenChange={setAddSourceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialogs.addSource")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">{t("fields.name")}</label>
              <Input
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
                placeholder="e.g. My Skill Pack"
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t("fields.url")}</label>
              <Input
                value={newSourceUrl}
                onChange={(e) => setNewSourceUrl(e.target.value)}
                placeholder="https://github.com/user/repo"
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t("fields.description")}</label>
              <Input
                value={newSourceDesc}
                onChange={(e) => setNewSourceDesc(e.target.value)}
                placeholder="Brief description..."
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">{t("fields.labels")}</label>
              <div className="flex flex-wrap gap-1.5">
                {labels.map((label) => {
                  const selected = newSourceLabels.includes(label.id);
                  const style = getLabelStyle(label.color);
                  return (
                    <button
                      key={label.id}
                      onClick={() =>
                        setNewSourceLabels(
                          selected
                            ? newSourceLabels.filter((l) => l !== label.id)
                            : [...newSourceLabels, label.id],
                        )
                      }
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                        selected
                          ? cn(style.bg, style.text, style.border)
                          : "bg-muted text-muted-foreground border-border hover:bg-accent",
                      )}
                    >
                      {label.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddSourceOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button
              onClick={handleAddSource}
              disabled={!newSourceName.trim() || !newSourceUrl.trim()}
            >
              {t("actions.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create / Edit Label Dialog ────────────────────────────────── */}
      <Dialog
        open={createLabelOpen || editingLabel !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateLabelOpen(false);
            setEditingLabel(null);
            setNewLabelName("");
            setNewLabelColor("blue");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingLabel ? t("dialogs.editLabel") : t("dialogs.createLabel")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">{t("fields.labelName")}</label>
              <Input
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                placeholder="e.g. Frontend"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">{t("fields.labelColor")}</label>
              <div className="flex gap-2">
                {AVAILABLE_COLORS.map((color) => {
                  const style = getLabelStyle(color);
                  return (
                    <button
                      key={color}
                      onClick={() => setNewLabelColor(color)}
                      className={cn(
                        "h-8 w-8 rounded-full border-2 transition-transform",
                        style.bg,
                        newLabelColor === color
                          ? cn(
                              style.border,
                              "scale-110 ring-2 ring-offset-2 ring-offset-background",
                              style.text.replace("text-", "ring-"),
                            )
                          : "border-transparent",
                      )}
                    />
                  );
                })}
              </div>
            </div>
            {newLabelName && (
              <div>
                <label className="text-sm font-medium mb-2 block">{t("fields.preview")}</label>
                <LabelBadge
                  label={{
                    id: "preview",
                    name: newLabelName,
                    color: newLabelColor,
                    isBuiltIn: false,
                  }}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateLabelOpen(false);
                setEditingLabel(null);
                setNewLabelName("");
                setNewLabelColor("blue");
              }}
            >
              {t("actions.cancel")}
            </Button>
            <Button
              onClick={editingLabel ? handleUpdateLabel : handleCreateLabel}
              disabled={!newLabelName.trim()}
            >
              {editingLabel ? t("actions.save") : t("actions.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Manage Labels for Source Dialog ────────────────────────────── */}
      <Dialog
        open={sourceLabelTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSourceLabelTarget(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialogs.assignLabels")}</DialogTitle>
          </DialogHeader>
          {sourceLabelTarget && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("dialogs.assignLabelsHint", {
                  name:
                    useReposStore.getState().sources.find((s) => s.id === sourceLabelTarget)
                      ?.name ?? "",
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                {labels.map((label) => {
                  const source = useReposStore
                    .getState()
                    .sources.find((s) => s.id === sourceLabelTarget);
                  const assigned = source?.labels.includes(label.id) ?? false;
                  const style = getLabelStyle(label.color);
                  return (
                    <button
                      key={label.id}
                      onClick={() => {
                        if (assigned) {
                          removeLabelFromSource(sourceLabelTarget, label.id);
                        } else {
                          addLabelToSource(sourceLabelTarget, label.id);
                        }
                      }}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-sm font-medium border transition-colors",
                        assigned
                          ? cn(style.bg, style.text, style.border)
                          : "bg-muted text-muted-foreground border-border hover:bg-accent",
                      )}
                    >
                      {label.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setSourceLabelTarget(null)}>{t("actions.done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Manage All Labels Dialog ──────────────────────────────────── */}
      <Dialog open={manageLabelOpen} onOpenChange={setManageLabelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialogs.manageLabels")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {labels.map((label) => {
              const style = getLabelStyle(label.color);
              const count = useReposStore
                .getState()
                .sources.filter((s) => s.labels.includes(label.id)).length;
              return (
                <div key={label.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <span className={cn("h-3 w-3 rounded-full border", style.bg, style.border)} />
                    <span className="text-sm font-medium">{label.name}</span>
                    <span className="text-xs text-muted-foreground">({count})</span>
                  </div>
                );
              })}
            </div>
            <Separator />
            <DialogFooter className="justify-between sm:justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setManageLabelOpen(false);
                  setCreateLabelOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                {t("labels.create")}
              </Button>
              <Button onClick={() => setManageLabelOpen(false)}>{t("actions.done")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      {/* ── Update Plan Sidebar ────────────────────────────────────────── */}
      <UpdateSidebar
        plan={updatePlan}
        isImplementing={implementingUpdateId !== null}
        onImplement={() => pendingUpdateId && implementUpdate(pendingUpdateId)}
        onDismiss={dismissUpdate}
      />
    </div>
  );
}
