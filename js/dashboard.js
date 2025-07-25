// arquivo: site_de_jogos/js/dashboard.js

// Importa as funções utilitárias
import { showNotification, getConsoleIconPath, API_BASE_URL, FRONTEND_BASE_URL } from './utils.js';
// Importa as funções de desafios
import { fetchAndDisplayChallenges, fetchAndDisplayMyChallenges, renderMyChallenges, setupChallengeListeners } from './challenges.js';
// Importa as funções de amigos e chat
import { initFriendsAndChat, fetchAndDisplayFriends, fetchAndDisplayFriendRequests, fetchAndDisplaySentFriendRequests, fetchAndDisplayBlockedUsers, refreshFriendsAndRequests } from './friends_and_chat.js';
// Importa as funções de matchmaking
import { setupMatchmaking } from './matchmaking.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- DADOS GLOBAIS E VERIFICAÇÃO DE AUTENTICAÇÃO ---
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    const userId = localStorage.getItem('userId');
    const userRole = localStorage.getItem('userRole');
    const profileCompleted = localStorage.getItem('profileCompleted');

    // Redirecionamentos iniciais de segurança
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    if (userRole === 'admin') {
        window.location.href = 'admin.html';
        return;
    }
    if (profileCompleted === 'false') {
        window.location.href = 'profile.html';
        return;
    }

    // --- SELETORES DE ELEMENTOS DO DASHBOARD ---
    // Seletores para DESKTOP
    const usernameDesktop = document.getElementById('username-desktop');
    const userConsoleIconDesktop = document.getElementById('current-user-console-icon');
    const currentUserAvatarDesktop = document.getElementById('current-user-avatar-desktop');
    const userWinsDesktop = document.getElementById('user-wins-desktop');
    const userLossesDesktop = document.getElementById('user-losses-desktop');
    const coinBalanceDesktop = document.getElementById('coin-balance-desktop');
    const userProfileMenuDesktop = document.getElementById('user-profile-menu-desktop');
    const dropdownTemplate = document.getElementById('user-profile-dropdown-template');

    // Seletores para MOBILE (dentro do menu hambúrguer)
    const usernameMobile = document.getElementById('username-mobile'); // Adicione este ID ao seu HTML no menu mobile
    const currentUserAvatarMobile = document.getElementById('current-user-avatar-mobile'); // Adicione este ID ao seu HTML no menu mobile
    const coinBalanceMobile = document.getElementById('coin-balance-mobile'); // Adicione este ID ao seu HTML no menu mobile
    const userWinsMobile = document.getElementById('user-wins-mobile'); // Adicione este ID ao seu HTML no menu mobile
    const userLossesMobile = document.getElementById('user-losses-mobile'); // Adicione este ID ao seu HTML no menu mobile


    // --- VARIÁVEIS E FUNÇÕES GLOBAIS (PARA O SOCKET.IO E NOTIFICAÇÕES) ---
    let socket;
    let emitUserConnected = () => { /* Função vazia inicial */ };
    let readyToConnectUser = false;

    // --- FUNÇÕES PARA CARREGAR E EXIBIR DADOS DO USUÁRIO E AVATAR ---
    const fetchUserProfile = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/users/me`, {
                headers: { 'x-auth-token': token }
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    showNotification('Sessão expirada. Faça login novamente.', 'error');
                    localStorage.clear();
                    setTimeout(() => window.location.href = 'login.html', 1500);
                    return;
                }
                throw new Error('Erro ao carregar perfil do usuário.');
            }

            const userData = await response.json();

            // Atualiza elementos DESKTOP
            if (currentUserAvatarDesktop) {
                currentUserAvatarDesktop.src = userData.avatarUrl || `${FRONTEND_BASE_URL}/img/avatar-placeholder.png`;
            }

            if (usernameDesktop) {
                usernameDesktop.textContent = userData.username || 'Usuário';
                localStorage.setItem('username', userData.username);
            }

            if (userConsoleIconDesktop && userData.console) {
                const iconPath = getConsoleIconPath(userData.console);
                if (iconPath) {
                    userConsoleIconDesktop.src = iconPath;
                    userConsoleIconDesktop.alt = userData.console;
                    userConsoleIconDesktop.dataset.consoleName = userData.console;
                    userConsoleIconDesktop.style.display = 'inline-block';
                } else {
                    userConsoleIconDesktop.style.display = 'none';
                    userConsoleIconDesktop.dataset.consoleName = '';
                }
            } else if (userConsoleIconDesktop) {
                userConsoleIconDesktop.style.display = 'none';
                userConsoleIconDesktop.dataset.consoleName = '';
            }

            // Atualiza elementos MOBILE
            if (currentUserAvatarMobile) {
                currentUserAvatarMobile.src = userData.avatarUrl || `${FRONTEND_BASE_URL}/img/avatar-placeholder.png`;
            }

            if (usernameMobile) {
                usernameMobile.textContent = userData.username || 'Usuário';
            }


            localStorage.setItem('profileCompleted', userData.profileCompleted);

            readyToConnectUser = true;
            emitUserConnected();
        } catch (error) {
            console.error('Erro ao buscar perfil do usuário:', error);
            showNotification('Não foi possível carregar o perfil. Algumas funcionalidades podem estar limitadas.', 'error');
        }
    };

    const fetchAndDisplayStats = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/users/me/stats`, {
                headers: { 'x-auth-token': token }
            });

            if (!response.ok) return;

            const stats = await response.json();

            // Atualiza elementos DESKTOP
            if (userWinsDesktop) userWinsDesktop.textContent = stats.wins || '0';
            if (userLossesDesktop) userLossesDesktop.textContent = stats.losses || '0';
            if (coinBalanceDesktop) coinBalanceDesktop.textContent = stats.coins ? stats.coins.toLocaleString('pt-BR') : '0';

            // Atualiza elementos MOBILE
            if (userWinsMobile) userWinsMobile.textContent = stats.wins || '0';
            if (userLossesMobile) userLossesMobile.textContent = stats.losses || '0';
            if (coinBalanceMobile) coinBalanceMobile.textContent = stats.coins ? stats.coins.toLocaleString('pt-BR') : '0';

        } catch (error) {
            console.error('Erro ao buscar stats:', error);
        }
    };

    const refreshDashboard = () => {
        fetchAndDisplayChallenges(token, userId);
        fetchAndDisplayMyChallenges(token, userId);
        fetchAndDisplayStats();
    };

    // --- INICIALIZAÇÃO DA INTERFACE ---
    fetchUserProfile();
    refreshDashboard(); // Inicializa o dashboard

    // Lógica do dropdown de perfil para DESKTOP
    if (userProfileMenuDesktop && dropdownTemplate) {
        const dropdownContent = dropdownTemplate.content.cloneNode(true);
        const dropdown = dropdownContent.firstElementChild; // Corrigido!
        if (dropdown) {
            userProfileMenuDesktop.appendChild(dropdown);

            userProfileMenuDesktop.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.classList.toggle('active');
            });

            document.addEventListener('click', (e) => {
                if (dropdown.classList.contains('active') && !userProfileMenuDesktop.contains(e.target)) {
                    dropdown.classList.remove('active');
                }
            });

            const dropdownLogoutButton = dropdown.querySelector('#dropdown-logout-button');
            if (dropdownLogoutButton) {
                dropdownLogoutButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    localStorage.clear();
                    showNotification('Você foi desconectado com sucesso.', 'info');
                    setTimeout(() => { window.location.href = 'login.html'; }, 1500);
                });
            }
        } else {
            console.error('Conteúdo do dropdown do perfil não encontrado dentro do template.');
        }
    } else {
        console.error('Template do dropdown do perfil não encontrado. Verifique dashboard.html.');
    }

    // Lógica do botão de logout no menu mobile (se existir um botão separado para mobile)
    const logoutButtonMobile = document.getElementById('logout-button');
    if (logoutButtonMobile) {
        logoutButtonMobile.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.clear();
            showNotification('Você foi desconectado com sucesso.', 'info');
            setTimeout(() => { window.location.href = 'login.html'; }, 1500);
        });
    }


    // --- LÓGICA DO CHAT E JOGADORES ONLINE (Socket.IO) ---
    if (typeof io !== 'undefined') {
        socket = io(API_BASE_URL, {
            auth: { token: token },
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000
        });

        let connectionTimeout;

        emitUserConnected = () => {
            if (socket.connected && username && userId && readyToConnectUser) {
                const userConsole = document.getElementById('current-user-console-icon') ? (document.getElementById('current-user-console-icon').dataset.consoleName || '') : '';
                const avatarUrl = document.getElementById('current-user-avatar-desktop')?.src || `${FRONTEND_BASE_URL}/img/avatar-placeholder.png`;
                console.log('Emitindo user connected:', { username, id: userId, avatarUrl, console: userConsole });
                socket.emit('user connected', {
                    username,
                    id: userId,
                    avatarUrl,
                    console: userConsole
                });
            }
        };

        socket.on('connecting', () => {
            console.log('Conectando ao servidor...');
            connectionTimeout = setTimeout(() => {
                showNotification('Conexão está demorando. Verifique sua internet.', 'warning');
            }, 5000);
        });

        socket.on('connect', () => {
            clearTimeout(connectionTimeout);
            console.log('Socket conectado. ID:', socket.id);
            emitUserConnected();
            refreshFriendsAndRequests(token);
            if (socket) socket.emit('request matchmaking queue counts');
        });

        socket.on('connect_error', (err) => {
            console.error('Erro na conexão do socket:', err);
            showNotification('Erro na conexão com o servidor. Tentando reconectar...', 'error');
        });

        socket.on('disconnect', (reason) => {
            console.log('Socket desconectado:', reason);
            if (reason === 'io server disconnect') {
                socket.connect();
            }
            // Não chame setupMatchmaking aqui, ele já é chamado na inicialização
        });

        socket.on('error', (err) => {
            console.error('Frontend: Erro no socket:', err);
            showNotification('Erro na conexão com o servidor de chat. Tentando reconectar...', 'error');
        });

        initFriendsAndChat(socket, token, userId, refreshDashboard);
        setupChallengeListeners(token, userId, refreshDashboard, socket);
        setupMatchmaking(socket, userId, refreshDashboard);

    } else {
        console.error('Biblioteca Socket.IO não carregada. O chat e a lista de jogadores não funcionarão.');
    }

    // --- LÓGICA DO MENU HAMBÚRGUER (Mobile) ---
    const setupMobileMenu = () => {
        const hamburgerButton = document.querySelector('.hamburger-menu');
        const mobileNav = document.querySelector('#main-nav-links');

        if (hamburgerButton && mobileNav) {
            hamburgerButton.addEventListener('click', (e) => {
                e.stopPropagation();
                hamburgerButton.classList.toggle('active');
                mobileNav.classList.toggle('mobile-nav-active');
                document.body.classList.toggle('mobile-nav-open');

                const isExpanded = hamburgerButton.getAttribute('aria-expanded') === 'true';
                hamburgerButton.setAttribute('aria-expanded', (!isExpanded).toString());
            });

            // Fecha ao clicar em links ou fora do menu
            mobileNav.addEventListener('click', (e) => {
                if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') {
                    hamburgerButton.classList.remove('active');
                    mobileNav.classList.remove('mobile-nav-active');
                    document.body.classList.remove('mobile-nav-open');
                    hamburgerButton.setAttribute('aria-expanded', 'false');
                }
            });

            document.addEventListener('click', (e) => {
                if (mobileNav.classList.contains('mobile-nav-active') &&
                    !mobileNav.contains(e.target) &&
                    !hamburgerButton.contains(e.target)) {
                    hamburgerButton.classList.remove('active');
                    mobileNav.classList.remove('mobile-nav-active');
                    document.body.classList.remove('mobile-nav-open');
                    hamburgerButton.setAttribute('aria-expanded', 'false');
                }
            });
        }
    };

    // Chame a função de setup do menu mobile
    setupMobileMenu();
});