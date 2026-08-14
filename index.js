require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionsBitField,
    ChannelType,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");

const nodemailer = (() => {
    try {
        return require("nodemailer");
    } catch {
        return null;
    }
})();

// ============================================================
// NR INVITE
// Sin Dashboard
// Sin SQLite
// Configuración mediante /setup invite
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID =
    process.env.DISCORD_CLIENT_ID ||
    "1537857820450361394";

const SUPPORT_SERVER =
    "https://discord.gg/PZw45tHPfc";

const SUPPORT_SERVER_ID =
    process.env.SUPPORT_SERVER_ID || "";

const SUPPORT_REPORT_CHANNEL =
    "1521762536586743868";

const GLOBAL_ANNOUNCEMENT_CHANNEL =
    "1522103587558391942";

const REPORT_EMAIL =
    process.env.REPORT_EMAIL || "";

const SMTP_HOST =
    process.env.SMTP_HOST || "";

const SMTP_PORT =
    Number(process.env.SMTP_PORT) || 587;

const SMTP_USER =
    process.env.SMTP_USER || "";

const SMTP_PASS =
    process.env.SMTP_PASS || "";

const PORT =
    Number(process.env.PORT) || 3000;

// ============================================================
// VALIDACIÓN
// ============================================================

if (!TOKEN) {
    console.error("❌ Falta DISCORD_TOKEN.");
    process.exit(1);
}

// ============================================================
// CLIENT
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildInvites
    ],
    partials: [
        Partials.Channel,
        Partials.GuildMember,
        Partials.User,
        Partials.Message
    ]
});

// ============================================================
// CONFIGURACIÓN EN MEMORIA
// ============================================================

// IMPORTANTE:
// No utiliza DB.
// Al reiniciar Render, las configuraciones se pierden.
// Si quieres persistencia posteriormente se puede agregar JSON,
// pero este código NO usa ninguna base de datos.

const guildConfigs = new Map();

// ============================================================
// INVITES
// ============================================================

const inviteCache = new Map();

const inviterStats = new Map();

// ============================================================
// REPORTES ACTIVOS
// ============================================================

const activeReports = new Map();

// ============================================================
// CONFIG DEFAULT
// ============================================================

function defaultConfig() {
    return {
        welcome: {
            enabled: true,
            channelId: null,
            message:
                "## 👋 ¡Bienvenido/a {user}!\n\n" +
                "¡Gracias por unirte a **{server}**!\n\n" +
                "Actualmente somos **{memberCount}** miembros."
        },

        announcements: {
            enabled: true,
            channelId: null
        },

        goodbye: {
            enabled: true,
            channelId: null,
            message:
                "👋 **{username}** ha salido de **{server}**.\n" +
                "Ahora somos **{memberCount}** miembros."
        },

        invites: {
            enabled: true,
            channelId: null,
            pingInviter: false
        },

        reports: {
            enabled: true,
            email: REPORT_EMAIL || ""
        }
    };
}

function getConfig(guildId) {
    if (!guildConfigs.has(guildId)) {
        guildConfigs.set(guildId, defaultConfig());
    }

    return guildConfigs.get(guildId);
}

// ============================================================
// VARIABLES DE MENSAJES
// ============================================================

function replaceVariables(text, data = {}) {
    if (!text) return "";

    return text
        .replaceAll("{user}", data.user || "")
        .replaceAll("{username}", data.username || "")
        .replaceAll("{server}", data.server || "")
        .replaceAll("{memberCount}", String(data.memberCount ?? ""))
        .replaceAll("{inviter}", data.inviter || "Desconocido")
        .replaceAll("{inviteCode}", data.inviteCode || "")
        .replaceAll("{inviteUses}", String(data.inviteUses ?? "0"));
}

// ============================================================
// CANALES
// ============================================================

function isPublicTextChannel(channel) {
    if (!channel) return false;

    if (channel.type !== ChannelType.GuildText) {
        return false;
    }

    const me = channel.guild.members.me;

    if (!me) return false;

    return channel
        .permissionsFor(me)
        ?.has([
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages
        ]);
}

function findFirstPublicTextChannel(guild) {
    return guild.channels.cache
        .filter(channel => isPublicTextChannel(channel))
        .sort((a, b) => a.position - b.position)
        .first() || null;
}

// ============================================================
// REGISTRO DE COMANDOS
// ============================================================

const commands = [

    new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Configura NR INVITE")
        .addSubcommand(sub =>
            sub
                .setName("invite")
                .setDescription("Configura todo el sistema de invitaciones")
        ),

    new SlashCommandBuilder()
        .setName("reporte")
        .setDescription("Envía un reporte a NR INVITE"),

    new SlashCommandBuilder()
        .setName("help")
        .setDescription("Muestra la guía de NR INVITE"),

    new SlashCommandBuilder()
        .setName("leaderboard")
        .setDescription("Muestra el ranking de invitaciones"),

    new SlashCommandBuilder()
        .setName("anuncio")
        .setDescription("Publica un anuncio desde el servidor de soporte")
        .addStringOption(option =>
            option
                .setName("titulo")
                .setDescription("Título del anuncio")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("mensaje")
                .setDescription("Mensaje del anuncio")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("imagen")
                .setDescription("URL opcional de imagen")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("config")
        .setDescription("Consulta la configuración actual"),

    new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Comprueba la conexión del bot")

].map(command => command.toJSON());

// ============================================================
// REGISTRAR COMANDOS
// ============================================================

async function registerCommands() {
    try {
        const rest = new REST({
            version: "10"
        }).setToken(TOKEN);

        console.log("🔄 Registrando comandos globales...");

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            {
                body: commands
            }
        );

        console.log("✅ Comandos globales registrados.");
    } catch (error) {
        console.error(
            "❌ Error registrando comandos:",
            error
        );
    }
}

// ============================================================
// CACHE DE INVITES
// ============================================================

async function cacheGuildInvites(guild) {
    try {
        const invites =
            await guild.invites.fetch();

        inviteCache.set(
            guild.id,
            new Map(
                invites.map(invite => [
                    invite.code,
                    {
                        uses: invite.uses || 0,
                        inviterId:
                            invite.inviter?.id || null
                    }
                ])
            )
        );
    } catch (error) {
        console.log(
            `No se pudieron cargar invites de ${guild.name}: ${error.message}`
        );
    }
}

// ============================================================
// DETECTAR INVITE
// ============================================================

