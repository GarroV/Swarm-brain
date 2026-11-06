// HTTP response for task extraction (#136), isolated from routing and model credentials.
// One completion metric per invocation: only fixed labels and numbers, never input/tasks/errors.
// SSE TTFT ends when the first valid task is enqueued; JSON has no streaming TTFT.
import { createJsonObjectScanner } from "../_shared/json-object-stream.ts";
import { readOpenAiSseChunk } from "../_shared/openai-sse.ts";
import {
  EXTRACT_MAX_TASKS,
  type ExtractedTask,
  EXTRACTOR_UNAVAILABLE,
  type ExtractResult,
  toExtractedTask,
} from "../_shared/task-extract.ts";
import { apiErr, corsHeaders, json } from "./http.ts";
import { INTERNAL_ERROR_MESSAGE } from "./client-error.ts";

export type ExtractionMetric = {
  event: "task_extract";
  mode: "sse" | "json";
  outcome: "done" | "upstream_error" | "invalid_response" | "stream_error";
  task_count: number;
  first_task_ms: number | null;
  total_ms: number;
};
type Options = {
  origin: string;
  today: string;
  requestStream: () => Promise<Response>;
  extractJson: () => Promise<ExtractResult>;
  now?: () => number;
  log?: (metric: ExtractionMetric) => void;
};

export async function taskExtractionResponse(mode: "sse" | "json", options: Options): Promise<Response> {
  const { origin, today } = options;
  const now = options.now ?? (() => performance.now());
  const log = options.log ?? ((metric) => console.info(JSON.stringify(metric)));
  const started = now();
  const elapsed = () => Math.round(now() - started);
  let count = 0;
  let firstTaskMs: number | null = null;
  const finish = (outcome: ExtractionMetric["outcome"]) =>
    log({
      event: "task_extract",
      mode,
      outcome,
      task_count: count,
      first_task_ms: firstTaskMs,
      total_ms: elapsed(),
    });
  if (mode === "json") {
    let result: ExtractResult;
    try {
      result = await options.extractJson();
    } catch (e) {
      finish("upstream_error");
      throw e;
    }
    if (!result.ok) {
      finish(result.reason === "malformed" ? "invalid_response" : "upstream_error");
      return json(EXTRACTOR_UNAVAILABLE, 502, origin);
    }
    const tasks = result.tasks.slice(0, 10).filter((t) => t.title);
    count = tasks.length;
    finish("done");
    return json(tasks, 200, origin);
  }
  let upstream: Response;
  try {
    upstream = await options.requestStream();
  } catch (e) {
    finish("upstream_error");
    throw e;
  }
  if (!upstream.ok || !upstream.body) {
    finish("upstream_error");
    return apiErr(502, "Extractor unavailable", origin);
  }
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      const scanner = createJsonObjectScanner();
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let sseTail = "";
      let outcome: ExtractionMetric["outcome"] = "done";
      // Модель что-то написала (хоть один непустой кусок текста). Нужно, чтобы отличить
      // «задач в тезисах правда нет» от «мы не смогли разобрать ответ»: снаружи и то и другое
      // выглядит как пустой список, но первое — правда, а второе — молчаливый сбой.
      let sawContent = false;

      try {
        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseTail += decoder.decode(value, { stream: true });
          // Разбор чужого протокола вынесен в _shared/openai-sse.ts и покрыт фикстурой:
          // ошибка здесь означала бы молча пустой разбор у человека на экране.
          const { deltas, rest, done: upstreamDone } = readOpenAiSseChunk(
            sseTail,
            false,
          );
          sseTail = rest;
          for (const delta of deltas) {
            sawContent = true;
            for (const chunk of scanner.push(delta)) {
              let task: ExtractedTask | null = null;
              try {
                task = toExtractedTask(JSON.parse(chunk), today);
              } catch {
                continue; // объект не собрался в валидный JSON — пропускаем именно его
              }
              if (!task) continue;
              send({ type: "task", task });
              count++;
              if (firstTaskMs === null) firstTaskMs = elapsed();
              if (count >= EXTRACT_MAX_TASKS) break outer;
            }
          }
          if (upstreamDone) break;
        }
        if (count === 0 && sawContent) {
          // Ответ был, задач ноль — значит сломался разбор, а не встреча оказалась пустой.
          // Честная ошибка вместо «Задач не найдено»: пусть человек нажмёт ещё раз и увидит
          // причину, а не решит, что поручений в его встрече нет.
          outcome = "invalid_response";
          send({ type: "error", message: "Ответ модели не удалось разобрать" });
        } else {
          send({ type: "done", count });
        }
      } catch {
        outcome = "stream_error";
        send({ type: "error", message: INTERNAL_ERROR_MESSAGE });
      } finally {
        finish(outcome);
        reader.cancel().catch(() => {});
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
