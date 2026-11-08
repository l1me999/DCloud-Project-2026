# DCloud — proof-of-concept децентрализованного облачного хранилища

DCloud шифрует файл на стороне сервиса, делит его на фрагменты и раскладывает
реплики по независимым узлам. Проект показывает базовый цикл:

1. загрузка файла;
2. шифрование AES-256-GCM;
3. фрагментация и размещение трёх реплик на разных узлах;
4. просмотр карты фрагментов;
5. скачивание, сборка и проверка SHA-256;
6. имитация отказа узла и восстановление из оставшихся реплик;
7. удаление файла и всех его фрагментов.

## Стек

- Python 3.12, FastAPI, SQLAlchemy 2, PostgreSQL;
- `cryptography` (AES-256-GCM);
- ванильный HTML/CSS/JS без сборщика;
- pytest для тестов;
- GitHub Actions: тесты + деплой статической витрины на GitHub Pages.

## Быстрый старт

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# PostgreSQL должен быть запущен; база создаётся один раз
psql -U postgres -c "CREATE DATABASE dcloud"

uvicorn app.main:app --reload
```

Открыть <http://127.0.0.1:8000>. Swagger: <http://127.0.0.1:8000/docs>.

### Переменные окружения

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `DCLOUD_DATABASE_URL` | `postgresql+psycopg://postgres@localhost:5432/dcloud` | подключение к БД |
| `DCLOUD_DATA_DIR` | `./data` | каталог узлов и мастер-ключа |
| `DCLOUD_MASTER_KEY` | генерируется в `data/master.key` | мастер-ключ, base64 32 байта |
| `DCLOUD_MAX_FILE_SIZE` | `20971520` (20 МБ) | лимит размера файла |
| `DCLOUD_CHUNK_SIZE` | `16384` (16 КБ) | размер фрагмента |
| `DCLOUD_REPLICAS` | `3` | число реплик на фрагмент |
| `DCLOUD_NODE_CAPACITY` | `104857600` (100 МБ) | ёмкость виртуального узла |

`data/master.key` и каталог `data/` не коммитятся. Для production мастер-ключ
нужно хранить в KMS/секрет-менеджере, а не в файле.

## API

| Метод | Путь | Назначение |
| --- | --- | --- |
| `GET` | `/api/health` | проверка сервиса |
| `GET` | `/api/files` | список файлов |
| `POST` | `/api/files` | загрузка файла (multipart) |
| `GET` | `/api/files/{id}` | карточка файла |
| `GET` | `/api/files/{id}/chunks` | карта фрагментов и реплик |
| `GET` | `/api/files/{id}/download` | сборка, проверка и скачивание |
| `DELETE` | `/api/files/{id}` | удаление файла и фрагментов |
| `GET` | `/api/nodes` | список узлов и свободного места |
| `POST` | `/api/nodes/{id}/status` | включить/отключить узел |

## Тесты

```powershell
pytest
```

Тесты используют временную SQLite-базу и временный каталог узлов, поэтому
PostgreSQL для `pytest` не нужен. Покрыты: шифрование/расшифровка, загрузка,
список, карта фрагментов, три реплики на разных узлах, отказ узла, повреждение
реплик, удаление и валидация.

## GitHub Pages

`site/` — статическая витрина интерфейса с демо-данными. Workflow
`.github/workflows/ci.yml` запускает тесты и после push в `main` публикует
`site/` через GitHub Pages. Полноценная версия с API запускается локально.

## Структура

```text
app/
  crypto.py      AES-256-GCM, обёртка DEK
  models.py      files, chunks, replicas, nodes
  service.py     загрузка, скачивание, удаление, карта фрагментов
  storage.py     виртуальные узлы и выбор реплик
  main.py        FastAPI-маршруты
static/          рабочее веб-приложение
site/            статическая демо-витрина для GitHub Pages
tests/           pytest
```

## Ограничения proof-of-concept

- виртуальные узлы вместо реальной P2P-сети;
- репликация вместо Reed-Solomon;
- нет RBAC, SSO и журнала аудита;
- нет сертификации 152-ФЗ/УЗ-1;
- мастер-ключ в локальном файле — только для демо.