async function detectInvite(member) {
    const guild = member.guild;

    try {
        const oldCache =
            inviteCache.get(guild.id) ||
            new Map();

        const newInvites =
            await guild.invites.fetch();

        let usedInvite = null;

        for (const invite of newInvites.values()) {

            const old =
                oldCache.get(invite.code);

            const oldUses =
                old?.uses || 0;

            const newUses =
                invite.uses || 0;

            if (newUses > oldUses) {
                usedInvite = invite;
                break;
            }
        }

        inviteCache.set(
            guild.id,
            new Map(
                newInvites.map(invite => [
                    invite.code,
                    {
                        uses: invite.uses || 0,
                        inviterId:
                            invite.inviter?.id || null
                    }
                ])
            )
        );

        return usedInvite;

    } catch {
        return null;
    }
}

// ============================================================
// ESTADÍSTICAS DE INVITADOR
// ============================================================

function addInviteStat(guildId, userId) {

    if (!userId) return;

    if (!inviterStats.has(guildId)) {
        inviterStats.set(
            guildId,
            new Map()
        );
    }

    const guildStats =
        inviterStats.get(guildId);

    guildStats.set(
        userId,
        (guildStats.get(userId) || 0) + 1
    );
}

function getLeaderboard(guildId) {

    const stats =
        inviterStats.get(guildId);

    if (!stats) return [];

    return [...stats.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
}

// ============================================================
// MENSAJE DE BIENVENIDA
// ============================================================

async function sendWelcome(member, invite) {

    const config =
        getConfig(member.guild.id);

    if (!config.welcome.enabled) {
        return;
    }

    let channel =
        member.guild.channels.cache.get(
            config.welcome.channelId
        );

    if (!isPublicTextChannel(channel)) {
        channel =
            findFirstPublicTextChannel(
                member.guild
            );
    }

    if (!channel) return;

    const inviter =
        invite?.inviter?.user?.tag ||
        invite?.inviter?.tag ||
        "Desconocido";

    const message =
        replaceVariables(
            config.welcome.message,
            {
                user: `<@${member.id}>`,
                username: member.user.username,
                server: member.guild.name,
                memberCount:
                    member.guild.memberCount,
                inviter,
                inviteCode:
                    invite?.code || "",
                inviteUses:
                    invite?.uses || 0
            }
        );

    try {
        await channel.send(message);
    } catch (error) {
        console.error(
            "❌ Error enviando bienvenida:",
            error.message
        );
    }
}

// ============================================================
// MENSAJE DE SALIDA
// ============================================================

async function sendGoodbye(member) {

    const config =
        getConfig(member.guild.id);

    if (!config.goodbye.enabled) {
        return;
    }

    let channel =
        member.guild.channels.cache.get(
            config.goodbye.channelId
        );

    if (!isPublicTextChannel(channel)) {
        channel =
            findFirstPublicTextChannel(
                member.guild
            );
    }

    if (!channel) return;

    const message =
        replaceVariables(
            config.goodbye.message,
            {
                username:
                    member.user.username,
                server:
                    member.guild.name,
                memberCount:
                    Math.max(
                        0,
                        member.guild.memberCount - 1
                    )
            }
        );

    try {
        await channel.send(message);
    } catch (error) {
        console.error(
            "❌ Error enviando despedida:",
            error.message
        );
    }
}

// ============================================================
// MENSAJE DE ENTRADA DEL BOT
// ============================================================

async function sendBotWelcome(guild) {

    const channel =
        findFirstPublicTextChannel(guild);

    if (!channel) {
        console.log(
            `⚠️ ${guild.name}: no hay canal público disponible.`
        );
        return;
    }

    const text =
        "## ¡Hola! 👋 Soy NR INVITE.\n\n" +
        "*Gracias por añadirme a tu servidor.*\n\n" +
        "**Puedes configurar el sistema de invitaciones con:**\n\n" +
        "__/setup invite__\n\n" +
        "**Si necesitas ayuda o quieres conocer todas mis funciones, entra a mi servidor de soporte:**\n\n" +
        "## [Únete](" +
        SUPPORT_SERVER +
        ")\n\n" +
        "**¡Gracias por usar NR INVITE! ❤️**";

    try {
        await channel.send(text);
    } catch (error) {
        console.error(
            `❌ No se pudo enviar bienvenida en ${guild.name}:`,
            error.message
        );
    }
}

// ============================================================
// SETUP
// ============================================================

function setupPanel() {

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("⚙️ NR INVITE • Configuración")
        .setDescription(
            "Configura todas las funciones de NR INVITE desde este panel.\n\n" +
            "Selecciona una opción:"
        )
        .addFields(
            {
                name: "👋 Bienvenida",
                value:
                    "Configura canal y mensaje de bienvenida.",
                inline: false
            },
            {
                name: "📢 Anuncios",
                value:
                    "Selecciona el canal donde llegarán anuncios.",
                inline: false
            },
            {
                name: "👋 Salida",
                value:
                    "Configura el mensaje de salida.",
                inline: false
            },
            {
                name: "📨 Invitaciones",
                value:
                    "Configura dónde se mostrarán las invitaciones.",
                inline: false
            },
            {
                name: "🐛 Reportes",
                value:
                    "Configura el correo utilizado para reportes.",
                inline: false
            }
        );

    const menu =
        new StringSelectMenuBuilder()
            .setCustomId("setup_select")
            .setPlaceholder(
                "Selecciona qué quieres configurar"
            )
            .addOptions(
                {
                    label: "Bienvenida",
                    description:
                        "Configurar bienvenida",
                    value: "welcome",
                    emoji: "👋"
                },
                {
                    label: "Canal de anuncios",
                    description:
                        "Configurar anuncios",
                    value: "announcements",
                    emoji: "📢"
                },
                {
                    label: "Mensaje de salida",
                    description:
                        "Configurar despedida",
                    value: "goodbye",
                    emoji: "🚪"
                },
                {
                    label: "Invitaciones",
                    description:
                        "Configurar invitaciones",
                    value: "invites",
                    emoji: "📨"
                },
                {
                    label: "Reportes",
                    description:
                        "Configurar reportes y correo",
                    value: "reports",
                    emoji: "🐛"
                },
                {
                    label: "Ver configuración",
                    description:
                        "Mostrar configuración actual",
                    value: "view",
                    emoji: "📋"
                }
            );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder()
                .addComponents(menu)
        ]
    };
}

// ============================================================
// MODAL BIENVENIDA
// ============================================================

