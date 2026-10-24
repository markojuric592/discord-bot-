const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, AuditLogEvent, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const play = require('play-dl');
const fs = require('fs');

// --- Podešavanja ---
const TOKEN = 'TVOJ_BOT_TOKEN_OVDE'; // ⚠️ ZALEPI SVOJ TOKEN!
const PREFIX = '!';

let config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
let kazne = JSON.parse(fs.readFileSync('./kazne.json', 'utf8'));

function sacuvajConfig() { fs.writeFileSync('./config.json', JSON.stringify(config, null, 2)); }
function sacuvajKazne() { fs.writeFileSync('./kazne.json', JSON.stringify(kazne, null, 2)); }

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates, // Potrebno za muziku
  ],
});

// Muzički plejer
const player = createAudioPlayer();
let trenutnaMuzika = null;

player.on(AudioPlayerStatus.Idle, () => {
  trenutnaMuzika = null;
});

player.on('error', error => {
  console.error(`Greška u plejeru: ${error.message}`);
});

function jeAdmin(member) { return member.permissions.has(PermissionsBitField.Flags.Administrator); }
function jeVlasnik(member, guild) { return member.id === guild.ownerId; }

async function posaljiLog(guild, naslov, opis, boja = 0x3498db, autor) {
  const logKanal = guild.channels.cache.find(c => c.name === 'logs' && c.isTextBased());
  if (logKanal) {
    const embed = new EmbedBuilder().setTitle(naslov).setDescription(opis).setColor(boja).setTimestamp().setFooter({ text: `Izvršio: ${autor.tag}` });
    await logKanal.send({ embeds: [embed] }).catch(() => {});
  }
}

// ==========================================
// 1. REGISTRACIJA KOMANDI (Slash)
// ==========================================
client.once('clientReady', async () => {
  console.log(`✅ Bot je spreman! Prijavljen kao ${client.user.tag}`);
  
  const komande = [
    // --- MODERACIJA (Zaključano za Admine/Modove) ---
    new SlashCommandBuilder().setName('ban').setDescription('Banuje člana').addUserOption(o => o.setName('clan').setDescription('Član').setRequired(true)).addStringOption(o => o.setName('razlog').setDescription('Razlog')).setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers),
    new SlashCommandBuilder().setName('kick').setDescription('Kickuje člana').addUserOption(o => o.setName('clan').setDescription('Član').setRequired(true)).addStringOption(o => o.setName('razlog').setDescription('Razlog')).setDefaultMemberPermissions(PermissionsBitField.Flags.KickMembers),
    new SlashCommandBuilder().setName('clear').setDescription('Briše poruke').addIntegerOption(o => o.setName('kolicina').setDescription('1-100').setRequired(true)).setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),
    new SlashCommandBuilder().setName('send').setDescription('Šalje poruku u kanal').addChannelOption(o => o.setName('kanal').setDescription('Kanal').setRequired(true)).addStringOption(o => o.setName('poruka').setDescription('Tekst').setRequired(true)).setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    
    // --- SISTEMSKE (Zaključano za Vlasnika/Admine) ---
    new SlashCommandBuilder().setName('antispam').setDescription('Uključi/isključi antispam').addStringOption(o => o.setName('stanje').setDescription('on/off').setRequired(true).addChoices({name: 'Uključi', value: 'on'}, {name: 'Isključi', value: 'off'})).setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder().setName('antinuke').setDescription('Uključi/isključi antinuke').addStringOption(o => o.setName('stanje').setDescription('on/off').setRequired(true).addChoices({name: 'Uključi', value: 'on'}, {name: 'Isključi', value: 'off'})).setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder().setName('kazna').setDescription('Dodeli kaznu (Samo vlasnik)').addUserOption(o => o.setName('clan').setDescription('Član').setRequired(true)).addIntegerOption(o => o.setName('broj').setDescription('Koliko puta !ocisti').setRequired(true)).addStringOption(o => o.setName('razlog').setDescription('Razlog')).setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder().setName('ocisti').setDescription('Skini svoju kaznu'),
    
    // --- ZAJEDNICA (Dostupno svima) ---
    new SlashCommandBuilder().setName('ping').setDescription('Proveri brzinu bota'),
    new SlashCommandBuilder().setName('avatar').setDescription('Prikaži profilnu sliku').addUserOption(o => o.setName('clan').setDescription('Član').setRequired(false)),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Informacije o serveru'),
    new SlashCommandBuilder().setName('8ball').setDescription('Postavi pitanje magičnoj kugli').addStringOption(o => o.setName('pitanje').setDescription('Tvoje pitanje').setRequired(true)),
    new SlashCommandBuilder().setName('help').setDescription('Prikaži sve komande'),

    // --- MUZIKA (Dostupno svima) ---
    new SlashCommandBuilder().setName('play').setDescription('Pušta muziku sa YouTube-a').addStringOption(o => o.setName('pesma').setDescription('Ime pesme ili link').setRequired(true)),
    new SlashCommandBuilder().setName('leave').setDescription('Bot izlazi iz glasovnog kanala'),
    new SlashCommandBuilder().setName('stop').setDescription('Zaustavlja muziku')
  ];

  try {
    await client.application.commands.set(komande);
    console.log('✅ Slash komande su uspešno registrovane!');
  } catch (error) {
    console.error('❌ Greška pri registraciji slash komandi:', error);
  }
});

