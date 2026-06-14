import 'dotenv/config'; // Must be first — loads .env before any module reads process.env

import { Client, GatewayIntentBits, EmbedBuilder, ChatInputCommandInteraction, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import * as xapi from './xapi';
import * as xmarkets from './xmarkets';
import * as memegame from './memegame';
import * as wager from './wager';
import OpenAI from 'openai';
import * as api from './api';
import { startLabsReportLoop } from './labs-report';
import * as trends from './trends';
import * as analytics from './analytics';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Generate battle image - returns Buffer for Discord attachment
async function generateBattleImage(winner: string, loser: string, isClose: boolean): Promise<Buffer | null> {
  try {
    const prompt = `${winner} character delivering knockout punch to ${loser} character flying backwards defeated, dynamic action pose, vibrant colors, dramatic lighting, expressive faces, stylized 3D animation, cinematic quality, no text`;

    console.log('Generating battle image...');

    const response = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'high',
    });

    const imageData = response.data?.[0];
    if (imageData?.b64_json) {
      console.log('Got base64 image, converting to buffer');
      return Buffer.from(imageData.b64_json, 'base64');
    } else if (imageData?.url) {
      console.log('Got URL, fetching image');
      const imgResponse = await fetch(imageData.url);
      const arrayBuffer = await imgResponse.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    return null;
  } catch (error) {
    console.error('Error generating battle image:', error);
    return null;
  }
}

// Generate tie image - returns Buffer for Discord attachment
async function generateTieImage(meme1: string, meme2: string): Promise<Buffer | null> {
  try {
    const prompt = `${meme1} character and ${meme2} character standing together as allies after battle, friendship pose, vibrant colors, dramatic lighting, expressive faces, stylized 3D animation, cinematic quality, no text`;

    console.log('Generating tie image...');

    const response = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'high',
    });

    const imageData = response.data?.[0];
    if (imageData?.b64_json) {
      console.log('Got base64 image, converting to buffer');
      return Buffer.from(imageData.b64_json, 'base64');
    } else if (imageData?.url) {
      console.log('Got URL, fetching image');
      const imgResponse = await fetch(imageData.url);
      const arrayBuffer = await imgResponse.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    return null;
  } catch (error) {
    console.error('Error generating tie image:', error);
    return null;
  }
}

// Generate race victory image - returns Buffer for Discord attachment
async function generateRaceVictoryImage(winner: string, runnerUp: string | null): Promise<Buffer | null> {
  try {
    const prompt = runnerUp
      ? `${winner} character in a racing kart crossing finish line first, ${runnerUp} character in kart close behind in second place, Mario Kart inspired art style, rainbow road track, checkered flag waving, item boxes, vibrant colors, dynamic racing action, expressive cartoon faces, Nintendo-style 3D graphics, cinematic quality, no text`
      : `${winner} character in a racing kart celebrating victory on winner podium, trophy raised high, confetti and stars falling, Mario Kart inspired art style, vibrant colors, expressive cartoon face, Nintendo-style 3D graphics, cinematic quality, no text`;

    console.log('Generating race victory image...');

    const response = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'high',
    });

    const imageData = response.data?.[0];
    if (imageData?.b64_json) {
      console.log('Got base64 image, converting to buffer');
      return Buffer.from(imageData.b64_json, 'base64');
    } else if (imageData?.url) {
      console.log('Got URL, fetching image');
      const imgResponse = await fetch(imageData.url);
      const arrayBuffer = await imgResponse.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    return null;
  } catch (error) {
    console.error('Error generating race victory image:', error);
    return null;
  }
}

const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error('Missing DISCORD_BOT_TOKEN in .env');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Formatting helpers
function formatPrice(price: number | null): string {
  if (price === null || price === undefined) return 'N/A';
  if (price >= 1) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  const priceStr = price.toFixed(12);
  const trimmed = priceStr.replace(/\.?0+$/, '');
  return `$${trimmed}`;
}

