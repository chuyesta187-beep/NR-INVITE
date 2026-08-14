/* =========================================================
   NR INVITE — DASHBOARD SCRIPT
   ========================================================= */

"use strict";


/* =========================================================
   ESTADO
   ========================================================= */

const state = {
    user: null,
    servers: [],
    currentGuild: null,
    language: localStorage.getItem("nr_language") || "es"
};


/* =========================================================
   INICIO
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {

    setupDashboard();

    await loadSession();

    await loadAnnouncements();

    await loadServers();

    await loadStatistics();

});


/* =========================================================
   CONFIGURACIÓN INICIAL
   ========================================================= */

function setupDashboard() {

    const savedLanguage =
        localStorage.getItem("nr_language");

    if (!savedLanguage) {
        localStorage.setItem(
            "nr_language",
            "es"
        );
    }

}


/* =========================================================
   LOGIN DISCORD
   ========================================================= */

function loginDiscord() {

    window.location.href =
        "/auth/discord";

}


/* =========================================================
   SOPORTE
   ========================================================= */

function openSupport() {

    window.open(
        "https://discord.gg/PZw45tHPfc",
        "_blank"
    );

}


/* =========================================================
   SESIÓN
   ========================================================= */

async function loadSession() {

    try {

        const response =
            await fetch("/api/user");

        if (!response.ok) {

            showWelcome();

            return;

        }

        const data =
            await response.json();

        if (!data || !data.user) {

            showWelcome();

            return;

        }

        state.user =
            data.user;

        showDashboard();

        updateUserInterface();

    } catch (error) {

        console.error(
            "Error cargando sesión:",
            error
        );

        showWelcome();

    }

}


/* =========================================================
   MOSTRAR DASHBOARD
   ========================================================= */

function showDashboard() {

    const welcome =
        document.getElementById(
            "welcomeScreen"
        );

    const dashboard =
        document.getElementById(
            "dashboard"
        );

    if (welcome) {

        welcome.classList.add(
            "hidden"
        );

    }

    if (dashboard) {

        dashboard.classList.remove(
            "hidden"
        );

    }

}


/* =========================================================
   MOSTRAR BIENVENIDA
   ========================================================= */

function showWelcome() {

    const welcome =
        document.getElementById(
            "welcomeScreen"
        );

    const dashboard =
        document.getElementById(
            "dashboard"
        );

    if (welcome) {

        welcome.classList.remove(
            "hidden"
        );

    }

    if (dashboard) {

        dashboard.classList.add(
            "hidden"
        );

    }

}


/* =========================================================
   INTERFAZ DEL USUARIO
   ========================================================= */

function updateUserInterface() {

    if (!state.user) {
        return;
    }

    const name =
        document.getElementById(
            "userName"
        );

    const avatar =
        document.getElementById(
            "userAvatar"
        );

    if (name) {

        name.textContent =
            state.user.global_name ||
            state.user.username ||
            "Usuario";

    }

    if (
        avatar &&
        state.user.avatar
    ) {

        avatar.innerHTML =
            `<img src="${escapeAttribute(
                state.user.avatar
            )}" alt="Avatar">`;

    }

}


/* =========================================================
   MENÚ LATERAL
   ========================================================= */

function toggleSidebar() {

    const sidebar =
        document.getElementById(
            "sidebar"
        );

    if (!sidebar) {
        return;
    }

    sidebar.classList.toggle(
        "open"
    );

}


/* =========================================================
   PÁGINAS
   ========================================================= */

function showPage(page) {

    const pages =
        document.querySelectorAll(
            ".page"
        );

    pages.forEach(
        currentPage => {

            currentPage.classList.add(
                "hidden"
            );

        }
    );


    const selected =
        document.getElementById(
            `page-${page}`
        );

    if (selected) {

        selected.classList.remove(
            "hidden"
        );

    }


    const buttons =
        document.querySelectorAll(
            ".nav-item"
        );

    buttons.forEach(
        button => {

            button.classList.remove(
                "active"
            );

        }
    );


    const activeButton =
        document.querySelector(
            `.nav-item[onclick="showPage('${page}')"]`
        );

    if (activeButton) {

        activeButton.classList.add(
            "active"
        );

    }


    const sidebar =
        document.getElementById(
            "sidebar"
        );

    if (
        sidebar &&
        window.innerWidth <= 760
    ) {

        sidebar.classList.remove(
            "open"
        );

    }


    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });


    if (page === "servers") {

        loadServers();

    }

    if (page === "logs") {

        loadLogs();

    }

}


