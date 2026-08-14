// ============================================================
// NR INVITE
// Advanced Discord Invitation System
//
// Express
// DND permanente
// /help
// /setup invite
// /active invites
// /invites
// /leaderboard
// Tracking de invitaciones
// Mensajes personalizados
// SIN DASHBOARD
// SIN BASE DE DATOS
// ============================================================

const express = require("express");

const {
    Client,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    Events
} = require("discord.js");

// ============================================================
// CONFIG
// ============================================================

const TOKEN =
    process.env.TOKEN || "PON_AQUI_TU_TOKEN";

const PORT =
    process.env.PORT || 3000;

const SUPPORT_SERVER =
    "https://discord.gg/PZw45tHPfc";

// ============================================================
// EXPRESS
// ============================================================

const app = express();

app.use(express.json());

app.get("/", (req, res) => {

    res.status(200).send(
        "NR INVITE | Más de 10 bots en funcionamiento | /help"
    );
});

app.get("/status", (req, res) => {

    res.status(200).json({
        bot: "NR INVITE",
        status: "online",
        discordStatus: "DND",
        network: "Más de 10 bots en funcionamiento",
        help: "/help",
        guilds: client.guilds.cache.size,
        uptime: process.uptime()
    });
});

app.get("/health", (req, res) => {

    res.status(200).json({
        status: "ok"
    });
});

app.listen(PORT, () => {

    console.log(
        `🌐 Express iniciado en el puerto ${PORT}`
    );

});

// ============================================================
// CLIENT DISCORD
// ============================================================

const client = new Client({

    intents: [

        GatewayIntentBits.Guilds,

        GatewayIntentBits.GuildMembers,

        GatewayIntentBits.GuildInvites

    ],

    partials: [

        Partials.GuildMember

    ]

});

// ============================================================
// CONFIGURACIÓN EN MEMORIA
// ============================================================

const guildConfigs =
    new Map();

// ============================================================
// CACHE DE INVITES
// ============================================================

const inviteCache =
    new Map();

// ============================================================
// CONFIG DEFAULT
// ============================================================

function createDefaultConfig() {

    return {

        enabled: false,

        channelId: null,

        message:
            "🎉 ¡Bienvenido/a @user a **{server}**!\n" +
            "🔗 Invitado por: @inviter\n" +
            "📊 @inviter ahora tiene **{invites}** invitaciones.\n" +
            "👥 Somos **{memberCount}** miembros.",

        users: new Map(),

        stats: new Map()

    };

}

// ============================================================
// GET CONFIG
// ============================================================

function getConfig(guildId) {

    if (!guildConfigs.has(guildId)) {

        guildConfigs.set(
            guildId,
            createDefaultConfig()
        );

    }

    return guildConfigs.get(
        guildId
    );

}

// ============================================================
// GET USER STATS
// ============================================================

function getStats(
    guildId,
    userId
) {

    const config =
        getConfig(guildId);

    if (!config.stats.has(userId)) {

        config.stats.set(

            userId,

            {

                total: 0,

                active: 0,

                left: 0,

                fake: 0

            }

        );

    }

    return config.stats.get(
        userId
    );

}

// ============================================================
// FETCH INVITES
// ============================================================

async function fetchInvites(guild) {

    try {

        const invites =
            await guild.invites.fetch();

        const result =
            new Map();

        for (
            const invite of
            invites.values()
        ) {

            result.set(

                invite.code,

                {

                    code:
                        invite.code,

                    uses:
                        invite.uses || 0,

                    inviterId:
                        invite.inviter?.id || null,

                    maxUses:
                        invite.maxUses || 0

                }

            );

        }

        return result;

    } catch (error) {

        console.error(
            `❌ No se pudieron obtener invites de ${guild.name}:`,
            error.message
        );

        return new Map();

    }

}

// ============================================================
// INITIALIZE INVITES
// ============================================================

async function initializeInvites(guild) {

    const invites =
        await fetchInvites(
            guild
        );

    inviteCache.set(
        guild.id,
        invites
    );

}

