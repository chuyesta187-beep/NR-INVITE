const express = require("express");
const crypto = require("crypto");
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ActivityType
} = require("discord.js");

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 10000;

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const REDIRECT_URI =
  process.env.DISCORD_REDIRECT_URI ||
  "https://nr-invite-1.onrender.com/callback";

const SUPPORT_URL =
  process.env.SUPPORT_URL || "https://discord.gg/PZw45tHPfc";

const SPECIAL_SERVER_ID = "1520985648457056266";

if (!CLIENT_ID || !CLIENT_SECRET || !BOT_TOKEN) {
  console.error("❌ Faltan variables de entorno:");
  console.error("DISCORD_CLIENT_ID");
  console.error("DISCORD_CLIENT_SECRET");
  console.error("DISCORD_TOKEN");
  process.exit(1);
}

/* =========================================================
   BOT
========================================================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites
  ],
  partials: [Partials.GuildMember]
});

/* =========================================================
   DATOS EN MEMORIA - SIN DB
========================================================= */

const guildConfigs = new Map();
const inviteCache = new Map();
const oauthStates = new Map();
const dashboardSessions = new Map();
const announcements = new Map();

function defaultConfig() {
  return {
    invite: {
      enabled: false,
      type: "embed",
      message:
        "¡Bienvenido/a {user} a **{server}**! 🎉\nAhora somos **{members}** miembros.",
      ping: false,
      roleId: null,
      giveRoleOnce: true,
      channelId: null
    },

    leave: {
      enabled: false,
      type: "embed",
      message:
        "👋 **{user}** ha salido de **{server}**.",
      ping: false,
      channelId: null,
      removeInvite: true
    },

    general: {
      logsChannelId: null,
      staffRoleId: null,
      prefix: "!",
      language: "es"
    },

    stats: {
      joins: 0,
      leaves: 0,
      invites: 0
    }
  };
}

function getConfig(guildId) {
  if (!guildConfigs.has(guildId)) {
    guildConfigs.set(guildId, defaultConfig());
  }

  return guildConfigs.get(guildId);
}

function ensureConfig(guildId) {
  return getConfig(guildId);
}

/* =========================================================
   OAUTH
========================================================= */

function createOAuthState() {
  const state = crypto.randomBytes(32).toString("hex");

  oauthStates.set(state, {
    createdAt: Date.now()
  });

  return state;
}

function validateOAuthState(state) {
  if (!state) return false;

  const data = oauthStates.get(state);

  if (!data) return false;

  oauthStates.delete(state);

  if (Date.now() - data.createdAt > 10 * 60 * 1000) {
    return false;
  }

  return true;
}

function createDashboardSession(user) {
  const token = crypto.randomBytes(48).toString("hex");

  dashboardSessions.set(token, {
    user,
    createdAt: Date.now()
  });

  return token;
}

function getSession(req) {
  const header = req.headers.authorization || "";

  if (header.startsWith("Bearer ")) {
    const token = header.slice(7);
    return dashboardSessions.get(token) || null;
  }

  const cookie = req.headers.cookie || "";

  const match = cookie.match(/nr_session=([^;]+)/);

  if (!match) return null;

  return dashboardSessions.get(match[1]) || null;
}

function requireAuth(req, res, next) {
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({
      ok: false,
      error: "No has iniciado sesión."
    });
  }

  req.user = session.user;
  next();
}

/* =========================================================
   LOGIN
========================================================= */

app.get("/login", (req, res) => {
  const state = createOAuthState();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "identify guilds",
    state
  });

  res.redirect(
    `https://discord.com/oauth2/authorize?${params.toString()}`
  );
});

/* =========================================================
   CALLBACK
========================================================= */

