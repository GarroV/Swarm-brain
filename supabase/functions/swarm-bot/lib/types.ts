export interface TgMessage {
  chat: { id: number; type?: "private" | "group" | "supergroup" | "channel" };
  from?: { id?: number; username?: string; first_name?: string; last_name?: string };
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number };
  audio?: { file_id: string; mime_type?: string };
  document?: { file_id: string; file_name?: string; mime_type?: string };
  photo?: Array<{ file_id: string; file_size?: number }>;
  contact?: { phone_number: string; first_name?: string; last_name?: string };
  // Признаки пересланного сообщения. forward_origin — новый формат Bot API (>=7.0),
  // forward_date/forward_from/forward_from_chat — легаси. Наличие любого = это форвард.
  forward_origin?: Record<string, unknown>;
  forward_date?: number;
  forward_from?: { id?: number; username?: string; first_name?: string; last_name?: string };
  forward_from_chat?: { id?: number; title?: string; username?: string };
}

export interface TgCallbackQuery {
  id: string;
  from: { id?: number; username?: string; first_name?: string; last_name?: string };
  message: { chat: { id: number }; message_id: number };
  data: string;
}

export type KbEntry = { id: string; content: string; summary?: string | null; source?: string | null; metadata?: Record<string, unknown> | null };

export type Task = {
  id: string;
  title: string;
  assignees: string[];
  due_date: string | null;
  tags: string[];
  status: string;
  created_at: string;
  meeting_id: string | null;
  url: string | null;
};
