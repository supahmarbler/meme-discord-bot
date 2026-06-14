/**
 * Analytics Digest — weekly digest and daily health posts for ops channel.
 * Fetches data from meme-api-v2 /admin/analytics/* endpoints.
 */

import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import axios, { AxiosInstance } from 'axios';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// ── Config ──────────────────────────────────────────────────────────────────

const MEME_API_BASE = process.env.MEME_API_BASE || 'https://api.v2.meme.com';
const ADMIN_TOKEN = process.env.MEME_API_ADMIN_TOKEN || '';
const CHANNEL_ID = process.env.ANALYTICS_CHANNEL_ID || '';

// ── API client ──────────────────────────────────────────────────────────────

let _api: AxiosInstance | null = null;

function api(): AxiosInstance {
  if (!_api) {
    _api = axios.create({
      baseURL: MEME_API_BASE,
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }
  return _api;
}

// ── Types ───────────────────────────────────────────────────────────────────

interface MetricWithDelta {
  value: number;
  prev_value: number | null;
  delta: number | null;
  delta_pct: number | null;
}

interface GSCMetrics {
  clicks: MetricWithDelta;
  impressions: MetricWithDelta;
  ctr_pct: MetricWithDelta;
  avg_position: MetricWithDelta;
}

interface GAMetrics {
  sessions: MetricWithDelta;
  clean_sessions: MetricWithDelta;
  engaged_sessions: MetricWithDelta;
  engagement_rate_pct: MetricWithDelta;
  bot_inflation_pct: MetricWithDelta;
}

interface OperationalMetrics {
  articles_published: MetricWithDelta;
  scout_signals: MetricWithDelta;
}

interface AnalyticsDigest {
  period_start: string;
  period_end: string;
  generated_at: string;
  gsc: GSCMetrics;
  ga: GAMetrics;
  ops: OperationalMetrics;
}

interface PipelineHealth {
  check_date: string;
  generated_at: string;
  article_published_today: boolean;
  article_slug: string | null;
  scout_ran_today: boolean;
  scout_signal_count: number;
  status: 'healthy' | 'warning' | 'unhealthy';
  message: string;
}

// ── State persistence ───────────────────────────────────────────────────────

interface AnalyticsState {
  lastDigestDate: string | null;
  lastHealthDate: string | null;
}

const DATA_DIR = join(process.cwd(), 'data');
const STATE_FILE = join(DATA_DIR, 'analytics-state.json');

function loadState(): AnalyticsState {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(STATE_FILE)) {
    return { lastDigestDate: null, lastHealthDate: null };
  }
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { lastDigestDate: null, lastHealthDate: null };
  }
}

function saveState(state: AnalyticsState): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Response caching ─────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

let digestCache: CacheEntry<AnalyticsDigest> | null = null;
let healthCache: CacheEntry<PipelineHealth> | null = null;

function isCacheValid<T>(cache: CacheEntry<T> | null): cache is CacheEntry<T> {
  return cache !== null && Date.now() - cache.timestamp < CACHE_TTL_MS;
}

// ── API calls ───────────────────────────────────────────────────────────────

export async function fetchDigest(useCache = true): Promise<AnalyticsDigest | null> {
  if (useCache && isCacheValid(digestCache)) {
    return digestCache.data;
  }

  if (!ADMIN_TOKEN) {
    console.error('[Analytics] MEME_API_ADMIN_TOKEN not configured');
    return null;
  }
  try {
    const res = await api().get('/admin/analytics/digest');
    digestCache = { data: res.data, timestamp: Date.now() };
    return res.data;
  } catch (err: any) {
    console.error('[Analytics] Failed to fetch digest:', err.message);
    return null;
  }
}

export async function fetchHealth(useCache = true): Promise<PipelineHealth | null> {
  if (useCache && isCacheValid(healthCache)) {
    return healthCache.data;
  }

  if (!ADMIN_TOKEN) {
    console.error('[Analytics] MEME_API_ADMIN_TOKEN not configured');
    return null;
  }
  try {
    const res = await api().get('/admin/analytics/health');
    healthCache = { data: res.data, timestamp: Date.now() };
    return res.data;
  } catch (err: any) {
    console.error('[Analytics] Failed to fetch health:', err.message);
    return null;
  }
}

// ── Formatting helpers ──────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

function formatDelta(m: MetricWithDelta, lowerIsBetter = false): string {
  if (m.delta == null || m.delta_pct == null) return '';

  const sign = m.delta >= 0 ? '+' : '';
  const arrow = lowerIsBetter
    ? (m.delta <= 0 ? '↓' : '↑')
    : (m.delta >= 0 ? '↑' : '↓');

  // For percentages, show pp (percentage points)
  if (Math.abs(m.value) <= 100 && Math.abs(m.delta) < 50) {
    return ` ${arrow} ${sign}${m.delta.toFixed(1)}pp`;
  }

  return ` ${arrow} ${sign}${m.delta_pct.toFixed(0)}%`;
}