function formatTrend(value: number | null): string {
  if (value === null || value === undefined) return 'N/A';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatMarketCap(value: number | null): string {
  if (value === null || value === undefined) return 'N/A';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

function getTrendEmoji(value: number | null): string {
  if (value === null || value === undefined) return '';
  return value >= 0 ? ' :chart_with_upwards_trend:' : ' :chart_with_downwards_trend:';
}

// Command handler
async function handleMeme(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const query = interaction.options.getString('coin', true);

  try {
    // CoinGecko = primary (price, image, market data), meme.com = secondary (diamond rating, predictions)
    const [cgCoin, memeCoin] = await Promise.all([
      api.getCoinGeckoDetail(query),
      api.findCoin(query).catch(() => null),
    ]);

    if (!cgCoin && !memeCoin) {
      await interaction.editReply(`:mag: No coin found matching "${query}"`);
      return;
    }

    // Merge: CoinGecko for market data, meme.com for community features
    const name = cgCoin?.name || memeCoin?.name || 'Unknown';
    const symbol = cgCoin?.symbol || memeCoin?.symbol || '?';
    const price = cgCoin?.price ?? memeCoin?.price_now ?? null;
    const trend24h = cgCoin?.trend_24h ?? memeCoin?.trend_24h ?? null;
    const trend7d = cgCoin?.trend_7d ?? memeCoin?.trend_7d ?? null;
    const marketCap = cgCoin?.market_cap ?? memeCoin?.market_capitalization ?? null;
    const image = cgCoin?.image || memeCoin?.coin_image_url;
    const trendColor = (trend24h ?? 0) >= 0 ? 0x00ff00 : 0xff0000;

    const embed = new EmbedBuilder()
      .setTitle(`${name} (${symbol})`)
      .setColor(trendColor)
      .setTimestamp();

    if (image) embed.setThumbnail(image);

    embed.addFields(
      { name: ':moneybag: Price', value: formatPrice(price), inline: true },
      { name: ':clock1: 24h Change', value: formatTrend(trend24h) + getTrendEmoji(trend24h), inline: true },
      { name: ':calendar: 7d Change', value: formatTrend(trend7d) + getTrendEmoji(trend7d), inline: true },
      { name: ':bank: Market Cap', value: formatMarketCap(marketCap), inline: true },
      { name: ':star: Diamond Rating', value: memeCoin?.diamond_rating ? `${memeCoin.diamond_rating.toFixed(1)} :gem:` : 'N/A', inline: true }
    );

    // Check for active predictions (meme.com only)
    const predictions = await api.findActivePredictionsForCoin(name, symbol.toLowerCase());
    if (predictions.length > 0) {
      const predictionLines = predictions.slice(0, 3).map((p) => {
        const odds = calcLMSRProbability(p.total_yes_shares, p.total_no_shares, p.liquidity);
        return `**${p.title}**\n${p.label_yes}: ${odds.yes.toFixed(0)}% | ${p.label_no}: ${odds.no.toFixed(0)}% | ${p.users_trading_count} traders`;
      });
      embed.addFields({
        name: `:crystal_ball: Active Predictions (${predictions.length})`,
        value: predictionLines.join('\n\n'),
        inline: false,
      });
    }

    if (memeCoin?.key) {
      embed.setURL(`https://meme.com/coins/${memeCoin.key}`);
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error in /meme:', error);
    await interaction.editReply(':x: Failed to fetch data. Please try again.');
  }
}

// LMSR probability calculation
function calcLMSRProbability(yesShares: number, noShares: number, liquidity: number): { yes: number; no: number } {
  if (liquidity <= 0) return { yes: 50, no: 50 };
  const expYes = Math.exp(yesShares / liquidity);
  const expNo = Math.exp(noShares / liquidity);
  const pYes = (expYes / (expYes + expNo)) * 100;
  return { yes: pYes, no: 100 - pYes };
}

// Hot predictions handler
async function handleHotPredictions(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  try {
    const markets = await api.getPredictionMarkets(1, 50);

    // Filter open markets and sort by trading activity
    const hotMarkets = markets.items
      .filter((m) => m.status === 'OPEN')
      .sort((a, b) => b.users_trading_count - a.users_trading_count)
      .slice(0, 5);

    if (hotMarkets.length === 0) {
      await interaction.editReply(':crystal_ball: No active prediction markets found.');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(':fire: Hot Prediction Markets')
      .setColor(0xff6b35)
      .setTimestamp();

    const lines = hotMarkets.map((m, i) => {
      const odds = calcLMSRProbability(m.total_yes_shares, m.total_no_shares, m.liquidity);
      const endDate = new Date(m.ending_date);
      const timeLeft = Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      const timeStr = timeLeft > 0 ? `${timeLeft}d left` : 'Ending soon';

      return `**${i + 1}. ${m.title}**\n${m.label_yes}: ${odds.yes.toFixed(0)}% | ${m.label_no}: ${odds.no.toFixed(0)}%\n:busts_in_silhouette: ${m.users_trading_count} traders | :clock1: ${timeStr}`;
    });

    embed.setDescription(lines.join('\n\n'));
    embed.setFooter({ text: 'Sorted by trading activity' });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error in /hotpredictions:', error);
    await interaction.editReply(':x: Failed to fetch predictions. Please try again.');
  }
}

// Champion handler - find top 3 memecoins
async function handleChampion(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  try {
    // Fetch all coins by market cap
    const allCoins = await api.getCoinsLeaderboard(1, 300, 'MARKET_CAPITALIZATION');

    const eligibleCoins = allCoins.items;

    if (eligibleCoins.length === 0) {
      await interaction.editReply(':trophy: No coins found.');
      return;
    }

    // Score each coin based on rank in each category
    // Higher rank = more points (1st place gets N points, last gets 1)
    const n = eligibleCoins.length;

    const scored = eligibleCoins.map(coin => ({
      coin,
      momentum24h: coin.trend_24h ?? -Infinity,
      trend7d: coin.trend_7d ?? -Infinity,
      marketCap: coin.market_capitalization ?? 0,
      diamondRating: coin.diamond_rating ?? 0,
    }));

    // Sort and assign rank-based points for each category
    const byMomentum = [...scored].sort((a, b) => b.momentum24h - a.momentum24h);
    const byTrend = [...scored].sort((a, b) => b.trend7d - a.trend7d);
    const byMcap = [...scored].sort((a, b) => b.marketCap - a.marketCap);
    const byDiamond = [...scored].sort((a, b) => b.diamondRating - a.diamondRating);

    const points = new Map<number, number>();

    const assignRankPoints = (sorted: typeof scored, weight = 1) => {
      sorted.forEach((item, idx) => {
        const pts = (n - idx) * weight; // 1st gets n*weight points, 2nd gets (n-1)*weight, etc.
        const current = points.get(item.coin.id) ?? 0;
        points.set(item.coin.id, current + pts);
      });
    };

    assignRankPoints(byMomentum, 1);    // 24h: 1x weight
    assignRankPoints(byTrend, 2);       // 7d: 2x weight
    assignRankPoints(byMcap, 0.5);      // MCap: 0.5x weight
    assignRankPoints(byDiamond, 1);     // Diamond Rating: 1x weight

    // Sort by total points
    const ranked = scored
      .map(s => ({ ...s, totalPoints: points.get(s.coin.id) ?? 0 }))
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, 5);

    const medals = [':first_place:', ':second_place:', ':third_place:', ':four:', ':five:'];

    const lines = ranked.map((r, i) => {
      const coin = r.coin;
      const momentum = r.momentum24h !== -Infinity ? `${r.momentum24h >= 0 ? '+' : ''}${r.momentum24h.toFixed(1)}%` : 'N/A';
      const trend = r.trend7d !== -Infinity ? `${r.trend7d >= 0 ? '+' : ''}${r.trend7d.toFixed(1)}%` : 'N/A';
      const mcap = formatMarketCap(r.marketCap);
      const diamond = r.diamondRating > 0 ? `${r.diamondRating.toFixed(1)}` : 'N/A';

      return `${medals[i]} **${coin.name}** (${coin.symbol})\n24h: ${momentum} | 7d: ${trend} | MCap: ${mcap} | :gem: ${diamond}\nBattle Score: ${r.totalPoints} pts`;
    });

    const embed = new EmbedBuilder()
      .setTitle(':trophy: Memecoin Champions')
      .setDescription(lines.join('\n\n'))
      .setColor(0xFFD700)
      .setFooter({ text: `Based on ${eligibleCoins.length} coins` })
      .setTimestamp();

    if (ranked[0]?.coin.coin_image_url) {
      embed.setThumbnail(ranked[0].coin.coin_image_url);
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error in /champion:', error);
    await interaction.editReply(':x: Failed to find champions. Please try again.');
  }
}

// Xstart handler - link X battle to meme.com prediction market
async function handleXstart(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const marketQuery = interaction.options.getString('market', true);
  const account1 = interaction.options.getString('account1', true);
  const account2 = interaction.options.getString('account2', true);

  try {
    // Find the prediction market on meme.com
    const predictionMarket = await api.findPredictionMarket(marketQuery);

    if (!predictionMarket) {
      await interaction.editReply(`:mag: No open prediction market found matching "${marketQuery}"`);
      return;
    }

    const clean1 = account1.replace('@', '');
    const clean2 = account2.replace('@', '');

    // Create the market linked to the prediction market
    const market = xmarkets.createMarket(
      clean1,
      clean2,
      interaction.guildId || '',
      interaction.channelId,
      interaction.user.id,
      {
        id: predictionMarket.market_id,
        title: predictionMarket.title,
        endsAt: predictionMarket.ending_date,
      }
    );

    const startDate = new Date(market.startedAt);
    const endDate = new Date(market.endsAt);

    // Calculate current odds
    const odds = calcLMSRProbability(
      predictionMarket.total_yes_shares,
      predictionMarket.total_no_shares,
      predictionMarket.liquidity
    );

    const embed = new EmbedBuilder()
      .setTitle(':crystal_ball: X Battle Linked to Prediction Market!')
      .setDescription(
        `**${predictionMarket.title}**\n\n` +
        `Tracking: **@${clean1}** vs **@${clean2}**\n\n` +
        `Use \`/xstatus\` to check current standings and prediction odds!`
      )
      .addFields(
        { name: predictionMarket.label_yes, value: `${odds.yes.toFixed(0)}%`, inline: true },
        { name: predictionMarket.label_no, value: `${odds.no.toFixed(0)}%`, inline: true },
        { name: ':busts_in_silhouette: Traders', value: `${predictionMarket.users_trading_count}`, inline: true },
        { name: ':checkered_flag: Ends', value: `<t:${Math.floor(endDate.getTime() / 1000)}:R>`, inline: true }
      )
      .setColor(0x1DA1F2)
      .setFooter({ text: `Started by ${interaction.user.username}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error in /xstart:', error);
    await interaction.editReply(':x: Failed to start X battle market. Please try again.');
  }
}

// Xstatus handler - show status of active X battle markets with prediction odds
async function handleXstatus(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  try {
    const markets = xmarkets.getActiveMarkets(interaction.guildId || undefined);

    if (markets.length === 0) {
      await interaction.editReply(':crystal_ball: No active X battle markets. Use `/xstart` to create one!');
      return;
    }

    const embeds: EmbedBuilder[] = [];

    for (const market of markets.slice(0, 5)) {
      const startDate = new Date(market.startedAt);
      const endDate = new Date(market.endsAt);
      const isEnded = xmarkets.isMarketEnded(market);
      const timeRemaining = xmarkets.getTimeRemaining(market);

      let statusText = '';
      let predictionText = '';
      let color = 0x1DA1F2;

      // Fetch live prediction market data if linked
      if (market.marketId) {
        try {
          const allMarkets = await api.getPredictionMarkets(1, 100);
          const predictionMarket = allMarkets.items.find(m => m.market_id === market.marketId);

          if (predictionMarket) {
            const odds = calcLMSRProbability(
              predictionMarket.total_yes_shares,
              predictionMarket.total_no_shares,
              predictionMarket.liquidity
            );
            predictionText = `\n\n:crystal_ball: **Prediction Odds**\n` +
              `${predictionMarket.label_yes}: ${odds.yes.toFixed(0)}% | ${predictionMarket.label_no}: ${odds.no.toFixed(0)}%\n` +
              `:busts_in_silhouette: ${predictionMarket.users_trading_count} traders`;
          }
        } catch (err) {
          console.error('Error fetching prediction market:', err);
        }
      }

      if (isEnded && !market.resolved) {
        // Fetch final results
        try {
          const [tweet1, tweet2] = await Promise.all([
            xapi.getTopTweet(market.account1, 7, startDate, endDate),
            xapi.getTopTweet(market.account2, 7, startDate, endDate),
          ]);

          const likes1 = tweet1?.likes || 0;
          const likes2 = tweet2?.likes || 0;

          let winner: string | null = null;
          if (likes1 > likes2) winner = market.account1;
          else if (likes2 > likes1) winner = market.account2;

          xmarkets.resolveMarket(market.id, winner, likes1, likes2);

          if (winner) {
            statusText = `:crown: **Winner: @${winner}**\n`;
            color = 0x00FF00;
          } else {
            statusText = `:scales: **It's a tie!**\n`;
            color = 0xFFFF00;
          }

          statusText += `@${market.account1}: ${likes1.toLocaleString()} :heart:\n`;
          statusText += `@${market.account2}: ${likes2.toLocaleString()} :heart:`;
        } catch (err) {
          console.error('Error resolving market:', err);
          statusText = ':warning: Could not fetch final results';
          color = 0xFF0000;
        }
      } else if (market.resolved) {
        // Already resolved
        if (market.winner === 'tie') {
          statusText = `:scales: **It was a tie!**\n`;
          color = 0xFFFF00;
        } else {
          statusText = `:crown: **Winner: @${market.winner}**\n`;
          color = 0x00FF00;
        }
        statusText += `@${market.account1}: ${(market.account1TopLikes || 0).toLocaleString()} :heart:\n`;
        statusText += `@${market.account2}: ${(market.account2TopLikes || 0).toLocaleString()} :heart:`;
      } else {
        // Still active - fetch current standings
        try {
          const [tweet1, tweet2] = await Promise.all([
            xapi.getTopTweet(market.account1, 7, startDate),
            xapi.getTopTweet(market.account2, 7, startDate),
          ]);

          const likes1 = tweet1?.likes || 0;
          const likes2 = tweet2?.likes || 0;

          if (likes1 > likes2) {
            statusText = `:chart_with_upwards_trend: **@${market.account1} is leading!**\n`;
          } else if (likes2 > likes1) {
            statusText = `:chart_with_upwards_trend: **@${market.account2} is leading!**\n`;
          } else {
            statusText = `:scales: **Currently tied!**\n`;
          }

          statusText += `@${market.account1}: ${likes1.toLocaleString()} :heart:\n`;
          statusText += `@${market.account2}: ${likes2.toLocaleString()} :heart:`;
        } catch (err) {
          console.error('Error fetching current standings:', err);
          statusText = ':hourglass: Waiting for tweets...';
        }
      }

      const title = market.marketTitle
        ? `:bird: ${market.marketTitle}`
        : `:bird: @${market.account1} vs @${market.account2}`;

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(statusText + predictionText)
        .addFields(
          { name: ':clock1: Time', value: market.resolved ? 'Ended' : timeRemaining, inline: true }
        )
        .setColor(color)
        .setTimestamp();

      embeds.push(embed);
    }

    await interaction.editReply({ embeds });
  } catch (error) {
    console.error('Error in /xstatus:', error);
    await interaction.editReply(':x: Failed to fetch market status. Please try again.');
  }
}

// Xbattle handler - compare X accounts by top tweet likes
async function handleXbattle(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const account1 = interaction.options.getString('account1', true);
  const account2 = interaction.options.getString('account2', true);

  try {
    const [tweet1, tweet2] = await Promise.all([
      xapi.getTopTweet(account1, 7),
      xapi.getTopTweet(account2, 7),
    ]);

    if (!tweet1) {
      await interaction.editReply(`:mag: No tweets found for @${account1.replace('@', '')} in the last 7 days`);
      return;
    }
    if (!tweet2) {
      await interaction.editReply(`:mag: No tweets found for @${account2.replace('@', '')} in the last 7 days`);
      return;
    }

    // Determine winner
    const winner = tweet1.likes > tweet2.likes ? tweet1 : tweet2;
    const loser = tweet1.likes > tweet2.likes ? tweet2 : tweet1;
    const isTie = tweet1.likes === tweet2.likes;

    // Format tweet preview (truncate long tweets)
    const truncate = (text: string, len: number) =>
      text.length > len ? text.slice(0, len) + '...' : text;

    let resultText: string;
    let resultEmoji: string;
    if (isTie) {
      resultEmoji = ':scales:';
      resultText = "It's a tie!";
    } else {
      resultEmoji = ':crown:';
      const margin = winner.likes - loser.likes;
      const comment = margin > 1000 ? 'dominated' : margin > 100 ? 'beat' : 'narrowly defeated';
      resultText = `**@${winner.username}** ${comment} **@${loser.username}**!`;
    }

    const embed = new EmbedBuilder()
      .setTitle(`:bird: @${tweet1.username} vs @${tweet2.username} :bird:`)
      .setDescription(
        `**@${tweet1.username}** - Top Tweet (${tweet1.likes.toLocaleString()} :heart:)\n` +
        `> ${truncate(tweet1.text, 100)}\n` +
        `[View Tweet](${tweet1.tweet_url})\n\n` +
        `**@${tweet2.username}** - Top Tweet (${tweet2.likes.toLocaleString()} :heart:)\n` +
        `> ${truncate(tweet2.text, 100)}\n` +
        `[View Tweet](${tweet2.tweet_url})`
      )
      .addFields({
        name: `${resultEmoji} RESULT`,
        value: resultText,
        inline: false,
      })
      .setColor(isTie ? 0xFFFF00 : 0x1DA1F2)
      .setFooter({ text: 'Based on most-liked tweet in last 7 days' })
      .setTimestamp();

    // Show winning tweet's image if available
    if (!isTie && winner.image_url) {
      embed.setImage(winner.image_url);
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error in /xbattle:', error);
    await interaction.editReply(':x: Failed to fetch X data. Please try again.');
  }
}

// Battle handler
async function handleBattle(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const query1 = interaction.options.getString('coin1', true);
  const query2 = interaction.options.getString('coin2', true);

  try {
    const [coin1, coin2] = await Promise.all([
      api.findCoin(query1),
      api.findCoin(query2),
    ]);

    if (!coin1) {
      await interaction.editReply(`:mag: Couldn't find coin "${query1}"`);
      return;
    }
    if (!coin2) {
      await interaction.editReply(`:mag: Couldn't find coin "${query2}"`);
      return;
    }
    if (coin1.id === coin2.id) {
      await interaction.editReply(`:thinking: A coin can't battle itself!`);
      return;
    }

    // Battle categories
    const battles = [
      {
        name: ':fire: Momentum (24h)',
        stat1: coin1.trend_24h ?? 0,
        stat2: coin2.trend_24h ?? 0,
        format: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`,
        higherWins: true,
        points: 1,
      },
      {
        name: ':chart_with_upwards_trend: Weekly (7d) ×2',
        stat1: coin1.trend_7d ?? 0,
        stat2: coin2.trend_7d ?? 0,
        format: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`,
        higherWins: true,
        points: 2,
      },
      {
        name: ':muscle: Strength (MCap)',
        stat1: coin1.market_capitalization ?? 0,
        stat2: coin2.market_capitalization ?? 0,
        format: (v: number) => formatMarketCap(v),
        higherWins: true,
        points: 1,
      },
      {
        name: ':gem: Diamond Rating',
        stat1: coin1.diamond_rating ?? 0,
        stat2: coin2.diamond_rating ?? 0,
        format: (v: number) => v > 0 ? `${v.toFixed(1)}` : 'N/A',
        higherWins: true,
        points: 1,
      },
    ];

    let score1 = 0;
    let score2 = 0;
    const lines: string[] = [];

    for (const b of battles) {
      let winner: string;
      if (b.stat1 === b.stat2) {
        winner = ':handshake: TIE';
      } else if ((b.higherWins && b.stat1 > b.stat2) || (!b.higherWins && b.stat1 < b.stat2)) {
        winner = `**${coin1.symbol}** :trophy:${b.points > 1 ? ` (+${b.points})` : ''}`;
        score1 += b.points;
      } else {
        winner = `:trophy: **${coin2.symbol}**${b.points > 1 ? ` (+${b.points})` : ''}`;
        score2 += b.points;
      }
      lines.push(`${b.name}\n${coin1.symbol}: ${b.format(b.stat1)} vs ${coin2.symbol}: ${b.format(b.stat2)}\n→ ${winner}`);
    }

    // Determine overall winner
    let resultEmoji: string;
    let resultText: string;
    const winComments = [
      'absolutely demolished',
      'wiped the floor with',
      'sent to the shadow realm',
      'made quick work of',
      'dominated',
      'crushed',
    ];
    const closeComments = [
      'barely edged out',
      'squeaked past',
      'just managed to beat',
      'narrowly defeated',
    ];
    const tieComments = [
      "It's a stalemate!",
      'Too close to call!',
      'An even match!',
      'Neither could claim victory!',
    ];

    const randomComment = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

    if (score1 > score2) {
      resultEmoji = ':crown:';
      const comment = score1 - score2 >= 3 ? randomComment(winComments) : randomComment(closeComments);
      resultText = `**${coin1.name}** ${comment} **${coin2.name}**!`;
    } else if (score2 > score1) {
      resultEmoji = ':crown:';
      const comment = score2 - score1 >= 3 ? randomComment(winComments) : randomComment(closeComments);
      resultText = `**${coin2.name}** ${comment} **${coin1.name}**!`;
    } else {
      resultEmoji = ':scales:';
      resultText = randomComment(tieComments);
    }

    const embed = new EmbedBuilder()
      .setTitle(`:crossed_swords: ${coin1.symbol} vs ${coin2.symbol} :crossed_swords:`)
      .setDescription(lines.join('\n\n'))
      .addFields({
        name: `${resultEmoji} RESULT: ${score1} - ${score2}`,
        value: resultText,
        inline: false,
      })
      .setColor(score1 > score2 ? 0x00ff00 : score2 > score1 ? 0xff6b35 : 0xffff00)
      .setTimestamp();

    // Show winner's image (or coin1 if tie)
    const winnerCoin = score1 > score2 ? coin1 : score2 > score1 ? coin2 : coin1;
    if (winnerCoin.coin_image_url) {
      embed.setThumbnail(winnerCoin.coin_image_url);
    }

    // Send initial result
    await interaction.editReply({ embeds: [embed] });

    // Generate battle image in background and post as follow-up
    const winner = score1 > score2 ? coin1.name : score2 > score1 ? coin2.name : null;
    const loser = score1 > score2 ? coin2.name : score2 > score1 ? coin1.name : null;
    const winnerSymbol = score1 > score2 ? coin1.symbol : coin2.symbol;
    const isTie = score1 === score2;

    // Generate image separately so errors don't affect battle result
    try {
      if (winner && loser) {
        const isClose = Math.abs(score1 - score2) <= 1;
        const imageBuffer = await generateBattleImage(winner, loser, isClose);

        if (imageBuffer) {
          console.log('Sending battle image, buffer size:', imageBuffer.length);
          const attachment = new AttachmentBuilder(imageBuffer, { name: 'battle.png' });
          const imageEmbed = new EmbedBuilder()
            .setTitle(`:art: ${winnerSymbol} victory artwork`)
            .setImage('attachment://battle.png')
            .setColor(0x9932CC)
            .setFooter({ text: 'AI-generated battle artwork' });

          await interaction.followUp({ embeds: [imageEmbed], files: [attachment] });
          console.log('Battle image sent successfully');
        }
      } else if (isTie) {
        const imageBuffer = await generateTieImage(coin1.name || coin1.symbol || 'Coin1', coin2.name || coin2.symbol || 'Coin2');

        if (imageBuffer) {
          console.log('Sending tie image, buffer size:', imageBuffer.length);
          const attachment = new AttachmentBuilder(imageBuffer, { name: 'friendship.png' });
          const imageEmbed = new EmbedBuilder()
            .setTitle(`:handshake: ${coin1.symbol} & ${coin2.symbol} Friendship`)
            .setImage('attachment://friendship.png')
            .setColor(0xFFD700)
            .setFooter({ text: 'AI-generated battle artwork' });

          await interaction.followUp({ embeds: [imageEmbed], files: [attachment] });
          console.log('Tie image sent successfully');
        }
      }
    } catch (imageError) {
      console.error('Error sending battle image:', imageError);
      // Don't fail the whole command if image fails
    }
  } catch (error) {
    console.error('Error in /battle:', error);
    await interaction.editReply(':x: Failed to fetch battle data. Please try again.');
  }
}

// Game handlers
async function handleGameStart(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  // Race feature retired — let current race finish but block new ones
  await interaction.editReply(':x: Meme Race has been retired. Thanks for racing!');
}

const RACE_ENTRY_FEE = 3000;

async function handlePick(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const coinQuery = interaction.options.getString('coin', true);

  try {
    const game = memegame.getActiveGame(interaction.guildId || '');

    if (!game) {
      await interaction.editReply(':x: No active race! Use `/gamestart` to start one.');
      return;
    }

    if (game.phase !== 'picking') {
      await interaction.editReply(':x: Pick window has closed! The race is underway.');
      return;
    }

    // Check if user already picked
    if (game.picks.some(p => p.userId === interaction.user.id)) {
      await interaction.editReply(':x: You already picked a coin for this race!');
      return;
    }

    // Find the coin
    const coin = await api.findCoin(coinQuery);

    if (!coin) {
      await interaction.editReply(`:mag: Couldn't find coin "${coinQuery}"`);
      return;
    }

    // Check if coin is already taken
    if (game.picks.some(p => p.coinId === coin.id)) {
      await interaction.editReply(`:x: **${coin.symbol}** is already taken by another player!`);
      return;
    }

    // Show confirmation with entry fee
    const confirmEmbed = new EmbedBuilder()
      .setTitle(`:ticket: Race Entry — ${coin.symbol}`)
      .setDescription(
        `You're about to enter the race with **${coin.name}** (${coin.symbol})\n\n` +
        `:moneybag: Entry fee: **${RACE_ENTRY_FEE.toLocaleString()} Memescore**\n\n` +
        `Do you want to join?`
      )
      .setColor(0xFFA500);

    if (coin.coin_image_url) {
      confirmEmbed.setThumbnail(coin.coin_image_url);
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('pick_confirm')
        .setLabel(`Pay ${RACE_ENTRY_FEE.toLocaleString()} & Join`)
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId('pick_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    const reply = await interaction.editReply({ embeds: [confirmEmbed], components: [row] });

    // Use collector so we can respond to other users clicking the button
    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 30_000,
    });

    let handled = false;

    collector.on('collect', async (btnInteraction) => {
      // Reject other users clicking the button
      if (btnInteraction.user.id !== interaction.user.id) {
        await btnInteraction.reply({ content: ':x: This isn\'t your pick! Use `/pick` to join the race.', flags: 64 });
        return;
      }

      handled = true;
      collector.stop();

      if (btnInteraction.customId === 'pick_cancel') {
        await btnInteraction.update({
          embeds: [new EmbedBuilder().setDescription(':no_entry_sign: Race entry cancelled.').setColor(0x888888)],
          components: [],
        });
        return;
      }

      // User confirmed — place the wager via API
      await btnInteraction.deferUpdate();

      if (wager.isEnabled()) {
        console.log(`[PICK] Placing wager for ${interaction.user.username} (${interaction.user.id})`);
        const wagerResult = await wager.placeWager(
          interaction.user.id,
          game.id,
          coin.id,
          coin.symbol || '???',
          RACE_ENTRY_FEE
        );

        console.log(`[PICK] Wager result:`, JSON.stringify(wagerResult));

        if (!wagerResult.success) {
          const errorMsg = wagerResult.error?.code === 'USER_NOT_LINKED'
            ? ':link: Your Discord is not linked to meme.com. Complete the Discord quest first!'
            : wagerResult.error?.code === 'INSUFFICIENT_BALANCE'
            ? `:coin: Not enough Memescore! ${wagerResult.error?.message || ''}`
            : `:warning: ${wagerResult.error?.message || 'Failed to place entry fee'}`;
          await interaction.editReply({ embeds: [new EmbedBuilder().setDescription(errorMsg).setColor(0xFF0000)], components: [] });
          return;
        }
      } else {
        console.log(`[PICK] Wagering disabled — no WAGER_API_TOKEN set`);
      }

      // Register the pick
      const result = memegame.addPick(
        game.id,
        interaction.user.id,
        interaction.user.username,
        coin.id,
        coin.name || coin.symbol || 'Unknown',
        coin.symbol || '???',
        coin.key || coin.name || coin.symbol || '',
        coin.price_now || 0,
        RACE_ENTRY_FEE
      );

      if (!result.success) {
        await interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`:x: ${result.error}`).setColor(0xFF0000)], components: [] });
        return;
      }

      const successEmbed = new EmbedBuilder()
        .setTitle(`:white_check_mark: ${interaction.user.username} picks ${coin.symbol}!`)
        .setDescription(
          `**${coin.name}** locked in at ${formatPrice(coin.price_now)}\n` +
          `:moneybag: Entry fee: **${RACE_ENTRY_FEE.toLocaleString()} Memescore** paid\n\n` +
          `Good luck! :four_leaf_clover:`
        )
        .setColor(0x00FF00)
        .setTimestamp();

      if (coin.coin_image_url) {
        successEmbed.setThumbnail(coin.coin_image_url);
      }

      await interaction.editReply({ embeds: [successEmbed], components: [] });
    });

    collector.on('end', async () => {
      if (!handled) {
        // Button timed out
        await interaction.editReply({
          embeds: [new EmbedBuilder().setDescription(':hourglass: Entry timed out. Use `/pick` to try again.').setColor(0x888888)],
          components: [],
        }).catch(() => {});
      }
    });

  } catch (error) {
    console.error('Error in /pick:', error);
    await interaction.editReply(':x: Failed to register pick. Please try again.');
  }
}

