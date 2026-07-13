# EdgeProof — инструкция на русском

EdgeProof — автономный paper-trading агент для футбольных рынков. Он объединяет события матча из TxLINE Scores и вероятности TxLINE StablePrice, находит запаздывающее изменение рынка, объясняет решение и сохраняет идентификаторы для Merkle-proof.

## Как лучше выкладывать на конкурс

Публичный Render-сервис должен всегда открываться без кошелька, API-токена судьи и ожидания живого матча. Поэтому основной URL лучше оставить в режиме детерминированного replay.

Но финальная версия replay должна по возможности содержать **реальные исторические данные TxLINE**, а не синтетику. После получения TxLINE API token сначала выведите список матчей, затем захватите подходящий fixture:

```bash
TXLINE_API_TOKEN="..." npm run fixtures:txline

TXLINE_API_TOKEN="..." \
TXLINE_FIXTURE_ID="..." \
npm run capture:txline
```

Скрипт:

- получает реальные scores historical;
- получает odds updates по пятиминутным интервалам;
- фильтрует записи по fixture;
- пытается получить odds proof и score proof;
- создаёт `data/txline-replay.json` и `data/replay-meta.json`;
- не сохраняет токены или данные кошелька.

После этого в `render.yaml` замените:

```yaml
REPLAY_FILE: data/demo-replay.json
```

на:

```yaml
REPLAY_FILE: data/txline-replay.json
```

Если до дедлайна реальный historical replay получить не удалось, оставляйте synthetic judge replay, но обязательно приложите короткое видео с реальным `DATA_MODE=txline`.

## Запуск

```bash
npm ci
npm test
npm start
```

Откройте `http://localhost:3000`.

## Live TxLINE

```bash
DATA_MODE=txline
TXLINE_BASE_URL=https://txline.txodds.com
TXLINE_API_TOKEN=<активированный токен>
TXLINE_FIXTURE_ID=<ID матча>
HOME_TEAM=<команда 1>
AWAY_TEAM=<команда 2>
npm start
```

Начальный guest JWT указывать необязательно: приложение получает и обновляет его автоматически.

## Проверка перед публикацией

```bash
npm test
npm run preflight
```

Если preflight сообщает, что replay synthetic, это предупреждение, а не ошибка.