/* =========================================================
   MENÚ USUARIO
   ========================================================= */

function toggleUserMenu() {

    const menu =
        document.getElementById(
            "userMenu"
        );

    if (!menu) {
        return;
    }

    menu.classList.toggle(
        "hidden"
    );

}


document.addEventListener(
    "click",
    event => {

        const menu =
            document.getElementById(
                "userMenu"
            );

        const button =
            document.querySelector(
                ".user-button"
            );

        if (
            menu &&
            button &&
            !menu.contains(event.target) &&
            !button.contains(event.target)
        ) {

            menu.classList.add(
                "hidden"
            );

        }

    }
);


/* =========================================================
   NOTIFICACIONES
   ========================================================= */

function openNotifications() {

    showToast(
        "🔔 No tienes nuevas notificaciones."
    );

}


/* =========================================================
   PERFIL
   ========================================================= */

function openProfile() {

    showToast(
        "👤 Perfil próximamente disponible."
    );

}


/* =========================================================
   IDIOMA
   ========================================================= */

function openLanguage() {

    const modal =
        document.getElementById(
            "languageModal"
        );

    if (!modal) {
        return;
    }

    modal.classList.remove(
        "hidden"
    );

}


function closeLanguage() {

    const modal =
        document.getElementById(
            "languageModal"
        );

    if (!modal) {
        return;
    }

    modal.classList.add(
        "hidden"
    );

}


function setLanguage(language) {

    const supported = [
        "es",
        "en",
        "pt",
        "fr",
        "de",
        "it",
        "ja",
        "ko",
        "zh",
        "ru"
    ];

    if (
        !supported.includes(language)
    ) {

        return;

    }

    state.language =
        language;

    localStorage.setItem(
        "nr_language",
        language
    );

    closeLanguage();

    showToast(
        `🌐 Idioma seleccionado: ${language.toUpperCase()}`
    );

}


/* =========================================================
   SERVIDORES
   ========================================================= */

async function loadServers() {

    const container =
        document.getElementById(
            "serverGrid"
        );

    if (!container) {
        return;
    }

    container.innerHTML =
        `<div class="loading">
            🏰 Cargando servidores...
        </div>`;


    try {

        const response =
            await fetch(
                "/api/user/guilds"
            );


        if (!response.ok) {

            throw new Error(
                "No se pudieron obtener los servidores."
            );

        }


        const data =
            await response.json();


        state.servers =
            Array.isArray(data.guilds)
                ? data.guilds
                : [];


        renderServers();

    } catch (error) {

        console.error(
            "Error cargando servidores:",
            error
        );


        container.innerHTML =
            `<div class="empty-state">
                🏰
                <h3>No se pudieron cargar los servidores</h3>
                <p>Intenta nuevamente.</p>
            </div>`;

    }

}


/* =========================================================
   RENDER SERVIDORES
   ========================================================= */