function welcomeModal(guild) {

    const config =
        getConfig(guild.id);

    return new ModalBuilder()
        .setCustomId("setup_welcome_modal")
        .setTitle("👋 Configurar bienvenida")
        .addComponents(

            new ActionRowBuilder()
                .addComponents(
                    new TextInputBuilder()
                        .setCustomId("welcome_message")
                        .setLabel("Mensaje")
                        .setStyle(
                            TextInputStyle.Paragraph
                        )
                        .setRequired(true)
                        .setValue(
                            config.welcome.message
                        )
                        .setPlaceholder(
                            "{user} {server} {memberCount} {inviter}"
                        )
                ),

            new ActionRowBuilder()
                .addComponents(
                    new TextInputBuilder()
                        .setCustomId("welcome_channel")
                        .setLabel("ID del canal")
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setRequired(true)
                        .setValue(
                            config.welcome.channelId ||
                            ""
                        )
                        .setPlaceholder(
                            "Ejemplo: 123456789012345678"
                        )
                )
        );
}

// ============================================================
// MODAL SALIDA
// ============================================================

function goodbyeModal(guild) {

    const config =
        getConfig(guild.id);

    return new ModalBuilder()
        .setCustomId("setup_goodbye_modal")
        .setTitle("🚪 Configurar salida")
        .addComponents(

            new ActionRowBuilder()
                .addComponents(
                    new TextInputBuilder()
                        .setCustomId("goodbye_message")
                        .setLabel("Mensaje de salida")
                        .setStyle(
                            TextInputStyle.Paragraph
                        )
                        .setRequired(true)
                        .setValue(
                            config.goodbye.message
                        )
                ),

            new ActionRowBuilder()
                .addComponents(
                    new TextInputBuilder()
                        .setCustomId("goodbye_channel")
                        .setLabel("ID del canal")
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setRequired(true)
                        .setValue(
                            config.goodbye.channelId ||
                            ""
                        )
                )
        );
}

// ============================================================
// MODAL REPORTES
// ============================================================

function reportConfigModal(guild) {

    const config =
        getConfig(guild.id);

    return new ModalBuilder()
        .setCustomId("setup_reports_modal")
        .setTitle("🐛 Configurar reportes")
        .addComponents(

            new ActionRowBuilder()
                .addComponents(
                    new TextInputBuilder()
                        .setCustomId("report_email")
                        .setLabel("Correo electrónico")
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setRequired(false)
                        .setValue(
                            config.reports.email ||
                            ""
                        )
                        .setPlaceholder(
                            "correo@ejemplo.com"
                        )
                )
        );
}

// ============================================================
// CONFIGURACIÓN DE ANUNCIOS
// ============================================================

function announcementChannelMenu() {

    return new ActionRowBuilder()
        .addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId(
                    "setup_announcement_channel"
                )
                .setPlaceholder(
                    "Selecciona el canal de anuncios"
                )
                .setChannelTypes(
                    ChannelType.GuildText
                )
        );
}

// ============================================================
// CONFIGURACIÓN INVITES
// ============================================================

function inviteChannelMenu() {

    return new ActionRowBuilder()
        .addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId(
                    "setup_invite_channel"
                )
                .setPlaceholder(
                    "Selecciona el canal de invitaciones"
                )
                .setChannelTypes(
                    ChannelType.GuildText
                )
        );
}

// ============================================================
// CONFIG VIEW
// ============================================================

