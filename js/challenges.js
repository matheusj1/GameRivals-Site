// arquivo: site_de_jogos/js/challenges.js

// Dependências importadas
import { showNotification, API_BASE_URL, FRONTEND_BASE_URL } from './utils.js'; // Importado API_BASE_URL e FRONTEND_BASE_URL
import { openPrivateChat } from './friends_and_chat.js'; // Importar a função de chat privado

const challengesListContainer = document.querySelector('.challenges-list');
const myChallengesListContainer = document.querySelector('.my-challenges-list');
const showMoreContainer = document.getElementById('my-challenges-show-more-container');
const showMoreBtn = document.getElementById('my-challenges-show-more-btn');
const createChallengeBtn = document.getElementById('create-challenge-btn');

// Elementos do novo modal de desafio privado
const privateChallengeModalBackdrop = document.getElementById('private-challenge-modal-backdrop');
const privateChallengeOpponentUsername = document.getElementById('private-challenge-opponent-username');
const privateChallengeOpponentId = document.getElementById('private-challenge-opponent-id');
const privateGameSelect = document.getElementById('private-game-select');
const privateConsoleSelect = document.getElementById('private-console-select');
const privateBetAmount = document.getElementById('private-bet-amount');
const privateChallengeError = document.getElementById('private-challenge-error');
const createPrivateChallengeForm = document.getElementById('create-private-challenge-form');


let allMyChallenges = [];
let challengesToShow = 3;

// NOVO: Função auxiliar para feedback visual no botão
function applyButtonFeedback(button, isSuccess) {
    if (!button) return;
    const originalText = button.textContent;
    const originalBg = button.style.backgroundColor;
    const originalColor = button.style.color;
    const originalBoxShadow = button.style.boxShadow;

    // Remove classes de animação anteriores e redefine estilos para permitir re-execução da animação
    button.classList.remove('action-success', 'action-error', 'flash-success', 'flash-error');
    button.style.backgroundColor = ''; 
    button.style.color = '';
    button.style.boxShadow = '';


    if (isSuccess) {
        button.classList.add('action-success');
        button.classList.add('flash-success'); // Adiciona a classe flash do base.css
        button.textContent = '✔️';
    } else {
        button.classList.add('action-error');
        button.classList.add('flash-error'); // Adiciona a classe flash do base.css
        button.textContent = '❌';
    }
    button.disabled = true; // Desabilita temporariamente

    setTimeout(() => {
        button.classList.remove('action-success', 'action-error', 'flash-success', 'flash-error');
        button.textContent = originalText;
        button.style.backgroundColor = originalBg;
        button.style.color = originalColor;
        button.style.boxShadow = originalBoxShadow;
        button.disabled = false; // Reabilita o botão
    }, 1000); // Duração da animação + um pequeno atraso
}


