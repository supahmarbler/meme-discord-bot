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
    )
    .addIntegerOption((option) =>
      option
        .setName('wager')
        .setDescription('Memescore to wager (optional, 1000-100000)')
        .setMinValue(1000)
        .setMaxValue(100000)
    ),

  new SlashCommandBuilder()
    .setName('race')
    .setDescription('Check the current meme race standings'),

  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your linked Memescore balance'),
];