function configDescription(guild) {

    const config =
        getConfig(guild.id);

    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("📋 NR INVITE • Configuración")
        .addFields(

            {
                name: "👋 Bienvenida",
                value:
                    `Estado: ${
                        config.welcome.enabled
                            ? "🟢 Activada"
                            : "🔴 Desactivada"
                    }\n` +
                    `Canal: ${
                        config.welcome.channelId
                            ? `<#${config.welcome.channelId}>`
                            : "No configurado"
                    }`,
                inline: false
            },

            {
                name: "📢 Anuncios",
                value:
                    `Estado: ${
                        config.announcements.enabled
                            ? "🟢 Activados"
                            : "🔴 Desactivados"
                    }\n` +
                    `Canal: ${
                        config.announcements.channelId
                            ? `<#${config.announcements.channelId}>`
                            : "No configurado"
                    }`,
                inline: false
            },

            {
                name: "🚪 Salida",
                value:
                    `Estado: ${
                        config.goodbye.enabled
                            ? "🟢 Activada"
                            : "🔴 Desactivada"
                    }\n` +
                    `Canal: ${
                        config.goodbye.channelId
                            ? `<#${config.goodbye.channelId}>`
                            : "No configurado"
                    }`,
                inline: false
            },

            {
                name: "📨 Invitaciones",
                value:
                    `Estado: ${
                        config.invites.enabled
                            ? "🟢 Activadas"
                            : "🔴 Desactivadas"
                    }\n` +
                    `Canal: ${
                        config.invites.channelId
                            ? `<#${config.invites.channelId}>`
                            : "No configurado"
                    }\n` +
                    `Ping invitador: ${
                        config.invites.pingInviter
                            ? "Sí"
                            : "No"
                    }`,
                inline: false
            },

            {
                name: "🐛 Reportes",
                value:
                    `Estado: ${
                        config.reports.enabled
                            ? "🟢 Activados"
                            : "🔴 Desactivados"
                    }\n` +
                    `Correo: ${
                        config.reports.email ||
                        "No configurado"
                    }`,
                inline: false
            }
        );
}

// ============================================================
// TIPOS DE REPORTE
// ============================================================

const REPORT_TYPES = {

    bug: {
        label: "Bug / Error",
        emoji: "🐛",
        questions: [
            "¿Cuál es el error?",
            "¿Dónde ocurre el error?",
            "¿Qué estabas haciendo?",
            "¿Qué esperabas que ocurriera?",
            "¿Qué ocurrió realmente?",
            "¿Cuándo ocurrió?",
            "¿Puedes reproducirlo?",
            "¿Con qué comando ocurrió?",
            "¿Con qué servidor ocurrió?",
            "¿Qué usuario estaba involucrado?",
            "¿Afecta a otros usuarios?",
            "¿Afecta a todo el servidor?",
            "¿Apareció algún mensaje de error?",
            "¿Tienes captura de pantalla?",
            "¿Tienes vídeo?",
            "¿Desde qué dispositivo ocurrió?",
            "¿Qué navegador utilizabas?",
            "¿Habías utilizado anteriormente la función?",
            "¿Has intentado solucionarlo?",
            "¿Hay algo más que debamos saber?"
        ]
    },

    abuse: {
        label: "Abuso / Usuario",
        emoji: "🚨",
        questions: [
            "¿Quién está siendo reportado?",
            "¿Cuál es su ID de Discord?",
            "¿Qué ocurrió?",
            "¿Cuándo ocurrió?",
            "¿Dónde ocurrió?",
            "¿Qué estaba haciendo?",
            "¿Quiénes fueron afectados?",
            "¿Tienes pruebas?",
            "¿Tienes capturas?",
            "¿Tienes vídeos?",
            "¿Hay testigos?",
            "¿El usuario continúa haciéndolo?",
            "¿Habías avisado al usuario?",
            "¿Algún moderador intervino?",
            "¿Qué acción consideras necesaria?",
            "¿Hubo amenazas?",
            "¿Hubo spam?",
            "¿Hubo contenido inapropiado?",
            "¿Hay información adicional?",
            "¿Quieres añadir alguna observación?"
        ]
    },

    other: {
        label: "Otro",
        emoji: "📩",
        questions: [
            "¿Cuál es el motivo del reporte?",
            "Explica el problema.",
            "¿Cuándo ocurrió?",
            "¿Dónde ocurrió?",
            "¿Quién estuvo involucrado?",
            "¿Qué estabas haciendo?",
            "¿Qué esperabas que ocurriera?",
            "¿Qué ocurrió realmente?",
            "¿Afecta a otros usuarios?",
            "¿Afecta al servidor?",
            "¿Tienes pruebas?",
            "¿Tienes capturas?",
            "¿Tienes vídeos?",
            "¿Hay testigos?",
            "¿Has intentado solucionarlo?",
            "¿Qué solución propones?",
            "¿Qué tan urgente es?",
            "¿Hay información adicional?",
            "¿Quieres añadir enlaces?",
            "¿Quieres añadir algo más?"
        ]
    }
};

// ============================================================
// MENÚ DE REPORTES
// ============================================================

function reportTypeMenu() {

    const menu =
        new StringSelectMenuBuilder()
            .setCustomId("report_type")
            .setPlaceholder(
                "Selecciona el tipo de reporte"
            )
            .addOptions(
                Object.entries(REPORT_TYPES)
                    .map(([value, data]) => ({
                        label: data.label,
                        description:
                            `Reportar: ${data.label}`,
                        value,
                        emoji: data.emoji
                    }))
            );

    return new ActionRowBuilder()
        .addComponents(menu);
}

// ============================================================
// GENERAR MODAL DE PREGUNTAS
// ============================================================

function createReportModal(
    reportId,
    page
) {

    const report =
        activeReports.get(reportId);

    if (!report) return null;

    const questions =
        report.questions;

    const start =
        page * 5;

    const current =
        questions.slice(
            start,
            start + 5
        );

    const modal =
        new ModalBuilder()
            .setCustomId(
                `report_modal_${reportId}_${page}`
            )
            .setTitle(
                `Reporte • ${page + 1}/4`
            );

    for (
        let i = 0;
        i < current.length;
        i++
    ) {

        const input =
            new TextInputBuilder()
                .setCustomId(
                    `q_${start + i}`
                )
                .setLabel(
                    current[i].slice(0, 45)
                )
                .setStyle(
                    TextInputStyle.Paragraph
                )
                .setRequired(true)
                .setPlaceholder(
                    "Escribe tu respuesta..."
                );

        modal.addComponents(
            new ActionRowBuilder()
                .addComponents(input)
        );
    }

    return modal;
}

// ============================================================
// ENVIAR REPORTE
// ============================================================

async function sendReport(report) {

    const guild =
        client.guilds.cache.get(
            report.guildId
        );

    let supportChannel = null;

    if (SUPPORT_SERVER_ID) {
        const supportGuild =
            client.guilds.cache.get(
                SUPPORT_SERVER_ID
            );

        if (supportGuild) {
            supportChannel =
                supportGuild.channels.cache.get(
                    SUPPORT_REPORT_CHANNEL
                );
        }
    }

    if (!supportChannel) {

        for (
            const guildItem
            of client.guilds.cache.values()
        ) {

            const channel =
                guildItem.channels.cache.get(
                    SUPPORT_REPORT_CHANNEL
                );

            if (channel) {
                supportChannel =
                    channel;
                break;
            }
        }
    }

    const answersText =
        report.questions
            .map(
                (question, index) =>
                    `**${index + 1}. ${question}**\n` +
                    `${report.answers[index] || "Sin respuesta"}`
            )
            .join("\n\n");

    const embed =
        new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle(
                `🐛 Nuevo reporte • ${report.typeLabel}`
            )
            .setDescription(
                `Reporte enviado por <@${report.userId}>`
            )
            .addFields(
                {
                    name: "👤 Usuario",
                    value:
                        `<@${report.userId}>\n` +
                        `ID: \`${report.userId}\``,
                    inline: false
                },
                {
                    name: "🏠 Servidor",
                    value:
                        guild
                            ? `${guild.name}\nID: \`${guild.id}\``
                            : `ID: \`${report.guildId}\``,
                    inline: false
                },
                {
                    name: "📋 Respuestas",
                    value:
                        answersText.slice(0, 1024),
                    inline: false
                }
            )
            .setTimestamp();

    if (supportChannel) {

        try {

            await supportChannel.send({
                embeds: [embed]
            });

            if (
                answersText.length > 1024
            ) {

                const chunks =
                    answersText.match(
                        /.{1,1900}/gs
                    ) || [];

                for (
                    const chunk of chunks
                ) {
                    await supportChannel.send(
                        chunk
                    );
                }
            }

        } catch (error) {

            console.error(
                "❌ Error enviando reporte al soporte:",
                error.message
            );
        }
    }

    await sendReportEmail(report, answersText);
}

// ============================================================
// CORREO
// ============================================================