export const fetchAndDisplayChallenges = async (token, userId) => {
    if (!challengesListContainer) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/challenges`, { // Atualizado
            headers: { 'x-auth-token': token }
        });
        if (!response.ok) throw new Error('Erro ao buscar desafios.');
        const challengesData = await response.json();
        challengesListContainer.innerHTML = '';
        const openChallenges = challengesData.filter(c => c.createdBy && String(c.createdBy._id) !== String(userId));
        if (openChallenges.length === 0) {
            challengesListContainer.innerHTML = '<p class="no-challenges-message">Nenhum desafio aberto no momento.</p>';
        } else {
            openChallenges.forEach(challenge => {
                const challengerUsername = challenge.createdBy ? challenge.createdBy.username : 'Usuário Deletado';
                const challengerAvatar = challenge.createdBy && challenge.createdBy.avatarUrl ? challenge.createdBy.avatarUrl : `${FRONTEND_BASE_URL}/img/avatar-placeholder.png`; // Atualizado

                let gameIconSrc = 'img/game-icon-placeholder.png';
                if (challenge.game === 'Ea Sports 24') {
                    gameIconSrc = 'img/ea24.png';
                } else if (challenge.game === 'Ea Sports 25') {
                    gameIconSrc = 'img/ea25.avif';
                } else if (challenge.game === 'Rocket League') {
                    gameIconSrc = 'img/rl.jpg';
                }

                const scheduledTimeHTML = challenge.scheduledTime ? `<p>Horário Sugerido: ${challenge.scheduledTime}</p>` : '';

                const challengeCardHTML = `
                    <div class="challenge-card" data-challenge-id="${challenge._id}">
                        <div class="game-info">
                            <img src="${gameIconSrc}" alt="${challenge.game}">
                            <div class="game-details">
                                <h3>${challenge.game}</h3>
                                <span>${challenge.console}</span>
                                ${scheduledTimeHTML}
                            </div>
                        </div>
                        <div class="challenger-info">
                            <img src="${challengerAvatar}" alt="Avatar">
                            <span>${challengerUsername}</span>
                        </div>
                        <div class="bet-info">
                            <span class="coin-icon">💰</span>
                            <span class="bet-amount">${challenge.betAmount}</span>
                        </div>
                        <button class="accept-challenge-btn">Aceitar</button>
                    </div>
                `;
                challengesListContainer.innerHTML += challengeCardHTML;
            });
        }
    } catch (error) {
        console.error('Erro ao buscar desafios:', error);
        showNotification('Não foi possível carregar os desafios.', 'error');
        challengesListContainer.innerHTML = '<p class="no-challenges-message">Não foi possível carregar os desafios.</p>';
    }
};

export const fetchAndDisplayMyChallenges = async (token, userId) => {
    if (!myChallengesListContainer) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/my-challenges`, { // Atualizado
            headers: { 'x-auth-token': token }
        });
        if (!response.ok) throw new Error('Erro ao buscar meus desafios.');
        allMyChallenges = await response.json();
        renderMyChallenges(userId);
    } catch (error) {
        console.error('Erro ao buscar meus desafios:', error);
        showNotification('Não foi possível carregar seus desafios.', 'error');
        myChallengesListContainer.innerHTML = '<p class="no-challenges-message">Você não está em nenhum desafio no momento.</p>';
    }
};

