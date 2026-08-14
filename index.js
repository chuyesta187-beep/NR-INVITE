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
    ActivityType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    REST,
    Routes
} = require("discord.js");

const app = express();

const PORT = process.env.PORT || 3000;

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const DASHBOARD_URL =
    process.env.DASHBOARD_URL ||
    "https://nr-invite-1.onrender.com";

const SESSION_SECRET =
    process.env.SESSION_SECRET ||
    crypto.randomBytes(32).toString("hex");

const SUPPORT_INVITE =
    process.env.SUPPORT_INVITE ||
    "https://discord.gg/PZw45tHPfc";

const SUPPORT_CHANNEL_ID = "1521762536586743868";
const SPECIAL_SERVER_ID = "1520985648457056266";

const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || "soportework0@gmail.com";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

if (!TOKEN) {
    console.error("❌ Falta la variable TOKEN en Render.");
}

if (!CLIENT_ID) {
    console.error("❌ Falta la variable CLIENT_ID en Render.");
}

if (!CLIENT_SECRET) {
    console.error("❌ Falta la variable CLIENT_SECRET en Render.");
}

app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === "production",
            httpOnly: true,
            sameSite: "lax",
            maxAge: 1000 * 60 * 60 * 24 * 7
        }
    })
);

app.use(express.static(path.join(__dirname, "public")));

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

client.commands = new Collection();

const guildConfigs = new Map();
const inviteCache = new Map();
const supportTickets = new Map();
const announcements = [];
const processedAnnouncements = new Set();

const stats = {
    invitesCreated: 0,
    membersJoined: 0,
    membersLeft: 0,
    ticketsCreated: 0,
    ticketsResolved: 0
};

function isLogged(req) {
    return Boolean(req.session && req.session.user);
}

function requireLogin(req, res, next) {
    if (!isLogged(req)) {
        return res.redirect("/auth/discord");
    }

    next();
}

function escapeHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function getGuildConfig(guildId) {
    if (!guildConfigs.has(guildId)) {
        guildConfigs.set(guildId, {
            invite: {
                enabled: true,
                type: "embed",
                message: "👋 ¡Bienvenido {user} a {server}!",
                ping: false,
                roleId: null,
                channelId: null,
                giveOnce: true
            },
            leave: {
                enabled: true,
                type: "embed",
                message: "👋 {user} ha salido de {server}.",
                channelId: null,
                removeInvite: true
            },
            general: {
                logsChannelId: null,
                staffRoleId: null,
                prefix: "/",
                language: "es"
            }
        });
    }

    return guildConfigs.get(guildId);
}

function saveGuildConfig(guildId, data) {
    guildConfigs.set(guildId, data);
    return data;
}

function getInviteVariables() {
    return [
        "{user}",
        "{username}",
        "{inviter}",
        "{invites}",
        "{server}",
        "{memberCount}",
        "{guildId}"
    ];
}

function replaceVariables(text, data = {}) {
    let result = String(text || "");

    const variables = {
        "{user}": data.user || "",
        "{username}": data.username || "",
        "{inviter}": data.inviter || "",
        "{invites}": data.invites ?? 0,
        "{server}": data.server || "",
        "{memberCount}": data.memberCount ?? 0,
        "{guildId}": data.guildId || ""
    };

    for (const [key, value] of Object.entries(variables)) {
        result = result.replaceAll(key, String(value));
    }

    return result;
}

function dashboardShell(title, content, user) {
    const username = escapeHtml(user?.username || "Usuario");
    const avatar = user?.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
        : "https://cdn.discordapp.com/embed/avatars/0.png";

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — NR INVITE</title>
<style>
* {
    box-sizing: border-box;
}

body {
    margin: 0;
    font-family: Arial, Helvetica, sans-serif;
    background: #0b0b10;
    color: #fff;
}

header {
    height: 64px;
    background: #111118;
    border-bottom: 1px solid #272733;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 18px;
    position: sticky;
    top: 0;
    z-index: 20;
}

.brand {
    font-weight: 800;
    font-size: 19px;
}

.top {
    display: flex;
    align-items: center;
    gap: 14px;
}

.user {
    display: flex;
    align-items: center;
    gap: 8px;
}

.user img {
    width: 34px;
    height: 34px;
    border-radius: 50%;
}

.menu-button {
    border: 0;
    background: transparent;
    color: white;
    font-size: 24px;
    cursor: pointer;
}

.original {
    font-size: 14px;
    opacity: .75;
}

.layout {
    display: flex;
    min-height: calc(100vh - 64px);
}

.sidebar {
    width: 250px;
    background: #101017;
    border-right: 1px solid #272733;
    padding: 18px;
}

.sidebar a {
    display: block;
    color: #ddd;
    text-decoration: none;
    padding: 12px;
    border-radius: 10px;
    margin-bottom: 6px;
}

.sidebar a:hover {
    background: #1d1d29;
}

.main {
    flex: 1;
    padding: 28px;
    max-width: 1400px;
}

.card {
    background: #13131c;
    border: 1px solid #282834;
    border-radius: 18px;
    padding: 22px;
    margin-bottom: 18px;
}

.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 16px;
}