// ============================================================
// DETECTAR INVITE USADO
// ============================================================

async function detectUsedInvite(guild) {

    const previous =
        inviteCache.get(
            guild.id
        ) ||
        new Map();

    const current =
        await fetchInvites(
            guild
        );

    let usedInvite =
        null;

    for (
        const [
            code,
            invite
        ] of current
    ) {

        const oldInvite =
            previous.get(
                code
            );

        if (!oldInvite) {

            continue;

        }

        if (
            invite.uses >
            oldInvite.uses
        ) {

            usedInvite =
                invite;

            break;

        }

    }

    inviteCache.set(
        guild.id,
        current
    );

    return usedInvite;

}

// ============================================================
// PARSE VARIABLES
// ============================================================

function parseMessage(
    message,
    data
) {

    let output =
        message;

    output =
        output.replaceAll(
            "@user",
            data.user
                ? `<@${data.user.id}>`
                : "@user"
        );

    output =
        output.replaceAll(
            "@inviter",
            data.inviter
                ? `<@${data.inviter.id}>`
                : "Desconocido"
        );

    output =
        output.replaceAll(
            "{invites}",
            String(
                data.invites ?? 0
            )
        );

    output =
        output.replaceAll(
            "{server}",
            data.server ||
            "Servidor"
        );

    output =
        output.replaceAll(
            "{memberCount}",
            String(
                data.memberCount ?? 0
            )
        );

    return output;

}

// ============================================================
// SETUP EMBED
// ============================================================

function createSetupPanel(
    guild
) {

    const config =
        getConfig(
            guild.id
        );

    const embed =
        new EmbedBuilder()

            .setColor(
                0x7C3AED
            )

            .setTitle(
                "⚙️ NR INVITE"
            )

            .setDescription(
                "Configura el sistema de invitaciones directamente desde Discord."
            )

            .addFields(

                {

                    name:
                        "📢 Canal",

                    value:
                        config.channelId
                            ? `<#${config.channelId}>`
                            : "❌ No configurado",

                    inline:
                        true

                },

                {

                    name:
                        "🟢 Estado",

                    value:
                        config.enabled
                            ? "🟢 Activo"
                            : "🔴 Inactivo",

                    inline:
                        true

                },

                {

                    name:
                        "💬 Mensaje",

                    value:
                        "Personalizado",

                    inline:
                        true

                },

                {

                    name:
                        "🔧 Variables",

                    value:
                        "`@user`\n" +
                        "`@inviter`\n" +
                        "`{invites}`\n" +
                        "`{server}`\n" +
                        "`{memberCount}`"

                }

            )

            .setFooter({

                text:
                    "NR INVITE • Configuración"

            });

    const menu =
        new StringSelectMenuBuilder()

            .setCustomId(
                "nr_invite_setup"
            )

            .setPlaceholder(
                "Selecciona una opción..."
            )

            .addOptions(

                {

                    label:
                        "Canal de invites",

                    description:
                        "Selecciona dónde llegarán los mensajes.",

                    value:
                        "channel",

                    emoji:
                        "📢"

                },

                {

                    label:
                        "Mensaje de invite",

                    description:
                        "Personaliza el mensaje.",

                    value:
                        "message",

                    emoji:
                        "💬"

                },

                {

                    label:
                        "Vista previa",

                    description:
                        "Mira cómo quedará.",

                    value:
                        "preview",

                    emoji:
                        "👁️"

                },

                {

                    label:
                        "Activar invites",

                    description:
                        "Activa el sistema.",

                    value:
                        "activate",

                    emoji:
                        "🟢"

                },

                {

                    label:
                        "Desactivar invites",

                    description:
                        "Desactiva el sistema.",

                    value:
                        "deactivate",

                    emoji:
                        "🔴"

                },

                {

                    label:
                        "Restablecer",

                    description:
                        "Restablece la configuración.",

                    value:
                        "reset",

                    emoji:
                        "♻️"

                }

            );

    const row =
        new ActionRowBuilder()
            .addComponents(
                menu
            );

    return {

        embeds:
            [embed],

        components:
            [row]

    };

}