export const renderMyChallenges = (userId) => {
    if (!myChallengesListContainer) return;
    const challengesToRender = allMyChallenges.slice(0, challengesToShow);
    myChallengesListContainer.innerHTML = '';

    if (challengesToRender.length === 0) {
        myChallengesListContainer.innerHTML = '<p class="no-challenges-message">Você não está em nenhum desafio no momento.</p>';
    } else {
        challengesToRender.forEach(challenge => {
            const creatorUsername = challenge.createdBy ? challenge.createdBy.username : 'Usuário Deletado';
            const opponentUsername = challenge.opponent ? challenge.opponent.username : 'Aguardando...';
            const statusText = {
                open: 'Aberto',
                accepted: 'Em Andamento',
                completed: 'Finalizado',
                disputed: 'Em Análise',
                cancelled: 'Cancelado'
            };
            const statusClass = challenge.status;

            let outcomeClass = '';
            if (challenge.status === 'completed' && challenge.winner) {
                const winnerId = String(challenge.winner._id || challenge.winner);
                const currentUserId = String(userId);
                outcomeClass = winnerId === currentUserId ? 'win' : 'loss';
            } else if (challenge.status === 'disputed') {
                outcomeClass = 'disputed';
            }

            let actionButtonHTML = '';
            const hasUserReported = challenge.results && challenge.results.some(r => String(r.reportedBy) === String(userId));
            const otherPlayerId = challenge.opponent ? (String(challenge.createdBy._id) === String(userId) ? challenge.opponent._id : challenge.createdBy._id) : null;
            const otherPlayerUsername = challenge.opponent ? (String(challenge.createdBy._id) === String(userId) ? challenge.opponent.username : challenge.createdBy.username) : null;


            if (challenge.status === 'accepted') {
                // Adiciona o botão de chat privado
                if (otherPlayerId && otherPlayerUsername) { // Garante que oponente exista
                    actionButtonHTML += `<button class="start-private-chat-from-challenge-btn" data-opponent-id="${otherPlayerId}" data-opponent-username="${otherPlayerUsername}" title="Chat Privado">💬</button>`;
                }
                if (!hasUserReported) {
                    actionButtonHTML += '<button class="report-result-btn">Reportar Resultado</button>';
                } else {
                    actionButtonHTML += '<button class="report-result-btn" disabled>Aguardando Oponente</button>';
                }
            } else if (challenge.status === 'completed' || challenge.status === 'disputed' || challenge.status === 'cancelled') {
                actionButtonHTML = '<button class="delete-challenge-btn" title="Arquivar desafio">🗑️</button>';
            }

            let gameIconSrc = 'img/game-icon-placeholder.png';
            if (challenge.game === 'Ea Sports 24') {
                gameIconSrc = 'img/ea24.png';
            } else if (challenge.game === 'Ea Sports 25') {
                gameIconSrc = 'img/ea25.avif';
            } else if (challenge.game === 'Rocket League') {
                gameIconSrc = 'img/rl.jpg';
            }

            const scheduledTimeHTML = challenge.scheduledTime ? `<p>Horário Sugerido: ${challenge.scheduledTime}</p>` : '';

            const myChallengeCardHTML = `
                <div class="my-challenge-card ${outcomeClass}" data-challenge-id="${challenge._id}">
                    <div class="game-info">
                        <img src="${gameIconSrc}" alt="${challenge.game}">
                        <div class="game-details">
                            <h3>${challenge.game}</h3>
                            <span>${challenge.console}</span>
                            ${scheduledTimeHTML}
                        </div>
                    </div>
                    <div class="players-info">
                        <span class="username">${creatorUsername}</span>
                        <span class="vs-text">VS</span>
                        <span class="username">${opponentUsername}</span>
                    </div>
                    <div class="status-indicator status-${statusClass}">
                        ${statusText[statusClass]}
                    </div>
                    <div class="action-area">
                        ${actionButtonHTML}
                    </div>
                </div>
            `;
            myChallengesListContainer.innerHTML += myChallengeCardHTML;
        });
    }

    if (showMoreContainer) {
        showMoreContainer.style.display = allMyChallenges.length > challengesToShow ? 'block' : 'none';
    }
};

export const openPrivateChallengeModal = (opponentId, opponentUsername) => {
    if (privateChallengeModalBackdrop) {
        privateChallengeOpponentId.value = opponentId;
        privateChallengeOpponentUsername.textContent = opponentUsername;
        privateGameSelect.value = ''; // Limpa seleções anteriores
        privateConsoleSelect.value = '';
        privateBetAmount.value = 10; // Valor padrão, pode ser 0
        privateChallengeError.textContent = ''; // Limpa mensagens de erro
        privateChallengeModalBackdrop.classList.add('active');
    }
};