input,
select,
textarea {
    width: 100%;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid #333342;
    background: #0c0c12;
    color: white;
    margin-top: 7px;
}

textarea {
    min-height: 130px;
    resize: vertical;
}

button,
.btn {
    display: inline-block;
    border: 0;
    border-radius: 10px;
    padding: 11px 16px;
    cursor: pointer;
    background: #5865f2;
    color: white;
    text-decoration: none;
    font-weight: 700;
}

.btn.secondary {
    background: #272735;
}

label {
    display: block;
    margin-bottom: 14px;
    color: #ddd;
}

.stat {
    font-size: 30px;
    font-weight: 800;
}

.muted {
    color: #999;
}

@media (max-width: 800px) {
    .sidebar {
        display: none;
    }

    .main {
        padding: 18px;
    }

    .original {
        display: none;
    }
}
</style>
</head>
<body>

<header>
    <div class="top">
        <button class="menu-button" onclick="toggleMenu()">☰</button>
        <div class="brand">NR INVITE</div>
    </div>

    <div class="top">
        <div class="original">🐶 |\\| NR INVITE OFICIAL</div>

        <div>🔔</div>

        <div class="user">
            <img src="${avatar}" alt="Avatar">
            <span>${username}</span>
        </div>
    </div>
</header>

<div class="layout">

<aside class="sidebar" id="sidebar">
    <a href="/dashboard">🏠 Inicio</a>
    <a href="/servers">🛡️ Mis servidores</a>
    <a href="/support">🛠️ Soporte web</a>
    <a href="/logs">📋 Logs</a>
    <a href="/logout">🚪 Cerrar sesión</a>
</aside>

<main class="main">
${content}
</main>

</div>

<script>
function toggleMenu() {
    const sidebar = document.getElementById("sidebar");

    if (sidebar.style.display === "block") {
        sidebar.style.display = "";
    } else {
        sidebar.style.display = "block";
    }
}
</script>