app.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send(`
        <html>
          <body style="background:#111;color:white;font-family:Arial;text-align:center;padding:50px">
            <h1>❌ OAuth incompleto</h1>
            <p>Discord no devolvió correctamente el código de autenticación.</p>
            <a href="/" style="color:#5865f2">Volver</a>
          </body>
        </html>
      `);
    }

    if (!validateOAuthState(state)) {
      return res.status(400).send(`
        <html>
          <body style="background:#111;color:white;font-family:Arial;text-align:center;padding:50px">
            <h1>❌ Estado de OAuth inválido</h1>
            <p>El proceso de autenticación expiró o ya fue utilizado.</p>
            <a href="/login" style="color:#5865f2">Intentar nuevamente</a>
          </body>
        </html>
      `);
    }

    const tokenResponse = await fetch(
      "https://discord.com/api/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("OAuth token error:", tokenData);

      return res.status(400).send(`
        <html>
          <body style="background:#111;color:white;font-family:Arial;text-align:center;padding:50px">
            <h1>❌ Error de Discord OAuth</h1>
            <p>No se pudo obtener el token.</p>
            <a href="/login" style="color:#5865f2">Intentar nuevamente</a>
          </body>
        </html>
      `);
    }

    const userResponse = await fetch(
      "https://discord.com/api/users/@me",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`
        }
      }
    );

    const user = await userResponse.json();

    if (!userResponse.ok || !user.id) {
      return res.status(400).send("No se pudo obtener el usuario de Discord.");
    }

    const guildResponse = await fetch(
      "https://discord.com/api/users/@me/guilds",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`
        }
      }
    );

    const guilds = await guildResponse.json();

    const sessionToken = createDashboardSession({
      ...user,
      guilds: Array.isArray(guilds) ? guilds : []
    });

    res.setHeader(
      "Set-Cookie",
      `nr_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
    );

    res.redirect("/");
  } catch (error) {
    console.error("OAuth callback error:", error);

    res.status(500).send(`
      <html>
        <body style="background:#111;color:white;font-family:Arial;text-align:center;padding:50px">
          <h1>❌ Error interno</h1>
          <p>Ocurrió un error procesando el inicio de sesión.</p>
          <a href="/login" style="color:#5865f2">Intentar nuevamente</a>
        </body>
      </html>
    `);
  }
});

/* =========================================================
   LOGOUT
========================================================= */

app.get("/logout", (req, res) => {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/nr_session=([^;]+)/);

  if (match) {
    dashboardSessions.delete(match[1]);
  }

  res.setHeader(
    "Set-Cookie",
    "nr_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
  );

  res.redirect("/");
});

/* =========================================================
   INVITACIÓN DEL BOT
========================================================= */

app.get("/invite", (req, res) => {
  const permissions = new PermissionsBitField([
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.ManageChannels
  ]).bitfield.toString();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    permissions,
    scope: "bot applications.commands"
  });

  res.redirect(
    `https://discord.com/oauth2/authorize?${params.toString()}`
  );
});

/* =========================================================
   API USUARIO
========================================================= */

app.get("/api/me", requireAuth, async (req, res) => {
  const session = getSession(req);

  res.json({
    ok: true,
    user: session.user,
    guilds: session.user.guilds || []
  });
});

/* =========================================================
   SERVIDORES DONDE ESTÁ EL BOT
========================================================= */

app.get("/api/user/guilds", requireAuth, async (req, res) => {
  try {
    const userGuilds = req.user.guilds || [];

    const result = [];

    for (const guild of userGuilds) {
      const botGuild = client.guilds.cache.get(guild.id);

      if (!botGuild) continue;

      const permissions = BigInt(guild.permissions || 0);

      const isOwner =
        guild.owner === true ||
        guild.id === SPECIAL_SERVER_ID;

      const administrator =
        (permissions & BigInt(8)) === BigInt(8);

      if (isOwner || administrator) {
        result.push({
          id: guild.id,
          name: botGuild.name,
          icon: botGuild.iconURL({
            extension: "png",
            size: 128
          }),
          owner: isOwner,
          administrator
        });
      }
    }

    res.json({
      ok: true,
      guilds: result
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: "No se pudieron cargar los servidores."
    });
  }
});

/* =========================================================
   DATOS DEL SERVIDOR
========================================================= */

