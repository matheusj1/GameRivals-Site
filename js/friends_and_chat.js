// arquivo: site_de_jogos/js/friends_and_chat.js

// Dependências importadas do utils.js
import { showNotification, getConsoleIconPath, API_BASE_URL, FRONTEND_BASE_URL } from './utils.js'; // Adicionado API_BASE_URL e FRONTEND_BASE_URL
// Importa a nova função para abrir o modal de desafio privado
import { openPrivateChallengeModal } from './challenges.js'; //

// Seletores de elementos DOM - declarados no nível superior do módulo para acesso por todas as funções neste arquivo
const friendsTabsContainer = document.querySelector('.friends-tabs');
const friendsTabButtons = document.querySelectorAll('.friends-tab-btn');
const onlinePlayersTabContent = document.getElementById('online-players-tab');
const friendsListUl = document.querySelector('#my-friends-tab .friends-list');
const receivedFriendRequestsListUl = document.querySelector('#friend-requests-tab .friend-requests-list');
const sentFriendRequestsListUl = document.querySelector('#friend-requests-tab .sent-friend-requests-list');
const searchResultsListUl = document.querySelector('#search-friends-tab .search-results-list');
const blockedUsersListUl = document.querySelector('#blocked-users-tab .blocked-users-list');

const playerCountSpan = document.getElementById('player-count');
const friendsCountSpan = document.getElementById('friends-count');
const friendRequestsCountSpan = document.getElementById('friend-requests-count');

const friendSearchInput = document.getElementById('friend-search-input');
const friendSearchBtn = document.getElementById('friend-search-btn');
const friendSearchError = document.getElementById('friend-search-error');

const universalChatForm = document.querySelector('.chat-container .chat-input-area');
const universalChatInput = universalChatForm ? universalChatForm.querySelector('input[type="text"]') : null;
const universalChatMessages = document.querySelector('.chat-container .chat-messages');
const universalEmojiToggleBtn = universalChatForm ? universalChatForm.querySelector('.emoji-toggle-btn') : null;
const universalEmojiPalette = document.getElementById('universal-emoji-palette');

const otherUserProfileModalTemplate = document.getElementById('other-user-profile-modal-template');


// Variáveis que precisam ser acessíveis por todas as funções neste módulo
let otherUserProfileModalBackdrop;
let otherUserProfileModal;
let sendFriendRequestFromModalBtn;
let startPrivateChatFromModalBtn;
let blockUserFromModalBtn;

let currentOnlineUsers = new Map();
let privateChatWindows = new Map(); // Mapa que armazena {userId: chatWindowElement}
let unreadPrivateMessages = 0;
const originalTitle = document.title;


// Funções utilitárias internas a este módulo
const updatePageTitle = () => {
    if (unreadPrivateMessages > 0) {
        document.title = `(${unreadPrivateMessages}) Nova(s) Mensagem(ns)! - ${originalTitle}`;
    } else {
        document.title = originalTitle;
    }
};

// NOVO: Função auxiliar para inserir username e ícone de console de forma segura (XSS Prevention)
const setUsernameAndIcon = (element, username, consoleName) => {
    const consoleIconPath = getConsoleIconPath(consoleName);
    const consoleIconHtml = consoleIconPath ? `<img src="${consoleIconPath}" alt="${consoleName}" class="console-icon">` : '';
    // 1. Define o username (texto puro)
    element.textContent = username; 
    // 2. Adiciona o HTML do ícone (que é confiável)
    element.innerHTML += consoleIconHtml ? ` ${consoleIconHtml}` : '';
};


const addUniversalMessageToUI = (msgObject) => {
    if (!universalChatMessages) return;
    const item = document.createElement('div');
    const isMe = msgObject.username === localStorage.getItem('username');
    item.classList.add('message', isMe ? 'sent' : 'received');
    
    // NOVO: Cria elementos para evitar innerHTML com dados de usuário
    const authorText = isMe ? 'Você' : msgObject.username;
    
    const authorSpan = document.createElement('span');
    authorSpan.classList.add('msg-author', isMe ? 'you' : '');
    authorSpan.textContent = `${authorText}:`; // Usa textContent (Seguro)

    const textP = document.createElement('p');
    textP.classList.add('msg-text');
    textP.textContent = msgObject.text; // Usa textContent (Seguro)
    
    item.appendChild(authorSpan);
    item.appendChild(textP);
    
    universalChatMessages.appendChild(item);
    universalChatMessages.scrollTop = universalChatMessages.scrollHeight;
};

// NOVO: Função auxiliar para feedback visual em botões de ação de lista
function applyButtonFeedback(button, isSuccess) {
    if (!button) return;
    const originalText = button.textContent;
    const originalBg = button.style.backgroundColor;
    const originalColor = button.style.color;
    const originalBoxShadow = button.style.boxShadow;

    if (isSuccess) {
        button.classList.add('action-success');
        button.textContent = '✔️';
    } else {
        button.classList.add('action-error');
        button.textContent = '❌';
    }
    button.disabled = true; // Desabilita temporariamente

    setTimeout(() => {
        button.classList.remove('action-success', 'action-error');
        button.textContent = originalText;
        button.style.backgroundColor = originalBg;
        button.style.color = originalColor;
        button.style.boxShadow = originalBoxShadow;
        button.disabled = false; // Reabilita o botão
    }, 1000); // Duração da animação + um pequeno atraso
}