function renderServers() {

    const container =
        document.getElementById(
            "serverGrid"
        );

    if (!container) {
        return;
    }


    if (!state.servers.length) {

        container.innerHTML =
            `<div class="empty-state">
                🏰
                <h3>No hay servidores disponibles</h3>
                <p>
                    Asegúrate de haber iniciado sesión
                    con Discord.
                </p>
            </div>`;

        return;

    }


    container.innerHTML =
        state.servers
            .map(
                server => {

                    const icon =
                        getServerIcon(server);

                    const banner =
                        getServerBanner(server);

                    const installed =
                        Boolean(
                            server.bot ||
                            server.botInstalled ||
                            server.hasBot
                        );


                    return `
                        <article
                            class="server-card"
                        >

                            <div
                                class="server-banner"
                                style="
                                    background-image:
                                    url('${escapeAttribute(
                                        banner
                                    )}');
                                "
                            ></div>

                            <div
                                class="server-body"
                            >

                                <div
                                    class="server-icon"
                                >
                                    <img
                                        src="${escapeAttribute(
                                            icon
                                        )}"
                                        alt=""
                                    >
                                </div>

                                <div
                                    class="server-name"
                                    title="${escapeAttribute(
                                        server.name || "Servidor"
                                    )}"
                                >
                                    ${escapeHTML(
                                        server.name ||
                                        "Servidor"
                                    )}
                                </div>

                                <div
                                    class="server-id"
                                >
                                    ID:
                                    ${escapeHTML(
                                        server.id || "—"
                                    )}
                                </div>

                                <div
                                    class="server-status"
                                >

                                    <span
                                        class="status-dot"
                                    ></span>

                                    ${
                                        installed
                                            ? "NR INVITE está instalado"
                                            : "NR INVITE no está instalado"
                                    }

                                </div>

                                ${
                                    installed

                                    ? `
                                        <button
                                            class="server-action"
                                            onclick="openGuildPanel('${escapeAttribute(
                                                server.id
                                            )}')"
                                        >
                                            🚀 PANEL
                                        </button>
                                    `

                                    : `
                                        <button
                                            class="server-action"
                                            onclick="inviteBot('${escapeAttribute(
                                                server.id
                                            )}')"
                                        >
                                            ➕ INVITAR
                                        </button>
                                    `
                                }

                            </div>

                        </article>
                    `;

                }
            )
            .join("");

}


/* =========================================================
   ICONOS Y BANNERS
   ========================================================= */

function getServerIcon(server) {

    if (server.iconURL) {
        return server.iconURL;
    }

    if (
        server.icon &&
        server.id
    ) {

        return `https://cdn.discordapp.com/icons/${encodeURIComponent(
            server.id
        )}/${encodeURIComponent(
            server.icon
        )}.png?size=256`;

    }

    return createPlaceholder(
        server.name || "NR"
    );

}


function getServerBanner(server) {

    if (server.bannerURL) {
        return server.bannerURL;
    }

    if (
        server.banner &&
        server.id
    ) {

        return `https://cdn.discordapp.com/banners/${encodeURIComponent(
            server.id
        )}/${encodeURIComponent(
            server.banner
        )}.png?size=1024`;

    }

    return "";
}


function createPlaceholder(text) {

    const letter =
        String(text)
            .trim()
            .charAt(0)
            .toUpperCase() ||
        "N";

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
            <rect width="100%" height="100%" fill="#171722"/>
            <text x="50%" y="55%"
                dominant-baseline="middle"
                text-anchor="middle"
                fill="white"
                font-size="100"
                font-family="Arial"
                font-weight="bold">${letter}</text>
        </svg>`
    )}`;

}


/* =========================================================
   PANEL DEL SERVIDOR
   ========================================================= */

function openGuildPanel(guildId) {

    state.currentGuild =
        guildId;

    window.location.href =
        `/dashboard/guild/${encodeURIComponent(
            guildId
        )}`;

}


/* =========================================================
   INVITAR BOT
   ========================================================= */

function inviteBot(guildId) {

    const clientId =
        window.NR_CLIENT_ID ||
        "";

    if (!clientId) {

        showToast(
            "⚠️ Configuración OAuth2 pendiente."
        );

        return;

    }


    const permissions =
        "8";

    const url =
        `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(
            clientId
        )}&scope=bot%20applications.commands&permissions=${permissions}&guild_id=${encodeURIComponent(
            guildId
        )}`;


    window.open(
        url,
        "_blank"
    );

}


/* =========================================================
   ESTADÍSTICAS
   ========================================================= */

async function loadStatistics() {

    try {

        const response =
            await fetch(
                "/api/dashboard/stats"
            );


        if (!response.ok) {
            return;
        }


        const data =
            await response.json();


        setText(
            "serverCount",
            data.servers ?? 0
        );

        setText(
            "inviteCount",
            data.invites ?? 0
        );

        setText(
            "userCount",
            data.users ?? 0
        );

        setText(
            "ticketCount",
            data.tickets ?? 0
        );

    } catch (error) {

        console.error(
            "Error cargando estadísticas:",
            error
        );

    }

}


/* =========================================================
   ANUNCIOS
   ========================================================= */