</body>
</html>`;
}

function welcomePage(user) {
    return dashboardShell(
        "Bienvenido",
        `
        <div class="card">
            <h1>👋 ¡Bienvenido a NR INVITE!</h1>

            <p>
                ¡Nos alegra tenerte aquí! 🎉
            </p>

            <p>
                Este es el Dashboard oficial de NR INVITE,
                donde podrás administrar y controlar todas las
                funciones del bot desde un solo lugar.
            </p>

            <h2>🚀 Desde aquí podrás:</h2>

            <ul>
                <li>🔗 Gestionar tus invitaciones</li>
                <li>📊 Consultar estadísticas</li>
                <li>👥 Ver el crecimiento de tu servidor</li>
                <li>⚙️ Configurar NR INVITE</li>
                <li>🛡️ Administrar funciones de seguridad</li>
                <li>📢 Gestionar promociones y herramientas</li>
                <li>🌐 Cambiar el idioma del Dashboard</li>
            </ul>

            <p>
                💡 <strong>Primer paso:</strong> selecciona un servidor
                y comienza a configurar NR INVITE.
            </p>

            <p class="muted">
                NR INVITE — Invitaciones, estadísticas y administración
                en un solo lugar.
            </p>

            <a class="btn" href="/servers">Panel</a>
            <a class="btn secondary" href="${SUPPORT_INVITE}" target="_blank">
                Servidor de soporte
            </a>
        </div>
        `,
        user
    );
}

function hasManageGuild(guild, userId) {
    if (!guild) return false;

    if (guild.ownerId === userId) {
        return true;
    }

    const permissions = BigInt(guild.permissions || 0);

    return (
        (permissions & PermissionFlagsBits.ManageGuild) ===
        PermissionFlagsBits.ManageGuild
    );
}

function getUserGuilds(userId) {
    if (!client.isReady()) {
        return [];
    }

    return client.guilds.cache
        .filter(guild => hasManageGuild(guild, userId))
        .map(guild => ({
            id: guild.id,
            name: guild.name,
            icon: guild.iconURL({
                extension: "png",
                size: 256
            }),
            banner: guild.bannerURL({
                extension: "png",
                size: 1024
            })
        }));
}

function serversPage(user) {
    const guilds = getUserGuilds(user.id);

    const cards = guilds.length
        ? guilds.map(guild => {
            const inServer = client.guilds.cache.has(guild.id);

            const background = guild.banner
                ? `background-image:url('${guild.banner}')`
                : "";

            return `
            <div class="card" style="${background};background-size:cover;background-position:center;">
                <div style="background:rgba(10,10,15,.86);padding:20px;border-radius:14px;">
                    <img
                        src="${guild.icon || "https://cdn.discordapp.com/embed/avatars/0.png"}"
                        style="width:70px;height:70px;border-radius:50%;"
                    >

                    <h2>${escapeHtml(guild.name)}</h2>

                    ${
                        inServer
                            ? `<a class="btn" href="/server/${guild.id}">
                                PANEL
                               </a>`
                            : `<a class="btn" href="https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot%20applications.commands&permissions=8" target="_blank">
                                INVITAR
                               </a>`
                    }
                </div>
            </div>
            `;
        }).join("")
        : `
        <div class="card">
            <h2>😕 No encontramos servidores</h2>
            <p class="muted">
                Necesitas administrar un servidor donde puedas configurar NR INVITE.
            </p>
        </div>
        `;

    return dashboardShell(
        "Mis servidores",
        `
        <h1>🛡️ Mis servidores</h1>
        <p class="muted">
            Selecciona un servidor para administrar NR INVITE.
        </p>

        <div class="grid">
            ${cards}
        </div>
        `,
        user
    );
}

function serverPage(user, guild) {
    const config = getGuildConfig(guild.id);

    return dashboardShell(
        guild.name,
        `
        <div class="card">
            <h1>☰ Menú principal</h1>
            <p>
                Administrando <strong>${escapeHtml(guild.name)}</strong>
            </p>
        </div>

        <div class="grid">

            <div class="card">
                <h2>🔗 Setup Invite</h2>
                <p class="muted">
                    Configura el mensaje cuando una persona entra.
                </p>
                <a class="btn" href="/server/${guild.id}/invite">
                    Configurar
                </a>
            </div>

            <div class="card">
                <h2>🚪 Salida</h2>
                <p class="muted">
                    Configura el mensaje cuando una persona sale.
                </p>
                <a class="btn" href="/server/${guild.id}/leave">
                    Configurar
                </a>
            </div>

            <div class="card">
                <h2>⚙️ Configuración general</h2>
                <p class="muted">
                    Logs, staff y preferencias.
                </p>
                <a class="btn" href="/server/${guild.id}/general">
                    Configurar
                </a>
            </div>

            <div class="card">
                <h2>📊 Estadísticas</h2>
                <div class="stat">
                    ${stats.membersJoined}
                </div>
                <p class="muted">Miembros registrados</p>
            </div>

        </div>

        <div style="position:fixed;right:22px;bottom:22px;">
            <a class="btn" href="/support">🛠️</a>
        </div>
        `,
        user
    );
}

function configInvitePage(user, guild) {
    const config = getGuildConfig(guild.id);

    return dashboardShell(
        "Setup Invite",
        `
        <div class="card">
            <h1>🔗 Setup Invite</h1>

            <form method="POST" action="/server/${guild.id}/invite">

                <label>
                    Tipo de mensaje
                    <select name="type">
                        <option value="embed" ${config.invite.type === "embed" ? "selected" : ""}>
                            Embed
                        </option>
                        <option value="normal" ${config.invite.type === "normal" ? "selected" : ""}>
                            Mensaje normal
                        </option>
                    </select>
                </label>

                <label>
                    Mensaje
                    <textarea name="message">${escapeHtml(config.invite.message)}</textarea>
                </label>

                <label>
                    Ping mencionable
                    <select name="ping">
                        <option value="false" ${!config.invite.ping ? "selected" : ""}>
                            No
                        </option>
                        <option value="true" ${config.invite.ping ? "selected" : ""}>
                            Sí
                        </option>
                    </select>
                </label>

                <label>
                    ID del rol
                    <input
                        name="roleId"
                        value="${escapeHtml(config.invite.roleId || "")}"
                        placeholder="Opcional"
                    >
                </label>

                <label>
                    ID del canal
                    <input
                        name="channelId"
                        value="${escapeHtml(config.invite.channelId || "")}"
                        placeholder="Canal donde se enviará"
                    >
                </label>

                <div class="card">
                    <h3>Variables disponibles</h3>

                    ${getInviteVariables()
                        .map(variable => `<code>${variable}</code>`)
                        .join(" &nbsp; ")}
                </div>

                <button type="submit">
                    💾 Guardar configuración
                </button>

            </form>
        </div>
        `,
        user
    );
}

function configLeavePage(user, guild) {
    const config = getGuildConfig(guild.id);

    return dashboardShell(
        "Salida",
        `
        <div class="card">
            <h1>🚪 Configuración de salida</h1>

            <form method="POST" action="/server/${guild.id}/leave">

                <label>
                    Tipo de mensaje
                    <select name="type">
                        <option value="embed" ${config.leave.type === "embed" ? "selected" : ""}>
                            Embed
                        </option>
                        <option value="normal" ${config.leave.type === "normal" ? "selected" : ""}>
                            Mensaje normal
                        </option>
                    </select>
                </label>

                <label>
                    Mensaje
                    <textarea name="message">${escapeHtml(config.leave.message)}</textarea>
                </label>

                <label>
                    ID del canal
                    <input
                        name="channelId"
                        value="${escapeHtml(config.leave.channelId || "")}"
                    >
                </label>

                <label>
                    Quitar invite al usuario
                    <select name="removeInvite">
                        <option value="true" ${config.leave.removeInvite ? "selected" : ""}>
                            Sí
                        </option>
                        <option value="false" ${!config.leave.removeInvite ? "selected" : ""}>
                            No
                        </option>
                    </select>
                </label>

                <button type="submit">
                    💾 Guardar configuración
                </button>

            </form>
        </div>
        `,
        user
    );
}

function generalConfigPage(user, guild) {
    const config = getGuildConfig(guild.id);

    return dashboardShell(
        "Configuración general",
        `
        <div class="card">
            <h1>⚙️ Configuración general</h1>

            <form method="POST" action="/server/${guild.id}/general">

                <label>
                    Canal de logs
                    <input
                        name="logsChannelId"
                        value="${escapeHtml(config.general.logsChannelId || "")}"
                    >
                </label>

                <label>
                    Rol Staff
                    <input
                        name="staffRoleId"
                        value="${escapeHtml(config.general.staffRoleId || "")}"
                    >
                </label>

                <label>
                    Idioma
                    <select name="language">
                        <option value="es" ${config.general.language === "es" ? "selected" : ""}>
                            Español
                        </option>
                        <option value="en" ${config.general.language === "en" ? "selected" : ""}>
                            English
                        </option>
                    </select>
                </label>

                <button type="submit">
                    💾 Guardar configuración
                </button>

            </form>
        </div>
        `,
        user
    );
}

function supportPage(user) {
    return dashboardShell(
        "Soporte web",
        `
        <div class="card">
            <h1>🛠️ Soporte web</h1>

            <p class="muted">
                Completa el formulario y nuestro equipo revisará tu solicitud.
            </p>

            <form method="POST" action="/support">

                <label>
                    Nombre
                    <input
                        name="name"
                        required
                        value="${escapeHtml(user.username)}"
                    >
                </label>

                <label>
                    Correo electrónico
                    <input
                        type="email"
                        name="email"
                        required
                        placeholder="tu-correo@gmail.com"
                    >
                </label>

                <label>
                    Tipo de problema
                    <select name="type" required>
                        <option value="">Selecciona una opción</option>
                        <option value="Problema con el bot">
                            Problema con el bot
                        </option>
                        <option value="Problema con el Dashboard">
                            Problema con el Dashboard
                        </option>
                        <option value="Configuración">
                            Configuración
                        </option>
                        <option value="Error">
                            Reportar error
                        </option>
                        <option value="Sugerencia">
                            Sugerencia
                        </option>
                        <option value="Otro">
                            Otro
                        </option>
                    </select>
                </label>

                <label>
                    Servidor
                    <input
                        name="server"
                        placeholder="ID o nombre del servidor"
                    >
                </label>

                <label>
                    Asunto
                    <input
                        name="subject"
                        required
                        placeholder="Describe brevemente el problema"
                    >
                </label>

                <label>
                    Descripción
                    <textarea
                        name="description"
                        required
                        placeholder="Explica detalladamente lo ocurrido..."
                    ></textarea>
                </label>

                <button type="submit">
                    📩 Enviar solicitud
                </button>

            </form>
        </div>
        `,
        user
    );
}

const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: SMTP_PASS
        ? {
            user: SMTP_USER,
            pass: SMTP_PASS
        }
        : undefined
});

async function sendSupportEmail(to, ticket) {
    if (!SMTP_PASS) {
        console.log("⚠️ SMTP_PASS no está configurado.");
        return false;
    }

    try {
        await transporter.sendMail({
            from: SMTP_FROM,
            to,
            subject: `NR INVITE — Resultado de soporte: ${ticket.subject}`,
            html: `
                <h2>NR INVITE — Resultado de soporte</h2>

                <p>Hola <strong>${escapeHtml(ticket.name)}</strong>.</p>

                <p>
                    Tu solicitud de soporte ha sido procesada.
                </p>

                <hr>

                <p><strong>Tipo:</strong> ${escapeHtml(ticket.type)}</p>
                <p><strong>Asunto:</strong> ${escapeHtml(ticket.subject)}</p>
                <p><strong>Estado:</strong> ${escapeHtml(ticket.status)}</p>

                <p>
                    <strong>Respuesta:</strong><br>
                    ${escapeHtml(ticket.response || "Sin respuesta")}
                </p>

                <hr>

                <p>
                    NR INVITE — Soporte oficial
                </p>
            `
        });

        return true;
    } catch (error) {
        console.error("❌ Error enviando correo:", error);
        return false;
    }
}

async function sendSupportDiscord(ticket) {
    if (!client.isReady()) {
        return null;
    }

    const channel = await client.channels
        .fetch(SUPPORT_CHANNEL_ID)
        .catch(() => null);

    if (!channel || !channel.isTextBased()) {
        console.error("❌ Canal de soporte no encontrado.");
        return null;
    }

    const embed = new EmbedBuilder()
        .setTitle("🛠️ Nueva solicitud de soporte")
        .setDescription(
            `Se recibió una nueva solicitud desde el Dashboard de NR INVITE.`
        )
        .addFields(
            {
                name: "👤 Usuario",
                value: `${ticket.name}\nID: ${ticket.userId}`,
                inline: true
            },
            {
                name: "📧 Correo",
                value: ticket.email,
                inline: true
            },
            {
                name: "📂 Tipo",
                value: ticket.type,
                inline: true
            },
            {
                name: "📌 Asunto",
                value: ticket.subject,
                inline: false
            },
            {
                name: "📝 Descripción",
                value: ticket.description.slice(0, 1024),
                inline: false
            }
        )
        .setFooter({
            text: `Ticket ${ticket.id} • NR INVITE`
        })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ticket_resolve_${ticket.id}`)
            .setLabel("Resolver")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId(`ticket_reject_${ticket.id}`)
            .setLabel("Rechazar")
            .setEmoji("❌")
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId(`ticket_contact_${ticket.id}`)
            .setLabel("Contactar")
            .setEmoji("📩")
            .setStyle(ButtonStyle.Primary)
    );

    const message = await channel.send({
        embeds: [embed],
        components: [row]
    });

    return message.id;
}