// FIX PRINCIPAL: openPrivateChat agora retorna o elemento da janela de chat
export const openPrivateChat = (targetUser, socket, userId, privateChatsContainerElement, chatTemplateElement) => {
    if (!privateChatsContainerElement || !chatTemplateElement || !targetUser || !targetUser.id || String(targetUser.id) === String(userId)) {
        console.warn('[friends_and_chat] Tentativa de abrir chat privado inválida: Tentando abrir chat consigo mesmo ou dados incompletos ou inválidos.', targetUser, { loggedInUserId: userId, privateChatsContainerExists: !!privateChatsContainerElement, chatTemplateExists: !!chatTemplateElement });
        return null; // Retorna null em caso de falha
    }

    const chatWindowId = `chat-with-${targetUser.id}`;
    
    // 1. Tenta recuperar a janela do mapa interno
    let chatWindow = privateChatWindows.get(targetUser.id);

    if (!chatWindow) {
        // 2. Se não existir, cria a nova janela
        chatWindow = chatTemplateElement.content.cloneNode(true).firstElementChild;
        chatWindow.id = chatWindowId;
        chatWindow.dataset.recipientId = targetUser.id;
        // SEGURANÇA: Usando textContent para o nome do parceiro de chat
        chatWindow.querySelector('.chat-partner-name').textContent = targetUser.username;

        // 3. Adiciona ao mapa interno
        privateChatWindows.set(targetUser.id, chatWindow);

        // 4. Configura listeners e formulário
        chatWindow.querySelector('.close-private-chat').addEventListener('click', () => {
            chatWindow.remove();
            privateChatWindows.delete(targetUser.id);
        });

        const privateChatInput = chatWindow.querySelector('input[type="text"]');
        const privateEmojiToggleBtn = chatWindow.querySelector('.emoji-toggle-btn');
        const privateEmojiPalette = chatWindow.querySelector('.emoji-palette');

        // Botão de desafiar amigo (se existir o template)
        const challengeFriendFromChatBtn = chatWindow.querySelector('.challenge-friend-from-chat-btn');
        if (challengeFriendFromChatBtn) {
            challengeFriendFromChatBtn.addEventListener('click', () => {
                openPrivateChallengeModal(targetUser.id, targetUser.username);
            });
        }


        chatWindow.querySelector('form').addEventListener('submit', (e) => {
            e.preventDefault();
            if (privateChatInput.value.trim()) {
                // A mensagem é enviada ao servidor, que a retransmite (emitindo 'private message') para o destinatário E o remetente (o que fará com que o listener abaixo a renderize).
                socket.emit('private message', {
                    text: privateChatInput.value.trim(),
                    toUserId: targetUser.id
                });
                privateChatInput.value = '';
                if (privateEmojiPalette) privateEmojiPalette.classList.remove('active');
            }
        });

        if (privateEmojiToggleBtn && privateEmojiPalette) {
            privateEmojiToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                privateEmojiPalette.classList.toggle('active');
            });

            privateEmojiPalette.addEventListener('click', (e) => {
                if (e.target.tagName === 'SPAN') {
                    const emoji = e.target.textContent;
                    const start = privateChatInput.selectionStart;
                    const end = privateChatInput.selectionEnd;
                    privateChatInput.value = privateChatInput.value.substring(0, start) + emoji + privateChatInput.value.substring(end);
                    privateChatInput.focus();
                    privateChatInput.selectionEnd = start + emoji.length;
                    privateEmojiPalette.classList.remove('active');
                }
            });

            document.addEventListener('click', (e) => {
                if (privateEmojiPalette && privateEmojiPalette.classList.contains('active') && !privateEmojiPalette.contains(e.target) && e.target !== privateEmojiToggleBtn) {
                    privateEmojiPalette.classList.remove('active');
                }
            });
        }

        // 5. Adiciona a janela ao DOM
        privateChatsContainerElement.appendChild(chatWindow);
        chatWindow.classList.add('active'); // Aplica a classe 'active' imediatamente

    } // Fim do bloco if (!chatWindow)

    // Garante que chatWindow é válido antes de interagir com seus elementos
    if (chatWindow) {
        chatWindow.querySelector('input').focus();
        chatWindow.querySelector('.private-chat-messages').scrollTop = chatWindow.querySelector('.private-chat-messages').scrollHeight;
    }
    
    return chatWindow; // Retorna a janela criada ou encontrada
};


// Funções de carregamento e exibição que serão exportadas
export const fetchAndDisplayFriends = async (token) => {
    if (!friendsListUl) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/friends`, { // Atualizado
            headers: { 'x-auth-token': token }
        });
        if (!response.ok) throw new Error('Erro ao buscar lista de amigos.');
        const friends = await response.json();
        friendsListUl.innerHTML = '';
        friendsCountSpan.textContent = friends.length;

        const currentUserId = localStorage.getItem('userId');

        if (friends.length === 0) {
            friendsListUl.innerHTML = '<p class="no-challenges-message">Você não tem amigos adicionados. Que tal adicionar alguém?</p>';
        } else {
            const friendItemTemplate = document.getElementById('friend-list-item-template');
            friends.forEach(friend => {
                if (String(friend._id) === String(currentUserId)) {
                    return;
                }
                if (!friend.username) {
                    console.warn(`[friends_and_chat] Amigo sem nome de usuário ao renderizar:`, friend);
                    return;
                }

                const friendItem = friendItemTemplate.content.cloneNode(true).firstElementChild;
                if (friend._id) {
                    friendItem.dataset.friendId = friend._id;
                    friendItem.dataset.friendUsername = friend.username;
                } else {
                    console.warn(`[friends_and_chat] Amigo sem ID ao renderizar: ${friend.username}`);
                    return;
                }
                
                const initial = friend.username.charAt(0).toUpperCase();
                friendItem.querySelector('.app-list-item-initial-text').textContent = initial;

                // SEGURANÇA: Usando a função auxiliar para setar o username e ícone de forma segura
                setUsernameAndIcon(friendItem.querySelector('.app-list-item-username'), friend.username, friend.console);

                friendItem.querySelector('.app-list-item-sub-info.console-name').textContent = friend.console || '';

                const onlineStatusTextSpan = friendItem.querySelector('.app-list-item-sub-info.online-status');
                if (currentOnlineUsers.has(String(friend._id))) {
                    friendItem.classList.add('is-online');
                    friendItem.classList.remove('is-offline');
                    onlineStatusTextSpan.textContent = 'Online';
                    onlineStatusTextSpan.classList.add('online');
                    onlineStatusTextSpan.classList.remove('offline');
                } else {
                    friendItem.classList.add('is-offline');
                    friendItem.classList.remove('is-online');
                    onlineStatusTextSpan.textContent = 'Offline';
                    onlineStatusTextSpan.classList.add('offline');
                    onlineStatusTextSpan.classList.remove('online');
                }

                friendsListUl.appendChild(friendItem);
            });
        }
    } catch (error) {
        console.error('[friends_and_chat] Erro ao buscar amigos:', error);
        friendsListUl.innerHTML = '<p class="no-challenges-message">Não foi possível carregar seus amigos.</p>';
    }
};

export const fetchAndDisplayFriendRequests = async (token) => {
    if (!receivedFriendRequestsListUl) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/friends/requests/received`, { // Atualizado
            headers: { 'x-auth-token': token }
        });
        if (!response.ok) throw new Error('Erro ao buscar solicitações de amizade recebidas.');
        const requests = await response.json();
        receivedFriendRequestsListUl.innerHTML = '';

        if (requests.length === 0) {
            receivedFriendRequestsListUl.innerHTML = '<p class="no-challenges-message">Nenhuma solicitação de amizade pendente.</p>';
        } else {
            const requestItemTemplate = document.getElementById('received-friend-request-template');
            requests.forEach(request => {
                if (!request.requestId || !request.senderId) {
                    console.warn(`[friends_and_chat] Solicitação recebida sem ID ou senderId ao renderizar:`, request);
                    return;
                }
                if (!request.senderUsername) {
                    console.warn(`[friends_and_chat] Solicitação recebida sem nome de usuário ao renderizar:`, request);
                    return;
                }

                const requestItem = requestItemTemplate.content.cloneNode(true).firstElementChild;
                requestItem.dataset.requestId = request.requestId;
                requestItem.dataset.senderId = request.senderId;

                const initial = request.senderUsername.charAt(0).toUpperCase();
                requestItem.querySelector('.app-list-item-initial-text').textContent = initial;

                // SEGURANÇA: Inserindo o texto "Solicitação De" e o nome do usuário de forma segura
                const usernameElement = requestItem.querySelector('.app-list-item-username');
                usernameElement.textContent = `Solicitação De ${request.senderUsername}`;
                setUsernameAndIcon(usernameElement, usernameElement.textContent, request.senderConsole); // Re-seta para adicionar o ícone

                requestItem.querySelector('.app-list-item-sub-info.console-name').textContent = request.senderConsole || '';
                receivedFriendRequestsListUl.appendChild(requestItem);
            });
        }
    }
    catch (error) {
        console.error('[friends_and_chat] Erro ao buscar solicitações de amizade recebidas:', error);
        receivedFriendRequestsListUl.innerHTML = '<p class="no-challenges-message">Não foi possível carregar solicitações de amizade.</p>';
    }
};

