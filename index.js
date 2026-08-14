require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const path = require("path");

const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionsBitField,
    REST,
    Routes,
    SlashCommandBuilder
} = require("discord.js");

// ============================================================
// CONFIGURACIÓN
// ============================================================

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const DASHBOARD_URL =
    process.env.DASHBOARD_URL ||
    `http://localhost:${PORT}`;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

const REDIRECT_URI =
    process.env.DISCORD_REDIRECT_URI ||
    `${DASHBOARD_URL}/callback`;

const SESSION_SECRET =
    process.env.SESSION_SECRET ||
    crypto.randomBytes(32).toString("hex");

const SUPPORT_SERVER =
    process.env.SUPPORT_SERVER ||
    "https://discord.gg/PZw45tHPfc";

const SUPPORT_GUILD_ID =
    process.env.SUPPORT_GUILD_ID ||
    "1520985648457056266";

const SPECIAL_GUILD_ID =
    process.env.SPECIAL_GUILD_ID ||
    "1520985648457056266";

const OWNER_ID =
    process.env.OWNER_ID ||
    "";

const BOT_STATUS =
    process.env.BOT_STATUS ||
    "Más de 10 bots en funcionamiento | /help";

// ============================================================
// VALIDACIONES
// ============================================================

if (!DISCORD_TOKEN) {
    console.error("❌ Falta DISCORD_TOKEN en las variables de Render.");
}

if (!CLIENT_ID) {
    console.error("❌ Falta DISCORD_CLIENT_ID en las variables de Render.");
}

if (!CLIENT_SECRET) {
    console.error("❌ Falta DISCORD_CLIENT_SECRET en las variables de Render.");
}

// ============================================================
// EXPRESS
// ============================================================

app.disable("x-powered-by");

app.use(express.json({
    limit: "2mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "2mb"
}));

// ============================================================
// ALMACENAMIENTO EN MEMORIA
// SIN SQLITE / SIN MONGODB / SIN DB EXTERNA
// ============================================================

const sessions = new Map();

const inviteCache = new Map();

const guildConfigs = new Map();

const announcements = [];

const statistics = {
    dashboardLogins: 0,
    invitesTracked: 0,
    commandsUsed: 0,
    servers: 0
};

// ============================================================
// FUNCIONES GENERALES
// ============================================================

function randomId(length = 32) {
    return crypto
        .randomBytes(length)
        .toString("hex");
}

function escapeHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function createSession(user) {
    const sessionId = randomId(24);

    sessions.set(sessionId, {
        user,
        createdAt: Date.now(),
        expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7
    });

    return sessionId;
}

function getSession(req) {
    const raw = req.headers.cookie || "";

    const match = raw.match(
        /nr_session=([^;]+)/
    );

    if (!match) {
        return null;
    }

    const session = sessions.get(match[1]);

    if (!session) {
        return null;
    }

    if (Date.now() > session.expiresAt) {
        sessions.delete(match[1]);
        return null;
    }

    return session;
}

