import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import { commands } from './commands';

config();

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID in .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function registerCommands() {
  try {
    console.log('Started refreshing application (/) commands...');

    const commandsJson = commands.map((cmd) => cmd.toJSON());

    if (guildId) {
      // Register to specific guild (instant, good for testing)
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commandsJson,
      });
      console.log(`Successfully registered ${commands.length} commands to guild ${guildId}`);
    } else {
      // Register globally (takes up to 1 hour to propagate)
      await rest.put(Routes.applicationCommands(clientId), {
        body: commandsJson,
      });
      console.log(`Successfully registered ${commands.length} commands globally`);
      console.log('Note: Global commands can take up to 1 hour to appear everywhere');
    }
  } catch (error) {
    console.error('Error registering commands:', error);
    process.exit(1);
  }
}

registerCommands();
