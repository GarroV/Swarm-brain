"use client";
import { useState, useEffect } from "react";
import { fetchMe } from "@/lib/api";
import { getInitData } from "@/lib/telegram";
import type { Me } from "@/types";
import { TasksScreen } from "@/components/tasks/TasksScreen";
import { TeamScreen } from "@/components/TeamScreen";
import { KnowledgeScreen } from "@/components/KnowledgeScreen";
import { MeetingsScreen } from "@/components/MeetingsScreen";
import { SettingsScreen } from "@/components/SettingsScreen";
import { AdminScreen } from "@/components/AdminScreen";
import { BottomNav } from "@/components/BottomNav";
import type { Section } from "@/components/BottomNav";

export default function Home() {
  const [section, setSection] = useState<Section>("tasks");
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetchMe()
      .then(setMe)
      .catch((err: unknown) => {
        // В браузере (вне Telegram) без сессии → на страницу входа
        const status = (err as { status?: number }).status;
        if (status === 401 && !getInitData() && typeof window !== "undefined") {
          window.location.href = "/login";
        }
      });
  }, []);

  return (
    <div className="flex flex-col h-screen">
      <div className="flex-1 overflow-hidden pb-16">
        {section === "tasks" && <TasksScreen />}
        {section === "knowledge" && <KnowledgeScreen myTelegramId={me?.telegram_id ?? 0} />}
        {section === "meetings" && <MeetingsScreen />}
        {section === "team" && <TeamScreen />}
        {section === "settings" && <SettingsScreen />}
        {section === "admin" && <AdminScreen />}
      </div>
      <BottomNav active={section} onChange={setSection} isAdmin={me?.is_admin ?? false} />
    </div>
  );
}
