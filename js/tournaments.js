// arquivo: site_de_jogos/js/tournaments.js

import { showNotification, API_BASE_URL, FRONTEND_BASE_URL, getConsoleIconPath } from './utils.js';

const tournamentsListContainer = document.querySelector('.tournaments-list');
const noTournamentsMessage = document.getElementById('no-tournaments-message');

// NOVO: Seletores para o modal de detalhes do campeonato
const tournamentDetailsModalBackdrop = document.getElementById('tournament-details-modal-backdrop');
const tournamentDetailsName = document.getElementById('tournament-details-name');
const tournamentDetailsGame = document.getElementById('tournament-details-game');
const tournamentDetailsConsole = document.getElementById('tournament-details-console');
const tournamentDetailsBetAmount = document.getElementById('tournament-details-bet-amount');
const tournamentDetailsScheduledTime = document.getElementById('tournament-details-scheduled-time');
const tournamentDetailsParticipantsCount = document.getElementById('tournament-details-participants-count');
const tournamentDetailsMaxParticipants = document.getElementById('tournament-details-max-participants');
const tournamentDetailsParticipantsList = document.getElementById('tournament-details-participants-list');
const tournamentRegisterBtn = document.getElementById('tournament-register-btn');
const tournamentRegisterError = document.getElementById('tournament-register-error');

let allTournaments = [];

const getGameIconPath = (gameName) => {
    switch (gameName) {
        case 'Ea Sports 24': return 'img/ea24.png';
        case 'Ea Sports 25': return 'img/ea25.avif';
        case 'Rocket League': return 'img/rl.jpg';
        default: return 'img/game-icon-placeholder.png';
    }
};

export const fetchAndDisplayTournaments = async (token, userId) => {
    if (!tournamentsListContainer) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/tournaments`, {
            headers: { 'x-auth-token': token }
        });
        if (!response.ok) throw new Error('Erro ao buscar campeonatos.');
        allTournaments = await response.json();
        renderTournaments(userId);
    } catch (error) {
        console.error('Erro ao buscar campeonatos:', error);
        if (noTournamentsMessage) {
            noTournamentsMessage.textContent = 'Não foi possível carregar os campeonatos.';
            noTournamentsMessage.style.display = 'block';
        }
    }
};

const renderTournaments = (userId) => {
    if (!tournamentsListContainer) return;
    tournamentsListContainer.innerHTML = '';
    
    if (allTournaments.length === 0) {
        if (noTournamentsMessage) noTournamentsMessage.style.display = 'block';
        return;
    }
    if (noTournamentsMessage) noTournamentsMessage.style.display = 'none';

    const tournamentCardTemplate = document.getElementById('tournament-card-template');

    allTournaments.forEach(tournament => {
        const card = tournamentCardTemplate.content.cloneNode(true).firstElementChild;
        card.dataset.tournamentId = tournament._id;
        
        const isRegistered = tournament.participants.some(p => p._id === userId);
        const isFull = tournament.participants.length >= tournament.maxParticipants;
        
        const registerBtn = card.querySelector('.register-tournament-btn');
        if (tournament.status === 'registration' && !isRegistered && !isFull) {
            registerBtn.textContent = 'Detalhes';
            registerBtn.style.backgroundColor = '';
            registerBtn.style.color = '';
            registerBtn.disabled = false;
        } else if (isRegistered) {
            registerBtn.textContent = 'Inscrito ✔️';
            registerBtn.disabled = true;
            registerBtn.style.backgroundColor = 'var(--win-color)';
        } else if (isFull) {
            registerBtn.textContent = 'Lotado';
            registerBtn.disabled = true;
            registerBtn.style.backgroundColor = 'var(--text-muted)';
        } else if (tournament.status !== 'registration') {
            registerBtn.textContent = 'Em Andamento';
            registerBtn.disabled = true;
            registerBtn.style.backgroundColor = 'var(--pending-color)';
        } else {
             // Botão de detalhes
            registerBtn.textContent = 'Detalhes';
            registerBtn.style.backgroundColor = 'var(--secondary-neon)';
            registerBtn.style.color = '#fff';
            registerBtn.disabled = false;
        }
        
        // Adiciona o listener para o botão "Detalhes"
        registerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openTournamentDetailsModal(tournament._id, token, userId);
        });

        const gameIcon = card.querySelector('.game-icon-container img');
        gameIcon.src = getGameIconPath(tournament.game);
        gameIcon.alt = tournament.game;
        
        card.querySelector('.tournament-name').textContent = tournament.name;
        card.querySelector('.tournament-game').textContent = tournament.game;
        card.querySelector('.tournament-console').textContent = tournament.console;
        card.querySelector('.tournament-bet-amount').textContent = tournament.betAmount > 0 ? `${tournament.betAmount} moedas` : 'Gratuito';

        tournamentsListContainer.appendChild(card);
    });
};

const handleRegistration = async (tournamentId, token) => {
    const tournament = allTournaments.find(t => t._id === tournamentId);
    if (!tournament) return;

    if (tournament.betAmount > 0) {
        const userResponse = await fetch(`${API_BASE_URL}/api/users/me/stats`, { headers: { 'x-auth-token': token } });
        const userData = await userResponse.json();
        if (userData.coins < tournament.betAmount) {
            showNotification('Você não tem moedas suficientes para se inscrever neste campeonato.', 'error');
            return;
        }
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/tournaments/${tournamentId}/register`, {
            method: 'POST',
            headers: { 'x-auth-token': token }
        });
        const data = await response.json();
        if (response.ok) {
            showNotification(data.message, 'success');
            // Atualiza a lista localmente para refletir a inscrição
            const userId = localStorage.getItem('userId');
            tournament.participants.push({ _id: userId, username: localStorage.getItem('username') });
            renderTournaments(userId);
            return true;
        } else {
            showNotification(data.message || 'Erro ao se inscrever.', 'error');
            return false;
        }
    } catch (error) {
        console.error('Erro na inscrição:', error);
        showNotification('Não foi possível conectar ao servidor.', 'error');
        return false;
    }
};

