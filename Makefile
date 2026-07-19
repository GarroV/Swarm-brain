# Swarm Brain — пред-прод / деплой. Контуры: local (supabase start) → staging (MUSPELHEIM) → prod.
# Staging = self-hosted Supabase на домашнем сервере MUSPELHEIM (по Tailscale, приватно).
# См. docs/DEPLOY.md.

STAGING_FN := http://100.64.116.67:8020/functions/v1
PROD_FN    := https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1
MUSPEL     := muspelheim
SB         := C:/projects/swarm-staging
# Пароль staging-БД НЕ в git — читаем из ~/.swarm/staging_pgpw (git-ignored, вне репо).
# Инициализация (демо-дефолт Supabase для приватного staging): см. docs/DEPLOY.md.
STAGING_PGPW := $(shell cat $(HOME)/.swarm/staging_pgpw 2>/dev/null)

.PHONY: help smoke-staging smoke-prod staging-sync-functions staging-migrate staging-psql staging-ps staging-up staging-down

help:
	@echo "smoke-staging          — смоук edge-функций на staging (MUSPELHEIM)"
	@echo "smoke-prod             — смоук edge-функций на проде"
	@echo "staging-sync-functions — залить supabase/functions на staging + рестарт edge-runtime"
	@echo "staging-migrate FILE=… — накатить SQL-файл на staging-БД (ON_ERROR_STOP)"
	@echo "staging-psql           — psql в staging-БД (ad-hoc, стдин)"
	@echo "staging-ps / -up / -down — статус/подъём/останов staging-стека"

smoke-staging:
	bash scripts/smoke.sh $(STAGING_FN)

smoke-prod:
	bash scripts/smoke.sh $(PROD_FN)

# Залить актуальные функции на staging (tar → scp → распаковка → рестарт edge-runtime).
staging-sync-functions:
	tar czf /tmp/swfns.tgz -C supabase/functions --exclude='.DS_Store' .
	scp /tmp/swfns.tgz $(MUSPEL):$(SB)/volumes/functions/swfns.tgz
	ssh $(MUSPEL) "powershell -NoProfile -Command \"cd $(SB)/volumes/functions; tar xzf swfns.tgz; Remove-Item swfns.tgz; docker restart supabase-edge-functions | Out-Null; Write-Output synced\""

# Накатить один SQL-файл на staging-БД. Пример: make staging-migrate FILE=supabase/migrations/2026...sql
staging-migrate:
	@test -n "$(FILE)" || (echo "нужно FILE=<путь к .sql>"; exit 1)
	@test -n "$(STAGING_PGPW)" || (echo "нет пароля staging-БД — положи в ~/.swarm/staging_pgpw (см. docs/DEPLOY.md)"; exit 1)
	cat $(FILE) | ssh $(MUSPEL) "docker exec -e PGPASSWORD=$(STAGING_PGPW) -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1"

# psql в staging-БД: echo "SELECT ..." | make staging-psql
staging-psql:
	@test -n "$(STAGING_PGPW)" || (echo "нет пароля staging-БД — положи в ~/.swarm/staging_pgpw (см. docs/DEPLOY.md)"; exit 1)
	ssh $(MUSPEL) "docker exec -e PGPASSWORD=$(STAGING_PGPW) -i supabase-db psql -U postgres -d postgres"

staging-ps:
	ssh $(MUSPEL) "powershell -NoProfile -Command \"cd $(SB); docker compose ps --format '{{.Name}}  {{.Status}}'\""

staging-up:
	ssh $(MUSPEL) "powershell -NoProfile -Command \"cd $(SB); docker compose up -d\""

staging-down:
	ssh $(MUSPEL) "powershell -NoProfile -Command \"cd $(SB); docker compose stop\""
