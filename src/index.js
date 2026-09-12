require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const port = Number(process.env.PORT || 10000);
if (!token || !clientId) throw new Error('DISCORD_TOKEN and CLIENT_ID are required');

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true, service: 'chythe-moderation-bot', discordReady: !!client.user }));
app.listen(port, '0.0.0.0', () => console.log(`Health server listening on ${port}`));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commands = [
  new SlashCommandBuilder().setName('setup').setDescription('Open the moderation setup panel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('purge').setDescription('Safely bulk-delete recent messages').addIntegerOption(o => o.setName('amount').setDescription('1-100 messages').setMinValue(1).setMaxValue(100).setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
].map(c => c.toJSON());

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
      const embed = new EmbedBuilder().setTitle('Chythe Moderation').setDescription('Use the controls below to check bot status and required permissions.').setColor(0x5865f2);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('status').setLabel('Status').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('permissions').setLabel('Permissions').setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'purge') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: 'You need Manage Messages.', ephemeral: true });
      if (!interaction.channel?.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: 'I need Manage Messages in this channel.', ephemeral: true });
      const amount = interaction.options.getInteger('amount', true);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`purge_confirm:${amount}:${interaction.user.id}`).setLabel(`Delete ${amount}`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`purge_cancel:${interaction.user.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({ content: `Confirm deletion of up to **${amount} recent messages**.`, components: [row], ephemeral: true });
    }

    if (!interaction.isButton()) return;
    const parts = interaction.customId.split(':');
    if (parts[parts.length - 1] !== interaction.user.id) return interaction.reply({ content: 'This control belongs to the moderator who opened it.', ephemeral: true });

    if (parts[0] === 'status') return interaction.reply({ content: `Online: ${client.ws.status === 0 ? 'yes' : 'no'}\nGuilds: ${client.guilds.cache.size}`, ephemeral: true });
    if (parts[0] === 'permissions') return interaction.reply({ content: 'Required: Manage Server for /setup; Manage Messages for /purge.', ephemeral: true });
    if (parts[0] === 'purge_cancel') return interaction.update({ content: 'Cancelled.', components: [] });
    if (parts[0] === 'purge_confirm') {
      const amount = Number(parts[1]);
      const deleted = await interaction.channel.bulkDelete(amount, true);
      return interaction.update({ content: `Deleted ${deleted.size} recent message(s). Older than 14 days are not bulk-deletable.`, components: [] });
    }
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'Something went wrong while handling that action.', ephemeral: true }).catch(() => {});
    else await interaction.reply({ content: 'Something went wrong while handling that action.', ephemeral: true }).catch(() => {});
  }
});

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);
client.login(token);
