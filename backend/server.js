// arquivo: backend/server.js

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
const Joi = require('joi'); // NOVO: Importa o Joi para validação
const rateLimit = require('express-rate-limit'); // NOVO: Importa o Rate Limit

const User = require('./models/User');
const Challenge = require('./models/Challenge');
const Message = require('./models/Message');
const FriendRequest = require('./models/FriendRequest');
const PixPaymentNotification = require('./models/PixPaymentNotification');
const WithdrawalRequest = require('./models/WithdrawalRequest');
const Tournament = require('./models/Tournament');
const Game = require('./models/Game'); // NOVO: Importa o modelo Game

const auth = require('./middleware/auth');
const adminAuth = require('./middleware/adminAuth');

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

const FRONTEND_URL = process.env.FRONTEND_URL || "https://matheusj1.github.io";
const BACKEND_URL = process.env.BACKEND_URL || "https://gamerivals-site.onrender.com";

const io = new Server(server, {
    cors: {
        origin: FRONTEND_URL,
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization", "x-auth-token"]
    }
});

const PORT = process.env.PORT || 3001;

app.use(cors({
    origin: FRONTEND_URL,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
}));

app.use(express.json());

// =========================================================================
// CONFIGURAÇÃO DO RATE LIMITING
// =========================================================================

// 1. Limiter para rotas de Autenticação (contra Brute-Force/DoS leve)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // Limita cada IP a 100 requisições por janela
    message: { message: 'Muitas requisições desta IP, tente novamente após 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// 2. Limiter para rotas Financeiras Sensíveis (contra DoS pesado)
const sensitiveLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 60 minutos
    max: 10, // Limita cada IP a 10 requisições por hora
    message: { message: 'Muitas requisições sensíveis, tente novamente após 1 hora.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// =========================================================================
// FIM CONFIGURAÇÃO DO RATE LIMITING
// =========================================================================


const avatarsDir = path.join(__dirname, '../img/avatars');

if (!fs.existsSync(avatarsDir)){
    fs.mkdirSync(avatarsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, avatarsDir);
    },
    filename: function (req, file, cb) {
        const userId = req.user.id;
        const fileExtension = path.extname(file.originalname);
        cb(null, `${userId}${fileExtension}`);
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Apenas imagens são permitidas!'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
});

app.use('/avatars', express.static(avatarsDir));

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('Conectado ao MongoDB com sucesso!');
        server.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); });
    })
    .catch((err) => { console.error('Erro ao conectar ao MongoDB:', err); });

let onlineUsers = new Map();
let socketIdToUserId = new Map();
const matchmakingQueue = new Map();

const emitUpdatedUserList = () => {
    io.emit('update user list', Array.from(onlineUsers.values()));
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
};


const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// =========================================================================
// IMPLEMENTAÇÃO DA VALIDAÇÃO COM JOI
// =========================================================================

// Função utilitária de validação
const validateSchema = (schema) => (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) {
        const message = error.details.map(i => i.message.replace(/['"]/g, '')).join(', ');
        return res.status(400).json({ message: message });
    }
    next();
};

// 1. SCHEMAS DE AUTENTICAÇÃO
const registerSchema = Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required().messages({
        'string.alphanum': 'Nome de usuário deve conter apenas letras e números.',
        'string.min': 'Nome de usuário deve ter no mínimo 3 caracteres.',
        'string.max': 'Nome de usuário deve ter no máximo 30 caracteres.',
        'any.required': 'Nome de usuário é obrigatório.'
    }),
    fullName: Joi.string().min(3).required().messages({
        'string.min': 'Nome completo deve ter no mínimo 3 caracteres.',
        'any.required': 'Nome completo é obrigatório.'
    }),
    cpf: Joi.string().pattern(/^[0-9]{11}$/).required().messages({
        'string.pattern.base': 'CPF deve ter 11 dígitos (apenas números).',
        'any.required': 'CPF é obrigatório.'
    }),
    email: Joi.string().email().required().messages({
        'string.email': 'Formato de e-mail inválido.',
        'any.required': 'E-mail é obrigatório.'
    }),
    password: Joi.string().min(6).required().messages({
        'string.min': 'Senha deve ter no mínimo 6 caracteres.',
        'any.required': 'Senha é obrigatória.'
    })
});

const loginSchema = Joi.object({
    email: Joi.string().email().required().messages({
        'string.email': 'E-mail ou senha inválidos.',
        'any.required': 'E-mail é obrigatório.'
    }),
    password: Joi.string().min(6).required().messages({
        'string.min': 'E-mail ou senha inválidos.',
        'any.required': 'Senha é obrigatória.'
    })
});

// 2. SCHEMAS DE DESAFIOS E MATCHMAKING
const consoleOptions = ['PS5', 'PS4', 'XBOX Series', 'Xbox One', 'PC', 'Nintendo Switch']; // MANTIDO PARA VALIDAÇÃO DO CONSOLE

// NOVO SCHEMA: Game
const gameSchema = Joi.object({
    name: Joi.string().min(2).max(50).required().messages({ 'any.required': 'Nome do jogo é obrigatório.' }),
    iconUrl: Joi.string().uri().allow('').optional(),
    supportedConsoles: Joi.array().items(Joi.string().valid(...consoleOptions)).min(1).required().messages({
        'array.min': 'Pelo menos um console deve ser selecionado.',
        'any.required': 'Consoles suportados são obrigatórios.'
    }),
    isActive: Joi.boolean().optional()
});

const challengeCreateSchema = Joi.object({
    game: Joi.string().min(2).max(50).required().messages({ 'any.required': 'Jogo é obrigatório.' }), // Jogo validado no middleware validateGame
    console: Joi.string().valid(...consoleOptions).required().messages({
        'any.required': 'Console é obrigatório.',
        'any.only': 'Console inválido.'
    }),
    betAmount: Joi.number().integer().min(10).required().messages({
        'number.min': 'A aposta mínima é de 10 moedas.',
        'any.required': 'Valor da aposta é obrigatório.'
    }),
    scheduledTime: Joi.string().allow('').optional()
});

const challengePrivateSchema = Joi.object({
    opponentId: Joi.string().length(24).required().messages({
        'string.length': 'ID do oponente inválido.',
        'any.required': 'ID do oponente é obrigatório.'
    }),
    game: Joi.string().min(2).max(50).required().messages({ 'any.required': 'Jogo é obrigatório.' }), // Jogo validado no middleware validateGame
    console: Joi.string().valid(...consoleOptions).required().messages({
        'any.required': 'Console é obrigatório.',
        'any.only': 'Console inválido.'
    }),
    betAmount: Joi.number().integer().min(0).required().messages({
        'number.min': 'A aposta mínima é de 0 moedas.',
        'any.required': 'Valor da aposta é obrigatório.'
    })
});

// 3. SCHEMAS DE CARTEIRA
const withdrawRequestSchema = Joi.object({
    amount: Joi.number().integer().min(1).required().messages({
        'number.min': 'O valor mínimo de saque é 1 moeda.',
        'any.required': 'Valor do saque é obrigatório.'
    }),
    pixKeyType: Joi.string().valid('email', 'cpf', 'phone', 'cnpj').required().messages({
        'any.required': 'Tipo de chave Pix é obrigatório.',
        'any.only': 'Tipo de chave Pix inválido.'
    }),
    pixKeyValue: Joi.string().min(5).max(150).required().messages({
        'string.min': 'Valor da chave Pix inválido.',
        'any.required': 'Valor da chave Pix é obrigatório.'
    })
});

const pixNotifySchema = Joi.object({
    amount: Joi.number().integer().min(10).required().messages({
        'number.min': 'O valor de notificação deve ser no mínimo 10.',
        'any.required': 'Valor é obrigatório.'
    }),
    userId: Joi.string().length(24).required().messages({
        'string.length': 'ID de usuário inválido.',
        'any.required': 'ID de usuário é obrigatório.'
    })
});

// 4. SCHEMAS DE PERFIL E ADMIN
const profileUpdateSchema = Joi.object({
    username: Joi.string().alphanum().min(3).max(30).optional().messages({
        'string.alphanum': 'Nome de usuário deve conter apenas letras e números.',
        'string.min': 'Nome de usuário deve ter no mínimo 3 caracteres.',
        'string.max': 'Nome de usuário deve ter no máximo 30 caracteres.'
    }),
    // bio: Joi.string().max(150).allow('').optional().messages({ // REMOVIDO A PEDIDO
    //     'string.max': 'Bio deve ter no máximo 150 caracteres.'
    // }),
    description: Joi.string().max(500).allow('').optional().messages({
        'string.max': 'Descrição deve ter no máximo 500 caracteres.'
    }),
    console: Joi.string().valid('', ...consoleOptions).optional().messages({
        'any.only': 'Console inválido.'
    })
});

const adminTournamentSchema = Joi.object({
    name: Joi.string().min(5).max(100).required().messages({
        'string.min': 'Nome do campeonato deve ter no mínimo 5 caracteres.',
        'any.required': 'Nome é obrigatório.'
    }),
    game: Joi.string().min(2).max(50).required().messages({ 'any.required': 'Jogo é obrigatório.' }), // Jogo validado no middleware validateGame
    console: Joi.string().valid(...consoleOptions).required().messages({
        'any.required': 'Console é obrigatório.',
        'any.only': 'Console inválido.'
    }),
    betAmount: Joi.number().integer().min(0).required().messages({
        'number.min': 'A aposta mínima é de 0 moedas.',
        'any.required': 'Valor da aposta é obrigatório.'
    }),
    maxParticipants: Joi.number().integer().valid(2, 4, 8, 16, 32, 64).required().messages({
        'any.required': 'Número máximo de participantes é obrigatório.',
        'any.only': 'Máx. participantes deve ser 2, 4, 8, 16, 32 ou 64.'
    }),
    scheduledTime: Joi.string().allow('').optional()
});


// =========================================================================
// FIM JOI IMPLEMENTATION
// =========================================================================