function setSessionCookie(res, sessionId) {
    res.setHeader(
        "Set-Cookie",
        `nr_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
    );
}

function clearSessionCookie(res) {
    res.setHeader(
        "Set-Cookie",
        "nr_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    );
}

function requireLogin(req, res, next) {
    const session = getSession(req);

    if (!session) {
        return res.redirect("/login");
    }

    req.user = session.user;

    next();
}

function requireOwner(req, res, next) {
    const session = getSession(req);

    if (!session) {
        return res.status(401).json({
            error: "No autenticado"
        });
    }

    if (
        OWNER_ID &&
        session.user.id !== OWNER_ID
    ) {
        return res.status(403).json({
            error: "No tienes permiso."
        });
    }

    req.user = session.user;

    next();
}

// ============================================================
// DISCORD CLIENT
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildInvites
    ],
    partials: [
        Partials.GuildMember,
        Partials.User
    ]
});

// ============================================================
// INVITES
// ============================================================

async function loadGuildInvites(guild) {
    try {
        const invites = await guild.invites.fetch();

        const data = new Map();

        for (const invite of invites.values()) {
            data.set(invite.code, {
                code: invite.code,
                uses: invite.uses || 0,
                inviterId: invite.inviter?.id || null,
                inviterUsername:
                    invite.inviter?.username ||
                    invite.inviter?.globalName ||
                    "Desconocido",
                channelId: invite.channel?.id || null,
                expiresAt: invite.expiresTimestamp || null
            });
        }

        inviteCache.set(
            guild.id,
            data
        );

        return data;
    } catch (error) {
        console.error(
            `No se pudieron cargar invites de ${guild.name}:`,
            error.message
        );

        return null;
    }
}

async function detectUsedInvite(member) {
    try {
        const guild = member.guild;

        const oldInvites =
            inviteCache.get(guild.id) ||
            new Map();

        const newInvites =
            await guild.invites.fetch();

        let usedInvite = null;

        for (const invite of newInvites.values()) {
            const old =
                oldInvites.get(invite.code);

            const oldUses =
                old?.uses || 0;

            const newUses =
                invite.uses || 0;

            if (newUses > oldUses) {
                usedInvite = invite;
                break;
            }
        }

        const updated = new Map();

        for (const invite of newInvites.values()) {
            updated.set(invite.code, {
                code: invite.code,
                uses: invite.uses || 0,
                inviterId:
                    invite.inviter?.id || null,
                inviterUsername:
                    invite.inviter?.username ||
                    invite.inviter?.globalName ||
                    "Desconocido",
                channelId:
                    invite.channel?.id || null,
                expiresAt:
                    invite.expiresTimestamp || null
            });
        }

        inviteCache.set(
            guild.id,
            updated
        );

        if (!usedInvite) {
            return null;
        }

        const inviterId =
            usedInvite.inviter?.id ||
            "unknown";

        const config =
            guildConfigs.get(guild.id) ||
            {
                invites: {},
                members: {}
            };

        if (!config.invites[inviterId]) {
            config.invites[inviterId] = {
                total: 0,
                fake: 0,
                leaves: 0,
                bonus: 0,
                username:
                    usedInvite.inviter?.username ||
                    "Desconocido"
            };
        }

        config.invites[inviterId].total += 1;

        config.invites[inviterId].username =
            usedInvite.inviter?.username ||
            usedInvite.inviter?.globalName ||
            config.invites[inviterId].username;

        config.members[member.id] = {
            inviterId,
            joinedAt: Date.now()
        };

        guildConfigs.set(
            guild.id,
            config
        );

        statistics.invitesTracked += 1;

        return usedInvite;
    } catch (error) {
        console.error(
            "Error detectando invite:",
            error.message
        );

        return null;
    }
}

// ============================================================
// READY
// ============================================================

client.once("clientReady", async () => {
    console.log(
        `✅ NR INVITE conectado como ${client.user.tag}`
    );

    client.user.setPresence({
        status: "dnd",
        activities: [
            {
                name: BOT_STATUS,
                type: 4
            }
        ]
    });

    statistics.servers =
        client.guilds.cache.size;

    for (const guild of client.guilds.cache.values()) {
        await loadGuildInvites(guild);
    }

    await registerCommands();

    console.log(
        `🌐 Dashboard: ${DASHBOARD_URL}`
    );

    console.log(
        `🔗 Callback: ${REDIRECT_URI}`
    );
});

// ============================================================
// EVENTOS DE SERVIDORES
// ============================================================

client.on("guildCreate", async guild => {
    statistics.servers =
        client.guilds.cache.size;

    await loadGuildInvites(guild);
});

client.on("guildDelete", guild => {
    inviteCache.delete(guild.id);
    guildConfigs.delete(guild.id);

    statistics.servers =
        client.guilds.cache.size;
});

client.on("guildMemberAdd", async member => {
    await detectUsedInvite(member);
});

client.on("guildMemberRemove", member => {
    const config =
        guildConfigs.get(member.guild.id);

    if (!config) {
        return;
    }

    const memberData =
        config.members?.[member.id];

    if (!memberData) {
        return;
    }

    const inviterId =
        memberData.inviterId;

    if (
        config.invites?.[inviterId]
    ) {
        config.invites[inviterId].leaves =
            (config.invites[inviterId].leaves || 0) + 1;
    }
});

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [
    new SlashCommandBuilder()
        .setName("help")
        .setDescription("Muestra la ayuda de NR INVITE"),

    new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Configura NR INVITE")
        .addSubcommand(sub =>
            sub
                .setName("invite")
                .setDescription("Configura el sistema de invites")
        ),

    new SlashCommandBuilder()
        .setName("active")
        .setDescription("Muestra invites activos")
        .addSubcommand(sub =>
            sub
                .setName("invites")
                .setDescription("Lista los invites activos")
        ),

    new SlashCommandBuilder()
        .setName("invites")
        .setDescription("Muestra tus invites"),

    new SlashCommandBuilder()
        .setName("leaderboard")
        .setDescription("Muestra el ranking de invites")
];

async function registerCommands() {
    if (!DISCORD_TOKEN || !CLIENT_ID) {
        return;
    }

    try {
        const rest = new REST({
            version: "10"
        }).setToken(DISCORD_TOKEN);

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            {
                body: commands.map(command =>
                    command.toJSON()
                )
            }
        );

        console.log(
            "✅ Slash commands registrados."
        );
    } catch (error) {
        console.error(
            "❌ Error registrando comandos:",
            error.message
        );
    }
}

// ============================================================
// INTERACCIONES
// ============================================================

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) {
        return;
    }

    statistics.commandsUsed += 1;

    if (interaction.commandName === "help") {
        return interaction.reply({
            ephemeral: true,
            content:
                "🤖 **NR INVITE**\n\n" +
                "`/setup invite` — Configurar invites\n" +
                "`/active invites` — Ver invites activos\n" +
                "`/invites` — Ver tus invites\n" +
                "`/leaderboard` — Ranking de invites\n" +
                "`/help` — Mostrar esta ayuda\n\n" +
                `🌐 Dashboard: ${DASHBOARD_URL}\n` +
                `🛠️ Soporte: ${SUPPORT_SERVER}`
        });
    }

    if (interaction.commandName === "setup") {
        if (
            !interaction.memberPermissions?.has(
                PermissionsBitField.Flags.ManageGuild
            )
        ) {
            return interaction.reply({
                ephemeral: true,
                content:
                    "❌ Necesitas **Gestionar servidor**."
            });
        }

        guildConfigs.set(
            interaction.guild.id,
            guildConfigs.get(
                interaction.guild.id
            ) || {
                invites: {},
                members: {},
                configuredAt: Date.now()
            }
        );

        await loadGuildInvites(
            interaction.guild
        );

        return interaction.reply({
            ephemeral: true,
            content:
                "✅ **NR INVITE configurado correctamente.**"
        });
    }

    if (
        interaction.commandName === "active" &&
        interaction.options.getSubcommand() === "invites"
    ) {
        try {
            const invites =
                await interaction.guild.invites.fetch();

            if (!invites.size) {
                return interaction.reply({
                    ephemeral: true,
                    content:
                        "No hay invites disponibles."
                });
            }

            const list =
                [...invites.values()]
                    .slice(0, 15)
                    .map(invite =>
                        `• \`${invite.code}\` — ${invite.uses || 0} usos — ${invite.inviter ? `<@${invite.inviter.id}>` : "Desconocido"}`
                    )
                    .join("\n");

            return interaction.reply({
                ephemeral: true,
                content:
                    `🔗 **Invites activos**\n\n${list}`
            });
        } catch {
            return interaction.reply({
                ephemeral: true,
                content:
                    "❌ No tengo permisos para consultar los invites."
            });
        }
    }

    if (interaction.commandName === "invites") {
        const config =
            guildConfigs.get(
                interaction.guild.id
            );

        const data =
            config?.invites?.[interaction.user.id];

        if (!data) {
            return interaction.reply({
                ephemeral: true,
                content:
                    "📊 Todavía no tienes invites registrados."
            });
        }

        const real =
            Math.max(
                0,
                data.total -
                data.fake -
                data.leaves
            );

        return interaction.reply({
            ephemeral: true,
            content:
                `📊 **Tus invites**\n\n` +
                `👤 Usuario: <@${interaction.user.id}>\n` +
                `📨 Total: **${data.total}**\n` +
                `✅ Reales: **${real}**\n` +
                `👻 Fake: **${data.fake}**\n` +
                `🚪 Salidas: **${data.leaves}**\n` +
                `🎁 Bonus: **${data.bonus}**`
        });
    }

    if (
        interaction.commandName === "leaderboard"
    ) {
        const config =
            guildConfigs.get(
                interaction.guild.id
            );

        const ranking =
            Object.entries(
                config?.invites || {}
            )
                .sort(
                    (a, b) =>
                        (b[1].total || 0) -
                        (a[1].total || 0)
                )
                .slice(0, 10);

        if (!ranking.length) {
            return interaction.reply({
                ephemeral: true,
                content:
                    "📊 Todavía no hay datos de invites."
            });
        }

        const text =
            ranking
                .map(
                    ([id, data], index) =>
                        `**${index + 1}.** <@${id}> — **${data.total || 0}** invites`
                )
                .join("\n");

        return interaction.reply({
            content:
                `🏆 **LEADERBOARD DE INVITES**\n\n${text}`
        });
    }
});

