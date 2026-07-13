# Что делать дальше — пошагово

## Срочно: до дедлайна India Buildathon

Основной приоритет — получить публичные ссылки GitHub и Render и отправить проект в оба листинга. Не откладывайте подачу из-за отсутствия реального historical replay: текущий synthetic replay честно обозначен и полностью работает. Реальные данные TxLINE желательно добавить сразу после базовой публикации.

## 1. GitHub

Создайте публичный пустой репозиторий `edgeproof` в аккаунте `kovyrus`. Не добавляйте README, .gitignore или License.

Распакуйте архив `edgeproof-git-ready-v1.1.0.zip`. Внутри уже есть ветка `main` и готовый commit.

В PowerShell из папки проекта:

```powershell
git remote add origin https://github.com/kovyrus/edgeproof.git
git push -u origin main
```

Если remote уже существует:

```powershell
git remote set-url origin https://github.com/kovyrus/edgeproof.git
git push -u origin main
```

После создания репозитория откройте GitHub Settings → Applications → Installed GitHub Apps → Configure и дайте подключённому приложению ChatGPT доступ к `edgeproof`.

## 2. Render

После push откройте Blueprint URL:

```text
https://dashboard.render.com/blueprint/new?repo=https://github.com/kovyrus/edgeproof
```

Нажмите Apply. Render прочитает `render.yaml`, выполнит `npm ci`, запустит `npm start` и проверит `/api/health`.

Основной публичный URL оставьте в режиме replay. Это гарантирует, что судья увидит полный сценарий независимо от текущего футбольного матча.

## 3. Реальный TxLINE replay

Для этого требуется ваш активированный `TXLINE_API_TOKEN`; он создаётся с участием вашего Solana-кошелька и не должен передаваться или публиковаться.

PowerShell:

```powershell
$env:TXLINE_API_TOKEN="ВАШ_ТОКЕН"
npm run fixtures:txline
```

Выберите fixture с пометкой `[historical window]`, затем:

```powershell
$env:TXLINE_API_TOKEN="ВАШ_ТОКЕН"
$env:TXLINE_FIXTURE_ID="ID_МАТЧА"
npm run capture:txline
```

Проверьте, что `data/replay-meta.json` содержит:

```json
"source": "txline-historical"
```

В `render.yaml` замените:

```yaml
value: data/demo-replay.json
```

на:

```yaml
value: data/txline-replay.json
```

Затем:

```powershell
git add .
git commit -m "Use authenticated TxLINE historical replay"
git push
```

## 4. Видео и подача

Запишите 60–90 секунд по `DEMO_SCRIPT.md`. Покажите provenance badge, сигнал после гола, размер позиции, MessageId/seq и Proof Vault.

В `SUBMISSION.md` замените три placeholder:

- `<LIVE_URL>`
- `<GITHUB_URL>`
- `<VIDEO_URL>`

Подайте один и тот же проект:

1. в глобальный трек Trading Tools and Agents;
2. в TxODDS World Cup Buildathon India.
