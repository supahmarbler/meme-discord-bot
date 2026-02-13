import axios from 'axios';

const WAGER_API = process.env.WAGER_API_URL || 'https://api.v2.meme.com/discord/race-wager';
const WAGER_TOKEN = process.env.WAGER_API_TOKEN || '';

const api = axios.create({
  baseURL: WAGER_API,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${WAGER_TOKEN}`,
  },
  timeout: 10000,
});

export interface WagerResult {
  success: boolean;
  wagerId?: string;
  balance?: number;
  error?: { code: string; message: string };
}

export interface PayoutResult {
  success: boolean;
  totalPool?: number;
  payouts?: { discordId: string; username: string; amountWon: number }[];
  error?: { code: string; message: string };
}

export async function placeWager(
  discordId: string,
  gameId: string,
  coinId: number,
  coinSymbol: string,
  amount: number
): Promise<WagerResult> {
  if (!WAGER_TOKEN) return { success: false, error: { code: 'NOT_CONFIGURED', message: 'Wagering not enabled' } };

  try {
    const res = await api.post('', {
      action: 'place',
      discordId,
      gameId,
      coinId,
      coinSymbol,
      amount,
    });
    return res.data;
  } catch (err: any) {
    return err.response?.data || { success: false, error: { code: 'API_ERROR', message: err.message } };
  }
}

export async function payout(
  gameId: string,
  results: { discordId: string; rank: number; coinSymbol: string; percentChange: number }[]
): Promise<PayoutResult> {
  if (!WAGER_TOKEN) return { success: false, error: { code: 'NOT_CONFIGURED', message: 'Wagering not enabled' } };

  try {
    const res = await api.post('', {
      action: 'payout',
      gameId,
      results,
      prizeDistribution: 'winner_takes_all',
    });
    return res.data;
  } catch (err: any) {
    return err.response?.data || { success: false, error: { code: 'API_ERROR', message: err.message } };
  }
}

export async function refund(gameId: string): Promise<WagerResult> {
  if (!WAGER_TOKEN) return { success: false, error: { code: 'NOT_CONFIGURED', message: 'Wagering not enabled' } };

  try {
    const res = await api.post('', { action: 'refund', gameId });
    return res.data;
  } catch (err: any) {
    return err.response?.data || { success: false, error: { code: 'API_ERROR', message: err.message } };
  }
}

export async function getBalance(discordId: string): Promise<{ success: boolean; balance?: number; error?: any }> {
  if (!WAGER_TOKEN) return { success: false, error: { code: 'NOT_CONFIGURED', message: 'Wagering not enabled' } };

  try {
    const res = await api.post('', { action: 'balance', discordId });
    return res.data;
  } catch (err: any) {
    return err.response?.data || { success: false, error: { code: 'API_ERROR', message: err.message } };
  }
}

export function isEnabled(): boolean {
  return !!WAGER_TOKEN;
}
