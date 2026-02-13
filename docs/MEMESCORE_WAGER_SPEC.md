# Memescore Wagering - Backend API Spec

## Overview

Enable Discord users to wager Memescore on the Meme Race game. Users pick a memecoin and wager Memescore on their pick. Winner(s) take the prize pool.

## Architecture

```
Discord Bot                    meme.com Backend
    |                               |
    |  POST /discord/race-wager     |
    |------------------------------>|
    |                               |  UserService.getByDiscordId()
    |                               |  MarketService.placeWager()
    |      { success, balance }     |
    |<------------------------------|
```

The Discord bot calls a single backend endpoint. The backend handles user lookup and Memescore operations internally.

---

## API Endpoint

### `POST /api/v2/discord/race-wager`

**Authentication:** Service token (bot credentials)

```
Authorization: Bearer <DISCORD_BOT_SERVICE_TOKEN>
Content-Type: application/json
```

---

## Actions

### 1. Place Wager (hold funds)

Called when user runs `/pick <coin> <amount>` during pick phase.

**Request:**
```json
{
  "action": "place",
  "discordId": "387714655331680259",
  "gameId": "mg_1770904736000_qggzux",
  "coinId": 1837790969,
  "coinSymbol": "stnk",
  "amount": 10000
}
```

**Success Response (200):**
```json
{
  "success": true,
  "wagerId": "wager_abc123",
  "userId": 12345,
  "username": "supahmarbler",
  "amountHeld": 10000,
  "newBalance": 90000
}
```

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_AMOUNT` | Amount <= 0 or exceeds max |
| 400 | `ALREADY_WAGERED` | User already has wager in this game |
| 403 | `USER_NOT_LINKED` | Discord account not connected to meme.com |
| 403 | `INSUFFICIENT_BALANCE` | User doesn't have enough Memescore |
| 404 | `USER_NOT_FOUND` | No meme.com user for this Discord ID |

**Error Response Format:**
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "User has 5000 Memescore but tried to wager 10000",
    "currentBalance": 5000
  }
}
```

---

### 2. Payout Winners

Called when race ends. Bot sends ranked results, backend distributes pool.

**Request:**
```json
{
  "action": "payout",
  "gameId": "mg_1770904736000_qggzux",
  "results": [
    {
      "discordId": "350420290443935747",
      "rank": 1,
      "coinSymbol": "stnk",
      "percentChange": 11.07
    },
    {
      "discordId": "393010213474795520",
      "rank": 2,
      "coinSymbol": "bobo",
      "percentChange": 4.37
    },
    {
      "discordId": "387714655331680259",
      "rank": 3,
      "coinSymbol": "bitcoin",
      "percentChange": 2.77
    }
  ],
  "prizeDistribution": "winner_takes_all"
}
```

**Prize Distribution Options:**
- `winner_takes_all` - 1st place gets 100%
- `top_3_split` - 1st: 60%, 2nd: 30%, 3rd: 10%
- `top_3_equal` - 1st, 2nd, 3rd split equally

**Success Response (200):**
```json
{
  "success": true,
  "gameId": "mg_1770904736000_qggzux",
  "totalPool": 80000,
  "payouts": [
    {
      "discordId": "350420290443935747",
      "username": "tomtomtom0x",
      "rank": 1,
      "amountWon": 80000,
      "newBalance": 180000
    }
  ],
  "settled": true
}
```

---

### 3. Refund (cancel game)

Called if game is cancelled (e.g., not enough participants).

**Request:**
```json
{
  "action": "refund",
  "gameId": "mg_1770904736000_qggzux",
  "reason": "insufficient_participants"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "gameId": "mg_1770904736000_qggzux",
  "refunds": [
    {
      "discordId": "387714655331680259",
      "amountRefunded": 10000,
      "newBalance": 100000
    }
  ]
}
```

---

### 4. Check Balance (optional)

For `/balance` command or pre-validation.

**Request:**
```json
{
  "action": "balance",
  "discordId": "387714655331680259"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "userId": 12345,
  "username": "supahmarbler",
  "balance": 100000,
  "linkedAt": "2025-06-15T10:30:00Z"
}
```

---

## Backend Implementation Notes

### Service Layer Flow

```typescript
// Pseudocode for backend implementation

class DiscordRaceWagerController {

  async handleWager(request: WagerRequest) {
    // 1. Get user by Discord ID
    const user = await this.userService.getByDiscordId(request.discordId);
    if (!user) throw new UserNotLinkedException();

    // 2. Dispatch based on action
    switch (request.action) {
      case 'place':
        return this.marketService.placeWager(user.id, request.gameId, request.amount);
      case 'payout':
        return this.marketService.settleGame(request.gameId, request.results);
      case 'refund':
        return this.marketService.refundGame(request.gameId);
      case 'balance':
        return { balance: user.memescore };
    }
  }
}
```

### Database Considerations

**New table: `discord_race_wagers`**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | INT | FK to users |
| discord_id | VARCHAR | Discord user ID |
| game_id | VARCHAR | Race game identifier |
| coin_id | INT | Picked coin |
| amount | INT | Wager amount |
| status | ENUM | `held`, `won`, `lost`, `refunded` |
| payout_amount | INT | Amount won (if winner) |
| created_at | TIMESTAMP | Wager placed time |
| settled_at | TIMESTAMP | When settled |

### Atomicity Requirements

- **Place wager:** Deduct from balance and create wager record in single transaction
- **Payout:** Calculate distributions and update all balances atomically
- **Refund:** Return all held amounts in single transaction

---

## Discord Bot Integration

### Updated `/pick` Command Flow

```
User: /pick stonks 10000

Bot:
1. Validate coin exists (existing logic)
2. Call POST /discord/race-wager { action: "place", ... }
3. If success: Register pick + show confirmation with held amount
4. If error: Show appropriate message (not linked, insufficient balance, etc.)
```

### New Commands

| Command | Description |
|---------|-------------|
| `/pick <coin> <amount>` | Pick coin AND wager Memescore |
| `/balance` | Check linked Memescore balance |
| `/link` | Show instructions to link Discord on meme.com |

### Race End Flow

```
Bot (on race end):
1. Calculate final rankings
2. Call POST /discord/race-wager { action: "payout", results: [...] }
3. Announce winners with payout amounts
```

---

## Security Considerations

1. **Service Token:** Bot uses a dedicated service account token, not user tokens
2. **Rate Limiting:** Limit wager endpoint to prevent abuse
3. **Wager Limits:**
   - Minimum: 1,000 Memescore
   - Maximum: 100,000 Memescore (configurable)
4. **One Wager Per Game:** User can only have one active wager per game
5. **Audit Log:** All wager transactions logged for review

---

## Configuration (Backend)

```yaml
discord_race_wager:
  enabled: true
  min_wager: 1000
  max_wager: 100000
  min_participants: 2
  prize_distribution: "winner_takes_all"
  service_token_hash: "<hashed_bot_token>"
```

---

## Questions for Backend Team

1. Does `UserService` already have a `getByDiscordId()` method from the quest integration?
2. Should wagers be held in a separate escrow balance or deducted immediately?
3. What's the preferred prize distribution model?
4. Should there be a house fee (e.g., 5% of pool)?
5. Rate limit requirements for the endpoint?

---

## Timeline Estimate

| Task | Estimate |
|------|----------|
| DB migration (wagers table) | 1-2 hours |
| Endpoint + service methods | 4-6 hours |
| Discord bot integration | 2-3 hours |
| Testing | 2-3 hours |
| **Total** | ~1-2 days |