io.on('connection', async (socket) => {
    console.log(`[SOCKET CONNECT] Um novo socket se conectou: ${socket.id}`);

    emitMatchmakingQueueCounts();

    try {
        const lastMessages = await Message.find().sort({ createdAt: 1 }).limit(200);
        socket.emit('init messages', lastMessages);
    } catch (error) {
        console.error("[SOCKET CHAT HISTORY] Erro ao buscar histórico do chat:", error);
    }

    socket.on('user connected', async (user) => {
        if (user && user.id && user.username) {
            const userIdString = String(user.id);
            const currentSocketId = socket.id;
            let listNeedsUpdate = false;

            let avatarUrl = `${FRONTEND_URL}/img/avatar-placeholder.png`;

            try {
                const dbUser = await User.findById(userIdString).select('avatarUrl console');
                if (dbUser) {
                    if (dbUser.avatarUrl) {
                        avatarUrl = dbUser.avatarUrl;
                    }
                    if (dbUser.console) {
                        userConsole = dbUser.console;
                    }
                }
            } catch (err) {
                console.error(`Erro ao buscar avatar/console para user ${userIdString}:`, err.message);
            }

            const existingUserEntry = onlineUsers.get(userIdString);
            if (existingUserEntry && existingUserEntry.socketId !== currentSocketId) {
                console.log(`[SOCKET USER CONNECT] Usuário ${user.username} (ID: ${userIdString}) reconectou com NOVO SOCKET: ${currentSocketId} (Antigo: ${existingUserEntry.socketId})`);
                socketIdToUserId.delete(existingUserEntry.socketId);
                listNeedsUpdate = true;
            } else if (!existingUserEntry) {
                console.log(`[SOCKET USER CONNECT] Novo usuário online: ${user.username} (ID: ${userIdString}, SocketID: ${currentSocketId})`);
                listNeedsUpdate = true;
            } else {
                console.log(`[SOCKET USER CONNECT] Usuário ${user.username} (ID: ${userIdString}, SocketID: ${currentSocketId}) já estava ativo com este socket.`);
                if (existingUserEntry.avatarUrl !== avatarUrl || existingUserEntry.console !== userConsole) {
                    listNeedsUpdate = true;
                }
            }

            onlineUsers.set(userIdString, {
                id: userIdString,
                username: user.username,
                socketId: currentSocketId,
                avatarUrl: avatarUrl,
                console: user.console
            });
            socketIdToUserId.set(currentSocketId, userIdString);

            socket.join(userIdString);

            if (listNeedsUpdate) {
                emitUpdatedUserList();
            }

        } else {
            console.warn('[SOCKET USER CONNECT] Dados de usuário incompletos recebidos para "user connected":', user);
        }
    });

    socket.on('chat message', async (msgData) => {
        try {
            if (!msgData.user || !msgData.text || msgData.text.trim() === '') {
                console.warn('[SOCKET CHAT MESSAGE] Mensagem de chat inválida (vazia ou sem usuário/texto):', msgData);
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
        } catch (error) {
            console.error("[SOCKET CHAT MESSAGE] Erro ao salvar/emitir mensagem do chat:", error);
        }
    });

    socket.on('private message', async (data) => {
        const senderUserId = socketIdToUserId.get(socket.id);
        const sender = onlineUsers.get(senderUserId);
        const recipient = onlineUsers.get(data.toUserId);

        try {
            const senderDB = await User.findById(senderUserId);
            const recipientDB = await User.findById(data.toUserId);

            if (senderDB.blockedUsers.includes(data.toUserId) || recipientDB.blockedUsers.includes(senderUserId)) {
                console.log('[SOCKET PRIVATE CHAT] Tentativa de enviar mensagem privada para/de um usuário bloqueado. Ação negada.');
                return;
            }
        } catch (error) {
            console.error('[SOCKET PRIVATE CHAT] Erro ao verificar bloqueio:', error);
            return; 
        }

        if (recipient && sender && String(recipient.id) !== String(sender.id) && data.text && data.text.trim() !== '') {
            const messageData = {
                text: data.text.trim(),
                from: { id: sender.id, username: sender.username },
                to: { id: recipient.id, username: recipient.username }
            };

            io.to(recipient.socketId).emit('private message', messageData);
            io.to(sender.socketId).emit('private message', messageData);
        } else {
            console.warn('[SOCKET PRIVATE CHAT] Falha ao enviar mensagem privada. Destinatário não encontrado, remetente inválido, enviando para si mesmo ou mensagem vazia.', data);
        }
    });

    socket.on('join matchmaking queue', async (data) => {
        const userId = data.id;
        const game = data.game;
        const platform = data.console;
        const betAmount = data.betAmount;

        if (!userId || !game || !platform || !betAmount) {
            socket.emit('matchmaking error', { message: 'Dados incompletos para entrar na fila.' });
            return;
        }

        const user = onlineUsers.get(userId);
        if (!user) {
            socket.emit('matchmaking error', { message: 'Seu status online não foi detectado. Tente novamente.' });
            return;
        }

        matchmakingQueue.forEach((consoleMap, gameKey) => {
            consoleMap.forEach((betAmountMap, consoleKey) => {
                betAmountMap.forEach((userMap, betKey) => {
                    if (userMap.has(userId)) {
                        userMap.delete(userId);
                        emitMatchmakingQueueCounts();
                    }
                });
            });
        });

        let foundOpponentObject = null;

        if (matchmakingQueue.has(game)) {
            const consoleMap = matchmakingQueue.get(game);
            if (consoleMap.has(platform)) {
                const betAmountMap = consoleMap.get(platform);
                for (const [betKey, userMap] of betAmountMap.entries()) {
                    for (const [entryUserId, entry] of userMap.entries()) {
                        if (entry && String(entryUserId) !== String(userId)) {
                            const currentUserDB = await User.findById(userId);
                            const opponentUserDB = await User.findById(entryUserId);

                            if (currentUserDB && opponentUserDB && !currentUserDB.blockedUsers.includes(entryUserId) && !opponentUserDB.blockedUsers.includes(userId)) {
                                foundOpponentObject = entry;
                                userMap.delete(entryUserId);
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

                if (!creatorId || creatorId === 'undefined' || creatorId.length === 0) {
                    throw new Error(`Creator ID é undefined, vazio ou inválido: "${creatorId}". foundOpponentObject: ${JSON.stringify(foundOpponentObject)}`);
                }
                if (!opponentId || opponentId === 'undefined' || opponentId.length === 0) {
                    throw new Error(`Opponent ID é undefined, vazio ou inválido: "${opponentId}"`);
                }

                const newChallenge = new Challenge({
                    game: game,
                    console: platform,
                    betAmount: betAmount,
                    createdBy: creatorId,
                    opponent: opponentId,
                    status: 'accepted'
                });
                await newChallenge.save();

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
                
                io.to(foundOpponentObject.socketId).emit('challenge updated');
                io.to(user.socketId).emit('challenge updated');


            } catch (error) {
                console.error('[MATCHMAKING] Erro ao criar desafio após encontrar partida:', error);
                socket.emit('matchmaking error', { message: 'Erro ao criar partida. Tente novamente.' });
                if (foundOpponentObject && foundOpponentObject.socketId) io.to(foundOpponentObject.socketId).emit('matchmaking error', { message: 'Erro ao criar partida. Tente novamente.' });
            }

        } else {
            if (!matchmakingQueue.has(game)) {
                matchmakingQueue.set(game, new Map());
            }
            const consoleMap = matchmakingQueue.get(game);
            if (!consoleMap.has(platform)) {
                consoleMap.set(platform, new Map());
            }
            const betAmountMap = consoleMap.get(platform);
            if (!betAmountMap.has(betAmount)) {
                betAmountMap.set(betAmount, new Map());
            }
            const userMap = betAmountMap.get(betAmount);
            userMap.set(userId, {
                socketId: user.socketId,
                username: user.username,
                betAmount: betAmount,
                userId: userId
            });

            socket.emit('matchmaking status', { inQueue: true, game, console: platform, betAmount, message: 'Procurando partida...' });
            emitMatchmakingQueueCounts();
        }
    });

    socket.on('leave matchmaking queue', (data) => {
        const userId = data.userId;
        const user = onlineUsers.get(userId);

        if (!user) {
            return;
        }

        let removedFromQueue = false;
        matchmakingQueue.forEach((consoleMap) => {
            consoleMap.forEach((betAmountMap) => {
                betAmountMap.forEach((userMap) => {
                    if (userMap.has(userId)) {
                        userMap.delete(userId);
                        removedFromQueue = true;
                        emitMatchmakingQueueCounts();
                    }
                });
            });
        });

        if (removedFromQueue) {
            socket.emit('matchmaking status', { inQueue: false, message: 'Você saiu da fila de espera.' });
        } else {
            socket.emit('matchmaking status', { inQueue: false, message: 'Você não estava em nenhuma fila de espera.' });
        }
    });

    socket.on('request matchmaking queue counts', () => {
        emitMatchmakingQueueCounts();
    });

    socket.on('disconnect', async () => {
        const userIdOnDisconnect = socketIdToUserId.get(socket.id);
        let listNeedsUpdate = false;

        if (userIdOnDisconnect) {
            const disconnectedUserEntry = onlineUsers.get(userIdOnDisconnect);

            if (disconnectedUserEntry && disconnectedUserEntry.socketId === socket.id) {
                onlineUsers.delete(userIdOnDisconnect);
                listNeedsUpdate = true;

                matchmakingQueue.forEach((consoleMap) => {
                    consoleMap.forEach((betAmountMap) => {
                        betAmountMap.forEach((userMap) => {
                            if (userMap.has(userIdOnDisconnect)) {
                                userMap.delete(userIdOnDisconnect);
                                emitMatchmakingQueueCounts();
                            }
                        });
                    });
                });

            } else {
                console.log(`[SOCKET DISCONNECT] Socket ${socket.id} desconectado, but nenhum usuário associado foi encontrado.`);
            }
            socketIdToUserId.delete(socket.id);
        } else {
            console.log(`[SOCKET DISCONNECT] Um socket se desconectou (ID: ${socket.id}), but nenhum usuário associado foi encontrado.`);
        }

        if (listNeedsUpdate) {
            emitUpdatedUserList();
            io.emit('friend request resolved');
        }
    });

    socket.on('error', (err) => {
        console.error(`[SOCKET ERROR] Erro no socket ${socket.id}:`, err);
    });
});

// =========================================================================
// MIDDLEWARE DE VALIDAÇÃO DE JOGO
// =========================================================================

const validateGame = async (req, res, next) => {
    const gameName = req.body.game;
    try {
        const game = await Game.findOne({ name: gameName, isActive: true });
        if (!game) {
            return res.status(400).json({ message: `O jogo "${gameName}" não está ativo ou não existe.` });
        }
        if (!game.supportedConsoles.includes(req.body.console)) {
            return res.status(400).json({ message: `O console "${req.body.console}" não é suportado pelo jogo "${gameName}".` });
        }
        req.gameData = game; // Anexar dados do jogo para uso posterior
        next();
    } catch (error) {
        console.error('[Middleware Game Validation] Erro:', error);
        res.status(500).json({ message: 'Erro de validação do jogo no servidor.' });
    }
};

// =========================================================================
// ROTAS DE AUTENTICAÇÃO (PROTEGIDAS POR authLimiter)
// =========================================================================

app.post('/api/register', authLimiter, (req, res, next) => {
    // CORREÇÃO ESSENCIAL: Remove a máscara do CPF no backend antes da validação
    if (req.body.cpf) {
        req.body.cpf = req.body.cpf.replace(/\D/g, '');
    }
    validateSchema(registerSchema)(req, res, next);
}, async (req, res) => {
    try {
        const { username, fullName, cpf, email, password } = req.body;
        
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            if (existingUser.email === email) {
                return res.status(400).json({ message: 'E-mail já cadastrado.' });
            } else {
                return res.status(400).json({ message: 'Nome de usuário já cadastrado.' });
            }
        }
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        // O campo 'cpf' aqui já estará limpo devido ao middleware acima
        const newUser = new User({ username, fullName, cpf, email, password: hashedPassword, wins: 0, losses: 0, coins: 1000, role: 'user', isActive: true, profileCompleted: false });
        await newUser.save();
        res.status(201).json({ message: 'Usuário cadastrado com sucesso.' });
    }
    catch (error) {
        console.error('[API REGISTER] Erro no cadastro:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

app.post('/api/login', authLimiter, validateSchema(loginSchema), async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Credenciais inválidas.' });
        }
        if (!user.isActive) {
            return res.status(403).json({ message: 'Sua conta está desativada. Entre em contato com o suporte.' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Credenciais inválidas.' });
        }

        const payload = { id: user.id, username: user.username, role: user.role };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' }); 

        res.status(200).json({ message: 'Login bem-sucedido.', token: token, username: user.username, userId: user.id, userRole: user.role, profileCompleted: user.profileCompleted });
    }
    catch (error) {
        console.error('[API LOGIN] Erro no login:', error);
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

app.post('/api/forgot-password', authLimiter, validateSchema(Joi.object({
    email: Joi.string().email().required().messages({
        'string.email': 'Formato de e-mail inválido.',
        'any.required': 'E-mail é obrigatório.'
    })
})), async (req, res) => {
    try {
        const { email } = req.body;
        
        const user = await User.findOne({ email });
        if (!user) { return res.status(200).json({ message: 'Se o e-mail estiver cadastrado, um link de redefinição será enviado.' }); }
        
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpires = Date.now() + 3600000;
        
        user.resetPasswordToken = resetToken; user.resetPasswordExpires = resetExpires; await user.save();
        
        const resetUrl = `${FRONTEND_URL}/login-split-form.html?resetToken=${resetToken}`;
        const mailOptions = { to: user.email, from: process.env.EMAIL_USER, subject: 'GameRivals - Redefinição de Senha', html: `<p>Você solicitou uma redefinição de senha para sua conta GameRivals.</p><p>Por favor, clique no link a seguir para redefinir sua senha:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Este link expirará em 1 hora.</p><p>Se você não solicitou esta redefinição, por favor, ignore este e-mail.</p>` };
        
        await transporter.sendMail(mailOptions);
        
        res.status(200).json({ message: 'Se o e-mail estiver cadastrado, um link de redefinição será enviado.' });
    } catch (error) {
        console.error('[API FORGOT PASSWORD] Erro ao solicitar redefinição de senha:', error);
        res.status(500).json({ message: 'Erro no servidor ao processar a solicitação de redefinição de senha.' });
    }
});

app.post('/api/reset-password/:token', authLimiter, validateSchema(Joi.object({
    newPassword: Joi.string().min(6).required().messages({
        'string.min': 'A nova senha deve ter pelo menos 6 caracteres.',
        'any.required': 'A nova senha é obrigatória.'
    })
})), async (req, res) => {
    try {
        const { token } = req.params; 
        const { newPassword } = req.body;
        
        const user = await User.findOne({ resetPasswordToken: token, resetPasswordExpires: { $gt: Date.now() } });
        if (!user) { return res.status(400).json({ message: 'Token de redefinição de senha inválido ou expirado.' }); }
        
        const salt = await bcrypt.genSalt(10); 
        user.password = await bcrypt.hash(newPassword, salt);
        
        user.resetPasswordToken = undefined; user.resetPasswordExpires = undefined; await user.save();
        
        const mailOptionsConfirm = { to: user.email, from: process.env.EMAIL_USER, subject: 'GameRivals - Sua senha foi redefinida com sucesso', html: '<p>Sua senha da conta GameRivals foi redefinida com sucesso.</p><p>Se você não fez esta alteração, por favor, entre em contato com o suporte imediatamente.</p>' };
        await transporter.sendMail(mailOptionsConfirm);
        
        res.status(200).json({ message: 'Sua senha foi redefinida com sucesso.' });
    } catch (error) {
        console.error('[API RESET PASSWORD] Erro ao redefinir senha:', error);
        res.status(500).json({ message: 'Erro no servidor ao redefinir a senha.' });
    }
});

// =========================================================================
// ROTAS FINANCEIRAS (PROTEGIDAS POR sensitiveLimiter)
// =========================================================================

app.post('/api/payment/notify-pix', auth, sensitiveLimiter, validateSchema(pixNotifySchema), async (req, res) => {
    const { amount, userId } = req.body;

    try {
        if (String(req.user.id) !== String(userId)) {
             return res.status(403).json({ message: 'O ID de usuário fornecido não corresponde ao usuário autenticado.' });
        }

        const newNotification = new PixPaymentNotification({
            userId: userId,
            amount: amount,
            status: 'pending'
        });
        await newNotification.save();
        
        console.log(`[PIX NOTIFY] Usuário ${req.user.username} (ID: ${userId}) notificou um pagamento de ${amount} moedas.`);
        
        res.status(200).json({ message: 'Notificação de pagamento recebida. Seu pagamento será verificado em breve!' });

    } catch (error) {
        console.error('[API PAYMENT NOTIFY] Erro ao salvar notificação de Pix:', error);
        res.status(500).json({ message: 'Erro interno ao processar a notificação.' });
    }
});

app.post('/api/wallet/withdraw-request', auth, sensitiveLimiter, validateSchema(withdrawRequestSchema), async (req, res) => {
    const { amount, pixKeyType, pixKeyValue } = req.body;
    const userId = req.user.id;

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        if (user.coins < amount) {
            return res.status(400).json({ message: 'Saldo insuficiente para realizar este saque.' });
        }

        const newWithdrawal = new WithdrawalRequest({
            userId: userId,
            amount: amount,
            pixKeyType: pixKeyType,
            pixKeyValue: pixKeyValue
        });
        await newWithdrawal.save();

        user.coins -= amount;
        await user.save();

        console.log(`[WITHDRAWAL REQUEST] Usuário ${user.username} solicitou um saque de ${amount} moedas para a chave Pix (${pixKeyType}): ${pixKeyValue}`);

        res.status(200).json({ message: 'Solicitação de saque enviada com sucesso! Aguarde a aprovação.' });

    } catch (error) {
        console.error('[API WALLET] Erro ao solicitar saque:', error);
        res.status(500).json({ message: 'Erro no servidor ao processar a solicitação de saque.' });
    }
});

// =========================================================================
// ROTAS DE DESAFIO, USUÁRIO, AMIGOS E ADMIN
// =========================================================================

app.post('/api/challenges', auth, validateSchema(challengeCreateSchema), validateGame, async (req, res) => { // ADICIONADO validateGame
    try {
        const { game, console: platform, betAmount, scheduledTime } = req.body;
        
        const user = await User.findById(req.user.id);
        if (user.coins < betAmount) { return res.status(400).json({ message: 'Você não tem moedas suficientes para esta aposta.' }); }
        
        const newChallenge = new Challenge({ game, console: platform, betAmount, scheduledTime, createdBy: req.user.id });
        await newChallenge.save();
        
        if (betAmount > 0) { user.coins -= betAmount; await user.save(); }
        
        io.emit('challenge created');
        res.status(201).json(newChallenge);
    } catch (error) {
        console.error('[API CHALLENGE] Erro ao criar desafio:', error);
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

app.post('/api/challenges/private', auth, validateSchema(challengePrivateSchema), validateGame, async (req, res) => { // ADICIONADO validateGame
    try {
        const { opponentId, game, console: platform, betAmount } = req.body;
        const createdBy = req.user.id;
        
        if (String(createdBy) === String(opponentId)) { return res.status(400).json({ message: 'Você não pode desafiar a si mesmo.' }); }
        
        const creatorUser = await User.findById(createdBy);
        const opponentUser = await User.findById(opponentId);
        
        if (!creatorUser || !opponentUser) { return res.status(404).json({ message: 'Criador ou oponente não encontrado.' }); }
        if (!creatorUser.friends.includes(opponentId)) { return res.status(400).json({ message: 'Você só pode desafiar amigos diretamente.' }); }
        
        if (creatorUser.blockedUsers.includes(opponentId) || opponentUser.blockedUsers.includes(createdBy)) {
            return res.status(403).json({ message: 'Você não pode desafiar um usuário que você bloqueou, ou que te bloqueou.' });
        }
        
        if (betAmount > 0 && creatorUser.coins < betAmount) { return res.status(400).json({ message: 'Você não tem moedas suficientes para esta aposta.' }); }
        if (betAmount > 0 && opponentUser.coins < betAmount) { return res.status(400).json({ message: `${opponentUser.username} não tem moedas suficientes para aceitar esta aposta.` }); }
        
        const newChallenge = new Challenge({ game, console: platform, betAmount, createdBy: createdBy, opponent: opponentId, status: 'open' });
        await newChallenge.save();
        
        const opponentSocketId = onlineUsers.get(String(opponentId))?.socketId;
        if (opponentSocketId) { io.to(opponentSocketId).emit('private challenge received', { challengeId: newChallenge._id, senderUsername: creatorUser.username, game: newChallenge.game, console: newChallenge.console, betAmount: newChallenge.betAmount, createdBy: createdBy }); }
        
        const creatorSocketId = onlineUsers.get(String(createdBy))?.socketId;
        io.to(creatorSocketId).emit('challenge updated');
        
        res.status(201).json({ message: 'Desafio privado criado com sucesso e enviado ao seu amigo.', challenge: newChallenge });
    } catch (error) {
        console.error('[API CHALLENGE] Erro ao criar desafio privado:', error);
        res.status(500).json({ message: 'Erro no servidor ao criar desafio privado.' });
    }
});

app.get('/api/challenges', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        const blockedUsers = user.blockedUsers;
        
        const challenges = await Challenge.find({ 
            status: 'open',
            createdBy: { $nin: blockedUsers } 
        }).populate('createdBy', 'username avatarUrl').sort({ createdAt: -1 });

        res.json(challenges);
    } catch (error) {
        console.error('[API CHALLENGE] Erro ao buscar desafios:', error);
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

app.patch('/api/challenges/:id/accept', auth, async (req, res) => {
    try {
        const challenge = await Challenge.findById(req.params.id);
        if (!challenge) { return res.status(404).json({ message: 'Desafio não encontrado.' }); }
        if (challenge.status !== 'open') { return res.status(400).json({ message: 'Este desafio não está mais aberto para ser aceito.' }); }
        if (challenge.createdBy.toString() === req.user.id) { return res.status(400).json({ message: 'Você não pode aceitar seu próprio desafio.' }); }
        if (challenge.opponent && String(challenge.opponent) !== String(req.user.id)) { return res.status(403).json({ message: 'Este desafio é privado e não foi feito para você.' }); }
        const acceptorUser = await User.findById(req.user.id);
        if (challenge.betAmount > 0 && acceptorUser.coins < challenge.betAmount) { return res.status(400).json({ message: 'Você não tem moedas suficientes para esta aposta.' }); }
        challenge.opponent = req.user.id;
        challenge.status = 'accepted';
        await challenge.save();
        if (challenge.betAmount > 0) { acceptorUser.coins -= challenge.betAmount; await acceptorUser.save(); }
        const creatorSocketId = onlineUsers.get(String(challenge.createdBy))?.socketId;
        const opponentSocketId = onlineUsers.get(String(challenge.opponent))?.socketId;
        if (creatorSocketId) io.to(creatorSocketId).emit('challenge updated');
        if (opponentSocketId) io.to(opponentSocketId).emit('challenge updated');
        io.emit('challenge created');
        res.json(challenge);
    } catch (error) {
        console.error('[API CHALLENGE] Erro ao aceitar desafio:', error);
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

app.get('/api/my-challenges', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User.findById(userId);
        const blockedUsers = user.blockedUsers;
        
        const myChallenges = await Challenge.find({ 
            $or: [
                { createdBy: userId, opponent: { $nin: blockedUsers } }, 
                { opponent: userId, createdBy: { $nin: blockedUsers } }
            ], 
            archivedBy: { $ne: userId } 
        })
        .populate('createdBy', 'username avatarUrl')
        .populate('opponent', 'username avatarUrl')
        .sort({ createdAt: -1 });

        res.json(myChallenges);
    } catch (error) {
        console.error('[API CHALLENGE] Erro ao buscar meus desafios:', error);
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

app.post('/api/challenges/:id/result', auth, async (req, res) => {
    try {
        const { winnerId } = req.body;
        const challengeId = req.params.id;
        const reporterId = req.user.id;
        const challenge = await Challenge.findById(challengeId);
        if (!challenge) { return res.status(404).json({ message: "Desafio não encontrado." }); }
        if (challenge.status !== 'accepted') { return res.status(400).json({ message: "Este desafio não está em andamento para ter um resultado reportado." }); }
        const playerIds = [challenge.createdBy.toString(), challenge.opponent.toString()];
        if (!playerIds.includes(reporterId)) { return res.status(403).json({ message: "Você não faz parte deste desafio para reportar um resultado." }); }
        if (!winnerId || !playerIds.includes(winnerId)) { return res.status(400).json({ message: "O vencedor informado não é válido para esta partida." }); }
        const hasAlreadyReported = challenge.results.some(result => result.reportedBy.toString() === reporterId);
        if (hasAlreadyReported) { return res.status(400).json({ message: "Você já reportou um resultado para esta partida." }); }
        challenge.results.push({ reportedBy: reporterId, winner: winnerId });
        if (challenge.results.length === 1) { await challenge.save(); return res.json({ message: "Seu resultado foi registrado. Aguardando oponente.", challenge }); }
        else if (challenge.results.length === 2) {
            const firstReport = challenge.results[0];
            const secondReport = challenge.results[1];
            if (firstReport.winner.toString() === secondReport.winner.toString()) {
                challenge.winner = firstReport.winner; challenge.status = 'completed'; await challenge.save();
                const loserId = playerIds.find(id => id !== firstReport.winner.toString());
                if (challenge.betAmount > 0) { await User.findByIdAndUpdate(firstReport.winner, { $inc: { wins: 1, coins: challenge.betAmount } }); await User.findByIdAndUpdate(loserId, { $inc: { losses: 1, coins: -challenge.betAmount } }); }
                else { await User.findByIdAndUpdate(firstReport.winner, { $inc: { wins: 1 } }); await User.findByIdAndUpdate(loserId, { $inc: { losses: 1 } }); }
                const winnerSocketId = onlineUsers.get(firstReport.winner.toString())?.socketId;
                const loserSocketId = onlineUsers.get(loserId)?.socketId;
                if (winnerSocketId) io.to(winnerSocketId).emit('challenge updated');
                if (loserSocketId) io.to(loserSocketId).emit('challenge updated');
                return res.json({ message: "Resultado confirmado! Partida finalizada.", challenge });
            } else { challenge.status = 'disputed'; await challenge.save();
                const player1SocketId = onlineUsers.get(playerIds[0])?.socketId;
                const player2SocketId = onlineUsers.get(playerIds[1])?.socketId;
                if (player1SocketId) io.to(player1SocketId).emit('challenge updated');
                if (player2SocketId) io.to(player2SocketId).emit('challenge updated');
                return res.status(409).json({ message: "Resultados conflitantes. A partida entrou em análise pelo suporte.", challenge });
            }
        }
    } catch (error) {
        console.error('[API CHALLENGE] Erro ao reportar resultado:', error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

app.patch('/api/challenges/:id/archive', auth, async (req, res) => {
    try {
        const challengeId = req.params.id;
        const userId = req.user.id;
        const challenge = await Challenge.findById(challengeId);
        if (!challenge) { return res.status(404).json({ message: "Desafio não encontrado." }); }
        await Challenge.findByIdAndUpdate(challengeId, { $addToSet: { archivedBy: userId } });
        res.json({ message: "Desafio arquivado com sucesso." });
    } catch (error) {
        console.error('[API CHALLENGE] Erro ao arquivar desafio:', error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

app.patch('/api/challenges/:id/cancel', auth, async (req, res) => {
    try {
        const challengeId = req.params.id;
        const userId = req.user.id;
        const challenge = await Challenge.findById(challengeId);
        if (!challenge) { return res.status(404).json({ message: "Desafio não encontrado." }); }

        if (challenge.status !== 'open') {
            return res.status(400).json({ message: "Apenas desafios abertos podem ser cancelados." });
        }

        if (String(challenge.createdBy) !== String(userId)) {
            return res.status(403).json({ message: "Você não tem permissão para cancelar este desafio." });
        }

        if (challenge.betAmount > 0) {
            await User.findByIdAndUpdate(userId, { $inc: { coins: challenge.betAmount } });
        }

        challenge.status = 'cancelled';
        await challenge.save();

        io.emit('challenge created');
        
        const creatorSocketId = onlineUsers.get(String(userId))?.socketId;
        if (creatorSocketId) {
            io.to(creatorSocketId).emit('challenge updated');
        }

        res.json({ message: "Desafio cancelado com sucesso. Suas moedas foram devolvidas." });

    } catch (error) {
        console.error('[API CHALLENGE] Erro ao cancelar desafio:', error);
        res.status(500).json({ message: 'Erro no servidor ao cancelar desafio.' });
    }
});

app.get('/api/users/me/stats', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('wins losses coins');
        if (!user) { return res.status(404).json({ message: 'Usuário não encontrado.' }); }
        res.json(user);
    } catch (error) {
        console.error('[API USER] Erro ao buscar estatísticas:', error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

app.get('/api/users/me', auth, async (req, res) => {
    try {
        // Incluir lastUsernameChange e remover 'bio' da seleção
        const user = await User.findById(req.user.id).select('-password -bio');
        if (!user) { return res.status(404).json({ message: 'Usuário não encontrado.' }); }
        res.json(user);
    } catch (error) {
        console.error('[API PROFILE] Erro ao buscar perfil:', error);
        res.status(500).json({ message: 'Erro no servidor ao buscar perfil.' });
    }
});

app.post('/api/users/:userId/block', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const targetUserId = req.params.userId;
        if (userId === targetUserId) { return res.status(400).json({ message: 'Você não pode bloquear a si mesmo.' }); }
        const user = await User.findByIdAndUpdate(userId, { $addToSet: { blockedUsers: targetUserId } }, { new: true });
        await User.findByIdAndUpdate(userId, { $pull: { friends: targetUserId } });
        await User.findByIdAndUpdate(targetUserId, { $pull: { friends: userId } });
        await FriendRequest.deleteMany({ $or: [{ sender: userId, receiver: targetUserId }, { sender: targetUserId, receiver: userId }] });
        res.status(200).json({ message: 'Usuário bloqueado com sucesso.' });
    } catch (error) {
        console.error('[API USER] Erro ao bloquear usuário:', error);
        res.status(500).json({ message: 'Erro no servidor ao bloquear usuário.' });
    }
});

app.delete('/api/users/:userId/unblock', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const targetUserId = req.params.userId;
        await User.findByIdAndUpdate(userId, { $pull: { blockedUsers: targetUserId } });
        res.status(200).json({ message: 'Usuário desbloqueado com sucesso.' });
    } catch (error) {
        console.error('[API USER] Erro ao desbloquear usuário:', error);
        res.status(500).json({ message: 'Erro no servidor ao desbloquear usuário.' });
    }
});

app.get('/api/search', auth, async (req, res) => {
    try {
        const query = req.query.q;
        const userId = req.user.id;
        if (!query || query.length < 3) { return res.status(400).json({ message: 'A pesquisa deve ter pelo menos 3 caracteres.' }); }

        const user = await User.findById(userId);
        const blockedUsers = user.blockedUsers;
        
        const users = await User.find({ 
            username: { $regex: query, $options: 'i' }, 
            _id: { $ne: userId, $nin: blockedUsers }, 
            role: 'user' 
        })
        .where('_id').nin(await User.find({ blockedUsers: userId }).distinct('_id'))
        .select('username avatarUrl console');

        const formattedResults = [];
        users.forEach(user => { formattedResults.push({ type: 'player', _id: user._id, username: user.username, avatarUrl: user.avatarUrl, console: user.console }); });
        res.status(200).json(formattedResults);
    } catch (error) {
        console.error('[API SEARCH] Erro ao pesquisar usuários e grupos:', error);
        res.status(500).json({ message: 'Erro no servidor ao pesquisar.' });
    }
});

app.get('/api/users/:id', auth, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password -email -friends -sentFriendRequests -receivedFriendRequests');
        if (!user) { return res.status(404).json({ message: 'Usuário não encontrado.' }); }
        res.json(user);
    } catch (error) {
        console.error('[API PROFILE] Erro ao buscar perfil do usuário:', error);
        res.status(500).json({ message: 'Erro no servidor ao buscar perfil do usuário.' });
    }
});

app.patch('/api/users/profile', auth, upload.single('avatar'), validateSchema(profileUpdateSchema), async (req, res) => {
    try {
        const userId = req.user.id;
        const updates = req.body;
        const user = await User.findById(userId);
        if (!user) { return res.status(404).json({ message: 'Usuário não encontrado.' }); }
        
        // Cooldown de 30 dias para a mudança de username
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        const lastChangeTime = user.lastUsernameChange ? user.lastUsernameChange.getTime() : 0;
        const canChangeUsername = (Date.now() - lastChangeTime) >= thirtyDays;
        
        if (updates.username && updates.username !== user.username) {
            
            if (!canChangeUsername) {
                // Calcula o tempo restante
                const timeRemaining = lastChangeTime + thirtyDays - Date.now();
                const daysRemaining = Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));
                
                if (req.file) { fs.unlinkSync(req.file.path); }
                return res.status(400).json({ message: `Você só pode mudar o nome de usuário novamente em ${daysRemaining} dias.` });
            }
            
            // Verifica se o novo username está disponível
            const existingUsername = await User.findOne({ username: updates.username });
            if (existingUsername && String(existingUsername._id) !== String(user._id)) {
                if (req.file) { fs.unlinkSync(req.file.path); }
                return res.status(400).json({ message: 'Nome de usuário já está em uso.' });
            }
            
            // Aplica a mudança e atualiza o timestamp
            user.username = updates.username;
            user.lastUsernameChange = Date.now(); // Atualiza o timestamp da última mudança
        }
        
        // if (updates.bio !== undefined) user.bio = updates.bio; // REMOVIDO
        if (updates.description !== undefined) user.description = updates.description;
        if (updates.console !== undefined) user.console = updates.console;
        
        if (req.file) { user.avatarUrl = `${BACKEND_URL}/avatars/${req.file.filename}`; }
        
        if (!user.profileCompleted && user.username && user.console) { 
             user.profileCompleted = true; 
        }

        await user.save();
        
        if (onlineUsers.has(userId)) {
            const onlineUser = onlineUsers.get(userId);
            onlineUser.username = user.username; onlineUser.avatarUrl = user.avatarUrl; onlineUser.console = user.console;
            onlineUsers.set(userId, onlineUser); emitUpdatedUserList();
        }
        // Retorna o novo campo
        res.json({ message: 'Perfil atualizado com sucesso.', user: { 
            username: user.username, 
            avatarUrl: user.avatarUrl, 
            profileCompleted: user.profileCompleted, 
            console: user.console,
            lastUsernameChange: user.lastUsernameChange // Retorna para o frontend
        } });
    } catch (error) {
        console.error('[API PROFILE] Erro ao atualizar perfil:', error);
        if (req.file) { fs.unlink(req.file.path, (err) => { if (err) console.error('Erro ao excluir arquivo de avatar após falha:', err); }); }
        if (error.code === 'LIMIT_FILE_SIZE') { return res.status(400).json({ message: 'O arquivo é muito grande. Tamanho máximo é 5MB.' }); }
        res.status(500).json({ message: 'Erro no servidor ao atualizar perfil.' });
    }
});

app.post('/api/friends/request/:receiverId', auth, async (req, res) => {
    try {
        const senderId = req.user.id; const receiverId = req.params.receiverId;
        if (String(senderId) === String(receiverId)) { return res.status(400).json({ message: 'Você não pode enviar uma solicitação de amizade para si mesmo.' }); }
        const sender = await User.findById(senderId); const receiver = await User.findById(receiverId);
        if (!sender || !receiver) { return res.status(404).json({ message: 'Usuário remetente ou destinatário não encontrado.' }); }
        if (sender.friends.includes(receiverId)) { return res.status(400).json({ message: 'Vocês já são amigos.' }); }
        
        if (sender.blockedUsers.includes(receiverId) || receiver.blockedUsers.includes(senderId)) {
            return res.status(403).json({ message: 'Não é possível enviar uma solicitação para um usuário bloqueado ou que te bloqueou.' });
        }
        
        const existingRequest = await FriendRequest.findOne({ sender: senderId, receiver: receiverId, status: 'pending' });
        if (existingRequest) { return res.status(400).json({ message: 'Solicitação de amizade já enviada.' }); }
        const reverseRequest = await FriendRequest.findOne({ sender: receiverId, receiver: senderId, status: 'pending' });
        if (reverseRequest) {
            reverseRequest.status = 'accepted'; await reverseRequest.save();
            sender.friends.push(receiverId); receiver.friends.push(senderId);
            sender.receivedFriendRequests = sender.receivedFriendRequests.filter(reqId => String(reqId) !== String(reverseRequest._id));
            await sender.save(); await receiver.save();
            const senderSocketId = onlineUsers.get(senderId)?.socketId; const receiverSocketId = onlineUsers.get(receiverId)?.socketId;
            if (senderSocketId) io.to(senderSocketId).emit('friend request accepted', { user: receiver.username, userId: receiver._id });
            if (receiverSocketId) io.to(receiverSocketId).emit('friend request accepted', { user: sender.username, userId: sender._id });
            io.to(senderSocketId).emit('friend request resolved'); io.to(receiverSocketId).emit('friend request resolved');
            return res.status(200).json({ message: `Vocês agora são amigos com ${receiver.username}. Solicitação aceita automaticamente.` });
        }
        const newRequest = new FriendRequest({ sender: senderId, receiver: receiverId });
        await newRequest.save();
        sender.sentFriendRequests.push(newRequest._id); receiver.receivedFriendRequests.push(newRequest._id);
        await sender.save(); await receiver.save();
        const receiverSocketId = onlineUsers.get(receiverId)?.socketId;
        if (receiverSocketId) { io.to(receiverSocketId).emit('new friend request', { requestId: newRequest._id, senderId: sender._id, senderUsername: sender.username, senderAvatar: sender.avatarUrl, senderConsole: sender.console }); }
        res.status(201).json({ message: 'Solicitação de amizade enviada com sucesso.' });
    } catch (error) {
        console.error('[API FRIENDS] Erro ao enviar solicitação de amizade:', error);
        if (error.code === 11000) { return res.status(400).json({ message: 'Já existe uma solicitação de amizade pendente para este usuário.' }); }
        res.status(500).json({ message: 'Erro no servidor ao enviar solicitação de amizade.' });
    }
});

app.patch('/api/friends/request/:requestId/accept', auth, async (req, res) => {
    try {
        const userId = req.user.id; const requestId = req.params.requestId;
        const friendRequest = await FriendRequest.findById(requestId);
        if (!friendRequest || String(friendRequest.receiver) !== String(userId) || friendRequest.status !== 'pending') { return res.status(404).json({ message: 'Solicitação de amizade não encontrada ou não é sua.' }); }
        friendRequest.status = 'accepted'; await friendRequest.save();
        const sender = await User.findById(friendRequest.sender); const receiver = await User.findById(friendRequest.receiver);
        if (!sender || !receiver) { return res.status(404).json({ message: 'Usuário remetente ou destinatário não encontrado.' }); }
        if (!sender.friends.includes(userId)) { sender.friends.push(userId); }
        if (!receiver.friends.includes(friendRequest.sender)) { receiver.friends.push(friendRequest.sender); }
        sender.sentFriendRequests = sender.sentFriendRequests.filter(reqId => String(reqId) !== String(requestId));
        receiver.receivedFriendRequests = receiver.receivedFriendRequests.filter(reqId => String(reqId) !== String(requestId));
        await sender.save(); await receiver.save();
        const senderSocketId = onlineUsers.get(String(sender._id))?.socketId; const receiverSocketId = onlineUsers.get(userId)?.socketId;
        if (senderSocketId) io.to(senderSocketId).emit('friend request accepted', { user: receiver.username, userId: receiver._id });
        if (receiverSocketId) io.to(receiverSocketId).emit('friend request accepted', { user: sender.username, userId: sender._id });
        io.to(senderSocketId).emit('friend request resolved'); io.to(receiverSocketId).emit('friend request resolved');
        return res.status(200).json({ message: `Você e ${sender.username} agora são amigos.` });
    } catch (error) {
        console.error('[API FRIENDS] Erro ao aceitar solicitação de amizade:', error);
        res.status(500).json({ message: 'Erro no servidor ao aceitar solicitação de amizade.' });
    }
});

app.patch('/api/friends/request/:requestId/reject', auth, async (req, res) => {
    try {
        const userId = req.user.id; const requestId = req.params.requestId;
        const friendRequest = await FriendRequest.findById(requestId);
        if (!friendRequest || String(friendRequest.receiver) !== String(userId) || friendRequest.status !== 'pending') { return res.status(404).json({ message: 'Solicitação de amizade não encontrada ou não é sua.' }); }
        friendRequest.status = 'rejected'; await friendRequest.save();
        await User.findByIdAndUpdate(friendRequest.sender, { $pull: { sentFriendRequests: requestId } });
        await User.findByIdAndUpdate(friendRequest.receiver, { $pull: { receivedFriendRequests: requestId } });
        const senderSocketId = onlineUsers.get(String(friendRequest.sender))?.socketId;
        if (senderSocketId) { io.to(senderSocketId).emit('friend request rejected', { user: req.user.username, userId: userId }); }
        io.to(senderSocketId).emit('friend request resolved'); io.to(onlineUsers.get(userId)?.socketId).emit('friend request resolved');
        return res.status(200).json({ message: 'Solicitação de amizade rejeitada.' });
    } catch (error) {
        console.error('[API FRIENDS] Erro ao rejeitar solicitação de amizade:', error);
        res.status(500).json({ message: 'Erro no servidor ao rejeitar solicitação de amizade.' });
    }
});

app.get('/api/friends/requests/received', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User.findById(userId);
        const blockedUsers = user.blockedUsers;

        const receivedRequests = await FriendRequest.find({ receiver: userId, status: 'pending', sender: { $nin: blockedUsers } })
            .populate('sender', 'username avatarUrl console');

        const pendingRequests = receivedRequests.map(req => ({ requestId: req._id, senderId: req.sender._id, senderUsername: req.sender.username, senderAvatar: req.sender.avatarUrl, senderConsole: req.sender.console, createdAt: req.createdAt }));

        res.status(200).json(pendingRequests);
    } catch (error) {
        console.error('[API FRIENDS] Erro ao listar solicitações de amizade recebidas:', error);
        res.status(500).json({ message: 'Erro no servidor ao listar solicitações.' });
    }
});

app.get('/api/friends/requests/sent', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User.findById(userId).populate({ path: 'sentFriendRequests', match: { status: 'pending' }, populate: { path: 'receiver', select: 'username avatarUrl console' } });
        if (!user) { return res.status(404).json({ message: 'Usuário não encontrado.' }); }
        const sentRequests = user.sentFriendRequests.map(req => ({ requestId: req._id, receiverId: req.receiver._id, receiverUsername: req.receiver.username, receiverAvatar: req.receiver.avatarUrl, receiverConsole: req.receiver.console, createdAt: req.createdAt }));
        res.status(200).json(sentRequests);
    } catch (error) {
        console.error('[API FRIENDS] Erro ao listar solicitações de amizade enviadas:', error);
        res.status(500).json({ message: 'Erro no servidor ao listar solicitações.' });
    }
});

app.get('/api/friends', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User.findById(userId).populate('friends', 'username avatarUrl console');
        if (!user) { return res.status(404).json({ message: 'Usuário não encontrado.' }); }
        
        const blockedUsers = user.blockedUsers;
        const friendsWithStatus = user.friends
            .filter(friend => !blockedUsers.includes(friend._id))
            .map(friend => ({ 
                _id: friend._id, 
                username: friend.username, 
                avatarUrl: friend.avatarUrl, 
                console: friend.console, 
                isOnline: onlineUsers.has(String(friend._id)) 
            }));
            
        res.status(200).json(friendsWithStatus);
    } catch (error) {
        console.error('[API FRIENDS] Erro ao listar amigos:', error);
        res.status(500).json({ message: 'Erro no servidor ao listar amigos.' });
    }
});

app.delete('/api/friends/:friendId', auth, async (req, res) => {
    try {
        const userId = req.user.id; const friendId = req.params.friendId;
        const user = await User.findById(userId); const friend = await User.findById(friendId);
        if (!user || !friend) { return res.status(404).json({ message: 'Usuário ou amigo não encontrado.' }); }
        user.friends = user.friends.filter(fId => String(fId) !== String(friendId));
        friend.friends = friend.friends.filter(fId => String(fId) !== String(userId));
        await user.save(); await friend.save();
        await FriendRequest.deleteMany({ $or: [{ sender: userId, receiver: friendId }, { sender: friendId, receiver: userId }] });
        const userSocketId = onlineUsers.get(userId)?.socketId; const friendSocketId = onlineUsers.get(friendId)?.socketId;
        if (userSocketId) io.to(userSocketId).emit('friend removed', { user: friend.username, userId: friend._id });
        if (friendSocketId) io.to(friendSocketId).emit('friend removed', { user: user.username, userId: user._id });
        return res.status(200).json({ message: `${friend.username} foi removido da sua lista de amigos.` });
    } catch (error) {
        console.error('[API FRIENDS] Erro ao remover amigo:', error);
        res.status(500).json({ message: 'Erro no servidor ao remover amigo.' });
    }
});

app.get('/api/users/me/blocked', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).populate('blockedUsers', 'username avatarUrl console');
        if (!user) { return res.status(404).json({ message: 'Usuário não encontrado.' }); }
        res.status(200).json(user.blockedUsers || []);
    } catch (error) {
        console.error('[API USER] Erro ao listar usuários bloqueados:', error);
        res.status(500).json({ message: 'Erro no servidor ao listar usuários bloqueados.' });
    }
});

// NOVO: Rota para listar jogos ativos (Uso geral no frontend)
app.get('/api/games', auth, async (req, res) => {
    try {
        const games = await Game.find({ isActive: true }).select('name iconUrl supportedConsoles').sort({ name: 1 });
        res.json(games);
    } catch (error) {
        console.error('[API] Erro ao listar jogos ativos:', error);
        res.status(500).json({ message: 'Erro no servidor ao buscar jogos.' });
    }
});


// ROTAS ADMIN

// NOVO: Rotas de Gestão de Jogos (Admin)
app.post('/api/admin/games', adminAuth, validateSchema(gameSchema), async (req, res) => {
    try {
        const { name, iconUrl, supportedConsoles } = req.body;
        const existingGame = await Game.findOne({ name });
        if (existingGame) {
            return res.status(400).json({ message: 'Um jogo com este nome já existe.' });
        }
        
        const newGame = new Game({ name, iconUrl, supportedConsoles });
        await newGame.save();
        res.status(201).json({ message: 'Jogo adicionado com sucesso!', game: newGame });
    } catch (error) {
        console.error('[API ADMIN] Erro ao adicionar jogo:', error);
        res.status(500).json({ message: 'Erro no servidor ao adicionar jogo.' });
    }
});

app.get('/api/admin/games', adminAuth, async (req, res) => {
    try {
        const games = await Game.find().sort({ isActive: -1, name: 1 });
        res.json(games);
    } catch (error) {
        console.error('[API ADMIN] Erro ao listar jogos (admin):', error);
        res.status(500).json({ message: 'Erro no servidor ao listar jogos.' });
    }
});

app.patch('/api/admin/games/:id', adminAuth, async (req, res) => {
    try {
        const { error } = gameSchema.validate(req.body, { abortEarly: false, partial: true });
        if (error) {
            const message = error.details.map(i => i.message.replace(/['"]/g, '')).join(', ');
            return res.status(400).json({ message: message });
        }

        const game = await Game.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!game) {
            return res.status(404).json({ message: 'Jogo não encontrado.' });
        }
        res.json({ message: 'Jogo atualizado com sucesso!', game });
    } catch (error) {
        console.error('[API ADMIN] Erro ao editar jogo:', error);
        if (error.code === 11000) { // Duplicação de nome
            return res.status(400).json({ message: 'Um jogo com este nome já existe.' });
        }
        res.status(500).json({ message: 'Erro no servidor ao editar jogo.' });
    }
});


app.get('/api/admin/dashboard-stats', adminAuth, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalChallenges = await Challenge.countDocuments();
        const completedChallenges = await Challenge.countDocuments({ status: 'completed' });
        const disputedChallenges = await Challenge.countDocuments({ status: 'disputed' });
        const result = await Challenge.aggregate([ { $match: { status: 'completed' } }, { $group: { _id: null, totalBetAmount: { $sum: '$betAmount' } } } ]);
        const totalCoinsBet = result.length > 0 ? result[0].totalBetAmount : 0;
        const totalTournaments = await Tournament.countDocuments();
        const activeTournaments = await Tournament.countDocuments({ status: 'in-progress' });
        const completedTournaments = await Tournament.countDocuments({ status: 'completed' });

        res.json({ 
            totalUsers, 
            totalChallenges, 
            completedChallenges, 
            disputedChallenges, 
            totalCoinsBet, 
            onlineUsersCount: onlineUsers.size,
            totalTournaments,
            activeTournaments,
            completedTournaments
        });
    } catch (error) {
        console.error('[API ADMIN] Erro ao buscar stats do dashboard admin:', error);
        res.status(500).json({ message: 'Erro no servidor ao buscar estatísticas.' });
    }
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.json(users);
    } catch (error) {
        console.error('[API ADMIN] Erro ao buscar usuários (admin):', error);
        res.status(500).json({ message: 'Erro no servidor ao buscar usuários.' });
    }
});

app.patch('/api/admin/users/:id/update-coins', adminAuth, async (req, res) => {
    try {
        const { coins } = req.body;
        if (typeof coins !== 'number' || coins < 0) { return res.status(400).json({ message: 'Valor de moedas inválido.' }); }
        const user = await User.findByIdAndUpdate(req.params.id, { coins: coins }, { new: true }).select('-password');
        if (!user) { return res.status(404).json({ message: 'Usuário não encontrado.' }); }
        res.json({ message: 'Moedas atualizadas com sucesso.', user });
    } catch (error) {
        console.error('[API ADMIN] Erro ao atualizar moedas do usuário (admin):', error);
        res.status(500).json({ message: 'Erro no servidor ao atualizar moedas.' });
    }
});

app.patch('/api/admin/users/:id/toggle-active', adminAuth, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) { return res.status(404).json({ message: 'Usuário não encontrado.' }); }
        user.isActive = !user.isActive; await user.save();
        res.json({ message: `Conta ${user.isActive ? 'ativada' : 'desativada'} com sucesso.`, user });
    } catch (error) {
        console.error('[API ADMIN] Erro ao ativar/desativar usuário (admin):', error);
        res.status(500).json({ message: 'Erro no servidor ao ativar/desativar usuário.' });
    }
});

app.get('/api/admin/challenges', adminAuth, async (req, res) => {
    try {
        const challenges = await Challenge.find().populate('createdBy', 'username email').populate('opponent', 'username email').populate('winner', 'username email').sort({ createdAt: -1 });
        res.json(challenges);
    } catch (error) {
        console.error('[API ADMIN] Erro ao buscar desafios (admin):', error);
        res.status(500).json({ message: 'Erro no servidor ao buscar desafios.' });
    }
});

app.patch('/api/admin/challenges/:id/resolve-dispute', adminAuth, async (req, res) => {
    try {
        const { winnerId } = req.body; const challenge = await Challenge.findById(req.params.id);
        if (!challenge) { return res.status(404).json({ message: 'Desafio não encontrado.' }); }
        if (challenge.status !== 'disputed') { return res.status(400).json({ message: 'Este desafio não está em disputa para ser resolvido.' }); }
        const playerIds = [challenge.createdBy.toString(), challenge.opponent.toString()];
        if (!playerIds.includes(winnerId)) { return res.status(400).json({ message: 'O vencedor selecionado não é um participante válido deste desafio.' }); }
        challenge.winner = winnerId; challenge.status = 'completed'; await challenge.save();
        const loserId = playerIds.find(id => id !== winnerId);
        if (challenge.betAmount > 0) { await User.findByIdAndUpdate(winnerId, { $inc: { wins: 1, coins: challenge.betAmount } }); await User.findByIdAndUpdate(loserId, { $inc: { losses: 1, coins: -challenge.betAmount } }); }
        else { await User.findByIdAndUpdate(winnerId, { $inc: { wins: 1 } }); await User.findByIdAndUpdate(loserId, { $inc: { losses: 1 } }); }
        res.json({ message: 'Disputa resolvida e resultado aplicado com sucesso!', challenge });
    } catch (error) {
        console.error('[API ADMIN] Erro ao resolver disputa (admin):', error);
        res.status(500).json({ message: 'Erro no servidor ao resolver disputa.' });
    }
});

app.patch('/api/admin/challenges/:id/cancel', adminAuth, async (req, res) => {
    try {
        const challenge = await Challenge.findById(req.params.id);
        if (!challenge) { return res.status(404).json({ message: 'Desafio não encontrado.' }); }
        if (challenge.status === 'completed' || challenge.status === 'cancelled') { return res.status(400).json({ message: 'Desafio já finalizado ou cancelado.' }); }
        challenge.status = 'cancelled'; await challenge.save();
        res.json({ message: 'Desafio cancelado com sucesso!', challenge });
    } catch (error) {
        console.error('[API ADMIN] Erro ao cancelar desafio (admin):', error);
        res.status(500).json({ message: 'Erro no servidor ao cancelar desafio.' });
    }
});

app.get('/api/admin/pending-pix', adminAuth, async (req, res) => {
    try {
        const pendingPayments = await PixPaymentNotification.find({ status: 'pending' })
            .populate('userId', 'username email')
            .sort({ createdAt: 1 });
        
        res.status(200).json(pendingPayments);
    } catch (error) {
        console.error('[API ADMIN] Erro ao buscar pagamentos Pix pendentes:', error);
        res.status(500).json({ message: 'Erro no servidor ao buscar pagamentos pendentes.' });
    }
});

app.patch('/api/admin/confirm-pix/:paymentId', adminAuth, async (req, res) => {
    const { paymentId } = req.params;

    try {
        const payment = await PixPaymentNotification.findById(paymentId);
        if (!payment || payment.status !== 'pending') {
            return res.status(404).json({ message: 'Pagamento pendente não encontrado ou já processado.' });
        }

        const user = await User.findById(payment.userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        user.coins += payment.amount;
        await user.save();

        payment.status = 'approved';
        await payment.save();

        if (onlineUsers.has(String(user._id))) {
            io.to(onlineUsers.get(String(user._id)).socketId).emit('wallet updated', { newBalance: user.coins });
        }

        res.status(200).json({ message: 'Pagamento confirmado e saldo atualizado com sucesso.' });

    } catch (error) {
        console.error('[API ADMIN] Erro ao confirmar pagamento Pix:', error);
        res.status(500).json({ message: 'Erro no servidor ao confirmar o pagamento.' });
    }
});

app.get('/api/admin/pending-withdrawals', adminAuth, async (req, res) => {
    try {
        const pendingWithdrawals = await WithdrawalRequest.find({ status: 'pending' })
            .populate('userId', 'username email cpf')
            .sort({ createdAt: 1 });
        
        res.status(200).json(pendingWithdrawals);
    } catch (error) {
        console.error('[API ADMIN] Erro ao buscar solicitações de saque pendentes:', error);
        res.status(500).json({ message: 'Erro no servidor ao buscar solicitações de saque.' });
    }
});

app.patch('/api/admin/withdrawals/:id/approve', adminAuth, async (req, res) => {
    const { id } = req.params;

    try {
        const withdrawal = await WithdrawalRequest.findById(id);
        if (!withdrawal || withdrawal.status !== 'pending') {
            return res.status(404).json({ message: 'Solicitação de saque pendente não encontrada ou já processada.' });
        }

        withdrawal.status = 'approved';
        withdrawal.processedAt = Date.now();
        await withdrawal.save();

        const userSocketId = onlineUsers.get(String(withdrawal.userId))?.socketId;
        if (userSocketId) {
            io.to(userSocketId).emit('wallet updated', { status: 'approved', amount: withdrawal.amount });
        }

        res.status(200).json({ message: 'Solicitação de saque aprovada com sucesso.' });
    } catch (error) {
        console.error('[API ADMIN] Erro ao aprovar solicitação de saque:', error);
        res.status(500).json({ message: 'Erro no servidor ao aprovar a solicitação.' });
    }
});

app.patch('/api/admin/withdrawals/:id/reject', adminAuth, async (req, res) => {
    const { id } = req.params;

    try {
        const withdrawal = await WithdrawalRequest.findById(id);
        if (!withdrawal || withdrawal.status !== 'pending') {
            return res.status(404).json({ message: 'Solicitação de saque pendente não encontrada ou já processada.' });
        }

        const user = await User.findById(withdrawal.userId);
        if (user) {
            user.coins += withdrawal.amount;
            await user.save();
        }

        withdrawal.status = 'rejected';
        withdrawal.processedAt = Date.now();
        await withdrawal.save();

        const userSocketId = onlineUsers.get(String(withdrawal.userId))?.socketId;
        if (userSocketId) {
            io.to(userSocketId).emit('withdrawal status updated', { status: 'rejected', amount: withdrawal.amount, newBalance: user.coins });
        }

        res.status(200).json({ message: 'Solicitação de saque rejeitada e valor devolvido ao saldo do usuário.' });
    } catch (error) {
        console.error('[API ADMIN] Erro ao rejeitar solicitação de saque:', error);
        res.status(500).json({ message: 'Erro no servidor ao rejeitar a solicitação.' });
    }
});


// ===================================================================================================================
// FUNÇÃO GENERATE BRACKET CORRIGIDA
// ===================================================================================================================

const generateBracket = (participants) => {
    let matches = [];
    const numParticipants = participants.length;
    let numRounds = Math.log2(numParticipants);

    if (!Number.isInteger(numRounds) || numParticipants < 2) {
        throw new Error('O número de participantes deve ser uma potência de 2 (mínimo 2).');
    }

    const roundNamesMap = {
        2: ['Final'],
        4: ['Semi-Final', 'Final'],
        8: ['Quartas', 'Semi-Final', 'Final'],
        16: ['Oitavas', 'Quartas', 'Semi-Final', 'Final'],
        32: ['Rodada 32', 'Oitavas', 'Quartas', 'Semi-Final', 'Final'],
        64: ['Rodada 64', 'Rodada 32', 'Oitavas', 'Quartas', 'Semi-Final', 'Final']
    };
    
    // Use dynamic round names based on numParticipants
    const roundsNames = roundNamesMap[numParticipants] || 
        (numRounds > 3 ? ['Rodada 1', 'Rodada 2', 'Rodada 3', 'Final'] : ['Rodada 1', 'Final']);


    let finalBracket = [];
    let offset = 0; // O índice inicial da rodada atual no array final
    let roundSize = numParticipants / 2; // Número de matches na rodada atual

    for (let r = 0; r < numRounds; r++) {
        const roundName = roundsNames[r];
        const isFinalRound = r === numRounds - 1;
        const nextOffset = offset + roundSize; // O índice inicial da PRÓXIMA rodada
        
        for (let i = 0; i < roundSize; i++) {
            const match = {
                player1: (r === 0) ? participants[i * 2] : null,
                player2: (r === 0) ? (participants[i * 2 + 1] || null) : null,
                winner: null,
                status: 'pending',
                round: roundName,
                // TEMPORARY FIELD: Armazena o índice do próximo match
                tempNextMatchIndex: isFinalRound ? null : (nextOffset + Math.floor(i / 2))
            };
            finalBracket.push(match);
        }
        
        offset = finalBracket.length - roundSize; // A nova rodada começa onde a anterior parou
        roundSize /= 2;
    }

    // Agora que todos os matches estão no array, precisamos ligar os matches da penúltima
    // rodada para a última, pois a lógica do loop acima erra os índices
    // Vamos iterar sobre o array final para corrigir os índices temporários
    
    let currentMatchOffset = 0;
    let currentRoundSize = numParticipants / 2;

    for (let r = 0; r < numRounds - 1; r++) {
        const nextMatchOffset = currentMatchOffset + currentRoundSize; // O início da próxima rodada
        const nextRoundSize = currentRoundSize / 2;
        
        for (let i = 0; i < currentRoundSize; i++) {
            const matchIndex = currentMatchOffset + i;
            // O próximo match está na próxima rodada, no índice [nextMatchOffset + floor(i / 2)]
            const nextMatchIndex = nextMatchOffset + Math.floor(i / 2);
            
            finalBracket[matchIndex].tempNextMatchIndex = nextMatchIndex;
        }

        currentMatchOffset = nextMatchOffset;
        currentRoundSize = nextRoundSize;
    }
    
    // O último match do array (a final) terá tempNextMatchIndex = null.
    // Isso deve garantir que todos os matches sejam linkados corretamente pelo índice.

    return finalBracket;
};


// ... Rotas de Tournament ...


app.post('/api/admin/tournaments', adminAuth, validateSchema(adminTournamentSchema), validateGame, async (req, res) => { // ADICIONADO validateGame
    try {
        const { name, game, console, betAmount, maxParticipants, scheduledTime } = req.body;
        
        const newTournament = new Tournament({
            name,
            game,
            console,
            betAmount: Number(betAmount) || 0,
            maxParticipants: Number(maxParticipants),
            scheduledTime,
            admin: req.user.id
        });
        await newTournament.save();

        io.emit('tournament_created');
        res.status(201).json({ message: 'Campeonato criado com sucesso!', tournament: newTournament });
    } catch (error) {
        console.error('[API ADMIN] Erro ao criar campeonato:', error);
        res.status(500).json({ message: 'Erro no servidor ao criar campeonato.' });
    }
});

app.get('/api/tournaments', auth, async (req, res) => {
    try {
        const tournaments = await Tournament.find({ status: { $in: ['registration', 'in-progress'] } })
            .populate('participants', 'username avatarUrl')
            .sort({ registeredAt: 1 });
        res.json(tournaments);
    } catch (error) {
        console.error('[API] Erro ao listar campeonatos:', error);
        res.status(500).json({ message: 'Erro no servidor ao buscar campeonatos.' });
    }
});

app.get('/api/tournaments/:id', auth, async (req, res) => {
    try {
        const tournament = await Tournament.findById(req.params.id)
            .populate('participants', 'username avatarUrl')
            .populate('bracket.player1', 'username')
            .populate('bracket.player2', 'username')
            .populate('bracket.winner', 'username');
        if (!tournament) {
            return res.status(404).json({ message: 'Campeonato não encontrado.' });
        }
        res.json(tournament);
    } catch (error) {
        console.error('[API] Erro ao buscar detalhes do campeonato:', error);
        res.status(500).json({ message: 'Erro no servidor ao buscar detalhes do campeonato.' });
    }
});

app.post('/api/tournaments/:id/register', auth, async (req, res) => {
    try {
        const tournamentId = req.params.id;
        const userId = req.user.id;

        const tournament = await Tournament.findById(tournamentId);
        const user = await User.findById(userId);

        if (!tournament || !user) {
            return res.status(404).json({ message: 'Campeonato ou usuário não encontrado.' });
        }
        if (tournament.status !== 'registration') {
            return res.status(400).json({ message: 'O período de inscrições para este campeonato já encerrou.' });
        }
        if (tournament.participants.length >= tournament.maxParticipants) {
            return res.status(400).json({ message: 'Este campeonato já atingiu o número máximo de participantes.' });
        }
        if (tournament.participants.includes(userId)) {
            return res.status(400).json({ message: 'Você já está inscrito neste campeonato.' });
        }
        if (tournament.betAmount > 0 && user.coins < tournament.betAmount) {
            return res.status(400).json({ message: 'Você não tem moedas suficientes para se inscrever.' });
        }

        if (tournament.betAmount > 0) {
            user.coins -= tournament.betAmount;
            await user.save();
        }
        tournament.participants.push(userId);
        await tournament.save();
        
        io.emit('tournament_updated');
        res.status(200).json({ message: 'Inscrição realizada com sucesso!', tournament });

    } catch (error) {
        console.error('[API] Erro ao registrar em campeonato:', error);
        res.status(500).json({ message: 'Erro no servidor ao se inscrever no campeonato.' });
    }
});

app.patch('/api/admin/tournaments/:id/remove-participant', adminAuth, async (req, res) => {
    try {
        const { userId } = req.body;
        const tournament = await Tournament.findById(req.params.id);

        if (!tournament) {
            return res.status(404).json({ message: 'Campeonato não encontrado.' });
        }
        
        const participantIndex = tournament.participants.indexOf(userId);
        if (participantIndex === -1) {
            return res.status(404).json({ message: 'Usuário não é um participante deste campeonato.' });
        }
        
        tournament.participants.splice(participantIndex, 1);
        await tournament.save();

        io.emit('tournament_updated');
        res.status(200).json({ message: 'Participante removido com sucesso!', tournament });
    } catch (error) {
        console.error('[API ADMIN] Erro ao remover participante:', error);
        res.status(500).json({ message: 'Erro no servidor ao remover participante.' });
    }
});


app.post('/api/admin/tournaments/:id/start', adminAuth, async (req, res) => {
    try {
        const tournament = await Tournament.findById(req.params.id).populate('participants', 'username');
        if (!tournament) {
            return res.status(404).json({ message: 'Campeonato não encontrado.' });
        }
        if (tournament.status !== 'registration') {
            return res.status(400).json({ message: 'O campeonato não está no status de inscrição.' });
        }
        
        const shuffledParticipants = tournament.participants.sort(() => 0.5 - Math.random());

        const bracketData = generateBracket(shuffledParticipants.map(p => p._id));

        // 1. Atribui o array de objetos. Mongoose gera os _id's dos subdocumentos aqui.
        tournament.bracket = bracketData; 
        
        // 2. Itera sobre o subdocument array para ligar os IDs
        tournament.bracket.forEach((match, index) => {
            if (match.tempNextMatchIndex !== null && match.tempNextMatchIndex !== undefined) {
                // Pega o ID real do subdocument na posição do índice temporário
                const nextMatchId = tournament.bracket[match.tempNextMatchIndex]?._id;
                
                if (nextMatchId) {
                    // Atribui o ObjectId
                    match.nextMatch = nextMatchId;
                }
            }
            // 3. Remove o campo temporário antes de salvar
            match.tempNextMatchIndex = undefined; 
        });

        tournament.status = 'in-progress';
        await tournament.save();

        io.emit('tournament_updated');
        res.status(200).json({ message: 'Campeonato iniciado e chaveamento gerado!', tournament });
    } catch (error) {
        console.error('[API ADMIN] Erro ao iniciar campeonato:', error);
        res.status(500).json({ message: 'Erro no servidor ao iniciar campeonato.' });
    }
});


app.post('/api/admin/tournaments/:id/message-participants', adminAuth, async (req, res) => {
    try {
        const { message } = req.body;
        const tournament = await Tournament.findById(req.params.id).populate('participants', 'email');
        if (!tournament) {
            return res.status(404).json({ message: 'Campeonato não encontrado.' });
        }
        
        if (!message) {
            return res.status(400).json({ message: 'A mensagem não pode ser vazia.' });
        }

        const participantEmails = tournament.participants.map(p => p.email);
        
        const mailOptions = {
            to: participantEmails,
            from: process.env.EMAIL_USER,
            subject: `Atualização do Campeonato ${tournament.name}`,
            html: `<p>Olá, participante!</p><p>Uma atualização importante sobre o campeonato "${tournament.name}":</p><p>${message}</p><p>Boa sorte!</p>`
        };

        await transporter.sendMail(mailOptions);

        res.status(200).json({ message: 'Mensagem enviada para todos os participantes com sucesso.' });
    } catch (error) {
        console.error('[API ADMIN] Erro ao enviar mensagem para participantes:', error);
        res.status(500).json({ message: 'Erro no servidor ao enviar a mensagem.' });
    }
});


app.get('/api/admin/tournaments', adminAuth, async (req, res) => {
    try {
        const tournaments = await Tournament.find().populate('participants', 'username').sort({ registeredAt: -1 });
        res.json(tournaments);
    } catch (error) {
        console.error('[API ADMIN] Erro ao buscar campeonatos:', error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

app.patch('/api/admin/tournaments/:tournamentId/resolve-match/:matchId', adminAuth, async (req, res) => {
    try {
        const { tournamentId, matchId } = req.params;
        const { winnerId } = req.body;

        const tournament = await Tournament.findById(tournamentId);
        if (!tournament) {
            return res.status(404).json({ message: 'Campeonato não encontrado.' });
        }

        const match = tournament.bracket.id(matchId);
        if (!match) {
            return res.status(404).json({ message: 'Partida não encontrada.' });
        }

        if (String(winnerId) !== String(match.player1) && String(winnerId) !== String(match.player2)) {
            return res.status(400).json({ message: 'O vencedor selecionado não é um dos jogadores desta partida.' });
        }

        match.winner = winnerId;
        match.status = 'completed';

        if (match.nextMatch) {
            const nextMatch = tournament.bracket.id(match.nextMatch);
            if (nextMatch) {
                if (!nextMatch.player1) {
                    nextMatch.player1 = winnerId;
                } else {
                    nextMatch.player2 = winnerId;
                }
            }
        }
        
        await tournament.save();
        io.emit('tournament_updated');
        res.status(200).json({ message: 'Resultado do match registrado e chaveamento atualizado!', tournament });

    } catch (error) {
        console.error('[API ADMIN] Erro ao resolver match do campeonato:', error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});


app.get('/api/admin/all-tournaments', adminAuth, async (req, res) => {
    try {
        const tournaments = await Tournament.find().populate('participants', 'username');
        res.json(tournaments);
    } catch (error) {
        console.error('[API ADMIN] Erro ao buscar campeonatos para o admin:', error);
        res.status(500).json({ message: 'Erro no servidor ao buscar campeonatos.' });
    }
});


app.get('/api/admin/tournament/:id', adminAuth, async (req, res) => {
    try {
        const tournament = await Tournament.findById(req.params.id)
            .populate('participants', 'username avatarUrl')
            .populate('bracket.player1', 'username')
            .populate('bracket.player2', 'username')
            .populate('bracket.winner', 'username')
            .populate('admin', 'username');

        if (!tournament) {
            return res.status(404).json({ message: 'Campeonato não encontrado.' });
        }

        res.json(tournament);
    } catch (error) {
        console.error('[API ADMIN] Erro ao buscar detalhes do campeonato:', error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

app.delete('/api/admin/tournaments/:id', adminAuth, async (req, res) => {
    try {
        const tournamentId = req.params.id;
        const tournament = await Tournament.findByIdAndDelete(tournamentId);

        if (!tournament) {
            return res.status(404).json({ message: 'Campeonato não encontrado.' });
        }

        if (tournament.betAmount > 0) {
            await User.updateMany(
                { _id: { $in: tournament.participants } },
                { $inc: { coins: tournament.betAmount } }
            );
        }

        io.emit('tournament_updated');
        res.status(200).json({ message: `Campeonato "${tournament.name}" excluído com sucesso. O valor da inscrição foi devolvido aos participantes.` });

    } catch (error) {
        console.error('[API ADMIN] Erro ao excluir campeonato:', error);
        res.status(500).json({ message: 'Erro no servidor ao excluir campeonato.' });
    }
});