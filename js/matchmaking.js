// arquivo: site_de_jogos/js/matchmaking.js

// Dependências importadas
import { showNotification } from './utils.js';

const matchmakingForm = document.getElementById('matchmaking-form');
const matchmakingGameSelect = document.getElementById('matchmaking-game-select');
const matchmakingConsoleSelect = document.getElementById('matchmaking-console-select');
const matchmakingBetAmountRadios = document.querySelectorAll('input[name="matchmaking-bet"]');
const joinMatchmakingBtn = document.getElementById('join-matchmaking-btn');
const leaveMatchmakingBtn = document.getElementById('leave-matchmaking-btn');
const matchmakingStatusMessage = document.getElementById('matchmaking-status-message');
const matchmakingError = document.getElementById('matchmaking-error');
const queueCountSpans = document.querySelectorAll('.queue-count'); // Seleciona todos os spans de contagem

let isInMatchmakingQueue = false;
let foundChallengeId = null;

export const setupMatchmaking = (socket, userId, refreshDashboard) => {
    const matchFoundModalBackdrop = document.getElementById('match-found-modal-backdrop');
    const matchFoundGameSpan = document.getElementById('match-found-game');
    const matchFoundConsoleSpan = document.getElementById('match-found-console');
    const matchFoundBetSpan = document.getElementById('match-found-bet');
    const matchFoundOpponentUsernameSpan = document.getElementById('match-found-opponent-username');
    const viewMatchDetailsBtn = document.getElementById('view-match-details-btn');

    const updateMatchmakingUI = () => {
        if (isInMatchmakingQueue) {
            joinMatchmakingBtn.classList.add('matchmaking-loading-btn');
            joinMatchmakingBtn.textContent = ''; // O texto será substituído pelo spinner via CSS ::before
            joinMatchmakingBtn.disabled = true; // Desabilita o botão para evitar múltiplos cliques
            leaveMatchmakingBtn.style.display = 'block'; // Mostra o botão "Sair da Fila"
            matchmakingGameSelect.disabled = true;
            matchmakingConsoleSelect.disabled = true;
            matchmakingBetAmountRadios.forEach(radio => radio.disabled = true);
            matchmakingStatusMessage.textContent = 'Procurando oponente...';
        } else {
            joinMatchmakingBtn.classList.remove('matchmaking-loading-btn');
            joinMatchmakingBtn.textContent = 'Entrar na Fila'; // Restaura o texto original
            joinMatchmakingBtn.disabled = false; // Habilita o botão
            leaveMatchmakingBtn.style.display = 'none'; // Oculta o botão "Sair da Fila"
            matchmakingGameSelect.disabled = false;
            matchmakingConsoleSelect.disabled = false;
            matchmakingBetAmountRadios.forEach(radio => radio.disabled = false);
            matchmakingStatusMessage.textContent = '';
        }
    };

    if (matchmakingForm && joinMatchmakingBtn && leaveMatchmakingBtn && matchmakingStatusMessage) {
        matchmakingForm.addEventListener('submit', (e) => {
            e.preventDefault();
            matchmakingError.textContent = '';

            const game = matchmakingGameSelect.value;
            const consoleValue = matchmakingConsoleSelect.value;
            const selectedBetRadio = document.querySelector('input[name="matchmaking-bet"]:checked');
            let betAmount = 0;

            if (selectedBetRadio) {
                betAmount = parseInt(selectedBetRadio.value);
            }

            if (!game || !consoleValue || betAmount <= 0) {
                matchmakingError.textContent = 'Por favor, selecione um jogo, console e valor de aposta válidos.';
                return;
            }
            if (socket) {
                isInMatchmakingQueue = true; // Define o estado antes de emitir
                updateMatchmakingUI(); // Atualiza a UI para o estado de carregamento
                showNotification('Entrando na fila de espera...', 'info');

                socket.emit('join matchmaking queue', {
                    id: userId,
                    game: game,
                    console: consoleValue,
                    betAmount: Number(betAmount)
                });
            }
        });

        leaveMatchmakingBtn.addEventListener('click', () => {
            if (socket) {
                showNotification('Saindo da fila de espera...', 'info');
                socket.emit('leave matchmaking queue', { userId: userId });
                // O estado isInMatchmakingQueue será atualizado pelo socket.on('matchmaking status')
                // e updateMatchmakingUI() será chamado lá.
            }
        });

        // Event listeners para atualizar a contagem da fila ao mudar o jogo ou console
        matchmakingGameSelect.addEventListener('change', () => {
            if (socket) socket.emit('request matchmaking queue counts');
        });
        matchmakingConsoleSelect.addEventListener('change', () => {
            if (socket) socket.emit('request matchmaking queue counts');
        });

        updateMatchmakingUI(); // Inicializa o estado da UI ao carregar
    }

    if (matchFoundModalBackdrop) {
        const closeMatchFoundModalBtn = matchFoundModalBackdrop.querySelector('.close-modal-btn');

        const closeMatchFoundModal = () => matchFoundModalBackdrop.classList.remove('active');

        if (closeMatchFoundModalBtn) closeMatchFoundModalBtn.addEventListener('click', closeMatchFoundModal);
        matchFoundModalBackdrop.addEventListener('click', (e) => {
            if (e.target === matchFoundModalBackdrop) closeMatchFoundModal();
        });

        if (viewMatchDetailsBtn) {
            viewMatchDetailsBtn.addEventListener('click', () => {
                closeMatchFoundModal();
                refreshDashboard();
            });
        }
    }

    socket.on('matchmaking status', (data) => {
        isInMatchmakingQueue = data.inQueue;
        matchmakingStatusMessage.textContent = data.message;
        updateMatchmakingUI(); // Controla o estado do botão baseado no status
        if (!isInMatchmakingQueue) {
            // Desmarca todos os rádios de aposta quando sai da fila
            matchmakingBetAmountRadios.forEach(radio => radio.checked = false);
        }
    });

    socket.on('match found', (data) => {
        showNotification('Partida encontrada! Redirecionando...', 'success');
        foundChallengeId = data.challengeId;
        matchFoundGameSpan.textContent = data.game;
        matchFoundConsoleSpan.textContent = data.console;
        matchFoundBetSpan.textContent = data.betAmount;
        const opponentName = String(data.createdBy) === String(userId) ? data.opponentUsername : data.creatorUsername;
        matchFoundOpponentUsernameSpan.textContent = opponentName;

        matchFoundModalBackdrop.classList.add('active');

        isInMatchmakingQueue = false; // Define o estado como não na fila
        updateMatchmakingUI(); // Atualiza a UI para o estado normal do botão
        matchmakingForm.reset(); // Limpa o formulário de matchmaking

        refreshDashboard();
    });

    socket.on('matchmaking error', (data) => {
        showNotification(data.message, 'error');
        isInMatchmakingQueue = false; // Define o estado como não na fila
        updateMatchmakingUI(); // Atualiza a UI para o estado normal do botão
    });

    // NOVO: Listener para as contagens da fila recebidas do servidor
    socket.on('matchmaking queue counts', (counts) => {
        queueCountSpans.forEach(span => {
            const bet = span.dataset.bet; // Obtém o valor da aposta do atributo data-bet
            const game = matchmakingGameSelect.value; // Obtém o jogo selecionado
            const consoleName = matchmakingConsoleSelect.value; // Obtém o console selecionado

            let count = 0;
            // Acessa a estrutura aninhada de contagens para obter o número correto
            if (counts[game] && counts[game][consoleName] && counts[game][consoleName][bet]) {
                count = counts[game][consoleName][bet];
            }
            span.textContent = `(${count})`; // Atualiza o texto do span
        });
    });

    // Ao carregar o módulo, se o socket já estiver conectado, solicita as contagens iniciais.
    // Isso é importante caso a aba já estivesse aberta e o usuário se conecte ao servidor.
    if (socket && socket.connected) {
        socket.emit('request matchmaking queue counts');
    }
};