// ============================================================
// OAUTH2
// ============================================================

function getDiscordOAuthUrl() {
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: "identify guilds"
    });

    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(code) {
    const body =
        new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
            redirect_uri: REDIRECT_URI
        });

    const response =
        await fetch(
            "https://discord.com/api/oauth2/token",
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded"
                },
                body
            }
        );

    const data =
        await response.json();

    if (!response.ok) {
        throw new Error(
            data.error_description ||
            data.error ||
            "OAuth2 error"
        );
    }

    return data;
}

async function discordApi(
    endpoint,
    accessToken
) {
    const response =
        await fetch(
            `https://discord.com/api/v10${endpoint}`,
            {
                headers: {
                    Authorization:
                        `Bearer ${accessToken}`
                }
            }
        );

    const data =
        await response.json();

    if (!response.ok) {
        throw new Error(
            data.message ||
            "Discord API error"
        );
    }

    return data;
}

// ============================================================
// LOGIN
// ============================================================

app.get("/login", (req, res) => {
    if (!CLIENT_ID) {
        return res.status(500).send(
            "DISCORD_CLIENT_ID no configurado."
        );
    }

    return res.redirect(
        getDiscordOAuthUrl()
    );
});

app.get("/callback", async (req, res) => {
    try {
        const code =
            typeof req.query.code === "string"
                ? req.query.code
                : null;

        if (!code) {
            return res.status(400).send(
                "❌ Falta el código OAuth2."
            );
        }

        const token =
            await exchangeCode(code);

        const user =
            await discordApi(
                "/users/@me",
                token.access_token
            );

        const guilds =
            await discordApi(
                "/users/@me/guilds",
                token.access_token
            );

        user.guilds = guilds;

        const sessionId =
            createSession(user);

        setSessionCookie(
            res,
            sessionId
        );

        statistics.dashboardLogins += 1;

        return res.redirect(
            "/dashboard"
        );
    } catch (error) {
        console.error(
            "OAuth2 error:",
            error.message
        );

        return res.status(500).send(
            "❌ No se pudo iniciar sesión con Discord. Revisa CLIENT_ID, CLIENT_SECRET y DISCORD_REDIRECT_URI."
        );
    }
});

