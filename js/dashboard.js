// arquivo: site_de_jogos/js/dashboard.js

// Importa as funções utilitárias
import { showNotification, getConsoleIconPath, API_BASE_URL, FRONTEND_BASE_URL } from './utils.js';
// Importa as funções de desafios
import { fetchAndDisplayChallenges, fetchAndDisplayMyChallenges, renderMyChallenges, setupChallengeListeners } from './challenges.js';
// Importa as funções de amigos e chat
import { initFriendsAndChat, fetchAndDisplayFriends, fetchAndDisplayFriendRequests, fetchAndDisplaySentFriendRequests, fetchAndDisplayBlockedUsers, refreshFriendsAndRequests } from './friends_and_chat.js';
// Importa as funções de matchmaking
import { setupMatchmaking } from './matchmaking.js';
// NOVO: Importa as funções de campeonatos
import { fetchAndDisplayTournaments, setupTournamentListeners } from './tournaments.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- DADOS GLOBAIS E VERIFICAÇÃO DE AUTENTICAÇÃO ---
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    const userId = localStorage.getItem('userId');
    const userRole = localStorage.getItem('userRole');
    const profileCompleted = localStorage.getItem('profileCompleted');

    // Redirecionamentos iniciais de segurança
    if (!token) {
        window.location.href = 'login-split-form.html'; // ALTERADO
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
    const userInitialDesktop = document.getElementById('user-initial-desktop');
    const userWinsDesktop = document.getElementById('user-wins-desktop');
    const userLossesDesktop = document.getElementById('user-losses-desktop');
    const coinBalanceDesktop = document.getElementById('coin-balance-desktop');
    const userProfileMenuDesktop = document.getElementById('user-profile-menu-desktop');
    const dropdownTemplate = document.getElementById('user-profile-dropdown-template');

    // Seletores para MOBILE
    const userInitialMobile = document.getElementById('user-initial-mobile');

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
                    setTimeout(() => window.location.href = 'login-split-form.html', 1500); // ALTERADO
                    return;
                }
                throw new Error('Erro ao carregar perfil do usuário.');
            }

            const userData = await response.json();

            // Pega a inicial do nome de usuário
            const initial = userData.username ? userData.username.charAt(0).toUpperCase() : '';

            // Atualiza elementos DESKTOP
            if (userInitialDesktop) {
                userInitialDesktop.textContent = initial;
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

            // Atualiza o avatar MOBILE
            if (userInitialMobile) {
                userInitialMobile.textContent = initial;
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

        } catch (error) {
            console.error('Erro ao buscar stats:', error);
        }
    };

    const refreshDashboard = () => {
        fetchAndDisplayChallenges(token, userId);
        fetchAndDisplayMyChallenges(token, userId);
        fetchAndDisplayStats();
        // NOVO: Atualiza a lista de campeonatos
        fetchAndDisplayTournaments(token, userId);
    };

    // --- INICIALIZAÇÃO DA INTERFACE ---
    fetchUserProfile();
    refreshDashboard();

    // Lógica do dropdown de perfil para DESKTOP
    if (userProfileMenuDesktop && dropdownTemplate) {
        const dropdownContent = dropdownTemplate.content.cloneNode(true);
        const dropdown = dropdownContent.firstElementChild;
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
                    setTimeout(() => { window.location.href = 'login-split-form.html'; }, 1500);
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
            setTimeout(() => { window.location.href = 'login-split-form.html'; }, 1500);
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
                const avatarInitial = document.getElementById('user-initial-desktop')?.textContent || '';
                console.log('Emitindo user connected:', { username, id: userId, avatarInitial, console: userConsole });
                socket.emit('user connected', {
                    username,
                    id: userId,
                    avatarInitial,
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
        
        socket.on('challenge updated', () => {
             showNotification('Um desafio foi atualizado. Atualizando seu painel...', 'info');
             refreshDashboard();
        });

        socket.on('challenge created', () => {
             refreshDashboard();
        });
        
        // NOVO: Evento para quando o saldo da carteira é atualizado (ex: pagamento confirmado pelo admin)
        socket.on('wallet updated', (data) => {
            showNotification('Seu saldo foi atualizado! Verifique sua carteira.', 'success');
            // Atualiza o saldo exibido no dashboard
            const coinBalanceDesktop = document.getElementById('coin-balance-desktop');
            const walletCurrentBalanceSpan = document.getElementById('wallet-current-balance');
            if (coinBalanceDesktop) coinBalanceDesktop.textContent = data.newBalance.toLocaleString('pt-BR');
            if (walletCurrentBalanceSpan) walletCurrentBalanceSpan.textContent = data.newBalance.toLocaleString('pt-BR');
            // Recarrega o dashboard para garantir a consistência
            refreshDashboard();
        });
        
        // NOVO: Evento para quando o status de saque é atualizado
        socket.on('withdrawal status updated', (data) => {
            if (data.status === 'approved') {
                showNotification('Sua solicitação de saque foi aprovada! Verifique sua conta Pix.', 'success');
            } else if (data.status === 'rejected') {
                showNotification(`Sua solicitação de saque foi rejeitada. O valor de ${data.amount} moedas foi devolvido à sua carteira.`, 'info');
            }
            refreshDashboard();
        });
        
        // NOVO: Escuta por atualizações de campeonatos
        socket.on('tournament_created', () => {
            showNotification('Um novo campeonato foi criado! Dê uma olhada.', 'info');
            fetchAndDisplayTournaments(token, userId);
        });

        socket.on('tournament_updated', () => {
            fetchAndDisplayTournaments(token, userId);
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
        });

        socket.on('error', (err) => {
            console.error('Frontend: Erro no socket:', err);
            showNotification('Erro na conexão com o servidor de chat. Tentando reconectar...', 'error');
        });

        initFriendsAndChat(socket, token, userId, refreshDashboard);
        setupChallengeListeners(token, userId, refreshDashboard, socket);
        setupMatchmaking(socket, userId, refreshDashboard);
        // NOVO: Adiciona o listener para campeonatos
        setupTournamentListeners(token, userId, refreshDashboard);

    } else {
        console.error('Biblioteca Socket.IO não carregada. O chat e a lista de jogadores não funcionarão.');
    }
});