import { Box, HardDrive, Server, Cpu, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useModelsStore } from "@/stores/models";
import { useReposStore } from "@/stores/repos";
import { useSettingsStore } from "@/stores/settings";

export default function DashboardPage() {
  const { t } = useTranslation("common");
  const localModels = useModelsStore((s) => s.localModels);
  const sources = useReposStore((s) => s.sources);
  const smbConnected = useSettingsStore((s) => s.smbConnected);
  const nvmeDrives = useSettingsStore((s) => s.nvmeDrives);
  const selectedNvmeDrive = useSettingsStore((s) => s.selectedNvmeDrive);

  const modelsStored = localModels.length;
  const modelsRunning = localModels.filter(
    (m) => m.status === "loaded" || m.status === "active",
  ).length;

  const activeDrive = nvmeDrives.find((d) => d.device === selectedNvmeDrive);
  const nvmeUsage = activeDrive ? activeDrive.usedPercent : 0;

  const stats = [
    {
      title: "Models Stored",
      value: modelsStored,
      icon: Box,
      description: "Total models in storage",
    },
    {
      title: "Models Running",
      value: modelsRunning,
      icon: Cpu,
      description: "Loaded on NVMe",
    },
    {
      title: "Sources",
      value: sources.length,
      icon: Sparkles,
      description: `${sources.filter((s) => s.labels.includes("claw")).length} claws, ${sources.filter((s) => s.labels.includes("skill")).length} skills`,
    },
    {
      title: "SMB Storage",
      value: smbConnected ? "Connected" : "Disconnected",
      icon: Server,
      description: smbConnected ? "Network share active" : "Not mounted",
    },
    {
      title: "NVMe Cache",
      value: `${nvmeUsage}%`,
      icon: HardDrive,
      description: activeDrive
        ? `${activeDrive.freeGb.toFixed(1)} GB free of ${activeDrive.totalGb.toFixed(1)} GB`
        : "No drive selected",
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {t("app.name")} {t("sidebar.dashboard")}
        </h1>
        <p className="text-muted-foreground">{t("app.description")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
