"use client";
import { useState, useEffect } from "react";
import { fetchMe } from "@/lib/api";
import { getInitData, getDeepLinkMeetingId } from "@/lib/telegram";
import type { Me } from "@/types";
import { TasksScreen } from "@/components/tasks/TasksScreen";
import { TeamScreen } from "@/components/TeamScreen";
import { KnowledgeScreen } from "@/components/KnowledgeScreen";
import { MeetingsScreen } from "@/components/MeetingsScreen";
import { AgentReviewQueue } from "@/components/AgentReviewQueue";
import { MeetingReview } from "@/components/MeetingReview";
import { SettingsScreen } from "@/components/SettingsScreen";
import { AdminScreen } from "@/components/AdminScreen";
import { BottomNav } from "@/components/BottomNav";
import type { Section } from "@/components/BottomNav";

export default function Home() {
  const [section, setSection] = useState<Section>("tasks");
  const [me, setMe] = useState<Me | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);

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

  // Deep-link из уведомления агента «тезисы готовы» → открыть вычитку встречи
  useEffect(() => {
    const id = getDeepLinkMeetingId();
    if (id) {
      setSection("meetings");
      setReviewId(id);
    }
  }, []);

  const closeReview = () => {
    setReviewId(null);
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  };

  return (
    <div className="flex flex-col h-screen">
      <div className="flex-1 overflow-hidden pb-16">
        {reviewId ? (
          <MeetingReview id={reviewId} onClose={closeReview} />
        ) : (
          <>
            {section === "tasks" && <TasksScreen />}
            {section === "knowledge" && <KnowledgeScreen myTelegramId={me?.telegram_id ?? 0} />}
            {section === "meetings" && (
              <div className="flex flex-col h-full">
                <AgentReviewQueue onOpen={setReviewId} />
                <div className="flex-1 overflow-hidden">
                  <MeetingsScreen />
                </div>
              </div>
            )}
            {section === "team" && <TeamScreen />}
            {section === "settings" && <SettingsScreen />}
            {section === "admin" && <AdminScreen />}
          </>
        )}
      </div>
      <BottomNav
        active={section}
        onChange={(s) => { setReviewId(null); setSection(s); }}
        isAdmin={me?.is_admin ?? false}
      />
    </div>
  );
}