// ============================================================
// COMANDOS
// ============================================================

const commands = [

    new SlashCommandBuilder()

        .setName(
            "setup"
        )

        .setDescription(
            "Configura NR INVITE"
        )

        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        )

        .addSubcommand(
            sub =>
                sub

                    .setName(
                        "invite"
                    )

                    .setDescription(
                        "Configura el sistema de invitaciones"
                    )
        ),

    new SlashCommandBuilder()

        .setName(
            "active"
        )

        .setDescription(
            "Activa funciones de NR INVITE"
        )

        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        )

        .addSubcommand(
            sub =>
                sub

                    .setName(
                        "invites"
                    )

                    .setDescription(
                        "Activa las invitaciones"
                    )
        ),

    new SlashCommandBuilder()

        .setName(
            "invites"
        )

        .setDescription(
            "Muestra las invitaciones de un usuario"
        )

        .addUserOption(
            option =>
                option

                    .setName(
                        "usuario"
                    )

                    .setDescription(
                        "Usuario que quieres consultar"
                    )

                    .setRequired(
                        false
                    )
        ),

    new SlashCommandBuilder()

        .setName(
            "leaderboard"
        )

        .setDescription(
            "Muestra el ranking de invitaciones"
        ),

    new SlashCommandBuilder()

        .setName(
            "help"
        )

        .setDescription(
            "Muestra la ayuda de NR INVITE"
        )

].map(
    command =>
        command.toJSON()
);

// ============================================================
// READY
// ============================================================

client.once(
    Events.ClientReady,
    async () => {

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "             NR INVITE"
        );
        console.log(
            "========================================"
        );
        console.log(
            `🤖 Bot: ${client.user.tag}`
        );
        console.log(
            `🆔 ID: ${client.user.id}`
        );
        console.log(
            `🌐 Servidores: ${client.guilds.cache.size}`
        );
        console.log(
            "🔴 Estado: DND"
        );
        console.log(
            "🤖 Más de 10 bots en funcionamiento"
        );
        console.log(
            "========================================"
        );
        console.log("");

        // ================================================
        // DND PERMANENTE
        // ================================================

        client.user.setPresence({

            status:
                "dnd",

            activities: [

                {

                    name:
                        "Más de 10 bots en funcionamiento | /help",

                    type:
                        3

                }

            ]

        });

        // ================================================
        // CACHE INVITES
        // ================================================

        for (
            const guild of
            client.guilds.cache.values()
        ) {

            await initializeInvites(
                guild
            );

        }

        // ================================================
        // REGISTRAR COMANDOS
        // ================================================

        try {

            await client.application.commands.set(
                commands
            );

            console.log(
                "✅ Comandos registrados."
            );

        } catch (error) {

            console.error(
                "❌ Error registrando comandos:",
                error
            );

        }

    }
);

// ============================================================
// NUEVO SERVIDOR
// ============================================================

client.on(
    Events.GuildCreate,
    async guild => {

        getConfig(
            guild.id
        );

        await initializeInvites(
            guild
        );

        console.log(
            `➕ Añadido a ${guild.name}`
        );

    }
);

// ============================================================
// MEMBER JOIN
// ============================================================

