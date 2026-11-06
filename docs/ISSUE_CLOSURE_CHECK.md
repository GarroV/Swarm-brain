# Проверка закрытия issues (#1079)

`issue-closures.yml` на push в `main` читает все новые коммиты `before..after`,
включая коммиты влитых веток, и проверяет, закрыты ли упомянутые ими issues.
Запись в GitHub, автоматическое закрытие, комментарии и раскатка отсутствуют.
На PR этот workflow гоняет только Git-фикстуры и порчу, без сетевых запросов.

Merge через `GITHUB_TOKEN` не создаёт новый push-workflow
([GitHub Docs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)).
Поэтому отдельный read-only trigger `workflow_run` после точного «Ночная раскатка»
проверяет `run.head_sha..checkout HEAD` текущего main. Completed runs проверяются
при любом conclusion: после слияния мог упасть следующий шаг. No new commits —
явный no-op PASS; чужой repo/branch/workflow и недоказуемый диапазон — ошибка.
Существующая раскатка не меняется; artifacts предшествующего workflow не исполняются.

Поддержаны документированные GitHub keywords `close/closes/closed`, `fix/fixes/fixed`,
`resolve/resolves/resolved`, регистр и необязательное двоеточие; ссылки `#N` и
`GarroV/Swarm-brain#N`. Перед каждой ссылкой нужен свой keyword. Другие репозитории
игнорируются; PR-номера отделяются от issues по типу metadata.
[Канон синтаксиса GitHub](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue).
URL-формы, PR-body-only и ручные связи в этот checker не входят.

GraphQL query запрашивает только typename/number/state, без title/body. После первого
чтения остающиеся OPEN проверяются ещё трижды с интервалом 5 секунд. Exit 0 — все
проверенные issues закрыты (либо ссылок нет), 1 — остались OPEN, 2 — проверить нельзя
(ошибка Git/API, неполные metadata, недоступная история). Новый/переписанный main без
доказуемого before-SHA не превращается в зелёный пропуск. Это проверка текущего
состояния после слияния, а не подтверждение исправления или раскатки соответствующего кода.

```bash
python3 scripts/check-issue-closures.py --base <before-sha> --head <after-sha>
python3 scripts/check-issue-closures.py --event "$GITHUB_EVENT_PATH"
python3 scripts/test-issue-closures.py
python3 scripts/test-issue-closures.py porcha
```

Для ручной проверки доступны `--attempts 1..6`, `--interval 0..10`; каждый запрос
ограничен 10 секундами, весь CI job — пятью минутами. Права workflow только read.
