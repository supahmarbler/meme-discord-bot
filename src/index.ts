import { Client, GatewayIntentBits, EmbedBuilder, ChatInputCommandInteraction, AttachmentBuilder } from 'discord.js';
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

// LMSR probability calculation (same as meme.com)
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
    assignRankPoints(byMcap, 1);        // MCap: 1x weight
    assignRankPoints(byDiamond, 1);     // Diamond Rating: 1x weight

    // Sort by total points
    const ranked = scored
      .map(s => ({ ...s, totalPoints: points.get(s.coin.id) ?? 0 }))
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, 3);

    const medals = [':first_place:', ':second_place:', ':third_place:'];

    const lines = ranked.map((r, i) => {
      const coin = r.coin;
      const momentum = r.momentum24h !== -Infinity ? `${r.momentum24h >= 0 ? '+' : ''}${r.momentum24h.toFixed(1)}%` : 'N/A';
      const trend = r.trend7d !== -Infinity ? `${r.trend7d >= 0 ? '+' : ''}${r.trend7d.toFixed(1)}%` : 'N/A';
      const mcap = formatMarketCap(r.marketCap);

      return `${medals[i]} **${coin.name}** (${coin.symbol})\n24h: ${momentum} | 7d: ${trend} | MCap: ${mcap}\nBattle Score: ${r.totalPoints} pts`;
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

// Event handlers
client.on('ready', () => {
  console.log(`Logged in as ${client.user?.tag}`);
  console.log(`Serving ${client.guilds.cache.size} guilds`);
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
