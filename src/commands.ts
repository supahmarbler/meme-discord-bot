import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('meme')
    .setDescription('Get price and stats for a memecoin')
    .addStringOption((option) =>
      option
        .setName('coin')
        .setDescription('Coin name or symbol (e.g., PEPE, DOGE, GIGA)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('hotpredictions')
    .setDescription('Show the hottest prediction markets by trading activity'),

  new SlashCommandBuilder()
    .setName('battle')
    .setDescription('Battle two memecoins against each other!')
    .addStringOption((option) =>
      option
        .setName('coin1')
        .setDescription('First coin (e.g., PEPE)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('coin2')
        .setDescription('Second coin (e.g., DOGE)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('champion')
    .setDescription('Find the top 5 memecoins based on battle metrics'),

  new SlashCommandBuilder()
    .setName('xbattle')
    .setDescription('Battle two X/Twitter accounts by their top tweet likes!')
    .addStringOption((option) =>
      option
        .setName('account1')
        .setDescription('First X account (e.g., @pepecoin)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('account2')
        .setDescription('Second X account (e.g., @dogecoin)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('xstart')
    .setDescription('Link an X battle to a meme.com prediction market!')
    .addStringOption((option) =>
      option
        .setName('market')
        .setDescription('Prediction market title to search for')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('account1')
        .setDescription('First X account (e.g., @pepecoin)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('account2')
        .setDescription('Second X account (e.g., @dogecoin)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('xstatus')
    .setDescription('Check status of active X battle prediction markets'),

  new SlashCommandBuilder()
    .setName('gamestart')
    .setDescription('Start a 24h meme race! Pick coins and compete for best gains'),

  new SlashCommandBuilder()
    .setName('pick')
    .setDescription('Pick your memecoin for the race!')
    .addStringOption((option) =>
      option
        .setName('coin')
        .setDescription('The memecoin you want to race with')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('race')
    .setDescription('Check the current meme race standings'),

  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your linked Memescore balance'),

  new SlashCommandBuilder()
    .setName('tip')
    .setDescription('Tip memescore to another user')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('User to tip')
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Amount to tip')
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName('trends')
    .setDescription('Discover trending memes via Google Trends'),

  new SlashCommandBuilder()
    .setName('trendstatus')
    .setDescription('Check the active trends battle scores'),

  new SlashCommandBuilder()
    .setName('createmarket')
    .setDescription('Create a Trends battle market (team channels only)')
    .addStringOption((option) =>
      option
        .setName('meme_a')
        .setDescription('First meme (e.g. Gigachad)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('meme_b')
        .setDescription('Second meme (e.g. Wojak)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('createprediction')
    .setDescription('Create a custom YES/NO prediction market (team channels only)')
    .addStringOption((option) =>
      option
        .setName('title')
        .setDescription('Market question (e.g. "Will BTC hit 100k by June?")')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('image_url')
        .setDescription('Image URL for the market card')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('end_date')
        .setDescription('End date: ISO (2026-03-15) or relative (3d, 7d, 2w)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('description')
        .setDescription('Optional description for the market')
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('liquidity')
        .setDescription('Base liquidity (default: 100000)')
        .setRequired(false)
        .setMinValue(1000)
    )
    .addStringOption((option) =>
      option
        .setName('label_yes')
        .setDescription('Custom YES label (default: YES)')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('label_no')
        .setDescription('Custom NO label (default: NO)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('resolveprediction')
    .setDescription('Resolve a custom prediction market (team channels only)')
    .addStringOption((option) =>
      option
        .setName('market_id')
        .setDescription('Market ID (e.g. CUSTOM-will-btc-hit-100k-1)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('outcome')
        .setDescription('Market outcome')
        .setRequired(true)
        .addChoices(
          { name: 'YES', value: 'YES' },
          { name: 'NO', value: 'NO' },
        )
    ),

  new SlashCommandBuilder()
    .setName('analytics')
    .setDescription('Get wiki analytics digest or pipeline health')
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Type of report')
        .setRequired(false)
        .addChoices(
          { name: 'Weekly Digest', value: 'digest' },
          { name: 'Daily Health', value: 'health' },
        )
    ),
];