async function handleRace(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  try {
    let game = memegame.getActiveGame(interaction.guildId || '');

    if (!game) {
      await interaction.editReply(':x: No active race! Use `/gamestart` to start one.');
      return;
    }

    // Update phase if needed
    game = memegame.updateGamePhase(game.id) || game;

    // If finished without winner, set winner (prices already updated by race loop)
    if (game.phase === 'finished' && !game.winner) {
      game = memegame.setWinner(game.id) || game;
    }

    const embed = new EmbedBuilder();

    if (game.phase === 'picking') {
      embed.setTitle(':hourglass: MEME RACE - Pick Phase');
      embed.setColor(0xFFFF00);

      if (game.picks.length === 0) {
        embed.setDescription('No picks yet! Use `/pick <coin>` to join the race.');
      } else {
        const pickList = game.picks.map((p, i) =>
          `${i + 1}. **${p.username}** - ${p.coinSymbol}`
        ).join('\n');
        embed.setDescription(`**Current Racers:**\n${pickList}`);
      }

      embed.addFields({
        name: ':clock1: Picks Close',
        value: `<t:${Math.floor(new Date(game.pickEndsAt).getTime() / 1000)}:R>`,
        inline: true
      });

    } else if (game.phase === 'racing') {
      embed.setTitle(':racing_car: MEME RACE - LIVE!');
      embed.setColor(0xFF6B35);

      // Sort by performance
      const sorted = [...game.picks].sort(
        (a, b) => (b.percentChange ?? -Infinity) - (a.percentChange ?? -Infinity)
      );

      const positions = [':first_place:', ':second_place:', ':third_place:', '4.', '5.', '6.', '7.', '8.', '9.', '10.'];

      const standings = sorted.map((p, i) => {
        const change = p.percentChange !== undefined
          ? `${p.percentChange >= 0 ? '+' : ''}${p.percentChange.toFixed(2)}%`
          : 'N/A';
        const emoji = (p.percentChange ?? 0) >= 0 ? ':chart_with_upwards_trend:' : ':chart_with_downwards_trend:';
        return `${positions[i] || `${i+1}.`} **${p.coinSymbol}** (${p.username}) ${change} ${emoji}`;
      }).join('\n');

      const commentary = memegame.generateCommentary(game);

      embed.setDescription(`${commentary}\n\n**Standings:**\n${standings}`);
      embed.addFields({
        name: ':checkered_flag: Race Ends',
        value: `<t:${Math.floor(new Date(game.raceEndsAt).getTime() / 1000)}:R>`,
        inline: true
      });

    } else if (game.phase === 'finished') {
      embed.setTitle(':trophy: MEME RACE - FINISHED!');
      embed.setColor(0xFFD700);

      if (game.winner) {
        const changeStr = `${game.winner.percentChange >= 0 ? '+' : ''}${game.winner.percentChange.toFixed(2)}%`;
        embed.setDescription(
          `:crown: **WINNER: ${game.winner.username}**\n\n` +
          `${game.winner.coinSymbol} finished with **${changeStr}**!\n\n` +
          `Congratulations! :tada:`
        );
      }

      // Show final standings
      const sorted = [...game.picks].sort(
        (a, b) => (b.percentChange ?? -Infinity) - (a.percentChange ?? -Infinity)
      );

      const positions = [':first_place:', ':second_place:', ':third_place:', '4.', '5.'];
      const standings = sorted.slice(0, 5).map((p, i) => {
        const change = p.percentChange !== undefined
          ? `${p.percentChange >= 0 ? '+' : ''}${p.percentChange.toFixed(2)}%`
          : 'N/A';
        return `${positions[i]} **${p.coinSymbol}** (${p.username}) ${change}`;
      }).join('\n');

      embed.addFields({ name: 'Final Standings', value: standings || 'No picks' });
    }

    embed.setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error in /race:', error);
    await interaction.editReply(':x: Failed to get race status. Please try again.');
  }
}