// ============================================================
// LOGOUT
// ============================================================

app.get("/logout", (req, res) => {
    const raw =
        req.headers.cookie || "";

    const match =
        raw.match(
            /nr_session=([^;]+)/
        );

    if (match) {
        sessions.delete(
            match[1]
        );
    }

    clearSessionCookie(res);

    res.redirect("/");
});

// ============================================================
// PÁGINA PRINCIPAL
// ============================================================

app.get("/", (req, res) => {
    const session =
        getSession(req);

    if (session) {
        return res.redirect(
            "/dashboard"
        );
    }

    res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NR INVITE</title>
<style>
*{box-sizing:border-box}
body{
    margin:0;
    font-family:Arial,Helvetica,sans-serif;
    background:#08090d;
    color:#fff;
    min-height:100vh;
    display:flex;
    align-items:center;
    justify-content:center;
}
.card{
    width:min(520px,92%);
    background:#11131a;
    border:1px solid #252936;
    border-radius:24px;
    padding:42px;
    text-align:center;
    box-shadow:0 20px 70px rgba(0,0,0,.45);
}
.logo{
    width:80px;
    height:80px;
    border-radius:22px;
    background:#5865f2;
    display:flex;
    align-items:center;
    justify-content:center;
    margin:0 auto 22px;
    font-size:32px;
    font-weight:900;
}
h1{margin:0 0 10px}
p{
    color:#a8adbb;
    line-height:1.6;
}
.btn{
    display:block;
    margin-top:26px;
    padding:15px;
    border-radius:12px;
    background:#5865f2;
    color:white;
    text-decoration:none;
    font-weight:700;
}
.support{
    display:block;
    margin-top:14px;
    color:#8f96a8;
    text-decoration:none;
}
</style>
</head>
<body>
<div class="card">
    <div class="logo">NR</div>
    <h1>NR INVITE</h1>
    <p>
        Sistema avanzado de seguimiento,
        estadísticas y gestión de invites para Discord.
    </p>

    <a class="btn" href="/login">
        Iniciar sesión con Discord
    </a>

    <a class="support"
       href="${escapeHtml(SUPPORT_SERVER)}"
       target="_blank">
        Servidor de soporte
    </a>
</div>
</body>
</html>
`);
});

// ============================================================
// DASHBOARD
// ============================================================

app.get(
    "/dashboard",
    requireLogin,
    (req, res) => {
        const user =
            req.user;

        const avatar =
            user.avatar
                ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
                : `https://cdn.discordapp.com/embed/avatars/0.png`;

        const isSpecial =
            user.guilds?.some(
                guild =>
                    guild.id === SPECIAL_GUILD_ID
            ) || false;

        res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NR INVITE Dashboard</title>

<style>
*{
    box-sizing:border-box;
}

body{
    margin:0;
    background:#090a0f;
    color:#fff;
    font-family:Arial,Helvetica,sans-serif;
}

.sidebar{
    position:fixed;
    left:0;
    top:0;
    bottom:0;
    width:245px;
    background:#0f1118;
    border-right:1px solid #242733;
    padding:24px 16px;
}

.brand{
    font-size:23px;
    font-weight:900;
    padding:12px;
    margin-bottom:25px;
}

.nav{
    display:block;
    padding:13px 14px;
    color:#a8adbb;
    text-decoration:none;
    border-radius:10px;
    margin-bottom:6px;
}

.nav:hover,
.nav.active{
    background:#5865f2;
    color:#fff;
}

.main{
    margin-left:245px;
    padding:30px;
}

.top{
    display:flex;
    justify-content:space-between;
    align-items:center;
    gap:20px;
    margin-bottom:28px;
}

.user{
    display:flex;
    align-items:center;
    gap:12px;
}

.user img{
    width:42px;
    height:42px;
    border-radius:50%;
}

.logout{
    color:#ff6b6b;
    text-decoration:none;
}

.cards{
    display:grid;
    grid-template-columns:
        repeat(auto-fit,minmax(190px,1fr));
    gap:16px;
}

.card{
    background:#11131b;
    border:1px solid #242733;
    border-radius:16px;
    padding:22px;
}

.number{
    font-size:30px;
    font-weight:900;
    margin-top:10px;
}

.muted{
    color:#8e95a7;
}

.special{
    margin-top:22px;
    padding:22px;
    border-radius:16px;
    border:1px solid #5865f2;
    background:#12162b;
}

.modal{
    position:fixed;
    inset:0;
    background:rgba(0,0,0,.72);
    display:flex;
    align-items:center;
    justify-content:center;
    z-index:1000;
}

.modal.hidden{
    display:none;
}

.modal-box{
    width:min(600px,92%);
    background:#151821;
    border:1px solid #303442;
    border-radius:18px;
    padding:28px;
    position:relative;
}

.close{
    position:absolute;
    right:16px;
    top:12px;
    border:0;
    background:none;
    color:#fff;
    font-size:26px;
    cursor:pointer;
}

.announcement{
    margin-top:20px;
    padding:18px;
    background:#1a1d27;
    border-radius:12px;
}

@media(max-width:800px){
    .sidebar{
        width:70px;
    }

    .brand{
        font-size:0;
    }

    .brand:first-letter{
        font-size:22px;
    }

    .nav{
        font-size:0;
        text-align:center;
    }

    .main{
        margin-left:70px;
        padding:18px;
    }
}
</style>
</head>

<body>

<aside class="sidebar">
    <div class="brand">NR INVITE</div>

    <a class="nav active" href="/dashboard">
        🏠 Inicio
    </a>

    <a class="nav" href="/dashboard/invites">
        🔗 Invites
    </a>

    <a class="nav" href="/dashboard/leaderboard">
        🏆 Ranking
    </a>

    <a class="nav" href="/dashboard/servers">
        🛡️ Servidores
    </a>

    <a class="nav" href="/dashboard/settings">
        ⚙️ Configuración
    </a>

    <a class="nav" href="${escapeHtml(SUPPORT_SERVER)}" target="_blank">
        🛠️ Soporte
    </a>

    <a class="nav" href="/logout">
        🚪 Cerrar sesión
    </a>
</aside>

<main class="main">

    <div class="top">
        <div>
            <h1>Dashboard</h1>
            <div class="muted">
                Bienvenido a NR INVITE
            </div>
        </div>

        <div class="user">
            <img src="${avatar}">
            <span>
                ${escapeHtml(
                    user.global_name ||
                    user.username ||
                    "Usuario"
                )}
            </span>
        </div>
    </div>

    <section class="cards">

        <div class="card">
            <div class="muted">
                Servidores
            </div>
            <div class="number">
                ${user.guilds?.length || 0}
            </div>
        </div>

        <div class="card">
            <div class="muted">
                Invites rastreados
            </div>
            <div class="number">
                ${statistics.invitesTracked}
            </div>
        </div>

        <div class="card">
            <div class="muted">
                Comandos usados
            </div>
            <div class="number">
                ${statistics.commandsUsed}
            </div>
        </div>

        <div class="card">
            <div class="muted">
                Usuarios Dashboard
            </div>
            <div class="number">
                ${statistics.dashboardLogins}
            </div>
        </div>

    </section>

    ${
        isSpecial
            ? `
    <section class="special">
        <h2>⭐ Panel especial</h2>
        <p class="muted">
            Tienes acceso al panel especial de NR INVITE.
        </p>
        <p>
            Servidor especial detectado correctamente.
        </p>
    </section>
    `
            : ""
    }

</main>

<div id="announcementModal" class="modal hidden">
    <div class="modal-box">

        <button
            class="close"
            onclick="closeAnnouncement()">
            ×
        </button>

        <h2>📢 Anuncio</h2>

        <div id="announcementContent"></div>

    </div>
</div>

<script>
async function loadAnnouncements(){

    try{

        const response =
            await fetch("/api/announcements");

        const data =
            await response.json();

        if(
            data.announcements &&
            data.announcements.length
        ){

            const latest =
                data.announcements[
                    data.announcements.length - 1
                ];

            const seen =
                localStorage.getItem(
                    "nr_announcement_" + latest.id
                );

            if(!seen){

                document
                    .getElementById(
                        "announcementContent"
                    )
                    .innerHTML =
                        latest.content;

                document
                    .getElementById(
                        "announcementModal"
                    )
                    .classList
                    .remove("hidden");
            }
        }

    }catch(error){
        console.error(error);
    }
}

function closeAnnouncement(){

    const modal =
        document.getElementById(
            "announcementModal"
        );

    modal.classList.add("hidden");

    const content =
        document.getElementById(
            "announcementContent"
        ).innerText;

    localStorage.setItem(
        "nr_announcement_closed",
        content
    );
}

loadAnnouncements();
</script>

</body>
</html>
`);
    }
);

// ============================================================
// API - ANUNCIOS
// ============================================================

app.get(
    "/api/announcements",
    requireLogin,
    (req, res) => {

        return res.json({
            announcements
        });
    }
);

// ============================================================
// API - PUBLICAR ANUNCIO
// ============================================================

app.post(
    "/api/announcements",
    requireOwner,
    (req, res) => {

        const content =
            typeof req.body.content === "string"
                ? req.body.content.trim()
                : "";

        if (!content) {
            return res.status(400).json({
                error:
                    "Debes proporcionar el contenido."
            });
        }

        const announcement = {
            id: randomId(12),
            content: escapeHtml(
                content
            ),
            createdAt: Date.now(),
            author: req.user.id
        };

        announcements.push(
            announcement
        );

        if (announcements.length > 50) {
            announcements.shift();
        }

        return res.json({
            success: true,
            announcement
        });
    }
);

// ============================================================
// INVITES DEL DASHBOARD
// ============================================================

app.get(
    "/dashboard/invites",
    requireLogin,
    (req, res) => {

        const guildList =
            req.user.guilds || [];

        res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NR INVITE - Invites</title>
<style>
body{
    margin:0;
    padding:40px;
    background:#090a0f;
    color:#fff;
    font-family:Arial;
}
a{
    color:#8f9aff;
    text-decoration:none;
}
.card{
    background:#11131b;
    border:1px solid #242733;
    padding:20px;
    border-radius:15px;
    margin-top:15px;
}
</style>
</head>
<body>

<a href="/dashboard">← Volver</a>

<h1>🔗 Invites</h1>

<p>
Selecciona un servidor para consultar
sus invites.
</p>

${guildList.map(guild => `
<div class="card">
    <strong>
        ${escapeHtml(guild.name)}
    </strong>

    <p>
        ID: ${guild.id}
    </p>
</div>
`).join("")}

</body>
</html>
`);
    }
);