function formatMetric(m: MetricWithDelta, lowerIsBetter = false): string {
  const value = formatNumber(m.value);
  const delta = formatDelta(m, lowerIsBetter);
  return `${value}${delta}`;
}

function formatPct(m: MetricWithDelta, lowerIsBetter = false): string {
  const value = `${m.value.toFixed(1)}%`;
  const delta = formatDelta(m, lowerIsBetter);
  return `${value}${delta}`;
}

function formatPosition(m: MetricWithDelta): string {
  // Position: lower is better, delta shows improvement
  const value = m.value.toFixed(1);
  if (m.delta == null) return value;

  const improvement = -m.delta; // Negative delta = improvement
  if (Math.abs(improvement) < 0.1) return value;

  const arrow = improvement > 0 ? '↑' : '↓';
  const sign = improvement > 0 ? '+' : '';
  return `${value} ${arrow} ${sign}${improvement.toFixed(1)}`;
}

// ── Embed builders ──────────────────────────────────────────────────────────

export function buildDigestEmbed(digest: AnalyticsDigest): EmbedBuilder {
  const startDate = new Date(digest.period_start).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
  const endDate = new Date(digest.period_end).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return new EmbedBuilder()
    .setTitle('📊 Weekly Analytics Digest')
    .setColor(0x5865F2)
    .addFields(
      {
        name: '🔍 Search (GSC)',
        value: [
          `**Clicks:** ${formatMetric(digest.gsc.clicks)}`,
          `**Impressions:** ${formatMetric(digest.gsc.impressions)}`,
          `**CTR:** ${formatPct(digest.gsc.ctr_pct)}`,
          `**Position:** ${formatPosition(digest.gsc.avg_position)}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '📈 Engagement (GA4)',
        value: [
          `**Sessions:** ${formatMetric(digest.ga.sessions)}`,
          `**Clean:** ${formatMetric(digest.ga.clean_sessions)}`,
          `**Engaged:** ${formatMetric(digest.ga.engaged_sessions)}`,
          `**Engagement:** ${formatPct(digest.ga.engagement_rate_pct)}`,
          `**Bot Inflation:** ${formatPct(digest.ga.bot_inflation_pct, true)}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '⚙️ Pipeline',
        value: [
          `**Articles:** ${formatMetric(digest.ops.articles_published)} published`,
          `**Signals:** ${formatMetric(digest.ops.scout_signals)} detected`,
        ].join('\n'),
        inline: true,
      },
    )
    .setFooter({ text: `Period: ${startDate} – ${endDate}` })
    .setTimestamp(new Date(digest.generated_at));
}

export function buildHealthMessage(health: PipelineHealth): string {
  const emoji = health.status === 'healthy' ? '✅'
    : health.status === 'warning' ? '⚠️'
    : '❌';

  return `${emoji} ${health.message}`;
}

// ── Scheduling helpers ──────────────────────────────────────────────────────

function getTodayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function msUntilNextTime(targetHour: number, targetMinute = 0): number {
  const now = new Date();
  const target = new Date(now);
  target.setUTCHours(targetHour, targetMinute, 0, 0);

  if (target <= now) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  return target.getTime() - now.getTime();
}

function msUntilNextMonday0900(): number {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 1 = Monday

  // Days until next Monday
  let daysUntil = (8 - dayOfWeek) % 7;
  if (daysUntil === 0) {
    // It's Monday - check if we're past 09:00 UTC
    const currentHour = now.getUTCHours();
    const currentMin = now.getUTCMinutes();
    if (currentHour > 9 || (currentHour === 9 && currentMin > 0)) {
      daysUntil = 7; // Next Monday
    }
  }

  const target = new Date(now);
  target.setUTCDate(target.getUTCDate() + daysUntil);
  target.setUTCHours(9, 0, 0, 0);

  return target.getTime() - now.getTime();
}

// ── Post functions ──────────────────────────────────────────────────────────

async function postWeeklyDigest(client: Client): Promise<void> {
  const state = loadState();
  const today = getTodayUTC();

  // Check if already posted today
  if (state.lastDigestDate === today) {
    console.log('[Analytics] Weekly digest already posted today, skipping');
    scheduleWeeklyDigest(client);
    return;
  }

  console.log('[Analytics] Posting weekly digest...');

  const digest = await fetchDigest(false); // Bypass cache for scheduled posts
  if (!digest) {
    console.error('[Analytics] Could not fetch digest, will retry next week');
    scheduleWeeklyDigest(client);
    return;
  }

  const channel = await getChannel(client);
  if (!channel) {
    console.error('[Analytics] Analytics channel not found');
    scheduleWeeklyDigest(client);
    return;
  }

  try {
    const embed = buildDigestEmbed(digest);
    await channel.send({ embeds: [embed] });

    state.lastDigestDate = today;
    saveState(state);
    console.log('[Analytics] Weekly digest posted successfully');
  } catch (err: any) {
    console.error('[Analytics] Failed to post digest:', err.message);
  }

  scheduleWeeklyDigest(client);
}

async function postDailyHealth(client: Client): Promise<void> {
  const state = loadState();
  const today = getTodayUTC();

  // Check if already posted today
  if (state.lastHealthDate === today) {
    console.log('[Analytics] Daily health already posted today, skipping');
    scheduleDailyHealth(client);
    return;
  }

  console.log('[Analytics] Posting daily health...');

  const health = await fetchHealth(false); // Bypass cache for scheduled posts
  if (!health) {
    console.error('[Analytics] Could not fetch health, will retry tomorrow');
    scheduleDailyHealth(client);
    return;
  }

  const channel = await getChannel(client);
  if (!channel) {
    console.error('[Analytics] Analytics channel not found');
    scheduleDailyHealth(client);
    return;
  }

  try {
    const message = buildHealthMessage(health);
    await channel.send(message);

    state.lastHealthDate = today;
    saveState(state);
    console.log('[Analytics] Daily health posted successfully');
  } catch (err: any) {
    console.error('[Analytics] Failed to post health:', err.message);
  }

  scheduleDailyHealth(client);
}

async function getChannel(client: Client): Promise<TextChannel | null> {
  if (CHANNEL_ID) {
    try {
      const channel = await client.channels.fetch(CHANNEL_ID);
      if (channel?.isTextBased()) return channel as TextChannel;
    } catch {
      // Fall through to guild search
    }
  }

  // Fallback: find #memebot or #analytics in any guild
  for (const guild of client.guilds.cache.values()) {
    const channel = guild.channels.cache.find(
      (ch) => ch.isTextBased() && (ch.name === 'memebot' || ch.name === 'analytics')
    );
    if (channel) return channel as TextChannel;
  }

  return null;
}

// ── Schedulers ──────────────────────────────────────────────────────────────

function scheduleWeeklyDigest(client: Client): void {
  const ms = msUntilNextMonday0900();
  const hours = Math.round(ms / (1000 * 60 * 60));
  console.log(`[Analytics] Next weekly digest in ${hours}h`);
  setTimeout(() => postWeeklyDigest(client), ms);
}

function scheduleDailyHealth(client: Client): void {
  const ms = msUntilNextTime(8, 0); // 08:00 UTC
  const hours = Math.round(ms / (1000 * 60 * 60));
  console.log(`[Analytics] Next daily health in ${hours}h`);
  setTimeout(() => postDailyHealth(client), ms);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Start the analytics posting loops.
 * Call this from client.on('ready').
 */
export function startAnalyticsLoop(client: Client): void {
  if (!ADMIN_TOKEN) {
    console.log('[Analytics] MEME_API_ADMIN_TOKEN not set, skipping analytics loop');
    return;
  }
  if (!CHANNEL_ID) {
    console.log('[Analytics] ANALYTICS_CHANNEL_ID not set, skipping analytics loop');
    return;
  }

  console.log('[Analytics] Starting analytics loops...');

  // Check if we need to catch up on today's posts
  const state = loadState();
  const today = getTodayUTC();
  const now = new Date();
  const isMonday = now.getUTCDay() === 1;
  const isPast0900 = now.getUTCHours() >= 9;
  const isPast0800 = now.getUTCHours() >= 8;

  // Catch-up: Weekly digest (Monday after 09:00 UTC)
  if (isMonday && isPast0900 && state.lastDigestDate !== today) {
    console.log('[Analytics] Catching up on weekly digest...');
    postWeeklyDigest(client);
  } else {
    scheduleWeeklyDigest(client);
  }

  // Catch-up: Daily health (after 08:00 UTC)
  if (isPast0800 && state.lastHealthDate !== today) {
    console.log('[Analytics] Catching up on daily health...');
    postDailyHealth(client);
  } else {
    scheduleDailyHealth(client);
  }
}

/**
 * Fetch and return digest for slash command (on-demand).
 */
export async function getDigestForCommand(): Promise<EmbedBuilder | string> {
  const digest = await fetchDigest();
  if (!digest) {
    return '❌ Could not fetch analytics digest. Check API configuration.';
  }
  return buildDigestEmbed(digest);
}

/**
 * Fetch and return health for slash command (on-demand).
 */
export async function getHealthForCommand(): Promise<string> {
  const health = await fetchHealth();
  if (!health) {
    return '❌ Could not fetch pipeline health. Check API configuration.';
  }
  return buildHealthMessage(health);
}