async function handleBalance(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  if (!wager.isEnabled()) {
    await interaction.editReply(':x: Wagering is not enabled.');
    return;
  }

  const result = await wager.getBalance(interaction.user.id);

  if (!result.success) {
    const msg = result.error?.code === 'USER_NOT_LINKED'
      ? 'Your Discord is not linked to meme.com. Complete the Discord quest first!'
      : result.error?.message || 'Failed to check balance';
    await interaction.editReply(`:x: ${msg}`);
    return;
  }

  await interaction.editReply(`:moneybag: Your Memescore: **${result.balance?.toLocaleString() || 0}**`);
}

async function handleTip(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  if (!wager.isEnabled()) {
    await interaction.editReply(':x: Tipping is not enabled.');
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);

  // Validate: can't tip yourself
  if (targetUser.id === interaction.user.id) {
    await interaction.editReply(':x: You cannot tip yourself!');
    return;
  }

  // Validate: can't tip bots
  if (targetUser.bot) {
    await interaction.editReply(':x: You cannot tip bots!');
    return;
  }

  const result = await wager.sendTip(interaction.user.id, targetUser.id, amount);

  if (!result.success) {
    let msg: string;
    switch (result.error?.code) {
      case 'USER_NOT_LINKED':
        msg = ':link: Your Discord is not linked to meme.com. Complete the Discord quest first!';
        break;
      case 'RECIPIENT_NOT_LINKED':
        msg = `:link: ${targetUser.username}'s Discord is not linked to meme.com.`;
        break;
      case 'INSUFFICIENT_BALANCE':
        msg = `:coin: Not enough Memescore! ${result.error?.message || ''}`;
        break;
      default:
        msg = `:warning: ${result.error?.message || 'Failed to send tip'}`;
    }
    await interaction.editReply(msg);
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(':gift: Tip Sent!')
    .setDescription(
      `**${interaction.user.username}** tipped **${amount.toLocaleString()} Memescore** to **${targetUser.username}**!`
    )
    .addFields(
      { name: `${interaction.user.username}'s Balance`, value: `${result.fromNewBalance?.toLocaleString() || 0}`, inline: true },
      { name: `${targetUser.username}'s Balance`, value: `${result.toNewBalance?.toLocaleString() || 0}`, inline: true }
    )
    .setColor(0x00FF00)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

const KNOWN_COINGECKO_IDS = api.COINGECKO_IDS;

// Fetch latest prices for all picks in a game (CoinGecko + meme.com fallback)
async function fetchGamePrices(picks: memegame.Pick[]): Promise<Map<number, number>> {
  const prices = new Map<number, number>();

  // Separate coins by price source
  const cgPicks = picks.filter(p => KNOWN_COINGECKO_IDS[p.coinSymbol.toLowerCase()]);
  const memeComPicks = picks.filter(p => !KNOWN_COINGECKO_IDS[p.coinSymbol.toLowerCase()]);

  // Fetch CoinGecko prices
  if (cgPicks.length > 0) {
    const cgSymbols = cgPicks.map(p => p.coinSymbol);
    const cgPrices = await api.fetchCoinGeckoPrices(cgSymbols);

    for (const pick of cgPicks) {
      const cgPrice = cgPrices.get(pick.coinSymbol.toLowerCase());
      if (cgPrice !== undefined) {
        console.log(`[PRICE] ${pick.coinSymbol}: using CoinGecko $${cgPrice}`);
        prices.set(pick.coinId, cgPrice);
      } else {
        console.log(`[PRICE] ${pick.coinSymbol}: CoinGecko fetch failed`);
      }
    }
  }

  // Fetch meme.com prices for coins without CoinGecko mappings
  if (memeComPicks.length > 0) {
    console.log(`[PRICE] Fetching ${memeComPicks.length} coins from meme.com API: ${memeComPicks.map(p => p.coinSymbol).join(', ')}`);

    // Fetch in parallel with Promise.allSettled to handle individual failures
    const memeComResults = await Promise.allSettled(
      memeComPicks.map(async (pick) => {
        // Try multiple search strategies: symbol first, then name
        const searchTerms = [pick.coinSymbol, pick.coinName];

        for (const term of searchTerms) {
          try {
            const coin = await api.findCoin(term, true); // skipCache=true for fresh price
            if (coin && coin.id === pick.coinId && coin.price_now !== null && coin.price_now !== undefined) {
              return { coinId: pick.coinId, symbol: pick.coinSymbol, price: coin.price_now };
            }
          } catch (err) {
            // Continue to next search term
          }
        }

        console.log(`[PRICE] ${pick.coinSymbol}: meme.com search failed (tried: ${searchTerms.join(', ')})`);
        return null;
      })
    );

    for (const result of memeComResults) {
      if (result.status === 'fulfilled' && result.value) {
        const { coinId, symbol, price } = result.value;
        console.log(`[PRICE] ${symbol}: using meme.com $${price}`);
        prices.set(coinId, price);
      } else if (result.status === 'rejected') {
        console.error(`[PRICE] meme.com promise rejected:`, result.reason);
      }
    }
  }

  return prices;
}

// Finalize a race: set winner, process payouts, post announcement
async function finalizeRace(gameId: string): Promise<boolean> {
  // Update prices one last time
  const game = memegame.getGame(gameId);
  if (!game || game.picks.length === 0) return false;

  const prices = await fetchGamePrices(game.picks);
  const withPrices = memegame.updatePrices(gameId, prices);
  if (!withPrices) return false;

  // Ensure phase is finished
  memegame.updateGamePhase(gameId);

  // Set winner
  memegame.setWinner(gameId);
  const final = memegame.getGame(gameId);

  if (!final?.winner) {
    console.error(`Failed to set winner for game ${gameId}`);
    return false;
  }

  // Sort picks for standings and payout
  const sorted = [...final.picks].sort(
    (a, b) => (b.percentChange ?? -Infinity) - (a.percentChange ?? -Infinity)
  );

  let payoutInfo = '';

  // Calculate prize pool from local data
  const pool = memegame.getTotalWagerPool(gameId);
  console.log(`[FINALIZE] Game ${gameId}: pool=${pool}, wagerEnabled=${wager.isEnabled()}`);

  // Process wager payouts via API if enabled
  if (pool > 0 && wager.isEnabled()) {
    const results = sorted.map((p, i) => ({
      discordId: p.userId,
      rank: i + 1,
      coinSymbol: p.coinSymbol,
      percentChange: p.percentChange ?? 0,
    }));

    console.log(`[FINALIZE] Calling payout for game ${gameId} with ${results.length} results`);
    const payoutResult = await wager.payout(gameId, results);
    console.log(`[FINALIZE] Payout result:`, JSON.stringify(payoutResult));
    if (payoutResult.success && payoutResult.payouts?.length) {
      const medals = [':first_place:', ':second_place:', ':third_place:'];
      const payoutLines = payoutResult.payouts.map((p, i) =>
        `${medals[i] || `${i+1}.`} ${p.username || sorted[i]?.username || '?'} — **${p.amountWon.toLocaleString()} Memescore**`
      ).join('\n');
      payoutInfo = `\n\n:moneybag: **Prize pool: ${pool.toLocaleString()} Memescore** (${sorted.length} entries × ${RACE_ENTRY_FEE.toLocaleString()})` +
        `\n${payoutLines}`;
    }
  }

  // Fallback: show prize pool info if API payout failed
  if (pool > 0 && !payoutInfo) {
    payoutInfo = `\n\n:moneybag: **Prize pool: ${pool.toLocaleString()} Memescore** (${sorted.length} entries × ${RACE_ENTRY_FEE.toLocaleString()})` +
      `\n:first_place: ${sorted[0]?.username || '?'} — **${pool.toLocaleString()} Memescore**`;
  }

  // Build final standings
  const positions = [':first_place:', ':second_place:', ':third_place:', '4.', '5.', '6.', '7.', '8.'];
  const standings = sorted.map((p, i) => {
    const change = p.percentChange !== undefined
      ? `${p.percentChange >= 0 ? '+' : ''}${p.percentChange.toFixed(2)}%`
      : 'N/A';
    return `${positions[i] || `${i+1}.`} **${p.coinSymbol}** (${p.username}) ${change}`;
  }).join('\n');

  const winEmbed = new EmbedBuilder()
    .setTitle(':trophy: RACE OVER!')
    .setDescription(
      `:crown: **${final.winner.username} WINS!**\n\n` +
      `${final.winner.coinSymbol} finished with **${final.winner.percentChange >= 0 ? '+' : ''}${final.winner.percentChange.toFixed(2)}%**${payoutInfo}\n\n` +
      `**Final Standings:**\n${standings}\n\n` +
      `Use \`/gamestart\` to begin a new race!`
    )
    .setColor(0xFFD700)
    .setTimestamp();

  // Post to channel
  const channel = client.channels.cache.get(final.channelId);
  if (channel && channel.isTextBased()) {
    await (channel as any).send({ embeds: [winEmbed] });
    console.log(`Posted winner announcement for game ${gameId}: ${final.winner.username} with ${final.winner.coinSymbol}`);

    // Generate and post victory image (only for races with 2+ participants)
    if (sorted.length >= 2) {
      try {
        const winnerCoin = sorted[0]?.coinName || sorted[0]?.coinSymbol || 'Winner';
        const runnerUpCoin = sorted[1]?.coinName || sorted[1]?.coinSymbol;

        const imageBuffer = await generateRaceVictoryImage(winnerCoin, runnerUpCoin);

      if (imageBuffer) {
        console.log('Sending race victory image, buffer size:', imageBuffer.length);
        const attachment = new AttachmentBuilder(imageBuffer, { name: 'race-victory.png' });
        const imageEmbed = new EmbedBuilder()
          .setTitle(`:art: ${sorted[0]?.coinSymbol || 'Winner'} Victory!`)
          .setImage('attachment://race-victory.png')
          .setColor(0x9932CC)
          .setFooter({ text: 'AI-generated race artwork' });

        await (channel as any).send({ embeds: [imageEmbed], files: [attachment] });
        console.log('Race victory image sent successfully');
      }
      } catch (imageError) {
        console.error('Error generating race victory image:', imageError);
        // Don't fail the whole finalization if image fails
      }
    }

    return true;
  } else {
    console.error(`Could not find channel ${final.channelId} to post winner for game ${gameId}`);
    return false;
  }
}

// Check for games that finished without a winner announcement (e.g. bot was down)
async function checkUnfinalizedGames() {
  try {
    const unfinalizedGames = memegame.getUnfinalizedGames();

    for (const game of unfinalizedGames) {
      console.log(`Found unfinalized game ${game.id}, finalizing...`);
      await finalizeRace(game.id);
    }
  } catch (error) {
    console.error('Error checking unfinalized games:', error);
  }
}

// Race update loop - posts commentary during races
async function raceUpdateLoop() {
  try {
    // First, check for any games that ended while the bot was down
    await checkUnfinalizedGames();

    const activeGames = memegame.getAllActiveGames();

    for (const game of activeGames) {
      // Update phase first
      const updated = memegame.updateGamePhase(game.id);
      if (!updated) continue;

      // Check for 1-hour reminder during picking phase
      if (updated.phase === 'picking' && !updated.reminderSent) {
        const msUntilPicksClose = new Date(updated.pickEndsAt).getTime() - Date.now();
        const hoursLeft = msUntilPicksClose / (1000 * 60 * 60);

        // Send reminder when ~1 hour left (between 30min and 1h30min to account for loop timing)
        if (hoursLeft <= 1.5 && hoursLeft > 0.5) {
          // Find #general channel
          const guild = client.guilds.cache.get(updated.guildId);
          const general = guild?.channels.cache.find(
            (ch) => ch.name === 'general' && ch.isTextBased()
          );

          if (general && general.isTextBased()) {
            const linkText = updated.announcementUrl
              ? `\n\n:link: [Jump to race announcement](${updated.announcementUrl})`
              : '';

            const reminderEmbed = new EmbedBuilder()
              .setTitle(':alarm_clock: 1 HOUR LEFT TO JOIN!')
              .setDescription(
                `**A race is happening!** Submit your entry before picks close!\n\n` +
                `:dart: Use \`/pick <coin>\` to join\n` +
                `:busts_in_silhouette: Current entries: **${updated.picks.length}**\n` +
                `:clock1: Picks close <t:${Math.floor(new Date(updated.pickEndsAt).getTime() / 1000)}:R>${linkText}`
              )
              .setColor(0xFFA500)
              .setTimestamp();

            await (general as any).send({ embeds: [reminderEmbed] });
            memegame.markReminderSent(updated.id);
            console.log(`Sent 1-hour reminder for game ${updated.id} to #general`);
          }
        }
        continue; // Skip rest of loop for picking phase
      }

      // Skip if still in picking phase (after reminder check)
      if (updated.phase === 'picking') continue;

      // Notify when race just started (phase changed from picking to racing)
      if (game.phase === 'picking' && updated.phase === 'racing') {
        const channel = client.channels.cache.get(updated.channelId);
        if (channel && channel.isTextBased()) {
          const startEmbed = new EmbedBuilder()
            .setTitle(':racing_car: THE RACE HAS BEGUN!')
            .setDescription(
              `Picks are locked! **${updated.picks.length} racers** are competing!\n\n` +
              `Use \`/race\` to check standings.`
            )
            .setColor(0xFF6B35)
            .setTimestamp();
          await (channel as any).send({ embeds: [startEmbed] });
        }
      }

      // If the race just finished, finalize it immediately
      if (updated.phase === 'finished') {
        if (!updated.winner) {
          await finalizeRace(game.id);
        }
        continue;
      }

      // Skip if less than 2 picks (not enough for a race)
      if (updated.picks.length < 2) continue;

      // Always fetch and update prices
      const prices = await fetchGamePrices(updated.picks);
      const withPrices = memegame.updatePrices(game.id, prices);
      if (!withPrices) continue;

      console.log(`[RACE] Updated prices for ${game.id}: ${withPrices.picks.length} coins`);

      // Throttle message posting to ~1 per hour during racing phase
      const hoursSinceStart = (Date.now() - new Date(updated.pickEndsAt).getTime()) / (1000 * 60 * 60);
      const expectedUpdates = Math.floor(hoursSinceStart);

      if (updated.updateCount >= expectedUpdates) continue;

      // Generate update message
      const sorted = [...withPrices.picks].sort(
        (a, b) => (b.percentChange ?? -Infinity) - (a.percentChange ?? -Infinity)
      );

      const currentLeader = sorted[0]?.coinSymbol;
      const commentary = memegame.generateCommentary(withPrices, withPrices.lastLeader);

      memegame.incrementUpdateCount(game.id, currentLeader);

      const positions = [':first_place:', ':second_place:', ':third_place:'];
      const standings = sorted.slice(0, 3).map((p, i) => {
        const change = p.percentChange !== undefined
          ? `${p.percentChange >= 0 ? '+' : ''}${p.percentChange.toFixed(2)}%`
          : 'N/A';
        return `${positions[i]} **${p.coinSymbol}** (${p.username}) ${change}`;
      }).join('\n');
      const timeLeft = memegame.getTimeRemaining(withPrices.raceEndsAt);

      const embed = new EmbedBuilder()
        .setTitle(':loudspeaker: RACE UPDATE!')
        .setDescription(`${commentary}\n\n**Current Standings:**\n${standings}`)
        .addFields({ name: ':clock1: Time Remaining', value: timeLeft, inline: true })
        .setColor(0xFF6B35)
        .setTimestamp();

      // Post to channel
      const channel = client.channels.cache.get(withPrices.channelId);
      if (channel && channel.isTextBased()) {
        await (channel as any).send({ embeds: [embed] });
      }
    }
  } catch (error) {
    console.error('Error in race update loop:', error);
  }
}

// Wednesday "It's Wednesday My Dudes" scheduled post
const WEDNESDAY_IMAGES = [
  'https://media.tenor.com/ATYLM3TJsykAAAAC/ahhhh-its-wednesday-my-dudes.gif',
  'https://media.tenor.com/D0R5_HMbK-MAAAAC/wednesday-jimmy.gif',
  'https://media.tenor.com/bbaIA0DgBWMAAAAC/jimmy-here-wednesday.gif',
  'https://media.tenor.com/ZCm642bYpaUAAAAC/happy-wednesday-wednesday.gif',
  'https://media.tenor.com/_EN3m4eaZvgAAAAC/wednesday-happy.gif',
  'https://media.tenor.com/J-92BmDz5w4AAAAC/it-is-wednesday-wednesday.gif',
  'https://media.tenor.com/trA5LNE22E0AAAAC/its-wednesday-frog-wednesday.gif',
  'https://media.tenor.com/LXzUSLuUiq8AAAAC/wednesday-yay.gif',
  'https://media.tenor.com/nhuiCSU1hQMAAAAC/breaking-news-frog.gif',
  'https://media.tenor.com/KwiUEO4-XZwAAAAC/it%27s-wednesday-its-wednesday-my-dudes.gif',
  'https://media.tenor.com/RjlD89ot09cAAAAC/it-is-wednesday-my-dudes-world-of-warcraft.gif',
  'https://media.tenor.com/u8o5kJfNhGwAAAAC/wednesday-itsd-wednesday-my-dudes.gif',
  'https://media.tenor.com/tLL_gOkzvJAAAAAC/jimmy-here-wednesday.gif',
  'https://media.tenor.com/73yzjvldvFUAAAAC/wednesday.gif',
];

let lastWednesdayImageIndex = -1;

const WEDNESDAY_STATE_FILE = join(__dirname, '..', 'data', 'wednesday-post.json');

function getLastWednesdayPostDate(): string | null {
  try {
    if (existsSync(WEDNESDAY_STATE_FILE)) {
      const data = JSON.parse(readFileSync(WEDNESDAY_STATE_FILE, 'utf-8'));
      return data.lastPostDate || null;
    }
  } catch (_) {}
  return null;
}

function saveWednesdayPostDate(dateStr: string) {
  try {
    writeFileSync(WEDNESDAY_STATE_FILE, JSON.stringify({ lastPostDate: dateStr }, null, 2));
  } catch (e) {
    console.error('Failed to save wednesday post state:', e);
  }
}

function todayUTCString(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function getRandomWednesdayImage(): string {
  let index: number;
  do {
    index = Math.floor(Math.random() * WEDNESDAY_IMAGES.length);
  } while (index === lastWednesdayImageIndex && WEDNESDAY_IMAGES.length > 1);
  lastWednesdayImageIndex = index;
  return WEDNESDAY_IMAGES[index];
}

function msUntilNextWednesdayNoon(): number {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 3=Wed
  let daysUntilWed = (3 - dayOfWeek + 7) % 7;
  // If it's Wednesday but past 12:00 UTC, wait until next week
  if (daysUntilWed === 0 && now.getUTCHours() >= 12) {
    daysUntilWed = 7;
  }
  const nextWed = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilWed,
    12, 0, 0, 0
  ));
  return nextWed.getTime() - now.getTime();
}

async function postWednesdayMessage() {
  const today = todayUTCString();

  // Prevent double-posting on the same day (e.g. multiple restarts)
  if (getLastWednesdayPostDate() === today) {
    console.log(`Wednesday post already sent today (${today}), skipping`);
  } else {
    try {
      const imageUrl = getRandomWednesdayImage();

      for (const guild of client.guilds.cache.values()) {
        const general = guild.channels.cache.find(
          (ch) => ch.name === 'general' && ch.isTextBased()
        );
        if (general && general.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle('IT IS WEDNESDAY MY DUDES')
            .setImage(imageUrl)
            .setColor(0x00FF00)
            .setTimestamp();
          await (general as any).send({ embeds: [embed] });
          console.log(`Posted Wednesday meme to #general in ${guild.name}`);
        }
      }
      saveWednesdayPostDate(today);
    } catch (error) {
      console.error('Error posting Wednesday message:', error);
    }
  }

  // Schedule next Wednesday
  const ms = msUntilNextWednesdayNoon();
  console.log(`Next Wednesday post in ${Math.round(ms / 1000 / 60 / 60)}h`);
  setTimeout(postWednesdayMessage, ms);
}

// Event handlers
client.on('ready', () => {
  console.log(`Logged in as ${client.user?.tag}`);
  console.log(`Serving ${client.guilds.cache.size} guilds`);

  // Run immediately on startup to catch any races that ended while bot was down
  raceUpdateLoop();

  setInterval(raceUpdateLoop, 30 * 60 * 1000);
  console.log('Race update loop started');

  // Trends score update loop (every 1 hour)
  trends.trendsScoreUpdateLoop();
  setInterval(() => trends.trendsScoreUpdateLoop(), 1 * 60 * 60 * 1000);
  console.log('Trends score update loop started');

  // Wednesday post — catch up if missed, then schedule future posts
  const now = new Date();
  const isWednesday = now.getUTCDay() === 3;
  const isPastNoonUTC = now.getUTCHours() >= 12;
  const alreadyPostedToday = getLastWednesdayPostDate() === todayUTCString();

  if (isWednesday && isPastNoonUTC && !alreadyPostedToday) {
    console.log('Wednesday post was missed — posting now (catch-up)');
    postWednesdayMessage();
  } else {
    const msToWed = msUntilNextWednesdayNoon();
    console.log(`Wednesday post scheduled in ${Math.round(msToWed / 1000 / 60 / 60)}h`);
    setTimeout(postWednesdayMessage, msToWed);
  }

  // Labs market reports — disabled while reworking format
  // startLabsReportLoop(client);

  // Analytics digest + daily health posts
  analytics.startAnalyticsLoop(client);

  // Trends score update moved to standalone cron:
  // ~/Desktop/labs-meme-com/experiments/meme-trends-battle/trends_discovery.py --update
  // via launchd: com.meme.trends-update (every 4h)
});

// ── Trends handlers ────────────────────────────────────────────────────────

async function handleTrends(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const memes = await trends.discoverTrends(15);
  if (memes.length === 0) {
    await interaction.editReply('No trending memes found. Try again later.');
    return;
  }
  const lines = memes.map((m, i) =>
    `**${i + 1}.** ${m.name} — score: **${m.score}**/100 (${m.change_pct >= 0 ? '+' : ''}${m.change_pct}%)`
  );
  const embed = new EmbedBuilder()
    .setTitle('Trending Memes (Google Trends)')
    .setDescription(lines.join('\n'))
    .setColor(0x4285F4)
    .setFooter({ text: 'Use /trendbattle <a> <b> to create a battle' })
    .setTimestamp();
  // Add thumbnail from top meme if available
  if (memes[0]?.image_url) embed.setThumbnail(memes[0].image_url);
  await interaction.editReply({ embeds: [embed] });
}

// ── /createprediction & /resolveprediction — Custom prediction markets ──────

const MARKET_CREATOR_CHANNEL_IDS = (process.env.MARKET_CREATOR_CHANNEL_IDS || '').split(',').filter(Boolean);

// Supabase REST client for custom predictions (reuses trends.ts env vars)
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

let _customSb: ReturnType<typeof axios.create> | null = null;
function customSb() {
  if (!_customSb) {
    if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY not set');
    _customSb = axios.create({
      baseURL: `${SUPABASE_URL}/rest/v1`,
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      timeout: 15000,
    });
  }
  return _customSb;
}

function parseEndDate(input: string): Date | null {
  // Relative: "3d", "7d", "2w", "1m"
  const rel = input.match(/^(\d+)\s*(d|w|m)$/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2].toLowerCase();
    const ms = unit === 'd' ? n * 86400000 : unit === 'w' ? n * 7 * 86400000 : n * 30 * 86400000;
    return new Date(Date.now() + ms);
  }
  // ISO date: "2026-03-15" or "2026-03-15T18:00:00Z"
  const d = new Date(input);
  if (!isNaN(d.getTime()) && d.getTime() > Date.now()) return d;
  return null;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

async function getNextCustomRound(slug: string): Promise<number> {
  const { data } = await customSb().get('/labs_markets', {
    params: {
      market_type: 'eq.CUSTOM',
      id: `like.CUSTOM-${slug}*`,
      select: 'id',
      order: 'id.desc',
      limit: 1,
    },
  });
  if (data && data.length > 0) {
    const parts = data[0].id.split('-');
    const last = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last)) return last + 1;
  }
  return 1;
}