client.on(
    Events.GuildMemberAdd,
    async member => {

        const guild =
            member.guild;

        const config =
            getConfig(
                guild.id
            );

        // Esperar actualización de Discord
        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    1500
                )
        );

        const usedInvite =
            await detectUsedInvite(
                guild
            );

        let inviter =
            null;

        if (
            usedInvite &&
            usedInvite.inviterId
        ) {

            inviter =
                await client.users
                    .fetch(
                        usedInvite.inviterId
                    )
                    .catch(
                        () =>
                            null
                    );

        }

        // Guardar relación
        config.users.set(

            member.id,

            {

                inviterId:
                    inviter?.id ||
                    null,

                inviteCode:
                    usedInvite?.code ||
                    null,

                joinedAt:
                    Date.now()

            }

        );

        // Estadísticas
        if (inviter) {

            const stats =
                getStats(
                    guild.id,
                    inviter.id
                );

            stats.total++;

            stats.active++;

        }

        // Si está apagado
        if (!config.enabled) {
            return;
        }

        // Canal
        if (!config.channelId) {
            return;
        }

        const channel =
            guild.channels.cache.get(
                config.channelId
            );

        if (!channel) {
            return;
        }

        if (
            channel.type !==
            ChannelType.GuildText
        ) {

            return;

        }

        let invites =
            0;

        if (inviter) {

            const stats =
                getStats(
                    guild.id,
                    inviter.id
                );

            invites =
                stats.active;

        }

        const message =
            parseMessage(

                config.message,

                {

                    user:
                        member.user,

                    inviter:
                        inviter,

                    invites:
                        invites,

                    server:
                        guild.name,

                    memberCount:
                        guild.memberCount

                }

            );

        try {

            await channel.send({

                content:
                    message

            });

        } catch (error) {

            console.error(
                "❌ Error enviando mensaje:",
                error
            );

        }

    }
);

// ============================================================
// MEMBER LEAVE
// ============================================================

client.on(
    Events.GuildMemberRemove,
    member => {

        const config =
            getConfig(
                member.guild.id
            );

        const data =
            config.users.get(
                member.id
            );

        if (!data) {
            return;
        }

        if (data.inviterId) {

            const stats =
                getStats(
                    member.guild.id,
                    data.inviterId
                );

            if (
                stats.active > 0
            ) {

                stats.active--;

            }

            stats.left++;

        }

        config.users.delete(
            member.id
        );

    }
);

// ============================================================
// INTERACTIONS
// ============================================================