// ============================================================
// LEADERBOARD DASHBOARD
// ============================================================

app.get(
    "/dashboard/leaderboard",
    requireLogin,
    (req, res) => {

        const all = [];

        for (
            const [guildId, config]
            of guildConfigs.entries()
        ) {

            if (
                !req.user.guilds?.some(
                    guild =>
                        guild.id === guildId
                )
            ) {
                continue;
            }

            for (
                const [userId, data]
                of Object.entries(
                    config.invites || {}
                )
            ) {

                all.push({
                    userId,
                    total:
                        data.total || 0
                });
            }
        }

        all.sort(
            (a, b) =>
                b.total - a.total
        );

        const ranking =
            all.slice(0, 50);

        res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NR INVITE - Ranking</title>
<style>
body{
    margin:0;
    padding:40px;
    background:#090a0f;
    color:#fff;
    font-family:Arial;
}
a{
    color:#8f9aff;
}
.item{
    background:#11131b;
    border:1px solid #242733;
    padding:17px;
    margin:10px 0;
    border-radius:12px;
}
</style>
</head>
<body>

<a href="/dashboard">← Volver</a>

<h1>🏆 Ranking</h1>

${
    ranking.length
        ? ranking.map(
            (item, index) => `
<div class="item">
    <strong>
        #${index + 1}
    </strong>
    &nbsp;
    ${escapeHtml(item.userId)}
    —
    <strong>
        ${item.total}
    </strong>
    invites
</div>
`
        ).join("")
        : "<p>Todavía no hay datos.</p>"
}

</body>
</html>
`);
    }
);

// ============================================================
// SERVIDORES
// ============================================================

app.get(
    "/dashboard/servers",
    requireLogin,
    (req, res) => {

        const guilds =
            req.user.guilds || [];

        res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NR INVITE - Servidores</title>
<style>
body{
    background:#090a0f;
    color:#fff;
    font-family:Arial;
    padding:30px;
}
a{
    color:#8f9aff;
}
.server{
    background:#11131b;
    border:1px solid #242733;
    border-radius:15px;
    padding:20px;
    margin:12px 0;
}
</style>
</head>
<body>

<a href="/dashboard">
← Volver
</a>

<h1>🛡️ Tus servidores</h1>

${guilds.map(guild => `
<div class="server">
    <h3>
        ${escapeHtml(guild.name)}
    </h3>

    <p>
        ID: ${guild.id}
    </p>

    <p>
        Permisos:
        ${guild.permissions || "N/A"}
    </p>
</div>
`).join("")}

</body>
</html>
`);
    }
);

