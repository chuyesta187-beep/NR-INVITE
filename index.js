require("dotenv").config();

const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionsBitField,
    ChannelType,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    SlashCommandBuilder,
    REST,
    Routes
} = require("discord.js");

// ============================================================
// NR INVITE
// Sistema de invitaciones + soporte
// SIN DASHBOARD
// SIN EXPRESS
// SIN SQLITE
// ============================================================

// ============================================================
// VARIABLES DE ENTORNO
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

const SUPPORT_SERVER_ID =
    process.env.SUPPORT_SERVER_ID || "";

const SUPPORT_INVITE =
    process.env.SUPPORT_INVITE ||
    "https://discord.gg/PZw45tHPfc";

const SUPPORT_REPORT_CHANNEL_ID =
    process.env.SUPPORT_REPORT_CHANNEL_ID || "";

const SUPPORT_REVIEW_CHANNEL_ID =
    process.env.SUPPORT_REVIEW_CHANNEL_ID || "";

const SMTP_HOST =
    process.env.SMTP_HOST || "";

const SMTP_PORT =
    Number(process.env.SMTP_PORT) || 465;

const SMTP_USER =
    process.env.SMTP_USER || "";

const SMTP_PASS =
    process.env.SMTP_PASS || "";

const REPORT_EMAIL =
    process.env.REPORT_EMAIL || "";

if (!TOKEN) {
    console.error("❌ Falta DISCORD_TOKEN.");
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error("❌ Falta DISCORD_CLIENT_ID.");
    process.exit(1);
}

// ============================================================
// CONFIG/BOT.JSON
// ============================================================

const CONFIG_DIR = path.join(
    __dirname,
    "config"
);

const CONFIG_FILE = path.join(
    CONFIG_DIR,
    "bot.json"
);

if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(
        CONFIG_DIR,
        {
            recursive: true
        }
    );
}

if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(
        CONFIG_FILE,
        JSON.stringify(
            {
                guilds: {}
            },
            null,
            4
        ),
        "utf8"
    );
}

function loadConfig() {
    try {
        const content =
            fs.readFileSync(
                CONFIG_FILE,
                "utf8"
            );

        if (!content.trim()) {
            return {
                guilds: {}
            };
        }

        const data =
            JSON.parse(content);

        if (!data.guilds) {
            data.guilds = {};
        }

        return data;
    } catch (error) {
        console.error(
            "❌ Error leyendo config/bot.json:",
            error.message
        );

        return {
            guilds: {}
        };
    }
}

let config = loadConfig();

function saveConfig() {
    try {
        fs.writeFileSync(
            CONFIG_FILE,
            JSON.stringify(
                config,
                null,
                4
            ),
            "utf8"
        );
    } catch (error) {
        console.error(
            "❌ Error guardando config/bot.json:",
            error.message
        );
    }
}

function createDefaultGuildConfig() {
    return {
        announcements: {
            enabled: true,
            channelId: null
        },

        welcome: {
            enabled: true
        },

        logs: {
            enabled: false,
            channelId: null
        },

        reports: {
            enabled: true,
            channelId: null
        },

        invites: {
            enabled: true
        },

        ranking: {
            enabled: true
        },

        language: "es",

        cooldown: 7200,

        roles: [],

        messages: {
            welcome:
                "## ¡Hola! 👋 Soy NR INVITE.\n\n" +
                "*Gracias por añadirme a tu servidor.*\n\n" +
                "**Puedes configurar el sistema de invitaciones con:**\n\n" +
                "__/setup invite__\n\n" +
                "**Si necesitas ayuda o quieres conocer todas mis funciones, entra a mi servidor de soporte:**\n\n" +
                "## [Únete](https://discord.gg/PZw45tHPfc)\n\n" +
                "**¡Gracias por usar NR INVITE! ❤️**"
        },

        stats: {
            joins: 0,
            leaves: 0,
            reports: 0,
            reviews: 0
        }
    };
}

function getGuildConfig(guildId) {
    if (!config.guilds[guildId]) {
        config.guilds[guildId] =
            createDefaultGuildConfig();

        saveConfig();
    }

    return config.guilds[guildId];
}

// ============================================================
// CLIENT
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMessages
    ],

    partials: [
        Partials.Channel,
        Partials.GuildMember
    ]
});

// ============================================================
// INVITE CACHE
// ============================================================

const inviteCache =
    new Map();

const inviteStats =
    new Map();

function getUserInviteStats(
    guildId,
    userId
) {
    if (!inviteStats.has(guildId)) {
        inviteStats.set(
            guildId,
            new Map()
        );
    }

    const guildStats =
        inviteStats.get(
            guildId
        );

    if (!guildStats.has(userId)) {
        guildStats.set(
            userId,
            {
                total: 0,
                active: 0,
                left: 0,
                fake: 0,
                invited: []
            }
        );
    }

    return guildStats.get(
        userId
    );
}

async function cacheGuildInvites(
    guild
) {
    try {
        const invites =
            await guild.invites.fetch();

        const map =
            new Map();

        for (
            const invite
            of invites.values()
        ) {
            map.set(
                invite.code,
                {
                    uses:
                        invite.uses || 0,

                    inviterId:
                        invite.inviter?.id ||
                        null,

                    temporary:
                        invite.temporary ||
                        false
                }
            );
        }

        inviteCache.set(
            guild.id,
            map
        );

        return map;
    } catch (error) {
        console.error(
            `❌ No se pudieron cargar invites de ${guild.name}:`,
            error.message
        );

        return new Map();
    }
}

