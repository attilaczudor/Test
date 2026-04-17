import {
  BookMarked,
  Database,
  ExternalLink,
  HardDrive,
  Layers,
  Link as LinkIcon,
  Mail,
  Palette,
  RefreshCw,
  Save,
  Search,
  Server,
  Star,
  User,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useSettingsStore, type Theme } from "@/stores/settings";
import { useReposStore, type RepoSource } from "@/stores/repos";

// ── Account Tab ───────────────────────────────────────────────────────────────

function AccountTab() {
  const profile = useSettingsStore((s) => s.profile);
  const setProfile = useSettingsStore((s) => s.setProfile);

  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
  const [bio, setBio] = useState(profile.bio);

  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  const handleSave = () => {
    setProfile({ name: name.trim() || "Local User", email: email.trim(), bio: bio.trim() });
    toast.success("Account updated");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-4 w-4" /> Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Avatar preview */}
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xl font-bold select-none shrink-0">
              {initials || "?"}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">{name || "No name set"}</p>
              <p className="text-xs text-muted-foreground">Avatar is generated from your initials</p>
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="account-name">Full Name</Label>
              <Input
                id="account-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-email">
                <Mail className="inline h-3 w-3 mr-1" />
                Email
              </Label>
              <Input
                id="account-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="account-bio">Bio</Label>
              <Input
                id="account-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Short description about yourself..."
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleSave} className="gap-2">
            <Save className="h-4 w-4" />
            Save changes
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

// ── App Settings Tab ──────────────────────────────────────────────────────────

function AppSettingsTab() {
  const { t, i18n } = useTranslation("settings");

  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const smbConfig = useSettingsStore((s) => s.smbConfig);
  const setSmbConfig = useSettingsStore((s) => s.setSmbConfig);
  const smbConnected = useSettingsStore((s) => s.smbConnected);
  const connectSmb = useSettingsStore((s) => s.connectSmb);
  const disconnectSmb = useSettingsStore((s) => s.disconnectSmb);
  const nvmeDrives = useSettingsStore((s) => s.nvmeDrives);
  const selectedNvmeDrive = useSettingsStore((s) => s.selectedNvmeDrive);
  const setSelectedNvmeDrive = useSettingsStore((s) => s.setSelectedNvmeDrive);
  const nvmePath = useSettingsStore((s) => s.nvmePath);

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
  };

  return (
    <div className="space-y-6">
      {/* Theme */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            {t("theme.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">{t("theme.dark")}</SelectItem>
              <SelectItem value="light">{t("theme.light")}</SelectItem>
              <SelectItem value="system">{t("theme.system")}</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Language */}
      <Card>
        <CardHeader>
          <CardTitle>{t("language.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={language} onValueChange={handleLanguageChange}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">{t("language.en")}</SelectItem>
              <SelectItem value="zh">{t("language.zh")}</SelectItem>
              <SelectItem value="ja">{t("language.ja")}</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Separator />

      {/* SMB Storage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            {t("storage.title")} — SMB
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("storage.smbHost")}</Label>
              <Input
                value={smbConfig.host}
                onChange={(e) => setSmbConfig({ host: e.target.value })}
                placeholder="192.168.1.100"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("storage.smbShare")}</Label>
              <Input
                value={smbConfig.share}
                onChange={(e) => setSmbConfig({ share: e.target.value })}
                placeholder="models"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("storage.smbUsername")}</Label>
              <Input
                value={smbConfig.username}
                onChange={(e) => setSmbConfig({ username: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("storage.smbPassword")}</Label>
              <Input
                type="password"
                value={smbConfig.password}
                onChange={(e) => setSmbConfig({ password: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("storage.smbMount")}</Label>
              <Input
                value={smbConfig.mountPoint}
                onChange={(e) => setSmbConfig({ mountPoint: e.target.value })}
                placeholder="/mnt/smb-models"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("storage.smbPort")}</Label>
              <Input
                type="number"
                value={smbConfig.port}
                onChange={(e) => setSmbConfig({ port: parseInt(e.target.value, 10) || 445 })}
                placeholder="445"
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          {smbConnected ? (
            <Button variant="outline" onClick={disconnectSmb}>
              Disconnect
            </Button>
          ) : (
            <Button onClick={connectSmb}>Connect</Button>
          )}
        </CardFooter>
      </Card>

      {/* NVMe Cache */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            {t("storage.title")} — NVMe
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("storage.nvmeDrive")}</Label>
              <Select value={selectedNvmeDrive} onValueChange={setSelectedNvmeDrive}>
                <SelectTrigger>
                  <SelectValue placeholder="Select NVMe drive" />
                </SelectTrigger>
                <SelectContent>
                  {nvmeDrives.length === 0 ? (
                    <SelectItem value="_none" disabled>
                      No drives detected
                    </SelectItem>
                  ) : (
                    nvmeDrives.map((drive) => (
                      <SelectItem key={drive.device} value={drive.device}>
                        {drive.label || drive.device} ({drive.freeGb.toFixed(1)} GB free)
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("storage.nvmePath")}</Label>
              <Input value={nvmePath} disabled />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Skill Detail Sidebar ──────────────────────────────────────────────────────

function SkillDetailSidebar({
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
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold truncate pr-2">{skill.name}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 p-4 space-y-5 overflow-y-auto">
        {/* Icon + status */}
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-purple-500/15 flex items-center justify-center shrink-0">
            <Layers className="h-6 w-6 text-purple-400" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm">{skill.name}</p>
            <span
              className={cn(
                "inline-block mt-0.5 rounded-full px-2 py-0.5 text-xs font-medium",
                skill.isActive
                  ? "bg-green-500/15 text-green-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {skill.isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </div>

        <Separator />

        {/* Description */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Description
          </p>
          <p className="text-sm">{skill.description || "No description available."}</p>
        </div>

        {/* URL */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            URL
          </p>
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

        {/* Meta */}
        {(skill.owner || skill.language || skill.stars !== undefined) && (
          <div className="grid grid-cols-2 gap-3">
            {skill.owner && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Owner
                </p>
                <p className="text-sm">{skill.owner}</p>
              </div>
            )}
            {skill.language && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Language
                </p>
                <p className="text-sm">{skill.language}</p>
              </div>
            )}
            {skill.stars !== undefined && skill.stars > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Stars
                </p>
                <p className="text-sm flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 text-yellow-400" />
                  {skill.stars.toLocaleString()}
                </p>
              </div>
            )}
            {skill.isSubmodule && skill.submodulePath && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Submodule path
                </p>
                <p className="text-sm font-mono text-xs">{skill.submodulePath}</p>
              </div>
            )}
          </div>
        )}

        {/* Upstream */}
        {skill.upstreamUrl && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Upstream
            </p>
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
      </div>

      {/* Footer actions */}
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
            skill.isActive
              ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              : "",
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

// ── Skill Card ────────────────────────────────────────────────────────────────

function SkillCard({
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
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
              <Layers className="h-4 w-4 text-purple-400" />
            </div>
            <p className="font-medium text-sm truncate">{skill.name}</p>
          </div>
          {/* Toggle — stop propagation so clicking it doesn't also open the sidebar */}
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

        {/* Description */}
        <p className="text-xs text-muted-foreground line-clamp-2">
          {skill.description || "No description."}
        </p>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              skill.isActive ? "bg-green-500/15 text-green-400" : "bg-muted text-muted-foreground",
            )}
          >
            {skill.isActive ? "Active" : "Inactive"}
          </span>
          {skill.stars !== undefined && skill.stars > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Star className="h-3 w-3" />
              {skill.stars.toLocaleString()}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Skills Tab ────────────────────────────────────────────────────────────────

type SkillFilter = "all" | "active" | "inactive";

function SkillsTab() {
  const { labels, sources } = useReposStore();

  const skillLabel = labels.find((l) => l.id === "skill");
  const allSkills = skillLabel ? sources.filter((s) => s.labels.includes(skillLabel.id)) : [];

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [selectedSkill, setSelectedSkill] = useState<RepoSource | null>(null);

  // Keep detail panel in sync with store updates
  const liveSelected = selectedSkill
    ? sources.find((s) => s.id === selectedSkill.id) ?? null
    : null;

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
    <div className="flex gap-0 min-h-[500px] -mx-0">
      {/* Main panel */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filter chips */}
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

        {/* Cards grid */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Layers className="h-10 w-10 opacity-30 mb-3" />
            <p className="text-sm">No skills match your filters.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isSelected={liveSelected?.id === skill.id}
                onClick={() =>
                  setSelectedSkill((prev) => (prev?.id === skill.id ? null : skill))
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail sidebar */}
      {liveSelected && (
        <SkillDetailSidebar
          skill={liveSelected}
          onClose={() => setSelectedSkill(null)}
        />
      )}
    </div>
  );
}

// ── Repositories Tab ──────────────────────────────────────────────────────────

function RepositoriesTab() {
  const { sources } = useReposStore();

  const implemented = sources.filter((s) => s.implementationStatus === "implemented");
  const deferred = sources.filter((s) => s.implementationStatus === "deferred");
  const unset = sources.filter((s) => !s.implementationStatus);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookMarked className="h-4 w-4" />
            Repository Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Overview of all repository sources. For full management and importing, visit the{" "}
            <strong>Repositories</strong> page from the sidebar.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border border-border p-4 text-center">
              <p className="text-2xl font-bold text-green-400">{implemented.length}</p>
              <p className="text-xs text-muted-foreground mt-1">Implemented</p>
            </div>
            <div className="rounded-lg border border-border p-4 text-center">
              <p className="text-2xl font-bold text-yellow-400">{deferred.length}</p>
              <p className="text-xs text-muted-foreground mt-1">Not Implemented</p>
            </div>
            <div className="rounded-lg border border-border p-4 text-center">
              <p className="text-2xl font-bold">{unset.length}</p>
              <p className="text-xs text-muted-foreground mt-1">No Status</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            All Repositories ({sources.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 max-h-80 overflow-y-auto">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-1.5">
                <div className="h-7 w-7 rounded bg-muted flex items-center justify-center shrink-0 text-[10px] font-bold text-muted-foreground uppercase">
                  {s.name.slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.url}</p>
                </div>
                <span
                  className={
                    s.implementationStatus === "implemented"
                      ? "text-xs text-green-400 shrink-0"
                      : s.implementationStatus === "deferred"
                        ? "text-xs text-yellow-400 shrink-0"
                        : "text-xs text-muted-foreground shrink-0"
                  }
                >
                  {s.implementationStatus === "implemented"
                    ? "Implemented"
                    : s.implementationStatus === "deferred"
                      ? "Pending"
                      : "—"}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account, preferences, and data sources.</p>
      </div>

      <Tabs defaultValue="account">
        <TabsList className="mb-2">
          <TabsTrigger value="account" className="gap-1.5">
            <User className="h-3.5 w-3.5" />
            Account
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5">
            <Palette className="h-3.5 w-3.5" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="skills" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            Skills
          </TabsTrigger>
          <TabsTrigger value="repositories" className="gap-1.5">
            <BookMarked className="h-3.5 w-3.5" />
            Repositories
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          <AccountTab />
        </TabsContent>

        <TabsContent value="settings">
          <AppSettingsTab />
        </TabsContent>

        <TabsContent value="skills">
          <SkillsTab />
        </TabsContent>

        <TabsContent value="repositories">
          <RepositoriesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
