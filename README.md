# Meme.com Discord Bot

Discord bot for checking memecoin prices, holder stats, and leaderboards from meme.com.

## Setup

1. Create a Discord Application at https://discord.com/developers/applications
2. Create a bot and copy the token
3. Enable the `applications.commands` scope when generating invite link
4. Invite the bot to your server

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_client_id
DISCORD_GUILD_ID=optional_test_server_id
```

- `DISCORD_TOKEN` - Bot token from Discord Developer Portal
- `DISCORD_CLIENT_ID` - Application ID from Discord Developer Portal
- `DISCORD_GUILD_ID` - (Optional) For instant command updates during development

## Register Commands

```bash
npm run register
```

If `DISCORD_GUILD_ID` is set, commands register instantly to that server.
Otherwise, global registration takes up to 1 hour.

## Run

Development:
```bash
npm run dev
```

Production:
```bash
npm run build
npm start
```

## Commands

| Command | Description |
|---------|-------------|
| `/top [count]` | Show top memecoins by market cap |
| `/price <coin>` | Get price and stats for a coin |
| `/holders <coin>` | Show holder statistics |
| `/diamonds <coin>` | Show diamond hands stats |
| `/stats` | Platform-wide statistics |
| `/leaderboard [page]` | Top users by memescore |
| `/wallet <address> [type]` | Look up user by wallet |
| `/verified` | List verified memecoins |

## API

Uses the public meme.com API at `https://api.v2.meme.com`

No authentication required for read operations.