// ============================================================
// CONFIGURACIÓN
// ============================================================

app.get(
    "/dashboard/settings",
    requireLogin,
    (req, res) => {

        res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NR INVITE - Configuración</title>
<style>
body{
    background:#090a0f;
    color:#fff;
    font-family:Arial;
    padding:30px;
}
a{
    color:#8f9aff;
}
.card{
    background:#11131b;
    border:1px solid #242733;
    border-radius:15px;
    padding:22px;
    margin-top:20px;
}
input{
    width:100%;
    padding:12px;
    margin-top:8px;
    border-radius:8px;
    border:1px solid #303442;
    background:#0b0d12;
    color:white;
}
</style>
</head>
<body>

<a href="/dashboard">
← Volver
</a>

<h1>⚙️ Configuración</h1>

<div class="card">
    <h3>NR INVITE</h3>

    <p>
        Estado:
        <strong>🟢 Online</strong>
    </p>

    <p>
        Estado del bot:
        ${escapeHtml(BOT_STATUS)}
    </p>

    <p>
        Servidor de soporte:
        ${escapeHtml(SUPPORT_SERVER)}
    </p>

    <p>
        Servidor especial:
        ${escapeHtml(SPECIAL_GUILD_ID)}
    </p>
</div>

</body>
</html>
`);
    }
);

// ============================================================
// HEALTH CHECK PARA RENDER
// ============================================================

app.get(
    "/health",
    (req, res) => {

        res.json({
            status: "ok",
            bot: client.isReady(),
            uptime: process.uptime(),
            timestamp: Date.now()
        });
    }
);

// ============================================================
// API ESTADÍSTICAS
// ============================================================

app.get(
    "/api/stats",
    requireLogin,
    (req, res) => {

        res.json({
            online: client.isReady(),
            servers:
                client.guilds.cache.size,
            dashboardLogins:
                statistics.dashboardLogins,
            invitesTracked:
                statistics.invitesTracked,
            commandsUsed:
                statistics.commandsUsed,
            uptime:
                process.uptime()
        });
    }
);

// ============================================================
// ERROR 404
// IMPORTANTE:
// NO usar app.get("*") porque Express 5 genera:
// Missing parameter name at index 1: *
// ============================================================

app.use(
    (req, res) => {

        if (
            req.path.startsWith("/api/")
        ) {
            return res.status(404).json({
                error: "Ruta no encontrada"
            });
        }

        return res.status(404).send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>404 - NR INVITE</title>
<style>
body{
    margin:0;
    min-height:100vh;
    display:flex;
    justify-content:center;
    align-items:center;
    background:#090a0f;
    color:#fff;
    font-family:Arial;
    text-align:center;
}
a{
    color:#8f9aff;
}
</style>
</head>
<body>
<div>
    <h1>404</h1>
    <p>La página que buscas no existe.</p>
    <a href="/">Volver al inicio</a>
</div>
</body>
</html>
`);
    }
);