app.get("/", (req, res) => {
    if (isLogged(req)) {
        return res.redirect("/dashboard");
    }

    res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NR INVITE</title>
<style>
body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0b0b10;
    color: white;
    font-family: Arial, sans-serif;
}

.card {
    width: min(700px, 90%);
    padding: 40px;
    background: #15151e;
    border: 1px solid #292936;
    border-radius: 24px;
    text-align: center;
}

a {
    display: inline-block;
    padding: 13px 20px;
    background: #5865f2;
    color: white;
    text-decoration: none;
    border-radius: 10px;
    font-weight: bold;
    margin: 5px;
}
</style>
</head>
<body>
<div class="card">
    <h1>👋 ¡Bienvenido a NR INVITE!</h1>

    <p>
        Invitaciones, estadísticas y administración
        en un solo lugar.
    </p>

    <a href="/auth/discord">Panel</a>
    <a href="${SUPPORT_INVITE}" target="_blank">
        Servidor de soporte
    </a>
</div>
</body>
</html>
    `);
});

app.get("/auth/discord", (req, res) => {
    const state = crypto.randomBytes(24).toString("hex");

    req.session.oauthState = state;

    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: `${DASHBOARD_URL}/auth/callback`,
        scope: "identify guilds",
        state
    });

    res.redirect(
        `https://discord.com/oauth2/authorize?${params.toString()}`
    );
});