app.get(
  "/api/guilds/:guildId/data",
  requireAuth,
  async (req, res) => {
    try {
      const { guildId } = req.params;

      const discordGuild = client.guilds.cache.get(guildId);

      if (!discordGuild) {
        return res.status(404).json({
          ok: false,
          error: "El bot no está en este servidor."
        });
      }

      const userGuild = (req.user.guilds || []).find(
        g => g.id === guildId
      );

      if (!userGuild) {
        return res.status(403).json({
          ok: false,
          error: "No tienes acceso a este servidor."
        });
      }

      const config = ensureConfig(guildId);

      const channels = discordGuild.channels.cache
        .filter(channel =>
          channel.isTextBased() &&
          channel.viewable
        )
        .map(channel => ({
          id: channel.id,
          name: channel.name,
          type: channel.type
        }));

      const roles = discordGuild.roles.cache
        .filter(role => role.id !== discordGuild.id)
        .map(role => ({
          id: role.id,
          name: role.name,
          color: role.hexColor
        }));

      res.json({
        ok: true,

        guild: {
          id: discordGuild.id,
          name: discordGuild.name,
          icon: discordGuild.iconURL({
            extension: "png",
            size: 256
          }),
          memberCount: discordGuild.memberCount
        },

        special:
          guildId === SPECIAL_SERVER_ID,

        config,

        channels,

        roles
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        error: "Error cargando el servidor."
      });
    }
  }
);

/* =========================================================
   GUARDAR CONFIGURACIÓN
========================================================= */

app.post(
  "/api/guilds/:guildId/save",
  requireAuth,
  async (req, res) => {
    try {
      const { guildId } = req.params;

      const discordGuild = client.guilds.cache.get(guildId);

      if (!discordGuild) {
        return res.status(404).json({
          ok: false,
          error: "Servidor no encontrado."
        });
      }

      const userGuild = (req.user.guilds || []).find(
        g => g.id === guildId
      );

      if (!userGuild) {
        return res.status(403).json({
          ok: false,
          error: "No tienes permisos."
        });
      }

      const permissions = BigInt(userGuild.permissions || 0);

      const administrator =
        (permissions & BigInt(8)) === BigInt(8);

      const owner =
        userGuild.owner === true ||
        guildId === SPECIAL_SERVER_ID;

      if (!administrator && !owner) {
        return res.status(403).json({
          ok: false,
          error: "Necesitas permisos de administrador."
        });
      }

      const oldConfig = ensureConfig(guildId);

      const newData = req.body || {};

      guildConfigs.set(guildId, {
        ...oldConfig,
        ...newData,

        invite: {
          ...oldConfig.invite,
          ...(newData.invite || {})
        },

        leave: {
          ...oldConfig.leave,
          ...(newData.leave || {})
        },

        general: {
          ...oldConfig.general,
          ...(newData.general || {})
        }
      });

      res.json({
        ok: true,
        message: "Configuración guardada correctamente.",
        config: guildConfigs.get(guildId)
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        error: "No se pudo guardar la configuración."
      });
    }
  }
);

/* =========================================================
   CANALES
========================================================= */

app.get(
  "/api/guilds/:guildId/channels",
  requireAuth,
  async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);

    if (!guild) {
      return res.status(404).json({
        ok: false,
        error: "Servidor no encontrado."
      });
    }

    const channels = guild.channels.cache
      .filter(channel =>
        channel.isTextBased() &&
        channel.viewable
      )
      .map(channel => ({
        id: channel.id,
        name: channel.name,
        type: channel.type
      }));

    res.json({
      ok: true,
      channels
    });
  }
);

/* =========================================================
   ROLES
========================================================= */

app.get(
  "/api/guilds/:guildId/roles",
  requireAuth,
  async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);

    if (!guild) {
      return res.status(404).json({
        ok: false,
        error: "Servidor no encontrado."
      });
    }

    const roles = guild.roles.cache
      .filter(role => role.id !== guild.id)
      .map(role => ({
        id: role.id,
        name: role.name,
        color: role.hexColor,
        position: role.position,
        managed: role.managed
      }));

    res.json({
      ok: true,
      roles
    });
  }
);

/* =========================================================
   ESTADÍSTICAS
========================================================= */

app.get(
  "/api/guilds/:guildId/stats",
  requireAuth,
  async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);

    if (!guild) {
      return res.status(404).json({
        ok: false,
        error: "Servidor no encontrado."
      });
    }

    const config = ensureConfig(guild.id);

    res.json({
      ok: true,

      members: guild.memberCount,

      joins: config.stats.joins,

      leaves: config.stats.leaves,

      invites: config.stats.invites,

      channels: guild.channels.cache.size,

      roles: guild.roles.cache.size
    });
  }
);

