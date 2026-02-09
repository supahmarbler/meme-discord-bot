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
];