app.get("/auth/callback", async (req, res) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            return res.status(400).send("Falta el código OAuth2.");
        }

        if (!state || state !== req.session.oauthState) {
            return res.status(403).send("Estado OAuth2 inválido.");
        }

        delete req.session.oauthState;

        const body = new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
            redirect_uri: `${DASHBOARD_URL}/auth/callback`
        });

        const tokenResponse = await fetch(
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

        if (!tokenResponse.ok) {
            const error = await tokenResponse.text();

            console.error("OAuth token error:", error);

            return res.status(401).send(
                "No fue posible iniciar sesión con Discord."
            );
        }

        const tokenData = await tokenResponse.json();

        const userResponse = await fetch(
            "https://discord.com/api/users/@me",
            {
                headers: {
                    Authorization:
                        `${tokenData.token_type} ${tokenData.access_token}`
                }
            }
        );

        if (!userResponse.ok) {
            return res.status(401).send(
                "No fue posible obtener tu usuario de Discord."
            );
        }

        const discordUser = await userResponse.json();

        req.session.user = discordUser;

        res.redirect("/dashboard");

    } catch (error) {
        console.error("OAuth callback error:", error);
        res.status(500).send("Error interno de autenticación.");
    }
});

app.get("/dashboard", requireLogin, (req, res) => {
    res.send(welcomePage(req.session.user));
});

app.get("/servers", requireLogin, (req, res) => {
    res.send(serversPage(req.session.user));
});

app.get("/server/:guildId", requireLogin, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);

    if (!guild) {
        return res.status(404).send("El bot no está en este servidor.");
    }

    if (!hasManageGuild(guild, req.session.user.id)) {
        return res.status(403).send("No tienes permisos para administrar este servidor.");
    }

    res.send(serverPage(req.session.user, guild));
});