/* =========================================================
   ANUNCIOS
========================================================= */

app.get("/api/announcements", requireAuth, (req, res) => {
  const list = Array.from(announcements.values())
    .filter(a => !a.expiresAt || a.expiresAt > Date.now())
    .sort((a, b) => b.createdAt - a.createdAt);

  res.json({
    ok: true,
    announcements: list
  });
});

app.post("/api/announcements/read", requireAuth, (req, res) => {
  const { id } = req.body;

  const announcement = announcements.get(id);

  if (announcement) {
    if (!announcement.readBy) {
      announcement.readBy = [];
    }

    if (!announcement.readBy.includes(req.user.id)) {
      announcement.readBy.push(req.user.id);
    }
  }

  res.json({
    ok: true
  });
});

/* =========================================================
   SOPORTE
========================================================= */

app.get("/api/support", requireAuth, (req, res) => {
  res.json({
    ok: true,
    url: SUPPORT_URL
  });
});

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    bot: client.user
      ? client.user.tag
      : null,

    guilds: client.guilds.cache.size,

    uptime: process.uptime(),

    timestamp: Date.now()
  });
});

/* =========================================================
   PÁGINA PRINCIPAL DEL DASHBOARD
========================================================= */

app.get("/", (req, res) => {
  const session = getSession(req);

  const user = session?.user || null;

  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">

<title>NR INVITE Dashboard</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #0b0d12;
  color: #ffffff;
  font-family: Arial, Helvetica, sans-serif;
}

header {
  height: 64px;
  border-bottom: 1px solid #20232c;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 22px;
  background: #0e1016;
}

.logo {
  font-weight: 800;
  font-size: 20px;
}

.verified {
  font-size: 12px;
  opacity: .7;
  display: flex;
  align-items: center;
  gap: 4px;
}

main {
  min-height: calc(100vh - 64px);
  display: flex;
}

aside {
  width: 250px;
  border-right: 1px solid #20232c;
  background: #0e1016;
  padding: 18px;
}

aside button {
  width: 100%;
  border: 0;
  background: transparent;
  color: #b8bcc8;
  padding: 12px;
  margin-bottom: 5px;
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
}

aside button:hover {
  background: #181b23;
  color: white;
}

.content {
  flex: 1;
  padding: 28px;
}

.card {
  background: #11141b;
  border: 1px solid #222630;
  border-radius: 14px;
  padding: 20px;
  margin-bottom: 18px;
}

.login {
  max-width: 500px;
  margin: 100px auto;
  text-align: center;
}

.primary {
  display: inline-block;
  background: #5865f2;
  color: white;
  text-decoration: none;
  border: 0;
  border-radius: 9px;
  padding: 13px 20px;
  cursor: pointer;
  font-weight: 700;
}

select,
textarea,
input {
  width: 100%;
  background: #0b0d12;
  border: 1px solid #292d38;
  color: white;
  padding: 11px;
  border-radius: 8px;
  margin-top: 7px;
  margin-bottom: 15px;
}

textarea {
  min-height: 120px;
  resize: vertical;
}

label {
  display: block;
  margin-top: 12px;
  color: #c9ccd5;
  font-size: 14px;
}

.save {
  background: #23a559;
  color: white;
  border: 0;
  border-radius: 8px;
  padding: 12px 18px;
  cursor: pointer;
}

.support {
  position: fixed;
  right: 20px;
  bottom: 20px;
  text-decoration: none;
  font-size: 24px;
}

</style>
</head>

<body>

<header>

<div class="logo">
NR INVITE
</div>

<div class="verified">
🐶 ─╮
</div>

</header>

${
  !user
    ? `
<main>
  <div class="content">

    <div class="card login">

      <h1>NR INVITE</h1>

      <p>
        Dashboard oficial de NR INVITE.
      </p>

      <a class="primary" href="/login">
        Iniciar sesión con Discord
      </a>

      <br><br>

      <a class="primary" href="/invite">
        Añadir NR INVITE
      </a>

    </div>

  </div>
</main>
`
    : `
<main>

<aside>

<button onclick="showPage('inicio')">
🏠 Inicio
</button>

<button onclick="showPage('servidores')">
🖥️ Servidores
</button>

<button onclick="showPage('config')">
⚙️ Configuración
</button>

<button onclick="showPage('anuncios')">
📢 Anuncios
</button>

<button onclick="showPage('soporte')">
🛠️ Soporte
</button>

<br>

<button onclick="location.href='/logout'">
🚪 Cerrar sesión
</button>

</aside>

<div class="content">

<div id="app"></div>

</div>

</main>

<a
class="support"
href="${SUPPORT_URL}"
target="_blank"
>
🛠️
</a>

<script>

let currentGuild = null;
let currentData = null;

async function api(url, options = {}) {

  const response = await fetch(url, options);

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Error");
  }

  return data;
}

async function showPage(page) {

  const app = document.getElementById("app");

  if (page === "inicio") {

    const data = await api("/api/user/guilds");

    app.innerHTML = \`
      <div class="card">
        <h1>Bienvenido a NR INVITE</h1>
        <p>
          Selecciona un servidor para comenzar.
        </p>
      </div>

      <div class="card">
        <h2>Servidores disponibles</h2>
        <div id="guildList"></div>
      </div>
    \`;

    const list = document.getElementById("guildList");

    if (!data.guilds.length) {

      list.innerHTML = \`
        <p>No tienes servidores administrables donde esté NR INVITE.</p>
        <a class="primary" href="/invite">
          Añadir NR INVITE
        </a>
      \`;

      return;
    }

    for (const guild of data.guilds) {

      const button = document.createElement("button");

      button.className = "primary";

      button.style.margin = "5px";

      button.textContent = guild.name;

      button.onclick = () => openGuild(guild.id);

      list.appendChild(button);
    }

    return;
  }

  if (page === "servidores") {

    const data = await api("/api/user/guilds");

    app.innerHTML = \`
      <div class="card">
        <h1>🖥️ Servidores</h1>
      </div>

      <div class="card" id="serverContainer"></div>
    \`;

    const container =
      document.getElementById("serverContainer");

    data.guilds.forEach(guild => {

      const div = document.createElement("div");

      div.className = "card";

      div.innerHTML = \`
        <h3>\${guild.name}</h3>
        <button class="primary">
          Administrar
        </button>
      \`;

      div.querySelector("button").onclick =
        () => openGuild(guild.id);

      container.appendChild(div);
    });

    return;
  }

  if (page === "config") {

    if (!currentGuild) {

      app.innerHTML = \`
        <div class="card">
          <h1>⚙️ Configuración</h1>
          <p>
            Primero selecciona un servidor.
          </p>
        </div>
      \`;

      return;
    }

    renderConfig();

    return;
  }

  if (page === "anuncios") {

    const data = await api("/api/announcements");

    app.innerHTML = \`
      <div class="card">
        <h1>📢 Anuncios</h1>
      </div>

      <div id="announcementList"></div>
    \`;

    const list =
      document.getElementById("announcementList");

    if (!data.announcements.length) {

      list.innerHTML = \`
        <div class="card">
          No hay anuncios actualmente.
        </div>
      \`;

      return;
    }

    for (const announcement of data.announcements) {

      const div = document.createElement("div");

      div.className = "card";

      div.innerHTML = \`
        <h2>\${announcement.title}</h2>
        <p>\${announcement.message}</p>
        <button class="save">
          Marcar como leído
        </button>
      \`;

      div.querySelector("button").onclick = async () => {

        await api("/api/announcements/read", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            id: announcement.id
          })
        });

        div.remove();
      };

      list.appendChild(div);
    }

    return;
  }

  if (page === "soporte") {

    app.innerHTML = \`
      <div class="card">
        <h1>🛠️ Soporte</h1>

        <p>
          ¿Necesitas ayuda con NR INVITE?
        </p>

        <a
          class="primary"
          href="${SUPPORT_URL}"
          target="_blank"
        >
          Abrir soporte
        </a>
      </div>
    \`;

    return;
  }
}

async function openGuild(id) {

  currentGuild = id;

  currentData =
    await api("/api/guilds/" + id + "/data");

  renderConfig();
}

function renderConfig() {

  const app = document.getElementById("app");

  const config = currentData.config;

  const channels =
    currentData.channels || [];

  const roles =
    currentData.roles || [];

  app.innerHTML = \`
    <div class="card">
      <h1>
        ☰ Menú principal
      </h1>

      <p>
        \${currentData.guild.name}
      </p>
    </div>

    <div class="card">

      <h2>📨 Setup Invite</h2>

      <label>Mensaje</label>

      <textarea id="inviteMessage">
\${escapeHtml(config.invite.message)}
      </textarea>

      <small>
        Variables:
        {user}
        {server}
        {members}
        {inviter}
        {invites}
      </small>

      <label>Tipo de mensaje</label>

      <select id="inviteType">

        <option
          value="embed"
          \${config.invite.type === "embed" ? "selected" : ""}
        >
          Embed
        </option>

        <option
          value="message"
          \${config.invite.type === "message" ? "selected" : ""}
        >
          Mensaje normal
        </option>

      </select>

      <label>
        ¿Mencionar usuario?
      </label>

      <select id="invitePing">

        <option value="false">
          No
        </option>

        <option
          value="true"
          \${config.invite.ping ? "selected" : ""}
        >
          Sí
        </option>

      </select>

      <label>Rol por invite</label>

      <select id="inviteRole">

        <option value="">
          Sin rol
        </option>

        \${roles.map(role => \`
          <option
            value="\${role.id}"
            \${config.invite.roleId === role.id ? "selected" : ""}
          >
            \${escapeHtml(role.name)}
          </option>
        \`).join("")}

      </select>

      <label>
        Dar el rol solamente una vez
      </label>

      <select id="giveRoleOnce">

        <option
          value="true"
          \${config.invite.giveRoleOnce ? "selected" : ""}
        >
          Sí
        </option>

        <option
          value="false"
          \${!config.invite.giveRoleOnce ? "selected" : ""}
        >
          No
        </option>

      </select>

      <label>Canal</label>

      <select id="inviteChannel">

        <option value="">
          Seleccionar canal
        </option>

        \${channels.map(channel => \`
          <option
            value="\${channel.id}"
            \${config.invite.channelId === channel.id ? "selected" : ""}
          >
            #\${escapeHtml(channel.name)}
          </option>
        \`).join("")}

      </select>

    </div>

    <div class="card">

      <h2>👋 Salida</h2>

      <label>Mensaje</label>

      <textarea id="leaveMessage">
\${escapeHtml(config.leave.message)}
      </textarea>

      <label>Tipo</label>

      <select id="leaveType">

        <option
          value="embed"
          \${config.leave.type === "embed" ? "selected" : ""}
        >
          Embed
        </option>

        <option
          value="message"
          \${config.leave.type === "message" ? "selected" : ""}
        >
          Mensaje normal
        </option>

      </select>

      <label>¿Mencionar usuario?</label>

      <select id="leavePing">

        <option value="false">
          No
        </option>

        <option
          value="true"
          \${config.leave.ping ? "selected" : ""}
        >
          Sí
        </option>

      </select>

      <label>Canal</label>

      <select id="leaveChannel">

        <option value="">
          Seleccionar canal
        </option>

        \${channels.map(channel => \`
          <option
            value="\${channel.id}"
            \${config.leave.channelId === channel.id ? "selected" : ""}
          >
            #\${escapeHtml(channel.name)}
          </option>
        \`).join("")}

      </select>

      <p>
        Al salir un usuario se descontará la invitación
        registrada por NR INVITE.
      </p>

    </div>

    <div class="card">

      <h2>⚙️ Configuración general</h2>

      <label>Canal de logs</label>

      <select id="logsChannel">

        <option value="">
          Sin configurar
        </option>

        \${channels.map(channel => \`
          <option
            value="\${channel.id}"
            \${config.general.logsChannelId === channel.id ? "selected" : ""}
          >
            #\${escapeHtml(channel.name)}
          </option>
        \`).join("")}

      </select>

      <label>Rol Staff</label>

      <select id="staffRole">

        <option value="">
          Sin configurar
        </option>

        \${roles.map(role => \`
          <option
            value="\${role.id}"
            \${config.general.staffRoleId === role.id ? "selected" : ""}
          >
            \${escapeHtml(role.name)}
          </option>
        \`).join("")}

      </select>

      <label>Prefijo</label>

      <input
        id="prefix"
        value="\${escapeHtml(config.general.prefix)}"
      />

    </div>

    <div class="card">

      <button
        class="save"
        onclick="saveConfig()"
      >
        💾 Guardar configuración
      </button>

    </div>
  \`;
}

async function saveConfig() {

  const payload = {

    invite: {

      message:
        document.getElementById("inviteMessage").value,

      type:
        document.getElementById("inviteType").value,

      ping:
        document.getElementById("invitePing").value === "true",

      roleId:
        document.getElementById("inviteRole").value || null,

      giveRoleOnce:
        document.getElementById("giveRoleOnce").value === "true",

      channelId:
        document.getElementById("inviteChannel").value || null
    },

    leave: {

      message:
        document.getElementById("leaveMessage").value,

      type:
        document.getElementById("leaveType").value,

      ping:
        document.getElementById("leavePing").value === "true",

      channelId:
        document.getElementById("leaveChannel").value || null,

      removeInvite: true
    },

    general: {

      logsChannelId:
        document.getElementById("logsChannel").value || null,

      staffRoleId:
        document.getElementById("staffRole").value || null,

      prefix:
        document.getElementById("prefix").value || "!"
    }

  };

  try {

    await api(
      "/api/guilds/" +
      currentGuild +
      "/save",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify(payload)
      }
    );

    alert("✅ Configuración guardada.");

    currentData =
      await api(
        "/api/guilds/" +
        currentGuild +
        "/data"
      );

    renderConfig();

  } catch (error) {

    alert("❌ " + error.message);

  }
}

function escapeHtml(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

showPage("inicio");

</script>
`
}

});

