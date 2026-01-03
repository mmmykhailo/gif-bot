# Telegram GIF Search Bot

A high-performance Telegram bot for searching and indexing GIFs with full-text search capabilities.

## Features

- **GIF Indexing**: Send GIFs in private chat and tag them with descriptions
- **Full-Text Search**: Fast inline search using SQLite FTS5 with trigram matching
- **Partial Matching**: Search for "apple" and find "pineapple"
- **Auto-Update**: Existing GIFs get updated file_ids and merged descriptions
- **Production Ready**: Optimized for sub-100ms search performance

## Tech Stack

- **Runtime**: [Bun](https://bun.sh) - Ultra-fast JavaScript runtime
- **Framework**: [grammY](https://grammy.dev) - Modern Telegram Bot framework
- **Database**: SQLite with FTS5 (Full-Text Search)
- **Language**: TypeScript

## Installation

1. Install Bun:
```bash
curl -fsSL https://bun.sh/install | bash
```

2. Clone and install dependencies:
```bash
git clone <your-repo-url>
cd gif-bot
bun install
```

3. Create your environment file:
```bash
cp .env.example .env
```

4. Get your bot token from [@BotFather](https://t.me/botfather) and add it to `.env`:
```
BOT_TOKEN=your_bot_token_here
```

## Usage

### Development Mode
```bash
bun run dev
```

### Production Mode
```bash
bun start
```

### Build
```bash
bun run build
```

## How It Works

### Adding GIFs

1. Send a GIF to the bot in a private chat
2. The bot will ask for tags/description
3. Send text with searchable keywords
4. If the GIF already exists, your tags will be appended to the existing description

### Searching GIFs

Use inline mode in any chat:
```
@your_bot_name your search query
```

Examples:
- `@your_bot_name dancing cat`
- `@your_bot_name funny`
- `@your_bot_name react` (will also find "reaction")

## Database Schema

### Main Table: `gifs`
```sql
CREATE TABLE gifs (
  file_unique_id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  description TEXT NOT NULL,
  added_by INTEGER NOT NULL
);
```

### FTS5 Search Table: `gifs_search`
```sql
CREATE VIRTUAL TABLE gifs_search USING fts5(
  file_unique_id UNINDEXED,
  description,
  tokenize="trigram"
);
```

### Triggers
Automatic triggers keep the FTS5 index synchronized with the main table on INSERT, UPDATE, and DELETE operations.

## Commands

- `/start` - Show welcome message
- `/stats` - Display database statistics

## Performance

- **Search Speed**: Sub-100ms response time
- **Trigram Matching**: Supports partial and prefix matches
- **Caching**: Inline query results cached for 5 minutes
- **Limit**: Returns top 20 most relevant results

## Production Considerations

- Uses `is_personal: false` for better caching
- Implements graceful shutdown (SIGINT/SIGTERM)
- Error handling for all database and API operations
- Optimized FTS5 queries with rank-based ordering

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `BOT_TOKEN` | Telegram Bot API token from @BotFather | Yes |

## License

MIT
