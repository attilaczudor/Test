import {
  FolderGit2,
  LayoutDashboard,
  MessageSquare,
  Box,
  Settings,
  PawPrint,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
}

const navItems: NavItem[] = [
  { label: "sidebar.dashboard", icon: LayoutDashboard, path: "/" },
  { label: "sidebar.chat", icon: MessageSquare, path: "/chat" },
  { label: "sidebar.models", icon: Box, path: "/models" },
  { label: "sidebar.repositories", icon: Sparkles, path: "/skills" },
  { label: "sidebar.settings", icon: Settings, path: "/settings" },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { t } = useTranslation();

  return (
    <aside
      className={cn(
        "flex flex-col bg-card border-r border-border transition-all duration-200",
        collapsed ? "w-16" : "w-56",
      )}
    >
      {/* Branding */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-border shrink-0">
        <PawPrint className="h-6 w-6 shrink-0 text-primary" />
        {!collapsed && (
          <span className="text-lg font-semibold tracking-tight truncate">AttiClaw</span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-1 p-2 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const label = t(item.label);

          const link = (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground",
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.path} delayDuration={0}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            );
          }

          return link;
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="p-2 border-t border-border shrink-0">
        <button
          onClick={() => setCollapsed((prev) => !prev)}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium w-full transition-colors",
            "hover:bg-accent hover:text-accent-foreground text-muted-foreground",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-5 w-5 shrink-0" />
          ) : (
            <>
              <PanelLeftClose className="h-5 w-5 shrink-0" />
              <span className="truncate">{t("sidebar.collapse")}</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