async function handleCreatePrediction(interaction: ChatInputCommandInteraction) {
  // Channel gate
  if (MARKET_CREATOR_CHANNEL_IDS.length > 0 && !MARKET_CREATOR_CHANNEL_IDS.includes(interaction.channelId)) {
    await interaction.reply({ content: 'This command is only available in team channels.', flags: 64 });
    return;
  }

  await interaction.deferReply();

  const title = interaction.options.getString('title', true).trim();
  const imageUrl = interaction.options.getString('image_url', true).trim();
  const endDateStr = interaction.options.getString('end_date', true).trim();
  const description = interaction.options.getString('description')?.trim() || null;
  const liquidity = interaction.options.getInteger('liquidity') || 100000;
  const labelYes = interaction.options.getString('label_yes')?.trim() || 'YES';
  const labelNo = interaction.options.getString('label_no')?.trim() || 'NO';

  const endDate = parseEndDate(endDateStr);
  if (!endDate) {
    await interaction.editReply('Invalid end date. Use ISO format (2026-03-15) or relative (3d, 7d, 2w).');
    return;
  }

  const slug = slugify(title);
  const round = await getNextCustomRound(slug);
  const marketId = `CUSTOM-${slug}-${round}`;
  const expiresTs = Math.floor(endDate.getTime() / 1000);

  const market = {
    id: marketId,
    market_type: 'CUSTOM',
    coin_symbol: 'CUSTOM',
    coin_name: title.slice(0, 50),
    q_yes: 0,
    q_no: 0,
    b: liquidity,
    status: 'OPEN',
    expires_at: endDate.toISOString(),
    custom_title: title,
    custom_image_url: imageUrl,
    custom_description: description,
    label_yes: labelYes,
    label_no: labelNo,
    created_by: interaction.user.id,
    start_mc: 0,
    current_mc: 0,
    volume: 0,
    players: 0,
    fee_pool: 0,
    total_pot: 0,
    winner_weight_sum: 0,
    winner_invested_sum: 0,
  };

  // Preview embed
  const previewEmbed = new EmbedBuilder()
    .setTitle('PREDICTION MARKET PREVIEW')
    .setDescription(`**${title}**`)
    .addFields(
      { name: 'Options', value: `${labelYes} / ${labelNo}`, inline: true },
      { name: 'Ends', value: `<t:${expiresTs}:R>`, inline: true },
      { name: 'Liquidity', value: liquidity.toLocaleString(), inline: true },
      { name: 'Market ID', value: marketId, inline: false },
    )
    .setThumbnail(imageUrl)
    .setColor(0xf7931a)
    .setFooter({ text: 'labs.meme.com' })
    .setTimestamp();

  if (description) {
    previewEmbed.addFields({ name: 'Description', value: description });
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('cp_confirm').setLabel('Create').setEmoji('\u2705').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cp_cancel').setLabel('Cancel').setEmoji('\u274c').setStyle(ButtonStyle.Danger),
  );

  const reply = await interaction.editReply({
    embeds: [previewEmbed],
    components: [row],
  });

  const collector = reply.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60_000,
    filter: (i) => i.user.id === interaction.user.id,
  });

  collector.on('collect', async (btn) => {
    if (btn.customId === 'cp_confirm') {
      collector.stop('confirmed');
      await btn.deferUpdate();
      try {
        const { data } = await customSb().post('/labs_markets', market);
        if (!data || data.length === 0) throw new Error('Insert failed — trigger may have blocked it');

        const successEmbed = new EmbedBuilder()
          .setTitle('Prediction Market Created!')
          .setDescription(`**${title}**`)
          .addFields(
            { name: 'Options', value: `${labelYes} / ${labelNo}`, inline: true },
            { name: 'Ends', value: `<t:${expiresTs}:R>`, inline: true },
            { name: 'Market ID', value: marketId, inline: true },
          )
          .setThumbnail(imageUrl)
          .setColor(0x22c55e)
          .setFooter({ text: 'Bet on labs.meme.com' })
          .setTimestamp();
        await interaction.editReply({ embeds: [successEmbed], components: [] });
      } catch (err: any) {
        console.error('Create prediction failed:', err);
        await interaction.editReply({ content: `Failed to create market: ${err.message}`, embeds: [], components: [] });
      }
    } else if (btn.customId === 'cp_cancel') {
      collector.stop('cancelled');
      await btn.deferUpdate();
      await interaction.editReply({ content: 'Cancelled.', embeds: [], components: [] });
    }
  });

  collector.on('end', async (_collected, reason) => {
    if (reason === 'time') {
      await interaction.editReply({ content: 'Timed out.', embeds: [], components: [] }).catch(() => {});
    }
  });
}

