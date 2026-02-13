import { Client, GatewayIntentBits, EmbedBuilder, ChatInputCommandInteraction, AttachmentBuilder } from 'discord.js';
import * as xapi from './xapi';
import * as xmarkets from './xmarkets';
import * as memegame from './memegame';
import * as wager from './wager';
import { config } from 'dotenv';
import OpenAI from 'openai';
import * as api from './api';

config();

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

    const imageData = response.data[0];
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

    const imageData = response.data[0];
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
    const coin = await api.findCoin(query);

    if (!coin) {
      await interaction.editReply(`:mag: No coin found matching "${query}"`);
      return;
    }

    const trendColor = (coin.trend_24h ?? 0) >= 0 ? 0x00ff00 : 0xff0000;

    const embed = new EmbedBuilder()
      .setTitle(`${coin.name || 'Unknown'} (${coin.symbol || '?'})`)
      .setColor(trendColor)
      .setTimestamp();

    if (coin.coin_image_url) {
      embed.setThumbnail(coin.coin_image_url);
    }

    embed.addFields(
      { name: ':moneybag: Price', value: formatPrice(coin.price_now), inline: true },
      { name: ':clock1: 24h Change', value: formatTrend(coin.trend_24h) + getTrendEmoji(coin.trend_24h), inline: true },
      { name: ':calendar: 7d Change', value: formatTrend(coin.trend_7d) + getTrendEmoji(coin.trend_7d), inline: true },
      { name: ':bank: Market Cap', value: formatMarketCap(coin.market_capitalization), inline: true },
      { name: ':star: Diamond Rating', value: coin.diamond_rating ? `${coin.diamond_rating.toFixed(1)} :gem:` : 'N/A', inline: true }
    );

    // Check for active predictions
    const predictions = await api.findActivePredictionsForCoin(coin.name || '', coin.symbol);
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

    if (coin.key) {
      embed.setURL(`https://meme.com/coins/${coin.key}`);
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
        const imageBuffer = await generateTieImage(coin1.name || coin1.symbol, coin2.name || coin2.symbol);

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

  try {
    const game = memegame.createGame(
      interaction.guildId || '',
      interaction.channelId,
      interaction.user.id
    );

    if (!game) {
      await interaction.editReply(':x: A race is already active! Use `/race` to check status.');
      return;
    }

    const pickEnds = new Date(game.pickEndsAt);
    const raceEnds = new Date(game.raceEndsAt);

    const embed = new EmbedBuilder()
      .setTitle(':checkered_flag: MEME RACE STARTED!')
      .setDescription(
        `**The race is ON!**\n\n` +
        `:dart: Use \`/pick <coin>\` to choose your memecoin\n` +
        `:hourglass: You have 24 hours to make your pick\n` +
        `:trophy: Best price performance wins!\n\n` +
        `*Each coin can only be picked once - first come first served!*`
      )
      .addFields(
        { name: ':clock1: Picks Close', value: `<t:${Math.floor(pickEnds.getTime() / 1000)}:R>`, inline: true },
        { name: ':racing_car: Race Ends', value: `<t:${Math.floor(raceEnds.getTime() / 1000)}:R>`, inline: true }
      )
      .setColor(0x00FF00)
      .setFooter({ text: `Started by ${interaction.user.username}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error in /gamestart:', error);
    await interaction.editReply(':x: Failed to start race. Please try again.');
  }
}

async function handlePick(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const coinQuery = interaction.options.getString('coin', true);
  const wagerAmount = interaction.options.getInteger('wager');

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

    // Find the coin
    const coin = await api.findCoin(coinQuery);

    if (!coin) {
      await interaction.editReply(`:mag: Couldn't find coin "${coinQuery}"`);
      return;
    }

    // Process wager if provided
    let wagerInfo = '';
    if (wagerAmount && wager.isEnabled()) {
      const wagerResult = await wager.placeWager(
        interaction.user.id,
        game.id,
        coin.id,
        coin.symbol || '???',
        wagerAmount
      );

      if (!wagerResult.success) {
        const errorMsg = wagerResult.error?.code === 'USER_NOT_LINKED'
          ? 'Your Discord is not linked to meme.com. Complete the Discord quest first!'
          : wagerResult.error?.code === 'INSUFFICIENT_BALANCE'
          ? `Not enough Memescore. Balance: ${wagerResult.error?.message}`
          : wagerResult.error?.message || 'Failed to place wager';
        await interaction.editReply(`:x: ${errorMsg}`);
        return;
      }
      wagerInfo = `\n:moneybag: Wagered **${wagerAmount.toLocaleString()} Memescore**`;
    }

    const result = memegame.addPick(
      game.id,
      interaction.user.id,
      interaction.user.username,
      coin.id,
      coin.name || coin.symbol || 'Unknown',
      coin.symbol || '???',
      coin.key || coin.name || coin.symbol || '',
      coin.price_now || 0,
      wagerAmount || undefined
    );

    if (!result.success) {
      await interaction.editReply(`:x: ${result.error}`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`:white_check_mark: ${interaction.user.username} picks ${coin.symbol}!`)
      .setDescription(
        `**${coin.name}** locked in at ${formatPrice(coin.price_now)}${wagerInfo}\n\n` +
        `Good luck! :four_leaf_clover:`
      )
      .setColor(0x00FF00)
      .setTimestamp();

    if (coin.coin_image_url) {
      embed.setThumbnail(coin.coin_image_url);
    }

    await interaction.editReply({ embeds: [embed] });
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

    // If racing or finished, update prices
    if (game.phase !== 'picking' && game.picks.length > 0) {
      const prices = new Map<number, number>();

      for (const pick of game.picks) {
        // Try multiple search terms: coinKey, coinName, coinSymbol
        const searchTerms = [pick.coinKey, pick.coinName, pick.coinSymbol].filter(Boolean);
        let coin = null;
        for (const term of searchTerms) {
          coin = await api.findCoin(term!, true);
          if (coin) break;
        }
        if (coin && coin.price_now !== null) {
          prices.set(pick.coinId, coin.price_now);
        }
      }

      game = memegame.updatePrices(game.id, prices) || game;

      // If finished, set winner
      if (game.phase === 'finished' && !game.winner) {
        game = memegame.setWinner(game.id) || game;
      }
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

// Race update loop - posts commentary during races
async function raceUpdateLoop() {
  try {
    const activeGames = memegame.getAllActiveGames();

    for (const game of activeGames) {
      // Update phase first
      const updated = memegame.updateGamePhase(game.id);
      if (!updated) continue;

      // Skip if still in picking phase
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

      // Skip if no picks
      if (updated.picks.length < 2) continue;

      // Update every hour (24 updates per race)
      const hoursSinceStart = (Date.now() - new Date(updated.pickEndsAt).getTime()) / (1000 * 60 * 60);
      const expectedUpdates = Math.floor(hoursSinceStart);

      if (updated.updateCount >= expectedUpdates && updated.phase === 'racing') continue;

      // Fetch current prices
      const prices = new Map<number, number>();
      for (const pick of updated.picks) {
        // Try multiple search terms
        const searchTerms = [pick.coinKey, pick.coinName, pick.coinSymbol].filter(Boolean);
        let coin = null;
        for (const term of searchTerms) {
          coin = await api.findCoin(term!, true);
          if (coin) break;
        }
        if (coin && coin.price_now !== null) {
          prices.set(pick.coinId, coin.price_now);
        }
      }

      const withPrices = memegame.updatePrices(game.id, prices);
      if (!withPrices) continue;

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

      // Check if race just ended
      if (withPrices.phase === 'finished' || new Date() >= new Date(withPrices.raceEndsAt)) {
        const finished = memegame.updateGamePhase(game.id);
        if (finished && finished.phase === 'finished') {
          memegame.setWinner(game.id);
          const final = memegame.getGame(game.id);

          if (final?.winner) {
            let payoutInfo = '';

            // Process wager payouts if enabled
            const pool = memegame.getTotalWagerPool(game.id);
            if (pool > 0 && wager.isEnabled()) {
              const results = sorted.map((p, i) => ({
                discordId: p.userId,
                rank: i + 1,
                coinSymbol: p.coinSymbol,
                percentChange: p.percentChange ?? 0,
              }));

              const payoutResult = await wager.payout(game.id, results);
              if (payoutResult.success && payoutResult.payouts?.length) {
                const winnerPayout = payoutResult.payouts[0];
                payoutInfo = `\n\n:moneybag: **${winnerPayout.amountWon.toLocaleString()} Memescore** won!`;
              }
            }

            const winEmbed = new EmbedBuilder()
              .setTitle(':trophy: RACE OVER!')
              .setDescription(
                `:crown: **${final.winner.username} WINS!**\n\n` +
                `${final.winner.coinSymbol} finished with **${final.winner.percentChange >= 0 ? '+' : ''}${final.winner.percentChange.toFixed(2)}%**${payoutInfo}\n\n` +
                `Use \`/gamestart\` to begin a new race!`
              )
              .setColor(0xFFD700)
              .setTimestamp();

            if (channel && channel.isTextBased()) {
              await (channel as any).send({ embeds: [winEmbed] });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error in race update loop:', error);
  }
}

// Event handlers
client.on('ready', () => {
  console.log(`Logged in as ${client.user?.tag}`);
  console.log(`Serving ${client.guilds.cache.size} guilds`);

  // Start race update loop - check every 30 minutes
  setInterval(raceUpdateLoop, 30 * 60 * 1000);
  console.log('Race update loop started');
});

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