async function sendReportEmail(
    report,
    answersText
) {

    if (
        !nodemailer ||
        !SMTP_HOST ||
        !SMTP_USER ||
        !SMTP_PASS ||
        !report.email
    ) {
        return;
    }

    try {

        const transporter =
            nodemailer.createTransport({
                host: SMTP_HOST,
                port: SMTP_PORT,
                secure:
                    SMTP_PORT === 465,
                auth: {
                    user: SMTP_USER,
                    pass: SMTP_PASS
                }
            });

        await transporter.sendMail({
            from: SMTP_USER,
            to: report.email,
            subject:
                `[NR INVITE] Nuevo reporte • ${report.typeLabel}`,
            text:
                `Nuevo reporte de NR INVITE\n\n` +
                `Usuario: ${report.userId}\n` +
                `Servidor: ${report.guildId}\n\n` +
                answersText
        });

    } catch (error) {

        console.error(
            "❌ Error enviando correo:",
            error.message
        );
    }
}

// ============================================================
// ANUNCIO GLOBAL
// ============================================================

async function broadcastAnnouncement(
    title,
    message,
    image,
    author
) {

    const results = [];

    for (
        const guild
        of client.guilds.cache.values()
    ) {

        const config =
            getConfig(guild.id);

        let channel =
            guild.channels.cache.get(
                config.announcements.channelId
            );

        if (!isPublicTextChannel(channel)) {
            channel =
                findFirstPublicTextChannel(
                    guild
                );
        }

        if (!channel) {
            results.push({
                guild: guild.name,
                success: false
            });
            continue;
        }

        const embed =
            new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle(title)
                .setDescription(message)
                .setFooter({
                    text:
                        "NR INVITE • Anuncio global"
                })
                .setTimestamp();

        if (image) {
            embed.setImage(image);
        }

        try {

            await channel.send({
                embeds: [embed]
            });

            results.push({
                guild: guild.name,
                success: true
            });

        } catch {
            results.push({
                guild: guild.name,
                success: false
            });
        }
    }

    return results;
}

// ============================================================
// READY
// ============================================================

client.once("clientReady", async () => {

    console.log(
        `✅ NR INVITE conectado como ${client.user.tag}`
    );

    console.log(
        `🌐 Servidores: ${client.guilds.cache.size}`
    );

    await registerCommands();

    for (
        const guild
        of client.guilds.cache.values()
    ) {
        await cacheGuildInvites(guild);
    }

    client.user.setPresence({
        activities: [
            {
                name:
                    "/help • NR INVITE"
            }
        ],
        status: "dnd"
    });
});

// ============================================================
// BOT ENTRA A UN SERVER
// ============================================================

client.on(
    "guildCreate",
    async guild => {

        console.log(
            `➕ NR INVITE entró a: ${guild.name}`
        );

        await cacheGuildInvites(guild);

        setTimeout(
            () => sendBotWelcome(guild),
            2500
        );
    }
);

// ============================================================
// NUEVO MIEMBRO
// ============================================================

client.on(
    "guildMemberAdd",
    async member => {

        const invite =
            await detectInvite(member);

        if (invite?.inviter?.id) {

            addInviteStat(
                member.guild.id,
                invite.inviter.id
            );
        }

        await sendWelcome(
            member,
            invite
        );

        const config =
            getConfig(
                member.guild.id
            );

        if (
            config.invites.enabled &&
            config.invites.channelId
        ) {

            let channel =
                member.guild.channels.cache.get(
                    config.invites.channelId
                );

            if (
                !isPublicTextChannel(channel)
            ) {
                channel =
                    findFirstPublicTextChannel(
                        member.guild
                    );
            }

            if (channel) {

                const inviter =
                    invite?.inviter;

                let message =
                    `📨 **Nueva invitación**\n\n` +
                    `👤 Usuario: <@${member.id}>\n` +
                    `📩 Invitado por: ${
                        inviter
                            ? `<@${inviter.id}>`
                            : "Desconocido"
                    }\n` +
                    `🔗 Código: ${
                        invite?.code ||
                        "Desconocido"
                    }`;

                if (
                    config.invites.pingInviter &&
                    inviter
                ) {
                    message =
                        `<@${inviter.id}> ` +
                        message;
                }

                try {
                    await channel.send(
                        message
                    );
                } catch {}
            }
        }
    }
);

// ============================================================
// SALIDA
// ============================================================

client.on(
    "guildMemberRemove",
    async member => {

        await sendGoodbye(
            member
        );
    }
);

// ============================================================
// MENSAJES
// ============================================================

