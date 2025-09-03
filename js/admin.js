// arquivo: site_de_jogos/js/admin.js

// NOVO: Importa showNotification e API_BASE_URL de utils.js
import { showNotification, API_BASE_URL } from './utils.js'; // cite: 1

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token'); // cite: 1
    const userRole = localStorage.getItem('userRole'); // Pega a role do localStorage

    // --- VERIFICAÇÃO DE ADMIN ---
    if (!token || userRole !== 'admin') { // cite: 1
        showNotification('Acesso negado. Você não tem permissão de administrador.', 'error'); // cite: 1
        setTimeout(() => {
            window.location.href = 'login-split-form.html'; // ALTERADO
        }, 1500);
        return;
    }

    // --- SOCKET.IO para atualização de usuários online (apenas a contagem) ---
    if (typeof io !== 'undefined') {
        const socket = io(API_BASE_URL); // ATUALIZADO: Usando API_BASE_URL

        socket.on('connect', () => { // cite: 1
            console.log('Admin Frontend: Conectado ao Socket.IO.'); // cite: 1
            // O admin também precisa se identificar para a contagem de onlineUsers
            const adminUserId = localStorage.getItem('userId'); // cite: 1
            const adminUsername = localStorage.getItem('username'); // cite: 1
            if (adminUserId && adminUsername) {
                 socket.emit('user connected', { username: adminUsername, id: adminUserId }); // cite: 1
            }
        });

        // Adicionar um listener para o evento de reconexão do Socket.IO.
        socket.on('reconnect', () => { // cite: 1
            console.log('Admin Frontend: Socket.IO reconnected. Re-emitting user connected.'); // cite: 1
            const adminUserId = localStorage.getItem('userId'); // cite: 1
            const adminUsername = localStorage.getItem('username'); // cite: 1
            if (adminUserId && adminUsername) {
                socket.emit('user connected', { username: adminUsername, id: adminUserId }); // cite: 1
            }
        });

        socket.on('update user list', (users) => { // cite: 1
            const onlineUsersCountElement = document.getElementById('online-users-count'); // cite: 1
            if (onlineUsersCountElement) {
                // A contagem no admin deve incluir todos os usuários conectados (incluindo o próprio admin, se aplicável ao seu cálculo de "online users")
                onlineUsersCountElement.textContent = users.length; // cite: 1
            }
        });

        socket.on('error', (err) => { // cite: 1
            console.error('Admin Frontend: Erro no socket:', err); // cite: 1
            showNotification('Erro na conexão com o servidor de chat. Algumas informações podem não estar em tempo real.', 'error'); // cite: 1
        });
    } else {
        console.warn('Biblioteca Socket.IO não carregada. Contagem de usuários online pode não ser em tempo real.'); // cite: 1
    }


    // --- FUNÇÕES AUXILIARES ---
    const formatDate = (dateString) => {
        const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
        return new Date(dateString).toLocaleDateString('pt-BR', options);
    };

    const fetchAdminData = async (endpoint) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/${endpoint}`, { // ATUALIZADO: Usando API_BASE_URL
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
            showNotification(error.message, 'error'); // cite: 1
            return null;
        }
    };

    // --- CARREGAR DADOS DO DASHBOARD ---
    const loadDashboardStats = async () => {
        const stats = await fetchAdminData('dashboard-stats'); // cite: 1
        if (stats) {
            document.getElementById('total-users').textContent = stats.totalUsers; // cite: 1
            document.getElementById('total-challenges').textContent = stats.totalChallenges; // cite: 1
            document.getElementById('completed-challenges').textContent = stats.completedChallenges; // cite: 1
            document.getElementById('disputed-challenges').textContent = stats.disputedChallenges; // cite: 1
            document.getElementById('total-coins-bet').textContent = stats.totalCoinsBet.toLocaleString('pt-BR'); // cite: 1
            // online-users-count é atualizado pelo Socket.IO, mas podemos inicializar aqui se a API admin retornar
            document.getElementById('online-users-count').textContent = stats.onlineUsersCount; // cite: 1
        }
    };

    // --- CARREGAR E RENDERIZAR USUÁRIOS ---
    let allUsers = []; // Variável para armazenar todos os usuários carregados
    const loadUsers = async () => {
        const users = await fetchAdminData('users'); // cite: 1
        const usersTableBody = document.querySelector('#users-table tbody');
        if (usersTableBody) {
            usersTableBody.innerHTML = ''; // Limpa a tabela
            if (users && users.length > 0) {
                allUsers = users; // Armazena todos os usuários
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
                                <button class="toggle-active-btn cta-button toggle-active" title="${user.isActive ? 'Desativar' : 'Ativar'} Conta">${user.isActive ? '🚫' : '✅'}</button>
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
    let allChallenges = []; // Variável para armazenar todos os desafios carregados
    const loadChallenges = async () => {
        const challenges = await fetchAdminData('challenges'); // cite: 1
        const challengesTableBody = document.querySelector('#challenges-table tbody');
        if (challengesTableBody) {
            challengesTableBody.innerHTML = ''; // Limpa a tabela
            if (challenges && challenges.length > 0) {
                allChallenges = challenges; // Armazena todos os desafios
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
        loadPendingPixPayments(); // NOVO: Carrega os pagamentos Pix
        loadPendingWithdrawals(); // NOVO: Carrega as solicitações de saque
    };

    initializeAdminPage();

    // --- LÓGICA DE EVENTOS (Modals e Ações) ---

    // Logout do Admin
    const adminLogoutButton = document.getElementById('admin-logout-button');
    if (adminLogoutButton) {
        adminLogoutButton.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Botão Sair Admin clicado!'); // Adicione esta linha
            localStorage.clear();
            console.log('Local Storage limpo. Redirecionando...'); // Adicione esta linha
            showNotification('Sessão de admin encerrada.', 'info');
            window.location.href = 'login-split-form.html'; // ALTERADO
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
            const response = await fetch(`${API_BASE_URL}/api/admin/users/${userIdToEdit}/update-coins`, { // ATUALIZADO: Usando API_BASE_URL
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
                showNotification(data.message, 'success'); // cite: 1
                document.getElementById('edit-coins-modal-backdrop').classList.remove('active');
                loadUsers(); // Recarrega a tabela de usuários
                loadDashboardStats(); // Recarrega as estatísticas
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
                // Encontra o usuário específico no array allUsers para preencher os dados
                const userToEdit = allUsers.find(u => u._id === userId);
                if (userToEdit) {
                    document.getElementById('edit-coins-user-id').value = userToEdit._id;
                    document.getElementById('edit-coins-username').textContent = userToEdit.username;
                    document.getElementById('new-coins-amount').value = userToEdit.coins; // Preenche com o valor atual
                    document.getElementById('edit-coins-error').textContent = ''; // Limpa erro
                    document.getElementById('edit-coins-modal-backdrop').classList.add('active');
                }
            }

            // Botão Ativar/Desativar Conta
            if (target.classList.contains('toggle-active-btn')) {
                const isActive = row.querySelector('td:nth-child(8)').textContent === 'Sim';
                const action = isActive ? 'desativar' : 'ativar';
                if (confirm(`Tem certeza que deseja ${action} a conta deste usuário?`)) {
                    fetch(`${API_BASE_URL}/api/admin/users/${userId}/toggle-active`, { // ATUALIZADO: Usando API_BASE_URL
                        method: 'PATCH',
                        headers: {
                            'x-auth-token': token
                        }
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.message) {
                            showNotification(data.message, 'success'); // cite: 1
                            loadUsers(); // Recarrega a tabela de usuários
                        } else {
                            showNotification(data.message || 'Erro ao alterar status.', 'error'); // cite: 1
                        }
                    })
                    .catch(() => showNotification('Não foi possível conectar ao servidor.', 'error')); // cite: 1
                }
            }
        });
    }

    // Delegando eventos para a tabela de desafios
    const challengesTableBody = document.querySelector('#challenges-table tbody');
    if (challengesTableBody) {
        challengesTableBody.addEventListener('click', (e) => {
            const target = e.target;
            const row = target.closest('tr[data-challenge-id]');
            if (!row) return;

            const challengeId = row.dataset.challengeId;

            // Botão Resolver Disputa (NOVO BLOCO ADICIONADO)
            if (target.classList.contains('resolve-dispute-btn')) {
                const challenge = allChallenges.find(c => c._id === challengeId);
                if (challenge) {
                    document.getElementById('dispute-challenge-info').textContent = challenge._id.substring(0, 8);
                    document.getElementById('dispute-challenge-id').value = challenge._id;
                    document.getElementById('dispute-creator-username').textContent = challenge.createdBy.username;
                    document.getElementById('dispute-creator-id').textContent = challenge.createdBy._id;
                    document.getElementById('dispute-opponent-username').textContent = challenge.opponent.username;
                    document.getElementById('dispute-opponent-id').textContent = challenge.opponent._id;

                    const optionsHtml = `
                        <label>
                            <input type="radio" name="winner" value="${challenge.createdBy._id}"> ${challenge.createdBy.username}
                        </label><br>
                        <label>
                            <input type="radio" name="winner" value="${challenge.opponent._id}"> ${challenge.opponent.username}
                        </label><br>
                        <button type="submit" class="cta-button form-submit-btn">Confirmar Vencedor</button>
                    `;

                    document.getElementById('dispute-winner-options').innerHTML = optionsHtml;

                    document.getElementById('resolve-dispute-modal-backdrop').classList.add('active');
                }
            }

            // Botão Cancelar Desafio
            if (target.classList.contains('cancel-challenge-btn')) {
                if (confirm("Tem certeza que deseja CANCELAR este desafio?")) {
                    fetch(`${API_BASE_URL}/api/admin/challenges/${challengeId}/cancel`, { // ATUALIZADO: Usando API_BASE_URL
                        method: 'PATCH',
                        headers: {
                            'x-auth-token': token
                        }
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.message) {
                            showNotification(data.message, 'success'); // cite: 1
                            loadChallenges(); // Recarrega a tabela de desafios
                        } else {
                            showNotification(data.message || 'Erro ao cancelar desafio.', 'error'); // cite: 1
                        }
                    })
                    .catch(() => showNotification('Não foi possível conectar ao servidor.', 'error')); // cite: 1
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
                            loadPendingWithdrawals(); // Recarrega a tabela de saques
                            loadUsers(); // Recarrega a tabela de usuários para atualizar o saldo
                            loadDashboardStats(); // Recarrega as estatísticas
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
                            loadPendingPixPayments(); // Recarrega a tabela de pagamentos pendentes
                            loadUsers(); // Recarrega a tabela de usuários para atualizar o saldo
                            loadDashboardStats(); // Recarrega as estatísticas
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

    // Inicializa o ano no rodapé
    const yearSpan = document.getElementById('currentYear');
    if (yearSpan) { yearSpan.textContent = new Date().getFullYear(); }

    const savedTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
});