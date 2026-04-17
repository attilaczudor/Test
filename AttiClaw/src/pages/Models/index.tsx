import { Search } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/utils";
import { useModelsStore, type ModelCategory, type ModelFormat } from "@/stores/models";
import { useSettingsStore } from "@/stores/settings";

// ── Helpers ─────────────────────────────────────────────────────────────────

const FORMAT_COLORS: Record<ModelFormat, string> = {
  gguf: "bg-green-600 text-white hover:bg-green-600",
  safetensors: "bg-blue-600 text-white hover:bg-blue-600",
  pytorch: "bg-orange-600 text-white hover:bg-orange-600",
  onnx: "bg-purple-600 text-white hover:bg-purple-600",
  gptq: "bg-yellow-600 text-white hover:bg-yellow-600",
  awq: "bg-cyan-600 text-white hover:bg-cyan-600",
  unknown: "bg-gray-600 text-white hover:bg-gray-600",
};

const CATEGORIES: { key: string; i18nKey: string }[] = [
  { key: "all", i18nKey: "categories.all" },
  { key: "recommended", i18nKey: "categories.recommended" },
  { key: "chat", i18nKey: "categories.chat" },
  { key: "code", i18nKey: "categories.code" },
  { key: "voice", i18nKey: "categories.voice" },
  { key: "multimodal", i18nKey: "categories.vision" },
  { key: "embeddings", i18nKey: "categories.embeddings" },
  { key: "moe", i18nKey: "categories.moe" },
  { key: "local", i18nKey: "categories.local" },
];

// ── Component ───────────────────────────────────────────────────────────────