async function detectInvite(
    guild
) {
    try {
        const previous =
            inviteCache.get(
                guild.id
            ) || new Map();

        const current =
            await guild.invites.fetch();

        let usedInvite = null;

        for (
            const invite
            of current.values()
        ) {
            const old =
                previous.get(
                    invite.code
                );

            const oldUses =
                old?.uses || 0;

            const newUses =
                invite.uses || 0;

            if (newUses > oldUses) {
                usedInvite =
                    invite;

                break;
            }
        }

        const updated =
            new Map();

        for (
            const invite
            of current.values()
        ) {
            updated.set(
                invite.code,
                {
                    uses:
                        invite.uses || 0,

                    inviterId:
                        invite.inviter?.id ||
                        null,

                    temporary:
                        invite.temporary ||
                        false
                }
            );
        }

        inviteCache.set(
            guild.id,
            updated
        );

        return usedInvite;
    } catch (error) {
        console.error(
            "❌ Error detectando invitación:",
            error.message
        );

        return null;
    }
}

// ============================================================
// LOGS
// ============================================================

async function sendGuildLog(
    guild,
    content
) {
    try {
        const cfg =
            getGuildConfig(
                guild.id
            );

        if (
            !cfg.logs.enabled ||
            !cfg.logs.channelId
        ) {
            return;
        }

        const channel =
            guild.channels.cache.get(
                cfg.logs.channelId
            );

        if (!channel) return;

        const permissions =
            channel.permissionsFor(
                guild.members.me
            );

        if (
            !permissions?.has(
                PermissionsBitField.Flags.SendMessages
            )
        ) {
            return;
        }

        await channel.send({
            content
        });
    } catch (error) {
        console.error(
            "❌ Error enviando log:",
            error.message
        );
    }
}

// ============================================================
// SMTP
// ============================================================

let mailer = null;

if (
    SMTP_HOST &&
    SMTP_USER &&
    SMTP_PASS
) {
    mailer =
        nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure:
                SMTP_PORT === 465,

            auth: {
                user:
                    SMTP_USER,

                pass:
                    SMTP_PASS
            }
        });
}

async function sendEmail({
    subject,
    text
}) {
    if (
        !mailer ||
        !REPORT_EMAIL
    ) {
        return false;
    }

    try {
        await mailer.sendMail({
            from:
                SMTP_USER,

            to:
                REPORT_EMAIL,

            subject,
            text
        });

        return true;
    } catch (error) {
        console.error(
            "❌ Error enviando correo:",
            error.message
        );

        return false;
    }
}

// ============================================================
// CANAL PÚBLICO PARA BIENVENIDA
// ============================================================

function findFirstPublicTextChannel(
    guild
) {
    const me =
        guild.members.me;

    if (!me) {
        return null;
    }

    const channels =
        [...guild.channels.cache.values()]
            .filter(
                channel =>
                    channel.type ===
                    ChannelType.GuildText
            )
            .sort(
                (a, b) =>
                    a.position -
                    b.position
            );

    for (
        const channel
        of channels
    ) {
        const permissions =
            channel.permissionsFor(
                me
            );

        if (
            permissions?.has(
                PermissionsBitField.Flags.ViewChannel
            ) &&
            permissions?.has(
                PermissionsBitField.Flags.SendMessages
            )
        ) {
            return channel;
        }
    }

    return null;
}

// ============================================================
// COMANDOS
// ============================================================

