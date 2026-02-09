import axios from 'axios';

// Simple cache
const cache = new Map<string, { data: any; expires: number }>();
const CACHE_TTL = 60000; // 60 seconds

function getCached<T>(key: string): T | null {
  const item = cache.get(key);
  if (item && item.expires > Date.now()) {
    return item.data as T;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL });
}

const API_BASE = 'https://api.v2.meme.com';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Types
export interface Coin {
  rank: number;
  id: number;
  key: string | null;
  name: string | null;
  symbol: string | null;
  coin_image_url: string | null;
  trend_7d: number | null;
  trend_24h: number | null;
  price_now: number | null;
  price_7d_ago: number | null;
  memescore_coin_multiplier: number;
  diamond_hand_users_count: number;
  diamond_rating: number | null;
  market_capitalization: number | null;
  volume_7d: number | null;
}

export interface Paginated<T> {
  items: T[];
  paging: {
    page: number;
    limit: number;
    total_count: number;
    max_page: number;
  };
}

export interface PredictionMarket {
  market_id: number;
  title: string;
  description: string;
  image_url: string | null;
  label_yes: string;
  label_no: string;
  ending_date: string;
  status: 'OPEN' | 'RESOLVED' | 'CANCELLED';
  result: 'YES' | 'NO' | null;
  total_yes_shares: number;
  total_no_shares: number;
  liquidity: number;
  users_trading_count: number;
}

// API Functions
export async function getCoinsLeaderboard(
  page = 1,
  pageSize = 10,
  orderBy: 'DIAMOND_HANDERS_COUNT' | 'MARKET_CAPITALIZATION' | 'PRICE_7D' | 'DIAMOND_RATING' = 'MARKET_CAPITALIZATION',
  searchFilter?: string
): Promise<Paginated<Coin>> {
  const response = await api.get('/farm/coins_leaderboard', {
    params: {
      page,
      page_size: pageSize,
      order_by: orderBy,
      order_direction: 'desc',
      search_filter: searchFilter,
    },
  });
  return response.data;
}

export async function searchCoin(name: string): Promise<Coin[]> {
  const response = await getCoinsLeaderboard(1, 20, 'MARKET_CAPITALIZATION', name);
  return response.items;
}

export async function getPredictionMarkets(page = 1, pageSize = 50): Promise<Paginated<PredictionMarket>> {
  try {
    const response = await api.get('/prediction_markets/get_markets', {
      params: { page, page_size: pageSize },
    });
    return response.data;
  } catch {
    return { items: [], paging: { page: 1, limit: pageSize, total_count: 0, max_page: 0 } };
  }
}

export async function findActivePredictionsForCoin(coinName: string, coinSymbol: string | null): Promise<PredictionMarket[]> {
  const markets = await getPredictionMarkets(1, 100);
  const searchTerms = [coinName.toLowerCase()];
  if (coinSymbol) searchTerms.push(coinSymbol.toLowerCase());

  return markets.items.filter((market) => {
    if (market.status !== 'OPEN') return false;
    const titleLower = market.title.toLowerCase();
    const descLower = market.description.toLowerCase();
    return searchTerms.some((term) => titleLower.includes(term) || descLower.includes(term));
  });
}

// Helper to find coin by name/symbol (with caching)
export async function findCoin(query: string): Promise<Coin | null> {
  const cacheKey = `coin:${query.toLowerCase()}`;
  const cached = getCached<Coin>(cacheKey);
  if (cached) return cached;

  const coins = await searchCoin(query);
  if (coins.length === 0) return null;

  // Try exact match first
  const exactMatch = coins.find(
    (c) =>
      c.name?.toLowerCase() === query.toLowerCase() ||
      c.symbol?.toLowerCase() === query.toLowerCase() ||
      c.key?.toLowerCase() === query.toLowerCase()
  );

  const result = exactMatch || coins[0];
  if (result) setCache(cacheKey, result);
  return result;
}