export default function ModelsPage() {
  const { t } = useTranslation("models");

  // Models store
  const searchQuery = useModelsStore((s) => s.searchQuery);
  const setSearchQuery = useModelsStore((s) => s.setSearchQuery);
  const searchResults = useModelsStore((s) => s.searchResults);
  const searching = useModelsStore((s) => s.searching);
  const selectedCategory = useModelsStore((s) => s.selectedCategory);
  const setSelectedCategory = useModelsStore((s) => s.setSelectedCategory);
  const searchModels = useModelsStore((s) => s.searchModels);
  const localModels = useModelsStore((s) => s.localModels);
  const recommendations = useModelsStore((s) => s.recommendations);
  const approveRecommendation = useModelsStore((s) => s.approveRecommendation);
  const dismissRecommendation = useModelsStore((s) => s.dismissRecommendation);
  const downloadModel = useModelsStore((s) => s.downloadModel);
  const loadToNvme = useModelsStore((s) => s.loadToNvme);
  const unloadFromNvme = useModelsStore((s) => s.unloadFromNvme);
  const removeModel = useModelsStore((s) => s.removeModel);

  // Settings store
  const smbConfig = useSettingsStore((s) => s.smbConfig);
  const setSmbConfig = useSettingsStore((s) => s.setSmbConfig);
  const smbConnected = useSettingsStore((s) => s.smbConnected);
  const connectSmb = useSettingsStore((s) => s.connectSmb);
  const disconnectSmb = useSettingsStore((s) => s.disconnectSmb);
  const nvmeDrives = useSettingsStore((s) => s.nvmeDrives);
  const selectedNvmeDrive = useSettingsStore((s) => s.selectedNvmeDrive);
  const setSelectedNvmeDrive = useSettingsStore((s) => s.setSelectedNvmeDrive);

  // Run initial search on mount
  useEffect(() => {
    searchModels();
  }, [searchModels]);

  // ── Search handler ──────────────────────────────────────────────────────

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    searchModels(e.target.value);
  };

  // ── Displayed recommendations ───────────────────────────────────────────

  const visibleRecs =
    searchQuery || selectedCategory !== "all"
      ? searchResults
      : recommendations.filter((r) => !r.dismissed);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder={t("search.placeholder")}
          className="pl-10"
        />
      </div>

      {/* Category tabs */}
      <Tabs value={selectedCategory} onValueChange={(v) => setSelectedCategory(v as ModelCategory)}>
        <TabsList className="flex-wrap">
          {CATEGORIES.map((cat) => (
            <TabsTrigger key={cat.key} value={cat.key}>
              {t(cat.i18nKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Browse / Storage view tabs */}
      <Tabs defaultValue="browse">
        <TabsList>
          <TabsTrigger value="browse">{t("tabs.browse")}</TabsTrigger>
          <TabsTrigger value="storage">{t("tabs.storage")}</TabsTrigger>
        </TabsList>

        {/* ── Browse view ───────────────────────────────────────────────────── */}
        <TabsContent value="browse">
          {searching && (
            <p className="py-4 text-center text-muted-foreground">{t("search.searching")}</p>
          )}

          {!searching && visibleRecs.length === 0 && (
            <p className="py-4 text-center text-muted-foreground">{t("search.noResults")}</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleRecs.map((rec) => (
              <Card key={rec.modelId}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base leading-snug">{rec.modelId}</CardTitle>
                  <p className="text-sm text-muted-foreground">{rec.reason}</p>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2 pb-3">
                  <Badge className={cn(FORMAT_COLORS[rec.format])}>{rec.format}</Badge>
                  <span className="text-sm text-muted-foreground">{rec.sizeGb} GB</span>
                  <span className="text-sm font-medium">Score: {rec.score}</span>
                </CardContent>
                <CardFooter className="gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      approveRecommendation(rec.modelId);
                      downloadModel(rec.modelId);
                    }}
                    disabled={rec.approved}
                  >
                    {t("actions.approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => dismissRecommendation(rec.modelId)}
                    disabled={rec.dismissed}
                  >
                    {t("actions.dismiss")}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── Storage view ──────────────────────────────────────────────────── */}
        <TabsContent value="storage">
          {/* Local model cards */}
          {localModels.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">{t("search.noResults")}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {localModels.map((model) => (
                <Card key={model.id}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{model.name}</CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={cn(FORMAT_COLORS[model.format])}>{model.format}</Badge>
                      <Badge variant="outline">{t(`status.${model.status}`)}</Badge>
                      <Badge variant="secondary">{t(`storage.${model.location}`)}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pb-3">
                    <p className="text-sm text-muted-foreground">{formatBytes(model.sizeBytes)}</p>
                    {model.status === "downloading" && model.downloadProgress !== undefined && (
                      <div className="mt-2 space-y-1">
                        <Progress value={model.downloadProgress} />
                        <p className="text-xs text-muted-foreground">
                          {model.downloadProgress.toFixed(0)}%
                        </p>
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="gap-2">
                    {model.status === "stored" && (
                      <Button size="sm" onClick={() => loadToNvme(model.modelId)}>
                        {t("actions.load")}
                      </Button>
                    )}
                    {(model.status === "loaded" || model.status === "active") && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => unloadFromNvme(model.modelId)}
                      >
                        {t("actions.unload")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => removeModel(model.modelId)}
                    >
                      {t("actions.remove")}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}

          {/* SMB Configuration Section */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-lg">{t("storage.smbConfig")}</CardTitle>
              <Badge variant={smbConnected ? "default" : "secondary"}>
                {smbConnected ? t("storage.connected") : t("storage.disconnected")}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Host</Label>
                  <Input
                    value={smbConfig.host}
                    onChange={(e) => setSmbConfig({ host: e.target.value })}
                    placeholder="192.168.1.100"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Share</Label>
                  <Input
                    value={smbConfig.share}
                    onChange={(e) => setSmbConfig({ share: e.target.value })}
                    placeholder="models"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input
                    value={smbConfig.username}
                    onChange={(e) => setSmbConfig({ username: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={smbConfig.password}
                    onChange={(e) => setSmbConfig({ password: e.target.value })}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              {smbConnected ? (
                <Button variant="outline" onClick={disconnectSmb}>
                  {t("storage.disconnect")}
                </Button>
              ) : (
                <Button onClick={connectSmb}>{t("storage.connect")}</Button>
              )}
            </CardFooter>
          </Card>

          {/* NVMe Drive Section */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-lg">{t("storage.nvmeConfig")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label>NVMe Drive</Label>
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
