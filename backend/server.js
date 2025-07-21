// arquivo: backend/server.js

// backend/server.js

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const http = require('http');
const { Server } = require("socket.io");
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const User = require('./models/User');
const Challenge = require('./models/Challenge');
const Message = require('./models/Message');
const FriendRequest = require('./models/FriendRequest');
// NOVO: Importar modelo de conversa de suporte
const SupportConversation = require('./models/SupportConversation');

const auth = require('./middleware/auth');
const adminAuth = require('./middleware/adminAuth');
// NOVO: Importar middleware de suporte
const supportAuth = require('./middleware/supportAuth');


const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');


const app = express();
const server = http.createServer(app);

app.set('trust proxy', true);

// NOVO: Defina o URL do seu frontend aqui!
const frontendUrl = "https://matheusj1.github.io";
const backendRenderUrl = "https://gamerivals-site.onrender.com";


const io = new Server(server, {
    cors: {
        origin: frontendUrl, // <--- MUDADO PARA O URL DO SEU FRONTEND
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization", "x-auth-token"]
    }
});

const PORT = 3001;

// NOVO: Função de log aprimorada
const log = (level, context, message, data = {}) => {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}`;
    if (Object.keys(data).length > 0) {
        try {
            logMessage += ` - Data: ${JSON.stringify(data)}`;
        } catch (e) {
            logMessage += ` - Data: (circular structure) ${data}`;
        }
    }

    switch (level) {
        case 'info':
            console.log(logMessage);
            break;
        case 'warn':
            console.warn(logMessage);
            break;
        case 'error':
            console.error(logMessage);
            break;
        default:
            console.log(logMessage);
    }
};


app.use(cors({
    origin: frontendUrl, // <--- MUDADO PARA O URL DO SEU FRONTEND
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
}));

app.use(express.json());

const avatarsDir = path.join(__dirname, '../img/avatars');

if (!fs.existsSync(avatarsDir)){
    fs.mkdirSync(avatarsDir, { recursive: true });
    log('info', 'FS', 'Diretório de avatares criado', { path: avatarsDir });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, avatarsDir);
    },
    filename: function (req, file, cb) {
        const userId = req.user.id; // req.user é definido pelo middleware auth
        const fileExtension = path.extname(file.originalname);
        const filename = `${userId}${fileExtension}`;
        log('info', 'Multer', 'Preparando upload de avatar', { userId: userId, filename: filename });
        cb(null, filename);
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        log('warn', 'Multer', 'Tentativa de upload de arquivo não-imagem', { mimetype: file.mimetype, userId: req.user ? req.user.id : 'N/A' });
        cb(new Error('Apenas imagens são permitidas!'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

app.use('/avatars', express.static(avatarsDir));

const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });
const preferences = new Preference(client);
const payments = new Payment(client);

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        log('info', 'MongoDB', 'Conectado ao MongoDB com sucesso!');
        server.listen(PORT, () => { log('info', 'Server', `Servidor rodando na porta ${PORT}`); });
    })
    .catch((err) => { log('error', 'MongoDB', 'Erro ao conectar ao MongoDB', { error: err.message }); });

let onlineUsers = new Map();
let socketIdToUserId = new Map();
const matchmakingQueue = new Map();

const emitUpdatedUserList = () => {
    io.emit('update user list', Array.from(onlineUsers.values()));
    log('info', 'Socket.IO', 'Lista de usuários online atualizada e emitida', { onlineCount: onlineUsers.size });
};

const emitMatchmakingQueueCounts = () => {
    const queueCounts = {};
    matchmakingQueue.forEach((consoleMap, game) => {
        queueCounts[game] = {};
        consoleMap.forEach((betAmountMap, consoleName) => {
            queueCounts[game][consoleName] = {};
            betAmountMap.forEach((userMap, betAmount) => {
                queueCounts[game][consoleName][betAmount] = userMap.size;
            });
        });
    });
    io.emit('matchmaking queue counts', queueCounts);
    log('info', 'Matchmaking', 'Contagens da fila de matchmaking emitidas');
};

// NOVO: Função para emitir eventos de conversa de suporte em tempo real
const emitSupportConversationUpdate = (conversationId, eventName, data) => {
    io.to(`support_conversation_${conversationId}`).emit(eventName, data);
    log('info', 'Socket.IO Support', `Evento ${eventName} emitido para conversa`, { conversationId, data });
};


const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

io.on('connection', async (socket) => {
    log('info', 'Socket.IO', `Novo socket conectado`, { socketId: socket.id });

    emitMatchmakingQueueCounts();

    try {
        const lastMessages = await Message.find().sort({ createdAt: 1 }).limit(200);
        socket.emit('init messages', lastMessages);
        log('info', 'Socket.IO Chat', 'Histórico de chat inicial enviado', { socketId: socket.id, messageCount: lastMessages.length });
    } catch (error) {
        log('error', 'Socket.IO Chat', 'Erro ao buscar histórico do chat', { error: error.message });
    }

    socket.on('user connected', async (user) => {
        if (user && user.id && user.username) {
            const userIdString = String(user.id);
            const currentSocketId = socket.id;
            let listNeedsUpdate = false;

            // NOVO: Usar o URL do Render para o avatar placeholder
            let avatarUrl = `${backendRenderUrl}/img/avatar-placeholder.png`;
            let userConsole = '';
            // NOVO: Adicionar role do usuário na lista de online
            let userRole = 'user'; 

            try {
                const dbUser = await User.findById(userIdString).select('avatarUrl console role');
                if (dbUser) {
                    if (dbUser.avatarUrl) {
                        avatarUrl = dbUser.avatarUrl;
                    }
                    if (dbUser.console) {
                        userConsole = dbUser.console;
                    }
                    if (dbUser.role) { // NOVO: Captura o role
                        userRole = dbUser.role;
                    }
                    log('info', 'Socket.IO User', 'Dados de usuário carregados do DB', { userId: userIdString, username: user.username });
                } else {
                     log('warn', 'Socket.IO User', 'Usuário não encontrado no DB para dados iniciais', { userId: userIdString });
                }
            } catch (err) {
                log('error', 'Socket.IO User', `Erro ao buscar avatar/console para user ${userIdString}`, { error: err.message });
            }

            const existingUserEntry = onlineUsers.get(userIdString);
            if (existingUserEntry && existingUserEntry.socketId !== currentSocketId) {
                log('info', 'Socket.IO User', `Usuário reconectou com novo socket`, { username: user.username, userId: userIdString, newSocketId: currentSocketId, oldSocketId: existingUserEntry.socketId });
                socketIdToUserId.delete(existingUserEntry.socketId);
                listNeedsUpdate = true;
            } else if (!existingUserEntry) {
                log('info', 'Socket.IO User', `Novo usuário online`, { username: user.username, userId: userIdString, socketId: currentSocketId });
                listNeedsUpdate = true;
            } else {
                log('info', 'Socket.IO User', `Usuário já estava ativo com este socket`, { username: user.username, userId: userIdString, socketId: currentSocketId });
                // NOVO: Se avatar ou console ou role mudaram, atualizar lista
                if (existingUserEntry.avatarUrl !== avatarUrl || existingUserEntry.console !== userConsole || existingUserEntry.role !== userRole) {
                    listNeedsUpdate = true;
                    log('info', 'Socket.IO User', 'Dados de perfil do usuário online atualizados', { userId: userIdString });
                }
            }
            
            onlineUsers.set(userIdString, {
                id: userIdString,
                username: user.username,
                socketId: currentSocketId,
                avatarUrl: avatarUrl,
                console: userConsole,
                role: userRole // NOVO: Armazena o role
            });
            socketIdToUserId.set(currentSocketId, userIdString);

            socket.join(userIdString); // Permite enviar mensagens diretas para este usuário via seu ID

            // NOVO: Se for um usuário de suporte, faz ele entrar nas salas de todas as conversas ativas
            if (userRole === 'support') {
                try {
                    const activeSupportConversations = await SupportConversation.find({ status: { $in: ['open', 'in_progress'] } });
                    activeSupportConversations.forEach(conv => {
                        socket.join(`support_conversation_${conv._id}`);
                        log('info', 'Socket.IO Support', 'Agente de suporte entrou na sala da conversa', { agentId: userIdString, conversationId: conv._id });
                    });
                } catch (err) {
                    log('error', 'Socket.IO Support', 'Erro ao fazer agente de suporte entrar em salas de conversa', { agentId: userIdString, error: err.message });
                }
            }


            if (listNeedsUpdate) {
                emitUpdatedUserList();
            }

        } else {
            log('warn', 'Socket.IO User', 'Dados de usuário incompletos recebidos para "user connected"', { userData: user });
        }
    });

    socket.on('chat message', async (msgData) => {
        log('info', 'Socket.IO Chat', 'Mensagem de chat recebida', { socketId: socket.id, username: msgData.user, text: msgData.text });
        try {
            if (!msgData.user || !msgData.text || msgData.text.trim() === '') {
                log('warn', 'Socket.IO Chat', 'Mensagem de chat inválida (vazia ou sem usuário/texto)', { msgData: msgData });
                return;
            }
            const message = new Message({
                username: msgData.user,
                text: msgData.text
            });
            await message.save();
            io.emit('chat message', {
                username: message.username,
                text: message.text,
                createdAt: message.createdAt
            });
            log('info', 'Socket.IO Chat', 'Mensagem de chat salva e emitida com sucesso');
        } catch (error) {
            log('error', 'Socket.IO Chat', 'Erro ao salvar/emitir mensagem do chat', { error: error.message, msgData: msgData });
        }
    });

    socket.on('private message', (data) => {
        const senderUserId = socketIdToUserId.get(socket.id);
        const sender = onlineUsers.get(senderUserId);
        const recipient = onlineUsers.get(data.toUserId);

        log('info', 'Socket.IO Private Chat', 'Tentativa de enviar mensagem privada', { from: senderUserId, to: data.toUserId, textLength: data.text ? data.text.length : 0 });

        if (recipient && sender && String(recipient.id) !== String(sender.id) && data.text && data.text.trim() !== '') {
            const messageData = {
                text: data.text.trim(),
                from: { id: sender.id, username: sender.username },
                to: { id: recipient.id, username: recipient.username }
            };

            io.to(recipient.socketId).emit('private message', messageData);
            io.to(sender.socketId).emit('private message', messageData);
            log('info', 'Socket.IO Private Chat', 'Mensagem privada enviada com sucesso', { from: sender.username, to: recipient.username });
        } else {
            log('warn', 'Socket.IO Private Chat', 'Falha ao enviar mensagem privada. Destinatário não encontrado, remetente inválido, enviando para si mesmo ou mensagem vazia.', { data: data, senderExists: !!sender, recipientExists: !!recipient });
        }
    });
    
    // NOVO: Socket para mensagens de suporte
    socket.on('send support message', async (data) => {
        const senderId = socketIdToUserId.get(socket.id);
        const { conversationId, text } = data;
        log('info', 'Socket.IO Support', 'Mensagem de suporte recebida via socket', { senderId, conversationId, textLength: text.length });

        try {
            const conversation = await SupportConversation.findById(conversationId);
            if (!conversation) {
                log('warn', 'Socket.IO Support', 'Conversa de suporte não encontrada', { conversationId });
                return socket.emit('support error', { message: 'Conversa de suporte não encontrada.' });
            }

            // Verifica se o sender é participante da conversa (usuário ou agente atribuído)
            const senderUser = await User.findById(senderId);
            if (!senderUser || (String(conversation.userId) !== String(senderId) && String(conversation.supportAgentId) !== String(senderId) && senderUser.role !== 'support')) {
                log('warn', 'Socket.IO Support', 'Remetente não autorizado a enviar mensagem para esta conversa', { senderId, conversationId });
                return socket.emit('support error', { message: 'Você não pode enviar mensagens para esta conversa.' });
            }

            const newMessage = {
                sender: senderId,
                senderUsername: senderUser.username,
                text: text.trim()
            };

            conversation.messages.push(newMessage);
            conversation.updatedAt = new Date(); // Atualiza a data da última mensagem/atividade
            await conversation.save();

            // Emite a nova mensagem para todos na sala da conversa (usuário e agentes de suporte)
            io.to(`support_conversation_${conversationId}`).emit('new support message', { conversationId, message: newMessage });
            log('info', 'Socket.IO Support', 'Mensagem de suporte salva e emitida com sucesso');

        } catch (error) {
            log('error', 'Socket.IO Support', 'Erro ao processar mensagem de suporte via socket', { error: error.message, senderId, conversationId });
            socket.emit('support error', { message: 'Erro ao enviar mensagem de suporte.' });
        }
    });

    socket.on('join matchmaking queue', async (data) => {
        const userId = data.userId;
        const game = data.game;
        const platform = data.console;
        const betAmount = data.betAmount;

        log('info', 'Matchmaking', 'Tentativa de entrar na fila de matchmaking', { userId, game, platform, betAmount });

        if (!userId || !game || !platform || !betAmount) {
            socket.emit('matchmaking error', { message: 'Dados incompletos para entrar na fila.' });
            log('warn', 'Matchmaking', 'Dados incompletos para entrar na fila', { userId, game, platform, betAmount });
            return;
        }

        const user = onlineUsers.get(userId);
        if (!user) {
            socket.emit('matchmaking error', { message: 'Seu status online não foi detectado. Tente novamente.' });
            log('warn', 'Matchmaking', 'Usuário não online para entrar na fila', { userId });
            return;
        }

        // Remove o usuário de qualquer fila anterior
        let removedFromQueue = false;
        matchmakingQueue.forEach((consoleMap, gameKey) => {
            consoleMap.forEach((betAmountMap, consoleKey) => {
                betAmountMap.forEach((userMap, betKey) => { 
                    if (userMap.has(userId)) {
                        userMap.delete(userId);
                        removedFromQueue = true;
                        log('info', 'Matchmaking', 'Usuário removido de fila anterior', { userId, gameKey, consoleKey, betKey });
                    }
                });
            });
        });
        if(removedFromQueue) emitMatchmakingQueueCounts(); // Emite atualização se alguém foi removido

        let foundOpponentObject = null;

        // Busca por um oponente compatível
        if (matchmakingQueue.has(game)) {
            const consoleMap = matchmakingQueue.get(game);
            if (consoleMap.has(platform)) {
                const betAmountMap = consoleMap.get(platform);
                for (const [betKey, userMap] of betAmountMap.entries()) {
                    // Tenta encontrar um oponente com a mesma aposta ou uma aposta "compatível" se houver lógica para isso
                    if (betKey === betAmount) { // Exemplo simples: aposta exata
                        for (const [entryUserId, entry] of userMap.entries()) {
                            if (entry && String(entryUserId) !== String(userId)) {
                                foundOpponentObject = entry;
                                userMap.delete(entryUserId); // Remove o oponente da fila
                                log('info', 'Matchmaking', 'Oponente encontrado na fila', { opponentId: entryUserId, game, platform, betAmount });
                                break;
                            }
                        }
                    }
                    if (foundOpponentObject) break;
                }
            }
        }


        if (foundOpponentObject) { 
            try {
                const creatorId = String(foundOpponentObject.userId); 
                const opponentId = String(userId); 

                const newChallenge = new Challenge({
                    game: game,
                    console: platform,
                    betAmount: betAmount,
                    createdBy: creatorId, 
                    opponent: opponentId, 
                    status: 'accepted'
                });
                await newChallenge.save();

                log('info', 'Matchmaking', 'Novo desafio criado automaticamente', { challengeId: newChallenge._id, creatorId, opponentId, game, platform, betAmount });

                const challengeInfo = {
                    challengeId: newChallenge._id,
                    game: newChallenge.game,
                    console: newChallenge.console,
                    betAmount: newChallenge.betAmount,
                    createdBy: newChallenge.createdBy.toString(),
                    opponent: newChallenge.opponent.toString(),
                    creatorUsername: foundOpponentObject.username, 
                    opponentUsername: user.username,
                    status: newChallenge.status
                };

                io.to(foundOpponentObject.socketId).emit('match found', challengeInfo);
                io.to(user.socketId).emit('match found', challengeInfo);

                socket.emit('matchmaking status', { inQueue: false, message: 'Partida encontrada!' });
                if (foundOpponentObject.socketId !== user.socketId) {
                     io.to(foundOpponentObject.socketId).emit('matchmaking status', { inQueue: false, message: 'Partida encontrada!' });
                }
                log('info', 'Matchmaking', 'Evento "match found" emitido para ambos os jogadores', { challengeId: newChallenge._id });

            } catch (error) {
                log('error', 'Matchmaking', 'Erro ao criar desafio após encontrar partida', { error: error.message, foundOpponent: foundOpponentObject, currentUser: user });
                socket.emit('matchmaking error', { message: 'Erro ao criar partida. Tente novamente.' });
                if (foundOpponentObject && foundOpponentObject.socketId) io.to(foundOpponentObject.socketId).emit('matchmaking error', { message: 'Erro ao criar partida. Tente novamente.' });
            }

        } else { // Se nenhum oponente foi encontrado, adiciona o usuário atual à fila
            if (!matchmakingQueue.has(game)) {
                matchmakingQueue.set(game, new Map());
                log('info', 'Matchmaking', 'Nova fila de jogo criada', { game });
            }
            const consoleMap = matchmakingQueue.get(game);
            if (!consoleMap.has(platform)) {
                consoleMap.set(platform, new Map());
                log('info', 'Matchmaking', 'Nova fila de console criada', { game, platform });
            }
            const betAmountMap = consoleMap.get(platform);
            if (!betAmountMap.has(betAmount)) {
                betAmountMap.set(betAmount, new Map());
                log('info', 'Matchmaking', 'Nova fila de aposta criada', { game, platform, betAmount });
            }
            const userMap = betAmountMap.get(betAmount);
            userMap.set(userId, { 
                socketId: user.socketId, 
                username: user.username, 
                betAmount: betAmount, 
                userId: userId 
            });

            socket.emit('matchmaking status', { inQueue: true, game, console: platform, betAmount, message: 'Procurando partida...' });
            log('info', 'Matchmaking', 'Usuário adicionado à fila', { userId, game, platform, betAmount });
            emitMatchmakingQueueCounts();
        }
    });

    socket.on('leave matchmaking queue', (data) => {
        const userId = data.userId;
        const user = onlineUsers.get(userId);

        log('info', 'Matchmaking', 'Tentativa de sair da fila de matchmaking', { userId });

        if (!user) {
            log('warn', 'Matchmaking', 'Usuário não encontrado ao tentar sair da fila', { userId });
            return;
        }

        let removedFromQueue = false;
        matchmakingQueue.forEach((consoleMap) => {
            consoleMap.forEach((betAmountMap) => {
                betAmountMap.forEach((userMap) => {
                    if (userMap.has(userId)) {
                        userMap.delete(userId);
                        removedFromQueue = true;
                        log('info', 'Matchmaking', 'Usuário removido da fila com sucesso', { userId });
                        emitMatchmakingQueueCounts();
                    }
                });
            });
        });

        if (removedFromQueue) {
            socket.emit('matchmaking status', { inQueue: false, message: 'Você saiu da fila de espera.' });
        } else {
            socket.emit('matchmaking status', { inQueue: false, message: 'Você não estava em nenhuma fila de espera.' });
            log('info', 'Matchmaking', 'Usuário tentou sair da fila, mas não estava nela', { userId });
        }
    });

    socket.on('request matchmaking queue counts', () => {
        log('info', 'Matchmaking', 'Requisição de contagens da fila de matchmaking recebida', { socketId: socket.id });
        emitMatchmakingQueueCounts();
    });

    socket.on('disconnect', async () => {
        const userIdOnDisconnect = socketIdToUserId.get(socket.id);
        let listNeedsUpdate = false;

        log('info', 'Socket.IO', `Socket desconectado`, { socketId: socket.id, userId: userIdOnDisconnect || 'N/A' });

        if (userIdOnDisconnect) {
            const disconnectedUserEntry = onlineUsers.get(userIdOnDisconnect);

            if (disconnectedUserEntry && disconnectedUserEntry.socketId === socket.id) {
                onlineUsers.delete(userIdOnDisconnect);
                listNeedsUpdate = true;
                log('info', 'Socket.IO User', 'Usuário removido da lista de online', { userId: userIdOnDisconnect });

                // Remove de todas as filas de matchmaking
                matchmakingQueue.forEach((consoleMap) => {
                    consoleMap.forEach((betAmountMap) => {
                        betAmountMap.forEach((userMap) => {
                            if (userMap.has(userIdOnDisconnect)) {
                                userMap.delete(userIdOnDisconnect);
                                log('info', 'Matchmaking', 'Usuário desconectado removido da fila', { userId: userIdOnDisconnect });
                                emitMatchmakingQueueCounts();
                            }
                        });
                    });
                });

            } else {
                log('warn', 'Socket.IO', `Socket desconectado, mas nenhum usuário associado ou socketId não coincide`, { socketId: socket.id, userId: userIdOnDisconnect });
            }
            socketIdToUserId.delete(socket.id);
        } else {
            log('info', 'Socket.IO', `Um socket se desconectou, mas nenhum usuário associado foi encontrado`, { socketId: socket.id });
        }

        if (listNeedsUpdate) {
            emitUpdatedUserList();
            io.emit('friend request resolved'); // Sinaliza para o frontend atualizar requests de amigos
        }
    });

    socket.on('error', (err) => {
        log('error', 'Socket.IO', `Erro no socket`, { socketId: socket.id, error: err.message });
    });
});

// NOVO: Limitador de taxa para login e registro (5 requisições por 5 minutos)
const authLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutos
    max: 5, // Limita cada IP a 5 requisições por windowMs
    message: 'Muitas tentativas de login/registro a partir deste IP, por favor tente novamente após 5 minutos.',
    statusCode: 429, // Too Many Requests
    headers: true, // Adiciona cabeçalhos X-RateLimit-*
    keyGenerator: ipKeyGenerator, // Correção: Usar ipKeyGenerator para tratamento IPv6
    handler: (req, res, next) => {
        log('warn', 'RateLimit', 'Limite de autenticação excedido', { ip: req.ip, path: req.path });
        res.status(429).json({ message: 'Muitas tentativas de login/registro a partir deste IP, por favor tente novamente após 5 minutos.' });
    }
});

// NOVO: Limitador de taxa para criação de desafios e solicitações de amizade (20 requisições por 15 minutos)
const actionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 20, // Limita cada IP a 20 requisições por windowMs
    message: 'Muitas requisições deste tipo a partir do seu IP, por favor tente novamente mais tarde.',
    statusCode: 429,
    headers: true,
    keyGenerator: ipKeyGenerator, // Correção: Usar ipKeyGenerator para tratamento IPv6
    handler: (req, res, next) => {
        log('warn', 'RateLimit', 'Limite de ação excedido', { ip: req.ip, path: req.path, userId: req.user ? req.user.id : 'N/A' });
        res.status(429).json({ message: 'Muitas requisições deste tipo a partir do seu IP, por favor tente novamente mais tarde.' });
    }
});

// NOVO: Limitador de taxa para recuperação de senha (3 requisições por 1 hora)
const forgotPasswordLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 3, // Limita cada IP a 3 requisições por hora
    message: 'Muitas tentativas de recuperação de senha a partir deste IP, por favor tente novamente após 1 hora.',
    statusCode: 429,
    headers: true,
    keyGenerator: ipKeyGenerator, // Correção: Usar ipKeyGenerator para tratamento IPv6
    handler: (req, res, next) => {
        log('warn', 'RateLimit', 'Limite de recuperação de senha excedido', { ip: req.ip });
        res.status(429).json({ message: 'Muitas tentativas de recuperação de senha a partir deste IP, por favor tente novamente após 1 hora.' });
    }
});


// Aplicar limitadores de taxa às rotas
app.post('/api/register', authLimiter, async (req, res) => {
    log('info', 'API Register', 'Requisição de registro recebida', { email: req.body.email, username: req.body.username });
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            log('warn', 'API Register', 'Campos obrigatórios ausentes', { email, username });
            return res.status(400).json({ message: 'Por favor, preencha todos os campos.' });
        }
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            log('warn', 'API Register', 'E-mail ou nome de usuário já cadastrado', { email, username });
            return res.status(400).json({ message: 'E-mail ou nome de usuário já cadastrado.' });
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = new User({ username, email, password: hashedPassword, wins: 0, losses: 0, coins: 1000, role: 'user', isActive: true, profileCompleted: false });
        await newUser.save();
        log('info', 'API Register', 'Usuário registrado com sucesso', { userId: newUser._id, username: newUser.username });
        res.status(201).json({ message: 'Usuário cadastrado com sucesso!' });
    }
    catch (error) {
        log('error', 'API Register', 'Erro no cadastro', { error: error.message, body: req.body });
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

app.post('/api/login', authLimiter, async (req, res) => {
    log('info', 'API Login', 'Requisição de login recebida', { email: req.body.email });
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            log('warn', 'API Login', 'Campos obrigatórios ausentes', { email });
            return res.status(400).json({ message: 'Por favor, preencha todos os campos.' });
        }
        const user = await User.findOne({ email });
        if (!user) {
            log('warn', 'API Login', 'Credenciais inválidas - usuário não encontrado', { email });
            return res.status(400).json({ message: 'Credenciais inválidas.' });
        }
        if (!user.isActive) {
            log('warn', 'API Login', 'Tentativa de login de conta desativada', { userId: user._id, email });
            return res.status(403).json({ message: 'Sua conta está desativada. Entre em contato com o suporte.' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            log('warn', 'API Login', 'Credenciais inválidas - senha incorreta', { userId: user._id, email });
            return res.status(400).json({ message: 'Credenciais inválidas.' });
        }

        const payload = { id: user.id, username: user.username, role: user.role };
        const token = jwt.sign(payload, process.env.JWT_SECRET || 'seu_segredo_jwt_padrao', { expiresIn: '1h' });

        log('info', 'API Login', 'Login bem-sucedido', { userId: user.id, username: user.username, role: user.role });
        res.status(200).json({ message: 'Login bem-sucedido!', token: token, username: user.username, userId: user.id, userRole: user.role, profileCompleted: user.profileCompleted });
    }
    catch (error) {
        log('error', 'API Login', 'Erro no login', { error: error.message, email: req.body.email });
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

// --- Endpoint para iniciar pagamento com Mercado Pago ---
app.post('/api/payment/deposit-mp', auth, actionLimiter, async (req, res) => { // Aplicar actionLimiter
    const { amount, payment_method } = req.body;
    const userId = req.user.id;
    log('info', 'API Payment', 'Requisição de depósito Mercado Pago recebida', { userId, amount, payment_method });

    if (typeof amount !== 'number' || amount <= 0) {
        log('warn', 'API Payment', 'Valor de depósito inválido', { userId, amount });
        return res.status(400).json({ message: 'Valor de depósito inválido. Deve ser um número positivo.' });
    }
    if (!payment_method) {
        log('warn', 'API Payment', 'Método de pagamento não especificado', { userId });
        return res.status(400).json({ message: 'Método de pagamento não especificado.' });
    }

    try {
        const user = await User.findById(userId);
        if (!user) {
            log('error', 'API Payment', 'Usuário não encontrado para processar pagamento', { userId });
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        if (!user.email) {
            log('warn', 'API Payment', 'Usuário sem e-mail definido para o pagamento Mercado Pago', { userId });
            return res.status(400).json({ message: 'Seu perfil não tem um e-mail configurado para o pagamento.' });
        }

        // Use a variável do URL do frontend
        const publicBaseUrl = frontendUrl; 
        log('info', 'API Payment', 'Usando publicBaseUrl para MP', { url: publicBaseUrl });

        let preference;
        if (payment_method === 'pix') {
            preference = {
                items: [{
                    title: `Depósito de ${amount} Moedas GameRivals`,
                    quantity: 1,
                    unit_price: amount
                }],
                payer: {
                    email: user.email 
                },
                external_reference: userId, // Usado para identificar o usuário no webhook
                notification_url: `${backendRenderUrl}/api/webhooks/mercadopago`, // <--- Use o URL do Render aqui para o webhook
                back_urls: {
                    success: `${publicBaseUrl}profile.html?payment_status=success`,
                    failure: `${publicBaseUrl}profile.html?payment_status=failure`,
                    pending: `${publicBaseUrl}profile.html?payment_status=pending`
                }
                // REMOVIDO: auto_return: 'approved' - para evitar erro "auto_return invalid"
            };
        } else {
            log('warn', 'API Payment', 'Método de pagamento não suportado', { userId, payment_method });
            return res.status(400).json({ message: 'Método de pagamento não suportado no momento.' });
        }

        log('info', 'API Payment', 'Criando preferência no Mercado Pago', { preferenceBody: preference });
        const mpResponse = await preferences.create({ body: preference });
        log('info', 'API Payment', 'Resposta completa da API Mercado Pago', { response: mpResponse });

        const redirectUrl = mpResponse.sandbox_init_point || mpResponse.init_point;
        if (!redirectUrl) {
            log('error', 'API Payment', 'Resposta do Mercado Pago não contém URL de redirecionamento válida.', { mpResponse });
            return res.status(500).json({ message: 'Erro ao iniciar pagamento. URL de redirecionamento ausente na resposta do MP.' });
        }

        log('info', 'API Payment', 'Pagamento iniciado com sucesso, redirecionando', { userId, redirectUrl });
        res.json({
            message: 'Pagamento iniciado com sucesso! Redirecionando...',
            type: 'redirect',
            redirectUrl: redirectUrl,
            paymentId: mpResponse.id
        });

    } catch (error) {
        log('error', 'API Payment', 'Erro ao iniciar pagamento com Mercado Pago', { error: error.message, userId, mpResponseData: error.response ? error.response.data : 'N/A' });
        res.status(500).json({ message: `Erro ao iniciar pagamento. Tente novamente mais tarde. Detalhes: ${error.message}` });
    }
});

// --- Rotas da Carteira Temporária (mantidas para saque) ---
app.post('/api/wallet/deposit', auth, actionLimiter, async (req, res) => { // Aplicar actionLimiter
    // Esta rota não é mais usada para depósitos reais, apenas para simulação ou legado.
    const { amount } = req.body;
    const userId = req.user.id;
    log('info', 'API Wallet', 'Requisição de depósito SIMULADO recebida', { userId, amount });
    try {
        if (typeof amount !== 'number' || amount <= 0) { 
            log('warn', 'API Wallet', 'Valor de depósito simulado inválido', { userId, amount });
            return res.status(400).json({ message: 'Valor de depósito inválido. Deve ser um número positivo.' }); 
        }
        const user = await User.findById(userId);
        if (!user) { 
            log('error', 'API Wallet', 'Usuário não encontrado para depósito simulado', { userId });
            return res.status(404).json({ message: 'Usuário não encontrado.' }); 
        }
        user.coins += amount;
        await user.save();
        log('info', 'API Wallet', 'Depósito simulado realizado com sucesso', { userId, newBalance: user.coins });
        res.status(200).json({ message: `Depósito de ${amount} moedas simulado com sucesso!`, newBalance: user.coins });
    } catch (error) {
        log('error', 'API Wallet', 'Erro ao processar depósito simulado', { error: error.message, userId });
        res.status(500).json({ message: 'Erro no servidor ao processar depósito simulado.' });
    }
});

app.post('/api/wallet/withdraw', auth, actionLimiter, async (req, res) => { // Aplicar actionLimiter
    const { amount } = req.body;
    const userId = req.user.id;
    log('info', 'API Wallet', 'Requisição de saque recebida', { userId, amount });
    try {
        if (typeof amount !== 'number' || amount <= 0) { 
            log('warn', 'API Wallet', 'Valor de saque inválido', { userId, amount });
            return res.status(400).json({ message: 'Valor de saque inválido. Deve ser um número positivo.' }); 
        }
        const user = await User.findById(userId);
        if (!user) { 
            log('error', 'API Wallet', 'Usuário não encontrado para saque', { userId });
            return res.status(404).json({ message: 'Usuário não encontrado.' }); 
        }
        if (user.coins < amount) { 
            log('warn', 'API Wallet', 'Saldo insuficiente para saque', { userId, requestedAmount: amount, currentCoins: user.coins });
            return res.status(400).json({ message: 'Saldo insuficiente para realizar este saque.' }); 
        }
        user.coins -= amount;
        await user.save();
        log('info', 'API Wallet', 'Saque realizado com sucesso', { userId, newBalance: user.coins });
        res.status(200).json({ message: `Saque de ${amount} moedas realizado com sucesso!`, newBalance: user.coins });
    } catch (error) {
        log('error', 'API Wallet', 'Erro ao processar saque', { error: error.message, userId });
        res.status(500).json({ message: 'Erro no servidor ao processar saque.' });
    }
});

// Outras rotas (Desafios, Amigos, Admin, etc.) - Manter conforme o seu código original
app.post('/api/challenges', auth, actionLimiter, async (req, res) => { // Aplicar actionLimiter
    const { game, console: platform, betAmount, scheduledTime } = req.body;
    const createdBy = req.user.id;
    log('info', 'API Challenge', 'Requisição para criar desafio público', { createdBy, game, platform, betAmount, scheduledTime });
    try {
        if (!game || !platform || !betAmount) { 
            log('warn', 'API Challenge', 'Dados incompletos para criar desafio público', { createdBy, game, platform, betAmount });
            return res.status(400).json({ message: 'Por favor, preencha todos os campos do desafio.' }); 
        }
        const user = await User.findById(req.user.id);
        if (betAmount > 0 && user.coins < betAmount) { 
            log('warn', 'API Challenge', 'Usuário sem moedas suficientes para a aposta', { userId: createdBy, betAmount, userCoins: user.coins });
            return res.status(400).json({ message: 'Você não tem moedas suficientes para esta aposta.' }); 
        }
        const newChallenge = new Challenge({ game, console: platform, betAmount, scheduledTime, createdBy: createdBy });
        await newChallenge.save();
        if (betAmount > 0) { 
            user.coins -= betAmount; 
            await user.save(); 
            log('info', 'API Challenge', 'Moedas deduzidas do criador do desafio', { userId: createdBy, betAmount, newCoins: user.coins });
        }
        log('info', 'API Challenge', 'Desafio público criado com sucesso', { challengeId: newChallenge._id, createdBy });
        res.status(201).json(newChallenge);
    } catch (error) {
        log('error', 'API Challenge', 'Erro ao criar desafio público', { error: error.message, createdBy, body: req.body });
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

app.post('/api/challenges/private', auth, actionLimiter, async (req, res) => { // Aplicar actionLimiter
    const { opponentId, game, console: platform, betAmount } = req.body;
    const createdBy = req.user.id;
    log('info', 'API Challenge', 'Requisição para criar desafio privado', { createdBy, opponentId, game, platform, betAmount });
    try {
        if (!opponentId || !game || !platform || betAmount === undefined || betAmount === null || betAmount < 0) { 
            log('warn', 'API Challenge', 'Dados do desafio privado incompletos ou inválidos', { createdBy, opponentId, game, platform, betAmount });
            return res.status(400).json({ message: 'Dados do desafio privado incompletos ou inválidos.' }); 
        }
        if (String(createdBy) === String(opponentId)) { 
            log('warn', 'API Challenge', 'Tentativa de desafiar a si mesmo', { userId: createdBy });
            return res.status(400).json({ message: 'Você não pode desafiar a si mesmo.' }); 
        }
        const creatorUser = await User.findById(createdBy);
        const opponentUser = await User.findById(opponentId);
        if (!creatorUser || !opponentUser) { 
            log('warn', 'API Challenge', 'Criador ou oponente não encontrado para desafio privado', { createdBy, opponentId });
            return res.status(404).json({ message: 'Criador ou oponente não encontrado.' }); 
        }
        // Verificar se são amigos (opcional, dependendo da regra de negócio)
        if (!creatorUser.friends.includes(opponentId)) { 
            log('warn', 'API Challenge', 'Tentativa de desafiar não-amigo privadamente', { createdBy, opponentId });
            return res.status(400).json({ message: 'Você só pode desafiar amigos diretamente.' }); 
        }
        if (betAmount > 0) {
            if (creatorUser.coins < betAmount) { 
                log('warn', 'API Challenge', 'Criador sem moedas suficientes para aposta privada', { userId: createdBy, betAmount, userCoins: creatorUser.coins });
                return res.status(400).json({ message: 'Você não tem moedas suficientes para esta aposta.' }); 
            }
            if (opponentUser.coins < betAmount) { 
                log('warn', 'API Challenge', 'Oponente sem moedas suficientes para aposta privada', { userId: opponentId, betAmount, userCoins: opponentUser.coins });
                return res.status(400).json({ message: `${opponentUser.username} não tem moedas suficientes para aceitar esta aposta.` }); 
            }
        }
        
        const newChallenge = new Challenge({ game, console: platform, betAmount, createdBy: createdBy, opponent: opponentId, status: 'open' });
        await newChallenge.save();

        log('info', 'API Challenge', 'Desafio privado criado com sucesso', { challengeId: newChallenge._id, createdBy, opponentId });

        // Notificar o oponente via socket se estiver online
        const opponentSocketId = onlineUsers.get(String(opponentId))?.socketId;
        if (opponentSocketId) { 
            io.to(opponentSocketId).emit('private challenge received', { 
                challengeId: newChallenge._id, 
                senderUsername: creatorUser.username, 
                game: newChallenge.game, 
                console: newChallenge.console, 
                betAmount: newChallenge.betAmount, 
                createdBy: createdBy 
            }); 
            log('info', 'Socket.IO Challenge', 'Notificação de desafio privado enviada', { toUserId: opponentId, challengeId: newChallenge._id });
        }
        res.status(201).json({ message: 'Desafio privado criado com sucesso e enviado ao seu amigo!', challenge: newChallenge });
    } catch (error) {
        log('error', 'API Challenge', 'Erro ao criar desafio privado', { error: error.message, createdBy, opponentId, body: req.body });
        res.status(500).json({ message: 'Erro no servidor ao criar desafio privado.' });
    }
});

app.get('/api/challenges', auth, async (req, res) => {
    log('info', 'API Challenge', 'Requisição para buscar desafios abertos', { userId: req.user.id });
    try {
        const challenges = await Challenge.find({ status: 'open' }).populate('createdBy', 'username avatarUrl').sort({ createdAt: -1 });
        log('info', 'API Challenge', 'Desafios abertos buscados com sucesso', { count: challenges.length });
        res.json(challenges);
    } catch (error) {
        log('error', 'API Challenge', 'Erro ao buscar desafios abertos', { error: error.message, userId: req.user.id });
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

app.patch('/api/challenges/:id/accept', auth, actionLimiter, async (req, res) => { // Aplicar actionLimiter
    const challengeId = req.params.id;
    const userId = req.user.id;
    log('info', 'API Challenge', 'Requisição para aceitar desafio', { challengeId, userId });
    try {
        const challenge = await Challenge.findById(challengeId);
        if (!challenge) { 
            log('warn', 'API Challenge', 'Desafio não encontrado para aceitação', { challengeId, userId });
            return res.status(404).json({ message: 'Desafio não encontrado.' }); 
        }
        if (challenge.status !== 'open') { 
            log('warn', 'API Challenge', 'Desafio não está aberto para aceitação', { challengeId, userId, status: challenge.status });
            return res.status(400).json({ message: 'Este desafio não está mais aberto para ser aceito.' }); 
        }
        if (challenge.createdBy.toString() === userId) { 
            log('warn', 'API Challenge', 'Tentativa de aceitar o próprio desafio', { challengeId, userId });
            return res.status(400).json({ message: 'Você não pode aceitar seu próprio desafio.' }); 
        }
        // Se for um desafio privado, garante que o oponente é o destinatário correto
        if (challenge.opponent && String(challenge.opponent) !== String(userId)) { 
            log('warn', 'API Challenge', 'Tentativa de aceitar desafio privado não destinado a este usuário', { challengeId, userId, designatedOpponent: challenge.opponent });
            return res.status(403).json({ message: 'Este desafio é privado e não foi feito para você.' }); 
        }
        
        const acceptorUser = await User.findById(userId);
        if (challenge.betAmount > 0 && acceptorUser.coins < challenge.betAmount) { 
            log('warn', 'API Challenge', 'Aceitador sem moedas suficientes para a aposta', { userId, betAmount: challenge.betAmount, userCoins: acceptorUser.coins });
            return res.status(400).json({ message: 'Você não tem moedas suficientes para aceitar esta aposta.' }); 
        }
        
        challenge.opponent = userId;
        challenge.status = 'accepted';
        await challenge.save();
        
        if (challenge.betAmount > 0) { 
            acceptorUser.coins -= challenge.betAmount; 
            await acceptorUser.save(); 
            log('info', 'API Challenge', 'Moedas deduzidas do aceitador do desafio', { userId, betAmount: challenge.betAmount, newCoins: acceptorUser.coins });
        }
        log('info', 'API Challenge', 'Desafio aceito com sucesso', { challengeId, acceptorId: userId });
        res.json(challenge);
    } catch (error) {
        log('error', 'API Challenge', 'Erro ao aceitar desafio', { error: error.message, challengeId, userId });
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

app.get('/api/my-challenges', auth, async (req, res) => {
    const userId = req.user.id;
    log('info', 'API Challenge', 'Requisição para buscar desafios do usuário', { userId });
    try {
        // Busca desafios onde o usuário é criador ou oponente e não arquivou o desafio
        const myChallenges = await Challenge.find({ 
            $or: [{ createdBy: userId }, { opponent: userId }],
            archivedBy: { $ne: userId } // Garante que o desafio não foi arquivado por este usuário
        }).populate('createdBy', 'username avatarUrl').populate('opponent', 'username avatarUrl').sort({ createdAt: -1 });
        log('info', 'API Challenge', 'Desafios do usuário buscados com sucesso', { userId, count: myChallenges.length });
        res.json(myChallenges);
    } catch (error) {
        log('error', 'API Challenge', 'Erro ao buscar meus desafios', { error: error.message, userId });
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

app.post('/api/challenges/:id/result', auth, actionLimiter, async (req, res) => { // Aplicar actionLimiter
    const { winnerId } = req.body;
    const challengeId = req.params.id;
    const reporterId = req.user.id;
    log('info', 'API Challenge', 'Requisição para reportar resultado de desafio', { challengeId, reporterId, winnerId });
    try {
        const challenge = await Challenge.findById(challengeId);
        if (!challenge) { 
            log('warn', 'API Challenge', 'Desafio não encontrado para reportar resultado', { challengeId, reporterId });
            return res.status(404).json({ message: "Desafio não encontrado." }); 
        }
        if (challenge.status !== 'accepted') { 
            log('warn', 'API Challenge', 'Status inválido para reportar resultado', { challengeId, reporterId, status: challenge.status });
            return res.status(400).json({ message: "Este desafio não está em andamento para ter um resultado reportado." }); 
        }
        
        const playerIds = [challenge.createdBy.toString(), challenge.opponent.toString()];
        if (!playerIds.includes(reporterId)) { 
            log('warn', 'API Challenge', 'Usuário não faz parte do desafio para reportar resultado', { challengeId, reporterId, playerIds });
            return res.status(403).json({ message: "Você não faz parte deste desafio para reportar um resultado." }); 
        }
        if (!winnerId || !playerIds.includes(winnerId)) { 
            log('warn', 'API Challenge', 'Vencedor informado não é válido', { challengeId, reporterId, winnerId, playerIds });
            return res.status(400).json({ message: "O vencedor informado não é válido para esta partida." }); 
        }
        
        const hasAlreadyReported = challenge.results.some(result => result.reportedBy.toString() === reporterId);
        if (hasAlreadyReported) { 
            log('warn', 'API Challenge', 'Usuário já reportou resultado para esta partida', { challengeId, reporterId });
            return res.status(400).json({ message: "Você já reportou um resultado para esta partida." }); 
        }
        
        challenge.results.push({ reportedBy: reporterId, winner: winnerId });
        log('info', 'API Challenge', 'Resultado reportado por um jogador', { challengeId, reporterId, winnerId, totalReports: challenge.results.length });

        if (challenge.results.length === 1) { 
            await challenge.save(); 
            return res.json({ message: "Seu resultado foi registrado. Aguardando oponente.", challenge }); 
        }
        else if (challenge.results.length === 2) {
            const firstReport = challenge.results[0];
            const secondReport = challenge.results[1];

            if (firstReport.winner.toString() === secondReport.winner.toString()) {
                challenge.winner = firstReport.winner; 
                challenge.status = 'completed'; 
                await challenge.save();
                log('info', 'API Challenge', 'Resultado confirmado e partida finalizada', { challengeId, winner: firstReport.winner });

                const winnerUser = await User.findById(firstReport.winner);
                const loserId = playerIds.find(id => id !== firstReport.winner.toString());
                const loserUser = await User.findById(loserId);

                if (challenge.betAmount > 0) { 
                    await User.findByIdAndUpdate(firstReport.winner, { $inc: { wins: 1, coins: challenge.betAmount * 2 } }); // Vencedor ganha o valor apostado dele e do oponente
                    await User.findByIdAndUpdate(loserId, { $inc: { losses: 1 } }); // Perdedor já teve as moedas deduzidas ao aceitar/criar
                    log('info', 'API Challenge', 'Moedas e estatísticas atualizadas após vitória', { winnerId: firstReport.winner, loserId: loserId, betAmount: challenge.betAmount });
                }
                else { 
                    await User.findByIdAndUpdate(firstReport.winner, { $inc: { wins: 1 } }); 
                    await User.findByIdAndUpdate(loserId, { $inc: { losses: 1 } }); 
                    log('info', 'API Challenge', 'Estatísticas atualizadas (sem moedas) após vitória', { winnerId: firstReport.winner, loserId: loserId });
                }

                return res.json({ message: "Resultado confirmado! Partida finalizada.", challenge });
            } else { 
                challenge.status = 'disputed'; 
                await challenge.save(); 
                log('warn', 'API Challenge', 'Resultados conflitantes, partida em disputa', { challengeId, reports: challenge.results });
                return res.status(409).json({ message: "Resultados conflitantes. A partida entrou em análise pelo suporte.", challenge }); 
            }
        }
    } catch (error) {
        log('error', 'API Challenge', 'Erro ao reportar resultado', { error: error.message, challengeId, reporterId, body: req.body });
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

app.patch('/api/challenges/:id/archive', auth, actionLimiter, async (req, res) => { // Aplicar actionLimiter
    const challengeId = req.params.id;
    const userId = req.user.id;
    log('info', 'API Challenge', 'Requisição para arquivar desafio', { challengeId, userId });
    try {
        const challenge = await Challenge.findById(challengeId);
        if (!challenge) { 
            log('warn', 'API Challenge', 'Desafio não encontrado para arquivamento', { challengeId, userId });
            return res.status(404).json({ message: "Desafio não encontrado." }); 
        }
        await Challenge.findByIdAndUpdate(challengeId, { $addToSet: { archivedBy: userId } });
        log('info', 'API Challenge', 'Desafio arquivado com sucesso', { challengeId, userId });
        res.json({ message: "Desafio arquivado com sucesso." });
    } catch (error) {
        log('error', 'API Challenge', 'Erro ao arquivar desafio', { error: error.message, challengeId, userId });
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

app.get('/api/users/me/stats', auth, async (req, res) => {
    const userId = req.user.id;
    log('info', 'API User', 'Requisição para buscar estatísticas do usuário', { userId });
    try {
        const user = await User.findById(userId).select('wins losses coins');
        if (!user) { 
            log('error', 'API User', 'Usuário não encontrado para estatísticas', { userId });
            return res.status(404).json({ message: 'Usuário não encontrado.' }); 
        }
        log('info', 'API User', 'Estatísticas do usuário buscadas com sucesso', { userId, stats: user });
        res.json(user);
    } catch (error) {
        log('error', 'API User', 'Erro ao buscar estatísticas do usuário', { error: error.message, userId });
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

app.get('/api/users/me', auth, async (req, res) => {
    const userId = req.user.id;
    log('info', 'API Profile', 'Requisição para buscar perfil do usuário logado', { userId });
    try {
        const user = await User.findById(userId).select('-password');
        if (!user) { 
            log('error', 'API Profile', 'Usuário não encontrado ao buscar perfil logado', { userId });
            return res.status(404).json({ message: 'Usuário não encontrado.' }); 
        }
        log('info', 'API Profile', 'Perfil do usuário logado buscado com sucesso', { userId, username: user.username });
        res.json(user);
    } catch (error) {
        log('error', 'API Profile', 'Erro ao buscar perfil do usuário logado', { error: error.message, userId });
        res.status(500).json({ message: 'Erro no servidor ao buscar perfil.' });
    }
});

app.post('/api/users/:userId/block', auth, actionLimiter, async (req, res) => { // Aplicar actionLimiter
    const userId = req.user.id;
    const targetUserId = req.params.userId;
    log('info', 'API User', 'Requisição para bloquear usuário', { userId, targetUserId });
    try {
        if (userId === targetUserId) { 
            log('warn', 'API User', 'Tentativa de bloquear a si mesmo', { userId });
            return res.status(400).json({ message: 'Você não pode bloquear a si mesmo.' }); 
        }
        const user = await User.findByIdAndUpdate(userId, { $addToSet: { blockedUsers: targetUserId } }, { new: true });
        // Remove amizade existente se houver
        await User.findByIdAndUpdate(userId, { $pull: { friends: targetUserId } });
        await User.findByIdAndUpdate(targetUserId, { $pull: { friends: userId } });
        // Remove solicitações de amizade pendentes entre eles
        await FriendRequest.deleteMany({ $or: [{ sender: userId, receiver: targetUserId }, { sender: targetUserId, receiver: userId }] });

        log('info', 'API User', 'Usuário bloqueado com sucesso', { userId, targetUserId });
        res.status(200).json({ message: 'Usuário bloqueado com sucesso.' });
    } catch (error) {
        log('error', 'API User', 'Erro ao bloquear usuário', { error: error.message, userId, targetUserId });
        res.status(500).json({ message: 'Erro no servidor ao bloquear usuário.' });
    }
});

app.delete('/api/users/:userId/unblock', auth, actionLimiter, async (req, res) => { // Aplicar actionLimiter
    const userId = req.user.id;
    const targetUserId = req.params.userId;
    log('info', 'API User', 'Requisição para desbloquear usuário', { userId, targetUserId });
    try {
        await User.findByIdAndUpdate(userId, { $pull: { blockedUsers: targetUserId } });
        log('info', 'API User', 'Usuário desbloqueado com sucesso', { userId, targetUserId });
        res.status(200).json({ message: 'Usuário desbloqueado com sucesso.' });
    } catch (error) {
        log('error', 'API User', 'Erro ao desbloquear usuário', { error: error.message, userId, targetUserId });
        res.status(500).json({ message: 'Erro no servidor ao desbloquear usuário.' });
    }
});

app.get('/api/search', auth, async (req, res) => {
    const query = req.query.q;
    const userId = req.user.id;
    log('info', 'API Search', 'Requisição de busca de usuários', { userId, query });
    try {
        if (!query || query.length < 3) { 
            log('warn', 'API Search', 'Termo de pesquisa muito curto', { userId, query });
            return res.status(400).json({ message: 'A pesquisa deve ter pelo menos 3 caracteres.' }); 
        }
        // Exclui o próprio usuário e usuários bloqueados
        const blockedUsers = (await User.findById(userId).select('blockedUsers')).blockedUsers;
        const users = await User.find({ 
            username: { $regex: query, $options: 'i' }, 
            _id: { $ne: userId, $nin: blockedUsers }, // Não o próprio usuário e não bloqueados
            role: 'user' 
        }).select('username avatarUrl console');
        
        const formattedResults = [];
        users.forEach(user => { formattedResults.push({ type: 'player', _id: user._id, username: user.username, avatarUrl: user.avatarUrl, console: user.console }); });
        
        log('info', 'API Search', 'Busca de usuários concluída', { userId, query, resultsCount: formattedResults.length });
        res.status(200).json(formattedResults);
    } catch (error) {
        log('error', 'API Search', 'Erro ao pesquisar usuários', { error: error.message, userId, query });
        res.status(500).json({ message: 'Erro no servidor ao pesquisar.' });
    }
});

app.get('/api/users/:id', auth, async (req, res) => {
    const userId = req.params.id;
    const requesterId = req.user.id;
    log('info', 'API User Profile', 'Requisição para buscar perfil de usuário por ID', { userId, requesterId });
    try {
        // Selecionar apenas dados públicos para evitar vazamento de informações
        const user = await User.findById(userId).select('username bio description console avatarUrl wins losses');
        if (!user) { 
            log('warn', 'API User Profile', 'Usuário não encontrado', { userId });
            return res.status(404).json({ message: 'Usuário não encontrado.' }); 
        }
        log('info', 'API User Profile', 'Perfil de usuário buscado com sucesso', { userId: user._id, username: user.username });
        res.json(user);
    } catch (error) {
        log('error', 'API User Profile', 'Erro ao buscar perfil do usuário', { error: error.message, userId, requesterId });
        res.status(500).json({ message: 'Erro no servidor ao buscar perfil do usuário.' });
    }
});

app.patch('/api/users/profile', auth, upload.single('avatar'), actionLimiter, async (req, res) => { // Aplicar actionLimiter
    const userId = req.user.id;
    const updates = req.body;
    log('info', 'API Profile', 'Requisição para atualizar perfil', { userId, updates: Object.keys(updates), file: req.file ? req.file.filename : 'N/A' });
    try {
        const user = await User.findById(userId);
        if (!user) { 
            log('error', 'API Profile', 'Usuário não encontrado para atualização de perfil', { userId });
            if (req.file) { fs.unlinkSync(req.file.path); } // Exclui arquivo se upload falhar por user not found
            return res.status(404).json({ message: 'Usuário não encontrado.' }); 
        }

        if (updates.username && updates.username !== user.username) {
            const existingUsername = await User.findOne({ username: updates.username });
            if (existingUsername && String(existingUsername._id) !== String(user._id)) {
                log('warn', 'API Profile', 'Tentativa de usar nome de usuário já em uso', { userId, newUsername: updates.username });
                if (req.file) { fs.unlinkSync(req.file.path); }
                return res.status(400).json({ message: 'Nome de usuário já está em uso.' });
            }
            user.username = updates.username;
        }

        // Atualiza apenas os campos fornecidos
        if (updates.phone !== undefined) user.phone = updates.phone;
        if (updates.bio !== undefined) user.bio = updates.bio;
        if (updates.description !== undefined) user.description = updates.description;
        if (updates.console !== undefined) user.console = updates.console;
        
        if (req.file) { 
            // Se já existia um avatar e é diferente do placeholder, tenta apagar o antigo
            if (user.avatarUrl && !user.avatarUrl.includes('avatar-placeholder.png')) {
                const oldAvatarFilename = path.basename(user.avatarUrl);
                const oldAvatarPath = path.join(avatarsDir, oldAvatarFilename);
                if (fs.existsSync(oldAvatarPath)) {
                    fs.unlink(oldAvatarPath, (err) => {
                        if (err) log('error', 'API Profile', 'Erro ao excluir avatar antigo', { userId, oldPath: oldAvatarPath, error: err.message });
                        else log('info', 'API Profile', 'Avatar antigo excluído com sucesso', { userId, oldPath: oldAvatarPath });
                    });
                }
            }
            // NOVO: Usar o URL do Render para o avatar
            user.avatarUrl = `${backendRenderUrl}/avatars/${req.file.filename}`; 
        }

        // Marca o perfil como completo se for a primeira vez
        if (!user.profileCompleted && (updates.username || user.username) && (updates.console || user.console)) {
            user.profileCompleted = true;
            log('info', 'API Profile', 'Perfil marcado como completo', { userId });
        }
        
        await user.save();

        // Atualizar usuário na lista de online via Socket.IO
        if (onlineUsers.has(userId)) {
            const onlineUser = onlineUsers.get(userId);
            onlineUser.username = user.username; 
            onlineUser.avatarUrl = user.avatarUrl; 
            onlineUser.console = user.console;
            onlineUsers.set(userId, onlineUser); 
            emitUpdatedUserList();
            log('info', 'API Profile', 'Dados de usuário online atualizados', { userId });
        }
        log('info', 'API Profile', 'Perfil atualizado com sucesso', { userId });
        res.json({ message: 'Perfil atualizado com sucesso!', user: { username: user.username, avatarUrl: user.avatarUrl, profileCompleted: user.profileCompleted, console: user.console } });
    } catch (error) {
        log('error', 'API Profile', 'Erro ao atualizar perfil', { error: error.message, userId, body: req.body, file: req.file ? req.file.filename : 'N/A' });
        if (req.file) { 
            fs.unlink(req.file.path, (err) => { 
                if (err) log('error', 'FS', 'Erro ao excluir arquivo de avatar após falha na API', { path: req.file.path, error: err.message }); 
            }); 
        }
        if (error.code === 'LIMIT_FILE_SIZE') { 
            return res.status(400).json({ message: 'O arquivo é muito grande. Tamanho máximo é 5MB.' }); 
        }
        res.status(500).json({ message: 'Erro no servidor ao atualizar perfil.' });
    }
});

app.post('/api/friends/request/:receiverId', auth, actionLimiter, async (req, res) => { // Aplicar actionLimiter
    const senderId = req.user.id; 
    const receiverId = req.params.receiverId;
    log('info', 'API Friends', 'Requisição para enviar solicitação de amizade', { senderId, receiverId });
    try {
        if (String(senderId) === String(receiverId)) { 
            log('warn', 'API Friends', 'Tentativa de enviar solicitação para si mesmo', { senderId });
            return res.status(400).json({ message: 'Você não pode enviar uma solicitação de amizade para si mesmo.' }); 
        }
        const sender = await User.findById(senderId); 
        const receiver = await User.findById(receiverId);
        if (!sender || !receiver) { 
            log('warn', 'API Friends', 'Remetente ou destinatário não encontrado', { senderId, receiverId });
            return res.status(404).json({ message: 'Usuário remetente ou destinatário não encontrado.' }); 
        }
        if (sender.friends.includes(receiverId)) { 
            log('warn', 'API Friends', 'Já são amigos', { senderId, receiverId });
            return res.status(400).json({ message: 'Vocês já são amigos.' }); 
        }
        const existingRequest = await FriendRequest.findOne({ sender: senderId, receiver: receiverId, status: 'pending' });
        if (existingRequest) { 
            log('warn', 'API Friends', 'Solicitação de amizade já enviada', { senderId, receiverId });
            return res.status(400).json({ message: 'Solicitação de amizade já enviada.' }); 
        }
        // Se houver uma solicitação inversa pendente, aceita automaticamente
        const reverseRequest = await FriendRequest.findOne({ sender: receiverId, receiver: senderId, status: 'pending' });
        if (reverseRequest) {
            reverseRequest.status = 'accepted'; 
            await reverseRequest.save();
            sender.friends.push(receiverId); 
            receiver.friends.push(senderId);
            // Remove a solicitação das listas pendentes dos usuários
            sender.receivedFriendRequests = sender.receivedFriendRequests.filter(reqId => String(reqId) !== String(reverseRequest._id));
            receiver.sentFriendRequests = receiver.sentFriendRequests.filter(reqId => String(reqId) !== String(reverseRequest._id));

            await sender.save(); 
            await receiver.save();

            log('info', 'API Friends', 'Solicitação inversa aceita automaticamente, usuários agora são amigos', { senderId, receiverId, requestId: reverseRequest._id });

            const senderSocketId = onlineUsers.get(senderId)?.socketId; 
            const receiverSocketId = onlineUsers.get(receiverId)?.socketId;
            
            // Notifica ambos os usuários
            if (senderSocketId) io.to(senderSocketId).emit('friend request accepted', { user: receiver.username, userId: receiver._id });
            if (receiverSocketId) io.to(receiverSocketId).emit('friend request accepted', { user: sender.username, userId: sender._id });
            
            io.to(senderSocketId).emit('friend request resolved'); 
            io.to(receiverSocketId).emit('friend request resolved');
            
            return res.status(200).json({ message: `Vocês agora são amigos com ${receiver.username}! Solicitação aceita automaticamente.` });
        }
        
        const newRequest = new FriendRequest({ sender: senderId, receiver: receiverId });
        await newRequest.save();
        sender.sentFriendRequests.push(newRequest._id); 
        receiver.receivedFriendRequests.push(newRequest._id);
        await sender.save(); 
        await receiver.save();

        log('info', 'API Friends', 'Solicitação de amizade enviada com sucesso', { requestId: newRequest._id, senderId, receiverId });

        // Notifica o destinatário via socket
        const receiverSocketId = onlineUsers.get(receiverId)?.socketId;
        if (receiverSocketId) { 
            io.to(receiverSocketId).emit('new friend request', { 
                requestId: newRequest._id, 
                senderId: sender._id, 
                senderUsername: sender.username, 
                senderAvatar: sender.avatarUrl, 
                senderConsole: sender.console 
            }); 
            log('info', 'Socket.IO Friends', 'Notificação de nova solicitação de amizade enviada', { toUserId: receiverId, requestId: newRequest._id });
        }
        res.status(201).json({ message: 'Solicitação de amizade enviada com sucesso!' });
    } catch (error) {
        log('error', 'API Friends', 'Erro ao enviar solicitação de amizade', { error: error.message, senderId, receiverId });
        if (error.code === 11000) { // Erro de chave duplicada do MongoDB
            return res.status(400).json({ message: 'Já existe uma solicitação de amizade pendente para este usuário.' }); 
        }
        res.status(500).json({ message: 'Erro no servidor ao enviar solicitação de amizade.' });
    }
});

app.patch('/api/friends/request/:requestId/accept', auth, actionLimiter, async (req, res) => { // Aplicar actionLimiter
    const userId = req.user.id; 
    const requestId = req.params.requestId;
    log('info', 'API Friends', 'Requisição para aceitar solicitação de amizade', { userId, requestId });
    try {
        const friendRequest = await FriendRequest.findById(requestId);
        if (!friendRequest || String(friendRequest.receiver) !== String(userId) || friendRequest.status !== 'pending') { 
            log('warn', 'API Friends', 'Solicitação de amizade não encontrada ou inválida para aceitação', { userId, requestId, status: friendRequest ? friendRequest.status : 'N/A' });
            return res.status(404).json({ message: 'Solicitação de amizade não encontrada ou não é sua.' }); 
        }
        
        friendRequest.status = 'accepted'; 
        await friendRequest.save();
        
        const sender = await User.findById(friendRequest.sender); 
        const receiver = await User.findById(friendRequest.receiver);
        if (!sender || !receiver) { 
            log('error', 'API Friends', 'Usuário remetente ou destinatário não encontrado ao aceitar solicitação', { senderId: friendRequest.sender, receiverId: friendRequest.receiver });
            return res.status(404).json({ message: 'Usuário remetente ou destinatário não encontrado.' }); 
        }
        
        // Adiciona um ao outro nas listas de amigos
        if (!sender.friends.includes(userId)) { sender.friends.push(userId); }
        if (!receiver.friends.includes(friendRequest.sender)) { receiver.friends.push(friendRequest.sender); }
        
        // Remove a solicitação das listas pendentes
        sender.sentFriendRequests = sender.sentFriendRequests.filter(reqId => String(reqId) !== String(requestId));
        receiver.receivedFriendRequests = receiver.receivedFriendRequests.filter(reqId => String(reqId) !== String(requestId));
        
        await sender.save(); 
        await receiver.save();

        log('info', 'API Friends', 'Solicitação de amizade aceita com sucesso', { requestId, acceptedBy: userId, senderId: sender._id });

        const senderSocketId = onlineUsers.get(String(sender._id))?.socketId; 
        const receiverSocketId = onlineUsers.get(userId)?.socketId;
        
        // Notifica ambos os usuários
        if (senderSocketId) io.to(senderSocketId).emit('friend request accepted', { user: receiver.username, userId: receiver._id });
        if (receiverSocketId) io.to(receiverSocketId).emit('friend request accepted', { user: sender.username, userId: sender._id });
        
        io.to(senderSocketId).emit('friend request resolved'); 
        io.to(receiverSocketId).emit('friend request resolved');
        
        return res.status(200).json({ message: `Você e ${sender.username} agora são amigos!` });
    } catch (error) {
        log('error', 'API Friends', 'Erro ao aceitar solicitação de amizade', { error: error.message, userId, requestId });
        res.status(500).json({ message: 'Erro no servidor ao aceitar solicitação de amizade.' });
    }
});

app.patch('/api/friends/request/:requestId/reject', auth, actionLimiter, async (req, res) => { // Aplicar actionLimiter
    const userId = req.user.id; 
    const requestId = req.params.requestId;
    log('info', 'API Friends', 'Requisição para rejeitar solicitação de amizade', { userId, requestId });
    try {
        const friendRequest = await FriendRequest.findById(requestId);
        if (!friendRequest || String(friendRequest.receiver) !== String(userId) || friendRequest.status !== 'pending') { 
            log('warn', 'API Friends', 'Solicitação de amizade não encontrada ou inválida para rejeição', { userId, requestId, status: friendRequest ? friendRequest.status : 'N/A' });
            return res.status(404).json({ message: 'Solicitação de amizade não encontrada ou não é sua.' }); 
        }
        
        friendRequest.status = 'rejected'; 
        await friendRequest.save();
        
        await User.findByIdAndUpdate(friendRequest.sender, { $pull: { sentFriendRequests: requestId } });
        await User.findByIdAndUpdate(friendRequest.receiver, { $pull: { receivedFriendRequests: requestId } });
        
        log('info', 'API Friends', 'Solicitação de amizade rejeitada com sucesso', { requestId, rejectedBy: userId });

        const senderSocketId = onlineUsers.get(String(friendRequest.sender))?.socketId;
        if (senderSocketId) { 
            io.to(senderSocketId).emit('friend request rejected', { user: req.user.username, userId: userId }); 
            log('info', 'Socket.IO Friends', 'Notificação de solicitação rejeitada enviada', { toUserId: friendRequest.sender, requestId });
        }
        io.to(senderSocketId).emit('friend request resolved'); 
        io.to(onlineUsers.get(userId)?.socketId).emit('friend request resolved');
        
        return res.status(200).json({ message: 'Solicitação de amizade rejeitada.' });
    } catch (error) {
        log('error', 'API Friends', 'Erro ao rejeitar solicitação de amizade', { error: error.message, userId, requestId });
        res.status(500).json({ message: 'Erro no servidor ao rejeitar solicitação de amizade.' });
    }
});

app.get('/api/friends/requests/received', auth, async (req, res) => {
    const userId = req.user.id;
    log('info', 'API Friends', 'Requisição para listar solicitações de amizade recebidas', { userId });
    try {
        const user = await User.findById(userId).populate({ 
            path: 'receivedFriendRequests', 
            match: { status: 'pending' }, 
            populate: { path: 'sender', select: 'username avatarUrl console' } 
        });
        if (!user) { 
            log('error', 'API Friends', 'Usuário não encontrado para listar solicitações recebidas', { userId });
            return res.status(404).json({ message: 'Usuário não encontrado.' }); 
        }
        const pendingRequests = user.receivedFriendRequests.map(req => ({ 
            requestId: req._id, 
            senderId: req.sender._id, 
            senderUsername: req.sender.username, 
            senderAvatar: req.sender.avatarUrl, 
            senderConsole: req.sender.console, 
            createdAt: req.createdAt 
        }));
        log('info', 'API Friends', 'Solicitações de amizade recebidas listadas com sucesso', { userId, count: pendingRequests.length });
        res.status(200).json(pendingRequests);
    } catch (error) {
        log('error', 'API Friends', 'Erro ao listar solicitações de amizade recebidas', { error: error.message, userId });
        res.status(500).json({ message: 'Erro no servidor ao listar solicitações.' });
    }
});

app.get('/api/friends/requests/sent', auth, async (req, res) => {
    const userId = req.user.id;
    log('info', 'API Friends', 'Requisição para listar solicitações de amizade enviadas', { userId });
    try {
        const user = await User.findById(userId).populate({ 
            path: 'sentFriendRequests', 
            match: { status: 'pending' }, 
            populate: { path: 'receiver', select: 'username avatarUrl console' } 
        });
        if (!user) { 
            log('error', 'API Friends', 'Usuário não encontrado para listar solicitações enviadas', { userId });
            return res.status(404).json({ message: 'Usuário não encontrado.' }); 
        }
        const sentRequests = user.sentFriendRequests.map(req => ({ 
            requestId: req._id, 
            receiverId: req.receiver._id, 
            receiverUsername: req.receiver.username, 
            receiverAvatar: req.receiver.avatarUrl, 
            receiverConsole: req.receiver.console, 
            createdAt: req.createdAt 
        }));
        log('info', 'API Friends', 'Solicitações de amizade enviadas listadas com sucesso', { userId, count: sentRequests.length });
        res.status(200).json(sentRequests);
    } catch (error) {
        log('error', 'API Friends', 'Erro ao listar solicitações de amizade enviadas', { error: error.message, userId });
        res.status(500).json({ message: 'Erro no servidor ao listar solicitações.' });
    }
});

app.get('/api/friends', auth, async (req, res) => {
    const userId = req.user.id;
    log('info', 'API Friends', 'Requisição para listar amigos', { userId });
    try {
        const user = await User.findById(userId).populate('friends', 'username avatarUrl console');
        if (!user) { 
            log('error', 'API Friends', 'Usuário não encontrado para listar amigos', { userId });
            return res.status(404).json({ message: 'Usuário não encontrado.' }); 
        }
        // Adiciona status online/offline
        const friendsWithStatus = user.friends.map(friend => ({ 
            _id: friend._id, 
            username: friend.username, 
            avatarUrl: friend.avatarUrl, 
            console: friend.console, 
            isOnline: onlineUsers.has(String(friend._id)) 
        }));
        log('info', 'API Friends', 'Lista de amigos buscada com sucesso', { userId, count: friendsWithStatus.length });
        res.status(200).json(friendsWithStatus);
    } catch (error) {
        log('error', 'API Friends', 'Erro ao listar amigos', { error: error.message, userId });
        res.status(500).json({ message: 'Erro no servidor ao listar amigos.' });
    }
});

app.delete('/api/friends/:friendId', auth, actionLimiter, async (req, res) => { // Aplicar actionLimiter
    const userId = req.user.id; 
    const friendId = req.params.friendId;
    log('info', 'API Friends', 'Requisição para remover amigo', { userId, friendId });
    try {
        const user = await User.findById(userId); 
        const friend = await User.findById(friendId);
        if (!user || !friend) { 
            log('warn', 'API Friends', 'Usuário ou amigo não encontrado para remoção', { userId, friendId });
            return res.status(404).json({ message: 'Usuário ou amigo não encontrado.' }); 
        }
        // Remove um do outro
        user.friends = user.friends.filter(fId => String(fId) !== String(friendId));
        friend.friends = friend.friends.filter(fId => String(fId) !== String(userId));
        await user.save(); 
        await friend.save();
        // Limpa solicitações de amizade pendentes entre eles, se houver
        await FriendRequest.deleteMany({ $or: [{ sender: userId, receiver: friendId }, { sender: friendId, receiver: userId }] });
        
        log('info', 'API Friends', 'Amigo removido com sucesso', { userId, friendId });

        const userSocketId = onlineUsers.get(userId)?.socketId; 
        const friendSocketId = onlineUsers.get(friendId)?.socketId;
        // Notifica ambos os usuários
        if (userSocketId) io.to(userSocketId).emit('friend removed', { user: friend.username, userId: friend._id });
        if (friendSocketId) io.to(friendSocketId).emit('friend removed', { user: user.username, userId: user._id });
        
        return res.status(200).json({ message: `${friend.username} foi removido da sua lista de amigos.` });
    }
    catch (error) {
        log('error', 'API Friends', 'Erro ao remover amigo', { error: error.message, userId, friendId });
        res.status(500).json({ message: 'Erro no servidor ao remover amigo.' });
    }
});

app.get('/api/users/me/blocked', auth, async (req, res) => {
    const userId = req.user.id;
    log('info', 'API User', 'Requisição para listar usuários bloqueados', { userId });
    try {
        const user = await User.findById(userId).populate('blockedUsers', 'username avatarUrl console');
        if (!user) { 
            log('error', 'API User', 'Usuário não encontrado para listar bloqueados', { userId });
            return res.status(404).json({ message: 'Usuário não encontrado.' }); 
        }
        log('info', 'API User', 'Usuários bloqueados listados com sucesso', { userId, count: (user.blockedUsers || []).length });
        res.status(200).json(user.blockedUsers || []);
    } catch (error) {
        log('error', 'API User', 'Erro ao listar usuários bloqueados', { error: error.message, userId });
        res.status(500).json({ message: 'Erro no servidor ao listar usuários bloqueados.' });
    }
});


// ROTAS DE ADMIN
app.get('/api/admin/dashboard-stats', adminAuth, async (req, res) => {
    log('info', 'API Admin', 'Requisição para buscar estatísticas do dashboard admin', { adminId: req.user.id });
    try {
        const totalUsers = await User.countDocuments();
        const totalChallenges = await Challenge.countDocuments();
        const completedChallenges = await Challenge.countDocuments({ status: 'completed' });
        const disputedChallenges = await Challenge.countDocuments({ status: 'disputed' });
        const result = await Challenge.aggregate([ { $match: { status: 'completed' } }, { $group: { _id: null, totalBetAmount: { $sum: '$betAmount' } } } ]);
        const totalCoinsBet = result.length > 0 ? result[0].totalBetAmount : 0;
        const onlineUsersCount = onlineUsers.size; // Pega a contagem em tempo real

        log('info', 'API Admin', 'Estatísticas do dashboard admin buscadas com sucesso', { totalUsers, totalChallenges, completedChallenges, disputedChallenges, totalCoinsBet, onlineUsersCount });
        res.json({ totalUsers, totalChallenges, completedChallenges, disputedChallenges, totalCoinsBet, onlineUsersCount });
    } catch (error) {
        log('error', 'API Admin', 'Erro ao buscar stats do dashboard admin', { error: error.message, adminId: req.user.id });
        res.status(500).json({ message: 'Erro no servidor ao buscar estatísticas.' });
    }
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
    log('info', 'API Admin', 'Requisição para buscar todos os usuários (admin)', { adminId: req.user.id });
    try {
        const users = await User.find().select('-password');
        log('info', 'API Admin', 'Usuários buscados por admin com sucesso', { adminId: req.user.id, count: users.length });
        res.json(users);
    }
    catch (error) {
        log('error', 'API Admin', 'Erro ao buscar usuários (admin)', { error: error.message, adminId: req.user.id });
        res.status(500).json({ message: 'Erro no servidor ao buscar usuários.' });
    }
});

app.patch('/api/admin/users/:id/update-coins', adminAuth, async (req, res) => {
    const userId = req.params.id;
    const { coins } = req.body;
    log('info', 'API Admin', 'Requisição para atualizar moedas de usuário (admin)', { adminId: req.user.id, userId, newCoins: coins });
    try {
        if (typeof coins !== 'number' || coins < 0) { 
            log('warn', 'API Admin', 'Valor de moedas inválido (admin)', { adminId: req.user.id, userId, coins });
            return res.status(400).json({ message: 'Valor de moedas inválido.' }); 
        }
        const user = await User.findByIdAndUpdate(userId, { coins: coins }, { new: true }).select('-password');
        if (!user) { 
            log('warn', 'API Admin', 'Usuário não encontrado para atualizar moedas (admin)', { adminId: req.user.id, userId });
            return res.status(404).json({ message: 'Usuário não encontrado.' }); 
        }
        log('info', 'API Admin', 'Moedas do usuário atualizadas com sucesso (admin)', { adminId: req.user.id, userId, newCoins: user.coins });
        res.json({ message: 'Moedas atualizadas com sucesso!', user });
    } catch (error) {
        log('error', 'API Admin', 'Erro ao atualizar moedas do usuário (admin)', { error: error.message, adminId: req.user.id, userId });
        res.status(500).json({ message: 'Erro no servidor ao atualizar moedas.' });
    }
});

app.patch('/api/admin/users/:id/toggle-active', adminAuth, async (req, res) => {
    const userId = req.params.id;
    log('info', 'API Admin', 'Requisição para ativar/desativar usuário (admin)', { adminId: req.user.id, userId });
    try {
        const user = await User.findById(userId);
        if (!user) { 
            log('warn', 'API Admin', 'Usuário não encontrado para ativar/desativar (admin)', { adminId: req.user.id, userId });
            return res.status(404).json({ message: 'Usuário não encontrado.' }); 
        }
        user.isActive = !user.isActive; 
        await user.save();
        log('info', 'API Admin', `Conta ${user.isActive ? 'ativada' : 'desativada'} com sucesso (admin)`, { adminId: req.user.id, userId, isActive: user.isActive });
        res.json({ message: `Conta ${user.isActive ? 'ativada' : 'desativada'} com sucesso!`, user });
    } catch (error) {
        log('error', 'API Admin', 'Erro ao ativar/desativar usuário (admin)', { error: error.message, adminId: req.user.id, userId });
        res.status(500).json({ message: 'Erro no servidor ao ativar/desativar usuário.' });
    }
});

// NEW: Endpoint to update user role
app.patch('/api/admin/users/:id/update-role', adminAuth, async (req, res) => {
    const userId = req.params.id;
    const { role } = req.body;
    log('info', 'API Admin', 'Requisição para atualizar cargo de usuário (admin)', { adminId: req.user.id, userId, newRole: role });

    try {
        // Basic validation for role
        const validRoles = ['user', 'support', 'admin'];
        if (!validRoles.includes(role)) {
            log('warn', 'API Admin', 'Cargo inválido fornecido (admin)', { adminId: req.user.id, userId, role });
            return res.status(400).json({ message: 'Cargo inválido.' });
        }

        const user = await User.findById(userId);
        if (!user) {
            log('warn', 'API Admin', 'Usuário não encontrado para atualizar cargo (admin)', { adminId: req.user.id, userId });
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        // Prevent admin from changing their own role to something other than admin
        if (String(req.user.id) === String(userId) && role !== 'admin') {
            log('warn', 'API Admin', 'Admin tentando mudar o próprio cargo para não-admin', { adminId: req.user.id, userId, role });
            return res.status(403).json({ message: 'Você não pode alterar seu próprio cargo de administrador.' });
        }

        user.role = role;
        await user.save();

        log('info', 'API Admin', 'Cargo do usuário atualizado com sucesso (admin)', { adminId: req.user.id, userId, newRole: user.role });
        res.json({ message: `Cargo do usuário atualizado para ${user.role}!`, user });

    } catch (error) {
        log('error', 'API Admin', 'Erro ao atualizar cargo do usuário (admin)', { error: error.message, adminId: req.user.id, userId, role: req.body.role });
        res.status(500).json({ message: 'Erro no servidor ao atualizar cargo.' });
    }
});


app.get('/api/admin/challenges', adminAuth, async (req, res) => {
    log('info', 'API Admin', 'Requisição para buscar todos os desafios (admin)', { adminId: req.user.id });
    try {
        const challenges = await Challenge.find()
            .populate('createdBy', 'username email')
            .populate('opponent', 'username email')
            .populate('winner', 'username email')
            .sort({ createdAt: -1 });
        log('info', 'API Admin', 'Desafios buscados por admin com sucesso', { adminId: req.user.id, count: challenges.length });
        res.json(challenges);
    } catch (error) {
        log('error', 'API Admin', 'Erro ao buscar desafios (admin)', { error: error.message, adminId: req.user.id });
        res.status(500).json({ message: 'Erro no servidor ao buscar desafios.' });
    }
});

app.patch('/api/admin/challenges/:id/resolve-dispute', adminAuth, async (req, res) => {
    const challengeId = req.params.id;
    const { winnerId } = req.body;
    log('info', 'API Admin', 'Requisição para resolver disputa de desafio (admin)', { adminId: req.user.id, challengeId, winnerId });
    try {
        const challenge = await Challenge.findById(challengeId);
        if (!challenge) { 
            log('warn', 'API Admin', 'Desafio não encontrado para resolver disputa (admin)', { adminId: req.user.id, challengeId });
            return res.status(404).json({ message: 'Desafio não encontrado.' }); 
        }
        if (challenge.status !== 'disputed') { 
            log('warn', 'API Admin', 'Desafio não está em disputa para ser resolvido (admin)', { adminId: req.user.id, challengeId, status: challenge.status });
            return res.status(400).json({ message: 'Este desafio não está em disputa para ser resolvido.' }); 
        }
        const playerIds = [challenge.createdBy.toString(), challenge.opponent.toString()];
        if (!playerIds.includes(winnerId)) { 
            log('warn', 'API Admin', 'Vencedor selecionado inválido para disputa (admin)', { adminId: req.user.id, challengeId, winnerId, playerIds });
            return res.status(400).json({ message: 'O vencedor selecionado não é um participante válido deste desafio.' }); 
        }
        
        challenge.winner = winnerId; 
        challenge.status = 'completed'; 
        await challenge.save();
        log('info', 'API Admin', 'Disputa resolvida e desafio completo (admin)', { adminId: req.user.id, challengeId, winnerId });

        const winnerUser = await User.findById(winnerId);
        const loserId = playerIds.find(id => id !== winnerId);
        const loserUser = await User.findById(loserId);

        if (challenge.betAmount > 0) { 
            await User.findByIdAndUpdate(winnerId, { $inc: { wins: 1, coins: challenge.betAmount * 2 } });
            await User.findByIdAndUpdate(loserId, { $inc: { losses: 1 } });
            log('info', 'API Admin', 'Moedas e estatísticas atualizadas após resolução de disputa', { winnerId, loserId, betAmount: challenge.betAmount });
        }
        else { 
            await User.findByIdAndUpdate(winnerId, { $inc: { wins: 1 } }); 
            await User.findByIdAndUpdate(loserId, { $inc: { losses: 1 } }); 
            log('info', 'API Admin', 'Estatísticas atualizadas (sem moedas) após resolução de disputa', { winnerId, loserId });
        }
        res.json({ message: 'Disputa resolvida e resultado aplicado com sucesso!', challenge });
    } catch (error) {
        log('error', 'API Admin', 'Erro ao resolver disputa (admin)', { error: error.message, adminId: req.user.id, challengeId });
        res.status(500).json({ message: 'Erro no servidor ao resolver disputa.' });
    }
});

app.patch('/api/admin/challenges/:id/cancel', adminAuth, async (req, res) => {
    const challengeId = req.params.id;
    log('info', 'API Admin', 'Requisição para cancelar desafio (admin)', { adminId: req.user.id, challengeId });
    try {
        const challenge = await Challenge.findById(challengeId);
        if (!challenge) { 
            log('warn', 'API Admin', 'Desafio não encontrado para cancelar (admin)', { adminId: req.user.id, challengeId });
            return res.status(404).json({ message: 'Desafio não encontrado.' }); 
        }
        if (challenge.status === 'completed' || challenge.status === 'cancelled') { 
            log('warn', 'API Admin', 'Desafio já finalizado ou cancelado (admin)', { adminId: req.user.id, challengeId, status: challenge.status });
            return res.status(400).json({ message: 'Desafio já finalizado ou cancelado.' }); 
        }
        challenge.status = 'cancelled'; 
        await challenge.save();
        log('info', 'API Admin', 'Desafio cancelado com sucesso (admin)', { adminId: req.user.id, challengeId });
        res.json({ message: 'Desafio cancelado com sucesso!', challenge });
    } catch (error) {
        log('error', 'API Admin', 'Erro ao cancelar desafio (admin)', { error: error.message, adminId: req.user.id, challengeId });
        res.status(500).json({ message: 'Erro no servidor ao cancelar desafio.' });
    }
});

app.post('/api/forgot-password', forgotPasswordLimiter, async (req, res) => { // Aplicar forgotPasswordLimiter
    const { email } = req.body;
    log('info', 'API Auth', 'Requisição de recuperação de senha', { email });
    try {
        if (!email) { 
            log('warn', 'API Auth', 'E-mail ausente para recuperação de senha');
            return res.status(400).json({ message: 'Por favor, insira seu e-mail.' }); 
        }
        const user = await User.findOne({ email });
        // Sempre retorna uma mensagem genérica por segurança, para não expor se o e-mail existe
        if (!user) { 
            log('info', 'API Auth', 'Tentativa de recuperação de senha para e-mail não registrado', { email });
            return res.status(200).json({ message: 'Se o e-mail estiver cadastrado, um link de redefinição será enviado.' }); 
        }
        
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpires = Date.now() + 3600000; // 1 hora
        user.resetPasswordToken = resetToken; 
        user.resetPasswordExpires = resetExpires; 
        await user.save();
        log('info', 'API Auth', 'Token de redefinição de senha gerado e salvo', { userId: user._id, email });

        // NOVO: Usar o frontendUrl para o link de redefinição de senha
        const resetUrl = `${frontendUrl}login.html?resetToken=${resetToken}`;
        const mailOptions = { 
            to: user.email, 
            from: process.env.EMAIL_USER, 
            subject: 'GameRivals - Redefinição de Senha', 
            html: `<p>Você solicitou uma redefinição de senha para sua conta GameRivals.</p><p>Por favor, clique no link a seguir para redefinir sua senha:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Este link expirará em 1 hora.</p><p>Se você não solicitou esta redefinição, por favor, ignore este e-mail.</p>` 
        };
        
        await transporter.sendMail(mailOptions);
        log('info', 'API Auth', 'E-mail de redefinição de senha enviado', { userId: user._id, email });
        res.status(200).json({ message: 'Se o e-mail estiver cadastrado, um link de redefinição será enviado.' });
    } catch (error) {
        log('error', 'API Auth', 'Erro ao solicitar redefinição de senha', { error: error.message, email });
        res.status(500).json({ message: 'Erro no servidor ao processar a solicitação de redefinição de senha.' });
    }
});

app.post('/api/reset-password/:token', async (req, res) => {
    const { token } = req.params; 
    const { newPassword } = req.body;
    log('info', 'API Auth', 'Requisição de redefinição de senha com token', { token });
    try {
        if (!newPassword || newPassword.length < 6) { 
            log('warn', 'API Auth', 'Nova senha muito curta', { token });
            return res.status(400).json({ message: 'A nova senha deve ter pelo menos 6 caracteres.' }); 
        }
        const user = await User.findOne({ resetPasswordToken: token, resetPasswordExpires: { $gt: Date.now() } });
        if (!user) { 
            log('warn', 'API Auth', 'Token de redefinição de senha inválido ou expirado', { token });
            return res.status(400).json({ message: 'Token de redefinição de senha inválido ou expirado.' }); 
        }
        const salt = await bcrypt.genSalt(10); 
        user.password = await bcrypt.hash(newPassword, salt);
        user.resetPasswordToken = undefined; 
        user.resetPasswordExpires = undefined; 
        await user.save();
        log('info', 'API Auth', 'Senha redefinida com sucesso', { userId: user._id, email: user.email });

        const mailOptionsConfirm = { 
            to: user.email, 
            from: process.env.EMAIL_USER, 
            subject: 'GameRivals - Sua senha foi redefinida com sucesso', 
            html: '<p>Sua senha da conta GameRivals foi redefinida com sucesso.</p><p>Se você não fez esta alteração, por favor, entre em contato com o suporte imediatamente.</p>' 
        };
        await transporter.sendMail(mailOptionsConfirm);
        log('info', 'API Auth', 'E-mail de confirmação de redefinição de senha enviado', { userId: user._id, email: user.email });
        res.status(200).json({ message: 'Sua senha foi redefinida com sucesso!' });
    } catch (error) {
        log('error', 'API Auth', 'Erro ao redefinir senha', { error: error.message, token });
        res.status(500).json({ message: 'Erro no servidor ao redefinir a senha.' });
    }
});

// Endpoint para o Webhook do Mercado Pago (para receber notificações de pagamento)
app.post('/api/webhooks/mercadopago', async (req, res) => {
    log('info', 'Webhook MP', 'Requisição recebida para /api/webhooks/mercadopago', { query: req.query, body: req.body });
    
    if (req.query.topic === 'payment') {
        const paymentId = req.query.id;
        log('info', 'Webhook MP', `Processando notificação de pagamento`, { paymentId });
        try {
            const payment = await payments.get({ id: paymentId });
            const paymentStatus = payment.body.status;
            const externalReference = payment.body.external_reference; // É o userId
            const paidAmount = payment.body.transaction_amount;

            log('info', 'Webhook MP', `Pagamento ID: ${paymentId}, Status: ${paymentStatus}, Ref Externa: ${externalReference}, Valor: ${paidAmount}`);
            
            if (paymentStatus === 'approved') {
                const userId = externalReference;
                const user = await User.findById(userId);
                if (user) { 
                    user.coins += paidAmount; 
                    await user.save(); 
                    log('info', 'Webhook MP', `Saldo do usuário ${user.username} atualizado.`, { userId, newBalance: user.coins, addedAmount: paidAmount }); 
                }
                else { 
                    log('error', 'Webhook MP', `Usuário com ID ${userId} não encontrado para atualizar saldo.`, { paymentId }); 
                }
            } else if (paymentStatus === 'rejected' || paymentStatus === 'cancelled') {
                log('warn', 'Webhook MP', `Pagamento ${paymentId} foi rejeitado ou cancelado.`, { status: paymentStatus, userId: externalReference });
            } else if (paymentStatus === 'pending') {
                log('info', 'Webhook MP', `Pagamento ${paymentId} está pendente.`, { userId: externalReference });
            }
            res.status(200).send('Webhook recebido e processado.');
        } catch (error) {
            log('error', 'Webhook MP', 'Erro ao processar webhook', { error: error.message, paymentId: req.query.id, responseData: error.response ? error.response.data : 'N/A' });
            res.status(500).send('Erro interno do servidor ao processar webhook.');
        }
    } else { 
        log('info', 'Webhook MP', 'Webhook recebido (tópico não relevante).', { topic: req.query.topic });
        res.status(200).send('Webhook recebido (tópico não relevante).'); 
    }
});

// NOVO: Rotas de Suporte
// Usuário cria uma nova conversa de suporte
app.post('/api/support/conversations', auth, async (req, res) => {
    const { subject } = req.body;
    const userId = req.user.id;
    const userUsername = req.user.username;
    log('info', 'API Support', 'Requisição para criar nova conversa de suporte', { userId, userUsername, subject });

    try {
        const newConversation = new SupportConversation({
            userId,
            userUsername,
            subject: subject || 'Problema Geral',
            messages: [{
                sender: userId,
                senderUsername: userUsername,
                text: `O usuário ${userUsername} iniciou uma nova conversa de suporte com o assunto: ${subject || 'Problema Geral'}.`
            }]
        });
        await newConversation.save();

        // Faz o usuário entrar na sala do socket para receber updates em tempo real
        const userSocketId = onlineUsers.get(userId)?.socketId;
        if (userSocketId) {
            io.sockets.sockets.get(userSocketId)?.join(`support_conversation_${newConversation._id}`);
            log('info', 'Socket.IO Support', 'Usuário entrou na sala da nova conversa de suporte', { userId, conversationId: newConversation._id });
        }
        
        // Notifica agentes de suporte online (se houver)
        const supportAgentsOnline = Array.from(onlineUsers.values()).filter(u => u.role === 'support');
        supportAgentsOnline.forEach(agent => {
            if (agent.socketId) {
                io.sockets.sockets.get(agent.socketId)?.join(`support_conversation_${newConversation._id}`); // Agente entra na sala
                io.to(agent.socketId).emit('new support conversation', {
                    conversationId: newConversation._id,
                    userId: newConversation.userId,
                    userUsername: newConversation.userUsername,
                    subject: newConversation.subject,
                    status: newConversation.status
                });
                log('info', 'Socket.IO Support', 'Agente de suporte notificado sobre nova conversa', { agentId: agent.id, conversationId: newConversation._id });
            }
        });

        log('info', 'API Support', 'Conversa de suporte criada com sucesso', { conversationId: newConversation._id, userId });
        res.status(201).json({ message: 'Conversa de suporte iniciada com sucesso!', conversationId: newConversation._id });
    } catch (error) {
        log('error', 'API Support', 'Erro ao criar conversa de suporte', { error: error.message, userId, subject });
        res.status(500).json({ message: 'Erro ao iniciar conversa de suporte.' });
    }
});

// Usuário busca suas próprias conversas de suporte
app.get('/api/support/conversations/me', auth, async (req, res) => {
    const userId = req.user.id;
    const conversationIdParam = req.query.conversationId; // NOVO: Permite buscar uma conversa específica se o ID for fornecido

    log('info', 'API Support', 'Requisição para buscar conversas de suporte do usuário', { userId, conversationIdParam });
    try {
        let query = { userId: userId };
        if (conversationIdParam) {
            query._id = conversationIdParam; // Se um ID for fornecido, filtra por ele
        } else {
            // Se não for um pedido para uma conversa específica, filtra as que o usuário não arquivou
            query.archivedBy = { $ne: userId }; 
        }

        const conversations = await SupportConversation.find(query)
            .sort({ updatedAt: -1 }); // Mais recentes primeiro
        
        // Faz o usuário entrar nas salas de socket das suas conversas ativas
        const userSocketId = onlineUsers.get(userId)?.socketId;
        if (userSocketId) {
            conversations.forEach(conv => {
                if (conv.status !== 'closed') { // Apenas conversas ativas/em progresso
                    io.sockets.sockets.get(userSocketId)?.join(`support_conversation_${conv._id}`);
                }
            });
        }
        
        log('info', 'API Support', 'Conversas de suporte do usuário buscadas com sucesso', { userId, count: conversations.length, filteredByArchive: !conversationIdParam });
        res.json(conversations);
    } catch (error) {
        log('error', 'API Support', 'Erro ao buscar conversas de suporte do usuário', { error: error.message, userId });
        res.status(500).json({ message: 'Erro ao buscar conversas de suporte.' });
    }
});

// Usuário (ou suporte) envia mensagem para uma conversa existente
app.post('/api/support/conversations/:conversationId/messages', auth, async (req, res) => {
    const { conversationId } = req.params;
    const { text } = req.body;
    const senderId = req.user.id;
    const senderUsername = req.user.username;
    const senderRole = req.user.role; // Pega o role do token

    log('info', 'API Support', 'Requisição para enviar mensagem em conversa de suporte', { senderId, conversationId, textLength: text.length });

    try {
        const conversation = await SupportConversation.findById(conversationId);
        if (!conversation) {
            log('warn', 'API Support', 'Conversa de suporte não encontrada para enviar mensagem', { conversationId, senderId });
            return res.status(404).json({ message: 'Conversa de suporte não encontrada.' });
        }

        // Verifica se o sender é participante (o usuário original) ou um agente de suporte
        const isUserParticipant = String(conversation.userId) === String(senderId);
        const isSupportAgent = senderRole === 'admin' || senderRole === 'support'; // Admins também podem ser suporte

        if (!isUserParticipant && !isSupportAgent) {
            log('warn', 'API Support', 'Remetente não autorizado a enviar mensagem para esta conversa', { senderId, conversationId });
            return res.status(403).json({ message: 'Você não pode enviar mensagens para esta conversa.' });
        }
        // Se a conversa está fechada e não é um agente de suporte respondendo a uma reabertura, não permite
        if (conversation.status === 'closed' && !isSupportAgent) {
            log('warn', 'API Support', 'Usuário tentando enviar mensagem para conversa fechada', { senderId, conversationId });
            return res.status(400).json({ message: 'Esta conversa de suporte está fechada.' });
        }
        // Se um agente de suporte responde a uma conversa fechada, reabre
        if (conversation.status === 'closed' && isSupportAgent) {
            conversation.status = 'in_progress';
            // Garante que o agente é atribuído se reabriu uma conversa que não tinha agente
            if (!conversation.supportAgentId) conversation.supportAgentId = senderId;
            log('info', 'API Support', 'Conversa reaberta por agente de suporte', { conversationId, agentId: senderId });
        }
        // Se um usuário envia mensagem para uma conversa em aberto, muda para em progresso
        if (conversation.status === 'open' && isUserParticipant) {
             conversation.status = 'in_progress';
             log('info', 'API Support', 'Conversa alterada para "em progresso" por usuário', { conversationId, userId: senderId });
        }


        const newMessage = {
            sender: senderId,
            senderUsername: senderUsername,
            text: text.trim(),
            createdAt: new Date()
        };

        conversation.messages.push(newMessage);
        conversation.updatedAt = new Date(); // Atualiza a data da última mensagem/atividade
        await conversation.save();
        
        // Faz o agente de suporte entrar na sala se ainda não estiver (para o caso de primeira mensagem)
        if (isSupportAgent && !conversation.supportAgentId) { // Se for o primeiro agente a responder
            conversation.supportAgentId = senderId;
            await conversation.save(); // Salva a atribuição do agente
            log('info', 'API Support', 'Agente de suporte atribuído à conversa', { conversationId, agentId: senderId });
        }

        // Emite a nova mensagem via socket para a sala da conversa
        emitSupportConversationUpdate(conversationId, 'new support message', { conversationId, subject: conversation.subject, message: newMessage });
        // Também emite uma atualização geral da conversa para que listas possam ser atualizadas (status, updatedAt)
        emitSupportConversationUpdate(conversationId, 'support conversation updated', { conversationId, status: conversation.status, updatedAt: conversation.updatedAt });

        log('info', 'API Support', 'Mensagem enviada e conversa atualizada com sucesso', { conversationId, senderId });
        res.status(201).json({ message: 'Mensagem enviada com sucesso!', newMessage });

    } catch (error) {
        log('error', 'API Support', 'Erro ao enviar mensagem em conversa de suporte', { error: error.message, senderId, conversationId });
        res.status(500).json({ message: 'Erro ao enviar mensagem.' });
    }
});

// NOVO: Rota para arquivar uma conversa de suporte (usuário/agente)
app.patch('/api/support/conversations/:conversationId/archive', auth, async (req, res) => {
    const { conversationId } = req.params;
    const userId = req.user.id;
    log('info', 'API Support', 'Requisição para arquivar conversa de suporte', { userId, conversationId });

    try {
        const conversation = await SupportConversation.findById(conversationId);
        if (!conversation) {
            log('warn', 'API Support', 'Conversa de suporte não encontrada para arquivar', { conversationId, userId });
            return res.status(404).json({ message: 'Conversa de suporte não encontrada.' });
        }

        // Verifica se o usuário é participante ou agente de suporte
        const isUserParticipant = String(conversation.userId) === String(userId);
        const isSupportAgent = req.user.role === 'admin' || req.user.role === 'support';
        const isAssignedAgent = String(conversation.supportAgentId) === String(userId);

        if (!isUserParticipant && !isSupportAgent && !isAssignedAgent) {
            log('warn', 'API Support', 'Usuário não autorizado a arquivar esta conversa', { userId, conversationId });
            return res.status(403).json({ message: 'Você não tem permissão para arquivar esta conversa.' });
        }

        // Adiciona o ID do usuário à lista de arquivados
        await SupportConversation.findByIdAndUpdate(conversationId, { $addToSet: { archivedBy: userId } });
        
        log('info', 'API Support', 'Conversa de suporte arquivada com sucesso', { conversationId, userId });
        res.status(200).json({ message: 'Conversa arquivada com sucesso.' });

    } catch (error) {
        log('error', 'API Support', 'Erro ao arquivar conversa de suporte', { error: error.message, userId, conversationId });
        res.status(500).json({ message: 'Erro ao arquivar conversa.' });
    }
});


// Suporte (admin ou support) busca todas as conversas
app.get('/api/support/conversations', supportAuth, async (req, res) => { // Protegido por supportAuth
    const requesterId = req.user.id;
    const requesterRole = req.user.role;
    log('info', 'API Support', 'Requisição para buscar todas as conversas de suporte (suporte/admin)', { requesterId, requesterRole });

    try {
        let conversations;
        if (requesterRole === 'admin') {
            // Admin vê todas as conversas, incluindo as fechadas
            conversations = await SupportConversation.find().sort({ updatedAt: -1 });
        } else {
            // Suporte vê apenas abertas e em progresso, e as que ele está atribuído, e não arquivadas por ele
            conversations = await SupportConversation.find({
                $and: [
                    {
                        $or: [
                            { status: { $in: ['open', 'in_progress'] } },
                            { supportAgentId: requesterId } // Inclui conversas fechadas que ele lidou
                        ]
                    },
                    { archivedBy: { $ne: requesterId } } // Filtra as que ele arquivou
                ]
            })
            .sort({ updatedAt: -1 });
        }

        // Faz o agente de suporte entrar nas salas de socket das suas conversas
        const requesterSocketId = onlineUsers.get(requesterId)?.socketId;
        if (requesterSocketId) {
            conversations.forEach(conv => {
                io.sockets.sockets.get(requesterSocketId)?.join(`support_conversation_${conv._id}`);
            });
        }
        
        log('info', 'API Support', 'Conversas de suporte buscadas com sucesso (suporte/admin)', { requesterId, count: conversations.length });
        res.json(conversations);
    } catch (error) {
        log('error', 'API Support', 'Erro ao buscar conversas de suporte (suporte/admin)', { error: error.message, requesterId });
        res.status(500).json({ message: 'Erro ao buscar conversas de suporte.' });
    }
});

// Suporte busca uma conversa específica
app.get('/api/support/conversations/:conversationId', supportAuth, async (req, res) => {
    const { conversationId } = req.params;
    const requesterId = req.user.id;
    const requesterRole = req.user.role;
    log('info', 'API Support', 'Requisição para buscar conversa de suporte específica (suporte/admin)', { requesterId, conversationId });

    try {
        const conversation = await SupportConversation.findById(conversationId);
        if (!conversation) {
            log('warn', 'API Support', 'Conversa de suporte específica não encontrada', { conversationId, requesterId });
            return res.status(404).json({ message: 'Conversa de suporte não encontrada.' });
        }

        // Verifica se o suporte tem permissão para ver esta conversa
        const isAssignedAgent = String(conversation.supportAgentId) === String(requesterId);
        const isUserConversation = String(conversation.userId) === String(requesterId); // Se for a própria conversa do agente como usuário
        const isAdmin = requesterRole === 'admin';

        // Suporte pode ver conversas abertas/em progresso, ou se for atribuído, ou se for admin.
        if (!isAdmin && !isAssignedAgent && !isUserConversation && conversation.status === 'closed') {
             log('warn', 'API Support', 'Acesso negado a conversa fechada não atribuída (suporte)', { conversationId, requesterId });
             return res.status(403).json({ message: 'Você não tem permissão para acessar esta conversa fechada.' });
        }
        if (!isAdmin && !isAssignedAgent && !isUserConversation && conversation.status !== 'open' && conversation.status !== 'in_progress') {
            log('warn', 'API Support', 'Acesso negado a conversa não atribuída e não aberta (suporte)', { conversationId, requesterId });
            return res.status(403).json({ message: 'Você não tem permissão para acessar esta conversa.' });
        }

        // Se a conversa está aberta e nenhum agente está atribuído, atribui a este agente (apenas para suporte, não admin)
        if (conversation.status === 'open' && !conversation.supportAgentId && requesterRole === 'support') {
            conversation.supportAgentId = requesterId;
            conversation.status = 'in_progress';
            await conversation.save();
            log('info', 'API Support', 'Conversa aberta atribuída a agente de suporte', { conversationId, agentId: requesterId });
            // Notifica o usuário que a conversa foi atribuída (opcional)
            emitSupportConversationUpdate(conversationId, 'support conversation updated', { conversationId, status: conversation.status, supportAgentId: requesterId });
        }
        // Faz o agente de suporte entrar na sala do socket da conversa
        const requesterSocketId = onlineUsers.get(requesterId)?.socketId;
        if (requesterSocketId) {
            io.sockets.sockets.get(requesterSocketId)?.join(`support_conversation_${conversationId}`);
        }

        log('info', 'API Support', 'Conversa de suporte específica buscada com sucesso', { conversationId, requesterId });
        res.json(conversation);

    } catch (error) {
        log('error', 'API Support', 'Erro ao buscar conversa de suporte específica', { error: error.message, conversationId, requesterId });
        res.status(500).json({ message: 'Erro ao buscar conversa de suporte.' });
    }
});

// Suporte altera o status da conversa (ex: para 'closed')
app.patch('/api/support/conversations/:conversationId/status', supportAuth, async (req, res) => {
    const { conversationId } = req.params;
    const { status } = req.body;
    const requesterId = req.user.id;
    log('info', 'API Support', 'Requisição para alterar status da conversa de suporte', { requesterId, conversationId, newStatus: status });

    try {
        const conversation = await SupportConversation.findById(conversationId);
        if (!conversation) {
            log('warn', 'API Support', 'Conversa de suporte não encontrada para alterar status', { conversationId, requesterId });
            return res.status(404).json({ message: 'Conversa de suporte não encontrada.' });
        }

        // Verifica se o status é válido
        const validStatuses = ['open', 'in_progress', 'closed'];
        if (!validStatuses.includes(status)) {
            log('warn', 'API Support', 'Status inválido fornecido para conversa de suporte', { conversationId, newStatus: status });
            return res.status(400).json({ message: 'Status inválido.' });
        }

        // Permite que admins mudem qualquer status, suporte apenas open/in_progress para closed
        if (req.user.role === 'support' && (conversation.status === 'closed' && status !== 'open')) { // Suporte não pode reabrir arbitrariamente
            log('warn', 'API Support', 'Agente de suporte tentando alterar status de conversa fechada de forma inválida', { requesterId, conversationId, currentStatus: conversation.status, newStatus: status });
            return res.status(403).json({ message: 'Você não tem permissão para reabrir esta conversa.' });
        }
        
        conversation.status = status;
        conversation.updatedAt = new Date();
        await conversation.save();

        // Notifica todos os participantes da conversa sobre a mudança de status
        emitSupportConversationUpdate(conversationId, 'support conversation status updated', { conversationId, newStatus: status });
        
        // Se a conversa foi fechada, remove todos da sala de socket da conversa
        if (status === 'closed') {
            io.sockets.in(`support_conversation_${conversationId}`).socketsLeave(`support_conversation_${conversationId}`);
            log('info', 'Socket.IO Support', 'Sala de socket da conversa fechada', { conversationId });
        }

        log('info', 'API Support', 'Status da conversa de suporte alterado com sucesso', { conversationId, newStatus: status });
        res.json({ message: `Status da conversa alterado para ${status}.` });

    } catch (error) {
        log('error', 'API Support', 'Erro ao alterar status da conversa de suporte', { error: error.message, requesterId, conversationId, newStatus: status });
        res.status(500).json({ message: 'Erro ao alterar status da conversa.' });
    }
});