async function handleResolvePrediction(interaction: ChatInputCommandInteraction) {
  // Channel gate
  if (MARKET_CREATOR_CHANNEL_IDS.length > 0 && !MARKET_CREATOR_CHANNEL_IDS.includes(interaction.channelId)) {
    await interaction.reply({ content: 'This command is only available in team channels.', flags: 64 });
    return;
  }

  await interaction.deferReply();

  const marketId = interaction.options.getString('market_id', true).trim();
  const outcome = interaction.options.getString('outcome', true) as 'YES' | 'NO';

  try {
    const { data } = await customSb().post('/rpc/labs_resolve_custom', {
      p_market_id: marketId,
      p_result: outcome,
    });

    if (!data?.success) {
      const errMsg = data?.error || 'Unknown error';
      const friendlyErrors: Record<string, string> = {
        market_not_found: `Market "${marketId}" not found.`,
        not_custom_market: `Market "${marketId}" is not a CUSTOM market.`,
        market_not_open: `Market "${marketId}" is not open (already resolved?).`,
        invalid_result: 'Result must be YES or NO.',
      };
      await interaction.editReply(friendlyErrors[errMsg] || `Error: ${errMsg}`);
      return;
    }

    // Fetch market title for the embed
    let title = marketId;
    try {
      const { data: markets } = await customSb().get('/labs_markets', {
        params: { id: `eq.${marketId}`, select: 'custom_title,label_yes,label_no' },
      });
      if (markets?.[0]) {
        title = markets[0].custom_title || marketId;
      }
    } catch {}

    const resultEmbed = new EmbedBuilder()
      .setTitle('Prediction Market Resolved!')
      .setDescription(`**${title}**`)
      .addFields(
        { name: 'Outcome', value: outcome, inline: true },
        { name: 'Market ID', value: marketId, inline: true },
        { name: 'Total Pot', value: Number(data.total_pot).toLocaleString(), inline: true },
      )
      .setColor(outcome === 'YES' ? 0x22c55e : 0xef4444)
      .setFooter({ text: 'Claim rewards on labs.meme.com' })
      .setTimestamp();

    await interaction.editReply({ embeds: [resultEmbed] });
  } catch (err: any) {
    console.error('Resolve prediction failed:', err);
    await interaction.editReply(`Failed to resolve market: ${err.message}`);
  }
}

