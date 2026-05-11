export interface TgMessage {
  chat: { id: number };
  from?: { id?: number; username?: string; first_name?: string; last_name?: string };
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number };
  audio?: { file_id: string; mime_type?: string };
  document?: { file_id: string; file_name?: string; mime_type?: string };
  photo?: Array<{ file_id: string; file_size?: number }>;
  contact?: { phone_number: string; first_name?: string; last_name?: string };
}

export interface TgCallbackQuery {
  id: string;
  from: { id?: number; username?: string };
  message: { chat: { id: number }; message_id: number };
  data: string;
}

export type KbEntry = { id: string; content: string; summary?: string | null; source?: string | null };

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