async function loadAnnouncements() {

    const container =
        document.getElementById(
            "announcementContainer"
        );

    if (!container) {
        return;
    }


    try {

        const response =
            await fetch(
                "/api/announcements"
            );


        if (!response.ok) {
            return;
        }


        const data =
            await response.json();


        const announcements =
            Array.isArray(data.announcements)
                ? data.announcements
                : [];


        const visible =
            announcements.filter(
                announcement =>
                    announcement.enabled !== false &&
                    !isAnnouncementClosed(
                        announcement.id
                    )
            );


        container.innerHTML =
            visible
                .map(
                    announcement =>
                        `
                        <div
                            class="announcement"
                            data-announcement-id="${escapeAttribute(
                                announcement.id
                            )}"
                        >

                            <button
                                class="announcement-close"
                                onclick="closeAnnouncement('${escapeAttribute(
                                    announcement.id
                                )}')"
                                aria-label="Cerrar anuncio"
                            >
                                ×
                            </button>

                            <h3>
                                ${escapeHTML(
                                    announcement.title ||
                                    "📢 Anuncio"
                                )}
                            </h3>

                            <p>
                                ${escapeHTML(
                                    announcement.message ||
                                    ""
                                )}
                            </p>

                        </div>
                        `
                )
                .join("");

    } catch (error) {

        console.error(
            "Error cargando anuncios:",
            error
        );

    }

}


function closeAnnouncement(id) {

    if (!id) {
        return;
    }

    const closed =
        JSON.parse(
            localStorage.getItem(
                "nr_closed_announcements"
            ) || "[]"
        );


    if (!closed.includes(id)) {

        closed.push(id);

    }


    localStorage.setItem(
        "nr_closed_announcements",
        JSON.stringify(closed)
    );


    const element =
        document.querySelector(
            `[data-announcement-id="${CSS.escape(
                id
            )}"]`
        );


    if (element) {

        element.remove();

    }

}


function isAnnouncementClosed(id) {

    const closed =
        JSON.parse(
            localStorage.getItem(
                "nr_closed_announcements"
            ) || "[]"
        );

    return closed.includes(id);

}


/* =========================================================
   SOPORTE WEB
   ========================================================= */

async function submitSupport(event) {

    event.preventDefault();


    const type =
        document.getElementById(
            "supportType"
        )?.value.trim();

    const email =
        document.getElementById(
            "supportEmail"
        )?.value.trim();

    const subject =
        document.getElementById(
            "supportSubject"
        )?.value.trim();

    const description =
        document.getElementById(
            "supportDescription"
        )?.value.trim();


    if (
        !type ||
        !email ||
        !subject ||
        !description
    ) {

        showToast(
            "⚠️ Completa todos los campos obligatorios."
        );

        return;

    }


    const button =
        document.querySelector(
            "#supportForm button[type='submit']"
        );


    if (button) {

        button.disabled = true;

        button.textContent =
            "⏳ Enviando...";

    }


    try {

        const response =
            await fetch(
                "/api/support/ticket",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        type,
                        email,
                        subject,
                        description
                    })
                }
            );


        const data =
            await response.json()
                .catch(
                    () => ({})
                );


        if (!response.ok) {

            throw new Error(
                data.message ||
                "No se pudo crear el ticket."
            );

        }


        document
            .getElementById(
                "supportForm"
            )
            ?.reset();


        showToast(
            `✅ Solicitud enviada. Ticket: ${
                data.ticketId ||
                "creado correctamente"
            }`
        );


    } catch (error) {

        console.error(
            "Error creando ticket:",
            error
        );

        showToast(
            `❌ ${error.message}`
        );

    } finally {

        if (button) {

            button.disabled = false;

            button.textContent =
                "🚀 Enviar solicitud";

        }

    }

}


/* =========================================================
   LOGS
   ========================================================= */