export const fetchAndDisplaySentFriendRequests = async (token) => {
    if (!sentFriendRequestsListUl) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/friends/requests/sent`, { // Atualizado
            headers: { 'x-auth-token': token }
        });
        if (!response.ok) throw new Error('Erro ao buscar solicitações de amizade enviadas.');
        const invites = await response.json();
        sentFriendRequestsListUl.innerHTML = '';

        if (invites.length === 0) {
            sentFriendRequestsListUl.innerHTML = '<p class="no-challenges-message">Nenhuma solicitação de amizade enviada.</p>';
        } else {
            const sentRequestItemTemplate = document.getElementById('sent-friend-request-template');
            invites.forEach(invite => {
                if (!invite.requestId || !invite.receiverId) {
                    console.warn(`[friends_and_chat] Solicitação enviada sem ID ou receiverId ao renderizar:`, invite);
                    return;
                }
                if (!invite.receiverUsername) {
                    console.warn(`[friends_and_chat] Solicitação enviada sem nome de usuário ao renderizar:`, invite);
                    return;
                }

                const requestItem = sentRequestItemTemplate.content.cloneNode(true).firstElementChild;
                requestItem.dataset.requestId = invite.requestId;
                requestItem.dataset.receiverId = invite.receiverId;

                const initial = invite.receiverUsername.charAt(0).toUpperCase();
                requestItem.querySelector('.app-list-item-initial-text').textContent = initial;

                // SEGURANÇA: Inserindo o texto "Enviado Para" e o nome do usuário de forma segura
                const usernameElement = requestItem.querySelector('.app-list-item-username');
                usernameElement.textContent = `Enviado Para ${invite.receiverUsername}`;
                setUsernameAndIcon(usernameElement, usernameElement.textContent, invite.receiverConsole); // Re-seta para adicionar o ícone

                requestItem.querySelector('.app-list-item-sub-info.console-name').textContent = invite.receiverConsole || '';
                sentFriendRequestsListUl.appendChild(requestItem);
            });
        }
    } catch (error) {
        console.error('[friends_and_chat] Erro ao buscar solicitações de amizade enviadas:', error);
        sentFriendRequestsListUl.innerHTML = '<p class="no-challenges-message">Não foi possível carregar suas solicitações enviadas.</p>';
    }
};

export const fetchAndDisplayBlockedUsers = async (token) => {
    if (!blockedUsersListUl) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/users/me/blocked`, { // Atualizado
            headers: { 'x-auth-token': token }
        });
        if (!response.ok) throw new Error('Erro ao buscar usuários bloqueados.');
        const blockedUsers = await response.json();
        blockedUsersListUl.innerHTML = '';

        if (blockedUsers.length === 0) {
            blockedUsersListUl.innerHTML = '<p class="no-challenges-message">Você não tem usuários bloqueados.</p>';
        } else {
            const blockedUserItemTemplate = document.getElementById('blocked-user-item-template');
            blockedUsers.forEach(user => {
                if (!user._id) {
                    console.warn(`[friends_and_chat] Usuário bloqueado sem ID ao renderizar:`, user);
                    return;
                }
                if (!user.username) {
                    console.warn(`[friends_and_chat] Usuário bloqueado sem nome de usuário ao renderizar:`, user);
                    return;
                }

                const blockedItem = blockedUserItemTemplate.content.cloneNode(true).firstElementChild;
                blockedItem.dataset.id = user._id;
                blockedItem.dataset.username = user.username;

                const initial = user.username.charAt(0).toUpperCase();
                blockedItem.querySelector('.app-list-item-initial-text').textContent = initial;

                // SEGURANÇA: Usando a função auxiliar para setar o username e ícone de console de forma segura
                setUsernameAndIcon(blockedItem.querySelector('.app-list-item-username'), user.username, user.console);

                blockedItem.querySelector('.app-list-item-sub-info.console-name').textContent = user.console || '';
                blockedUsersListUl.appendChild(blockedItem);
            });
        }
    } catch (error) {
        console.error('[friends_and_chat] Erro ao buscar usuários bloqueados:', error);
        blockedUsersListUl.innerHTML = '<p class="no-challenges-message">Não foi possível carregar usuários bloqueados.</p>';
    }
};