const commands = [

    new SlashCommandBuilder()
        .setName("setup")
        .setDescription(
            "Configura NR INVITE"
        )
        .addSubcommand(
            sub =>
                sub
                    .setName("invite")
                    .setDescription(
                        "Configura el sistema de invitaciones"
                    )
        ),

    new SlashCommandBuilder()
        .setName("invites")
        .setDescription(
            "Muestra las invitaciones de un usuario"
        )
        .addUserOption(
            option =>
                option
                    .setName("usuario")
                    .setDescription(
                        "Usuario"
                    )
                    .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("active")
        .setDescription(
            "Muestra invitaciones activas"
        )
        .addSubcommand(
            sub =>
                sub
                    .setName("invites")
                    .setDescription(
                        "Muestra tus invitaciones activas"
                    )
        ),

    new SlashCommandBuilder()
        .setName("leaderboard")
        .setDescription(
            "Muestra el ranking de invitaciones"
        ),

    new SlashCommandBuilder()
        .setName("stats")
        .setDescription(
            "Muestra estadísticas"
        ),

    new SlashCommandBuilder()
        .setName("reporte")
        .setDescription(
            "Envía un reporte"
        )
        .addStringOption(
            option =>
                option
                    .setName("tipo")
                    .setDescription(
                        "Tipo de reporte"
                    )
                    .setRequired(true)
                    .addChoices(
                        {
                            name:
                                "🐛 Bug",
                            value:
                                "Bug"
                        },
                        {
                            name:
                                "🚨 Usuario",
                            value:
                                "Usuario"
                        },
                        {
                            name:
                                "🤖 Bot",
                            value:
                                "Bot"
                        },
                        {
                            name:
                                "🔒 Seguridad",
                            value:
                                "Seguridad"
                        },
                        {
                            name:
                                "💡 Sugerencia",
                            value:
                                "Sugerencia"
                        },
                        {
                            name:
                                "📩 Otro",
                            value:
                                "Otro"
                        }
                    )
        )
        .addStringOption(
            option =>
                option
                    .setName("descripcion")
                    .setDescription(
                        "Describe el problema"
                    )
                    .setRequired(true)
                    .setMaxLength(
                        1500
                    )
        ),

    new SlashCommandBuilder()
        .setName("anuncio")
        .setDescription(
            "Publica un anuncio de NR INVITE"
        )
        .addStringOption(
            option =>
                option
                    .setName("titulo")
                    .setDescription(
                        "Título del anuncio"
                    )
                    .setRequired(true)
                    .setMaxLength(
                        256
                    )
        )
        .addStringOption(
            option =>
                option
                    .setName("descripcion")
                    .setDescription(
                        "Contenido del anuncio"
                    )
                    .setRequired(true)
                    .setMaxLength(
                        4000
                    )
        ),

    new SlashCommandBuilder()
        .setName("help")
        .setDescription(
            "Muestra los comandos"
        )

].map(
    command =>
        command.toJSON()
);

// ============================================================
// REGISTRO DE COMANDOS
// ============================================================

async function registerCommands() {
    try {
        const rest =
            new REST({
                version: "10"
            }).setToken(
                TOKEN
            );

        await rest.put(
            Routes.applicationCommands(
                CLIENT_ID
            ),
            {
                body:
                    commands
            }
        );

        console.log(
            "✅ Comandos registrados."
        );
    } catch (error) {
        console.error(
            "❌ Error registrando comandos:",
            error.message
        );
    }
}

// ============================================================
// READY
// ============================================================

client.once(
    "ready",
    async () => {

        console.log(
            `✅ NR INVITE conectado como ${client.user.tag}`
        );

        console.log(
            `🌐 Servidores: ${client.guilds.cache.size}`
        );

        client.user.setPresence({
            status: "dnd",

            activities: [
                {
                    name:
                        "Más de 10 bots en funcionamiento | /help",

                    type: 4
                }
            ]
        });

        for (
            const guild
            of client.guilds.cache.values()
        ) {
            await cacheGuildInvites(
                guild
            );
        }

        await registerCommands();
    }
);

// ============================================================
// ENTRADA A SERVIDOR
// ============================================================

client.on(
    "guildCreate",
    async guild => {

        console.log(
            `➕ NR INVITE entró a ${guild.name}`
        );

        getGuildConfig(
            guild.id
        );

        await cacheGuildInvites(
            guild
        );

        const channel =
            findFirstPublicTextChannel(
                guild
            );

        if (!channel) {
            console.log(
                `⚠️ No hay canal público disponible en ${guild.name}.`
            );

            return;
        }

        try {
            await channel.send({
                content:
                    getGuildConfig(
                        guild.id
                    ).messages.welcome
            });

            await channel.send({
                content:
                    `📢 **Configuración inicial**

Para configurar NR INVITE en este servidor utiliza:

__/setup invite__

También puedes visitar nuestro servidor de soporte:

${SUPPORT_INVITE}`
            });

            console.log(
                `✅ Mensajes de entrada enviados en ${guild.name}.`
            );
        } catch (error) {
            console.error(
                "❌ No pude enviar los mensajes:",
                error.message
            );
        }
    }
);

// ============================================================
// NUEVO MIEMBRO
// ============================================================

client.on(
    "guildMemberAdd",
    async member => {

        const guild =
            member.guild;

        const cfg =
            getGuildConfig(
                guild.id
            );

        cfg.stats.joins++;

        saveConfig();

        const invite =
            await detectInvite(
                guild
            );

        if (
            invite &&
            invite.inviter
        ) {
            const stats =
                getUserInviteStats(
                    guild.id,
                    invite.inviter.id
                );

            stats.total++;
            stats.active++;

            if (
                !stats.invited.includes(
                    member.id
                )
            ) {
                stats.invited.push(
                    member.id
                );
            }

            await sendGuildLog(
                guild,
                `➕ **Nueva invitación**

👤 Usuario: ${member.user.tag}
👑 Invitador: ${invite.inviter.tag}
🔗 Código: \`${invite.code}\`
📊 Usos: ${invite.uses || 0}`
            );
        } else {
            await sendGuildLog(
                guild,
                `➕ **Nuevo miembro**

👤 ${member.user.tag}
🆔 ${member.id}

⚠️ No se pudo detectar la invitación.`
            );
        }
    }
);

// ============================================================
// MIEMBRO SALE
// ============================================================

client.on(
    "guildMemberRemove",
    async member => {

        const guild =
            member.guild;

        const cfg =
            getGuildConfig(
                guild.id
            );

        cfg.stats.leaves++;

        saveConfig();

        const guildStats =
            inviteStats.get(
                guild.id
            );

        let inviterId = null;

        if (guildStats) {
            for (
                const [
                    userId,
                    stats
                ]
                of guildStats
            ) {
                const index =
                    stats.invited.indexOf(
                        member.id
                    );

                if (index !== -1) {
                    stats.invited.splice(
                        index,
                        1
                    );

                    if (
                        stats.active > 0
                    ) {
                        stats.active--;
                    }

                    stats.left++;

                    inviterId =
                        userId;

                    break;
                }
            }
        }

        await sendGuildLog(
            guild,
            `📤 **Miembro salió**

👤 ${member.user?.tag || member.id}

👑 Invitador:
${
    inviterId
        ? `<@${inviterId}>`
        : "Desconocido"
}`
        );
    }
);

// ============================================================
// INVITE CREATE
// ============================================================

client.on(
    "inviteCreate",
    async invite => {

        if (
            invite.guild
        ) {
            await cacheGuildInvites(
                invite.guild
            );
        }
    }
);

// ============================================================
// INVITE DELETE
// ============================================================

client.on(
    "inviteDelete",
    async invite => {

        if (
            invite.guild
        ) {
            await cacheGuildInvites(
                invite.guild
            );
        }
    }
);

// ============================================================
// INTERACCIONES
// ============================================================

client.on(
    "interactionCreate",
    async interaction => {

        try {

            // =================================================
            // SELECT MENU DEL ANUNCIO
            // =================================================

            if (
                interaction.isStringSelectMenu()
            ) {

                if (
                    interaction.customId !==
                    "nr_anuncio_menu"
                ) {
                    return;
                }

                const value =
                    interaction.values[0];

                // ---------------------------------------------
                // VALORAR
                // ---------------------------------------------

                if (
                    value ===
                    "valorar"
                ) {

                    const menu =
                        new StringSelectMenuBuilder()
                            .setCustomId(
                                "nr_valoracion"
                            )
                            .setPlaceholder(
                                "Selecciona una valoración"
                            )
                            .addOptions(
                                new StringSelectMenuOptionBuilder()
                                    .setLabel(
                                        "1 estrella"
                                    )
                                    .setDescription(
                                        "⭐"
                                    )
                                    .setValue(
                                        "1"
                                    ),

                                new StringSelectMenuOptionBuilder()
                                    .setLabel(
                                        "2 estrellas"
                                    )
                                    .setDescription(
                                        "⭐⭐"
                                    )
                                    .setValue(
                                        "2"
                                    ),

                                new StringSelectMenuOptionBuilder()
                                    .setLabel(
                                        "3 estrellas"
                                    )
                                    .setDescription(
                                        "⭐⭐⭐"
                                    )
                                    .setValue(
                                        "3"
                                    ),

                                new StringSelectMenuOptionBuilder()
                                    .setLabel(
                                        "4 estrellas"
                                    )
                                    .setDescription(
                                        "⭐⭐⭐⭐"
                                    )
                                    .setValue(
                                        "4"
                                    ),

                                new StringSelectMenuOptionBuilder()
                                    .setLabel(
                                        "5 estrellas"
                                    )
                                    .setDescription(
                                        "⭐⭐⭐⭐⭐"
                                    )
                                    .setValue(
                                        "5"
                                    )
                            );

                    return interaction.reply({
                        content:
                            "⭐ Selecciona tu valoración:",

                        components: [
                            new ActionRowBuilder()
                                .addComponents(
                                    menu
                                )
                        ],

                        ephemeral: true
                    });
                }

                // ---------------------------------------------
                // RESEÑA
                // ---------------------------------------------

                if (
                    value ===
                    "resena"
                ) {

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                "nr_resena_modal"
                            )
                            .setTitle(
                                "📝 Escribe tu reseña"
                            );

                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                "resena"
                            )
                            .setLabel(
                                "Tu reseña"
                            )
                            .setStyle(
                                TextInputStyle.Paragraph
                            )
                            .setPlaceholder(
                                "Cuéntanos qué opinas de NR INVITE..."
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(
                                1000
                            );

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(
                                input
                            )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                // ---------------------------------------------
                // REPORTAR
                // ---------------------------------------------

                if (
                    value ===
                    "reportar"
                ) {

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                "nr_report_modal"
                            )
                            .setTitle(
                                "🐛 Reportar un problema"
                            );

                    const titleInput =
                        new TextInputBuilder()
                            .setCustomId(
                                "titulo"
                            )
                            .setLabel(
                                "Título del problema"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(
                                100
                            );

                    const descriptionInput =
                        new TextInputBuilder()
                            .setCustomId(
                                "descripcion"
                            )
                            .setLabel(
                                "Describe el problema"
                            )
                            .setStyle(
                                TextInputStyle.Paragraph
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(
                                1500
                            );

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(
                                titleInput
                            ),

                        new ActionRowBuilder()
                            .addComponents(
                                descriptionInput
                            )
                    );

                    return interaction.showModal(
                        modal
                    );
                }
            }

            // =================================================
            // VALORACIÓN
            // =================================================

            if (
                interaction.isStringSelectMenu() &&
                interaction.customId ===
                    "nr_valoracion"
            ) {

                const stars =
                    interaction.values[0];

                if (
                    interaction.guild
                ) {
                    const cfg =
                        getGuildConfig(
                            interaction.guild.id
                        );

                    cfg.stats.reviews++;

                    saveConfig();
                }

                const channel =
                    interaction.client.channels.cache.get(
                        SUPPORT_REVIEW_CHANNEL_ID
                    );

                if (channel) {

                    await channel.send({
                        content:
                            `⭐ **Nueva valoración**

👤 Usuario: ${interaction.user}
⭐ Valoración: **${stars}/5**
🆔 ID: ${interaction.user.id}`
                    });
                }

                return interaction.update({
                    content:
                        `✅ Gracias por valorar NR INVITE con **${stars}/5 ⭐**.`,
                    components: []
                });
            }

            // =================================================
            // MODALES
            // =================================================

            if (
                interaction.isModalSubmit()
            ) {

                // ---------------------------------------------
                // RESEÑA
                // ---------------------------------------------

                if (
                    interaction.customId ===
                    "nr_resena_modal"
                ) {

                    const review =
                        interaction.fields.getTextInputValue(
                            "resena"
                        );

                    const channel =
                        interaction.client.channels.cache.get(
                            SUPPORT_REVIEW_CHANNEL_ID
                        );

                    if (channel) {

                        await channel.send({
                            content:
                                `📝 **Nueva reseña**

👤 Usuario: ${interaction.user}
🆔 ID: ${interaction.user.id}

**Reseña:**
${review}`
                        });
                    }

                    return interaction.reply({
                        content:
                            "✅ Tu reseña fue enviada correctamente. ¡Gracias! ❤️",
                        ephemeral: true
                    });
                }

                // ---------------------------------------------
                // REPORTE DESDE ANUNCIO
                // ---------------------------------------------

                if (
                    interaction.customId ===
                    "nr_report_modal"
                ) {

                    const title =
                        interaction.fields.getTextInputValue(
                            "titulo"
                        );

                    const description =
                        interaction.fields.getTextInputValue(
                            "descripcion"
                        );

                    const reportId =
                        `NR-BUG-${String(
                            Date.now()
                        ).slice(-6)}`;

                    const date =
                        new Date().toLocaleString(
                            "es-CO",
                            {
                                timeZone:
                                    "America/Bogota"
                            }
                        );

                    let guildName =
                        interaction.guild?.name ||
                        "Servidor desconocido";

                    let guildId =
                        interaction.guild?.id ||
                        "Desconocido";

                    const reportText =
`NR INVITE - REPORTE DE BUG

Reporte: ${reportId}

Título:
${title}

Descripción:
${description}

Usuario:
${interaction.user.tag}

ID:
${interaction.user.id}

Servidor:
${guildName}

ID del servidor:
${guildId}

Fecha:
${date}
`;

                    const reportChannel =
                        interaction.client.channels.cache.get(
                            SUPPORT_REPORT_CHANNEL_ID
                        );

                    if (
                        reportChannel
                    ) {
                        await reportChannel.send({
                            content:
                                `# 🐛 NUEVO REPORTE

**ID:** \`${reportId}\`

**Título:**
${title}

**Descripción:**
${description}

**Usuario:** ${interaction.user}
**ID:** \`${interaction.user.id}\`

**Servidor:** ${guildName}
**ID:** \`${guildId}\`

**Fecha:** ${date}`
                        });
                    }

                    const emailSent =
                        await sendEmail({
                            subject:
                                `NR INVITE | ${reportId} | ${title}`,

                            text:
                                reportText
                        });

                    return interaction.reply({
                        content:
`✅ **Reporte enviado correctamente.**

ID del reporte:
\`${reportId}\`

${emailSent
    ? "📧 También fue enviado por correo."
    : "📧 El correo no está configurado actualmente."}

Gracias por ayudar a mejorar NR INVITE. ❤️`,

                        ephemeral: true
                    });
                }
            }

            // =================================================
            // COMANDOS SLASH
            // =================================================

            if (
                !interaction.isChatInputCommand()
            ) {
                return;
            }

            const command =
                interaction.commandName;

            const guild =
                interaction.guild;

            // =================================================
            // HELP
            // =================================================

            if (
                command ===
                "help"
            ) {

                return interaction.reply({
                    content:
`# 🤖 NR INVITE

🔗 **Invitaciones**
/invites
/active invites
/leaderboard
/stats

⚙️ **Configuración**
/setup invite

📩 **Reportes**
/reporte

📢 **Anuncios**
/anuncio

🆘 **Soporte**
${SUPPORT_INVITE}`,

                    ephemeral: true
                });
            }

            if (!guild) {
                return interaction.reply({
                    content:
                        "❌ Este comando solamente puede utilizarse en un servidor.",
                    ephemeral: true
                });
            }

            const cfg =
                getGuildConfig(
                    guild.id
                );

            // =================================================
            // SETUP
            // =================================================

            if (
                command ===
                "setup"
            ) {

                if (
                    interaction.options.getSubcommand() !==
                    "invite"
                ) {
                    return;
                }

                if (
                    !interaction.member.permissions.has(
                        PermissionsBitField.Flags.ManageGuild
                    )
                ) {
                    return interaction.reply({
                        content:
                            "❌ Necesitas **Administrar servidor** para utilizar este comando.",
                        ephemeral: true
                    });
                }

                const channels =
                    guild.channels.cache
                        .filter(
                            channel =>
                                channel.type ===
                                ChannelType.GuildText
                        )
                        .sort(
                            (a, b) =>
                                a.position -
                                b.position
                        );

                const menu =
                    new StringSelectMenuBuilder()
                        .setCustomId(
                            "nr_setup_menu"
                        )
                        .setPlaceholder(
                            "Selecciona una configuración"
                        )
                        .addOptions(
                            {
                                label:
                                    "Canal de anuncios",
                                description:
                                    "Seleccionar canal público de anuncios",
                                value:
                                    "announcements"
                            },
                            {
                                label:
                                    "Canal de logs",
                                description:
                                    "Seleccionar canal de registros",
                                value:
                                    "logs"
                            },
                            {
                                label:
                                    "Canal de reportes",
                                description:
                                    "Seleccionar canal de reportes",
                                value:
                                    "reports"
                            },
                            {
                                label:
                                    "Estado del sistema",
                                description:
                                    "Ver configuración actual",
                                value:
                                    "status"
                            }
                        );

                return interaction.reply({
                    content:
`# ⚙️ NR INVITE — SETUP

Configura el sistema desde este menú.

📢 **Anuncios:**
${
    cfg.announcements.channelId
        ? `<#${cfg.announcements.channelId}>`
        : "No configurado"
}

📋 **Logs:**
${
    cfg.logs.channelId
        ? `<#${cfg.logs.channelId}>`
        : "No configurado"
}

📩 **Reportes:**
${
    cfg.reports.channelId
        ? `<#${cfg.reports.channelId}>`
        : "No configurado"
}

Selecciona una opción:`,

                    components: [
                        new ActionRowBuilder()
                            .addComponents(
                                menu
                            )
                    ],

                    ephemeral: true
                });
            }

            // =================================================
            // INVITES
            // =================================================

            if (
                command ===
                "invites"
            ) {

                const user =
                    interaction.options.getUser(
                        "usuario"
                    ) ||
                    interaction.user;

                const stats =
                    getUserInviteStats(
                        guild.id,
                        user.id
                    );

                return interaction.reply({
                    content:
`📊 **Invitaciones de ${user.tag}**

📨 Totales: **${stats.total}**
🟢 Activas: **${stats.active}**
📤 Salieron: **${stats.left}**
⚠️ Falsas: **${stats.fake}**`
                });
            }

            // =================================================
            // ACTIVE
            // =================================================

            if (
                command ===
                "active"
            ) {

                const stats =
                    getUserInviteStats(
                        guild.id,
                        interaction.user.id
                    );

                return interaction.reply({
                    content:
`📨 **Tus invitaciones**

🟢 Activas: **${stats.active}**
📨 Totales: **${stats.total}**
📤 Salieron: **${stats.left}**
⚠️ Falsas: **${stats.fake}**`,

                    ephemeral: true
                });
            }

            // =================================================
            // LEADERBOARD
            // =================================================

            if (
                command ===
                "leaderboard"
            ) {

                const guildData =
                    inviteStats.get(
                        guild.id
                    );

                if (
                    !guildData ||
                    guildData.size === 0
                ) {
                    return interaction.reply({
                        content:
                            "📊 Todavía no hay datos de invitaciones."
                    });
                }

                const ranking =
                    [...guildData.entries()]
                        .sort(
                            (a, b) =>
                                b[1].total -
                                a[1].total
                        )
                        .slice(
                            0,
                            10
                        );

                let content =
                    "# 🏆 NR INVITE — RANKING\n\n";

                ranking.forEach(
                    (
                        [userId, stats],
                        index
                    ) => {

                        content +=
`**${index + 1}.** <@${userId}> — **${stats.total}** invitaciones | 🟢 ${stats.active} activas\n`;
                    }
                );

                return interaction.reply({
                    content
                });
            }

            // =================================================
            // STATS
            // =================================================

            if (
                command ===
                "stats"
            ) {

                const guildData =
                    inviteStats.get(
                        guild.id
                    );

                let total = 0;
                let active = 0;
                let left = 0;

                if (
                    guildData
                ) {
                    for (
                        const stats
                        of guildData.values()
                    ) {
                        total +=
                            stats.total;

                        active +=
                            stats.active;

                        left +=
                            stats.left;
                    }
                }

                return interaction.reply({
                    content:
`# 📊 NR INVITE

🏠 Servidor: **${guild.name}**
👥 Miembros: **${guild.memberCount}**

📨 Invitaciones: **${total}**
🟢 Activas: **${active}**
📤 Salidas: **${left}**

➕ Entradas: **${cfg.stats.joins}**
📩 Reportes: **${cfg.stats.reports}**
📝 Reseñas: **${cfg.stats.reviews}**`
                });
            }

            // =================================================
            // REPORTE NORMAL
            // =================================================

            if (
                command ===
                "reporte"
            ) {

                const type =
                    interaction.options.getString(
                        "tipo",
                        true
                    );

                const description =
                    interaction.options.getString(
                        "descripcion",
                        true
                    );

                cfg.stats.reports++;

                saveConfig();

                const reportId =
                    `NR-REPORT-${String(
                        Date.now()
                    ).slice(-6)}`;

                const date =
                    new Date().toLocaleString(
                        "es-CO",
                        {
                            timeZone:
                                "America/Bogota"
                        }
                    );

                const content =
`# 📩 NUEVO REPORTE

**ID:** \`${reportId}\`

**Tipo:** ${type}

**Usuario:** ${interaction.user}
**ID:** \`${interaction.user.id}\`

**Servidor:** ${guild.name}
**ID:** \`${guild.id}\`

**Descripción:**
${description}

**Fecha:** ${date}`;

                let channel = null;

                if (
                    cfg.reports.channelId
                ) {
                    channel =
                        guild.channels.cache.get(
                            cfg.reports.channelId
                        );
                }

                if (
                    channel
                ) {
                    await channel.send({
                        content
                    });
                }

                const emailSent =
                    await sendEmail({
                        subject:
                            `NR INVITE | ${reportId} | ${type}`,

                        text:
`NR INVITE - NUEVO REPORTE

ID: ${reportId}

Tipo:
${type}

Usuario:
${interaction.user.tag}

ID:
${interaction.user.id}

Servidor:
${guild.name}

ID:
${guild.id}

Descripción:
${description}

Fecha:
${date}`
                    });

                return interaction.reply({
                    content:
`✅ **Reporte enviado.**

ID:
\`${reportId}\`

${
    emailSent
        ? "📧 También fue enviado al correo."
        : "📧 El correo no está configurado."
}`,

                    ephemeral: true
                });
            }

            // =================================================
            // ANUNCIO
            // =================================================

            if (
                command ===
                "anuncio"
            ) {

                if (
                    SUPPORT_SERVER_ID &&
                    guild.id !==
                        SUPPORT_SERVER_ID
                ) {
                    return interaction.reply({
                        content:
                            "❌ Este comando solamente está disponible en el servidor oficial de soporte de NR INVITE.",
                        ephemeral: true
                    });
                }

                if (
                    !interaction.member.permissions.has(
                        PermissionsBitField.Flags.ManageGuild
                    )
                ) {
                    return interaction.reply({
                        content:
                            "❌ No tienes permiso para publicar anuncios.",
                        ephemeral: true
                    });
                }

                const title =
                    interaction.options.getString(
                        "titulo",
                        true
                    );

                const description =
                    interaction.options.getString(
                        "descripcion",
                        true
                    );

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            title
                        )
                        .setDescription(
                            description
                        )
                        .setFooter({
                            text:
                                "NR INVITE"
                        })
                        .setTimestamp();

                const menu =
                    new StringSelectMenuBuilder()
                        .setCustomId(
                            "nr_anuncio_menu"
                        )
                        .setPlaceholder(
                            "Selecciona una opción"
                        )
                        .addOptions(
                            new StringSelectMenuOptionBuilder()
                                .setLabel(
                                    "Valorar"
                                )
                                .setDescription(
                                    "Valora NR INVITE de 1 a 5 estrellas"
                                )
                                .setEmoji(
                                    "⭐"
                                )
                                .setValue(
                                    "valorar"
                                ),

                            new StringSelectMenuOptionBuilder()
                                .setLabel(
                                    "Reseña"
                                )
                                .setDescription(
                                    "Escribe una reseña"
                                )
                                .setEmoji(
                                    "📝"
                                )
                                .setValue(
                                    "resena"
                                ),

                            new StringSelectMenuOptionBuilder()
                                .setLabel(
                                    "Reportar"
                                )
                                .setDescription(
                                    "Reporta un bug o problema"
                                )
                                .setEmoji(
                                    "🐛"
                                )
                                .setValue(
                                    "reportar"
                                )
                        );

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            menu
                        );

                await interaction.channel.send({
                    embeds: [
                        embed
                    ],
                    components: [
                        row
                    ]
                });

                return interaction.reply({
                    content:
                        "✅ Anuncio publicado correctamente.",
                    ephemeral: true
                });
            }

        } catch (error) {

            console.error(
                "❌ Error procesando interacción:",
                error
            );

            if (
                interaction.replied ||
                interaction.deferred
            ) {
                await interaction.followUp({
                    content:
                        "❌ Ocurrió un error procesando la solicitud.",
                    ephemeral: true
                }).catch(
                    () => {}
                );
            } else {
                await interaction.reply({
                    content:
                        "❌ Ocurrió un error procesando la solicitud.",
                    ephemeral: true
                }).catch(
                    () => {}
                );
            }
        }
    }
);