// ==========================================
// 2. OBRADA INTERAKCIJA (Slash Komande)
// ==========================================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // --- MUZIKA ---
  if (commandName === 'play') {
    const pesma = interaction.options.getString('pesma');
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) return interaction.reply({ content: '❌ Moraš biti u glasovnom kanalu!', ephemeral: true });

    await interaction.deferReply();

    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      const yt_info = await play.search(pesma, { limit: 1 });
      if (!yt_info.length) return interaction.editReply('❌ Nema rezultata za tu pesmu.');

      const stream = await play.stream(yt_info[0].url);
      const resource = createAudioResource(stream.stream, { inputType: stream.type });
      
      trenutnaMuzika = yt_info[0].title;
      player.play(resource);
      connection.subscribe(player);

      await interaction.editReply(`🎶 Sada se pušta: **${yt_info[0].title}**`);
    } catch (err) {
      console.error(err);
      await interaction.editReply('❌ Došlo je do greške pri puštanju muzike.');
    }
  }

  if (commandName === 'leave' || commandName === 'stop') {
    const connection = joinVoiceChannel({ channelId: interaction.member.voice.channel?.id, guildId: interaction.guild.id, adapterCreator: interaction.guild.voiceAdapterCreator });
    if (connection) connection.destroy();
    player.stop();
    await interaction.reply('👋 Bot je izašao iz kanala / zaustavio muziku.');
  }

  // --- COMMUNITY KOMANDE ---
  if (commandName === 'ping') {
    await interaction.reply(`🏓 Pong! Kašnjenje je **${client.ws.ping}ms**.`);
  }

  if (commandName === 'avatar') {
    const user = interaction.options.getUser('clan') || interaction.user;
    const embed = new EmbedBuilder().setTitle(`Avatar od ${user.username}`).setImage(user.displayAvatarURL({ dynamic: true, size: 1024 })).setColor(0x3498db);
    await interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'serverinfo') {
    const embed = new EmbedBuilder()
      .setTitle(interaction.guild.name)
      .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
      .addFields(
        { name: '👑 Vlasnik', value: `<@${interaction.guild.ownerId}>`, inline: true },
        { name: '👥 Članovi', value: `${interaction.guild.memberCount}`, inline: true },
        { name: '📅 Napravljen', value: `<t:${Math.floor(interaction.guild.createdTimestamp / 1000)}:D>`, inline: true }
      )
      .setColor(0x2ecc71);
    await interaction.reply({ embeds: [embed] });
  }

  if (commandName === '8ball') {
    const pitanje = interaction.options.getString('pitanje');
    const odgovori = ['Da.', 'Ne.', 'Možda.', 'Apsolutno.', 'Nikako.', 'Pitaj ponovo kasnije.', 'Definitivno!', 'Ne računaj na to.'];
    const odgovor = odgovori[Math.floor(Math.random() * odgovori.length)];
    await interaction.reply(`🎱 **Pitanje:** ${pitanje}\n**Odgovor:** ${odgovor}`);
  }

  if (commandName === 'help') {
    const embed = new EmbedBuilder().setTitle('📋 Spisak komandi').setColor(0x3498db)
      .addFields(
        { name: '🎵 Muzika (Svi)', value: '`/play`, `/stop`, `/leave`' },
        { name: '🎮 Zabava (Svi)', value: '`/ping`, `/avatar`, `/serverinfo`, `/8ball`' },
        { name: '🛡️ Moderacija (Modovi)', value: '`/ban`, `/kick`, `/clear`, `/send`' },
        { name: '⚖️ Kazne i Sistem (Vlasnik/Admin)', value: '`/kazna`, `/ocisti`, `/antispam`, `/antinuke`' }
      );
    await interaction.reply({ embeds: [embed] });
  }

  // --- MODERACIJA (Isti kod kao pre) ---
  if (commandName === 'ban') {
    const clan = interaction.options.getMember('clan');
    if (!clan.bannable) return interaction.reply({ content: '❌ Ne mogu ga banovati.', ephemeral: true });
    await clan.ban({ reason: interaction.options.getString('razlog') || 'Nema razloga' });
    await interaction.reply(`🔨 **${clan.user.tag}** je banovan.`);
  }
  if (commandName === 'kick') {
    const clan = interaction.options.getMember('clan');
    if (!clan.kickable) return interaction.reply({ content: '❌ Ne mogu ga kickovati.', ephemeral: true });
    await clan.kick(interaction.options.getString('razlog') || 'Nema razloga');
    await interaction.reply(`👢 **${clan.user.tag}** je kickovan.`);
  }
  if (commandName === 'clear') {
    const kolicina = interaction.options.getInteger('kolicina');
    await interaction.channel.bulkDelete(kolicina, true);
    await interaction.reply({ content: `🧹 Obrisano **${kolicina}** poruka.`, ephemeral: true });
  }
  if (commandName === 'send') {
    const kanal = interaction.options.getChannel('kanal');
    await kanal.send(interaction.options.getString('poruka'));
    await interaction.reply({ content: `✅ Poslato u ${kanal}.`, ephemeral: true });
  }

  // --- KAZNE I SISTEM (Isti kod kao pre) ---
  if (commandName === 'antispam' || commandName === 'antinuke') {
    config[commandName] = (interaction.options.getString('stanje') === 'on');
    sacuvajConfig();
    await interaction.reply(`🛡️ ${commandName} je sada **${config[commandName] ? 'UKLJUČEN' : 'ISKLJUČEN'}**.`);
  }
  if (commandName === 'kazna') {
    if (!jeVlasnik(interaction.member, interaction.guild)) return interaction.reply({ content: '❌ Samo vlasnik!', ephemeral: true });
    const clan = interaction.options.getMember('clan');
    const broj = interaction.options.getInteger('broj');
    const uloga = interaction.guild.roles.cache.get(config.kaznaRoleId);
    await clan.roles.add(uloga);
    kazne[clan.id] = { preostalo: broj, ukupno: broj, razlog: interaction.options.getString('razlog') || 'Nema', vreme: new Date().toISOString() };
    sacuvajKazne();
    await interaction.reply(`⚖️ **${clan.user.tag}** dobio kaznu. Mora poslati \`!ocisti\` **${broj}** puta u <#${config.kaznaKanalId}>.`);
  }
  if (commandName === 'ocisti') {
    const userId = interaction.user.id;
    if (!kazne[userId]) return interaction.reply({ content: '❌ Nemaš kaznu.', ephemeral: true });
    kazne[userId].preostalo -= 1;
    if (kazne[userId].preostalo <= 0) {
      await interaction.member.roles.remove(interaction.guild.roles.cache.get(config.kaznaRoleId)).catch(()=>{});
      delete kazne[userId];
      sacuvajKazne();
      await interaction.reply(`✅ **${interaction.user}** je skinuo kaznu!`);
    } else {
      sacuvajKazne();
      await interaction.reply(`📝 Još **${kazne[userId].preostalo}** puta.`);
    }
  }
});