// ============================================================
// MANEJO DE ERRORES
// ============================================================

app.use(
    (err, req, res, next) => {

        console.error(
            "❌ Error interno:",
            err
        );

        if (res.headersSent) {
            return next(err);
        }

        if (
            req.path.startsWith("/api/")
        ) {
            return res.status(500).json({
                error:
                    "Error interno del servidor"
            });
        }

        return res.status(500).send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Error - NR INVITE</title>
</head>
<body style="
    background:#090a0f;
    color:white;
    font-family:Arial;
    text-align:center;
    padding:50px;
">
<h1>❌ Error interno</h1>
<p>
NR INVITE encontró un problema.
</p>
<a
    href="/"
    style="color:#8f9aff"
>
Volver
</a>
</body>
</html>
`);
    }
);

// ============================================================
// INICIAR SERVIDOR
// ============================================================

app.listen(
    PORT,
    HOST,
    () => {

        console.log(
            `🌐 NR INVITE Dashboard iniciado en el puerto ${PORT}`
        );

        console.log(
            `🔗 Dashboard: ${DASHBOARD_URL}`
        );

        console.log(
            `🔗 OAuth2 Callback: ${REDIRECT_URI}`
        );

        console.log(
            `🛠️ Soporte: ${SUPPORT_SERVER}`
        );

        console.log(
            `⭐ Servidor especial: ${SPECIAL_GUILD_ID}`
        );
    }
);

// ============================================================
// INICIAR BOT
// ============================================================

if (DISCORD_TOKEN) {

    client.login(
        DISCORD_TOKEN
    ).catch(error => {

        console.error(
            "❌ No se pudo iniciar sesión en Discord:"
        );

        console.error(
            error.message
        );
    });

} else {

    console.error(
        "❌ DISCORD_TOKEN no está configurado."
    );
}

// ============================================================
// LIMPIEZA DE SESIONES
// ============================================================

setInterval(
    () => {

        const now =
            Date.now();

        for (
            const [id, session]
            of sessions.entries()
        ) {

            if (
                now >
                session.expiresAt
            ) {
                sessions.delete(id);
            }
        }

    },
    1000 * 60 * 30
);