// ── /analytics — Wiki analytics digest and pipeline health ──────────────────

async function handleAnalytics(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const type = interaction.options.getString('type') || 'digest';

  if (type === 'health') {
    const result = await analytics.getHealthForCommand();
    await interaction.editReply(result);
  } else {
    const result = await analytics.getDigestForCommand();
    if (typeof result === 'string') {
      await interaction.editReply(result);
    } else {
      await interaction.editReply({ embeds: [result] });
    }
  }
}

// ── /createmarket — Conversational TRENDS market wizard ─────────────────────

async function handleCreateMarket(interaction: ChatInputCommandInteraction) {
  // Channel gate
  if (MARKET_CREATOR_CHANNEL_IDS.length > 0 && !MARKET_CREATOR_CHANNEL_IDS.includes(interaction.channelId)) {
    await interaction.reply({ content: 'This command is only available in team channels.', flags: 64 });
    return;
  }

  await interaction.deferReply();

  const nameA = interaction.options.getString('meme_a', true).trim();
  const nameB = interaction.options.getString('meme_b', true).trim();

  if (nameA.toLowerCase() === nameB.toLowerCase()) {
    await interaction.editReply('Pick two different memes.');
    return;
  }

  let prepared: Awaited<ReturnType<typeof trends.prepareTrendsMarket>>;
  try {
    prepared = await trends.prepareTrendsMarket(nameA, nameB);
  } catch (err: any) {
    await interaction.editReply(err.message);
    return;
  }

  // If either score is 0, show error and only allow cancel
  const hasZeroScore = prepared.scoreA <= 0 || prepared.scoreB <= 0;

  function buildPreviewEmbed(p: typeof prepared) {
    const expiresTs = Math.floor(p.expiresAt.getTime() / 1000);
    const embed = new EmbedBuilder()
      .setTitle('TRENDS MARKET PREVIEW')
      .setDescription(
        `**${p.nameA}** (${p.scoreA}/100)  vs  **${p.nameB}** (${p.scoreB}/100)`
      )
      .addFields(
        { name: 'Duration', value: `${p.durationDays} days`, inline: true },
        { name: 'Expires', value: `<t:${expiresTs}:R>`, inline: true },
        { name: 'Market ID', value: p.market.id, inline: true },
      )
      .setColor(0x4285F4)
      .setFooter({ text: 'labs.meme.com' })
      .setTimestamp();

    if (p.imageA) embed.setThumbnail(p.imageA);
    if (p.imageB) embed.setImage(p.imageB);

    // Show warnings
    for (const w of p.warnings) {
      embed.addFields({ name: '\u26a0\ufe0f Warning', value: w });
    }

    return embed;
  }

  function buildButtons(zeroScore: boolean, p: typeof prepared) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    if (!zeroScore) {
      row.addComponents(
        new ButtonBuilder().setCustomId('cm_confirm').setLabel('Create').setEmoji('\u2705').setStyle(ButtonStyle.Success),
      );
    }
    row.addComponents(
      new ButtonBuilder().setCustomId('cm_cancel').setLabel('Cancel').setEmoji('\u274c').setStyle(ButtonStyle.Danger),
    );
    if (!zeroScore) {
      row.addComponents(
        new ButtonBuilder().setCustomId('cm_duration').setLabel('Duration').setEmoji('\u23f1\ufe0f').setStyle(ButtonStyle.Secondary),
      );
    }
    // Add Fix Image buttons when images are missing
    const rows: ActionRowBuilder<ButtonBuilder>[] = [row];
    if (!p.imageA || !p.imageB) {
      const imgRow = new ActionRowBuilder<ButtonBuilder>();
      if (!p.imageA) imgRow.addComponents(new ButtonBuilder().setCustomId('cm_img_a').setLabel(`Fix ${p.nameA} image`).setStyle(ButtonStyle.Secondary));
      if (!p.imageB) imgRow.addComponents(new ButtonBuilder().setCustomId('cm_img_b').setLabel(`Fix ${p.nameB} image`).setStyle(ButtonStyle.Secondary));
      rows.push(imgRow);
    }
    return rows;
  }

  const reply = await interaction.editReply({
    embeds: [buildPreviewEmbed(prepared)],
    components: buildButtons(hasZeroScore, prepared),
  });

  const collector = reply.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120_000,
    filter: (i) => i.user.id === interaction.user.id,
  });

  collector.on('collect', async (btn) => {
    if (btn.customId === 'cm_confirm') {
      collector.stop('confirmed');
      await btn.deferUpdate();
      try {
        const created = await trends.commitTrendsMarket(prepared.market);
        const successEmbed = new EmbedBuilder()
          .setTitle('Trends Battle Created!')
          .setDescription(`**${prepared.nameA}** (${prepared.scoreA}/100) vs **${prepared.nameB}** (${prepared.scoreB}/100)`)
          .addFields(
            { name: 'Market ID', value: created.id, inline: true },
            { name: 'Duration', value: `${prepared.durationDays} days`, inline: true },
            { name: 'Expires', value: `<t:${Math.floor(new Date(created.expires_at).getTime() / 1000)}:R>`, inline: true },
          )
          .setColor(0x22c55e)
          .setFooter({ text: 'Bet on labs.meme.com' })
          .setTimestamp();
        if (prepared.imageA) successEmbed.setThumbnail(prepared.imageA);
        await interaction.editReply({ embeds: [successEmbed], components: [] });
      } catch (err: any) {
        await interaction.editReply({ content: `Failed to create market: ${err.message}`, embeds: [], components: [] });
      }

    } else if (btn.customId === 'cm_cancel') {
      collector.stop('cancelled');
      await btn.deferUpdate();
      await interaction.editReply({ content: 'Market creation cancelled.', embeds: [], components: [] });

    } else if (btn.customId === 'cm_duration') {
      await btn.deferUpdate();
      const durationRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('cm_dur_1').setLabel('1 day').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('cm_dur_3').setLabel('3 days').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('cm_dur_7').setLabel('7 days').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cm_dur_14').setLabel('14 days').setStyle(ButtonStyle.Secondary),
      );
      await interaction.editReply({
        embeds: [buildPreviewEmbed(prepared)],
        components: [durationRow],
      });

    } else if (btn.customId.startsWith('cm_dur_')) {
      await btn.deferUpdate();
      const days = parseInt(btn.customId.replace('cm_dur_', ''), 10);
      prepared.durationDays = days;
      prepared.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      prepared.market.expires_at = prepared.expiresAt.toISOString();
      await interaction.editReply({
        embeds: [buildPreviewEmbed(prepared)],
        components: buildButtons(false, prepared),
      });

    } else if (btn.customId === 'cm_img_a' || btn.customId === 'cm_img_b') {
      const side = btn.customId === 'cm_img_a' ? 'A' : 'B';
      const memeName = side === 'A' ? prepared.nameA : prepared.nameB;
      const modalId = `cm_img_modal_${side}_${Date.now()}`;

      const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle(`Fix ${memeName} image`)
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('image_url')
              .setLabel('Image URL')
              .setPlaceholder('https://example.com/image.png')
              .setStyle(TextInputStyle.Short)
              .setRequired(true),
          ),
        );

      await btn.showModal(modal);

      try {
        const modalSubmit = await btn.awaitModalSubmit({ time: 60_000, filter: (i) => i.customId === modalId });
        const url = modalSubmit.fields.getTextInputValue('image_url').trim();
        await modalSubmit.deferUpdate();

        if (side === 'A') {
          prepared.imageA = url;
          prepared.market.coin_image = url;
          // Remove the image warning for A
          prepared.warnings = prepared.warnings.filter(w => !w.includes(prepared.nameA));
        } else {
          prepared.imageB = url;
          prepared.market.coin_b_image = url;
          prepared.warnings = prepared.warnings.filter(w => !w.includes(prepared.nameB));
        }

        await interaction.editReply({
          embeds: [buildPreviewEmbed(prepared)],
          components: buildButtons(hasZeroScore, prepared),
        });
      } catch {
        // Modal timed out — do nothing, buttons still active
      }
    }
  });

  collector.on('end', async (_collected, reason) => {
    if (reason !== 'confirmed' && reason !== 'cancelled') {
      try {
        await interaction.editReply({ content: 'Market creation timed out.', embeds: [], components: [] });
      } catch {
        // Interaction may have expired
      }
    }
  });
}

