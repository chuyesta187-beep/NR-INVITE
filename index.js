const express = require("express");
const session = require("express-session");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const {
    Client,
    GatewayIntentBits,
    Partials,
    Collection,
    REST,
    Routes,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ActivityType,
    PermissionFlagsBits
} = require("discord.js");

/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT) || 3000;

const TOKEN = process.env.TOKEN || "";
const CLIENT_ID = process.env.CLIENT_ID || "";
const CLIENT_SECRET = process.env.CLIENT_SECRET || "";

const DASHBOARD_URL = (
    process.env.DASHBOARD_URL ||
    `http://localhost:${PORT}`
).replace(/\/$/, "");

const SESSION_SECRET =
    process.env.SESSION_SECRET ||
    crypto.randomBytes(32).toString("hex");

const SUPPORT_GUILD_ID =
    "1520985648457056266";

const SUPPORT_CHANNEL_ID =
    "1521762536586743868";

const SUPPORT_INVITE =
    process.env.SUPPORT_INVITE ||
    "https://discord.gg/PZw45tHPfc";

/*
    IMPORTANTE:
    NO HAY BASE DE DATOS.

    Toda la información temporal se mantiene
    en memoria mientras el proceso está encendido.
*/

const memory = {

    guilds: new Map(),

    users: new Map(),

    invites: new Map(),

    tickets: new Map(),

    announcements: [],

    logs: [],

    sessions: new Map(),

    ticketCounter: 1000

};


/* =========================================================
   EXPRESS
========================================================= */

const app = express();

app.set("trust proxy", 1);

app.use(express.json({ limit: "2mb" }));

app.use(express.urlencoded({
    extended: true
}));

app.use(session({

    secret: SESSION_SECRET,

    resave: false,

    saveUninitialized: false,

    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 24 * 7
    }

}));


/* =========================================================
   DISCORD CLIENT
========================================================= */

const client = new Client({

    intents: [

        GatewayIntentBits.Guilds,

        GatewayIntentBits.GuildMembers,

        GatewayIntentBits.GuildInvites,

        GatewayIntentBits.GuildMessages,

        GatewayIntentBits.MessageContent

    ],

    partials: [
        Partials.GuildMember,
        Partials.User
    ]

});

client.commands = new Collection();


/* =========================================================
   HELPERS
========================================================= */

function now() {
    return new Date().toISOString();
}

function id(prefix) {
    return `${prefix}-${Date.now()}-${crypto
        .randomBytes(3)
        .toString("hex")
        .toUpperCase()}`;
}

