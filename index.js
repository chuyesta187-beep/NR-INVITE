require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionsBitField,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ChannelType,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder,
    REST,
    Routes
} = require("discord.js");

const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

// ============================================================
// NR INVITE
// SIN DASHBOARD
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("❌ Falta DISCORD_TOKEN en las variables de Render.");
    process.exit(1);
}

// ============================================================
// IDS
// ============================================================

const SUPPORT_SERVER = "https://discord.gg/PZw45tHPfc";

const REPORT_CHANNEL_ID = "1521762536586743868";
const GLOBAL_LOG_CHANNEL_ID = "1521008981269549202";
const PERIPHERAL_CHANNEL_ID = "1522104076114989056";
const GLOBAL_ANNOUNCEMENT_CHANNEL_ID = "1522103587558391942";
const STAFF_ROLE_ID = "1522126316722323497";

// ============================================================
// ARCHIVOS
// ============================================================

const DATA_DIR = path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_FILE = path.join(DATA_DIR, "nr-invite.json");

const DEFAULT_DB = {
    guilds: {},
    users: {},
    globalBans: [],
    globalBlacklist: [],
    reports: {},
    applications: {},
    ratings: {},
    reviews: {},
    invites: {},
    announcementStats: {
        sent: 0,
        failed: 0
    }
};

function loadDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(
                DB_FILE,
                JSON.stringify(DEFAULT_DB, null, 2)
            );
            return JSON.parse(JSON.stringify(DEFAULT_DB));
        }

        const raw = fs.readFileSync(DB_FILE, "utf8");

        if (!raw.trim()) {
            return JSON.parse(JSON.stringify(DEFAULT_DB));
        }

        const db = JSON.parse(raw);

        return {
            ...DEFAULT_DB,
            ...db,
            guilds: db.guilds || {},
            users: db.users || {},
            globalBans: db.globalBans || [],
            globalBlacklist: db.globalBlacklist || [],
            reports: db.reports || {},
            applications: db.applications || {},
            ratings: db.ratings || {},
            reviews: db.reviews || {},
            invites: db.invites || {},
            announcementStats: db.announcementStats || {
                sent: 0,
                failed: 0
            }
        };
    } catch (error) {
        console.error("❌ Error cargando DB:", error);

        return JSON.parse(
            JSON.stringify(DEFAULT_DB)
        );
    }
}

let db = loadDB();

function saveDB() {
    try {
        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(db, null, 2)
        );
    } catch (error) {
        console.error("❌ Error guardando DB:", error);
    }
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
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.DirectMessages
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.User
    ]
});

// ============================================================
// SMTP
// ============================================================

let transporter = null;