export const setupChallengeListeners = (token, userId, refreshDashboard, socket) => { // Receber o socket
    if (showMoreBtn) {
        showMoreBtn.addEventListener('click', () => {
            challengesToShow += 3;
            renderMyChallenges(userId);
        });
    }

    if (challengesListContainer) {
        challengesListContainer.addEventListener('click', async (e) => {
            const targetButton = e.target;
            if (targetButton.classList.contains('accept-challenge-btn')) {
                const challengeId = targetButton.closest('.challenge-card').dataset.challengeId;
                if (!challengeId) return;

                try {
                    const response = await fetch(`${API_BASE_URL}/api/challenges/${challengeId}/accept`, { // Atualizado
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', 'x-auth-token': token }
                    });
                    const data = await response.json();
                    if (!response.ok) {
                        showNotification(`Erro: ${data.message}`, 'error');
                        applyButtonFeedback(targetButton, false); // Feedback de erro
                    } else {
                        showNotification('Desafio aceito com sucesso!', 'success');
                        applyButtonFeedback(targetButton, true); // Feedback de sucesso
                        setTimeout(() => refreshDashboard(), 1000); // Atraso para a animação
                    }
                } catch (error) {
                    console.error('Erro ao aceitar desafio:', error);
                    showNotification('Não foi possível conectar ao servidor.', 'error');
                    applyButtonFeedback(targetButton, false); // Feedback de erro
                }
            }
        });
    }

    if (myChallengesListContainer) {
        myChallengesListContainer.addEventListener('click', (e) => {
            const target = e.target;
            const challengeCard = target.closest('.my-challenge-card');
            if (!challengeCard) return;

            const challengeId = challengeCard.dataset.challengeId;

            // NOVO: Lógica para o botão de chat privado
            if (target.classList.contains('start-private-chat-from-challenge-btn')) {
                const opponentId = target.dataset.opponentId;
                const opponentUsername = target.dataset.opponentUsername;
                const privateChatsContainer = document.getElementById('private-chats-container'); // Precisa ser acessível
                const chatTemplate = document.getElementById('private-chat-template'); // Precisa ser acessível

                if (opponentId && opponentUsername && privateChatsContainer && chatTemplate && socket) {
                    openPrivateChat({ id: opponentId, username: opponentUsername }, socket, userId, privateChatsContainer, chatTemplate);
                } else {
                    console.error('Erro ao abrir chat privado. Dados ou elementos ausentes.', { opponentId, opponentUsername, privateChatsContainer: !!privateChatsContainer, chatTemplate: !!chatTemplate, socket: !!socket });
                    showNotification('Não foi possível iniciar o chat. Tente novamente mais tarde.', 'error');
                }
            } else if (target.classList.contains('report-result-btn')) {
                const challenge = allMyChallenges.find(c => c._id === challengeId);
                if (challenge && challenge.createdBy && challenge.opponent) {
                    const reportModalBackdrop = document.querySelector('#report-modal-backdrop');
                    document.getElementById('report-challenge-id').value = challenge._id;
                    document.getElementById('report-match-details').textContent = `${challenge.createdBy.username} vs ${challenge.opponent.username}`;
                    const winnerSelectionDiv = reportModalBackdrop.querySelector('.winner-selection');
                    winnerSelectionDiv.innerHTML = `
                        <div class="winner-option">
                            <input type="radio" name="winner" id="winner-${challenge.createdBy._id}" value="${challenge.createdBy._id}" required>
                            <label for="winner-${challenge.createdBy._id}">${challenge.createdBy.username}</label>
                        </div>
                        <div class="winner-option">
                            <input type="radio" name="winner" id="winner-${challenge.opponent._id}" value="${challenge.opponent._id}" required>
                            <label for="winner-${challenge.opponent._id}">${challenge.opponent.username}</label>
                        </div>
                    `;
                    reportModalBackdrop.classList.add('active');
                }
            } else if (target.classList.contains('delete-challenge-btn')) {
                const targetButton = target;
                if (confirm("Tem certeza que deseja arquivar este desafio? Ele sumirá da sua lista.")) {
                    fetch(`${API_BASE_URL}/api/challenges/${challengeId}/archive`, { // Atualizado
                        method: 'PATCH',
                        headers: { 'x-auth-token': token }
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.message) {
                            showNotification(data.message, 'success');
                            applyButtonFeedback(targetButton, true); // Feedback de sucesso
                            setTimeout(() => refreshDashboard(), 1000); // Atraso para a animação
                        } else {
                            showNotification(data.message || 'Erro ao arquivar desafio.', 'error');
                            applyButtonFeedback(targetButton, false); // Feedback de erro
                        }
                    })
                    .catch(() => {
                        showNotification('Não foi possível conectar ao servidor.', 'error');
                        applyButtonFeedback(targetButton, false); // Feedback de erro
                    });
                }
            }
        });
    }

    else if (target.classList.contains('cancel-challenge-btn')) {
    const targetButton = target;
    if (confirm("Deseja realmente cancelar este desafio? Suas moedas serão devolvidas.")) {
        fetch(`${API_BASE_URL}/api/challenges/${challengeId}/cancel`, {
            method: 'PATCH',
            headers: { 'x-auth-token': token }
        })
        .then(res => res.json())
        .then(data => {
            if (data.message) {
                showNotification(data.message, 'success');
                applyButtonFeedback(targetButton, true);
                setTimeout(() => refreshDashboard(), 1000);
            } else {
                showNotification(data.message || 'Erro ao cancelar desafio.', 'error');
                applyButtonFeedback(targetButton, false);
            }
        })
        .catch(() => {
            showNotification('Não foi possível conectar ao servidor.', 'error');
            applyButtonFeedback(targetButton, false);
        });
    }
}

    const reportModalBackdrop = document.querySelector('#report-modal-backdrop');
    if (reportModalBackdrop) {
        const closeReportModalBtn = reportModalBackdrop.querySelector('.close-modal-btn');
        const reportForm = document.getElementById('report-result-form');

        const closeReportModal = () => reportModalBackdrop.classList.remove('active');

        if (closeReportModalBtn) closeReportModalBtn.addEventListener('click', closeReportModal);
        reportModalBackdrop.addEventListener('click', (e) => {
            if (e.target === reportModalBackdrop) closeReportModal();
        });

        if (reportForm) {
            reportForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const challengeId = document.getElementById('report-challenge-id').value;
                const winnerRadio = reportForm.querySelector('input[name="winner"]:checked');
                const errorElement = document.getElementById('report-error');
                errorElement.textContent = '';

                if (!winnerRadio) {
                    errorElement.textContent = 'Você precisa selecionar um vencedor.';
                    reportForm.querySelector('.winner-selection').classList.add('error'); // Adiciona classe de erro
                    return;
                } else {
                    reportForm.querySelector('.winner-selection').classList.remove('error');
                }
                const winnerId = winnerRadio.value;

                const submitButton = reportForm.querySelector('button[type="submit"]');

                try {
                    const response = await fetch(`${API_BASE_URL}/api/challenges/${challengeId}/result`, { // Atualizado
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                        body: JSON.stringify({ winnerId })
                    });
                    const data = await response.json();
                    if (!response.ok) {
                        showNotification(data.message, 'error');
                        applyButtonFeedback(submitButton, false); // Feedback de erro
                    } else {
                        showNotification(data.message, 'success');
                        applyButtonFeedback(submitButton, true); // Feedback de sucesso
                    }
                    closeReportModal();
                    refreshDashboard();
                } catch (error) {
                    console.error('Erro ao reportar resultado:', error);
                    errorElement.textContent = 'Não foi possível conectar ao servidor.';
                    applyButtonFeedback(submitButton, false); // Feedback de erro
                }
            });
        }
    }

    const createModalBackdrop = document.querySelector('#challenge-modal-backdrop');
    if (createChallengeBtn && createModalBackdrop) {
        const closeCreateModalBtn = createModalBackdrop.querySelector('.close-modal-btn');
        const createChallengeForm = document.querySelector('#create-challenge-form');

        createChallengeBtn.addEventListener('click', () => createModalBackdrop.classList.add('active'));

        const closeCreateModal = () => createModalBackdrop.classList.remove('active');
        if (closeCreateModalBtn) closeCreateModalBtn.addEventListener('click', closeCreateModal);
        createModalBackdrop.addEventListener('click', (e) => {
            if (e.target === createModalBackdrop) closeCreateModal();
        });

        if (createChallengeForm) {
            createChallengeForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const game = document.getElementById('game-select');
                const consoleValue = document.getElementById('console-select');
                const betAmount = document.getElementById('bet-amount');
                const scheduledTime = document.getElementById('scheduled-time'); // Get the scheduled time
                const errorElement = document.getElementById('challenge-error');
                errorElement.textContent = '';

                // Limpa classes de erro anteriores
                [game, consoleValue, betAmount].forEach(input => input.classList.remove('error'));


                let hasError = false;
                if (!game.value) { game.classList.add('error'); hasError = true; }
                if (!consoleValue.value) { consoleValue.classList.add('error'); hasError = true; }
                if (!betAmount.value || Number(betAmount.value) < 10) { betAmount.classList.add('error'); hasError = true; }

                if (hasError) {
                    errorElement.textContent = 'Por favor, preencha todos os campos obrigatórios e com valores válidos.';
                    return;
                }

                const submitButton = createChallengeForm.querySelector('button[type="submit"]');

                try {
                    const response = await fetch(`${API_BASE_URL}/api/challenges`, { // Atualizado
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                        body: JSON.stringify({ game: game.value, console: consoleValue.value, betAmount: Number(betAmount.value), scheduledTime: scheduledTime.value }), // Include scheduledTime
                    });
                    const data = await response.json();
                    if (!response.ok) {
                        showNotification(data.message, 'error');
                        applyButtonFeedback(submitButton, false); // Feedback de erro
                    } else {
                        showNotification('Desafio criado com sucesso!', 'success');
                        applyButtonFeedback(submitButton, true); // Feedback de sucesso
                        closeCreateModal();
                        createChallengeForm.reset();
                        refreshDashboard();
                    }
                } catch (error) {
                    console.error('Erro ao criar desafio:', error);
                    showNotification('Não foi possível conectar ao servidor.', 'error');
                    applyButtonFeedback(submitButton, false); // Feedback de erro
                }
            });
        }
    }

    // Lógica para o novo modal de desafio privado
    if (privateChallengeModalBackdrop && createPrivateChallengeForm) {
        const closePrivateChallengeModalBtn = privateChallengeModalBackdrop.querySelector('.close-modal-btn');

        const closePrivateChallengeModal = () => privateChallengeModalBackdrop.classList.remove('active');
        if (closePrivateChallengeModalBtn) closePrivateChallengeModalBtn.addEventListener('click', closePrivateChallengeModal);
        privateChallengeModalBackdrop.addEventListener('click', (e) => {
            if (e.target === privateChallengeModalBackdrop) closePrivateChallengeModal();
        });

        createPrivateChallengeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            privateChallengeError.textContent = '';

            const opponentId = privateChallengeOpponentId.value;
            const game = privateGameSelect;
            const consoleValue = privateConsoleSelect;
            const betAmount = privateBetAmount;

            // Limpa classes de erro anteriores
            [game, consoleValue, betAmount].forEach(input => input.classList.remove('error'));

            let hasError = false;
            if (!opponentId) { console.error('ID do oponente ausente'); hasError = true; }
            if (!game.value) { game.classList.add('error'); hasError = true; }
            if (!consoleValue.value) { consoleValue.classList.add('error'); hasError = true; }
            if (isNaN(Number(betAmount.value)) || Number(betAmount.value) < 0) { betAmount.classList.add('error'); hasError = true; }

            if (hasError) {
                privateChallengeError.textContent = 'Por favor, preencha todos os campos e insira um valor de aposta válido (0 para sem moedas).';
                return;
            }

            const submitButton = createPrivateChallengeForm.querySelector('button[type="submit"]');

            try {
                const response = await fetch(`${API_BASE_URL}/api/challenges/private`, { // Atualizado
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                    body: JSON.stringify({ opponentId, game: game.value, console: consoleValue.value, betAmount: Number(betAmount.value) }),
                });
                const data = await response.json();
                if (!response.ok) {
                    showNotification(data.message, 'error');
                    applyButtonFeedback(submitButton, false); // Feedback de erro
                } else {
                    showNotification('Desafio privado enviado com sucesso!', 'success');
                    applyButtonFeedback(submitButton, true); // Feedback de sucesso
                    closePrivateChallengeModal();
                    createPrivateChallengeForm.reset();
                    refreshDashboard(); // Atualiza o dashboard para mostrar o novo desafio
                }
            } catch (error) {
                console.error('Erro ao enviar desafio privado:', error);
                privateChallengeError.textContent = 'Não foi possível conectar ao servidor.';
                showNotification('Não foi possível conectar ao servidor.', 'error');
                applyButtonFeedback(submitButton, false); // Feedback de erro
            }
        });
    }
};