app.get("/server/:guildId/invite", requireLogin, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);

    if (!guild) {
        return res.status(404).send("Servidor no encontrado.");
    }

    if (!hasManageGuild(guild, req.session.user.id)) {
        return res.status(403).send("Sin permisos.");
    }

    res.send(configInvitePage(req.session.user, guild));
});

app.post("/server/:guildId/invite", requireLogin, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);

    if (!guild) {
        return res.status(404).send("Servidor no encontrado.");
    }

    if (!hasManageGuild(guild, req.session.user.id)) {
        return res.status(403).send("Sin permisos.");
    }

    const config = getGuildConfig(guild.id);

    config.invite.type =
        req.body.type === "normal"
            ? "normal"
            : "embed";

    config.invite.message =
        req.body.message || config.invite.message;

    config.invite.ping =
        req.body.ping === "true";

    config.invite.roleId =
        req.body.roleId || null;

    config.invite.channelId =
        req.body.channelId || null;

    saveGuildConfig(guild.id, config);

    res.redirect(`/server/${guild.id}/invite`);
});

app.get("/server/:guildId/leave", requireLogin, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);

    if (!guild) {
        return res.status(404).send("Servidor no encontrado.");
    }

    if (!hasManageGuild(guild, req.session.user.id)) {
        return res.status(403).send("Sin permisos.");
    }

    res.send(configLeavePage(req.session.user, guild));
});

app.post("/server/:guildId/leave", requireLogin, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);

    if (!guild) {
        return res.status(404).send("Servidor no encontrado.");
    }

    if (!hasManageGuild(guild, req.session.user.id)) {
        return res.status(403).send("Sin permisos.");
    }

    const config = getGuildConfig(guild.id);

    config.leave.type =
        req.body.type === "normal"
            ? "normal"
            : "embed";

    config.leave.message =
        req.body.message || config.leave.message;

    config.leave.channelId =
        req.body.channelId || null;

    config.leave.removeInvite =
        req.body.removeInvite !== "false";

    saveGuildConfig(guild.id, config);

    res.redirect(`/server/${guild.id}/leave`);
});

app.get("/server/:guildId/general", requireLogin, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);

    if (!guild) {
        return res.status(404).send("Servidor no encontrado.");
    }

    if (!hasManageGuild(guild, req.session.user.id)) {
        return res.status(403).send("Sin permisos.");
    }

    res.send(generalConfigPage(req.session.user, guild));
});

app.post("/server/:guildId/general", requireLogin, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);

    if (!guild) {
        return res.status(404).send("Servidor no encontrado.");
    }

    if (!hasManageGuild(guild, req.session.user.id)) {
        return res.status(403).send("Sin permisos.");
    }

    const config = getGuildConfig(guild.id);

    config.general.logsChannelId =
        req.body.logsChannelId || null;

    config.general.staffRoleId =
        req.body.staffRoleId || null;

    config.general.language =
        req.body.language || "es";

    saveGuildConfig(guild.id, config);

    res.redirect(`/server/${guild.id}/general`);
});

app.get("/support", requireLogin, (req, res) => {
    res.send(supportPage(req.session.user));
});