if (
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
) {
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure:
            String(process.env.SMTP_PORT || "587") === "465",
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

async function sendEmail(to, subject, html) {
    if (!transporter || !to) {
        console.log(
            "⚠️ Correo no enviado: SMTP no configurado o destinatario vacío."
        );
        return false;
    }

    try {
        await transporter.sendMail({
            from:
                process.env.EMAIL_FROM ||
                process.env.SMTP_USER,
            to,
            subject,
            html
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
// UTILIDADES
// ============================================================

function escapeHTML(text = "") {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function getGuildConfig(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = {
            welcomeChannel: null,
            goodbyeChannel: null,
            announcementChannel: null,
            botChannel: null,
            welcomeMessage:
                "👋 ¡Bienvenido/a a **{server}**, {user}!\n\nGracias por unirte. ¡Esperamos que disfrutes de la comunidad! ❤️",
            goodbyeMessage:
                "👋 **{user}** ha salido de **{server}**.\n\n¡Gracias por haber formado parte de nuestra comunidad!",
            configured: false
        };

        saveDB();
    }

    return db.guilds[guildId];
}

function replaceVariables(message, member, guild) {
    return String(message || "")
        .replaceAll("{user}", `<@${member.id}>`)
        .replaceAll("{username}", member.user.username)
        .replaceAll("{server}", guild.name)
        .replaceAll("{server_id}", guild.id)
        .replaceAll(
            "{members}",
            String(guild.memberCount)
        );
}

async function sendGlobalLog(title, description, fields = []) {
    try {
        const channel =
            await client.channels.fetch(
                GLOBAL_LOG_CHANNEL_ID
            );

        if (!channel || !channel.isTextBased()) {
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(title)
            .setDescription(description)
            .setTimestamp();

        if (fields.length) {
            embed.addFields(fields);
        }

        await channel.send({
            embeds: [embed]
        });
    } catch (error) {
        console.error(
            "❌ Error log global:",
            error.message
        );
    }
}

// ============================================================
// BIENVENIDA AL AÑADIR EL BOT
// ============================================================

async function sendBotJoinMessage(guild) {
    try {
        const channels = guild.channels.cache
            .filter(
                channel =>
                    channel.type === ChannelType.GuildText &&
                    channel.viewable &&
                    channel.permissionsFor(
                        guild.members.me
                    )?.has(
                        PermissionsBitField.Flags.SendMessages
                    )
            )
            .sort(
                (a, b) => a.rawPosition - b.rawPosition
            );

        const channel = channels.first();

        if (!channel) return;

        await channel.send(
`¡Hola! 👋 Soy NR INVITE.

*Gracias por añadirme a tu servidor.*

**Puedes configurar el sistema de invitaciones con:**

__/setup__

**Si necesitas ayuda o quieres conocer todas mis funciones, entra a mi servidor de soporte:**

## [Únete](${SUPPORT_SERVER})

**¡Gracias por usar NR INVITE! ❤️**`
        );
    } catch (error) {
        console.error(
            "❌ No se pudo enviar mensaje de entrada:",
            error.message
        );
    }
}

// ============================================================
// MENSAJE DE SETUP
// ============================================================

function createSetupEmbed(guild) {
    const config = getGuildConfig(guild.id);

    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("⚙️ Configuración de NR INVITE")
        .setDescription(
`Configura NR INVITE directamente desde este panel.

Selecciona una opción del menú para configurar tu servidor.

**Configuración actual**

👋 Bienvenida:
${config.welcomeChannel ? `<#${config.welcomeChannel}>` : "No configurado"}

👋 Despedida:
${config.goodbyeChannel ? `<#${config.goodbyeChannel}>` : "No configurado"}

📢 Anuncios:
${config.announcementChannel ? `<#${config.announcementChannel}>` : "No configurado"}

🤖 Canal de bots:
${config.botChannel ? `<#${config.botChannel}>` : "No configurado"}

Los mensajes de bienvenida y despedida ya tienen ejemplos incluidos.`
        )
        .setFooter({
            text: "NR INVITE • Configuración"
        });
}

function createSetupMenu() {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("setup_menu")
            .setPlaceholder(
                "Selecciona qué quieres configurar"
            )
            .addOptions(
                {
                    label: "Canal de bienvenida",
                    description:
                        "Selecciona dónde llegarán las bienvenidas",
                    value: "welcome_channel",
                    emoji: "👋"
                },
                {
                    label: "Canal de despedida",
                    description:
                        "Selecciona dónde llegarán las despedidas",
                    value: "goodbye_channel",
                    emoji: "🚪"
                },
                {
                    label: "Mensaje de bienvenida",
                    description:
                        "Personaliza el mensaje de bienvenida",
                    value: "welcome_message",
                    emoji: "💬"
                },
                {
                    label: "Mensaje de despedida",
                    description:
                        "Personaliza el mensaje de despedida",
                    value: "goodbye_message",
                    emoji: "💬"
                },
                {
                    label: "Canal de anuncios",
                    description:
                        "Selecciona dónde llegarán anuncios",
                    value: "announcement_channel",
                    emoji: "📢"
                },
                {
                    label: "Canal de bots",
                    description:
                        "Canal para avisos relacionados con bots",
                    value: "bot_channel",
                    emoji: "🤖"
                }
            )
    );
}

// ============================================================
// CANAL SELECT
// ============================================================

function channelSelector(type) {
    return new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId(`setup_channel_${type}`)
            .setPlaceholder(
                "Selecciona un canal"
            )
            .setChannelTypes(
                ChannelType.GuildText,
                ChannelType.GuildAnnouncement
            )
    );
}

// ============================================================
// MODALES
// ============================================================

function createMessageModal(type) {
    return {
        customId: `message_modal_${type}`,
        title:
            type === "welcome"
                ? "Mensaje de bienvenida"
                : "Mensaje de despedida"
    };
}

// ============================================================
// REPORTES
// ============================================================

const REPORT_TYPES = [
    "Bug",
    "Usuario",
    "Servidor",
    "Bot",
    "Seguridad",
    "Otro"
];

const REPORT_QUESTIONS = [
    "Describe exactamente qué ocurrió.",
    "¿Cuándo ocurrió?",
    "¿Dónde ocurrió?",
    "¿Qué usuario estuvo involucrado?",
    "¿Cuál es el ID del usuario involucrado?",
    "¿Cuál es el ID del servidor?",
    "¿Cuál es el nombre del servidor?",
    "¿Qué bot estaba involucrado?",
    "¿Qué comando estabas utilizando?",
    "¿Qué esperabas que ocurriera?",
    "¿Qué ocurrió realmente?",
    "¿Puedes reproducir el problema?",
    "¿Cuántas veces ocurrió?",
    "¿Afectó a otros usuarios?",
    "¿Tienes capturas de pantalla?",
    "¿Tienes vídeos?",
    "¿Tienes enlaces relacionados?",
    "¿Hay información adicional?",
    "¿Qué solución propones?",
    "¿Quieres añadir algún comentario final?"
];

// ============================================================
// POSTULACIÓN STAFF
// ============================================================

const STAFF_QUESTIONS = [
    "¿Cuál es tu nombre o apodo?",
    "¿Cuál es tu edad?",
    "¿Cuánto tiempo llevas en Discord?",
    "¿Cuánto tiempo llevas en nuestra comunidad?",
    "¿Por qué quieres ser Staff?",
    "¿Qué significa para ti ser Staff?",
    "¿Qué experiencia tienes como Staff?",
    "¿En qué servidores has sido Staff?",
    "¿Qué cargos has tenido?",
    "¿Qué funciones realizabas?",
    "¿Cuánto tiempo permaneciste en esos cargos?",
    "¿Por qué abandonaste esos cargos?",
    "¿Has recibido sanciones anteriormente?",
    "¿Has tenido problemas con otros Staff?",
    "¿Cómo reaccionas ante una discusión?",
    "¿Cómo actuarías ante una pelea?",
    "¿Qué harías ante un insulto?",
    "¿Qué harías ante spam?",
    "¿Qué harías ante flood?",
    "¿Qué harías ante publicidad no permitida?",
    "¿Qué harías ante un intento de raid?",
    "¿Qué harías ante una amenaza?",
    "¿Qué harías ante una estafa?",
    "¿Qué harías ante un usuario problemático?",
    "¿Qué harías si un amigo rompe las reglas?",
    "¿Qué harías si otro Staff rompe las reglas?",
    "¿Qué harías si un superior se equivoca?",
    "¿Aceptarías una corrección?",
    "¿Cómo manejas las críticas?",
    "¿Cómo manejas la presión?",
    "¿Cuánto tiempo puedes estar disponible?",
    "¿En qué horarios sueles estar disponible?",
    "¿Tienes experiencia con tickets?",
    "¿Tienes experiencia con moderación?",
    "¿Tienes experiencia con bots?",
    "¿Conoces los comandos básicos de moderación?",
    "¿Conoces Discord.js?",
    "¿Conoces sistemas de seguridad?",
    "¿Conoces sistemas de tickets?",
    "¿Conoces sistemas de logs?",
    "¿Sabes trabajar en equipo?",
    "¿Cómo describirías tu trabajo en equipo?",
    "¿Qué harías si dos Staff discuten?",
    "¿Qué harías si un usuario te provoca?",
    "¿Qué harías si recibes una acusación falsa?",
    "¿Qué harías si un usuario pide trato especial?",
    "¿Qué harías si alguien intenta engañarte?",
    "¿Qué harías ante una situación que no conoces?",
    "¿Pedirías ayuda a un superior?",
    "¿Cómo protegerías información privada?",
    "¿Compartirías información interna?",
    "¿Cómo tratarías una información confidencial?",
    "¿Qué importancia tienen los logs?",
    "¿Qué importancia tienen las pruebas?",
    "¿Qué importancia tiene la imparcialidad?",
    "¿Qué significa abusar de un permiso?",
    "¿Qué harías si accidentalmente sancionas a alguien incorrectamente?",
    "¿Cómo corregirías ese error?",
    "¿Qué harías ante una denuncia contra un Staff?",
    "¿Cómo investigarías una denuncia?",
    "¿Qué pruebas buscarías?",
    "¿Cómo decidirías una sanción?",
    "¿Qué harías si no estás seguro?",
    "¿Qué sanciones consideras apropiadas?",
    "¿Cómo evitarías abusar de las sanciones?",
    "¿Qué harías durante una emergencia?",
    "¿Cómo actuarías ante una raid?",
    "¿Cómo actuarías ante cuentas sospechosas?",
    "¿Cómo ayudarías a un usuario nuevo?",
    "¿Cómo mejorarías la comunidad?",
    "¿Qué aportarías al equipo?",
    "¿Qué habilidad consideras tu mayor fortaleza?",
    "¿Qué habilidad consideras tu debilidad?",
    "¿Cómo mejorarías esa debilidad?",
    "¿Por qué deberíamos elegirte?",
    "¿Hay algo más que quieras contarnos?"
];

// ============================================================
// INICIAR REPORTE POR DM
// ============================================================

const activeDMForms = new Map();

async function startReport(user, type) {
    try {
        await user.send(
`📨 **NR INVITE — REPORTE**

Has seleccionado: **${type}**

Antes de comenzar necesito un correo electrónico.

Este correo se utilizará únicamente para enviarte el resultado del reporte.

Escribe tu correo electrónico:`
        );

        activeDMForms.set(user.id, {
            type,
            step: -1,
            answers: {},
            mode: "report"
        });
    } catch {
        console.log(
            `⚠️ No se pudo enviar DM a ${user.tag}`
        );
    }
}

// ============================================================
// INICIAR POSTULACIÓN
// ============================================================

async function startApplication(user) {
    try {
        await user.send(
`👮 **NR INVITE — POSTULACIÓN STAFF**

La postulación tendrá ${STAFF_QUESTIONS.length} preguntas.

Antes de comenzar necesito un correo electrónico.

El resultado de la postulación será enviado a ese correo.

Escribe tu correo electrónico:`
        );

        activeDMForms.set(user.id, {
            step: -1,
            answers: {},
            mode: "application"
        });
    } catch {
        console.log(
            `⚠️ No se pudo enviar DM a ${user.tag}`
        );
    }
}

// ============================================================
// VALIDACIÓN EMAIL
// ============================================================

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        String(email).trim()
    );
}

// ============================================================
// PROCESAR DM
// ============================================================

client.on("messageCreate", async message => {
    if (message.author.bot) return;

    if (message.guild) {
        await handleGlobalAnnouncement(message);
        return;
    }

    const form = activeDMForms.get(
        message.author.id
    );

    if (!form) return;

    const answer = message.content.trim();

    // EMAIL
    if (form.step === -1) {
        if (!isValidEmail(answer)) {
            await message.author.send(
                "❌ Ese correo no parece válido. Escríbelo nuevamente."
            );
            return;
        }

        form.email = answer;
        form.step = 0;

        const question =
            form.mode === "report"
                ? REPORT_QUESTIONS[0]
                : STAFF_QUESTIONS[0];

        await message.author.send(
`📋 **Pregunta 1/${form.mode === "report"
    ? REPORT_QUESTIONS.length
    : STAFF_QUESTIONS.length}**

${question}`
        );

        return;
    }

    const questions =
        form.mode === "report"
            ? REPORT_QUESTIONS
            : STAFF_QUESTIONS;

    form.answers[form.step] = answer;

    form.step++;

    if (form.step < questions.length) {
        await message.author.send(
`📋 **Pregunta ${form.step + 1}/${questions.length}**

${questions[form.step]}`
        );

        return;
    }

    if (form.mode === "report") {
        await finishReport(
            message.author,
            form
        );
    } else {
        await finishApplication(
            message.author,
            form
        );
    }

    activeDMForms.delete(
        message.author.id
    );
});

// ============================================================
// FINALIZAR REPORTE
// ============================================================

async function finishReport(user, form) {
    const id =
        `REP-${Date.now()}-${user.id}`;

    db.reports[id] = {
        id,
        userId: user.id,
        username: user.tag,
        email: form.email,
        type: form.type,
        answers: form.answers,
        status: "Pendiente",
        createdAt: new Date().toISOString()
    };

    saveDB();

    const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle("📨 Nuevo reporte")
        .setDescription(
            `**ID:** \`${id}\`\n**Tipo:** ${form.type}\n**Usuario:** <@${user.id}>\n**Correo:** ${form.email}`
        )
        .setTimestamp();

    const questions = REPORT_QUESTIONS;

    for (let i = 0; i < questions.length; i++) {
        const value =
            form.answers[i] || "Sin respuesta";

        embed.addFields({
            name: `${i + 1}. ${questions[i]}`.slice(0, 256),
            value: value.slice(0, 1024)
        });
    }

    const buttons =
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(
                    `report_resolve_${id}`
                )
                .setLabel("Resolver")
                .setStyle(ButtonStyle.Success)
                .setEmoji("✅"),

            new ButtonBuilder()
                .setCustomId(
                    `report_deny_${id}`
                )
                .setLabel("Denegar")
                .setStyle(ButtonStyle.Danger)
                .setEmoji("❌")
        );

    const channel =
        await client.channels.fetch(
            REPORT_CHANNEL_ID
        );

    if (channel && channel.isTextBased()) {
        await channel.send({
            embeds: [embed],
            components: [buttons]
        });
    }

    await user.send(
`✅ **Reporte enviado correctamente.**

ID: \`${id}\`

Tu reporte fue enviado al equipo correspondiente.

Cuando sea resuelto recibirás el resultado por correo electrónico.`
    );

    await sendGlobalLog(
        "📨 Nuevo reporte",
        `Se recibió un nuevo reporte **${id}**.`,
        [
            {
                name: "Usuario",
                value: `${user.tag} (${user.id})`
            },
            {
                name: "Tipo",
                value: form.type
            }
        ]
    );
}

// ============================================================
// FINALIZAR POSTULACIÓN
// ============================================================

async function finishApplication(user, form) {
    const id =
        `APP-${Date.now()}-${user.id}`;

    db.applications[id] = {
        id,
        userId: user.id,
        username: user.tag,
        email: form.email,
        answers: form.answers,
        status: "Pendiente",
        createdAt: new Date().toISOString()
    };

    saveDB();

    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle("👮 Nueva postulación Staff")
        .setDescription(
            `**ID:** \`${id}\`\n**Usuario:** <@${user.id}>\n**Correo:** ${form.email}`
        )
        .setTimestamp();

    for (
        let i = 0;
        i < STAFF_QUESTIONS.length;
        i++
    ) {
        embed.addFields({
            name:
                `${i + 1}. ${STAFF_QUESTIONS[i]}`
                    .slice(0, 256),
            value:
                (
                    form.answers[i] ||
                    "Sin respuesta"
                ).slice(0, 1024)
        });
    }

    const channel =
        await client.channels.fetch(
            REPORT_CHANNEL_ID
        );

    if (channel && channel.isTextBased()) {
        const buttons =
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        `app_approve_${id}`
                    )
                    .setLabel("Aceptar")
                    .setStyle(
                        ButtonStyle.Success
                    )
                    .setEmoji("✅"),

                new ButtonBuilder()
                    .setCustomId(
                        `app_deny_${id}`
                    )
                    .setLabel("Denegar")
                    .setStyle(
                        ButtonStyle.Danger
                    )
                    .setEmoji("❌")
            );

        await channel.send({
            embeds: [embed],
            components: [buttons]
        });
    }

    await user.send(
`✅ **Postulación enviada correctamente.**

ID: \`${id}\`

Tu postulación será revisada por el equipo.`
    );

    await sendGlobalLog(
        "👮 Nueva postulación",
        `Nueva postulación Staff: **${id}**`,
        [
            {
                name: "Usuario",
                value: `${user.tag} (${user.id})`
            }
        ]
    );
}

// ============================================================
// ANUNCIO GLOBAL
// ============================================================

async function handleGlobalAnnouncement(message) {
    if (
        message.channel.id !==
        GLOBAL_ANNOUNCEMENT_CHANNEL_ID
    ) {
        return;
    }

    if (
        message.author.bot
    ) {
        return;
    }

    const supportGuild =
        message.guild;

    if (!supportGuild) return;

    // Solamente mensajes del canal configurado
    // se consideran anuncios globales.

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(
            message.member?.displayName ||
            message.author.username
        )
        .setDescription(
            message.content ||
            "Nuevo anuncio"
        )
        .setTimestamp();

    if (message.attachments.size) {
        const first =
            message.attachments.first();

        if (
            first &&
            first.contentType?.startsWith(
                "image/"
            )
        ) {
            embed.setImage(first.url);
        }
    }

    const row =
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(
                    `announcement_menu_${message.id}`
                )
                .setPlaceholder(
                    "Selecciona una opción"
                )
                .addOptions(
                    {
                        label: "Valorar",
                        description:
                            "Valora este anuncio de 1 a 5 estrellas",
                        value: "rate",
                        emoji: "⭐"
                    },
                    {
                        label: "Reseñar",
                        description:
                            "Deja una reseña o sugerencia",
                        value: "review",
                        emoji: "📝"
                    },
                    {
                        label: "Reportar bot",
                        description:
                            "Reporta un problema relacionado con el bot",
                        value: "report",
                        emoji: "🐛"
                    },
                    {
                        label: "Postulación Staff",
                        description:
                            "Inicia la postulación por DM",
                        value: "staff",
                        emoji: "👮"
                    }
                )
        );

    let sent = 0;
    let failed = 0;

    for (const guild of client.guilds.cache.values()) {
        try {
            const config =
                getGuildConfig(guild.id);

            let channel = null;

            if (
                config.announcementChannel
            ) {
                channel =
                    guild.channels.cache.get(
                        config.announcementChannel
                    );
            }

            if (
                !channel ||
                !channel.isTextBased()
            ) {
                channel =
                    guild.channels.cache
                        .filter(
                            c =>
                                c.type ===
                                    ChannelType.GuildText &&
                                c.viewable &&
                                c.permissionsFor(
                                    guild.members.me
                                )?.has(
                                    PermissionsBitField.Flags.SendMessages
                                )
                        )
                        .sort(
                            (a, b) =>
                                a.rawPosition -
                                b.rawPosition
                        )
                        .first();
            }

            if (!channel) {
                failed++;
                continue;
            }

            await channel.send({
                embeds: [embed],
                components: [row]
            });

            sent++;
        } catch (error) {
            failed++;
        }
    }

    db.announcementStats.sent += sent;
    db.announcementStats.failed += failed;

    saveDB();

    await sendGlobalLog(
        "📢 Anuncio global enviado",
        `Un anuncio fue distribuido globalmente.`,
        [
            {
                name: "Enviados",
                value: String(sent),
                inline: true
            },
            {
                name: "Fallidos",
                value: String(failed),
                inline: true
            }
        ]
    );
}

// ============================================================
// INVITES
// ============================================================

async function updateInviteCache(guild) {
    try {
        const invites =
            await guild.invites.fetch();

        db.invites[guild.id] = {};

        for (const invite of invites.values()) {
            db.invites[guild.id][invite.code] = {
                uses: invite.uses || 0,
                inviter:
                    invite.inviter?.id ||
                    null
            };
        }

        saveDB();
    } catch (error) {
        console.log(
            `No se pudieron cargar invites de ${guild.name}: ${error.message}`
        );
    }
}

client.on(
    "inviteCreate",
    async invite => {
        if (!invite.guild) return;

        if (!db.invites[invite.guild.id]) {
            db.invites[invite.guild.id] = {};
        }

        db.invites[invite.guild.id][
            invite.code
        ] = {
            uses: invite.uses || 0,
            inviter:
                invite.inviter?.id ||
                null
        };

        saveDB();
    }
);

// ============================================================
// MEMBER JOIN
// ============================================================

client.on(
    "guildMemberAdd",
    async member => {
        const guild = member.guild;
        const config =
            getGuildConfig(guild.id);

        if (
            db.globalBans.includes(
                member.id
            ) ||
            db.globalBlacklist.includes(
                member.id
            )
        ) {
            try {
                await member.send(
`🚫 No puedes participar en este servidor porque tu cuenta está bloqueada globalmente por NR INVITE.

Si crees que se trata de un error, entra al servidor de soporte:
${SUPPORT_SERVER}`
                );
            } catch {}

            try {
                await member.kick(
                    "Bloqueo global NR INVITE"
                );
            } catch {}

            return;
        }

        if (config.welcomeChannel) {
            const channel =
                guild.channels.cache.get(
                    config.welcomeChannel
                );

            if (
                channel &&
                channel.isTextBased()
            ) {
                await channel.send(
                    replaceVariables(
                        config.welcomeMessage,
                        member,
                        guild
                    )
                );
            }
        }

        if (config.announcementChannel) {
            // El canal ya queda configurado.
        }

        if (config.botChannel) {
            if (member.user.bot) {
                const channel =
                    guild.channels.cache.get(
                        config.botChannel
                    );

                if (
                    channel &&
                    channel.isTextBased()
                ) {
                    await channel.send(
`🤖 Se ha añadido un bot al servidor: **${member.user.tag}**`
                    );
                }
            }
        }

        await sendGlobalLog(
            "📥 Usuario entró",
            `Un usuario entró a un servidor donde está NR INVITE.`,
            [
                {
                    name: "Usuario",
                    value: `${member.user.tag} (${member.id})`
                },
                {
                    name: "Servidor",
                    value: `${guild.name} (${guild.id})`
                }
            ]
        );
    }
);

// ============================================================
// MEMBER LEAVE
// ============================================================

client.on(
    "guildMemberRemove",
    async member => {
        const guild = member.guild;
        const config =
            getGuildConfig(guild.id);

        if (
            config.goodbyeChannel
        ) {
            const channel =
                guild.channels.cache.get(
                    config.goodbyeChannel
                );

            if (
                channel &&
                channel.isTextBased()
            ) {
                const fakeMember = {
                    id: member.id,
                    user: member.user
                };

                await channel.send(
                    replaceVariables(
                        config.goodbyeMessage,
                        fakeMember,
                        guild
                    )
                );
            }
        }
    }
);

// ============================================================
// BOT READY
// ============================================================

client.once(
    "clientReady",
    async () => {
        console.log(
            `✅ NR INVITE conectado como ${client.user.tag}`
        );

        console.log(
            `🌐 Servidores: ${client.guilds.cache.size}`
        );

        for (
            const guild of client.guilds.cache.values()
        ) {
            getGuildConfig(guild.id);

            try {
                await updateInviteCache(
                    guild
                );
            } catch {}
        }

        saveDB();

        await registerCommands();
    }
);

// ============================================================
// COMANDOS
// ============================================================

const commands = [

    new SlashCommandBuilder()
        .setName("setup")
        .setDescription(
            "Configura NR INVITE en tu servidor"
        ),

    new SlashCommandBuilder()
        .setName("reporte")
        .setDescription(
            "Realiza un reporte mediante DM"
        )
        .addStringOption(option =>
            option
                .setName("tipo")
                .setDescription(
                    "Tipo de reporte"
                )
                .setRequired(true)
                .addChoices(
                    ...REPORT_TYPES.map(type => ({
                        name: type,
                        value: type
                    }))
                )
        ),

    new SlashCommandBuilder()
        .setName("help")
        .setDescription(
            "Muestra la guía de NR INVITE"
        ),

    new SlashCommandBuilder()
        .setName("leaderboard")
        .setDescription(
            "Muestra el ranking de invitaciones"
        ),

    new SlashCommandBuilder()
        .setName("setup-invite")
        .setDescription(
            "Alias de configuración de NR INVITE"
        ),

    // ==========================
    // PERIFÉRICO
    // ==========================

    new SlashCommandBuilder()
        .setName("ban-global")
        .setDescription(
            "Bloquea globalmente a un usuario"
        )
        .addUserOption(option =>
            option
                .setName("usuario")
                .setDescription(
                    "Usuario a bloquear"
                )
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("razon")
                .setDescription(
                    "Razón del bloqueo"
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("unban-global")
        .setDescription(
            "Quita un bloqueo global"
        )
        .addUserOption(option =>
            option
                .setName("usuario")
                .setDescription(
                    "Usuario"
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("black-global")
        .setDescription(
            "Añade un usuario a la blacklist global"
        )
        .addUserOption(option =>
            option
                .setName("usuario")
                .setDescription(
                    "Usuario"
                )
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("razon")
                .setDescription(
                    "Razón"
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("unblack-global")
        .setDescription(
            "Quita un usuario de la blacklist global"
        )
        .addUserOption(option =>
            option
                .setName("usuario")
                .setDescription(
                    "Usuario"
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("global-info")
        .setDescription(
            "Consulta información global de un usuario"
        )
        .addUserOption(option =>
            option
                .setName("usuario")
                .setDescription(
                    "Usuario"
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("guia")
        .setDescription(
            "Muestra la guía del periférico"
        )
].map(command =>
    command.toJSON()
);

// ============================================================
// REGISTRAR COMANDOS
// ============================================================

async function registerCommands() {
    try {
        const rest =
            new REST({
                version: "10"
            }).setToken(TOKEN);

        await rest.put(
            Routes.applicationCommands(
                client.user.id
            ),
            {
                body: commands
            }
        );

        console.log(
            "✅ Comandos registrados globalmente."
        );
    } catch (error) {
        console.error(
            "❌ Error registrando comandos:",
            error
        );
    }
}

// ============================================================
// INTERACCIONES
// ============================================================

client.on(
    "interactionCreate",
    async interaction => {

        // ====================================================
        // SLASH COMMAND
        // ====================================================

        if (interaction.isChatInputCommand()) {

            // ------------------------------
            // SETUP
            // ------------------------------

            if (
                interaction.commandName ===
                    "setup" ||
                interaction.commandName ===
                    "setup-invite"
            ) {

                if (
                    !interaction.memberPermissions?.has(
                        PermissionsBitField.Flags.ManageGuild
                    )
                ) {
                    return interaction.reply({
                        content:
                            "❌ Necesitas el permiso **Administrar servidor** para utilizar esta configuración.",
                        ephemeral: true
                    });
                }

                getGuildConfig(
                    interaction.guild.id
                );

                return interaction.reply({
                    embeds: [
                        createSetupEmbed(
                            interaction.guild
                        )
                    ],
                    components: [
                        createSetupMenu()
                    ],
                    ephemeral: true
                });
            }

            // ------------------------------
            // REPORTE
            // ------------------------------

            if (
                interaction.commandName ===
                "reporte"
            ) {
                const type =
                    interaction.options.getString(
                        "tipo"
                    );

                if (
                    db.globalBans.includes(
                        interaction.user.id
                    ) ||
                    db.globalBlacklist.includes(
                        interaction.user.id
                    )
                ) {
                    return interaction.reply({
                        content:
                            "❌ No puedes utilizar el sistema de reportes.",
                        ephemeral: true
                    });
                }

                await interaction.reply({
                    content:
                        "📨 Te envié un mensaje privado para comenzar el formulario.",
                    ephemeral: true
                });

                await startReport(
                    interaction.user,
                    type
                );

                return;
            }

            // ------------------------------
            // HELP
            // ------------------------------

            if (
                interaction.commandName ===
                "help"
            ) {
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                0x5865F2
                            )
                            .setTitle(
                                "📚 NR INVITE"
                            )
                            .setDescription(
`## Comandos públicos

**/setup**
Configura el sistema de invitaciones.

**/reporte**
Envía un reporte mediante DM.

**/leaderboard**
Muestra el ranking de invitaciones.

**/help**
Muestra esta guía.

## ⚙️ Soporte

${SUPPORT_SERVER}

Los comandos globales del Staff funcionan exclusivamente desde el canal administrativo del servidor de soporte.`
                            )
                            .setTimestamp()
                    ],
                    ephemeral: true
                });
            }

            // ------------------------------
            // LEADERBOARD
            // ------------------------------

            if (
                interaction.commandName ===
                "leaderboard"
            ) {

                const guildId =
                    interaction.guild.id;

                const users = Object.entries(
                    db.users
                )
                    .filter(
                        ([id, data]) =>
                            data.guilds?.[
                                guildId
                            ]
                    )
                    .map(
                        ([id, data]) => ({
                            id,
                            invites:
                                data.guilds[
                                    guildId
                                ].invites || 0
                        })
                    )
                    .sort(
                        (a, b) =>
                            b.invites -
                            a.invites
                    )
                    .slice(0, 10);

                if (!users.length) {
                    return interaction.reply({
                        content:
                            "📊 Todavía no hay datos de invitaciones.",
                        ephemeral: true
                    });
                }

                let text = "";

                users.forEach(
                    (user, index) => {
                        text += `${index + 1}. <@${user.id}> — **${user.invites}** invitaciones\n`;
                    }
                );

                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                0xFEE75C
                            )
                            .setTitle(
                                "🏆 Leaderboard de invitaciones"
                            )
                            .setDescription(
                                text
                            )
                            .setTimestamp()
                    ]
                });
            }

            // =================================================
            // PERIFÉRICO
            // =================================================

            const peripheralCommands = [
                "ban-global",
                "unban-global",
                "black-global",
                "unblack-global",
                "global-info",
                "guia"
            ];

            if (
                peripheralCommands.includes(
                    interaction.commandName
                )
            ) {

                if (
                    interaction.channelId !==
                    PERIPHERAL_CHANNEL_ID
                ) {
                    return interaction.reply({
                        content:
                            "❌ Este comando solamente puede utilizarse en el canal periférico autorizado.",
                        ephemeral: true
                    });
                }

                const member =
                    interaction.member;

                if (
                    !member.roles.cache.has(
                        STAFF_ROLE_ID
                    )
                ) {
                    return interaction.reply({
                        content:
                            "❌ No tienes acceso al periférico.",
                        ephemeral: true
                    });
                }

                // ==============================
                // GUIA
                // ==============================

                if (
                    interaction.commandName ===
                    "guia"
                ) {
                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    0x5865F2
                                )
                                .setTitle(
                                    "⚙️ Periférico NR INVITE"
                                )
                                .setDescription(
`Este sistema es exclusivo para Staff.

### 🌎 Moderación global

\`/ban-global\`
Bloquea un usuario globalmente.

\`/unban-global\`
Quita un bloqueo global.

\`/black-global\`
Añade un usuario a la blacklist global.

\`/unblack-global\`
Quita un usuario de la blacklist.

\`/global-info\`
Consulta el estado global de un usuario.

### 📢 Anuncios

Los anuncios enviados desde el canal global configurado son distribuidos automáticamente a los servidores que tengan configurado un canal de anuncios.

### 📋 Canal periférico

<#${
    PERIPHERAL_CHANNEL_ID
}>`
                                )
                        ],
                        ephemeral: true
                    });
                }

                // ==============================
                // BAN GLOBAL
                // ==============================

                if (
                    interaction.commandName ===
                    "ban-global"
                ) {
                    const user =
                        interaction.options.getUser(
                            "usuario"
                        );

                    const reason =
                        interaction.options.getString(
                            "razon"
                        );

                    if (
                        !db.globalBans.includes(
                            user.id
                        )
                    ) {
                        db.globalBans.push(
                            user.id
                        );
                    }

                    saveDB();

                    try {
                        await user.send(
`🚫 Has sido bloqueado globalmente de NR INVITE.

**Razón:** ${reason}`
                        );
                    } catch {}

                    await sendGlobalLog(
                        "🚫 BAN GLOBAL",
                        `Un usuario fue bloqueado globalmente.`,
                        [
                            {
                                name: "Usuario",
                                value:
                                    `${user.tag} (${user.id})`
                            },
                            {
                                name: "Razón",
                                value:
                                    reason
                            },
                            {
                                name: "Staff",
                                value:
                                    `${interaction.user.tag} (${interaction.user.id})`
                            }
                        ]
                    );

                    return interaction.reply({
                        content:
                            `✅ **${user.tag}** fue bloqueado globalmente.`,
                        ephemeral: true
                    });
                }

                // ==============================
                // UNBAN
                // ==============================

                if (
                    interaction.commandName ===
                    "unban-global"
                ) {
                    const user =
                        interaction.options.getUser(
                            "usuario"
                        );

                    db.globalBans =
                        db.globalBans.filter(
                            id =>
                                id !==
                                user.id
                        );

                    saveDB();

                    await sendGlobalLog(
                        "✅ UNBAN GLOBAL",
                        `Se eliminó un bloqueo global.`,
                        [
                            {
                                name: "Usuario",
                                value:
                                    `${user.tag} (${user.id})`
                            },
                            {
                                name: "Staff",
                                value:
                                    `${interaction.user.tag} (${interaction.user.id})`
                            }
                        ]
                    );

                    return interaction.reply({
                        content:
                            `✅ **${user.tag}** ya no está bloqueado globalmente.`,
                        ephemeral: true
                    });
                }

                // ==============================
                // BLACK GLOBAL
                // ==============================

                if (
                    interaction.commandName ===
                    "black-global"
                ) {
                    const user =
                        interaction.options.getUser(
                            "usuario"
                        );

                    const reason =
                        interaction.options.getString(
                            "razon"
                        );

                    if (
                        !db.globalBlacklist.includes(
                            user.id
                        )
                    ) {
                        db.globalBlacklist.push(
                            user.id
                        );
                    }

                    saveDB();

                    try {
                        await user.send(
`⛔ Has sido añadido a la blacklist global de NR INVITE.

**Razón:** ${reason}`
                        );
                    } catch {}

                    await sendGlobalLog(
                        "⛔ BLACKLIST GLOBAL",
                        `Un usuario fue añadido a la blacklist global.`,
                        [
                            {
                                name: "Usuario",
                                value:
                                    `${user.tag} (${user.id})`
                            },
                            {
                                name: "Razón",
                                value:
                                    reason
                            },
                            {
                                name: "Staff",
                                value:
                                    `${interaction.user.tag} (${interaction.user.id})`
                            }
                        ]
                    );

                    return interaction.reply({
                        content:
                            `⛔ **${user.tag}** fue añadido a la blacklist global.`,
                        ephemeral: true
                    });
                }

                // ==============================
                // UNBLACK
                // ==============================

                if (
                    interaction.commandName ===
                    "unblack-global"
                ) {
                    const user =
                        interaction.options.getUser(
                            "usuario"
                        );

                    db.globalBlacklist =
                        db.globalBlacklist.filter(
                            id =>
                                id !==
                                user.id
                        );

                    saveDB();

                    await sendGlobalLog(
                        "✅ UNBLACK GLOBAL",
                        `Se eliminó un usuario de la blacklist.`,
                        [
                            {
                                name: "Usuario",
                                value:
                                    `${user.tag} (${user.id})`
                            },
                            {
                                name: "Staff",
                                value:
                                    `${interaction.user.tag} (${interaction.user.id})`
                            }
                        ]
                    );

                    return interaction.reply({
                        content:
                            `✅ **${user.tag}** fue eliminado de la blacklist global.`,
                        ephemeral: true
                    });
                }

                // ==============================
                // GLOBAL INFO
                // ==============================

                if (
                    interaction.commandName ===
                    "global-info"
                ) {
                    const user =
                        interaction.options.getUser(
                            "usuario"
                        );

                    const banned =
                        db.globalBans.includes(
                            user.id
                        );

                    const blacklisted =
                        db.globalBlacklist.includes(
                            user.id
                        );

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    banned ||
                                    blacklisted
                                        ? 0xED4245
                                        : 0x57F287
                                )
                                .setTitle(
                                    "🌎 Información global"
                                )
                                .setThumbnail(
                                    user.displayAvatarURL()
                                )
                                .addFields(
                                    {
                                        name:
                                            "Usuario",
                                        value:
                                            `${user.tag}\n\`${user.id}\``
                                    },
                                    {
                                        name:
                                            "Ban global",
                                        value:
                                            banned
                                                ? "🚫 Sí"
                                                : "✅ No",
                                        inline: true
                                    },
                                    {
                                        name:
                                            "Blacklist",
                                        value:
                                            blacklisted
                                                ? "⛔ Sí"
                                                : "✅ No",
                                        inline: true
                                    }
                                )
                        ],
                        ephemeral: true
                    });
                }
            }
        }

        // ====================================================
        // SELECT SETUP
        // ====================================================

        if (
            interaction.isStringSelectMenu() &&
            interaction.customId ===
                "setup_menu"
        ) {

            if (
                !interaction.memberPermissions?.has(
                    PermissionsBitField.Flags.ManageGuild
                )
            ) {
                return interaction.reply({
                    content:
                        "❌ No tienes permiso para configurar el servidor.",
                    ephemeral: true
                });
            }

            const selected =
                interaction.values[0];

            if (
                selected ===
                    "welcome_channel" ||
                selected ===
                    "goodbye_channel" ||
                selected ===
                    "announcement_channel" ||
                selected ===
                    "bot_channel"
            ) {

                const type =
                    selected.replace(
                        "_channel",
                        ""
                    );

                return interaction.reply({
                    content:
                        "Selecciona el canal que quieres utilizar:",
                    components: [
                        channelSelector(
                            type
                        )
                    ],
                    ephemeral: true
                });
            }

            if (
                selected ===
                "welcome_message"
            ) {

                return interaction.reply({
                    content:
`✏️ **Mensaje actual de bienvenida**

${getGuildConfig(interaction.guild.id).welcomeMessage}

Variables disponibles:

\`{user}\`
\`{username}\`
\`{server}\`
\`{server_id}\`
\`{members}\`

Para cambiarlo utiliza:

\`/setup\` → Mensaje de bienvenida`,
                    ephemeral: true
                });
            }

            if (
                selected ===
                "goodbye_message"
            ) {

                return interaction.reply({
                    content:
`✏️ **Mensaje actual de despedida**

${getGuildConfig(interaction.guild.id).goodbyeMessage}

Variables disponibles:

\`{user}\`
\`{username}\`
\`{server}\`
\`{server_id}\`
\`{members}\`

Para cambiarlo utiliza:

\`/setup\` → Mensaje de despedida`,
                    ephemeral: true
                });
            }
        }

        // ====================================================
        // SELECT DE CANALES
        // ====================================================

        if (
            interaction.isChannelSelectMenu()
        ) {

            if (
                !interaction.customId.startsWith(
                    "setup_channel_"
                )
            ) return;

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

            const type =
                interaction.customId.replace(
                    "setup_channel_",
                    ""
                );

            const channelId =
                interaction.values[0];

            const config =
                getGuildConfig(
                    interaction.guild.id
                );

            if (
                type === "welcome"
            ) {
                config.welcomeChannel =
                    channelId;
            }

            if (
                type === "goodbye"
            ) {
                config.goodbyeChannel =
                    channelId;
            }

            if (
                type === "announcement"
            ) {
                config.announcementChannel =
                    channelId;
            }

            if (
                type === "bot"
            ) {
                config.botChannel =
                    channelId;
            }

            config.configured = true;

            saveDB();

            return interaction.update({
                content:
                    `✅ Canal configurado correctamente: <#${channelId}>`,
                components: []
            });
        }

        // ====================================================
        // ANUNCIO MENU
        // ====================================================

        if (
            interaction.isStringSelectMenu() &&
            interaction.customId.startsWith(
                "announcement_menu_"
            )
        ) {

            const value =
                interaction.values[0];

            if (
                value === "rate"
            ) {

                const row =
                    new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(
                                `rating_${interaction.message.id}`
                            )
                            .setPlaceholder(
                                "Selecciona tu valoración"
                            )
                            .addOptions(
                                [1, 2, 3, 4, 5].map(
                                    number => ({
                                        label:
                                            `${number} estrella${number === 1 ? "" : "s"}`,
                                        description:
                                            `Valorar con ${number}/5`,
                                        value:
                                            String(
                                                number
                                            ),
                                        emoji:
                                            "⭐"
                                    })
                                )
                            )
                    );

                return interaction.reply({
                    content:
                        "⭐ Selecciona tu valoración:",
                    components: [row],
                    ephemeral: true
                });
            }

            if (
                value === "review"
            ) {
                return interaction.reply({
                    content:
`📝 Para dejar una reseña, envíame por DM:

**RESEÑA: tu opinión**

El mensaje será registrado para el equipo de NR INVITE.`,
                    ephemeral: true
                });
            }

            if (
                value === "report"
            ) {
                await interaction.reply({
                    content:
                        "🐛 Te enviaré el formulario de reporte por DM.",
                    ephemeral: true
                });

                await startReport(
                    interaction.user,
                    "Bot"
                );

                return;
            }

            if (
                value === "staff"
            ) {
                await interaction.reply({
                    content:
                        "👮 Te enviaré la postulación Staff por DM.",
                    ephemeral: true
                });

                await startApplication(
                    interaction.user
                );

                return;
            }
        }

        // ====================================================
        // RATING
        // ====================================================

        if (
            interaction.isStringSelectMenu() &&
            interaction.customId.startsWith(
                "rating_"
            )
        ) {

            const rating =
                Number(
                    interaction.values[0]
                );

            if (
                !db.ratings[
                    interaction.user.id
                ]
            ) {
                db.ratings[
                    interaction.user.id
                ] = [];
            }

            db.ratings[
                interaction.user.id
            ].push({
                rating,
                createdAt:
                    new Date().toISOString()
            });

            saveDB();

            return interaction.update({
                content:
                    `⭐ Gracias por valorar NR INVITE con **${rating}/5 estrellas**.`,
                components: []
            });
        }

        // ====================================================
        // BOTONES REPORTES
        // ====================================================

        if (
            interaction.isButton()
        ) {

            const custom =
                interaction.customId;

            if (
                custom.startsWith(
                    "report_resolve_"
                )
            ) {

                if (
                    !interaction.channel
                        ?.permissionsFor(
                            interaction.member
                        )
                        ?.has(
                            PermissionsBitField.Flags.ViewChannel
                        )
                ) {
                    return interaction.reply({
                        content:
                            "❌ No tienes acceso a este reporte.",
                        ephemeral: true
                    });
                }

                const id =
                    custom.replace(
                        "report_resolve_",
                        ""
                    );

                const report =
                    db.reports[id];

                if (!report) {
                    return interaction.reply({
                        content:
                            "❌ Reporte no encontrado.",
                        ephemeral: true
                    });
                }

                report.status =
                    "Resuelto";

                report.resolvedBy =
                    interaction.user.id;

                saveDB();

                await sendEmail(
                    report.email,
                    `NR INVITE — Reporte ${id} resuelto`,
                    `<h2>Reporte resuelto</h2>
<p>Tu reporte <b>${escapeHTML(id)}</b> ha sido resuelto.</p>
<p><b>Razón:</b> El equipo de soporte ha revisado tu reporte.</p>
<p>Gracias por ayudar a mejorar NR INVITE.</p>`
                );

                return interaction.reply({
                    content:
                        `✅ Reporte \`${id}\` marcado como resuelto y se notificó al correo.`,
                    ephemeral: false
                });
            }

            if (
                custom.startsWith(
                    "report_deny_"
                )
            ) {

                const id =
                    custom.replace(
                        "report_deny_",
                        ""
                    );

                const report =
                    db.reports[id];

                if (!report) {
                    return interaction.reply({
                        content:
                            "❌ Reporte no encontrado.",
                        ephemeral: true
                    });
                }

                report.status =
                    "Denegado";

                report.deniedBy =
                    interaction.user.id;

                saveDB();

                await sendEmail(
                    report.email,
                    `NR INVITE — Reporte ${id} denegado`,
                    `<h2>Reporte denegado</h2>
<p>Tu reporte <b>${escapeHTML(id)}</b> fue revisado y denegado.</p>
<p>Si consideras que existe un error, puedes realizar un nuevo reporte.</p>`
                );

                return interaction.reply({
                    content:
                        `❌ Reporte \`${id}\` denegado y se notificó al correo.`,
                    ephemeral: false
                });
            }

            // =================================================
            // POSTULACIÓN ACEPTAR
            // =================================================

            if (
                custom.startsWith(
                    "app_approve_"
                )
            ) {

                const id =
                    custom.replace(
                        "app_approve_",
                        ""
                    );

                const application =
                    db.applications[id];

                if (!application) {
                    return interaction.reply({
                        content:
                            "❌ Postulación no encontrada.",
                        ephemeral: true
                    });
                }

                application.status =
                    "Aceptada";

                application.reviewedBy =
                    interaction.user.id;

                saveDB();

                await sendEmail(
                    application.email,
                    `NR INVITE — Postulación ${id}`,
                    `<h2>🎉 Postulación aceptada</h2>
<p>Tu postulación para Staff de NR INVITE ha sido <b>aceptada</b>.</p>
<p>El equipo se pondrá en contacto contigo para los siguientes pasos.</p>`
                );

                try {
                    const user =
                        await client.users.fetch(
                            application.userId
                        );

                    await user.send(
`🎉 **¡Tu postulación Staff fue aceptada!**

Tu postulación \`${id}\` fue aceptada.

Revisa también el correo electrónico que proporcionaste.`
                    );
                } catch {}

                return interaction.reply({
                    content:
                        `✅ Postulación \`${id}\` aceptada y resultado enviado.`,
                    ephemeral: false
                });
            }

            // =================================================
            // POSTULACIÓN DENEGAR
            // =================================================

            if (
                custom.startsWith(
                    "app_deny_"
                )
            ) {

                const id =
                    custom.replace(
                        "app_deny_",
                        ""
                    );

                const application =
                    db.applications[id];

                if (!application) {
                    return interaction.reply({
                        content:
                            "❌ Postulación no encontrada.",
                        ephemeral: true
                    });
                }

                application.status =
                    "Denegada";

                application.reviewedBy =
                    interaction.user.id;

                saveDB();

                await sendEmail(
                    application.email,
                    `NR INVITE — Postulación ${id}`,
                    `<h2>Postulación no aceptada</h2>
<p>Tu postulación <b>${escapeHTML(id)}</b> no fue aceptada en esta ocasión.</p>
<p>Puedes volver a intentarlo cuando se abran nuevas postulaciones.</p>`
                );

                try {
                    const user =
                        await client.users.fetch(
                            application.userId
                        );

                    await user.send(
`❌ **Tu postulación Staff no fue aceptada.**

Tu postulación \`${id}\` fue denegada.

El resultado también fue enviado al correo electrónico proporcionado.`
                    );
                } catch {}

                return interaction.reply({
                    content:
                        `❌ Postulación \`${id}\` denegada y resultado enviado.`,
                    ephemeral: false
                });
            }
        }
    }
);

// ============================================================
// EXPRESS — HEALTH CHECK PARA RENDER
// ============================================================

const http =
    require("http");

const PORT =
    Number(process.env.PORT) || 10000;

const server =
    http.createServer(
        (req, res) => {
            if (
                req.url === "/" ||
                req.url === "/health"
            ) {
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

                return;
            }

            res.writeHead(
                404,
                {
                    "Content-Type":
                        "text/plain; charset=utf-8"
                }
            );

            res.end(
                "Not Found"
            );
        }
    );

server.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `🌐 NR INVITE iniciado en puerto ${PORT}`
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