client.on(
    Events.InteractionCreate,
    async interaction => {

        try {

            // =================================================
            // SLASH
            // =================================================

            if (
                interaction.isChatInputCommand()
            ) {

                // =============================================
                // HELP
                // =============================================

                if (
                    interaction.commandName ===
                    "help"
                ) {

                    const embed =
                        new EmbedBuilder()

                            .setColor(
                                0x7C3AED
                            )

                            .setTitle(
                                "🤖 NR INVITE"
                            )

                            .setDescription(
                                "Sistema avanzado de invitaciones para Discord."
                            )

                            .addFields(

                                {

                                    name:
                                        "🔴 Estado",

                                    value:
                                        "DND — No molestar",

                                    inline:
                                        true

                                },

                                {

                                    name:
                                        "🤖 Red",

                                    value:
                                        "Más de 10 bots en funcionamiento",

                                    inline:
                                        true

                                },

                                {

                                    name:
                                        "⚙️ Configuración",

                                    value:
                                        "`/setup invite`",

                                    inline:
                                        false

                                },

                                {

                                    name:
                                        "🟢 Activar",

                                    value:
                                        "`/active invites`",

                                    inline:
                                        true

                                },

                                {

                                    name:
                                        "📊 Invitaciones",

                                    value:
                                        "`/invites`",

                                    inline:
                                        true

                                },

                                {

                                    name:
                                        "🏆 Ranking",

                                    value:
                                        "`/leaderboard`",

                                    inline:
                                        true

                                },

                                {

                                    name:
                                        "🔧 Variables",

                                    value:
                                        "`@user`\n" +
                                        "`@inviter`\n" +
                                        "`{invites}`\n" +
                                        "`{server}`\n" +
                                        "`{memberCount}`"

                                },

                                {

                                    name:
                                        "📖 Guía",

                                    value:
                                        "1. Ejecuta `/setup invite`\n" +
                                        "2. Selecciona el canal de invites\n" +
                                        "3. Personaliza el mensaje\n" +
                                        "4. Comprueba la vista previa\n" +
                                        "5. Activa con `/active invites`"

                                },

                                {

                                    name:
                                        "🆘 Soporte",

                                    value:
                                        `[Servidor de soporte](${SUPPORT_SERVER})`

                                }

                            )

                            .setFooter({

                                text:
                                    "NR INVITE • Advanced Discord Invitation System"

                            });

                    return interaction.reply({

                        embeds:
                            [embed]

                    });

                }

                // =============================================
                // SETUP
                // =============================================

                if (
                    interaction.commandName ===
                    "setup"
                ) {

                    if (
                        interaction.options.getSubcommand() !==
                        "invite"
                    ) {

                        return;

                    }

                    if (
                        !interaction.memberPermissions?.has(
                            PermissionFlagsBits.Administrator
                        )
                    ) {

                        return interaction.reply({

                            content:
                                "❌ Necesitas permisos de administrador.",

                            ephemeral:
                                true

                        });

                    }

                    return interaction.reply({

                        ...createSetupPanel(
                            interaction.guild
                        ),

                        ephemeral:
                            true

                    });

                }

                // =============================================
                // ACTIVE
                // =============================================

                if (
                    interaction.commandName ===
                    "active"
                ) {

                    if (
                        interaction.options.getSubcommand() !==
                        "invites"
                    ) {

                        return;

                    }

                    if (
                        !interaction.memberPermissions?.has(
                            PermissionFlagsBits.Administrator
                        )
                    ) {

                        return interaction.reply({

                            content:
                                "❌ Necesitas permisos de administrador.",

                            ephemeral:
                                true

                        });

                    }

                    const config =
                        getConfig(
                            interaction.guild.id
                        );

                    config.enabled =
                        true;

                    return interaction.reply({

                        embeds: [

                            new EmbedBuilder()

                                .setColor(
                                    0x22C55E
                                )

                                .setTitle(
                                    "🟢 NR INVITE ACTIVADO"
                                )

                                .setDescription(
                                    "El sistema de invitaciones está activo."
                                )

                                .addFields({

                                    name:
                                        "📢 Canal",

                                    value:
                                        config.channelId
                                            ? `<#${config.channelId}>`
                                            : "❌ No configurado"

                                })

                        ],

                        ephemeral:
                            true

                    });

                }

                // =============================================
                // INVITES
                // =============================================

                if (
                    interaction.commandName ===
                    "invites"
                ) {

                    const user =
                        interaction.options.getUser(
                            "usuario"
                        ) ||
                        interaction.user;

                    const stats =
                        getStats(
                            interaction.guild.id,
                            user.id
                        );

                    const embed =
                        new EmbedBuilder()

                            .setColor(
                                0x7C3AED
                            )

                            .setTitle(
                                "📊 INVITACIONES"
                            )

                            .setDescription(
                                `Estadísticas de ${user}`
                            )

                            .addFields(

                                {

                                    name:
                                        "🔗 Totales",

                                    value:
                                        `**${stats.total}**`,

                                    inline:
                                        true

                                },

                                {

                                    name:
                                        "✅ Activas",

                                    value:
                                        `**${stats.active}**`,

                                    inline:
                                        true

                                },

                                {

                                    name:
                                        "🚪 Salieron",

                                    value:
                                        `**${stats.left}**`,

                                    inline:
                                        true

                                },

                                {

                                    name:
                                        "❌ Falsas",

                                    value:
                                        `**${stats.fake}**`,

                                    inline:
                                        true

                                }

                            )

                            .setThumbnail(
                                user.displayAvatarURL({
                                    size:
                                        256
                                })
                            );

                    return interaction.reply({

                        embeds:
                            [embed]

                    });

                }

                // =============================================
                // LEADERBOARD
                // =============================================

                if (
                    interaction.commandName ===
                    "leaderboard"
                ) {

                    const config =
                        getConfig(
                            interaction.guild.id
                        );

                    const ranking =
                        [...config.stats.entries()]

                            .sort(
                                (
                                    [, a],
                                    [, b]
                                ) =>
                                    b.active -
                                    a.active
                            )

                            .slice(
                                0,
                                10
                            );

                    if (
                        ranking.length ===
                        0
                    ) {

                        return interaction.reply({

                            content:
                                "📊 Todavía no hay invitaciones registradas.",

                            ephemeral:
                                true

                        });

                    }

                    let text =
                        "";

                    for (
                        let i = 0;
                        i < ranking.length;
                        i++
                    ) {

                        const [
                            userId,
                            stats
                        ] =
                            ranking[i];

                        const user =
                            await client.users
                                .fetch(
                                    userId
                                )
                                .catch(
                                    () =>
                                        null
                                );

                        const username =
                            user
                                ? user.username
                                : "Usuario desconocido";

                        let position;

                        if (
                            i === 0
                        ) {

                            position =
                                "🥇";

                        } else if (
                            i === 1
                        ) {

                            position =
                                "🥈";

                        } else if (
                            i === 2
                        ) {

                            position =
                                "🥉";

                        } else {

                            position =
                                `**${i + 1}.**`;

                        }

                        text +=
                            `${position} ${username} — **${stats.active}** invitaciones\n`;

                    }

                    const embed =
                        new EmbedBuilder()

                            .setColor(
                                0x7C3AED
                            )

                            .setTitle(
                                "🏆 TOP INVITADORES"
                            )

                            .setDescription(
                                text
                            )

                            .setFooter({

                                text:
                                    "NR INVITE"

                            });

                    return interaction.reply({

                        embeds:
                            [embed]

                    });

                }

            }

            // =================================================
            // SELECT MENUS
            // =================================================

            if (
                interaction.isStringSelectMenu()
            ) {

                // =============================================
                // SETUP MENU
                // =============================================

                if (
                    interaction.customId ===
                    "nr_invite_setup"
                ) {

                    if (
                        !interaction.memberPermissions?.has(
                            PermissionFlagsBits.Administrator
                        )
                    ) {

                        return interaction.reply({

                            content:
                                "❌ No tienes permisos.",

                            ephemeral:
                                true

                        });

                    }

                    const value =
                        interaction.values[0];

                    const config =
                        getConfig(
                            interaction.guild.id
                        );

                    // =========================================
                    // CHANNEL
                    // =========================================

                    if (
                        value ===
                        "channel"
                    ) {

                        const channels =
                            interaction.guild.channels.cache

                                .filter(
                                    channel =>
                                        channel.type ===
                                        ChannelType.GuildText
                                )

                                .first(
                                    25
                                );

                        if (
                            channels.length ===
                            0
                        ) {

                            return interaction.reply({

                                content:
                                    "❌ No hay canales de texto disponibles.",

                                ephemeral:
                                    true

                            });

                        }

                        const options =
                            channels.map(
                                channel => ({

                                    label:
                                        channel.name.slice(
                                            0,
                                            100
                                        ),

                                    description:
                                        "Canal para mensajes de invite",

                                    value:
                                        channel.id,

                                    emoji:
                                        "📢"

                                })
                            );

                        const menu =
                            new StringSelectMenuBuilder()

                                .setCustomId(
                                    "nr_invite_channel"
                                )

                                .setPlaceholder(
                                    "Selecciona el canal..."
                                )

                                .addOptions(
                                    options
                                );

                        return interaction.reply({

                            content:
                                "📢 **Selecciona el canal donde llegarán los mensajes de invite:**",

                            components: [

                                new ActionRowBuilder()
                                    .addComponents(
                                        menu
                                    )

                            ],

                            ephemeral:
                                true

                        });

                    }

                    // =========================================
                    // MESSAGE
                    // =========================================

                    if (
                        value ===
                        "message"
                    ) {

                        const modal =
                            new ModalBuilder()

                                .setCustomId(
                                    "nr_invite_message_modal"
                                )

                                .setTitle(
                                    "💬 Mensaje de Invite"
                                );

                        const input =
                            new TextInputBuilder()

                                .setCustomId(
                                    "nr_invite_message"
                                )

                                .setLabel(
                                    "Mensaje"
                                )

                                .setStyle(
                                    TextInputStyle.Paragraph
                                )

                                .setPlaceholder(
                                    "Escribe tu mensaje..."
                                )

                                .setValue(
                                    config.message
                                )

                                .setRequired(
                                    true
                                )

                                .setMinLength(
                                    1
                                )

                                .setMaxLength(
                                    2000
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

                    // =========================================
                    // PREVIEW
                    // =========================================

                    if (
                        value ===
                        "preview"
                    ) {

                        const stats =
                            getStats(
                                interaction.guild.id,
                                interaction.user.id
                            );

                        const preview =
                            parseMessage(

                                config.message,

                                {

                                    user:
                                        interaction.user,

                                    inviter:
                                        interaction.user,

                                    invites:
                                        stats.active,

                                    server:
                                        interaction.guild.name,

                                    memberCount:
                                        interaction.guild.memberCount

                                }

                            );

                        return interaction.reply({

                            embeds: [

                                new EmbedBuilder()

                                    .setColor(
                                        0x7C3AED
                                    )

                                    .setTitle(
                                        "👁️ VISTA PREVIA"
                                    )

                                    .setDescription(
                                        preview
                                    )

                            ],

                            ephemeral:
                                true

                        });

                    }

                    // =========================================
                    // ACTIVATE
                    // =========================================

                    if (
                        value ===
                        "activate"
                    ) {

                        config.enabled =
                            true;

                        return interaction.reply({

                            content:
                                "🟢 **NR INVITE activado correctamente.**",

                            ephemeral:
                                true

                        });

                    }

                    // =========================================
                    // DEACTIVATE
                    // =========================================

                    if (
                        value ===
                        "deactivate"
                    ) {

                        config.enabled =
                            false;

                        return interaction.reply({

                            content:
                                "🔴 **NR INVITE desactivado correctamente.**",

                            ephemeral:
                                true

                        });

                    }

                    // =========================================
                    // RESET
                    // =========================================

                    if (
                        value ===
                        "reset"
                    ) {

                        guildConfigs.set(

                            interaction.guild.id,

                            createDefaultConfig()

                        );

                        return interaction.reply({

                            content:
                                "♻️ **La configuración de NR INVITE fue restablecida.**",

                            ephemeral:
                                true

                        });

                    }

                }

                // =============================================
                // CHANNEL SELECT
                // =============================================

                if (
                    interaction.customId ===
                    "nr_invite_channel"
                ) {

                    const config =
                        getConfig(
                            interaction.guild.id
                        );

                    const channelId =
                        interaction.values[0];

                    config.channelId =
                        channelId;

                    return interaction.update({

                        content:
                            `✅ **Canal configurado.**\n\n📢 Los mensajes de invite llegarán a <#${channelId}>.`,

                        components:
                            []

                    });

                }

            }

            // =================================================
            // MODAL
            // =================================================

            if (
                interaction.isModalSubmit()
            ) {

                if (
                    interaction.customId !==
                    "nr_invite_message_modal"
                ) {

                    return;

                }

                const config =
                    getConfig(
                        interaction.guild.id
                    );

                const message =
                    interaction.fields.getTextInputValue(
                        "nr_invite_message"
                    );

                config.message =
                    message;

                return interaction.reply({

                    embeds: [

                        new EmbedBuilder()

                            .setColor(
                                0x22C55E
                            )

                            .setTitle(
                                "✅ MENSAJE ACTUALIZADO"
                            )

                            .setDescription(
                                "El mensaje de invite fue actualizado correctamente."
                            )

                    ],

                    ephemeral:
                        true

                });

            }

        } catch (error) {

            console.error(
                "❌ Error en interacción:",
                error
            );

            if (
                interaction.replied ||
                interaction.deferred
            ) {

                await interaction.followUp({

                    content:
                        "❌ Ocurrió un error procesando la acción.",

                    ephemeral:
                        true

                }).catch(
                    () => {}
                );

            } else {

                await interaction.reply({

                    content:
                        "❌ Ocurrió un error procesando la acción.",

                    ephemeral:
                        true

                }).catch(
                    () => {}
                );

            }

        }

    }
);

// ============================================================
// ERRORES
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

if (
    !TOKEN ||
    TOKEN ===
    "PON_AQUI_TU_TOKEN"
) {

    console.error(
        "❌ TOKEN no configurado."
    );

    process.exit(
        1
    );

}

client.login(
    TOKEN
);