/* =========================================================
   ERROR
========================================================= */

app.use((err, req, res, next) => {
  console.error("Express error:", err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    ok: false,
    error: "Error interno del servidor."
  });
});

/* =========================================================
   EXPRESS
========================================================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `🌐 NR INVITE Dashboard iniciado en el puerto ${PORT}`
  );

  console.log(
    `🔗 Dashboard: https://nr-invite-1.onrender.com`
  );
});

/* =========================================================
   BOT READY
========================================================= */

client.once("ready", () => {

  console.log(
    `✅ NR INVITE conectado como ${client.user.tag}`
  );

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
    ensureConfig(guild.id);
  }
});

/* =========================================================
   INVITES
========================================================= */

async function cacheGuildInvites(guild) {

  try {

    const invites = await guild.invites.fetch();

    const data = new Map();

    for (const invite of invites.values()) {

      data.set(invite.code, {
        uses: invite.uses || 0,
        inviterId: invite.inviter?.id || null
      });

    }

    inviteCache.set(guild.id, data);

  } catch (error) {

    console.error(
      `No se pudieron cargar invites de ${guild.name}:`,
      error.message
    );

  }
}

client.on("ready", async () => {

  for (const guild of client.guilds.cache.values()) {
    await cacheGuildInvites(guild);
  }

});

