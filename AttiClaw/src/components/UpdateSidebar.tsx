import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  GitCommit,
  Loader2,
  Shield,
  X,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { UpdateImpact, UpdatePlan } from "@/stores/repos";

// ── Impact badge ─────────────────────────────────────────────────────────────

const IMPACT_STYLES: Record<
  UpdateImpact,
  { bg: string; text: string; border: string; icon: React.ElementType; labelKey: string }
> = {
  low: {
    bg: "bg-green-500/10",
    text: "text-green-400",
    border: "border-green-500/30",
    icon: CheckCircle2,
    labelKey: "update.sidebar.impactLow",
  },
  medium: {
    bg: "bg-yellow-500/10",
    text: "text-yellow-400",
    border: "border-yellow-500/30",
    icon: AlertTriangle,
    labelKey: "update.sidebar.impactMedium",
  },
  high: {
    bg: "bg-red-500/10",
    text: "text-red-400",
    border: "border-red-500/30",
    icon: Shield,
    labelKey: "update.sidebar.impactHigh",
  },
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface UpdateSidebarProps {
  plan: UpdatePlan | null;
  isImplementing: boolean;
  onImplement: () => void;
  onDismiss: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function UpdateSidebar({
  plan,
  isImplementing,
  onImplement,
  onDismiss,
}: UpdateSidebarProps) {
  const { t } = useTranslation("skills");

  const open = plan !== null;
  const impact = plan?.estimatedImpact ?? "low";
  const impactStyle = IMPACT_STYLES[impact];
  const ImpactIcon = impactStyle.icon;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity duration-300",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={onDismiss}
      />

      {/* Sidebar panel */}
      <aside
        className={cn(
          "fixed top-0 right-0 h-full w-96 max-w-full bg-card border-l border-border z-50",
          "flex flex-col shadow-2xl transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Zap className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold leading-tight truncate">
                {t("update.sidebar.title")}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("update.sidebar.subtitle")}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 -mt-0.5 -mr-0.5"
            onClick={onDismiss}
            disabled={isImplementing}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        {plan && (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Repo name */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Plugin
              </p>
              <p className="text-sm font-semibold">{plan.sourceName}</p>
            </div>

            {/* Impact */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                {t("update.sidebar.impact")}
              </p>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
                  impactStyle.bg,
                  impactStyle.text,
                  impactStyle.border,
                )}
              >
                <ImpactIcon className="h-3.5 w-3.5" />
                {t(impactStyle.labelKey)}
              </span>
            </div>

            <Separator />

            {/* Summary */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                {t("update.sidebar.summary")}
              </p>
              <p className="text-sm text-foreground/90 leading-relaxed">{plan.summary}</p>
            </div>

            {/* Steps */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                {t("update.sidebar.steps")}
              </p>
              <ol className="space-y-2">
                {plan.changes.map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="flex items-center justify-center h-5 w-5 rounded-full bg-muted text-muted-foreground text-xs font-medium shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-sm text-foreground/80 font-mono leading-relaxed break-all">
                      {step}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <Separator />

            {/* Git commit message */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                {t("update.sidebar.gitCommit")}
              </p>
              <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2.5">
                <GitCommit className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                <code className="text-xs break-all leading-relaxed text-foreground/90">
                  {plan.gitCommitMessage}
                </code>
              </div>
            </div>

            {/* Timestamp */}
            <p className="text-xs text-muted-foreground">
              Plan generated {new Date(plan.createdAt).toLocaleTimeString()}
            </p>
          </div>
        )}

        {/* Footer — action buttons */}
        <div className="shrink-0 border-t border-border p-5 space-y-2">
          <Button
            className="w-full"
            onClick={onImplement}
            disabled={isImplementing || !plan}
          >
            {isImplementing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("update.sidebar.implementing")}
              </>
            ) : (
              <>
                <ChevronRight className="h-4 w-4 mr-2" />
                {t("update.sidebar.implement")}
              </>
            )}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={onDismiss}
            disabled={isImplementing}
          >
            {t("update.sidebar.later")}
          </Button>
        </div>
      </aside>
    </>
  );
}