function escapeHTML(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function defaultGuildConfig(guild) {

    return {

        guildId: guild.id,

        name: guild.name,

        invite: {

            enabled: false,

            channelId: null,

            type: "embed",

            message:
                "🎉 ¡Bienvenido {user} a {server}!",

            mentionUser: true,

            mentionInviter: false,

            roleId: null,

            roleOnce: true

        },

        leave: {

            enabled: false,

            channelId: null,

            type: "embed",

            message:
                "👋 {user} ha salido de {server}.",

            mentionUser: false

        },

        general: {

            logsChannelId: null,

            staffRoleId: null,

            language: "es"

        },

        statistics: {

            joins: 0,

            leaves: 0,

            invites: 0

        },

        createdAt: now(),

        updatedAt: now()

    };
}

function getGuildConfig(guildId) {

    if (!memory.guilds.has(guildId)) {

        const guild =
            client.guilds.cache.get(guildId);

        if (guild) {

            memory.guilds.set(
                guildId,
                defaultGuildConfig(guild)
            );

        } else {

            memory.guilds.set(
                guildId,
                {
                    guildId,
                    name: "Servidor",
                    invite: {
                        enabled: false,
                        channelId: null,
                        type: "embed",
                        message: "🎉 ¡Bienvenido {user}!",
                        mentionUser: true,
                        mentionInviter: false,
                        roleId: null,
                        roleOnce: true
                    },
                    leave: {
                        enabled: false,
                        channelId: null,
                        type: "embed",
                        message: "👋 {user} ha salido.",
                        mentionUser: false
                    },
                    general: {
                        logsChannelId: null,
                        staffRoleId: null,
                        language: "es"
                    },
                    statistics: {
                        joins: 0,
                        leaves: 0,
                        invites: 0
                    },
                    createdAt: now(),
                    updatedAt: now()
                }
            );

        }

    }

    return memory.guilds.get(guildId);
}

function addLog(data) {

    const log = {

        id: id("LOG"),

        type: data.type || "system",

        guildId: data.guildId || null,

        userId: data.userId || null,

        action: data.action || "Evento",

        details: data.details || {},

        createdAt: now()

    };

    memory.logs.unshift(log);

    if (memory.logs.length > 2000) {
        memory.logs.length = 2000;
    }

    return log;
}


/* =========================================================
   VARIABLES DE MENSAJES
========================================================= */

function formatMessage(message, member, inviter) {

    return String(message || "")

        .replace(
            /\{user\}/gi,
            `<@${member.id}>`
        )

        .replace(
            /\{username\}/gi,
            member.user.username
        )

        .replace(
            /\{inviter\}/gi,
            inviter
                ? `<@${inviter.id}>`
                : "Desconocido"
        )

        .replace(
            /\{server\}/gi,
            member.guild.name
        )

        .replace(
            /\{memberCount\}/gi,
            String(member.guild.memberCount)
        )

        .replace(
            /\{invites\}/gi,
            String(
                getInviteCount(
                    member.guild.id,
                    inviter?.id
                )
            )
        );
}


/* =========================================================
   INVITATIONS
========================================================= */

function getInviteStore(guildId) {

    if (!memory.invites.has(guildId)) {

        memory.invites.set(
            guildId,
            new Map()
        );

    }

    return memory.invites.get(guildId);
}

async function cacheInvites(guild) {

    try {

        const fetched =
            await guild.invites.fetch();

        const store =
            getInviteStore(guild.id);

        store.clear();

        for (
            const invite
            of fetched.values()
        ) {

            store.set(
                invite.code,
                {
                    code: invite.code,
                    uses: invite.uses || 0,
                    inviterId:
                        invite.inviter?.id || null
                }
            );

        }

        return fetched;

    } catch (error) {

        console.error(
            `[INVITES] ${guild.name}:`,
            error.message
        );

        return null;
    }
}

function findUsedInvite(guildId, current) {

    const old =
        getInviteStore(guildId);

    for (
        const invite
        of current.values()
    ) {

        const previous =
            old.get(invite.code);

        if (!previous) continue;

        if (
            Number(invite.uses || 0) >
            Number(previous.uses || 0)
        ) {

            return invite;

        }

    }

    return null;
}

function registerInvite(guildId, memberId, inviterId, code) {

    memory.users.set(
        `${guildId}:${memberId}`,
        {
            guildId,
            memberId,
            inviterId: inviterId || null,
            code: code || null,
            joinedAt: now(),
            leftAt: null,
            active: true
        }
    );

    const config =
        getGuildConfig(guildId);

    config.statistics.joins++;

    if (inviterId) {
        config.statistics.invites++;
    }

    config.updatedAt = now();
}

function getInviteCount(guildId, userId) {

    if (!userId) return 0;

    let total = 0;

    for (
        const record
        of memory.users.values()
    ) {

        if (
            record.guildId === guildId &&
            record.inviterId === userId &&
            record.active
        ) {

            total++;

        }

    }

    return total;
}


/* =========================================================
   WELCOME
========================================================= */

async function sendWelcome(member, invite) {

    const config =
        getGuildConfig(member.guild.id);

    if (
        !config.invite.enabled ||
        !config.invite.channelId
    ) {
        return;
    }

    const channel =
        member.guild.channels.cache.get(
            config.invite.channelId
        );

    if (!channel) return;

    const inviter =
        invite?.inviter || null;

    const text =
        formatMessage(
            config.invite.message,
            member,
            inviter
        );

    if (config.invite.type === "message") {

        const content = [

            config.invite.mentionUser
                ? `<@${member.id}>`
                : "",

            config.invite.mentionInviter &&
            inviter
                ? `<@${inviter.id}>`
                : "",

            text

        ].filter(Boolean).join(" ");

        await channel.send({
            content
        }).catch(() => {});

        return;
    }

    const embed =
        new EmbedBuilder()

            .setColor(0x7c3aed)

            .setTitle("🎉 ¡Nuevo miembro!")

            .setDescription(text)

            .setThumbnail(
                member.user.displayAvatarURL({
                    extension: "png",
                    size: 256
                })
            )

            .setFooter({
                text: "NR INVITE"
            })

            .setTimestamp();

    await channel.send({

        content:
            config.invite.mentionUser
                ? `<@${member.id}>`
                : undefined,

        embeds: [embed]

    }).catch(() => {});
}


/* =========================================================
   LEAVE
========================================================= */

async function sendLeave(member) {

    const config =
        getGuildConfig(member.guild.id);

    if (
        !config.leave.enabled ||
        !config.leave.channelId
    ) {
        return;
    }

    const channel =
        member.guild.channels.cache.get(
            config.leave.channelId
        );

    if (!channel) return;

    const text =
        formatMessage(
            config.leave.message,
            member,
            null
        );

    if (config.leave.type === "message") {

        await channel.send({

            content:
                config.leave.mentionUser
                    ? `<@${member.id}> ${text}`
                    : text

        }).catch(() => {});

        return;
    }

    const embed =
        new EmbedBuilder()

            .setColor(0xef4444)

            .setTitle("👋 Miembro salió")

            .setDescription(text)

            .setThumbnail(
                member.user.displayAvatarURL({
                    extension: "png",
                    size: 256
                })
            )

            .setFooter({
                text: "NR INVITE"
            })

            .setTimestamp();

    await channel.send({
        embeds: [embed]
    }).catch(() => {});
}


/* =========================================================
   ROLE
========================================================= */

async function giveInviteRole(member) {

    const config =
        getGuildConfig(member.guild.id);

    if (!config.invite.roleId) return;

    const role =
        member.guild.roles.cache.get(
            config.invite.roleId
        );

    if (!role) return;

    const me =
        member.guild.members.me;

    if (!me) return;

    if (
        !me.permissions.has(
            PermissionFlagsBits.ManageRoles
        )
    ) {
        return;
    }

    if (
        role.position >=
        me.roles.highest.position
    ) {
        return;
    }

    await member.roles.add(role)
        .catch(() => {});
}


/* =========================================================
   SLASH COMMANDS
========================================================= */

const slashCommands = [

    {
        name: "help",
        description:
            "Muestra la ayuda de NR INVITE"
    },

    {
        name: "invites",
        description:
            "Muestra tus invitaciones",
        options: [{
            name: "usuario",
            description:
                "Usuario que quieres consultar",
            type: 6,
            required: false
        }]
    },

    {
        name: "leaderboard",
        description:
            "Ranking de invitaciones"
    },

    {
        name: "active",
        description:
            "Activa funciones de NR INVITE",
        options: [{
            name: "invites",
            description:
                "Activa el sistema de invitaciones",
            type: 1
        }]
    },

    {
        name: "setup",
        description:
            "Configuración rápida",
        options: [

            {
                name: "invite",
                description:
                    "Configura invitaciones",
                type: 1
            },

            {
                name: "leave",
                description:
                    "Configura salidas",
                type: 1
            }

        ]
    },

    {
        name: "stats",
        description:
            "Estadísticas del servidor"
    },

    {
        name: "logs",
        description:
            "Últimos registros"
    },

    {
        name: "language",
        description:
            "Idioma del Dashboard"
    },

    {
        name: "support",
        description:
            "Servidor oficial de soporte"
    },

    {
        name: "ping",
        description:
            "Latencia del bot"
    },

    {
        name: "botinfo",
        description:
            "Información de NR INVITE"
    }

];


/* =========================================================
   REGISTER COMMANDS
========================================================= */

async function registerCommands() {

    if (!TOKEN || !CLIENT_ID) {

        console.log(
            "⚠️ TOKEN/CLIENT_ID no configurados."
        );

        return;
    }

    const rest =
        new REST({
            version: "10"
        }).setToken(TOKEN);

    try {

        await rest.put(
            Routes.applicationCommands(
                CLIENT_ID
            ),
            {
                body: slashCommands
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


/* =========================================================
   READY
========================================================= */

client.once(
    "ready",
    async () => {

        console.log(
            `🤖 NR INVITE conectado como ${client.user.tag}`
        );

        client.user.setPresence({

            status: "dnd",

            activities: [{
                name:
                    "Más de 10 bots en funcionamiento | /help",
                type:
                    ActivityType.Watching
            }]

        });

        for (
            const guild
            of client.guilds.cache.values()
        ) {

            getGuildConfig(guild.id);

            await cacheInvites(guild);

        }

        await registerCommands();

        console.log(
            `🏰 Servidores: ${client.guilds.cache.size}`
        );

    }
);


/* =========================================================
   GUILD CREATE
========================================================= */

client.on(
    "guildCreate",
    async guild => {

        getGuildConfig(guild.id);

        await cacheInvites(guild);

        addLog({

            type: "guild_join",

            guildId: guild.id,

            action:
                "NR INVITE fue añadido al servidor",

            details: {
                name: guild.name
            }

        });

    }
);


/* =========================================================
   GUILD DELETE
========================================================= */

client.on(
    "guildDelete",
    guild => {

        addLog({

            type: "guild_remove",

            guildId: guild.id,

            action:
                "NR INVITE salió del servidor"

        });

    }
);


/* =========================================================
   MEMBER JOIN
========================================================= */

client.on(
    "guildMemberAdd",
    async member => {

        let current = null;

        try {

            current =
                await member.guild.invites.fetch();

        } catch {}

        let used = null;

        if (current) {

            used =
                findUsedInvite(
                    member.guild.id,
                    current
                );

            const store =
                getInviteStore(
                    member.guild.id
                );

            store.clear();

            for (
                const invite
                of current.values()
            ) {

                store.set(
                    invite.code,
                    {
                        code: invite.code,
                        uses: invite.uses || 0,
                        inviterId:
                            invite.inviter?.id ||
                            null
                    }
                );

            }

        }

        registerInvite(

            member.guild.id,

            member.id,

            used?.inviter?.id || null,

            used?.code || null

        );

        await giveInviteRole(member);

        await sendWelcome(
            member,
            used
        );

        addLog({

            type: "member_join",

            guildId:
                member.guild.id,

            userId:
                member.id,

            action:
                "Nuevo miembro",

            details: {

                inviterId:
                    used?.inviter?.id || null,

                invite:
                    used?.code || null

            }

        });

    }
);


/* =========================================================
   MEMBER LEAVE
========================================================= */

client.on(
    "guildMemberRemove",
    async member => {

        const key =
            `${member.guild.id}:${member.id}`;

        const record =
            memory.users.get(key);

        if (record) {

            record.active = false;

            record.leftAt = now();

            const config =
                getGuildConfig(
                    member.guild.id
                );

            config.statistics.leaves++;

        }

        await sendLeave(member);

        addLog({

            type: "member_leave",

            guildId:
                member.guild.id,

            userId:
                member.id,

            action:
                "Miembro salió"

        });

    }
);


/* =========================================================
   INTERACTIONS
========================================================= */

client.on(
    "interactionCreate",
    async interaction => {

        try {

            /* =============================================
               BUTTONS
            ============================================= */

            if (interaction.isButton()) {

                if (
                    interaction.customId.startsWith(
                        "ticket_resolve:"
                    )
                ) {

                    await resolveTicket(
                        interaction
                    );

                    return;
                }

                if (
                    interaction.customId.startsWith(
                        "ticket_reject:"
                    )
                ) {

                    await rejectTicket(
                        interaction
                    );

                    return;
                }

                if (
                    interaction.customId.startsWith(
                        "ticket_contact:"
                    )
                ) {

                    await contactTicket(
                        interaction
                    );

                    return;
                }

            }


            /* =============================================
               SELECT
            ============================================= */

            if (
                interaction.isStringSelectMenu()
            ) {

                if (
                    interaction.customId ===
                    "ticket_reason"
                ) {

                    await interaction.reply({

                        content:
                            "✅ Categoría seleccionada. Completa el formulario desde el Dashboard.",

                        ephemeral: true

                    });

                }

                return;
            }


            if (
                !interaction.isChatInputCommand()
            ) {
                return;
            }


            const command =
                interaction.commandName;


            /* =============================================
               HELP
            ============================================= */

            if (command === "help") {

                const embed =
                    new EmbedBuilder()

                        .setColor(0x7c3aed)

                        .setTitle(
                            "🤖 NR INVITE"
                        )

                        .setDescription(
                            "Invitaciones, estadísticas y administración."
                        )

                        .addFields(

                            {
                                name:
                                    "🔗 Invitaciones",
                                value:
                                    "`/invites`\n`/leaderboard`\n`/active invites`"
                            },

                            {
                                name:
                                    "⚙️ Configuración",
                                value:
                                    "`/setup invite`\n`/setup leave`\n`/stats`\n`/logs`"
                            },

                            {
                                name:
                                    "🌐 Dashboard",
                                value:
                                    "`/language`\n`/support`\n`/botinfo`\n`/ping`"
                            }

                        )

                        .setFooter({
                            text:
                                "NR INVITE"
                        });

                await interaction.reply({
                    embeds: [embed]
                });

                return;
            }


            /* =============================================
               PING
            ============================================= */

            if (command === "ping") {

                await interaction.reply(
                    `🏓 Pong!\n**${client.ws.ping}ms**`
                );

                return;
            }


            /* =============================================
               BOT INFO
            ============================================= */

            if (command === "botinfo") {

                await interaction.reply({

                    embeds: [

                        new EmbedBuilder()

                            .setColor(0x7c3aed)

                            .setTitle(
                                "🤖 NR INVITE"
                            )

                            .setDescription(
                                "Sistema avanzado de invitaciones."
                            )

                            .addFields(

                                {
                                    name:
                                        "🏰 Servidores",
                                    value:
                                        String(
                                            client.guilds.cache.size
                                        ),
                                    inline: true
                                },

                                {
                                    name:
                                        "📡 Ping",
                                    value:
                                        `${client.ws.ping}ms`,
                                    inline: true
                                },

                                {
                                    name:
                                        "🟢 Estado",
                                    value:
                                        "Online",
                                    inline: true
                                }

                            )

                    ]

                });

                return;
            }


            /* =============================================
               SUPPORT
            ============================================= */

            if (command === "support") {

                await interaction.reply(
                    `🆘 **Soporte oficial de NR INVITE:**\n${SUPPORT_INVITE}`
                );

                return;
            }


            /* =============================================
               INVITES
            ============================================= */

            if (command === "invites") {

                const user =
                    interaction.options.getUser(
                        "usuario"
                    ) ||
                    interaction.user;

                const active =
                    getInviteCount(
                        interaction.guild.id,
                        user.id
                    );

                let total = 0;

                let left = 0;

                for (
                    const record
                    of memory.users.values()
                ) {

                    if (
                        record.guildId !==
                        interaction.guild.id
                    ) continue;

                    if (
                        record.inviterId !==
                        user.id
                    ) continue;

                    total++;

                    if (!record.active) {
                        left++;
                    }

                }

                await interaction.reply({

                    embeds: [

                        new EmbedBuilder()

                            .setColor(0x7c3aed)

                            .setTitle(
                                "📊 Invitaciones"
                            )

                            .setDescription(
                                `Estadísticas de **${user.username}**`
                            )

                            .addFields(

                                {
                                    name:
                                        "🔗 Activas",
                                    value:
                                        String(active),
                                    inline: true
                                },

                                {
                                    name:
                                        "📊 Totales",
                                    value:
                                        String(total),
                                    inline: true
                                },

                                {
                                    name:
                                        "🚪 Salidas",
                                    value:
                                        String(left),
                                    inline: true
                                }

                            )

                    ]

                });

                return;
            }


            /* =============================================
               LEADERBOARD
            ============================================= */

            if (command === "leaderboard") {

                const ranking = new Map();

                for (
                    const record
                    of memory.users.values()
                ) {

                    if (
                        record.guildId !==
                        interaction.guild.id
                    ) continue;

                    if (
                        !record.inviterId ||
                        !record.active
                    ) continue;

                    ranking.set(

                        record.inviterId,

                        (
                            ranking.get(
                                record.inviterId
                            ) || 0
                        ) + 1

                    );

                }

                const sorted =
                    [...ranking.entries()]
                        .sort(
                            (a, b) =>
                                b[1] - a[1]
                        )
                        .slice(0, 10);

                if (!sorted.length) {

                    await interaction.reply(
                        "🏆 Todavía no hay invitaciones."
                    );

                    return;
                }

                let description = "";

                for (
                    let i = 0;
                    i < sorted.length;
                    i++
                ) {

                    const [
                        userId,
                        count
                    ] = sorted[i];

                    const user =
                        await client.users
                            .fetch(userId)
                            .catch(() => null);

                    const medal =
                        i === 0
                            ? "🥇"
                            : i === 1
                                ? "🥈"
                                : i === 2
                                    ? "🥉"
                                    : `**${i + 1}.**`;

                    description +=
                        `${medal} ${user?.username || userId} — **${count}**\n`;

                }

                await interaction.reply({

                    embeds: [

                        new EmbedBuilder()

                            .setColor(0x7c3aed)

                            .setTitle(
                                "🏆 TOP INVITADORES"
                            )

                            .setDescription(
                                description
                            )

                            .setFooter({
                                text:
                                    "NR INVITE"
                            })

                    ]

                });

                return;
            }


            /* =============================================
               ACTIVE
            ============================================= */

            if (command === "active") {

                const config =
                    getGuildConfig(
                        interaction.guild.id
                    );

                config.invite.enabled = true;

                config.updatedAt = now();

                addLog({

                    type:
                        "configuration",

                    guildId:
                        interaction.guild.id,

                    userId:
                        interaction.user.id,

                    action:
                        "Sistema de invitaciones activado"

                });

                await interaction.reply(
                    "✅ Sistema de invitaciones activado."
                );

                return;
            }


            /* =============================================
               SETUP
            ============================================= */

            if (command === "setup") {

                const sub =
                    interaction.options
                        .getSubcommand();

                const config =
                    getGuildConfig(
                        interaction.guild.id
                    );

                if (sub === "invite") {

                    config.invite.enabled = true;

                    await interaction.reply({

                        embeds: [

                            new EmbedBuilder()

                                .setColor(0x7c3aed)

                                .setTitle(
                                    "🔗 Setup Invite"
                                )

                                .setDescription(
                                    "La configuración avanzada está disponible desde el Dashboard."
                                )

                                .addFields(

                                    {
                                        name:
                                            "📢 Canal",
                                        value:
                                            config.invite.channelId
                                                ? `<#${config.invite.channelId}>`
                                                : "No configurado"
                                    },

                                    {
                                        name:
                                            "💬 Tipo",
                                        value:
                                            config.invite.type
                                    },

                                    {
                                        name:
                                            "🎭 Rol",
                                        value:
                                            config.invite.roleId
                                                ? `<@&${config.invite.roleId}>`
                                                : "No configurado"
                                    }

                                )

                        ]

                    });

                    return;
                }

                if (sub === "leave") {

                    config.leave.enabled = true;

                    await interaction.reply(
                        "👋 Sistema de salida activado."
                    );

                    return;
                }

            }


            /* =============================================
               STATS
            ============================================= */

            if (command === "stats") {

                const config =
                    getGuildConfig(
                        interaction.guild.id
                    );

                const active =
                    [...memory.users.values()]
                        .filter(
                            x =>
                                x.guildId ===
                                interaction.guild.id &&
                                x.active
                        )
                        .length;

                await interaction.reply({

                    embeds: [

                        new EmbedBuilder()

                            .setColor(0x7c3aed)

                            .setTitle(
                                "📊 Estadísticas"
                            )

                            .addFields(

                                {
                                    name:
                                        "👥 Miembros",
                                    value:
                                        String(
                                            interaction.guild.memberCount
                                        ),
                                    inline: true
                                },

                                {
                                    name:
                                        "✅ Activos",
                                    value:
                                        String(active),
                                    inline: true
                                },

                                {
                                    name:
                                        "📥 Entradas",
                                    value:
                                        String(
                                            config.statistics.joins
                                        ),
                                    inline: true
                                },

                                {
                                    name:
                                        "📤 Salidas",
                                    value:
                                        String(
                                            config.statistics.leaves
                                        ),
                                    inline: true
                                }

                            )

                    ]

                });

                return;
            }


            /* =============================================
               LOGS
            ============================================= */

            if (command === "logs") {

                const logs =
                    memory.logs
                        .filter(
                            x =>
                                x.guildId ===
                                interaction.guild.id
                        )
                        .slice(0, 10);

                if (!logs.length) {

                    await interaction.reply(
                        "📜 No hay logs."
                    );

                    return;
                }

                const text =
                    logs
                        .map(
                            x =>
                                `• **${x.type}** — ${x.action}`
                        )
                        .join("\n");

                await interaction.reply({

                    embeds: [

                        new EmbedBuilder()

                            .setColor(0x7c3aed)

                            .setTitle(
                                "📜 Logs"
                            )

                            .setDescription(
                                text
                            )

                    ]

                });

                return;
            }


            /* =============================================
               LANGUAGE
            ============================================= */

            if (command === "language") {

                await interaction.reply({
                    content:
                        "🌐 El Dashboard de NR INVITE está en español por defecto. El idioma puede cambiarse desde el menú superior.",
                    ephemeral: true
                });

            }

        } catch (error) {

            console.error(
                "[INTERACTION]",
                error
            );

            const message =
                "❌ Ocurrió un error.";

            if (
                interaction.replied ||
                interaction.deferred
            ) {

                await interaction.followUp({
                    content: message,
                    ephemeral: true
                }).catch(() => {});

            } else {

                await interaction.reply({
                    content: message,
                    ephemeral: true
                }).catch(() => {});

            }

        }

    }
);


/* =========================================================
   TICKET SYSTEM
========================================================= */

function ticketButtons(ticketId) {

    return new ActionRowBuilder()
        .addComponents(

            new ButtonBuilder()
                .setCustomId(
                    `ticket_resolve:${ticketId}`
                )
                .setLabel("Resolver")
                .setEmoji("✅")
                .setStyle(
                    ButtonStyle.Success
                ),

            new ButtonBuilder()
                .setCustomId(
                    `ticket_reject:${ticketId}`
                )
                .setLabel("Rechazar")
                .setEmoji("❌")
                .setStyle(
                    ButtonStyle.Danger
                ),

            new ButtonBuilder()
                .setCustomId(
                    `ticket_contact:${ticketId}`
                )
                .setLabel("Contactar")
                .setEmoji("📩")
                .setStyle(
                    ButtonStyle.Primary
                )

        );
}


async function resolveTicket(interaction) {

    const ticketId =
        interaction.customId.split(":")[1];

    const ticket =
        memory.tickets.get(ticketId);

    if (!ticket) {

        await interaction.reply({
            content:
                "❌ Ticket no encontrado.",
            ephemeral: true
        });

        return;
    }

    ticket.status = "resolved";

    ticket.resolvedAt = now();

    ticket.staffId =
        interaction.user.id;

    addLog({

        type: "ticket_resolved",

        userId:
            interaction.user.id,

        action:
            `Ticket ${ticketId} resuelto`,

        details: {
            ticketId
        }

    });

    await interaction.update({

        embeds: [
            new EmbedBuilder()
                .setColor(0x22c55e)
                .setTitle(
                    "✅ Ticket resuelto"
                )
                .setDescription(
                    `La solicitud **${ticketId}** fue resuelta por <@${interaction.user.id}>.`
                )
                .setTimestamp()
        ],

        components: []

    });

    await sendTicketResultMail(
        ticket,
        "resuelto"
    );
}


async function rejectTicket(interaction) {

    const ticketId =
        interaction.customId.split(":")[1];

    const ticket =
        memory.tickets.get(ticketId);

    if (!ticket) {

        await interaction.reply({
            content:
                "❌ Ticket no encontrado.",
            ephemeral: true
        });

        return;
    }

    ticket.status = "rejected";

    ticket.resolvedAt = now();

    ticket.staffId =
        interaction.user.id;

    addLog({

        type: "ticket_rejected",

        userId:
            interaction.user.id,

        action:
            `Ticket ${ticketId} rechazado`

    });

    await interaction.update({

        embeds: [
            new EmbedBuilder()
                .setColor(0xef4444)
                .setTitle(
                    "❌ Ticket rechazado"
                )
                .setDescription(
                    `La solicitud **${ticketId}** fue rechazada.`
                )
                .setTimestamp()
        ],

        components: []

    });

    await sendTicketResultMail(
        ticket,
        "rechazado"
    );
}


async function contactTicket(interaction) {

    const ticketId =
        interaction.customId.split(":")[1];

    const ticket =
        memory.tickets.get(ticketId);

    if (!ticket) {

        await interaction.reply({
            content:
                "❌ Ticket no encontrado.",
            ephemeral: true
        });

        return;
    }

    ticket.status = "contact";

    ticket.staffId =
        interaction.user.id;

    addLog({

        type: "ticket_contact",

        userId:
            interaction.user.id,

        action:
            `Contacto solicitado para ${ticketId}`

    });

    await interaction.reply({

        content:
            `📩 El ticket **${ticketId}** ha sido marcado para contacto con el usuario.`,

        ephemeral: true

    });

    const user =
        await client.users
            .fetch(ticket.userId)
            .catch(() => null);

    if (user) {

        await user.send(
            `📩 **NR INVITE Support**\n\nUn miembro del equipo quiere contactar contigo sobre tu solicitud **${ticketId}**.`
        ).catch(() => {});

    }

    await sendTicketResultMail(
        ticket,
        "contacto solicitado"
    );
}


/* =========================================================
   SMTP
========================================================= */

let transporter = null;

if (
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
) {

    transporter =
        nodemailer.createTransport({

            host:
                process.env.SMTP_HOST,

            port:
                Number(
                    process.env.SMTP_PORT
                ) || 587,

            secure:
                Number(
                    process.env.SMTP_PORT
                ) === 465,

            auth: {

                user:
                    process.env.SMTP_USER,

                pass:
                    process.env.SMTP_PASS

            }

        });

}


async function sendTicketResultMail(
    ticket,
    result
) {

    if (!transporter) return;

    await transporter.sendMail({

        from:
            process.env.SMTP_FROM ||
            process.env.SMTP_USER,

        to:
            ticket.email,

        subject:
            `NR INVITE | ${ticket.id}`,

        text:
            [
                "NR INVITE",

                "",

                `Tu solicitud ${ticket.id} ha sido actualizada.`,

                `Resultado: ${result}`,

                "",

                "Gracias por contactar con soporte."

            ].join("\n")

    }).catch(error => {

        console.error(
            "[MAIL RESULT]",
            error.message
        );

    });

}


/* =========================================================
   DASHBOARD STATIC
========================================================= */

app.use(
    express.static(
        path.join(
            __dirname,
            "dashboard"
        )
    )
);


/* =========================================================
   AUTH
========================================================= */

function requireAuth(req, res, next) {

    if (!req.session.user) {

        return res.status(401).json({

            authenticated: false,

            message:
                "Debes iniciar sesión con Discord."

        });

    }

    next();
}


app.get(
    "/auth/discord",
    (req, res) => {

        if (
            !CLIENT_ID ||
            !CLIENT_SECRET
        ) {

            return res.status(500).send(
                "OAuth2 no configurado."
            );

        }

        const state =
            crypto
                .randomBytes(32)
                .toString("hex");

        req.session.oauthState = state;

        const params =
            new URLSearchParams({

                client_id:
                    CLIENT_ID,

                redirect_uri:
                    `${DASHBOARD_URL}/auth/callback`,

                response_type:
                    "code",

                scope:
                    "identify guilds",

                state

            });

        res.redirect(
            `https://discord.com/oauth2/authorize?${params}`
        );

    }
);


app.get(
    "/auth/callback",
    async (req, res) => {

        try {

            const {
                code,
                state
            } = req.query;

            if (
                !code ||
                !state ||
                state !==
                    req.session.oauthState
            ) {

                return res
                    .status(400)
                    .send(
                        "OAuth2 inválido."
                    );

            }

            delete req.session.oauthState;

            const tokenResponse =
                await fetch(
                    "https://discord.com/api/oauth2/token",
                    {

                        method:
                            "POST",

                        headers: {
                            "Content-Type":
                                "application/x-www-form-urlencoded"
                        },

                        body:
                            new URLSearchParams({

                                client_id:
                                    CLIENT_ID,

                                client_secret:
                                    CLIENT_SECRET,

                                grant_type:
                                    "authorization_code",

                                code,

                                redirect_uri:
                                    `${DASHBOARD_URL}/auth/callback`

                            })

                    }
                );

            if (!tokenResponse.ok) {
                throw new Error(
                    "Token OAuth2 inválido."
                );
            }

            const token =
                await tokenResponse.json();

            const userResponse =
                await fetch(
                    "https://discord.com/api/users/@me",
                    {
                        headers: {
                            Authorization:
                                `Bearer ${token.access_token}`
                        }
                    }
                );

            const user =
                await userResponse.json();

            const guildResponse =
                await fetch(
                    "https://discord.com/api/users/@me/guilds",
                    {
                        headers: {
                            Authorization:
                                `Bearer ${token.access_token}`
                        }
                    }
                );

            const guilds =
                await guildResponse.json();

            req.session.user = {

                id:
                    user.id,

                username:
                    user.username,

                globalName:
                    user.global_name,

                avatar:
                    user.avatar || null

            };

            req.session.guilds =
                Array.isArray(guilds)
                    ? guilds
                    : [];

            addLog({

                type:
                    "dashboard_login",

                userId:
                    user.id,

                action:
                    "Inicio de sesión en Dashboard"

            });

            res.redirect("/");

        } catch (error) {

            console.error(
                "[OAUTH]",
                error
            );

            res.status(500).send(
                "No se pudo iniciar sesión."
            );

        }

    }
);


app.get(
    "/auth/logout",
    (req, res) => {

        if (req.session.user) {

            addLog({

                type:
                    "dashboard_logout",

                userId:
                    req.session.user.id,

                action:
                    "Cierre de sesión"

            });

        }

        req.session.destroy(
            () => res.redirect("/")
        );

    }
);


/* =========================================================
   DASHBOARD API
========================================================= */

app.get(
    "/api/user",
    (req, res) => {

        if (!req.session.user) {

            return res.status(401).json({
                authenticated: false
            });

        }

        res.json({

            authenticated: true,

            user:
                req.session.user

        });

    }
);


app.get(
    "/api/user/guilds",
    requireAuth,
    (req, res) => {

        const guilds =
            req.session.guilds || [];

        const result =
            guilds.map(guild => {

                const botGuild =
                    client.guilds.cache.get(
                        guild.id
                    );

                return {

                    id:
                        guild.id,

                    name:
                        guild.name,

                    icon:
                        guild.icon || null,

                    banner:
                        guild.banner || null,

                    iconURL:
                        guild.icon
                            ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=256`
                            : null,

                    bannerURL:
                        guild.banner
                            ? `https://cdn.discordapp.com/banners/${guild.id}/${guild.banner}.png?size=1024`
                            : null,

                    bot:
                        Boolean(botGuild),

                    permissions:
                        guild.permissions

                };

            });

        res.json({
            guilds: result
        });

    }
);


/* =========================================================
   SERVER DATA
========================================================= */

app.get(
    "/api/guild/:guildId",
    requireAuth,
    (req, res) => {

        const guildId =
            req.params.guildId;

        const authorized =
            (req.session.guilds || [])
                .some(
                    guild =>
                        guild.id === guildId
                );

        if (!authorized) {

            return res.status(403).json({
                message:
                    "No tienes acceso a este servidor."
            });

        }

        const botGuild =
            client.guilds.cache.get(
                guildId
            );

        if (!botGuild) {

            return res.status(404).json({
                message:
                    "NR INVITE no está en este servidor."
            });

        }

        const config =
            getGuildConfig(guildId);

        res.json({

            guild: {

                id:
                    botGuild.id,

                name:
                    botGuild.name,

                icon:
                    botGuild.iconURL({
                        extension: "png",
                        size: 256
                    }),

                banner:
                    botGuild.bannerURL({
                        extension: "png",
                        size: 1024
                    })

            },

            config

        });

    }
);


/* =========================================================
   SAVE SERVER CONFIG
========================================================= */

app.post(
    "/api/guild/:guildId/config",
    requireAuth,
    (req, res) => {

        const guildId =
            req.params.guildId;

        const authorized =
            (req.session.guilds || [])
                .some(
                    guild =>
                        guild.id === guildId
                );

        if (!authorized) {

            return res.status(403).json({
                message:
                    "No autorizado."
            });

        }

        if (
            !client.guilds.cache.has(
                guildId
            )
        ) {

            return res.status(400).json({
                message:
                    "El bot no está en el servidor."
            });

        }

        const config =
            getGuildConfig(guildId);

        const incoming =
            req.body || {};

        if (incoming.invite) {

            config.invite = {

                ...config.invite,

                ...incoming.invite

            };

        }

        if (incoming.leave) {

            config.leave = {

                ...config.leave,

                ...incoming.leave

            };

        }

        if (incoming.general) {

            config.general = {

                ...config.general,

                ...incoming.general

            };

        }

        config.updatedAt = now();

        addLog({

            type:
                "dashboard_config",

            guildId,

            userId:
                req.session.user.id,

            action:
                "Configuración actualizada desde Dashboard"

        });

        res.json({

            success: true,

            config

        });

    }
);


/* =========================================================
   CHANNELS
========================================================= */

app.get(
    "/api/guild/:guildId/channels",
    requireAuth,
    (req, res) => {

        const guildId =
            req.params.guildId;

        const authorized =
            (req.session.guilds || [])
                .some(
                    x =>
                        x.id === guildId
                );

        if (!authorized) {

            return res.status(403).json({
                message:
                    "No autorizado."
            });

        }

        const guild =
            client.guilds.cache.get(
                guildId
            );

        if (!guild) {

            return res.status(404).json({
                message:
                    "Servidor no encontrado."
            });

        }

        const channels =
            guild.channels.cache
                .filter(
                    channel =>
                        channel.isTextBased()
                )
                .map(
                    channel => ({
                        id:
                            channel.id,
                        name:
                            channel.name,
                        type:
                            channel.type
                    })
                );

        res.json({
            channels
        });

    }
);


/* =========================================================
   ROLES
========================================================= */

app.get(
    "/api/guild/:guildId/roles",
    requireAuth,
    (req, res) => {

        const guildId =
            req.params.guildId;

        const guild =
            client.guilds.cache.get(
                guildId
            );

        if (!guild) {

            return res.status(404).json({
                message:
                    "Servidor no encontrado."
            });

        }

        const roles =
            guild.roles.cache
                .filter(
                    role =>
                        role.id !== guild.id
                )
                .sort(
                    (a, b) =>
                        b.position -
                        a.position
                )
                .map(
                    role => ({
                        id:
                            role.id,
                        name:
                            role.name,
                        position:
                            role.position
                    })
                );

        res.json({
            roles
        });

    }
);


/* =========================================================
   ANNOUNCEMENTS
========================================================= */

app.get(
    "/api/announcements",
    (req, res) => {

        res.json({

            announcements:
                memory.announcements
                    .filter(
                        announcement =>
                            announcement.enabled !== false
                    )

        });

    }
);


/*
   Solo el servidor especial puede publicar
   anuncios desde este endpoint.
*/

app.post(
    "/api/announcements",
    requireAuth,
    (req, res) => {

        const userGuilds =
            req.session.guilds || [];

        const isSpecial =
            userGuilds.some(
                guild =>
                    guild.id ===
                    SUPPORT_GUILD_ID
            );

        if (!isSpecial) {

            return res.status(403).json({
                message:
                    "No autorizado."
            });

        }

        const {
            title,
            message
        } = req.body;

        if (
            !title ||
            !message
        ) {

            return res.status(400).json({
                message:
                    "Título y mensaje son obligatorios."
            });

        }

        const announcement = {

            id:
                id("ANN"),

            title:
                String(title).slice(0, 200),

            message:
                String(message).slice(0, 4000),

            enabled:
                true,

            createdAt:
                now(),

            authorId:
                req.session.user.id

        };

        memory.announcements.unshift(
            announcement
        );

        addLog({

            type:
                "announcement",

            userId:
                req.session.user.id,

            action:
                "Nuevo anuncio publicado"

        });

        res.json({

            success:
                true,

            announcement

        });

    }
);


/* =========================================================
   SUPPORT FORM
========================================================= */

app.post(
    "/api/support/ticket",
    requireAuth,
    async (req, res) => {

        try {

            const {
                type,
                email,
                subject,
                description
            } = req.body;

            if (
                !type ||
                !email ||
                !subject ||
                !description
            ) {

                return res.status(400).json({

                    message:
                        "Todos los campos son obligatorios."

                });

            }

            if (
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
                    .test(email)
            ) {

                return res.status(400).json({

                    message:
                        "El correo electrónico no es válido."

                });

            }

            memory.ticketCounter++;

            const ticketId =
                `NR-${memory.ticketCounter}`;

            const ticket = {

                id:
                    ticketId,

                userId:
                    req.session.user.id,

                username:
                    req.session.user.username,

                email:
                    String(email),

                type:
                    String(type),

                subject:
                    String(subject),

                description:
                    String(description),

                status:
                    "pending",

                createdAt:
                    now(),

                updatedAt:
                    now(),

                staffId:
                    null

            };

            memory.tickets.set(
                ticketId,
                ticket
            );

            addLog({

                type:
                    "ticket_created",

                userId:
                    req.session.user.id,

                action:
                    `Ticket ${ticketId} creado`,

                details: {
                    type,
                    subject
                }

            });

            const channel =
                client.channels.cache.get(
                    SUPPORT_CHANNEL_ID
                );

            if (channel) {

                const embed =
                    new EmbedBuilder()

                        .setColor(0x7c3aed)

                        .setTitle(
                            "🆘 NR INVITE — NUEVA SOLICITUD"
                        )

                        .setDescription(
                            `Se ha creado una nueva solicitud de soporte **${ticketId}**.`
                        )

                        .addFields(

                            {
                                name:
                                    "🎫 Ticket",
                                value:
                                    ticketId,
                                inline: true
                            },

                            {
                                name:
                                    "👤 Usuario",
                                value:
                                    `<@${ticket.userId}>`,
                                inline: true
                            },

                            {
                                name:
                                    "📧 Correo",
                                value:
                                    email,
                                inline: true
                            },

                            {
                                name:
                                    "📂 Tipo",
                                value:
                                    type,
                                inline: true
                            },

                            {
                                name:
                                    "📌 Asunto",
                                value:
                                    subject
                            },

                            {
                                name:
                                    "📝 Descripción",
                                value:
                                    description
                                        .slice(0, 1024)
                            },

                            {
                                name:
                                    "🟡 Estado",
                                value:
                                    "PENDIENTE",
                                inline: true
                            }

                        )

                        .setFooter({
                            text:
                                "NR INVITE Support"
                        })

                        .setTimestamp();

                await channel.send({

                    embeds: [embed],

                    components: [
                        ticketButtons(ticketId)
                    ]

                }).catch(error => {

                    console.error(
                        "[SUPPORT CHANNEL]",
                        error.message
                    );

                });

            }

            await sendTicketCreatedMail(
                ticket
            );

            res.json({

                success:
                    true,

                ticketId

            });

        } catch (error) {

            console.error(
                "[TICKET]",
                error
            );

            res.status(500).json({

                message:
                    "No se pudo crear el ticket."

            });

        }

    }
);


/* =========================================================
   EMAIL DE TICKET CREADO
========================================================= */

async function sendTicketCreatedMail(ticket) {

    if (!transporter) return;

    await transporter.sendMail({

        from:
            process.env.SMTP_FROM ||
            process.env.SMTP_USER,

        to:
            ticket.email,

        subject:
            `NR INVITE | ${ticket.id}`,

        text:
            [
                "NR INVITE",

                "",

                `Hemos recibido tu solicitud ${ticket.id}.`,

                `Tipo: ${ticket.type}`,

                `Asunto: ${ticket.subject}`,

                "",

                "Tu solicitud será revisada por nuestro equipo.",

                "",

                "NR INVITE Support"

            ].join("\n"),

        html:
            `
            <div style="
                background:#09090b;
                color:white;
                padding:30px;
                font-family:Arial;
            ">

                <div style="
                    max-width:600px;
                    margin:auto;
                    background:#18181b;
                    padding:30px;
                    border-radius:18px;
                ">

                    <h1>🐶 NR INVITE</h1>

                    <h2>Solicitud recibida</h2>

                    <p>
                        Hemos recibido correctamente
                        tu solicitud.
                    </p>

                    <p>
                        <strong>Ticket:</strong>
                        ${escapeHTML(ticket.id)}
                    </p>

                    <p>
                        <strong>Tipo:</strong>
                        ${escapeHTML(ticket.type)}
                    </p>

                    <p>
                        <strong>Asunto:</strong>
                        ${escapeHTML(ticket.subject)}
                    </p>

                    <p>
                        Nuestro equipo revisará
                        tu solicitud.
                    </p>

                </div>

            </div>
            `

    }).catch(error => {

        console.error(
            "[MAIL]",
            error.message
        );

    });

}


/* =========================================================
   LOGS API
========================================================= */

app.get(
    "/api/logs",
    requireAuth,
    (req, res) => {

        res.json({

            logs:
                memory.logs.slice(
                    0,
                    100
                )

        });

    }
);


/* =========================================================
   HEALTH
========================================================= */

app.get(
    "/health",
    (req, res) => {

        res.json({

            status:
                "ok",

            name:
                "NR INVITE",

            bot:
                client.isReady(),

            guilds:
                client.guilds.cache.size,

            uptime:
                process.uptime(),

            database:
                false,

            storage:
                "memory",

            timestamp:
                now()

        });

    }
);


/* =========================================================
   STATUS
========================================================= */

app.get(
    "/status",
    (req, res) => {

        res.json({

            online:
                client.isReady(),

            ping:
                client.ws.ping,

            guilds:
                client.guilds.cache.size,

            tickets:
                memory.tickets.size,

            announcements:
                memory.announcements.length,

            database:
                false

        });

    }
);


/* =========================================================
   CATCH-ALL DASHBOARD
========================================================= */

app.get(
    "*",
    (req, res, next) => {

        if (
            req.path.startsWith("/api/") ||
            req.path.startsWith("/auth/")
        ) {

            return next();

        }

        res.sendFile(
            path.join(
                __dirname,
                "dashboard",
                "index.html"
            )
        );

    }
);


/* =========================================================
   START SERVER
========================================================= */

const server =
    app.listen(
        PORT,
        () => {

            console.log("");
            console.log(
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            );
            console.log(
                "🐶 NR INVITE"
            );
            console.log(
                "🌐 Dashboard:",
                DASHBOARD_URL
            );
            console.log(
                "❤️ Health:",
                `${DASHBOARD_URL}/health`
            );
            console.log(
                "💾 Database: NO"
            );
            console.log(
                "🧠 Storage: MEMORY"
            );
            console.log(
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            );
            console.log("");

        }
    );


/* =========================================================
   LOGIN DISCORD
========================================================= */

if (TOKEN) {

    client.login(TOKEN)
        .catch(error => {

            console.error(
                "❌ Error iniciando Discord:",
                error.message
            );

        });

} else {

    console.warn(
        "⚠️ TOKEN no configurado."
    );

}


/* =========================================================
   SHUTDOWN
========================================================= */

async function shutdown(signal) {

    console.log(
        `${signal}: cerrando NR INVITE...`
    );

    try {

        client.destroy();

    } catch {}

    server.close(() => {

        console.log(
            "✅ NR INVITE cerrado."
        );

        process.exit(0);

    });

}

process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);