client.on(
    "messageCreate",
    async message => {

        if (
            message.author.bot
        ) return;

        // ----------------------------------------------------
        // ANUNCIOS DEL SERVIDOR DE SOPORTE
        // ----------------------------------------------------

        if (
            message.channel.id ===
            GLOBAL_ANNOUNCEMENT_CHANNEL
        ) {

            const isSupport =
                SUPPORT_SERVER_ID
                    ? message.guild?.id ===
                      SUPPORT_SERVER_ID
                    : true;

            if (!isSupport) return;

            const title =
                message.content
                    .slice(0, 256) ||
                "📢 Anuncio";

            await broadcastAnnouncement(
                title,
                message.content ||
                    "Nuevo anuncio de NR INVITE.",
                null,
                message.author
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
            // COMANDOS
            // =================================================

            if (
                interaction.isChatInputCommand()
            ) {

                // ---------------------------------------------
                // PING
                // ---------------------------------------------

                if (
                    interaction.commandName ===
                    "ping"
                ) {

                    return interaction.reply({
                        content:
                            `🏓 Pong!\nLatencia: ${client.ws.ping}ms`,
                        ephemeral: true
                    });
                }

                // ---------------------------------------------
                // HELP
                // ---------------------------------------------

                if (
                    interaction.commandName ===
                    "help"
                ) {

                    const embed =
                        new EmbedBuilder()
                            .setColor(0x5865F2)
                            .setTitle(
                                "📚 NR INVITE • Ayuda"
                            )
                            .setDescription(
                                "Sistema completo de invitaciones para Discord."
                            )
                            .addFields(
                                {
                                    name:
                                        "⚙️ Configuración",
                                    value:
                                        "`/setup invite`\nConfigura bienvenida, anuncios, salida, invitaciones y reportes.",
                                    inline: false
                                },
                                {
                                    name:
                                        "🐛 Reportes",
                                    value:
                                        "`/reporte`\nEnvía un reporte mediante formulario privado por MD.",
                                    inline: false
                                },
                                {
                                    name:
                                        "🏆 Leaderboard",
                                    value:
                                        "`/leaderboard`\nMuestra quién ha conseguido más invitaciones.",
                                    inline: false
                                },
                                {
                                    name:
                                        "📢 Anuncios",
                                    value:
                                        "Los anuncios del canal global del soporte se distribuyen automáticamente.",
                                    inline: false
                                },
                                {
                                    name:
                                        "📌 Soporte",
                                    value:
                                        `[Únete al servidor de soporte](${SUPPORT_SERVER})`,
                                    inline: false
                                }
                            )
                            .setFooter({
                                text:
                                    "NR INVITE"
                            });

                    return interaction.reply({
                        embeds: [embed]
                    });
                }

                // ---------------------------------------------
                // SETUP
                // ---------------------------------------------

                if (
                    interaction.commandName ===
                    "setup"
                ) {

                    if (
                        !interaction.memberPermissions?.has(
                            PermissionsBitField.Flags.ManageGuild
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "❌ Necesitas el permiso **Gestionar servidor** para utilizar `/setup invite`.",
                            ephemeral: true
                        });
                    }

                    return interaction.reply({
                        ...setupPanel(),
                        ephemeral: true
                    });
                }

                // ---------------------------------------------
                // CONFIG
                // ---------------------------------------------

                if (
                    interaction.commandName ===
                    "config"
                ) {

                    if (
                        !interaction.memberPermissions?.has(
                            PermissionsBitField.Flags.ManageGuild
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "❌ Necesitas el permiso **Gestionar servidor**.",
                            ephemeral: true
                        });
                    }

                    return interaction.reply({
                        embeds: [
                            configDescription(
                                interaction.guild
                            )
                        ],
                        ephemeral: true
                    });
                }

                // ---------------------------------------------
                // LEADERBOARD
                // ---------------------------------------------

                if (
                    interaction.commandName ===
                    "leaderboard"
                ) {

                    const leaderboard =
                        getLeaderboard(
                            interaction.guild.id
                        );

                    if (
                        leaderboard.length === 0
                    ) {

                        return interaction.reply(
                            "🏆 Todavía no hay invitaciones registradas."
                        );
                    }

                    let description = "";

                    for (
                        let i = 0;
                        i < leaderboard.length;
                        i++
                    ) {

                        const [
                            userId,
                            count
                        ] =
                            leaderboard[i];

                        const user =
                            await client.users
                                .fetch(userId)
                                .catch(
                                    () => null
                                );

                        description +=
                            `**${i + 1}.** ${
                                user
                                    ? user.username
                                    : userId
                            } — **${count}** invitaciones\n`;
                    }

                    const embed =
                        new EmbedBuilder()
                            .setColor(0xFEE75C)
                            .setTitle(
                                "🏆 NR INVITE • Leaderboard"
                            )
                            .setDescription(
                                description
                            )
                            .setFooter({
                                text:
                                    interaction.guild.name
                            });

                    return interaction.reply({
                        embeds: [embed]
                    });
                }

                // ---------------------------------------------
                // ANUNCIO
                // ---------------------------------------------

                if (
                    interaction.commandName ===
                    "anuncio"
                ) {

                    if (
                        SUPPORT_SERVER_ID &&
                        interaction.guild.id !==
                        SUPPORT_SERVER_ID
                    ) {

                        return interaction.reply({
                            content:
                                "❌ Este comando solamente puede utilizarse desde el servidor de soporte.",
                            ephemeral: true
                        });
                    }

                    if (
                        !interaction.memberPermissions?.has(
                            PermissionsBitField.Flags.Administrator
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "❌ Necesitas permisos de administrador.",
                            ephemeral: true
                        });
                    }

                    const title =
                        interaction.options.getString(
                            "titulo"
                        );

                    const message =
                        interaction.options.getString(
                            "mensaje"
                        );

                    const image =
                        interaction.options.getString(
                            "imagen"
                        );

                    await interaction.deferReply({
                        ephemeral: true
                    });

                    const results =
                        await broadcastAnnouncement(
                            title,
                            message,
                            image,
                            interaction.user
                        );

                    const sent =
                        results.filter(
                            x => x.success
                        ).length;

                    return interaction.editReply(
                        `✅ Anuncio enviado a **${sent}/${results.length}** servidores configurados.`
                    );
                }

                // ---------------------------------------------
                // REPORTE
                // ---------------------------------------------

                if (
                    interaction.commandName ===
                    "reporte"
                ) {

                    if (
                        !interaction.guild
                    ) {

                        return interaction.reply({
                            content:
                                "❌ Debes ejecutar `/reporte` dentro de un servidor.",
                            ephemeral: true
                        });
                    }

                    return interaction.reply({
                        content:
                            "🐛 **NR INVITE • Reporte**\n\n" +
                            "Selecciona el tipo de reporte. Después recibirás las preguntas por mensaje directo.",
                        components: [
                            reportTypeMenu()
                        ],
                        ephemeral: true
                    });
                }
            }

            // =================================================
            // SETUP SELECT
            // =================================================

            if (
                interaction.isStringSelectMenu() &&
                interaction.customId ===
                "setup_select"
            ) {

                if (
                    !interaction.memberPermissions?.has(
                        PermissionsBitField.Flags.ManageGuild
                    )
                ) {
                    return interaction.reply({
                        content:
                            "❌ No tienes permisos.",
                        ephemeral: true
                    });
                }

                const value =
                    interaction.values[0];

                if (
                    value === "welcome"
                ) {

                    return interaction.showModal(
                        welcomeModal(
                            interaction.guild
                        )
                    );
                }

                if (
                    value === "goodbye"
                ) {

                    return interaction.showModal(
                        goodbyeModal(
                            interaction.guild
                        )
                    );
                }

                if (
                    value === "reports"
                ) {

                    return interaction.showModal(
                        reportConfigModal(
                            interaction.guild
                        )
                    );
                }

                if (
                    value === "announcements"
                ) {

                    return interaction.reply({
                        content:
                            "📢 Selecciona el canal donde llegarán los anuncios globales.",
                        components: [
                            announcementChannelMenu()
                        ],
                        ephemeral: true
                    });
                }

                if (
                    value === "invites"
                ) {

                    const config =
                        getConfig(
                            interaction.guild.id
                        );

                    const pingButton =
                        new ButtonBuilder()
                            .setCustomId(
                                "toggle_invite_ping"
                            )
                            .setLabel(
                                config.invites.pingInviter
                                    ? "🔔 Ping: ACTIVADO"
                                    : "🔕 Ping: DESACTIVADO"
                            )
                            .setStyle(
                                config.invites.pingInviter
                                    ? ButtonStyle.Success
                                    : ButtonStyle.Secondary
                            );

                    return interaction.reply({
                        content:
                            "📨 Selecciona el canal donde se mostrarán las invitaciones.\n\n" +
                            "El ping del invitador es opcional.",
                        components: [
                            inviteChannelMenu(),
                            new ActionRowBuilder()
                                .addComponents(
                                    pingButton
                                )
                        ],
                        ephemeral: true
                    });
                }

                if (
                    value === "view"
                ) {

                    return interaction.reply({
                        embeds: [
                            configDescription(
                                interaction.guild
                            )
                        ],
                        ephemeral: true
                    });
                }
            }

            // =================================================
            // CANAL ANUNCIOS
            // =================================================

            if (
                interaction.isChannelSelectMenu() &&
                interaction.customId ===
                "setup_announcement_channel"
            ) {

                const channel =
                    interaction.guild.channels.cache.get(
                        interaction.values[0]
                    );

                if (
                    !isPublicTextChannel(
                        channel
                    )
                ) {

                    return interaction.reply({
                        content:
                            "❌ Ese canal no es público o el bot no tiene permisos para verlo y enviar mensajes.",
                        ephemeral: true
                    });
                }

                const config =
                    getConfig(
                        interaction.guild.id
                    );

                config.announcements.channelId =
                    channel.id;

                config.announcements.enabled =
                    true;

                return interaction.update({
                    content:
                        `✅ Canal de anuncios configurado: ${channel}`,
                    components: []
                });
            }

            // =================================================
            // CANAL INVITES
            // =================================================

            if (
                interaction.isChannelSelectMenu() &&
                interaction.customId ===
                "setup_invite_channel"
            ) {

                const channel =
                    interaction.guild.channels.cache.get(
                        interaction.values[0]
                    );

                if (
                    !isPublicTextChannel(
                        channel
                    )
                ) {

                    return interaction.reply({
                        content:
                            "❌ Ese canal es privado o el bot no puede enviar mensajes allí. Selecciona un canal público.",
                        ephemeral: true
                    });
                }

                const config =
                    getConfig(
                        interaction.guild.id
                    );

                config.invites.channelId =
                    channel.id;

                config.invites.enabled =
                    true;

                return interaction.update({
                    content:
                        `✅ Canal de invitaciones configurado: ${channel}`,
                    components: []
                });
            }

            // =================================================
            // TOGGLE PING
            // =================================================

            if (
                interaction.isButton() &&
                interaction.customId ===
                "toggle_invite_ping"
            ) {

                const config =
                    getConfig(
                        interaction.guild.id
                    );

                config.invites.pingInviter =
                    !config.invites.pingInviter;

                const button =
                    new ButtonBuilder()
                        .setCustomId(
                            "toggle_invite_ping"
                        )
                        .setLabel(
                            config.invites.pingInviter
                                ? "🔔 Ping: ACTIVADO"
                                : "🔕 Ping: DESACTIVADO"
                        )
                        .setStyle(
                            config.invites.pingInviter
                                ? ButtonStyle.Success
                                : ButtonStyle.Secondary
                        );

                return interaction.update({
                    components: [
                        inviteChannelMenu(),
                        new ActionRowBuilder()
                            .addComponents(
                                button
                            )
                    ]
                });
            }

            // =================================================
            // MODAL BIENVENIDA
            // =================================================

            if (
                interaction.isModalSubmit() &&
                interaction.customId ===
                "setup_welcome_modal"
            ) {

                const message =
                    interaction.fields.getTextInputValue(
                        "welcome_message"
                    );

                const channelId =
                    interaction.fields.getTextInputValue(
                        "welcome_channel"
                    ).trim();

                const channel =
                    interaction.guild.channels.cache.get(
                        channelId
                    );

                if (
                    !isPublicTextChannel(
                        channel
                    )
                ) {

                    return interaction.reply({
                        content:
                            "❌ El canal indicado no existe, es privado o el bot no tiene permisos para enviar mensajes.",
                        ephemeral: true
                    });
                }

                const config =
                    getConfig(
                        interaction.guild.id
                    );

                config.welcome.message =
                    message;

                config.welcome.channelId =
                    channelId;

                config.welcome.enabled =
                    true;

                return interaction.reply({
                    content:
                        "✅ Bienvenida configurada correctamente.",
                    ephemeral: true
                });
            }

            // =================================================
            // MODAL SALIDA
            // =================================================

            if (
                interaction.isModalSubmit() &&
                interaction.customId ===
                "setup_goodbye_modal"
            ) {

                const message =
                    interaction.fields.getTextInputValue(
                        "goodbye_message"
                    );

                const channelId =
                    interaction.fields.getTextInputValue(
                        "goodbye_channel"
                    ).trim();

                const channel =
                    interaction.guild.channels.cache.get(
                        channelId
                    );

                if (
                    !isPublicTextChannel(
                        channel
                    )
                ) {

                    return interaction.reply({
                        content:
                            "❌ El canal indicado no existe o el bot no puede enviar mensajes.",
                        ephemeral: true
                    });
                }

                const config =
                    getConfig(
                        interaction.guild.id
                    );

                config.goodbye.message =
                    message;

                config.goodbye.channelId =
                    channelId;

                config.goodbye.enabled =
                    true;

                return interaction.reply({
                    content:
                        "✅ Mensaje de salida configurado.",
                    ephemeral: true
                });
            }

            // =================================================
            // MODAL REPORTES
            // =================================================

            if (
                interaction.isModalSubmit() &&
                interaction.customId ===
                "setup_reports_modal"
            ) {

                const email =
                    interaction.fields
                        .getTextInputValue(
                            "report_email"
                        )
                        .trim();

                const config =
                    getConfig(
                        interaction.guild.id
                    );

                config.reports.email =
                    email;

                config.reports.enabled =
                    true;

                return interaction.reply({
                    content:
                        email
                            ? `✅ Reportes configurados.\n📧 Correo: ${email}`
                            : "✅ Reportes configurados sin correo.",
                    ephemeral: true
                });
            }

            // =================================================
            // TIPO DE REPORTE
            // =================================================

            if (
                interaction.isStringSelectMenu() &&
                interaction.customId ===
                "report_type"
            ) {

                const type =
                    interaction.values[0];

                const data =
                    REPORT_TYPES[type];

                if (!data) {
                    return interaction.reply({
                        content:
                            "❌ Tipo de reporte inválido.",
                        ephemeral: true
                    });
                }

                try {

                    await interaction.user.send(
                        "🐛 **NR INVITE • Formulario de reporte**\n\n" +
                        `Has seleccionado: **${data.label}**\n\n` +
                        "Te haré 20 preguntas. Tus respuestas serán enviadas al equipo de soporte."
                    );

                } catch {

                    return interaction.reply({
                        content:
                            "❌ No puedo enviarte MD. Activa los mensajes directos del servidor y vuelve a utilizar `/reporte`.",
                        ephemeral: true
                    });
                }

                const reportId =
                    cryptoRandomId();

                activeReports.set(
                    reportId,
                    {
                        guildId:
                            interaction.guild.id,
                        userId:
                            interaction.user.id,
                        type,
                        typeLabel:
                            data.label,
                        questions:
                            data.questions,
                        answers:
                            [],
                        page: 0,
                        email:
                            getConfig(
                                interaction.guild.id
                            ).reports.email
                    }
                );

                const report =
                    activeReports.get(
                        reportId
                    );

                const modal =
                    createReportModal(
                        reportId,
                        0
                    );

                try {

                    await interaction.user.send({
                        content:
                            "📝 **Preguntas 1–5 de 20**\n\n" +
                            "Completa el siguiente formulario:",
                    });

                    await interaction.user.send({
                        components: [],
                        content:
                            "Abre el formulario mediante el botón de abajo.",
                    });

                    const button =
                        new ButtonBuilder()
                            .setCustomId(
                                `open_report_${reportId}_0`
                            )
                            .setLabel(
                                "📝 Abrir formulario"
                            )
                            .setStyle(
                                ButtonStyle.Primary
                            );

                    await interaction.user.send({
                        components: [
                            new ActionRowBuilder()
                                .addComponents(
                                    button
                                )
                        ]
                    });

                    return interaction.update({
                        content:
                            "✅ Te envié el formulario por MD.",
                        components: []
                    });

                } catch {

                    return interaction.update({
                        content:
                            "❌ No pude iniciar el reporte por MD.",
                        components: []
                    });
                }
            }

            // =================================================
            // ABRIR FORMULARIO DE REPORTE
            // =================================================

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    "open_report_"
                )
            ) {

                const parts =
                    interaction.customId.split(
                        "_"
                    );

                const reportId =
                    parts[2];

                const page =
                    Number(parts[3]);

                const modal =
                    createReportModal(
                        reportId,
                        page
                    );

                if (!modal) {

                    return interaction.reply({
                        content:
                            "❌ Este reporte ya no está disponible.",
                        ephemeral: true
                    });
                }

                return interaction.showModal(
                    modal
                );
            }

            // =================================================
            // RESPUESTAS DE REPORTES
            // =================================================

            if (
                interaction.isModalSubmit() &&
                interaction.customId.startsWith(
                    "report_modal_"
                )
            ) {

                const parts =
                    interaction.customId.split(
                        "_"
                    );

                const reportId =
                    parts[2];

                const page =
                    Number(parts[3]);

                const report =
                    activeReports.get(
                        reportId
                    );

                if (!report) {

                    return interaction.reply({
                        content:
                            "❌ Este reporte expiró.",
                        ephemeral: true
                    });
                }

                const start =
                    page * 5;

                for (
                    let i = 0;
                    i < 5;
                    i++
                ) {

                    const index =
                        start + i;

                    if (
                        index >=
                        report.questions.length
                    ) break;

                    const customId =
                        `q_${index}`;

                    try {

                        report.answers[index] =
                            interaction.fields
                                .getTextInputValue(
                                    customId
                                );

                    } catch {}
                }

                report.page =
                    page + 1;

                if (
                    start + 5 <
                    report.questions.length
                ) {

                    const nextModal =
                        createReportModal(
                            reportId,
                            page + 1
                        );

                    try {

                        await interaction.user.send({
                            content:
                                `📝 **Preguntas ${
                                    start + 6
                                }–${
                                    Math.min(
                                        start + 10,
                                        report.questions.length
                                    )
                                } de 20**`
                        });

                        const button =
                            new ButtonBuilder()
                                .setCustomId(
                                    `open_report_${reportId}_${page + 1}`
                                )
                                .setLabel(
                                    "📝 Continuar formulario"
                                )
                                .setStyle(
                                    ButtonStyle.Primary
                                );

                        await interaction.user.send({
                            components: [
                                new ActionRowBuilder()
                                    .addComponents(
                                        button
                                    )
                            ]
                        });

                        return interaction.reply({
                            content:
                                "✅ Respuestas guardadas. Revisa tus MD para continuar.",
                            ephemeral: true
                        });

                    } catch {

                        return interaction.reply({
                            content:
                                "❌ No pude continuar el formulario por MD.",
                            ephemeral: true
                        });
                    }
                }

                await sendReport(
                    report
                );

                activeReports.delete(
                    reportId
                );

                try {

                    await interaction.user.send(
                        "✅ **Reporte enviado correctamente.**\n\n" +
                        "Gracias por ayudarnos a mejorar NR INVITE. El equipo de soporte revisará tu reporte."
                    );

                } catch {}

                return interaction.reply({
                    content:
                        "✅ Tu reporte fue enviado correctamente al equipo de soporte.",
                    ephemeral: true
                });
            }

        } catch (error) {

            console.error(
                "❌ Error en interacción:",
                error
            );

            try {

                if (
                    interaction.replied ||
                    interaction.deferred
                ) {

                    await interaction.followUp({
                        content:
                            "❌ Ocurrió un error procesando esta acción.",
                        ephemeral: true
                    });

                } else {

                    await interaction.reply({
                        content:
                            "❌ Ocurrió un error procesando esta acción.",
                        ephemeral: true
                    });
                }

            } catch {}
        }
    }
);

// ============================================================
// ID ALEATORIO
// ============================================================

function cryptoRandomId() {
    return (
        Date.now().toString(36) +
        Math.random()
            .toString(36)
            .slice(2, 10)
    );
}

// ============================================================
// HTTP HEALTH CHECK PARA RENDER
// ============================================================

const http =
    require("http");

const server =
    http.createServer(
        (req, res) => {

            res.writeHead(
                200,
                {
                    "Content-Type":
                        "text/plain; charset=utf-8"
                }
            );

            res.end(
                "NR INVITE ONLINE"
            );
        }
    );

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `🌐 NR INVITE escuchando en puerto ${PORT}`
        );
    }
);

// ============================================================
// MANEJO DE ERRORES
// ============================================================

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

client.login(TOKEN);