// ==========================================
// 3. PREFIX KOMANDE (!) + ANTISPAM
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  if (config.antispam) {
    if (!global.spamMap) global.spamMap = new Map();
    const sada = Date.now();
    let timestamps = global.spamMap.get(message.author.id) || [];
    timestamps = timestamps.filter(t => sada - t < 5000);
    timestamps.push(sada);
    global.spamMap.set(message.author.id, timestamps);

    if (timestamps.length > 5) {
      try {
        await message.member.timeout(60000, 'Antispam');
        message.channel.send(`🚫 ${message.author} je muted na 1 minut zbog spama.`).then(m => setTimeout(() => m.delete(), 5000));
      } catch (err) {}
      global.spamMap.set(message.author.id, []);
    }
  }

  if (!message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const komanda = args.shift().toLowerCase();

  // Ovde su ostale tvoje ! komande (radi kompatibilnosti)
  if (komanda === 'ping') return message.reply('🏓 Pong!');
});

// ==========================================
// 4. DOBRODOŠLICA + AUTOROLA
// ==========================================
client.on('guildMemberAdd', async (member) => {
  if (config.autoRoleId && config.autoRoleId !== "ID_ULOGE_MEMBER") {
    try {
      const uloga = member.guild.roles.cache.get(config.autoRoleId);
      if (uloga) await member.roles.add(uloga);
    } catch (err) {}
  }

  if (!config.welcomeKanalId || config.welcomeKanalId === "ID_KANALA_DOBRODOSLI") return;
  const kanal = member.guild.channels.cache.get(config.welcomeKanalId);
  if (!kanal) return;

  const welcomeEmbed = new EmbedBuilder()
    .setTitle(`🎉 Dobrodošao/la na ${member.guild.name}!`)
    .setDescription(`Hej ${member}, drago nam je što si postao/la deo naše zajednice!\n\nPročitaj pravila u <#TVOJ_ID_KANALA_PRAVILA>.`)
    .setColor(0x2ecc71)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields({ name: '👥 Član broj', value: `**#${member.guild.memberCount}**`, inline: true })
    .setTimestamp();

  kanal.send({ content: `Pozdrav ${member}! 👋`, embeds: [welcomeEmbed] }).catch(()=>{});
});

// ==========================================
// 5. ANTINUKE
// ==========================================
client.on('channelDelete', async (channel) => {
  if (!config.antinuke || !channel.guild) return;
  try {
    const logs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete });
    const entry = logs.entries.first();
    if (entry && entry.executor && entry.executor.id !== client.user.id && entry.executor.id !== channel.guild.ownerId) {
      const clan = await channel.guild.members.fetch(entry.executor.id).catch(() => null);
      if (clan && clan.bannable) await clan.ban({ reason: 'Antinuke: brisanje kanala' });
    }
  } catch (err) {}
});

client.login(TOKEN);