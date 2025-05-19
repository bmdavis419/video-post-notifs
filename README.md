## discord notifs on upload

_this is just a basic cloudflare worker that runs every 5 minutes_

### setup

You just need to get your discord token and channel id, and put them in the `.dev.vars` file.

```
DISCORD_TOKEN=your_token
DISCORD_CHANNEL_ID=your_channel_id
```

### deploying

```
pnpm run deploy
```
