SmartAnalytics Server — Conversation Storage (MongoDB)

Overview
- This server supports persistent chat conversation storage using MongoDB.
- It maintains backward compatibility with prior SQLite/Postgres modes.

Quick Setup
- Option A: Local install (Windows/macOS/Linux)
  - Install MongoDB Community Server.
  - Start `mongod` and ensure it listens on `localhost:27017`.
- Option B: Docker (recommended)
  - See `docker-compose.mongo.yml` in this folder.
  - Run: `docker compose -f docker-compose.mongo.yml up -d`.

Environment Variables
- `CONV_DB_MONGO_URL` — e.g. `mongodb://localhost:27017/`
- `CONV_DB_MONGO_DB` — database name, e.g. `trae2`
- `CONV_RETENTION_DAYS` — auto-expire conversations after N days (optional)
- `CONV_DB_BACKUP_MS` — JSON backup interval in ms (default 6h)
- `CONV_DB_BACKUP_DIR` — directory for backup JSON snapshots
- `CONV_DB_MONGO_TXN` — `true` to use multi-doc transactions in migration
- Legacy (for migration only): `CONV_DB_SQLITE_PATH` — path to existing SQLite file

Start Dev Servers
- Install deps in repo root: `npm install`
- Start backend: `npm run dev:server` (in `apps/server` or root)
- Start web: `npm run dev:web` (in repo root)
- When `CONV_DB_MONGO_URL` is set, server initializes Mongo collections and indexes.

Migration (SQLite → Mongo)
- Ensure both `CONV_DB_SQLITE_PATH` and `CONV_DB_MONGO_URL` are set.
- Optional: Set `CONV_DB_MONGO_DB` and `CONV_DB_MONGO_TXN=true`.
- Run: `npm run migrate:sqlite-to-mongo` (from `apps/server`).
- A JSON export backup is written under `CONV_DB_BACKUP_DIR`.

Backup
- Ad-hoc: `npm run backup:conversations` creates a JSON snapshot of conversations/messages.
- Scheduled: Server’s backup worker periodically writes JSON snapshots when Mongo mode is enabled.

Endpoints (selected)
- `GET /state/conversations` — list conversations for current user
- `POST /state/conversations` — upsert bulk conversation history (migration, sync)
- `GET /state/conversations/:id/messages` — paginated messages
- `POST /state/conversations/:id/messages` — append a message
- `PATCH /state/conversations/:id` — update title/status/tags/expires
- `DELETE /state/conversations/:id` — delete conversation and messages
- `PATCH /state/conversations/:id/messages/:mid` — update message content/tokens/status/metadata
- `GET /state/messages/search?q=...` — search across user’s message history

Performance
- Indexes: text index on `messages.content`, compound indexes on `updatedAt`, `conversationId/createdAt`.
- Fast recent retrieval: conversations sorted by `updatedAt`, messages by `createdAt`.

Maintenance
- Retention worker: deletes expired conversations and their messages.
- Backups: JSON snapshots; configure directory and cadence.
- Disk usage: Docker volume or MongoDB data directory stores all data on disk.

Notes
- SQLite/Postgres modes remain available for dev/test; Mongo mode activates when `CONV_DB_MONGO_URL` is set.
- Some advanced attributes (e.g., message `status`, `metadata`, conversation `tags`) are supported fully in Mongo and partially/no-op in SQL modes.