// arquivo: site_de_jogos/js/admin.js

// NOVO: Importa showNotification e API_BASE_URL de utils.js
import { showNotification, API_BASE_URL, FRONTEND_BASE_URL } from './utils.js';

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token');
    const userRole = localStorage.getItem('userRole');

    // --- VERIFICAÇÃO DE ADMIN ---
    if (!token || userRole !== 'admin') {
        showNotification('Acesso negado. Você não tem permissão de administrador.', 'error');
        setTimeout(() => {
            window.location.href = 'login-split-form.html';
        }, 1500);
        return;
    }

    // --- SOCKET.IO para atualização de usuários online (apenas a contagem) ---
    if (typeof io !== 'undefined') {
        const socket = io(API_BASE_URL);

        socket.on('connect', () => {
            console.log('Admin Frontend: Conectado ao Socket.IO.');
            // O admin também precisa se identificar para a contagem de onlineUsers
            const adminUserId = localStorage.getItem('userId');
            const adminUsername = localStorage.getItem('username');
            if (adminUserId && adminUsername) {
                 socket.emit('user connected', { username: adminUsername, id: adminUserId });
            }
        });

        // Adicionar um listener para o evento de reconexão do Socket.IO.
        socket.on('reconnect', () => {
            console.log('Admin Frontend: Socket.IO reconnected. Re-emitting user connected.');
            const adminUserId = localStorage.getItem('userId');
            const adminUsername = localStorage.getItem('username');
            if (adminUserId && adminUsername) {
                socket.emit('user connected', { username: adminUsername, id: adminUserId });
            }
        });

        socket.on('update user list', (users) => {
            const onlineUsersCountElement = document.getElementById('online-users-count');
            if (onlineUsersCountElement) {
                // A contagem no admin deve incluir todos os usuários conectados (incluindo o próprio admin, se aplicável ao seu cálculo de "online users")
                onlineUsersCountElement.textContent = users.length;
            }
        });
        
        // NOVO: Escuta por atualizações de campeonatos
        socket.on('tournament_created', () => {
            showNotification('Um novo campeonato foi criado ou atualizado!', 'info');
            loadTournaments();
        });
        socket.on('tournament_updated', () => {
            showNotification('Um campeonato foi atualizado!', 'info');
            loadTournaments();
        });

        socket.on('error', (err) => {
            console.error('Admin Frontend: Erro no socket:', err);
            showNotification('Erro na conexão com o servidor de chat. Algumas informações podem não estar em tempo real.', 'error');
        });
    } else {
        console.warn('Biblioteca Socket.IO não carregada. Contagem de usuários online pode não ser em tempo real.');
    }


    // --- FUNÇÕES AUXILIARES ---
    const formatDate = (dateString) => {
        const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
        return new Date(dateString).toLocaleDateString('pt-BR', options);
    };

    const fetchAdminData = async (endpoint) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/${endpoint}`, {
                headers: {
                    'x-auth-token': token
                }
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `Erro ao buscar dados de ${endpoint}.`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Erro em fetchAdminData (${endpoint}):`, error);
            showNotification(error.message, 'error');
            return null;
        }
    };
    
    // NOVO: Função para renderizar o chaveamento
    const renderBracket = (bracket, tournamentId) => {
        const bracketContainer = document.getElementById('tournament-bracket-display');
        bracketContainer.innerHTML = '';
        
        if (!bracket || bracket.length === 0) {
            bracketContainer.innerHTML = '<p>Chaveamento não gerado.</p>';
            return;
        }
        
        // Agrupa os matches por round
        const rounds = bracket.reduce((acc, match) => {
            (acc[match.round] = acc[match.round] || []).push(match);
            return acc;
        }, {});
        
        for (const roundName in rounds) {
            const roundDiv = document.createElement('div');
            roundDiv.className = 'tournament-round';
            roundDiv.innerHTML = `<h4>${roundName}</h4>`;
            
            rounds[roundName].forEach(match => {
                const matchDiv = document.createElement('div');
                matchDiv.className = 'tournament-match';
                
                const player1Name = match.player1 ? match.player1.username : 'Aguardando...';
                const player2Name = match.player2 ? match.player2.username : 'Aguardando...';
                
                let matchHtml = `
                    <p>
                        <span>${player1Name}</span> vs <span>${player2Name}</span>
                    </p>
                `;

                // Adiciona um botão para resolver o match se o status for pendente
                if (match.status !== 'completed' && match.player1 && match.player2) {
                    const resolveBtn = document.createElement('button');
                    resolveBtn.textContent = 'Resolver';
                    resolveBtn.className = 'cta-button resolve-match-btn';
                    resolveBtn.dataset.matchId = match._id;
                    resolveBtn.dataset.tournamentId = tournamentId;
                    resolveBtn.dataset.player1Id = match.player1._id;
                    resolveBtn.dataset.player1Name = match.player1.username;
                    resolveBtn.dataset.player2Id = match.player2._id;
                    resolveBtn.dataset.player2Name = match.player2.username;
                    
                    matchDiv.appendChild(resolveBtn);
                }
                
                if (match.winner) {
                    const winnerP = document.createElement('p');
                    winnerP.innerHTML = `Vencedor: <strong>${match.winner.username}</strong>`;
                    matchDiv.appendChild(winnerP);
                }
                
                roundDiv.appendChild(matchDiv);
            });
            
            bracketContainer.appendChild(roundDiv);
        }
        
        bracketContainer.style.display = 'block';
    };


    // --- CARREGAR DADOS DO DASHBOARD ---
    const loadDashboardStats = async () => {
        const stats = await fetchAdminData('dashboard-stats');
        if (stats) {
            document.getElementById('total-users').textContent = stats.totalUsers;
            document.getElementById('total-challenges').textContent = stats.totalChallenges;
            document.getElementById('completed-challenges').textContent = stats.completedChallenges;
            document.getElementById('disputed-challenges').textContent = stats.disputedChallenges;
            document.getElementById('total-coins-bet').textContent = stats.totalCoinsBet.toLocaleString('pt-BR');
            document.getElementById('online-users-count').textContent = stats.onlineUsersCount;
            // NOVO: Atualiza os stats de campeonatos
            document.getElementById('total-tournaments').textContent = stats.totalTournaments;
            document.getElementById('active-tournaments').textContent = stats.activeTournaments;
        }
    };

    // --- CARREGAR E RENDERIZAR USUÁRIOS ---
    let allUsers = [];
    const loadUsers = async () => {
        const users = await fetchAdminData('users');
        const usersTableBody = document.querySelector('#users-table tbody');
        if (usersTableBody) {
            usersTableBody.innerHTML = '';
            if (users && users.length > 0) {
                allUsers = users;
                users.forEach(user => {
                    const row = `
                        <tr data-user-id="${user._id}">
                            <td>${user._id.substring(0, 8)}...</td>
                            <td>${user.username}</td>
                            <td>${user.email}</td>
                            <td>${formatDate(user.createdAt)}</td>
                            <td>${user.wins}</td>
                            <td>${user.losses}</td>
                            <td>${user.coins.toLocaleString('pt-BR')}</td>
                            <td>${user.isActive ? 'Sim' : 'Não'}</td>
                            <td class="table-actions">
                                <button class="edit-coins-btn cta-button edit" title="Editar Moedas">💰</button>
                                <button class="toggle-active-btn cta-button toggle-active" title="${user.isActive ? 'Desativar' : 'Ativar Conta'}">${user.isActive ? '🚫' : '✅'}</button>
                            </td>
                        </tr>
                    `;
                    usersTableBody.innerHTML += row;
                });
            } else {
                usersTableBody.innerHTML = '<tr><td colspan="9">Nenhum usuário encontrado.</td></tr>';
            }
        }
    };

    // --- CARREGAR E RENDERIZAR DESAFIOS ---
    let allChallenges = [];
    const loadChallenges = async () => {
        const challenges = await fetchAdminData('challenges');
        const challengesTableBody = document.querySelector('#challenges-table tbody');
        if (challengesTableBody) {
            challengesTableBody.innerHTML = '';
            if (challenges && challenges.length > 0) {
                allChallenges = challenges;
                challenges.forEach(challenge => {
                    const createdByUsername = challenge.createdBy ? challenge.createdBy.username : 'N/A';
                    const opponentUsername = challenge.opponent ? challenge.opponent.username : 'Aguardando';
                    const winnerUsername = challenge.winner ? challenge.winner.username : 'N/A';

                    let actionsHtml = '';
                    if (challenge.status === 'disputed') {
                        actionsHtml = `<button class="resolve-dispute-btn cta-button resolve" title="Resolver Disputa">⚖️</button>`;
                    } else if (challenge.status === 'open' || challenge.status === 'accepted') {
                        actionsHtml = `<button class="cancel-challenge-btn cta-button cancel" title="Cancelar Desafio">❌</button>`;
                    }

                    const row = `
                        <tr data-challenge-id="${challenge._id}">
                            <td>${challenge._id.substring(0, 8)}...</td>
                            <td>${challenge.game}</td>
                            <td>${challenge.console}</td>
                            <td>${challenge.betAmount.toLocaleString('pt-BR')}</td>
                            <td>${createdByUsername}</td>
                            <td>${opponentUsername}</td>
                            <td>${challenge.status}</td>
                            <td>${winnerUsername}</td>
                            <td>${formatDate(challenge.createdAt)}</td>
                            <td class="table-actions">${actionsHtml}</td>
                        </tr>
                    `;
                    challengesTableBody.innerHTML += row;
                });
            } else {
                challengesTableBody.innerHTML = '<tr><td colspan="10">Nenhum desafio encontrado.</td></tr>';
            }
        }
    };

    // NOVO: CARREGAR E RENDERIZAR CAMPEONATOS
    let allTournaments = [];
    const loadTournaments = async () => {
        const tournaments = await fetchAdminData('all-tournaments'); // Nova rota para pegar todos os torneios
        const tournamentsTableBody = document.querySelector('#tournaments-table tbody');
        if (tournamentsTableBody) {
            tournamentsTableBody.innerHTML = '';
            if (tournaments && tournaments.length > 0) {
                allTournaments = tournaments;
                tournaments.forEach(tournament => {
                    let actionsHtml = '';
                    if (tournament.status === 'registration') {
                        actionsHtml = `<button class="manage-tournament-btn cta-button" title="Gerenciar Campeonato">🔧</button>`;
                    } else if (tournament.status === 'in-progress') {
                        actionsHtml = `<button class="manage-tournament-btn cta-button" title="Gerenciar Campeonato">🔧</button>`;
                    } else {
                        actionsHtml = `<button class="view-tournament-btn cta-button edit" title="Ver Detalhes">👁️</button>`;
                    }
                    
                    // Adiciona o novo botão de exclusão
                    actionsHtml += `<button class="delete-tournament-btn cta-button cancel" title="Excluir Campeonato">🗑️</button>`;

                    const row = `
                        <tr data-tournament-id="${tournament._id}">
                            <td>${tournament._id.substring(0, 8)}...</td>
                            <td>${tournament.name}</td>
                            <td>${tournament.game}</td>
                            <td>${tournament.betAmount.toLocaleString('pt-BR')}</td>
                            <td>${tournament.participants.length}</td>
                            <td>${tournament.maxParticipants}</td>
                            <td>${tournament.status}</td>
                            <td class="table-actions">${actionsHtml}</td>
                        </tr>
                    `;
                    tournamentsTableBody.innerHTML += row;
                });
            } else {
                tournamentsTableBody.innerHTML = '<tr><td colspan="8">Nenhum campeonato encontrado.</td></tr>';
            }
        }
    };
    
    // NOVO: CARREGAR E RENDERIZAR SOLICITAÇÕES DE SAQUE
    const loadPendingWithdrawals = async () => {
        const pendingWithdrawals = await fetchAdminData('pending-withdrawals');
        const withdrawalsTableBody = document.querySelector('#withdrawals-table tbody');
        if (withdrawalsTableBody) {
            withdrawalsTableBody.innerHTML = '';
            if (pendingWithdrawals && pendingWithdrawals.length > 0) {
                pendingWithdrawals.forEach(withdrawal => {
                    const row = `
                        <tr data-withdrawal-id="${withdrawal._id}" data-withdrawal-amount="${withdrawal.amount}">
                            <td>${withdrawal._id.substring(0, 8)}...</td>
                            <td>${withdrawal.userId._id.substring(0, 8)}...</td>
                            <td>${withdrawal.userId.username}</td>
                            <td>${withdrawal.userId.cpf || 'N/A'}</td>
                            <td>${withdrawal.amount.toLocaleString('pt-BR')}</td>
                            <td>${withdrawal.pixKeyType}</td>
                            <td>${withdrawal.pixKeyValue}</td>
                            <td>${formatDate(withdrawal.createdAt)}</td>
                            <td class="table-actions">
                                <button class="approve-withdrawal-btn cta-button resolve" title="Aprovar Saque">✅</button>
                                <button class="reject-withdrawal-btn cta-button cancel" title="Rejeitar Saque">❌</button>
                            </td>
                        </tr>
                    `;
                    withdrawalsTableBody.innerHTML += row;
                });
            } else {
                withdrawalsTableBody.innerHTML = '<tr><td colspan="9">Nenhuma solicitação de saque pendente.</td></tr>';
            }
        }
    };


    // NOVO: CARREGAR E RENDERIZAR PAGAMENTOS PIX PENDENTES
    const loadPendingPixPayments = async () => {
        const pendingPayments = await fetchAdminData('pending-pix');
        const paymentsTableBody = document.querySelector('#pix-payments-table tbody');
        if (paymentsTableBody) {
            paymentsTableBody.innerHTML = '';
            if (pendingPayments && pendingPayments.length > 0) {
                pendingPayments.forEach(payment => {
                    const row = `
                        <tr data-payment-id="${payment._id}">
                            <td>${payment._id.substring(0, 8)}...</td>
                            <td>${payment.userId._id.substring(0, 8)}...</td>
                            <td>${payment.userId.email}</td>
                            <td>${payment.amount.toLocaleString('pt-BR')}</td>
                            <td>${formatDate(payment.createdAt)}</td>
                            <td class="table-actions">
                                <button class="confirm-pix-btn cta-button resolve" title="Confirmar Pagamento">✅</button>
                            </td>
                        </tr>
                    `;
                    paymentsTableBody.innerHTML += row;
                });
            } else {
                paymentsTableBody.innerHTML = '<tr><td colspan="6">Nenhum pagamento Pix pendente.</td></tr>';
            }
        }
    };

    // --- INICIALIZAÇÃO DA PÁGINA ---
    const initializeAdminPage = () => {
        loadDashboardStats();
        loadUsers();
        loadChallenges();
        loadPendingPixPayments();
        loadPendingWithdrawals();
        loadTournaments();
    };

    initializeAdminPage();

    // --- LÓGICA DE EVENTOS (Modals e Ações) ---

    // Logout do Admin
    const adminLogoutButton = document.getElementById('admin-logout-button');
    if (adminLogoutButton) {
        adminLogoutButton.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Botão Sair Admin clicado!');
            localStorage.clear();
            console.log('Local Storage limpo. Redirecionando...');
            showNotification('Sessão de admin encerrada.', 'info');
            window.location.href = 'login-split-form.html';
        });
    }

    // Gerenciar Modals (função auxiliar)
    const setupModal = (modalId, closeBtnSelector, formId, callback) => {
        const modalBackdrop = document.getElementById(modalId);
        if (!modalBackdrop) return;

        const closeBtn = modalBackdrop.querySelector(closeBtnSelector);
        const form = document.getElementById(formId);

        const closeModal = () => modalBackdrop.classList.remove('active');

        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        modalBackdrop.addEventListener('click', (e) => {
            if (e.target === modalBackdrop) closeModal();
        });
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await callback(e);
            });
        }
    };

    // --- Modal Editar Moedas ---
    setupModal('edit-coins-modal-backdrop', '.close-modal-btn', 'edit-coins-form', async (e) => {
        const userIdToEdit = document.getElementById('edit-coins-user-id').value;
        const newCoinsAmount = document.getElementById('new-coins-amount').value;
        const errorElement = document.getElementById('edit-coins-error');
        errorElement.textContent = '';

        if (newCoinsAmount === '' || isNaN(newCoinsAmount) || Number(newCoinsAmount) < 0) {
            errorElement.textContent = 'Por favor, insira um valor de moedas válido.';
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/users/${userIdToEdit}/update-coins`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'x-auth-token': token
                },
                body: JSON.stringify({ coins: Number(newCoinsAmount) })
            });
            const data = await response.json();
            if (!response.ok) {
                errorElement.textContent = data.message || 'Erro ao atualizar moedas.';
            } else {
                showNotification(data.message, 'success');
                document.getElementById('edit-coins-modal-backdrop').classList.remove('active');
                loadUsers();
                loadDashboardStats();
            }
        } catch (error) {
            errorElement.textContent = 'Não foi possível conectar ao servidor.';
        }
    });

    // Delegando eventos para a tabela de usuários
    const usersTableBody = document.querySelector('#users-table tbody');
    if (usersTableBody) {
        usersTableBody.addEventListener('click', (e) => {
            const target = e.target;
            const row = target.closest('tr[data-user-id]');
            if (!row) return;

            const userId = row.dataset.userId;

            // Botão Editar Moedas
            if (target.classList.contains('edit-coins-btn')) {
                const userToEdit = allUsers.find(u => u._id === userId);
                if (userToEdit) {
                    document.getElementById('edit-coins-user-id').value = userToEdit._id;
                    document.getElementById('edit-coins-username').textContent = userToEdit.username;
                    document.getElementById('new-coins-amount').value = userToEdit.coins;
                    document.getElementById('edit-coins-error').textContent = '';
                    document.getElementById('edit-coins-modal-backdrop').classList.add('active');
                }
            }

            // Botão Ativar/Desativar Conta
            if (target.classList.contains('toggle-active-btn')) {
                const isActive = row.querySelector('td:nth-child(8)').textContent === 'Sim';
                const action = isActive ? 'desativar' : 'ativar';
                if (confirm(`Tem certeza que deseja ${action} a conta deste usuário?`)) {
                    fetch(`${API_BASE_URL}/api/admin/users/${userId}/toggle-active`, {
                        method: 'PATCH',
                        headers: {
                            'x-auth-token': token
                        }
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.message) {
                            showNotification(data.message, 'success');
                            loadUsers();
                        } else {
                            showNotification(data.message || 'Erro ao alterar status.', 'error');
                        }
                    })
                    .catch(() => showNotification('Não foi possível conectar ao servidor.', 'error'));
                }
            }
        });
    }
    
    // --- Modal Resolver Disputa ---
    setupModal('resolve-dispute-modal-backdrop', '.close-modal-btn', 'resolve-dispute-form', async (e) => {
        const challengeId = document.getElementById('dispute-challenge-id').value;
        const winnerRadio = document.querySelector('#dispute-winner-options input[name="winner"]:checked');
        const errorElement = document.getElementById('resolve-dispute-error');
        errorElement.textContent = '';
        
        if (!winnerRadio) {
            errorElement.textContent = 'Por favor, selecione um vencedor para resolver a disputa.';
            return;
        }
        
        const winnerId = winnerRadio.value;
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/challenges/${challengeId}/resolve-dispute`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'x-auth-token': token
                },
                body: JSON.stringify({ winnerId })
            });
            const data = await response.json();
            if (!response.ok) {
                errorElement.textContent = data.message || 'Erro ao resolver disputa.';
            } else {
                showNotification(data.message, 'success');
                document.getElementById('resolve-dispute-modal-backdrop').classList.remove('active');
                loadChallenges();
                loadDashboardStats();
                loadUsers(); // Atualiza o saldo e vitórias/derrotas
            }
        } catch (error) {
            errorElement.textContent = 'Não foi possível conectar ao servidor.';
        }
    });

    // Delegando eventos para a tabela de desafios
    const challengesTableBody = document.querySelector('#challenges-table tbody');
    if (challengesTableBody) {
        challengesTableBody.addEventListener('click', (e) => {
            const target = e.target;
            const row = target.closest('tr[data-challenge-id]');
            if (!row) return;

            const challengeId = row.dataset.challengeId;

            // Botão Resolver Disputa (FIX: Usando closest para lidar com cliques no ícone)
             const resolveDisputeBtn = target.closest('.resolve-dispute-btn');
        if (resolveDisputeBtn) {
            const challenge = allChallenges.find(c => c._id === challengeId);
            if (challenge) {
                    
                    // Dados básicos
                    document.getElementById('dispute-challenge-info').textContent = challenge._id.substring(0, 8);
                    document.getElementById('dispute-challenge-id').value = challenge._id;
                    
                    const creatorId = String(challenge.createdBy._id);
                    const opponentId = String(challenge.opponent._id);
                    
                    // Os resultados reportados pelos jogadores
                    const report1 = challenge.results.find(r => String(r.reportedBy) === creatorId);
                    const report2 = challenge.results.find(r => String(r.reportedBy) === opponentId);

                    const getReportedWinnerName = (report, challenge) => {
                        if (!report || !report.winner) return 'N/A';
                        const winnerId = String(report.winner);
                        if (winnerId === String(challenge.createdBy._id)) return challenge.createdBy.username;
                        if (winnerId === String(challenge.opponent._id)) return challenge.opponent.username;
                        return 'ID Inválido';
                    };
                    
                    // Report 1 (Criador)
                    document.getElementById('dispute-creator-username').textContent = challenge.createdBy.username;
                    document.getElementById('dispute-creator-id').textContent = creatorId;
                    
                    // Preenche as evidências do Criador
                    const disputeWinnerReported1 = document.getElementById('dispute-winner-reported-1');
                    const evidenceLink1 = document.getElementById('dispute-evidence-link-1');
                    
                    // CORREÇÃO: Verifica se os elementos existem antes de tentar preencher
                    if (disputeWinnerReported1) {
                         disputeWinnerReported1.textContent = getReportedWinnerName(report1, challenge);
                    }

                    if (evidenceLink1) { 
                        if (report1 && report1.evidence && report1.evidence.trim() !== '') {
                            evidenceLink1.href = report1.evidence;
                            evidenceLink1.textContent = 'Visualizar Evidência';
                            evidenceLink1.style.color = 'var(--primary-neon)';
                        } else {
                            evidenceLink1.textContent = 'Nenhuma evidência fornecida';
                            evidenceLink1.href = '#';
                            evidenceLink1.style.color = 'var(--text-muted)';
                        }
                    }

                    // Report 2 (Oponente)
                    document.getElementById('dispute-opponent-username').textContent = challenge.opponent.username;
                    document.getElementById('dispute-opponent-id').textContent = opponentId;
                    
                    // Preenche as evidências do Oponente
                    const disputeWinnerReported2 = document.getElementById('dispute-winner-reported-2');
                    const evidenceLink2 = document.getElementById('dispute-evidence-link-2');

                    // CORREÇÃO: Verifica se os elementos existem antes de tentar preencher
                    if (disputeWinnerReported2) {
                        disputeWinnerReported2.textContent = getReportedWinnerName(report2, challenge);
                    }

                    if (evidenceLink2) { 
                        if (report2 && report2.evidence && report2.evidence.trim() !== '') {
                            evidenceLink2.href = report2.evidence;
                            evidenceLink2.textContent = 'Visualizar Evidência';
                            evidenceLink2.style.color = 'var(--primary-neon)';
                        } else {
                            evidenceLink2.textContent = 'Nenhuma evidência fornecida';
                            evidenceLink2.href = '#';
                            evidenceLink2.style.color = 'var(--text-muted)';
                        }
                    }

                    const optionsHtml = `
                        <div class="winner-selection">
                            <div class="winner-option">
                                <input type="radio" name="winner" id="admin-winner-${challenge.createdBy._id}" value="${challenge.createdBy._id}" required>
                                <label for="admin-winner-${challenge.createdBy._id}">${challenge.createdBy.username}</label>
                            </div>
                            <div class="winner-option">
                                <input type="radio" name="winner" id="admin-winner-${challenge.opponent._id}" value="${challenge.opponent._id}" required>
                                <label for="admin-winner-${challenge.opponent._id}">${challenge.opponent.username}</label>
                            </div>
                        </div>
                        <button type="submit" class="cta-button form-submit-btn" style="margin-top: 15px;">Confirmar Vencedor</button>
                    `;

                    document.getElementById('dispute-winner-options').innerHTML = optionsHtml;
                    document.getElementById('resolve-dispute-error').textContent = ''; // Limpa erro anterior

                    document.getElementById('resolve-dispute-modal-backdrop').classList.add('active');
                }
            }

            // Botão Cancelar Desafio
            if (target.classList.contains('cancel-challenge-btn')) {
                if (confirm("Tem certeza que deseja CANCELAR este desafio?")) {
                    fetch(`${API_BASE_URL}/api/admin/challenges/${challengeId}/cancel`, {
                        method: 'PATCH',
                        headers: {
                            'x-auth-token': token
                        }
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.message) {
                            showNotification(data.message, 'success');
                            loadChallenges();
                        } else {
                            showNotification(data.message || 'Erro ao cancelar desafio.', 'error');
                        }
                    })
                    .catch(() => showNotification('Não foi possível conectar ao servidor.', 'error'));
                }
            }
        });
    }
    
    // NOVO: Delegando eventos para a tabela de solicitações de saque
    const withdrawalsTableBody = document.querySelector('#withdrawals-table tbody');
    if (withdrawalsTableBody) {
        withdrawalsTableBody.addEventListener('click', async (e) => {
            const target = e.target;
            const row = target.closest('tr[data-withdrawal-id]');
            if (!row) return;

            const withdrawalId = row.dataset.withdrawalId;

            // Botão Aprovar Saque
            if (target.classList.contains('approve-withdrawal-btn')) {
                if (confirm("Tem certeza que deseja APROVAR este saque? Isso não pode ser desfeito.")) {
                    try {
                        const response = await fetch(`${API_BASE_URL}/api/admin/withdrawals/${withdrawalId}/approve`, {
                            method: 'PATCH',
                            headers: {
                                'x-auth-token': token
                            }
                        });
                        const data = await response.json();
                        if (response.ok) {
                            showNotification(data.message, 'success');
                            loadPendingWithdrawals();
                            loadUsers();
                            loadDashboardStats();
                        } else {
                            showNotification(data.message || 'Erro ao aprovar saque.', 'error');
                        }
                    } catch (error) {
                        console.error('Erro ao aprovar saque:', error);
                        showNotification('Não foi possível conectar ao servidor.', 'error');
                    }
                }
            }

            // Botão Rejeitar Saque
            if (target.classList.contains('reject-withdrawal-btn')) {
                 const withdrawalAmount = row.dataset.withdrawalAmount;
                 document.getElementById('reject-withdrawal-amount').textContent = withdrawalAmount;
                 document.getElementById('confirm-reject-withdrawal-btn').dataset.withdrawalId = withdrawalId;
                 document.getElementById('reject-withdrawal-modal-backdrop').classList.add('active');
            }
        });
    }

    // Lógica para o modal de rejeição de saque
    const rejectWithdrawalModalBackdrop = document.getElementById('reject-withdrawal-modal-backdrop');
    if (rejectWithdrawalModalBackdrop) {
        const closeModalBtn = rejectWithdrawalModalBackdrop.querySelector('.close-modal-btn');
        const confirmBtn = document.getElementById('confirm-reject-withdrawal-btn');
        const cancelBtn = document.getElementById('cancel-reject-withdrawal-btn');
        
        const closeModal = () => rejectWithdrawalModalBackdrop.classList.remove('active');
        
        closeModalBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        
        confirmBtn.addEventListener('click', async () => {
             const withdrawalId = confirmBtn.dataset.withdrawalId;
             try {
                 const response = await fetch(`${API_BASE_URL}/api/admin/withdrawals/${withdrawalId}/reject`, {
                     method: 'PATCH',
                     headers: {
                         'x-auth-token': token
                     }
                 });
                 const data = await response.json();
                 if (response.ok) {
                     showNotification(data.message, 'info');
                     closeModal();
                     loadPendingWithdrawals();
                     loadUsers();
                     loadDashboardStats();
                 } else {
                     showNotification(data.message || 'Erro ao rejeitar saque.', 'error');
                 }
             } catch (error) {
                 console.error('Erro ao rejeitar saque:', error);
                 showNotification('Não foi possível conectar ao servidor.', 'error');
             }
        });
    }

    // NOVO: Lógica para a tabela de pagamentos Pix
    const paymentsTableBody = document.querySelector('#pix-payments-table tbody');
    if (paymentsTableBody) {
        paymentsTableBody.addEventListener('click', async (e) => {
            const target = e.target;
            const row = target.closest('tr[data-payment-id]');
            if (!row) return;

            const paymentId = row.dataset.paymentId;
            const actionButton = row.querySelector('.confirm-pix-btn');

            if (target.classList.contains('confirm-pix-btn')) {
                if (confirm("Tem certeza que deseja CONFIRMAR este pagamento? Isso irá adicionar o valor ao saldo do usuário.")) {
                    try {
                        const response = await fetch(`${API_BASE_URL}/api/admin/confirm-pix/${paymentId}`, {
                            method: 'PATCH',
                            headers: {
                                'x-auth-token': token
                            }
                        });
                        const data = await response.json();
                        if (response.ok) {
                            showNotification(data.message, 'success');
                            loadPendingPixPayments();
                            loadUsers();
                            loadDashboardStats();
                        } else {
                            showNotification(data.message || 'Erro ao confirmar pagamento.', 'error');
                        }
                    } catch (error) {
                        console.error('Erro ao confirmar pagamento:', error);
                        showNotification('Não foi possível conectar ao servidor.', 'error');
                    }
                }
            }
        });
    }

    // NOVO: Lógica para os modais de Campeonato
    const createTournamentModalBackdrop = document.getElementById('create-tournament-modal-backdrop');
    const openCreateTournamentBtn = document.getElementById('open-create-tournament-modal-btn');
    const createTournamentForm = document.getElementById('create-tournament-form');
    
    if (openCreateTournamentBtn && createTournamentModalBackdrop) {
        openCreateTournamentBtn.addEventListener('click', () => {
            createTournamentModalBackdrop.classList.add('active');
        });
        const closeBtn = createTournamentModalBackdrop.querySelector('.close-modal-btn');
        closeBtn.addEventListener('click', () => {
            createTournamentModalBackdrop.classList.remove('active');
        });
        createTournamentModalBackdrop.addEventListener('click', (e) => {
            if (e.target === createTournamentModalBackdrop) createTournamentModalBackdrop.classList.remove('active');
        });
    }

    if (createTournamentForm) {
        createTournamentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = {
                name: document.getElementById('tournament-name').value,
                game: document.getElementById('tournament-game-select').value,
                console: document.getElementById('tournament-console-select').value,
                betAmount: document.getElementById('tournament-bet-amount').value,
                maxParticipants: document.getElementById('tournament-max-participants').value,
                scheduledTime: document.getElementById('tournament-scheduled-time').value
            };
            const errorElement = document.getElementById('create-tournament-error');
            errorElement.textContent = '';
            
            try {
                const response = await fetch(`${API_BASE_URL}/api/admin/tournaments`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-auth-token': token
                    },
                    body: JSON.stringify(formData)
                });
                const data = await response.json();
                if (response.ok) {
                    showNotification(data.message, 'success');
                    createTournamentForm.reset();
                    createTournamentModalBackdrop.classList.remove('active');
                    loadTournaments();
                    loadDashboardStats();
                } else {
                    errorElement.textContent = data.message || 'Erro ao criar campeonato.';
                }
            } catch (error) {
                console.error('Erro ao criar campeonato:', error);
                errorElement.textContent = 'Não foi possível conectar ao servidor.';
            }
        });
    }

    const tournamentsTableBody = document.querySelector('#tournaments-table tbody');
    const manageTournamentModalBackdrop = document.getElementById('manage-tournament-modal-backdrop');
    const manageTournamentModal = document.getElementById('manage-tournament-modal');

    if (tournamentsTableBody) {
        tournamentsTableBody.addEventListener('click', async (e) => {
            const target = e.target;
            const row = target.closest('tr[data-tournament-id]');
            if (!row) return;

            const tournamentId = row.dataset.tournamentId;
            const tournament = allTournaments.find(t => t._id === tournamentId);
            if (!tournament) return;
            
            if (target.classList.contains('delete-tournament-btn')) {
                if(confirm(`Tem certeza que deseja EXCLUIR o campeonato "${tournament.name}"? Isso não pode ser desfeito.`)){
                    try {
                        const response = await fetch(`${API_BASE_URL}/api/admin/tournaments/${tournamentId}`, {
                            method: 'DELETE',
                            headers: { 'x-auth-token': token }
                        });
                        const data = await response.json();
                        if (response.ok) {
                            showNotification(data.message, 'success');
                            loadTournaments();
                            loadDashboardStats();
                        } else {
                            showNotification(data.message || 'Erro ao excluir campeonato.', 'error');
                        }
                    } catch (error) {
                        console.error('Erro ao excluir campeonato:', error);
                        showNotification('Erro de conexão ao excluir campeonato.', 'error');
                    }
                }
                return; // Impede que o código de gerenciamento seja executado
            }


            if (target.classList.contains('manage-tournament-btn') || target.classList.contains('view-tournament-btn')) {
                // Preenche o modal de gerenciamento
                document.getElementById('manage-tournament-title').textContent = `Gerenciar ${tournament.name}`;
                manageTournamentModal.dataset.tournamentId = tournamentId;

                const participantsList = document.getElementById('tournament-participants-list');
                const participantsCountSpan = document.getElementById('tournament-participants-count');
                const maxParticipantsCountSpan = document.getElementById('tournament-max-participants-count');

                participantsList.innerHTML = '';
                participantsCountSpan.textContent = tournament.participants.length;
                maxParticipantsCountSpan.textContent = tournament.maxParticipants;
                
                // Mostra/esconde o botão de iniciar
                const startBtn = document.getElementById('start-tournament-btn');
                if (tournament.status === 'registration') {
                    startBtn.style.display = 'inline-block';
                    if (tournament.participants.length < 2) {
                        startBtn.disabled = true;
                        startBtn.textContent = 'Precisa de 2+ participantes';
                    } else {
                        startBtn.disabled = false;
                        startBtn.textContent = 'Iniciar Campeonato';
                    }
                } else {
                    startBtn.style.display = 'none';
                }

                if (tournament.participants && tournament.participants.length > 0) {
                    tournament.participants.forEach(p => {
                        const li = document.createElement('li');
                        li.textContent = p.username;
                        // Adiciona botão para remover participante
                        const removeBtn = document.createElement('button');
                        removeBtn.textContent = 'Remover';
                        removeBtn.className = 'cta-button remove-participant-btn';
                        removeBtn.style.backgroundColor = 'var(--loss-color)';
                        removeBtn.style.marginLeft = '10px';
                        removeBtn.dataset.userId = p._id;
                        li.appendChild(removeBtn);
                        participantsList.appendChild(li);
                    });
                } else {
                     participantsList.innerHTML = '<p class="no-challenges-message">Nenhum participante inscrito.</p>';
                }
                
                // Busca e exibe o chaveamento, se existir
                const fullTournamentDetails = await fetchAdminData(`tournament/${tournamentId}`);
                const bracketDisplay = document.getElementById('tournament-bracket-display');
                if (fullTournamentDetails && fullTournamentDetails.bracket && (fullTournamentDetails.status === 'in-progress' || fullTournamentDetails.status === 'completed')) {
                    renderBracket(fullTournamentDetails.bracket, tournamentId);
                    bracketDisplay.style.display = 'block';
                } else {
                    bracketDisplay.style.display = 'none';
                }

                manageTournamentModalBackdrop.classList.add('active');
            }
        });
    }
    
    // Eventos dentro do modal de gerenciamento
    if(manageTournamentModalBackdrop){
         const closeBtn = manageTournamentModalBackdrop.querySelector('.close-modal-btn');
         closeBtn.addEventListener('click', () => {
             manageTournamentModalBackdrop.classList.remove('active');
         });
         manageTournamentModalBackdrop.addEventListener('click', (e) => {
             if (e.target === manageTournamentModalBackdrop) manageTournamentModalBackdrop.classList.remove('active');
         });
         
         manageTournamentModalBackdrop.addEventListener('click', async (e) => {
             const target = e.target;
             const tournamentId = manageTournamentModal.dataset.tournamentId;

             if(target.classList.contains('remove-participant-btn')) {
                 const userIdToRemove = target.dataset.userId;
                 if(confirm('Tem certeza que deseja remover este participante?')) {
                     try {
                         const response = await fetch(`${API_BASE_URL}/api/admin/tournaments/${tournamentId}/remove-participant`, {
                             method: 'PATCH',
                             headers: {
                                 'Content-Type': 'application/json',
                                 'x-auth-token': token
                             },
                             body: JSON.stringify({ userId: userIdToRemove })
                         });
                         const data = await response.json();
                         if(response.ok){
                             showNotification(data.message, 'success');
                             loadTournaments();
                             const updatedTournament = allTournaments.find(t => t._id === tournamentId);
                             const userIndex = updatedTournament.participants.indexOf(userIdToRemove);
                             if(userIndex !== -1) updatedTournament.participants.splice(userIndex, 1);
                             const participantCountSpan = document.getElementById('tournament-participants-count');
                             participantCountSpan.textContent = updatedTournament.participants.length;
                             target.closest('li').remove();
                         } else {
                             showNotification(data.message || 'Erro ao remover participante.', 'error');
                         }
                     } catch(error) {
                         showNotification('Erro de conexão ao remover participante.', 'error');
                     }
                 }
             }

             if(target.id === 'start-tournament-btn'){
                 if(confirm('Tem certeza que deseja iniciar o campeonato? As inscrições serão encerradas.')){
                     try {
                         const response = await fetch(`${API_BASE_URL}/api/admin/tournaments/${tournamentId}/start`, {
                             method: 'POST',
                             headers: { 'x-auth-token': token }
                         });
                         const data = await response.json();
                         if(response.ok){
                             showNotification(data.message, 'success');
                             manageTournamentModalBackdrop.classList.remove('active');
                             loadTournaments();
                         } else {
                             showNotification(data.message || 'Erro ao iniciar campeonato.', 'error');
                         }
                     } catch(error) {
                         showNotification('Erro de conexão ao iniciar campeonato.', 'error');
                     }
                 }
             }
             
             if (target.id === 'send-message-btn') {
                 const tournament = allTournaments.find(t => t._id === tournamentId);
                 if (tournament) {
                     document.getElementById('message-tournament-name').textContent = tournament.name;
                     document.getElementById('message-tournament-id').value = tournament._id;
                     document.getElementById('message-text').value = '';
                     document.getElementById('send-message-error').textContent = '';
                     document.getElementById('send-message-modal-backdrop').classList.add('active');
                 }
             }
             
             // NOVO: Lógica para o botão de resolver match
             if (target.classList.contains('resolve-match-btn')) {
                 const matchId = target.dataset.matchId;
                 const player1Id = target.dataset.player1Id;
                 const player1Name = target.dataset.player1Name;
                 const player2Id = target.dataset.player2Id;
                 const player2Name = target.dataset.player2Name;

                 const winnerId = prompt(`Quem venceu o match? Digite o ID do vencedor:\n1 - ${player1Name} (ID: ${player1Id})\n2 - ${player2Name} (ID: ${player2Id})`);

                 if (winnerId && (winnerId === player1Id || winnerId === player2Id)) {
                     try {
                         const response = await fetch(`${API_BASE_URL}/api/admin/tournaments/${tournamentId}/resolve-match/${matchId}`, {
                             method: 'PATCH',
                             headers: {
                                 'Content-Type': 'application/json',
                                 'x-auth-token': token
                             },
                             body: JSON.stringify({ winnerId })
                         });
                         const data = await response.json();
                         if (response.ok) {
                             showNotification(data.message, 'success');
                             // Recarrega o modal para mostrar o novo chaveamento
                             const fullTournamentDetails = await fetchAdminData(`tournament/${tournamentId}`);
                             if (fullTournamentDetails) {
                                 renderBracket(fullTournamentDetails.bracket, tournamentId);
                             }
                         } else {
                             showNotification(data.message || 'Erro ao resolver match.', 'error');
                         }
                     } catch(error) {
                         showNotification('Erro de conexão ao resolver match.', 'error');
                     }
                 } else {
                     showNotification('ID do vencedor inválido ou operação cancelada.', 'error');
                 }
             }
         });
    }
    
    // Lógica para o modal de envio de mensagem
    const sendMessageModalBackdrop = document.getElementById('send-message-modal-backdrop');
    if (sendMessageModalBackdrop) {
        const closeBtn = sendMessageModalBackdrop.querySelector('.close-modal-btn');
        closeBtn.addEventListener('click', () => sendMessageModalBackdrop.classList.remove('active'));
        sendMessageModalBackdrop.addEventListener('click', (e) => {
             if (e.target === sendMessageModalBackdrop) sendMessageModalBackdrop.classList.remove('active');
         });
         
        document.getElementById('send-message-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const tournamentId = document.getElementById('message-tournament-id').value;
            const message = document.getElementById('message-text').value;
            const errorElement = document.getElementById('send-message-error');
            errorElement.textContent = '';
            
            if (!message) {
                 errorElement.textContent = 'A mensagem não pode ser vazia.';
                 return;
            }
            
            try {
                const response = await fetch(`${API_BASE_URL}/api/admin/tournaments/${tournamentId}/message-participants`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-auth-token': token
                    },
                    body: JSON.stringify({ message })
                });
                const data = await response.json();
                if(response.ok) {
                    showNotification(data.message, 'success');
                    sendMessageModalBackdrop.classList.remove('active');
                } else {
                    errorElement.textContent = data.message || 'Erro ao enviar a mensagem.';
                }
            } catch(error) {
                console.error('Erro ao enviar mensagem:', error);
                errorElement.textContent = 'Erro de conexão ao enviar a mensagem.';
            }
        });
    }

    // Inicializa o ano no rodapé
    const yearSpan = document.getElementById('currentYear');
    if (yearSpan) { yearSpan.textContent = new Date().getFullYear(); }
});