async function handleTrendStatus(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const battle = await trends.getActiveTrendsBattle();
  if (!battle) {
    await interaction.editReply('No active trends battle. Create one with `/trendbattle`.');
    return;
  }
  const pctA = battle.start_mc > 0 ? ((battle.current_mc - battle.start_mc) / battle.start_mc * 100).toFixed(1) : '0.0';
  const pctB = battle.start_mc_b > 0 ? ((battle.current_mc_b - battle.start_mc_b) / battle.start_mc_b * 100).toFixed(1) : '0.0';
  const expiresTs = Math.floor(new Date(battle.expires_at).getTime() / 1000);
  const embed = new EmbedBuilder()
    .setTitle(`${battle.coin_symbol} vs ${battle.coin_b_symbol}`)
    .addFields(
      { name: battle.coin_symbol, value: `${Math.round(battle.current_mc)}/100 (${Number(pctA) >= 0 ? '+' : ''}${pctA}%)`, inline: true },
      { name: battle.coin_b_symbol, value: `${Math.round(battle.current_mc_b)}/100 (${Number(pctB) >= 0 ? '+' : ''}${pctB}%)`, inline: true },
      { name: 'Expires', value: `<t:${expiresTs}:R>`, inline: true },
      { name: 'Volume', value: battle.volume.toLocaleString(), inline: true },
      { name: 'Players', value: String(battle.players), inline: true },
    )
    .setColor(0x4285F4)
    .setFooter({ text: `Market: ${battle.id}` })
    .setTimestamp();
  if (battle.coin_image) embed.setThumbnail(battle.coin_image);
  await interaction.editReply({ embeds: [embed] });
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    if (commandName === 'meme') {
      await handleMeme(interaction);
    } else if (commandName === 'hotpredictions') {
      await handleHotPredictions(interaction);
    } else if (commandName === 'battle') {
      await handleBattle(interaction);
    } else if (commandName === 'champion') {
      await handleChampion(interaction);
    } else if (commandName === 'xbattle') {
      await handleXbattle(interaction);
    } else if (commandName === 'xstart') {
      await handleXstart(interaction);
    } else if (commandName === 'xstatus') {
      await handleXstatus(interaction);
    } else if (commandName === 'gamestart') {
      await handleGameStart(interaction);
    } else if (commandName === 'pick') {
      await handlePick(interaction);
    } else if (commandName === 'race') {
      await handleRace(interaction);
    } else if (commandName === 'balance') {
      await handleBalance(interaction);
    } else if (commandName === 'tip') {
      await handleTip(interaction);
    } else if (commandName === 'trends') {
      await handleTrends(interaction);
    } else if (commandName === 'trendstatus') {
      await handleTrendStatus(interaction);
    } else if (commandName === 'createmarket') {
      await handleCreateMarket(interaction);
    } else if (commandName === 'createprediction') {
      await handleCreatePrediction(interaction);
    } else if (commandName === 'resolveprediction') {
      await handleResolvePrediction(interaction);
    } else if (commandName === 'analytics') {
      await handleAnalytics(interaction);
    }
  } catch (error) {
    console.error(`Error handling /${commandName}:`, error);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(':x: An error occurred.');
      } else {
        await interaction.reply({ content: ':x: An error occurred.', flags: 64 });
      }
    } catch {
      // Interaction expired
    }
  }
});

client.on('error', (error) => {
  console.error('Client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

client.login(token);
