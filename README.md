# Chythe Moderation Bot

Discord moderation bot with a clean setup panel and safe bulk message deletion.

## Commands
- `/setup` — opens the server setup/status panel. Requires Manage Server.
- `/purge amount:<1-100>` — confirms and deletes recent messages. Requires Manage Messages.

## Safety
Uses Discord's official API and discord.js rate-limit handling. No proxies, rate-limit bypassing, or unlimited deletion loops.

## Render
- Build: `npm install`
- Start: `npm start`
- `PORT` defaults to `10000`
- Health endpoint: `/health`

## Environment
Set `DISCORD_TOKEN`, `CLIENT_ID`, and optionally `PORT`.