client.on("guildCreate", async guild => {

  ensureConfig(guild.id);

  await cacheGuildInvites(guild);

});

client.on("inviteCreate", async invite => {

  await cacheGuildInvites(invite.guild);

});

/* =========================================================
   BUSCAR INVITE UTILIZADA
========================================================= */

async function findUsedInvite(guild) {

  try {

    const before =
      inviteCache.get(guild.id) || new Map();

    const current =
      await guild.invites.fetch();

    let used = null;

    for (const invite of current.values()) {

      const old = before.get(invite.code);

      const oldUses = old?.uses || 0;

      const newUses = invite.uses || 0;

      if (newUses > oldUses) {

        used = {
          code: invite.code,
          inviterId: invite.inviter?.id || old?.inviterId || null,
          uses: newUses
        };

        break;
      }

    }

    const map = new Map();

    for (const invite of current.values()) {

      map.set(invite.code, {
        uses: invite.uses || 0,
        inviterId: invite.inviter?.id || null
      });

    }

    inviteCache.set(guild.id, map);

    return used;

  } catch (error) {

    console.error(
      "Error buscando invite utilizada:",
      error.message
    );

    return null;
  }
}

/* =========================================================
   MENSAJES
========================================================= */

function replaceVariables(message, data) {

  return String(message || "")
    .replaceAll("{user}", data.user || "")
    .replaceAll("{server}", data.server || "")
    .replaceAll("{members}", String(data.members || 0))
    .replaceAll("{inviter}", data.inviter || "")
    .replaceAll("{invites}", String(data.invites || 0));
}

