import { Outlet } from "react-router-dom";
import SessionsSidebar from "./SessionsSidebar";
import Sidebar from "./Sidebar";

export default function MainLayout() {
  return (
    <div className="flex min-h-screen bg-background">
      <SessionsSidebar />
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