const openTournamentDetailsModal = async (tournamentId, token, userId) => {
    if (!tournamentDetailsModalBackdrop) return;
    
    // Busca os detalhes completos do torneio, incluindo o chaveamento populado
    try {
        const response = await fetch(`${API_BASE_URL}/api/tournaments/${tournamentId}`, {
            headers: { 'x-auth-token': token }
        });
        if (!response.ok) throw new Error('Erro ao buscar detalhes do campeonato.');
        const tournament = await response.json();

        // Preenche o modal com os dados do campeonato
        tournamentDetailsName.textContent = tournament.name;
        tournamentDetailsGame.textContent = tournament.game;
        tournamentDetailsConsole.textContent = tournament.console;
        tournamentDetailsBetAmount.textContent = tournament.betAmount > 0 ? tournament.betAmount : 'Gratuito';
        tournamentDetailsScheduledTime.textContent = tournament.scheduledTime || 'Não agendado';
        tournamentDetailsParticipantsCount.textContent = tournament.participants.length;
        tournamentDetailsMaxParticipants.textContent = tournament.maxParticipants;
        
        // Limpa a lista e preenche os participantes
        tournamentDetailsParticipantsList.innerHTML = '';
        if (tournament.participants.length > 0) {
            tournament.participants.forEach(p => {
                const li = document.createElement('li');
                li.className = 'participant-item';
                const initial = p.username.charAt(0).toUpperCase();
                li.innerHTML = `
                    <div class="initial-circle">${initial}</div>
                    <span class="username">${p.username}</span>
                `;
                tournamentDetailsParticipantsList.appendChild(li);
            });
        } else {
            tournamentDetailsParticipantsList.innerHTML = '<p class="no-challenges-message">Nenhum participante inscrito.</p>';
        }

        // Configura o botão de inscrição
        const isRegistered = tournament.participants.some(p => p._id === userId);
        const isFull = tournament.participants.length >= tournament.maxParticipants;
        
        if (tournament.status === 'registration' && !isRegistered && !isFull) {
            tournamentRegisterBtn.textContent = `Inscrever-se (${tournament.betAmount} moedas)`;
            tournamentRegisterBtn.style.display = 'block';
            tournamentRegisterBtn.disabled = false;
            tournamentRegisterBtn.style.backgroundColor = 'var(--primary-neon)';
            tournamentRegisterBtn.onclick = async () => {
                const success = await handleRegistration(tournamentId, token);
                if (success) {
                    openTournamentDetailsModal(tournamentId, token, userId); // Atualiza o modal
                }
            };
        } else {
            tournamentRegisterBtn.style.display = 'none';
        }
        
        // Exibe o chaveamento se o torneio estiver em andamento ou completo
        const bracketSection = document.getElementById('tournament-details-bracket');
        const bracketContent = document.createElement('div');
        bracketContent.className = 'tournament-bracket-content';
        
        if (tournament.status === 'in-progress' || tournament.status === 'completed') {
            renderBracketForUser(tournament.bracket, bracketContent);
            bracketSection.innerHTML = `<h4>Chaveamento</h4>`;
            bracketSection.appendChild(bracketContent);
            bracketSection.style.display = 'block';
        } else {
            bracketSection.style.display = 'none';
        }

        tournamentDetailsModalBackdrop.classList.add('active');

    } catch (error) {
        console.error('Erro ao abrir modal de detalhes do campeonato:', error);
        showNotification('Não foi possível carregar os detalhes do campeonato.', 'error');
    }
};

const renderBracketForUser = (bracket, container) => {
    container.innerHTML = '';
    
    if (!bracket || bracket.length === 0) {
        container.innerHTML = '<p class="no-challenges-message">Chaveamento ainda não gerado.</p>';
        return;
    }
    
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
            
            if (match.winner) {
                matchHtml += `<p>Vencedor: <span class="winner-name">${match.winner.username}</span></p>`;
            }
            
            matchDiv.innerHTML = matchHtml;
            roundDiv.appendChild(matchDiv);
        });
        container.appendChild(roundDiv);
    }
};


export const setupTournamentListeners = (token, userId, refreshDashboard) => {
    if (tournamentDetailsModalBackdrop) {
        const closeBtn = tournamentDetailsModalBackdrop.querySelector('.close-modal-btn');
        closeBtn.addEventListener('click', () => {
            tournamentDetailsModalBackdrop.classList.remove('active');
        });
        tournamentDetailsModalBackdrop.addEventListener('click', (e) => {
            if (e.target === tournamentDetailsModalBackdrop) {
                tournamentDetailsModalBackdrop.classList.remove('active');
            }
        });
    }
    
    // NOVO: Adiciona o listener para o clique nos cards de torneio
    if (tournamentsListContainer) {
        tournamentsListContainer.addEventListener('click', (e) => {
            const tournamentCard = e.target.closest('.tournament-card');
            if (tournamentCard) {
                const tournamentId = tournamentCard.dataset.tournamentId;
                if (tournamentId) {
                    openTournamentDetailsModal(tournamentId, token, userId);
                }
            }
        });
    }
};