export const refreshFriendsAndRequests = async (token) => {
    await fetchAndDisplayFriends(token);
    await fetchAndDisplayFriendRequests(token);
    await fetchAndDisplaySentFriendRequests(token);
    await fetchAndDisplayBlockedUsers(token); // Atualiza a lista de bloqueados também

    const receivedCount = receivedFriendRequestsListUl.querySelectorAll('li:not(.no-challenges-message)').length;
    const sentCount = sentFriendRequestsListUl.querySelectorAll('li:not(.no-challenges-message)').length;
    friendRequestsCountSpan.textContent = receivedCount + sentCount;
};


let socket;

export const initFriendsAndChat = (socketInstance, token, userId, refreshDashboardCallback) => {
    socket = socketInstance;
    const privateChatsContainer = document.getElementById('private-chats-container');
    const chatTemplate = document.getElementById('private-chat-template');

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            unreadPrivateMessages = 0;
            updatePageTitle();
        }
    });

    if (onlinePlayersTabContent) {
        const playerListUl = onlinePlayersTabContent.querySelector('.player-list');

        socket.on('update user list', (users) => {
            if (!playerListUl || !playerCountSpan) return;

            currentOnlineUsers.clear();
            users.forEach(user => currentOnlineUsers.set(user.id, user));

            const otherUsers = users.filter(user => String(user.id) !== String(userId));
            playerListUl.innerHTML = '';
            playerCountSpan.textContent = otherUsers.length;

            if (otherUsers.length === 0) {
                playerListUl.innerHTML = '<p class="no-challenges-message">Nenhum outro jogador online no momento.</p>';
            } else {
                const searchResultItemTemplate = document.getElementById('search-result-item-template');
                otherUsers.forEach(user => {
                    if (user.id && user.username) {
                        const initial = user.username.charAt(0).toUpperCase();
                        const playerItem = searchResultItemTemplate.content.cloneNode(true).firstElementChild;
                        playerItem.dataset.id = user.id;
                        playerItem.dataset.username = user.username;
                        playerItem.querySelector('.app-list-item-initial-text').textContent = initial;
                        
                        // SEGURANÇA: Usando a função auxiliar para setar o username e ícone de console de forma segura
                        setUsernameAndIcon(playerItem.querySelector('.app-list-item-username'), user.username, user.console);
                        
                        playerItem.querySelector('.app-list-item-sub-info.console-name').textContent = user.console || '';

                        playerListUl.appendChild(playerItem);
                    }
                });
            }
            // CORREÇÃO: Força a atualização da lista de amigos aqui para sincronizar o status online/offline
            refreshFriendsAndRequests(token);
        });
    }

    if (universalChatForm && universalChatInput && universalChatMessages) {
        universalChatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (universalChatInput.value.trim()) {
                // NOTE: The chat message text is NOT sanitized here. It should be sanitized in the backend
                // before being saved/broadcasted to prevent stored XSS.
                socket.emit('chat message', { user: localStorage.getItem('username'), text: universalChatInput.value });
                universalChatInput.value = '';
                universalEmojiPalette.classList.remove('active');
            }
        });

        if (universalEmojiToggleBtn && universalEmojiPalette) {
            universalEmojiToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                universalEmojiPalette.classList.toggle('active');
            });

            universalEmojiPalette.addEventListener('click', (e) => {
                if (e.target.tagName === 'SPAN') {
                    const emoji = e.target.textContent;
                    const start = universalChatInput.selectionStart;
                    const end = universalChatInput.selectionEnd;
                    universalChatInput.value = universalChatInput.value.substring(0, start) + emoji + universalChatInput.value.substring(end);
                    universalChatInput.focus();
                    universalChatInput.selectionEnd = start + emoji.length;
                    universalEmojiPalette.classList.remove('active');
                }
            });

            document.addEventListener('click', (e) => {
                if (universalEmojiPalette && universalEmojiPalette.classList.contains('active') && !universalEmojiPalette.contains(e.target) && e.target !== universalEmojiToggleBtn) {
                    universalEmojiPalette.classList.remove('active');
                }
            });
        }
    }

    socket.on('init messages', (messages) => {
        if (!universalChatMessages) return;
        universalChatMessages.innerHTML = '';
        messages.forEach(msg => addUniversalMessageToUI(msg));
        universalChatMessages.scrollTop = universalChatMessages.scrollHeight;
    });

    socket.on('chat message', (msgObject) => {
        addUniversalMessageToUI(msgObject);
    });

    if (otherUserProfileModalTemplate && !otherUserProfileModalBackdrop) {
        otherUserProfileModalBackdrop = otherUserProfileModalTemplate.content.cloneNode(true).firstElementChild;
        otherUserProfileModal = otherUserProfileModalBackdrop.querySelector('.modal');
        document.body.appendChild(otherUserProfileModalBackdrop);

        otherUserProfileModal.querySelector('.close-modal-btn').addEventListener('click', () => {
            otherUserProfileModalBackdrop.classList.remove('active');
        });

        otherUserProfileModalBackdrop.addEventListener('click', (e) => {
            if (e.target === otherUserProfileModalBackdrop) {
                otherUserProfileModalBackdrop.classList.remove('active');
            }
        });

        startPrivateChatFromModalBtn = document.getElementById('start-private-chat-from-modal');
        if (startPrivateChatFromModalBtn) {
            startPrivateChatFromModalBtn.addEventListener('click', () => {
                const targetUserId = startPrivateChatFromModalBtn.dataset.userId;
                // SEGURANÇA: Lendo diretamente de textContent, que é seguro
                const targetUsername = document.getElementById('other-user-profile-username').textContent; 
                const loggedInUserId = localStorage.getItem('userId');

                otherUserProfileModalBackdrop.classList.remove('active');

                if (targetUserId && targetUsername && String(targetUserId) !== String(loggedInUserId)) {
                    openPrivateChat({ id: targetUserId, username: targetUsername }, socket, userId, privateChatsContainer, chatTemplate);
                } else {
                    console.warn('[friends_and_chat] Tentativa de abrir chat privado para o próprio usuário ou dados inválidos.');
                }
            });
        }

        sendFriendRequestFromModalBtn = document.getElementById('send-friend-request-from-modal');
        if (sendFriendRequestFromModalBtn) {
            sendFriendRequestFromModalBtn.addEventListener('click', async () => {
                const targetUserId = sendFriendRequestFromModalBtn.dataset.userId;
                if (!targetUserId) return;
                const targetButton = sendFriendRequestFromModalBtn; // O botão clicado

                try {
                    const response = await fetch(`${API_BASE_URL}/api/friends/request/${targetUserId}`, { // Atualizado
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-auth-token': token }
                    });
                    const data = await response.json();
                    if (response.ok) {
                        showNotification(data.message, 'success');
                        applyButtonFeedback(targetButton, true); // Feedback de sucesso
                        setTimeout(() => otherUserProfileModalBackdrop.classList.remove('active'), 1000); // Fechar após animação
                        refreshFriendsAndRequests(token);
                    } else {
                        showNotification(data.message || 'Erro ao enviar solicitação.', 'error');
                        applyButtonFeedback(targetButton, false); // Feedback de erro
                    }
                } catch (error) {
                    console.error('[friends_and_chat] Erro ao enviar solicitação de amizade:', error);
                    showNotification('Não foi possível conectar ao servidor.', 'error');
                    applyButtonFeedback(targetButton, false); // Feedback de erro
                }
            });
        }

        blockUserFromModalBtn = document.getElementById('block-user-from-modal');
        if (blockUserFromModalBtn) {
            blockUserFromModalBtn.addEventListener('click', async () => {
                const targetUserId = blockUserFromModalBtn.dataset.userId;
                if (!targetUserId) return;
                const targetButton = blockUserFromModalBtn; // O botão clicado

                if (confirm('Tem certeza que deseja bloquear este usuário? Você não verá mais desafios, mensagens ou solicitações dele, e ele também não verá os seus.')) {
                    try {
                        const response = await fetch(`${API_BASE_URL}/api/users/${targetUserId}/block`, { // Atualizado
                            method: 'POST',
                            headers: { 'x-auth-token': token }
                        });
                        const data = await response.json();
                        if (response.ok) {
                            showNotification(data.message, 'info');
                            applyButtonFeedback(targetButton, true); // Feedback de sucesso
                            setTimeout(() => otherUserProfileModalBackdrop.classList.remove('active'), 1000); // Fechar após animação
                            refreshFriendsAndRequests(token);
                            if (refreshDashboardCallback) refreshDashboardCallback();
                        } else {
                            showNotification(data.message || 'Erro ao bloquear usuário.', 'error');
                            applyButtonFeedback(targetButton, false); // Feedback de erro
                        }
                    } catch (error) {
                        console.error('[friends_and_chat] Erro ao bloquear usuário:', error);
                        showNotification('Não foi possível conectar ao servidor.', 'error');
                        applyButtonFeedback(targetButton, false); // Feedback de erro
                    }
                }
            });
        }
    }

    document.addEventListener('click', async (e) => {
        const loggedInUserId = localStorage.getItem('userId');

        const playerItem = e.target.closest('.app-list-item');
        if (playerItem) {
            let targetUserId;
            let targetUsername;

            // Determina o ID e Username do item clicado
            if (playerItem.dataset.id) { // Para search-result-item e blocked-user-item
                targetUserId = playerItem.dataset.id;
                targetUsername = playerItem.dataset.username;
            } else if (playerItem.dataset.friendId) { // Para friend-list-item
                targetUserId = playerItem.dataset.friendId;
                targetUsername = playerItem.dataset.friendUsername;
            } else if (playerItem.dataset.senderId) { // Para received-friend-request-item
                targetUserId = playerItem.dataset.senderId;
                // SEGURANÇA: Lendo de data-username ou obtendo de forma segura
                targetUsername = playerItem.dataset.username || playerItem.querySelector('.app-list-item-username').textContent.replace('Solicitação De ', '').trim();
            } else if (playerItem.dataset.receiverId) { // Para sent-friend-request-item
                targetUserId = playerItem.dataset.receiverId;
                 // SEGURANÇA: Lendo de data-username ou obtendo de forma segura
                targetUsername = playerItem.dataset.username || playerItem.querySelector('.app-list-item-username').textContent.replace('Enviado Para ', '').trim();
            }

            if (!targetUserId) {
                console.error('[friends_and_chat] Não foi possível obter ID do usuário para interação. Abortando. Item:', playerItem);
                return;
            }

            // Impede interação com o próprio perfil
            if (String(targetUserId) === String(loggedInUserId)) {
                console.log('[friends_and_chat] Tentativa de interagir com o próprio perfil via lista de jogadores/amigos. Ignorando.');
                return;
            }

            // Ações dos botões dentro dos itens de lista
            const targetButton = e.target;
            if (targetButton.classList.contains('view-profile-btn')) {
                try {

                    const response = await fetch(`${API_BASE_URL}/api/users/${targetUserId}`, { // Atualizado
                        headers: { 'x-auth-token': token }
                    });
                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.message || 'Erro ao carregar perfil do usuário.');
                    }
                    const userData = await response.json();

                    // SEGURANÇA: Usando textContent para inserir dados de usuário no modal
                    document.getElementById('other-user-profile-username').textContent = userData.username;
                    const initial = userData.username.charAt(0).toUpperCase();
                    document.getElementById('other-user-initial-preview').textContent = initial;

                    document.getElementById('other-user-wins').textContent = userData.wins;
                    document.getElementById('other-user-losses').textContent = userData.losses;
                    document.getElementById('other-user-bio').textContent = userData.bio || 'N/A';
                    document.getElementById('other-user-description').textContent = userData.description || 'N/A';

                    const consoleIconHtml = getConsoleIconPath(userData.console) ? `<img src="${getConsoleIconPath(userData.console)}" alt="${userData.console}" class="console-icon">` : '';
                    const otherUserConsoleIcon = document.getElementById('other-user-console-icon-profile');
                    if (otherUserConsoleIcon) {
                        if (consoleIconHtml) {
                            otherUserConsoleIcon.src = getConsoleIconPath(userData.console);
                            otherUserConsoleIcon.alt = userData.console;
                            otherUserConsoleIcon.style.display = 'inline-block';
                        } else {
                            otherUserConsoleIcon.style.display = 'none';
                        }
                    }
                    document.getElementById('other-user-console').textContent = userData.console || 'N/A';


                    // Atualiza o dataset para os botões de ação do modal
                    startPrivateChatFromModalBtn.dataset.userId = userData._id;
                    blockUserFromModalBtn.dataset.userId = userData._id;
                    sendFriendRequestFromModalBtn.dataset.userId = userData._id;

                    // Verifica o status de amizade/bloqueio para exibir os botões corretos
                    const friendsResponse = await fetch(`${API_BASE_URL}/api/friends`, { headers: { 'x-auth-token': token } }); // Atualizado
                    const friendsList = await friendsResponse.json();
                    const isFriend = friendsList.some(f => String(f._id) === String(userData._id));

                    const sentRequestsResponse = await fetch(`${API_BASE_URL}/api/friends/requests/sent`, { headers: { 'x-auth-token': token } }); // Atualizado
                    const hasSentRequest = (await sentRequestsResponse.json()).some(r => String(r.receiverId) === String(userData._id));

                    const receivedRequestsResponse = await fetch(`${API_BASE_URL}/api/friends/requests/received`, { headers: { 'x-auth-token': token } }); // Atualizado
                    const hasReceivedRequest = (await receivedRequestsResponse.json()).some(r => String(r.senderId) === String(userData._id));

                    const blockedUsersResponse = await fetch(`${API_BASE_URL}/api/users/me/blocked`, { headers: { 'x-auth-token': token } }); // Atualizado
                    const isBlocked = (await blockedUsersResponse.json()).some(b => String(b._id) === String(userData._id));

                    // Lógica para exibir/ocultar botões no modal de perfil de outro usuário
                    if (String(userData._id) === String(loggedInUserId)) {
                        sendFriendRequestFromModalBtn.style.display = 'none';
                        startPrivateChatFromModalBtn.style.display = 'none';
                        blockUserFromModalBtn.style.display = 'none';
                    } else if (isBlocked) {
                        sendFriendRequestFromModalBtn.style.display = 'none';
                        startPrivateChatFromModalBtn.style.display = 'none';
                        blockUserFromModalBtn.style.display = 'inline-block';
                        blockUserFromModalBtn.textContent = 'Desbloquear Usuário';
                        blockUserFromModalBtn.style.backgroundColor = 'var(--win-color)'; // Verde para Desbloquear
                    }
                    else if (isFriend || hasSentRequest || hasReceivedRequest) {
                        sendFriendRequestFromModalBtn.style.display = 'none';
                        startPrivateChatFromModalBtn.style.display = 'inline-block';
                        blockUserFromModalBtn.style.display = 'inline-block';
                        blockUserFromModalBtn.textContent = 'Bloquear Usuário';
                        blockUserFromModalBtn.style.backgroundColor = 'var(--loss-color)'; // Vermelho para Bloquear
                    } else {
                        sendFriendRequestFromModalBtn.style.display = 'inline-block';
                        startPrivateChatFromModalBtn.style.display = 'inline-block';
                        blockUserFromModalBtn.style.display = 'inline-block';
                        blockUserFromModalBtn.textContent = 'Bloquear Usuário';
                        blockUserFromModalBtn.style.backgroundColor = 'var(--loss-color)'; // Vermelho para Bloquear
                    }


                    otherUserProfileModalBackdrop.classList.add('active');

                } catch (error) {
                    console.error('[friends_and_chat] Erro ao buscar perfil de outro usuário:', error.message);
                    showNotification(error.message, 'error');
                }
            } else if (targetButton.classList.contains('start-chat-btn')) {
                console.log(`[friends_and_chat] Clicou em chat para user: ${targetUsername} (ID: ${targetUserId})`);
                console.log(`[friends_and_chat] Usuário logado: (ID: ${loggedInUserId})`);
                openPrivateChat({ id: targetUserId, username: targetUsername }, socket, userId, privateChatsContainer, chatTemplate);
            } else if (targetButton.classList.contains('send-friend-request-btn')) {
                try {
                    const response = await fetch(`${API_BASE_URL}/api/friends/request/${targetUserId}`, { // Atualizado
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-auth-token': token }
                    });
                    const data = await response.json();
                    if (!response.ok) {
                        showNotification(data.message || 'Erro ao enviar solicitação.', 'error');
                        applyButtonFeedback(targetButton, false);
                        throw new Error(data.message || 'Erro ao enviar solicitação.');
                    }
                    showNotification(data.message, 'success');
                    applyButtonFeedback(targetButton, true);
                    refreshFriendsAndRequests(token);
                } catch (error) {
                    console.error('[friends_and_chat] Erro ao enviar solicitação de amizade:', error.message);
                    showNotification(error.message, 'error');
                }
            }
        }

        const friendListItem = e.target.closest('.friend-list-item');
        if (friendListItem) {
            let friendId = friendListItem.dataset.friendId;
            let friendUsername = friendListItem.dataset.friendUsername;
            const loggedInUserId = localStorage.getItem('userId');

            if (!friendId) {
                console.warn('[friends_and_chat] Tentativa de interagir com friend-list-item sem ID definido. Item:', friendListItem);
                return;
            }

            if (String(friendId) === String(loggedInUserId)) {
                console.log('[friends_and_chat] Tentativa de interagir com o próprio perfil via lista de amigos. Ignorando.');
                return;
            }

            const targetButton = e.target;
            if (targetButton.classList.contains('start-private-chat-btn')) {
                console.log(`[friends_and_chat] Clicou em chat para amigo: ${friendUsername} (ID: ${friendId})`);
                console.log(`[friends_and_chat] Usuário logado: (ID: ${loggedInUserId})`);
                openPrivateChat({ id: friendId, username: friendUsername }, socket, userId, privateChatsContainer, chatTemplate);
            } else if (targetButton.classList.contains('challenge-friend-btn')) {
                openPrivateChallengeModal(friendId, friendUsername);
            } else if (targetButton.classList.contains('remove-friend-btn')) {
                if (confirm("Tem certeza que deseja remover este amigo?")) {
                    try {
                        const response = await fetch(`${API_BASE_URL}/api/friends/${friendId}`, { // Atualizado
                            method: 'DELETE',
                            headers: { 'x-auth-token': token }
                        });
                        const data = await response.json();
                        if (!response.ok) {
                            showNotification(data.message || 'Erro ao remover amigo.', 'error');
                            applyButtonFeedback(targetButton, false);
                            throw new Error(data.message || 'Erro ao remover amigo.');
                        }
                        showNotification(data.message, 'info');
                        applyButtonFeedback(targetButton, true);
                        // Adiciona a classe para animação de saída e remove o elemento após a animação
                        friendListItem.classList.add('fade-out');
                        friendListItem.addEventListener('animationend', () => {
                            friendListItem.remove();
                            refreshFriendsAndRequests(token); // Atualiza as contagens e re-renderiza as listas
                        }, { once: true });
                    } catch (error) {
                        console.error('[friends_and_chat] Erro ao remover amigo:', error.message);
                        showNotification('Não foi possível conectar ao servidor.', 'error');
                    }
                }
            }
        }

        const requestItem = e.target.closest('.friend-request-item');
        if (requestItem) {
            const requestId = requestItem.dataset.requestId;

            if (!requestId) {
                console.warn('[friends_and_chat] Tentativa de interagir com request-item sem ID definido. Item:', requestItem);
                return;
            }

            const targetButton = e.target;
            if (targetButton.classList.contains('accept-friend-request-btn')) {
                try {
                    const response = await fetch(`${API_BASE_URL}/api/friends/request/${requestId}/accept`, { // Atualizado
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', 'x-auth-token': token }
                    });
                    const data = await response.json();
                    if (!response.ok) {
                        showNotification(data.message || 'Erro ao aceitar solicitação.', 'error');
                        applyButtonFeedback(targetButton, false);
                        throw new Error(data.message || 'Erro ao aceitar solicitação.');
                    }
                    showNotification(data.message, 'success');
                    applyButtonFeedback(targetButton, true);
                    requestItem.classList.add('fade-out');
                    requestItem.addEventListener('animationend', () => {
                        requestItem.remove();
                        refreshFriendsAndRequests(token);
                    }, { once: true });
                } catch (error) {
                    console.error('[friends_and_chat] Erro ao aceitar solicitação:', error.message);
                    showNotification('Não foi possível conectar ao servidor.', 'error');
                }
            }

            if (targetButton.classList.contains('reject-friend-request-btn')) {
                try {
                    const response = await fetch(`${API_BASE_URL}/api/friends/request/${requestId}/reject`, { // Atualizado
                        method: 'PATCH',
                        headers: { 'x-auth-token': token }
                    });
                    const data = await response.json();
                    if (!response.ok) {
                        showNotification(data.message || 'Erro ao rejeitar solicitação.', 'error');
                        applyButtonFeedback(targetButton, false);
                        throw new Error(data.message || 'Erro ao rejeitar solicitação.');
                    }
                    showNotification(data.message, 'info');
                    applyButtonFeedback(targetButton, true);
                    requestItem.classList.add('fade-out');
                    requestItem.addEventListener('animationend', () => {
                        requestItem.remove();
                        refreshFriendsAndRequests(token);
                    }, { once: true });
                } catch (error) {
                    console.error('[friends_and_chat] Erro ao rejeitar solicitação:', error.message);
                    showNotification('Não foi possível conectar ao servidor.', 'error');
                }
            }

            if (targetButton.classList.contains('cancel-friend-request-btn')) {
                if (confirm("Tem certeza que deseja cancelar esta solicitação de amizade?")) {
                    try {
                        const response = await fetch(`${API_BASE_URL}/api/friends/request/${requestId}/reject`, { // Atualizado
                            method: 'PATCH',
                            headers: { 'x-auth-token': token }
                        });
                        const data = await response.json();
                        if (!response.ok) {
                            showNotification(data.message || 'Erro ao cancelar solicitação.', 'error');
                            applyButtonFeedback(targetButton, false);
                            throw new Error(data.message || 'Erro ao cancelar solicitação.');
                        }
                        showNotification('Solicitação de amizade cancelada.', 'info');
                        applyButtonFeedback(targetButton, true);
                        requestItem.classList.add('fade-out');
                        requestItem.addEventListener('animationend', () => {
                            requestItem.remove();
                            refreshFriendsAndRequests(token);
                        }, { once: true });
                    } catch (error) {
                        console.error('[friends_and_chat] Erro ao cancelar solicitação:', error.message);
                        showNotification('Não foi possível conectar ao servidor.', 'error');
                    }
                }
            }
        }

        const blockedUserItem = e.target.closest('.blocked-user-item');
        if (blockedUserItem && e.target.classList.contains('unblock-user-btn')) {
            const blockedUserId = blockedUserItem.dataset.id;
            if (!blockedUserId) {
                console.warn('[friends_and_chat] Tentativa de interagir com blocked-user-item sem ID definido. Item:', blockedUserItem);
                return;
            }
            const targetButton = e.target;

            if (confirm("Tem certeza que deseja desbloquear este usuário?")) {
                try {
                    const response = await fetch(`${API_BASE_URL}/api/users/${blockedUserId}/unblock`, { // Atualizado
                        method: 'DELETE',
                        headers: { 'x-auth-token': token }
                    });
                    const data = await response.json();
                    if (!response.ok) {
                        showNotification(data.message || 'Erro ao desbloquear usuário.', 'error');
                        applyButtonFeedback(targetButton, false);
                        throw new Error(data.message || 'Erro ao desbloquear usuário.');
                    }
                    showNotification(data.message, 'info');
                    applyButtonFeedback(targetButton, true);
                    blockedUserItem.classList.add('fade-out');
                    blockedUserItem.addEventListener('animationend', () => {
                        blockedUserItem.remove();
                        refreshFriendsAndRequests(token);
                        if (refreshDashboardCallback) refreshDashboardCallback();
                    }, { once: true });
                } catch (error) {
                    console.error('[friends_and_chat] Erro ao desbloquear usuário:', error.message);
                    showNotification('Não foi possível conectar ao servidor.', 'error');
                }
            }
        }
    });

    // FIX PRINCIPAL: Agora obtém a janela de chat de forma confiável usando openPrivateChat.
    socket.on('private message', (data) => {
        const otherUserId = String(data.from.id) === String(userId) ? data.to.id : data.from.id;
        const otherUsername = String(data.from.id) === String(userId) ? data.to.username : data.from.username;

        // Tenta obter/criar a janela de chat de forma confiável
        const chatWindow = openPrivateChat({ id: otherUserId, username: otherUsername }, socket, userId, privateChatsContainer, chatTemplate);

        if (!chatWindow) {
            console.error('[friends_and_chat] Não foi possível encontrar/abrir a janela de chat privado para o usuário e a mensagem foi descartada.', otherUsername, otherUserId);
            return;
        }

        const messagesContainer = chatWindow.querySelector('.private-chat-messages');
        const item = document.createElement('div');
        const isMe = String(data.from.id) === String(userId);
        item.classList.add('message', isMe ? 'sent' : 'received');
        
        // SEGURANÇA: Cria elementos para evitar innerHTML com dados de usuário
        const authorText = isMe ? 'Você' : data.from.username;
        
        const authorSpan = document.createElement('span');
        authorSpan.classList.add('msg-author', isMe ? 'you' : '');
        authorSpan.textContent = `${authorText}:`; // Usa textContent (Seguro)

        const textP = document.createElement('p');
        textP.classList.add('msg-text');
        textP.textContent = data.text; // Usa textContent (Seguro)
        
        item.appendChild(authorSpan);
        item.appendChild(textP);
        // FIM SEGURANÇA
        
        messagesContainer.appendChild(item);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Garante que a janela fique visível e em foco ao receber uma mensagem
        chatWindow.classList.add('active');

        if (document.hidden && !isMe) {
            const targetChatWindow = privateChatWindows.get(otherUserId);
            if (!targetChatWindow || !targetChatWindow.classList.contains('active')) {
                unreadPrivateMessages++;
                updatePageTitle();
            }
        }
    });

    socket.on('private challenge received', (data) => {
        const { challengeId, senderUsername, game, console: platform, betAmount } = data;
        const betText = betAmount > 0 ? `${betAmount} moedas` : 'sem moedas';
        showNotification(`Novo desafio de ${senderUsername} em ${game} (${platform}) ${betText}!`, 'info');
        refreshDashboardCallback();
    });

    socket.on('new friend request', (data) => {
        showNotification(`Nova solicitação de amizade de ${data.senderUsername}!`, 'info');
        refreshFriendsAndRequests(token);
    });

    socket.on('friend request accepted', (data) => {
        showNotification(`${data.user} aceitou sua solicitação de amizade!`, 'success');
        refreshFriendsAndRequests(token);
    });

    socket.on('friend request rejected', (data) => {
        showNotification(`${data.user} rejeitou sua solicitação de amizade.`, 'info');
        refreshFriendsAndRequests(token);
    });

    socket.on('friend removed', (data) => {
        showNotification(`${data.user} removeu você da lista de amigos.`, 'info');
        refreshFriendsAndRequests(token);
    });

    socket.on('friend request resolved', () => {
        refreshFriendsAndRequests(token);
    });

    if (friendsTabsContainer) {
        friendsTabsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('friends-tab-btn')) {
                friendsTabButtons.forEach(btn => btn.classList.remove('active'));
                document.querySelectorAll('.friends-tab-content').forEach(content => content.classList.remove('active'));

                e.target.classList.add('active');

                const targetTabId = e.target.dataset.tab;
                const targetTabContent = document.getElementById(targetTabId);
                if (targetTabContent) {
                    targetTabContent.classList.add('active');
                }

                if (targetTabId === 'my-friends-tab') {
                    fetchAndDisplayFriends(token);
                } else if (targetTabId === 'friend-requests-tab') {
                    fetchAndDisplayFriendRequests(token);
                    fetchAndDisplaySentFriendRequests(token);
                } else if (targetTabId === 'online-players-tab') {

                } else if (targetTabId === 'search-friends-tab') {
                    searchResultsListUl.innerHTML = '';
                    friendSearchInput.value = '';
                    friendSearchError.textContent = '';
                } else if (targetTabId === 'blocked-users-tab') {
                    fetchAndDisplayBlockedUsers(token);
                }

                else if (targetTabId === 'matchmaking-tab') {

                }
            }
        });
    }

    if (friendSearchBtn && friendSearchInput) {
        const performSearch = async () => {
            const query = friendSearchInput.value.trim();
            friendSearchError.textContent = '';
            searchResultsListUl.innerHTML = '';

            if (query.length < 3) {
                friendSearchError.textContent = 'Digite pelo menos 3 caracteres para pesquisar.';
                friendSearchInput.classList.add('error');
                return;
            } else {
                friendSearchInput.classList.remove('error');
            }

            try {
                const response = await fetch(`${API_BASE_URL}/api/search?q=${encodeURIComponent(query)}`, {
                    headers: { 'x-auth-token': token }
                });
                const data = await response.json();

                if (!response.ok) {
                    friendSearchError.textContent = data.message || 'Erro ao pesquisar usuários.';
                    friendSearchInput.classList.add('error');
                    return;
                }

                if (data.length === 0) {
                    searchResultsListUl.innerHTML = '<p class="no-challenges-message">Nenhum resultado encontrado com este nome.</p>';
                } else {
                    const searchResultItemTemplate = document.getElementById('search-result-item-template');

                    const currentUserId = localStorage.getItem('userId');

                    data.forEach(result => {
                        if (result.type === 'player') {
                            if (String(result._id) === String(currentUserId)) {
                                return;
                            }
                            if (!result._id || !result.username) {
                                console.warn(`[friends_and_chat] Usuário da pesquisa sem ID ou nome ao renderizar:`, result);
                                return;
                            }
                            const initial = result.username.charAt(0).toUpperCase();

                            const searchItem = searchResultItemTemplate.content.cloneNode(true).firstElementChild;
                            searchItem.dataset.id = result._id;
                            searchItem.dataset.username = result.username;
                            searchItem.querySelector('.app-list-item-initial-text').textContent = initial;
                            
                            // SEGURANÇA: Usando a função auxiliar para setar o username e ícone de console de forma segura
                            setUsernameAndIcon(searchItem.querySelector('.app-list-item-username'), result.username, result.console);
                            
                            searchItem.querySelector('.app-list-item-sub-info.console-name').textContent = result.console || '';

                            searchResultsListUl.appendChild(searchItem);
                        }
                    });
                }
            } catch (error) {
                console.error('[friends_and_chat] Erro na pesquisa de amigos/grupos:', error);
                friendSearchError.textContent = 'Não foi possível conectar ao servidor para pesquisar.';
                friendSearchInput.classList.add('error');
            }
        };

        friendSearchBtn.addEventListener('click', performSearch);
        friendSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performSearch();
            }
        });
    }
};