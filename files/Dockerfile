# swarm-files — хранилище файлов к задачам (files/README.md). Контекст сборки — корень репозитория:
# сервис делит с swarm-api модуль подписи ссылок (supabase/functions/_shared/files-token.ts).
FROM denoland/deno:2.9.7
WORKDIR /app
COPY supabase/functions/_shared/files-token.ts supabase/functions/_shared/task-files.ts ./supabase/functions/_shared/
COPY files/server.ts ./files/
RUN deno cache files/server.ts
USER deno
EXPOSE 8031
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read=/data", "--allow-write=/data", "files/server.ts"]