app.post("/support", requireLogin, async (req, res) => {
    const {
        name,
        email,
        type,
        server,
        subject,
        description
    } = req.body;

    if (
        !name ||
        !email ||
        !type ||
        !subject ||
        !description
    ) {
        return res.status(400).send(
            "Todos los campos obligatorios deben completarse."
        );
    }

    const ticket = {
        id: crypto.randomBytes(6).toString("hex").toUpperCase(),
        userId: req.session.user.id,
        name,
        email,
        type,
        server: server || "No indicado",
        subject,
        description,
        status: "Pendiente",
        response: "",
        createdAt: new Date().toISOString()
    };

    supportTickets.set(ticket.id, ticket);

    stats.ticketsCreated++;

    const messageId = await sendSupportDiscord(ticket);

    ticket.messageId = messageId;

    res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Solicitud enviada</title>
<style>
body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    background: #0b0b10;
    color: white;
    font-family: Arial, sans-serif;
}
.card {
    width: min(600px, 90%);
    padding: 35px;
    background: #15151e;
    border-radius: 20px;
    text-align: center;
}
a {
    display: inline-block;
    margin-top: 15px;
    padding: 12px 18px;
    border-radius: 10px;
    background: #5865f2;
    color: white;
    text-decoration: none;
}
</style>
</head>
<body>
<div class="card">
    <h1>✅ Solicitud enviada</h1>

    <p>
        Tu solicitud fue enviada correctamente
        al equipo oficial de NR INVITE.
    </p>

    <p>
        <strong>ID del ticket:</strong>
        ${escapeHtml(ticket.id)}
    </p>

    <p>
        📧 Te enviaremos el resultado al correo:
        <strong>${escapeHtml(email)}</strong>
    </p>

    <a href="/dashboard">Volver al Dashboard</a>
</div>
</body>
</html>
    `);
});

app.get("/logs", requireLogin, (req, res) => {
    const items = [...supportTickets.values()]
        .slice(-30)
        .reverse();

    res.send(
        dashboardShell(
            "Logs",
            `
            <div class="card">
                <h1>📋 Logs</h1>

                ${
                    items.length
                        ? items.map(ticket => `
                            <div class="card">
                                <strong>${escapeHtml(ticket.id)}</strong>
                                <p>
                                    ${escapeHtml(ticket.subject)}
                                </p>
                                <span class="muted">
                                    ${escapeHtml(ticket.status)}
                                </span>
                            </div>
                        `).join("")
                        : `<p class="muted">No hay registros.</p>`
                }
            </div>
            `,
            req.session.user
        )
    );
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/");
    });
});

client.on("ready", async () => {
    console.log(`✅ NR INVITE conectado como ${client.user.tag}`);

    client.user.setPresence({
        status: "dnd",
        activities: [
            {
                name: "Más de 10 bots en funcionamiento | /help",
                type: ActivityType.Watching
            }
        ]
    });

    for (const guild of client.guilds.cache.values()) {
        try {
            const invites = await guild.invites.fetch();

            inviteCache.set(
                guild.id,
                new Map(
                    invites.map(invite => [
                        invite.code,
                        invite.uses || 0
                    ])
                )
            );
        } catch (error) {
            console.error(
                `No se pudieron cargar invites de ${guild.name}:`,
                error.message
            );
        }
    }
});

client.on("guildCreate", guild => {
    console.log(
        `➕ NR INVITE añadido a: ${guild.name} (${guild.id})`
    );
});

client.on("guildDelete", guild => {
    console.log(
        `➖ NR INVITE eliminado de: ${guild.name} (${guild.id})`
    );

    guildConfigs.delete(guild.id);
    inviteCache.delete(guild.id);
});

client.on("guildMemberAdd", async member => {
    stats.membersJoined++;

    const config = getGuildConfig(member.guild.id);

    let inviter = "Desconocido";
    let inviteCount = 0;

    try {
        const oldInvites =
            inviteCache.get(member.guild.id) ||
            new Map();

        const newInvites =
            await member.guild.invites.fetch();

        let usedInvite = null;

        for (const invite of newInvites.values()) {
            const oldUses =
                oldInvites.get(invite.code) || 0;

            if ((invite.uses || 0) > oldUses) {
                usedInvite = invite;
                break;
            }
        }

        inviteCache.set(
            member.guild.id,
            new Map(
                newInvites.map(invite => [
                    invite.code,
                    invite.uses || 0
                ])
            )
        );

        if (usedInvite?.inviter) {
            inviter =
                usedInvite.inviter.toString();

            inviteCount =
                usedInvite.uses || 0;
        }

        if (usedInvite) {
            stats.invitesCreated++;
        }

    } catch (error) {
        console.error(
            "Error detectando invitación:",
            error.message
        );
    }

    if (!config.invite.enabled) {
        return;
    }

    const channel =
        config.invite.channelId
            ? member.guild.channels.cache.get(
                config.invite.channelId
            )
            : member.guild.systemChannel;

    if (!channel || !channel.isTextBased()) {
        return;
    }

    const message = replaceVariables(
        config.invite.message,
        {
            user: `<@${member.id}>`,
            username: member.user.username,
            inviter,
            invites: inviteCount,
            server: member.guild.name,
            memberCount: member.guild.memberCount,
            guildId: member.guild.id
        }
    );

    try {
        if (config.invite.type === "embed") {
            const embed = new EmbedBuilder()
                .setTitle("🎉 ¡Nuevo miembro!")
                .setDescription(message)
                .setThumbnail(
                    member.user.displayAvatarURL()
                )
                .setColor(0x5865F2)
                .setTimestamp();

            await channel.send({
                embeds: [embed],
                allowedMentions: {
                    users: config.invite.ping
                        ? [member.id]
                        : []
                }
            });
        } else {
            await channel.send({
                content: message,
                allowedMentions: {
                    users: config.invite.ping
                        ? [member.id]
                        : []
                }
            });
        }
    } catch (error) {
        console.error(
            "Error enviando mensaje de entrada:",
            error.message
        );
    }
});

client.on("guildMemberRemove", async member => {
    stats.membersLeft++;

    const config = getGuildConfig(member.guild.id);

    if (!config.leave.enabled) {
        return;
    }

    const channel =
        config.leave.channelId
            ? member.guild.channels.cache.get(
                config.leave.channelId
            )
            : member.guild.systemChannel;

    if (!channel || !channel.isTextBased()) {
        return;
    }

    const message = replaceVariables(
        config.leave.message,
        {
            user: `<@${member.id}>`,
            username: member.user.username,
            server: member.guild.name,
            memberCount: member.guild.memberCount,
            guildId: member.guild.id
        }
    );

    try {
        if (config.leave.type === "embed") {
            const embed = new EmbedBuilder()
                .setTitle("👋 Miembro salió")
                .setDescription(message)
                .setThumbnail(
                    member.user.displayAvatarURL()
                )
                .setColor(0xED4245)
                .setTimestamp();

            await channel.send({
                embeds: [embed]
            });
        } else {
            await channel.send({
                content: message
            });
        }
    } catch (error) {
        console.error(
            "Error enviando mensaje de salida:",
            error.message
        );
    }
});

client.on("interactionCreate", async interaction => {
    if (!interaction.isButton()) {
        return;
    }

    const customId = interaction.customId;

    if (
        !customId.startsWith("ticket_")
    ) {
        return;
    }

    const [, action, ticketId] =
        customId.split("_");

    const ticket =
        supportTickets.get(ticketId);

    if (!ticket) {
        return interaction.reply({
            content: "❌ Este ticket ya no existe.",
            ephemeral: true
        });
    }

    if (
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        )
    ) {
        return interaction.reply({
            content:
                "❌ No tienes permisos para gestionar tickets.",
            ephemeral: true
        });
    }

    if (action === "resolve") {
        ticket.status = "Resuelto";
        ticket.response =
            "Tu solicitud fue revisada y resuelta por el equipo de soporte.";

        stats.ticketsResolved++;

        await sendSupportEmail(
            ticket.email,
            ticket
        );

        await interaction.reply({
            content:
                `✅ Ticket ${ticket.id} marcado como resuelto y resultado enviado por correo.`,
            ephemeral: true
        });

        return;
    }

    if (action === "reject") {
        ticket.status = "Rechazado";
        ticket.response =
            "Tu solicitud fue revisada y rechazada por el equipo de soporte.";

        await sendSupportEmail(
            ticket.email,
            ticket
        );

        await interaction.reply({
            content:
                `❌ Ticket ${ticket.id} rechazado y resultado enviado por correo.`,
            ephemeral: true
        });

        return;
    }

    if (action === "contact") {
        await interaction.reply({
            content:
                `📩 Solicitud de contacto para el ticket ${ticket.id}.`,
            ephemeral: true
        });

        return;
    }
});

app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        bot: client.isReady(),
        guilds: client.guilds.cache.size,
        uptime: process.uptime()
    });
});

app.get("/api/stats", requireLogin, (req, res) => {
    res.json({
        success: true,
        stats
    });
});

app.get("/api/guilds", requireLogin, (req, res) => {
    res.json({
        success: true,
        guilds: getUserGuilds(req.session.user.id)
    });
});

app.get("/api/variables", requireLogin, (req, res) => {
    res.json({
        success: true,
        variables: getInviteVariables()
    });
});

/*
 * IMPORTANTE:
 * Express 5 NO acepta app.get("*").
 * Esta ruta utiliza el formato compatible con Express 5.
 */

app.get("/{*splat}", (req, res) => {
    if (req.path.startsWith("/api/")) {
        return res.status(404).json({
            success: false,
            error: "Ruta API no encontrada"
        });
    }

    res.status(404).send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>404 — NR INVITE</title>
<style>
body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0b0b10;
    color: white;
    font-family: Arial, sans-serif;
    text-align: center;
}
.card {
    padding: 40px;
}
a {
    color: white;
    text-decoration: none;
    background: #5865f2;
    padding: 12px 18px;
    border-radius: 10px;
}
</style>
</head>
<body>
<div class="card">
    <h1>404</h1>
    <h2>Página no encontrada</h2>
    <p>NR INVITE no encontró esta página.</p>
    <a href="/">Volver al inicio</a>
</div>
</body>
</html>
    `);
});

app.use((err, req, res, next) => {
    console.error("❌ Error del servidor:", err);

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).send(`
        <h1>NR INVITE</h1>
        <p>Ocurrió un error interno.</p>
    `);
});

async function start() {
    try {
        if (TOKEN) {
            await client.login(TOKEN);
        } else {
            console.error(
                "❌ TOKEN no configurado. El Dashboard puede iniciar, pero el bot no."
            );
        }

        app.listen(PORT, "0.0.0.0", () => {
            console.log(
                `🌐 NR INVITE Dashboard iniciado en el puerto ${PORT}`
            );

            console.log(
                `🔗 Dashboard: ${DASHBOARD_URL}`
            );
        });

    } catch (error) {
        console.error(
            "❌ Error iniciando NR INVITE:",
            error
        );

        process.exit(1);
    }
}

start();
