"use client";
import { useState, useEffect } from "react";
import { fetchMe } from "@/lib/api";
import type { Me } from "@/types";
import { KanbanBoard } from "@/components/KanbanBoard";
import { TeamScreen } from "@/components/TeamScreen";
import { KnowledgeScreen } from "@/components/KnowledgeScreen";
import { MeetingsScreen } from "@/components/MeetingsScreen";
import { SettingsScreen } from "@/components/SettingsScreen";
import { BottomNav } from "@/components/BottomNav";
import type { Section } from "@/components/BottomNav";

export default function Home() {
  const [section, setSection] = useState<Section>("tasks");
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => { fetchMe().then(setMe).catch(() => {}); }, []);

  return (
    <div className="flex flex-col h-screen">
      <div className="flex-1 overflow-hidden pb-16">
        {section === "tasks" && <KanbanBoard />}
        {section === "knowledge" && <KnowledgeScreen myTelegramId={me?.telegram_id ?? 0} />}
        {section === "meetings" && <MeetingsScreen />}
        {section === "team" && <TeamScreen />}
        {section === "settings" && <SettingsScreen />}
      </div>
      <BottomNav active={section} onChange={setSection} />
    </div>
  );
}