async function loadLogs() {

    const container =
        document.getElementById(
            "logsContainer"
        );

    if (!container) {
        return;
    }


    container.innerHTML =
        `<div class="loading">
            📜 Cargando logs...
        </div>`;


    try {

        const response =
            await fetch(
                "/api/logs"
            );


        if (!response.ok) {

            throw new Error(
                "No se pudieron cargar los logs."
            );

        }


        const data =
            await response.json();


        const logs =
            Array.isArray(data.logs)
                ? data.logs
                : [];


        if (!logs.length) {

            container.innerHTML =
                `<div class="empty-state">

                    📜

                    <h3>
                        Sin registros
                    </h3>

                    <p>
                        Los registros aparecerán aquí.
                    </p>

                </div>`;

            return;

        }


        container.innerHTML =
            logs
                .slice(0, 100)
                .map(
                    log =>
                        `
                        <div class="log-item">

                            <div class="log-main">

                                <strong>
                                    ${escapeHTML(
                                        log.action ||
                                        log.type ||
                                        "Evento"
                                    )}
                                </strong>

                                <span>
                                    ${escapeHTML(
                                        log.userId
                                            ? `Usuario: ${log.userId}`
                                            : "Sistema"
                                    )}
                                </span>

                            </div>

                            <div class="log-date">
                                ${formatDate(
                                    log.createdAt
                                )}
                            </div>

                        </div>
                        `
                )
                .join("");

    } catch (error) {

        console.error(
            "Error cargando logs:",
            error
        );


        container.innerHTML =
            `<div class="empty-state">

                ❌

                <h3>
                    Error al cargar los logs
                </h3>

                <p>
                    Intenta nuevamente.
                </p>

            </div>`;

    }

}


/* =========================================================
   CERRAR SESIÓN
   ========================================================= */

function logout() {

    window.location.href =
        "/auth/logout";

}


/* =========================================================
   TOAST
   ========================================================= */

function showToast(message) {

    let toast =
        document.getElementById(
            "nrToast"
        );


    if (!toast) {

        toast =
            document.createElement(
                "div"
            );

        toast.id =
            "nrToast";


        Object.assign(
            toast.style,
            {
                position: "fixed",
                left: "50%",
                bottom: "25px",
                transform: "translateX(-50%)",
                padding: "13px 18px",
                background: "#171720",
                color: "#fff",
                border: "1px solid rgba(255,255,255,.1)",
                borderRadius: "12px",
                zIndex: "9999",
                boxShadow: "0 15px 50px rgba(0,0,0,.4)",
                fontSize: "13px"
            }
        );


        document.body.appendChild(
            toast
        );

    }


    toast.textContent =
        message;


    clearTimeout(
        window.__nrToastTimeout
    );


    window.__nrToastTimeout =
        setTimeout(
            () => {

                toast.remove();

            },
            3500
        );

}


/* =========================================================
   UTILIDADES
   ========================================================= */

function setText(id, value) {

    const element =
        document.getElementById(id);

    if (element) {

        element.textContent =
            String(value);

    }

}


function formatDate(date) {

    if (!date) {
        return "—";
    }


    const parsed =
        new Date(date);


    if (
        Number.isNaN(
            parsed.getTime()
        )
    ) {

        return "—";

    }


    return parsed.toLocaleString(
        "es-CO",
        {
            dateStyle: "short",
            timeStyle: "short"
        }
    );

}


function escapeHTML(value) {

    return String(
        value ?? ""
    )
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );

}


function escapeAttribute(value) {

    return escapeHTML(
        value
    );

}


/* =========================================================
   CERRAR MODAL HACIENDO CLICK FUERA
   ========================================================= */

document.addEventListener(
    "click",
    event => {

        const modal =
            document.getElementById(
                "languageModal"
            );

        if (
            modal &&
            event.target === modal
        ) {

            closeLanguage();

        }

    }
);


/* =========================================================
   EXPORTACIÓN GLOBAL
   ========================================================= */

window.loginDiscord =
    loginDiscord;

window.openSupport =
    openSupport;

window.toggleSidebar =
    toggleSidebar;

window.showPage =
    showPage;

window.toggleUserMenu =
    toggleUserMenu;

window.openNotifications =
    openNotifications;

window.openProfile =
    openProfile;

window.openLanguage =
    openLanguage;

window.closeLanguage =
    closeLanguage;

window.setLanguage =
    setLanguage;

window.openGuildPanel =
    openGuildPanel;

window.inviteBot =
    inviteBot;

window.closeAnnouncement =
    closeAnnouncement;

window.submitSupport =
    submitSupport;

window.logout =
    logout;
