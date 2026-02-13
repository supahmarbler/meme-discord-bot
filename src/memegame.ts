/**
 * Meme Race Game - Pick a coin and race for 24h!
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');
const GAMES_FILE = join(DATA_DIR, 'memegames.json');

export interface Pick {
  userId: string;
  username: string;
  coinId: number;
  coinName: string;
  coinSymbol: string;
  coinKey: string;
  priceAtPick: number;
  currentPrice?: number;
  percentChange?: number;
  pickedAt: string;
  wagerAmount?: number;
}

export interface MemeGame {
  id: string;
  guildId: string;
  channelId: string;
  startedBy: string;
  startedAt: string;        // When game was created
  pickEndsAt: string;       // 24h after start - when picks close
  raceEndsAt: string;       // 24h after picks close - when race ends
  phase: 'picking' | 'racing' | 'finished';
  picks: Pick[];
  winner?: {
    userId: string;
    username: string;
    coinSymbol: string;
    percentChange: number;
  };
  lastUpdateAt?: string;
  updateCount: number;
  lastLeader?: string;
}

interface GamesData {
  games: MemeGame[];
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadGames(): GamesData {
  ensureDataDir();
  if (!existsSync(GAMES_FILE)) {
    return { games: [] };
  }
  try {
    return JSON.parse(readFileSync(GAMES_FILE, 'utf-8'));
  } catch {
    return { games: [] };
  }
}

function saveGames(data: GamesData) {
  ensureDataDir();
  writeFileSync(GAMES_FILE, JSON.stringify(data, null, 2));
}

export function createGame(
  guildId: string,
  channelId: string,
  startedBy: string
): MemeGame | null {
  const data = loadGames();

  // Check if there's already an active game in this guild
  const activeGame = data.games.find(
    g => g.guildId === guildId && g.phase !== 'finished'
  );
  if (activeGame) {
    return null; // Can't start new game while one is active
  }

  const now = new Date();
  const pickEnds = new Date(now.getTime() + 1 * 60 * 60 * 1000);  // 1 hour
  const raceEnds = new Date(pickEnds.getTime() + 24 * 60 * 60 * 1000);  // 24 hours

  const game: MemeGame = {
    id: `mg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    guildId,
    channelId,
    startedBy,
    startedAt: now.toISOString(),
    pickEndsAt: pickEnds.toISOString(),
    raceEndsAt: raceEnds.toISOString(),
    phase: 'picking',
    picks: [],
    updateCount: 0,
  };

  data.games.push(game);
  saveGames(data);

  return game;
}

export function getActiveGame(guildId: string): MemeGame | null {
  const data = loadGames();
  return data.games.find(
    g => g.guildId === guildId && g.phase !== 'finished'
  ) || null;
}

export function getGame(gameId: string): MemeGame | null {
  const data = loadGames();
  return data.games.find(g => g.id === gameId) || null;
}

export function addPick(
  gameId: string,
  userId: string,
  username: string,
  coinId: number,
  coinName: string,
  coinSymbol: string,
  coinKey: string,
  priceAtPick: number,
  wagerAmount?: number
): { success: boolean; error?: string } {
  const data = loadGames();
  const game = data.games.find(g => g.id === gameId);

  if (!game) {
    return { success: false, error: 'Game not found' };
  }

  if (game.phase !== 'picking') {
    return { success: false, error: 'Pick window has closed' };
  }

  // Check if user already picked
  if (game.picks.some(p => p.userId === userId)) {
    return { success: false, error: 'You already picked a coin' };
  }

  // Check if coin is already taken
  if (game.picks.some(p => p.coinId === coinId)) {
    return { success: false, error: `${coinSymbol} is already taken by another player` };
  }

  game.picks.push({
    userId: userId,
    username: username,
    coinId,
    coinName,
    coinSymbol,
    coinKey,
    priceAtPick,
    pickedAt: new Date().toISOString(),
    wagerAmount,
  });

  saveGames(data);
  return { success: true };
}

export function updateGamePhase(gameId: string): MemeGame | null {
  const data = loadGames();
  const game = data.games.find(g => g.id === gameId);

  if (!game) return null;

  const now = new Date();

  if (game.phase === 'picking' && now >= new Date(game.pickEndsAt)) {
    game.phase = 'racing';
  }

  if (game.phase === 'racing' && now >= new Date(game.raceEndsAt)) {
    game.phase = 'finished';
  }

  saveGames(data);
  return game;
}

export function updatePrices(
  gameId: string,
  prices: Map<number, number>
): MemeGame | null {
  const data = loadGames();
  const game = data.games.find(g => g.id === gameId);

  if (!game) return null;

  for (const pick of game.picks) {
    const currentPrice = prices.get(pick.coinId);
    if (currentPrice !== undefined) {
      pick.currentPrice = currentPrice;
      pick.percentChange = ((currentPrice - pick.priceAtPick) / pick.priceAtPick) * 100;
    }
  }

  game.lastUpdateAt = new Date().toISOString();
  saveGames(data);
  return game;
}

export function setWinner(gameId: string): MemeGame | null {
  const data = loadGames();
  const game = data.games.find(g => g.id === gameId);

  if (!game || game.picks.length === 0) return null;

  // Find best performer
  const sorted = [...game.picks].sort(
    (a, b) => (b.percentChange ?? -Infinity) - (a.percentChange ?? -Infinity)
  );

  const winner = sorted[0];
  game.winner = {
    userId: winner.userId,
    username: winner.username,
    coinSymbol: winner.coinSymbol,
    percentChange: winner.percentChange ?? 0,
  };

  saveGames(data);
  return game;
}

export function incrementUpdateCount(gameId: string, currentLeader?: string): number {
  const data = loadGames();
  const game = data.games.find(g => g.id === gameId);
  if (!game) return 0;

  game.updateCount++;
  if (currentLeader) {
    game.lastLeader = currentLeader;
  }
  saveGames(data);
  return game.updateCount;
}

export function getAllActiveGames(): MemeGame[] {
  const data = loadGames();
  return data.games.filter(g => g.phase !== 'finished');
}

export function getTimeRemaining(targetDate: string): string {
  const now = new Date();
  const target = new Date(targetDate);
  const diff = target.getTime() - now.getTime();

  if (diff <= 0) return 'Ended';

  const hours = Math.floor(diff / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function getTotalWagerPool(gameId: string): number {
  const game = getGame(gameId);
  if (!game) return 0;
  return game.picks.reduce((sum, p) => sum + (p.wagerAmount || 0), 0);
}

export function getWageredPicks(gameId: string): Pick[] {
  const game = getGame(gameId);
  if (!game) return [];
  return game.picks.filter(p => p.wagerAmount && p.wagerAmount > 0);
}

// Race commentary based on standings
export function generateCommentary(game: MemeGame, previousLeader?: string): string {
  if (game.picks.length === 0) return '';

  const sorted = [...game.picks].sort(
    (a, b) => (b.percentChange ?? -Infinity) - (a.percentChange ?? -Infinity)
  );

  const leader = sorted[0];
  const leaderChange = leader.percentChange ?? 0;
  const leaderStr = `${leaderChange >= 0 ? '+' : ''}${leaderChange.toFixed(1)}%`;

  const random = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

  // Check for lead change
  if (previousLeader && previousLeader !== leader.coinSymbol) {
    return random([
      `:rotating_light: LEAD CHANGE! **${leader.coinSymbol}** overtakes **${previousLeader}** and takes the lead at ${leaderStr}!`,
      `:fire: **${leader.coinSymbol}** SURGES PAST **${previousLeader}**! New leader at ${leaderStr}!`,
      `:boom: WHAT A MOVE! **${leader.coinSymbol}** steals the crown from **${previousLeader}**!`,
    ]);
  }

  // Determine scenario
  const allChanges = sorted.map(p => p.percentChange ?? 0);
  const allRed = allChanges.every(c => c < 0);
  const allGreen = allChanges.every(c => c > 0);

  if (sorted.length > 1) {
    const second = sorted[1];
    const secondChange = second.percentChange ?? 0;
    const secondStr = `${secondChange >= 0 ? '+' : ''}${secondChange.toFixed(1)}%`;
    const gap = leaderChange - secondChange;

    if (allRed) {
      const best = leader;
      return random([
        `:chart_with_downwards_trend: Bloodbath! **${best.coinSymbol}** at ${leaderStr} is bleeding the least!`,
        `:skull: Everyone's in the red! **${best.coinSymbol}** (${leaderStr}) hanging on for survival!`,
        `:warning: Rough day! **${best.coinSymbol}** leads with ${leaderStr} - but that's still red!`,
      ]);
    }

    if (allGreen) {
      return random([
        `:rocket: PUMP CITY! **${leader.coinSymbol}** leads at ${leaderStr}, **${second.coinSymbol}** chasing at ${secondStr}!`,
        `:chart_with_upwards_trend: Everyone's green! **${leader.coinSymbol}** (${leaderStr}) with **${second.coinSymbol}** (${secondStr}) in hot pursuit!`,
        `:moneybag: The memes are PUMPING! **${leader.coinSymbol}** up ${leaderStr}!`,
      ]);
    }

    if (gap > 10) {
      return random([
        `:crown: **${leader.coinSymbol}** is DOMINATING at ${leaderStr}! **${second.coinSymbol}** trails far behind at ${secondStr}!`,
        `:muscle: **${leader.coinSymbol}** flexing hard at ${leaderStr}! The gap is massive!`,
        `:fire: **${leader.coinSymbol}** (${leaderStr}) has left everyone in the dust!`,
      ]);
    }

    if (gap < 2) {
      return random([
        `:eyes: NECK AND NECK! **${leader.coinSymbol}** (${leaderStr}) vs **${second.coinSymbol}** (${secondStr})!`,
        `:sweat_drops: Too close! **${leader.coinSymbol}** barely ahead of **${second.coinSymbol}**!`,
        `:boxing_glove: **${leader.coinSymbol}** and **${second.coinSymbol}** trading blows! Gap is just ${gap.toFixed(1)}%!`,
      ]);
    }

    return random([
      `:racing_car: **${leader.coinSymbol}** leads at ${leaderStr}! **${second.coinSymbol}** at ${secondStr} looking to close the gap!`,
      `:eyes: **${leader.coinSymbol}** (${leaderStr}) in front, but **${second.coinSymbol}** (${secondStr}) is making moves!`,
      `:trophy: **${leader.coinSymbol}** holding strong at ${leaderStr}!`,
    ]);
  }

  return `:trophy: **${leader.coinSymbol}** in the lead at ${leaderStr}!`;
}