async function sendConfiguredMessage(
  channel,
  settings,
  data
) {

  if (!channel || !settings?.enabled) return;

  const content =
    replaceVariables(settings.message, data);

  const allowedMentions = settings.ping
    ? {
        parse: ["users"]
      }
    : {
        parse: []
      };

  if (settings.type === "message") {

    await channel.send({
      content,
      allowedMentions
    });

    return;
  }

  const embed = new EmbedBuilder()
    .setDescription(content)
    .setTimestamp();

  await channel.send({
    content: settings.ping
      ? `<@${data.userId}>`
      : undefined,

    embeds: [embed],

    allowedMentions
  });
}

/* =========================================================
   MIEMBRO ENTRA
========================================================= */

client.on("guildMemberAdd", async member => {

  try {

    const config =
      ensureConfig(member.guild.id);

    config.stats.joins++;

    const used =
      await findUsedInvite(member.guild);

    let inviter = null;

    if (used?.inviterId) {

      inviter =
        member.guild.members.cache.get(
          used.inviterId
        );

      config.stats.invites++;
    }

    if (
      config.invite.roleId &&
      member.guild.members.me
    ) {

      const role =
        member.guild.roles.cache.get(
          config.invite.roleId
        );

      if (
        role &&
        !role.managed &&
        role.position <
          member.guild.members.me.roles.highest.position
      ) {

        try {

          await member.roles.add(
            role,
            "NR INVITE - Rol por invitación"
          );

        } catch (error) {

          console.error(
            "No se pudo entregar el rol:",
            error.message
          );

        }

      }
    }

    if (config.invite.channelId) {

      const channel =
        member.guild.channels.cache.get(
          config.invite.channelId
        );

      if (channel) {

        await sendConfiguredMessage(
          channel,
          config.invite,
          {
            user:
              `<@${member.id}>`,

            userId:
              member.id,

            server:
              member.guild.name,

            members:
              member.guild.memberCount,

            inviter:
              inviter
                ? `<@${inviter.id}>`
                : "Desconocido",

            invites:
              used?.uses || 0
          }
        );

      }
    }

    if (config.general.logsChannelId) {

      const logs =
        member.guild.channels.cache.get(
          config.general.logsChannelId
        );

      if (logs) {

        const embed =
          new EmbedBuilder()
            .setTitle("📥 Nueva entrada")
            .setDescription(
              `**Usuario:** <@${member.id}>\n` +
              `**Invitador:** ${
                inviter
                  ? `<@${inviter.id}>`
                  : "Desconocido"
              }`
            )
            .setTimestamp();

        await logs.send({
          embeds: [embed]
        });

      }
    }

  } catch (error) {

    console.error(
      "guildMemberAdd:",
      error.message
    );

  }

});

/* =========================================================
   MIEMBRO SALE
========================================================= */

client.on("guildMemberRemove", async member => {

  try {

    const config =
      ensureConfig(member.guild.id);

    config.stats.leaves++;

    if (config.leave.channelId) {

      const channel =
        member.guild.channels.cache.get(
          config.leave.channelId
        );

      if (channel) {

        await sendConfiguredMessage(
          channel,
          config.leave,
          {
            user:
              `<@${member.id}>`,

            userId:
              member.id,

            server:
              member.guild.name,

            members:
              member.guild.memberCount,

            inviter:
              "Desconocido",

            invites:
              0
          }
        );

      }
    }

    if (config.general.logsChannelId) {

      const logs =
        member.guild.channels.cache.get(
          config.general.logsChannelId
        );

      if (logs) {

        const embed =
          new EmbedBuilder()
            .setTitle("📤 Salida")
            .setDescription(
              `**Usuario:** <@${member.id}>`
            )
            .setTimestamp();

        await logs.send({
          embeds: [embed]
        });

      }
    }

  } catch (error) {

    console.error(
      "guildMemberRemove:",
      error.message
    );

  }

});

/* =========================================================
   LOGIN BOT
========================================================= */

client.login(BOT_TOKEN);
