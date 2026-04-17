import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import MainLayout from "@/components/layout/MainLayout";
import { TooltipProvider } from "@/components/ui/tooltip";
import Chat from "./pages/Chat";
import Dashboard from "./pages/Dashboard";
import Models from "./pages/Models";
import Settings from "./pages/Settings";
import Skills from "./pages/Skills";

export default function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <TooltipProvider>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/models" element={<Models />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