// ============================================================
// MENU DE SETUP
// ============================================================

client.on(
    "interactionCreate",
    async interaction => {

        if (
            !interaction.isStringSelectMenu()
        ) {
            return;
        }

        if (
            interaction.customId !==
            "nr_setup_menu"
        ) {
            return;
        }

        if (
            !interaction.guild
        ) {
            return;
        }

        const guild =
            interaction.guild;

        const cfg =
            getGuildConfig(
                guild.id
            );

        const selected =
            interaction.values[0];

        // ----------------------------------------------------
        // ESTADO
        // ----------------------------------------------------

        if (
            selected ===
            "status"
        ) {

            return interaction.reply({
                content:
`# ⚙️ CONFIGURACIÓN ACTUAL

📢 Anuncios:
${
    cfg.announcements.channelId
        ? `<#${cfg.announcements.channelId}>`
        : "No configurado"
}

📋 Logs:
${
    cfg.logs.channelId
        ? `<#${cfg.logs.channelId}>`
        : "No configurado"
}

📩 Reportes:
${
    cfg.reports.channelId
        ? `<#${cfg.reports.channelId}>`
        : "No configurado"
}

🔗 Invitaciones:
${cfg.invites.enabled ? "✅ Activadas" : "❌ Desactivadas"}

🏆 Ranking:
${cfg.ranking.enabled ? "✅ Activado" : "❌ Desactivado"}`,

                ephemeral: true
            });
        }

        // ----------------------------------------------------
        // CANAL DE ANUNCIOS
        // ----------------------------------------------------

        if (
            selected ===
            "announcements"
        ) {

            const channels =
                guild.channels.cache
                    .filter(
                        channel =>
                            channel.type ===
                            ChannelType.GuildText
                    )
                    .sort(
                        (a, b) =>
                            a.position -
                            b.position
                    )
                    .slice(
                        0,
                        25
                    );

            const options =
                channels.map(
                    channel => {

                        return {
                            label:
                                channel.name.slice(
                                    0,
                                    100
                                ),

                            value:
                                channel.id,

                            description:
                                "Canal de anuncios"
                        };
                    }
                );

            if (
                options.length === 0
            ) {
                return interaction.reply({
                    content:
                        "❌ No hay canales de texto disponibles.",
                    ephemeral: true
                });
            }

            const menu =
                new StringSelectMenuBuilder()
                    .setCustomId(
                        "nr_select_announcement_channel"
                    )
                    .setPlaceholder(
                        "Selecciona el canal"
                    )
                    .addOptions(
                        options
                    );

            return interaction.reply({
                content:
                    "📢 Selecciona el canal público donde NR INVITE podrá publicar anuncios:",

                components: [
                    new ActionRowBuilder()
                        .addComponents(
                            menu
                        )
                ],

                ephemeral: true
            });
        }

        // ----------------------------------------------------
        // LOGS
        // ----------------------------------------------------

        if (
            selected ===
            "logs"
        ) {

            const channels =
                guild.channels.cache
                    .filter(
                        channel =>
                            channel.type ===
                            ChannelType.GuildText
                    )
                    .sort(
                        (a, b) =>
                            a.position -
                            b.position
                    )
                    .slice(
                        0,
                        25
                    );

            const options =
                channels.map(
                    channel => ({
                        label:
                            channel.name.slice(
                                0,
                                100
                            ),

                        value:
                            channel.id,

                        description:
                            "Canal de logs"
                    })
                );

            if (
                options.length === 0
            ) {
                return interaction.reply({
                    content:
                        "❌ No hay canales disponibles.",
                    ephemeral: true
                });
            }

            const menu =
                new StringSelectMenuBuilder()
                    .setCustomId(
                        "nr_select_logs_channel"
                    )
                    .setPlaceholder(
                        "Selecciona el canal de logs"
                    )
                    .addOptions(
                        options
                    );

            return interaction.reply({
                content:
                    "📋 Selecciona el canal de logs:",

                components: [
                    new ActionRowBuilder()
                        .addComponents(
                            menu
                        )
                ],

                ephemeral: true
            });
        }

        // ----------------------------------------------------
        // REPORTES
        // ----------------------------------------------------

        if (
            selected ===
            "reports"
        ) {

            const channels =
                guild.channels.cache
                    .filter(
                        channel =>
                            channel.type ===
                            ChannelType.GuildText
                    )
                    .sort(
                        (a, b) =>
                            a.position -
                            b.position
                    )
                    .slice(
                        0,
                        25
                    );

            const options =
                channels.map(
                    channel => ({
                        label:
                            channel.name.slice(
                                0,
                                100
                            ),

                        value:
                            channel.id,

                        description:
                            "Canal de reportes"
                    })
                );

            if (
                options.length === 0
            ) {
                return interaction.reply({
                    content:
                        "❌ No hay canales disponibles.",
                    ephemeral: true
                });
            }

            const menu =
                new StringSelectMenuBuilder()
                    .setCustomId(
                        "nr_select_reports_channel"
                    )
                    .setPlaceholder(
                        "Selecciona el canal de reportes"
                    )
                    .addOptions(
                        options
                    );

            return interaction.reply({
                content:
                    "📩 Selecciona el canal donde recibirás los reportes:",

                components: [
                    new ActionRowBuilder()
                        .addComponents(
                            menu
                        )
                ],

                ephemeral: true
            });
        }
    }
);

// ============================================================
// SELECTORES DE CANALES
// ============================================================

client.on(
    "interactionCreate",
    async interaction => {

        if (
            !interaction.isStringSelectMenu()
        ) {
            return;
        }

        if (
            !interaction.guild
        ) {
            return;
        }

        const guild =
            interaction.guild;

        const cfg =
            getGuildConfig(
                guild.id
            );

        if (
            interaction.customId ===
            "nr_select_announcement_channel"
        ) {

            const channelId =
                interaction.values[0];

            cfg.announcements.channelId =
                channelId;

            saveConfig();

            return interaction.update({
                content:
                    `✅ Canal de anuncios configurado en <#${channelId}>.`,

                components: []
            });
        }

        if (
            interaction.customId ===
            "nr_select_logs_channel"
        ) {

            const channelId =
                interaction.values[0];

            cfg.logs.channelId =
                channelId;

            cfg.logs.enabled =
                true;

            saveConfig();

            return interaction.update({
                content:
                    `✅ Canal de logs configurado en <#${channelId}>.`,

                components: []
            });
        }

        if (
            interaction.customId ===
            "nr_select_reports_channel"
        ) {

            const channelId =
                interaction.values[0];

            cfg.reports.channelId =
                channelId;

            cfg.reports.enabled =
                true;

            saveConfig();

            return interaction.update({
                content:
                    `✅ Canal de reportes configurado en <#${channelId}>.`,

                components: []
            });
        }
    }
);

// ============================================================
// ERRORES
// ============================================================

client.on(
    "error",
    error => {
        console.error(
            "❌ Discord Client Error:",
            error
        );
    }
);

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "❌ Unhandled Rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "❌ Uncaught Exception:",
            error
        );
    }
);

// ============================================================
// LOGIN
// ============================================================

client.login(
    TOKEN
);
