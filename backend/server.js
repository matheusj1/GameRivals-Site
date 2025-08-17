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

const User = require('./models/User');
const Challenge = require('./models/Challenge');
const Message = require('./models/Message');
const FriendRequest = require('./models/FriendRequest');

const auth = require('./middleware/auth');
const adminAuth = require('./middleware/adminAuth');

const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();
const server = http.createServer(app);

app.set('trust proxy', true);

// NOVO: Defina as URLs do frontend e backend dinamicamente
const FRONTEND_URL = process.env.FRONTEND_URL || "https://matheusj1.github.io";
const BACKEND_URL = process.env.BACKEND_URL || "https://gamerivals-site.onrender.com"; // Esta será a URL do seu serviço de backend no Render

const io = new Server(server, {
    cors: {
        origin: FRONTEND_URL, // Use a URL dinâmica do frontend para CORS
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization", "x-auth-token"]
    }
});

// NOVO: Use a porta fornecida pelo ambiente (Render usa process.env.PORT)
const PORT = process.env.PORT || 3001;

app.use(cors({
    origin: FRONTEND_URL, // Use a URL dinâmica do frontend para CORS
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
}));

app.use(express.json());

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

// Sirva os avatares estaticamente
app.use('/avatars', express.static(avatarsDir));

const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });
const preferences = new Preference(client);
const payments = new Payment(client);

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

            // Use a URL do frontend para o avatar padrão, pois a imagem será servida pelo frontend
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
                console: console // ou apenas console, se já está desestruturado
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

    socket.on('private message', (data) => {
        const senderUserId = socketIdToUserId.get(socket.id);
        const sender = onlineUsers.get(senderUserId);
        const recipient = onlineUsers.get(data.toUserId);

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
        const userId = data.id; // Corrigido de data.userId para data.id
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
                            foundOpponentObject = entry;
                            userMap.delete(entryUserId);
                            break;
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

            } catch (error) {
                console.error('[MATCHMAKING] Erro ao criar desafio após encontrar partida:', error);
                socket.emit('matchmaking error', { message: 'Erro ao criar partida. Tente novamente.' });
                if (foundOpponentObject && foundOpponentObject.socketId) io.to(foundOpponentObject.socketId).emit('matchmaking error', { message: 'Erro ao criar partida. Tente novamente.' });
            }

        } else { // Se nenhum oponente foi encontrado, adiciona o usuário atual à fila
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


app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ message: 'Por favor, preencha todos os campos.' });
        }
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.status(400).json({ message: 'E-mail ou nome de usuário já cadastrado.' });
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = new User({ username, email, password: hashedPassword, wins: 0, losses: 0, coins: 1000, role: 'user', isActive: true, profileCompleted: false });
        await newUser.save();
        res.status(201).json({ message: 'Usuário cadastrado com sucesso!' });
    }
    catch (error) {
        console.error('[API REGISTER] Erro no cadastro:', error);
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Por favor, preencha todos os campos.' });
        }
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
        const token = jwt.sign(payload, process.env.JWT_SECRET || 'seu_segredo_jwt_padrao', { expiresIn: '1h' });

        res.status(200).json({ message: 'Login bem-sucedido!', token: token, username: user.username, userId: user.id, userRole: user.role, profileCompleted: user.profileCompleted });
    }
    catch (error) {
        console.error('[API LOGIN] Erro no login:', error);
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

// --- Endpoint para iniciar pagamento com Mercado Pago ---
app.post('/api/payment/deposit-mp', auth, async (req, res) => {
    const { amount, payment_method } = req.body;
    const userId = req.user.id;

    if (typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ message: 'Valor de depósito inválido. Deve ser um número positivo.' });
    }
    if (!payment_method) {
        return res.status(400).json({ message: 'Método de pagamento não especificado.' });
    }

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        if (!user.email) {
            console.error('[API PAYMENT] Usuário sem email definido para o pagamento Mercado Pago. User ID:', userId);
            return res.status(400).json({ message: 'Seu perfil não tem um e-mail configurado para o pagamento.' });
        }

        // NOVO: Use a URL dinâmica do backend para o webhook do Mercado Pago
        const publicBaseUrl = BACKEND_URL;
        console.log('Using dynamic publicBaseUrl for MP:', publicBaseUrl);

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
                external_reference: userId,
                notification_url: `${publicBaseUrl}/api/webhooks/mercadopago`,
                back_urls: {
                    success: `${FRONTEND_URL}/profile.html?payment_status=success`, // Use a URL dinâmica do frontend
                    failure: `${FRONTEND_URL}/profile.html?payment_status=failure`,   // Use a URL dinâmica do frontend
                    pending: `${FRONTEND_URL}/profile.html?payment_status=pending`    // Use a URL dinâmica do frontend
                },
                auto_return: 'approved'
            };
        } else {
            return res.status(400).json({ message: 'Método de pagamento não suportado no momento.' });
        }

        console.log('[Mercado Pago Request Preference]', JSON.stringify(preference, null, 2));

        const mpResponse = await preferences.create({ body: preference });
        console.log('[Mercado Pago API Full Response]', JSON.stringify(mpResponse, null, 2));

        const initPoint = mpResponse.init_point;
        const sandboxInitPoint = mpResponse.sandbox_init_point;
        const paymentId = mpResponse.id;

        console.log('Valor de initPoint:', initPoint);
        console.log('Valor de sandboxInitPoint:', sandboxInitPoint);

        const redirectUrl = sandboxInitPoint || initPoint;
        if (!redirectUrl) {
            console.error('[API PAYMENT] Resposta do Mercado Pago não contém URL de redirecionamento válida.');
            return res.status(500).json({ message: 'Erro ao iniciar pagamento. URL de redirecionamento ausente na resposta do MP.' });
        }

        res.json({
            message: 'Pagamento iniciado com sucesso! Redirecionando...',
            type: 'redirect',
            redirectUrl: redirectUrl,
            paymentId: paymentId
        });

    } catch (error) {
        console.error('[API PAYMENT] Erro ao iniciar pagamento com Mercado Pago:', error.message);
        if (error.response && error.response.data) {
            console.error('Detalhes do Erro do Mercado Pago:', JSON.stringify(error.response.data, null, 2));
            return res.status(500).json({ message: `Erro do Mercado Pago: ${error.response.data.message || 'Erro desconhecido.'}` });
        }
        res.status(500).json({ message: 'Erro ao iniciar pagamento. Tente novamente mais tarde.' });
    }
});

// --- Rotas da Carteira Temporária (mantidas para saque) ---
app.post('/api/wallet/deposit', auth, async (req, res) => {
    // Esta rota não é mais usada para depósitos reais, apenas para simulação ou legado.
    try {
        const { amount } = req.body;
        const userId = req.user.id;
        if (typeof amount !== 'number' || amount <= 0) { return res.status(400).json({ message: 'Valor de depósito inválido. Deve ser um número positivo.' }); }
        const user = await User.findById(userId);
        if (!user) { return res.status(404).json({ message: 'Usuário não encontrado.' }); }
        user.coins += amount;
        await user.save();
        res.status(200).json({ message: `Depósito de ${amount} moedas simulado com sucesso!`, newBalance: user.coins });
    } catch (error) {
        console.error('[API WALLET] Erro ao processar depósito simulado:', error);
        res.status(500).json({ message: 'Erro no servidor ao processar depósito simulado.' });
    }
});

app.post('/api/wallet/withdraw', auth, async (req, res) => {
    try {
        const { amount } = req.body;
        const userId = req.user.id;
        if (typeof amount !== 'number' || amount <= 0) { return res.status(400).json({ message: 'Valor de saque inválido. Deve ser um número positivo.' }); }
        const user = await User.findById(userId);
        if (!user) { return res.status(404).json({ message: 'Usuário não encontrado.' }); }
        if (user.coins < amount) { return res.status(400).json({ message: 'Saldo insuficiente para realizar este saque.' }); }
        user.coins -= amount;
        await user.save();
        res.status(200).json({ message: `Saque de ${amount} moedas realizado com sucesso!`, newBalance: user.coins });
    } catch (error) {
        console.error('[API WALLET] Erro ao processar saque:', error);
        res.status(500).json({ message: 'Erro no servidor ao processar saque.' });
    }
});

// Outras rotas (Desafios, Amigos, Admin, etc.) - Manter conforme o seu código original
app.post('/api/challenges', auth, async (req, res) => {
    try {
        const { game, console: platform, betAmount, scheduledTime } = req.body;
        if (!game || !platform || !betAmount) { return res.status(400).json({ message: 'Por favor, preencha todos os campos do desafio.' }); }
        const user = await User.findById(req.user.id);
        if (betAmount > 0 && user.coins < betAmount) { return res.status(400).json({ message: 'Você não tem moedas suficientes para esta aposta.' }); }
        const newChallenge = new Challenge({ game, console: platform, betAmount, scheduledTime, createdBy: req.user.id });
        await newChallenge.save();
        if (betAmount > 0) { user.coins -= betAmount; await user.save(); }
        res.status(201).json(newChallenge);
    } catch (error) {
        console.error('[API CHALLENGE] Erro ao criar desafio:', error);
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

app.post('/api/challenges/private', auth, async (req, res) => {
    try {
        const { opponentId, game, console: platform, betAmount } = req.body;
        const createdBy = req.user.id;
        if (!opponentId || !game || !platform || betAmount === undefined || betAmount === null || betAmount < 0) { return res.status(400).json({ message: 'Dados do desafio privado incompletos ou inválidos.' }); }
        if (String(createdBy) === String(opponentId)) { return res.status(400).json({ message: 'Você não pode desafiar a si mesmo.' }); }
        const creatorUser = await User.findById(createdBy);
        const opponentUser = await User.findById(opponentId);
        if (!creatorUser || !opponentUser) { return res.status(404).json({ message: 'Criador ou oponente não encontrado.' }); }
        if (!creatorUser.friends.includes(opponentId)) { return res.status(400).json({ message: 'Você só pode desafiar amigos diretamente.' }); }
        if (betAmount > 0 && creatorUser.coins < betAmount) { return res.status(400).json({ message: `${opponentUser.username} não tem moedas suficientes para aceitar esta aposta.` }); }
        if (betAmount > 0 && opponentUser.coins < betAmount) { return res.status(400).json({ message: `${opponentUser.username} não tem moedas suficientes para aceitar esta aposta.` }); }
        const newChallenge = new Challenge({ game, console: platform, betAmount, createdBy: createdBy, opponent: opponentId, status: 'open' });
        await newChallenge.save();
        const opponentSocketId = onlineUsers.get(String(opponentId))?.socketId;
        if (opponentSocketId) { io.to(opponentSocketId).emit('private challenge received', { challengeId: newChallenge._id, senderUsername: creatorUser.username, game: newChallenge.game, console: newChallenge.console, betAmount: newChallenge.betAmount, createdBy: createdBy }); }
        res.status(201).json({ message: 'Desafio privado criado com sucesso e enviado ao seu amigo!', challenge: newChallenge });
    } catch (error) {
        console.error('[API CHALLENGE] Erro ao criar desafio privado:', error);
        res.status(500).json({ message: 'Erro no servidor ao criar desafio privado.' });
    }
});

app.get('/api/challenges', auth, async (req, res) => {
    try {
        const challenges = await Challenge.find({ status: 'open' }).populate('createdBy', 'username avatarUrl').sort({ createdAt: -1 });
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
        if (challenge.betAmount > 0 && acceptorUser.coins < challenge.betAmount) { return res.status(400).json({ message: 'Você não tem moedas suficientes para aceitar esta aposta.' }); }
        challenge.opponent = req.user.id;
        challenge.status = 'accepted';
        await challenge.save();
        if (challenge.betAmount > 0) { acceptorUser.coins -= challenge.betAmount; await acceptorUser.save(); }
        res.json(challenge);
    } catch (error) {
        console.error('[API CHALLENGE] Erro ao aceitar desafio:', error);
        res.status(500).json({ message: 'Erro no servidor, tente novamente mais tarde.' });
    }
});

app.get('/api/my-challenges', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const myChallenges = await Challenge.find({ $or: [{ createdBy: userId }, { opponent: userId }], archivedBy: { $ne: userId } }).populate('createdBy', 'username avatarUrl').populate('opponent', 'username avatarUrl').sort({ createdAt: -1 });
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
                return res.json({ message: "Resultado confirmado! Partida finalizada.", challenge });
            } else { challenge.status = 'disputed'; await challenge.save(); return res.status(409).json({ message: "Resultados conflitantes. A partida entrou em análise pelo suporte.", challenge }); }
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
        const user = await User.findById(req.user.id).select('-password');
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
        const users = await User.find({ username: { $regex: query, $options: 'i' }, _id: { $ne: userId }, role: 'user' }).select('username avatarUrl console');
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

app.patch('/api/users/profile', auth, upload.single('avatar'), async (req, res) => {
    try {
        const userId = req.user.id;
        const updates = req.body;
        const user = await User.findById(userId);
        if (!user) { return res.status(404).json({ message: 'Usuário não encontrado.' }); }
        if (updates.username && updates.username !== user.username) {
            const existingUsername = await User.findOne({ username: updates.username });
            if (existingUsername && String(existingUsername._id) !== String(user._id)) {
                if (req.file) { fs.unlinkSync(req.file.path); }
                return res.status(400).json({ message: 'Nome de usuário já está em uso.' });
            }
            user.username = updates.username;
        }
        if (updates.phone !== undefined) user.phone = updates.phone;
        if (updates.bio !== undefined) user.bio = updates.bio;
        if (updates.description !== undefined) user.description = updates.description;
        if (updates.console !== undefined) user.console = updates.console;
        // NOVO: Use a URL dinâmica do backend para o avatar
        if (req.file) { user.avatarUrl = `${BACKEND_URL}/avatars/${req.file.filename}`; }
        if (!user.profileCompleted) { user.profileCompleted = true; }
        await user.save();
        if (onlineUsers.has(userId)) {
            const onlineUser = onlineUsers.get(userId);
            onlineUser.username = user.username; onlineUser.avatarUrl = user.avatarUrl; onlineUser.console = user.console;
            onlineUsers.set(userId, onlineUser); emitUpdatedUserList();
        }
        res.json({ message: 'Perfil atualizado com sucesso!', user: { username: user.username, avatarUrl: user.avatarUrl, profileCompleted: user.profileCompleted, console: user.console } });
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
            return res.status(200).json({ message: `Vocês agora são amigos com ${receiver.username}! Solicitação aceita automaticamente.` });
        }
        const newRequest = new FriendRequest({ sender: senderId, receiver: receiverId });
        await newRequest.save();
        sender.sentFriendRequests.push(newRequest._id); receiver.receivedFriendRequests.push(newRequest._id);
        await sender.save(); await receiver.save();
        const receiverSocketId = onlineUsers.get(receiverId)?.socketId;
        if (receiverSocketId) { io.to(receiverSocketId).emit('new friend request', { requestId: newRequest._id, senderId: sender._id, senderUsername: sender.username, senderAvatar: sender.avatarUrl, senderConsole: sender.console }); }
        res.status(201).json({ message: 'Solicitação de amizade enviada com sucesso!' });
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
        return res.status(200).json({ message: `Você e ${sender.username} agora são amigos!` });
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
        const user = await User.findById(userId).populate({ path: 'receivedFriendRequests', match: { status: 'pending' }, populate: { path: 'sender', select: 'username avatarUrl console' } });
        if (!user) { return res.status(404).json({ message: 'Usuário não encontrado.' }); }
        const pendingRequests = user.receivedFriendRequests.map(req => ({ requestId: req._id, senderId: req.sender._id, senderUsername: req.sender.username, senderAvatar: req.sender.avatarUrl, senderConsole: req.sender.console, createdAt: req.createdAt }));
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
        const friendsWithStatus = user.friends.map(friend => ({ _id: friend._id, username: friend.username, avatarUrl: friend.avatarUrl, console: friend.console, isOnline: onlineUsers.has(String(friend._id)) }));
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

app.get('/api/admin/dashboard-stats', adminAuth, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalChallenges = await Challenge.countDocuments();
        const completedChallenges = await Challenge.countDocuments({ status: 'completed' });
        const disputedChallenges = await Challenge.countDocuments({ status: 'disputed' });
        const result = await Challenge.aggregate([ { $match: { status: 'completed' } }, { $group: { _id: null, totalBetAmount: { $sum: '$betAmount' } } } ]);
        const totalCoinsBet = result.length > 0 ? result[0].totalBetAmount : 0;
        res.json({ totalUsers, totalChallenges, completedChallenges, disputedChallenges, totalCoinsBet, onlineUsersCount: onlineUsers.size });
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
        res.json({ message: 'Moedas atualizadas com sucesso!', user });
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
        res.json({ message: `Conta ${user.isActive ? 'ativada' : 'desativada'} com sucesso!`, user });
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

app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) { return res.status(400).json({ message: 'Por favor, insira seu e-mail.' }); }
        const user = await User.findOne({ email });
        if (!user) { return res.status(200).json({ message: 'Se o e-mail estiver cadastrado, um link de redefinição será enviado.' }); }
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpires = Date.now() + 3600000;
        user.resetPasswordToken = resetToken; user.resetPasswordExpires = resetExpires; await user.save();
        // NOVO: Use a URL dinâmica do frontend para o link de redefinição de senha
        const resetUrl = `${FRONTEND_URL}/login.html?resetToken=${resetToken}`;
        const mailOptions = { to: user.email, from: process.env.EMAIL_USER, subject: 'GameRivals - Redefinição de Senha', html: `<p>Você solicitou uma redefinição de senha para sua conta GameRivals.</p><p>Por favor, clique no link a seguir para redefinir sua senha:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Este link expirará em 1 hora.</p><p>Se você não solicitou esta redefinição, por favor, ignore este e-mail.</p>` };
        await transporter.sendMail(mailOptions);
        res.status(200).json({ message: 'Se o e-mail estiver cadastrado, um link de redefinição será enviado.' });
    } catch (error) {
        console.error('[API FORGOT PASSWORD] Erro ao solicitar redefinição de senha:', error);
        res.status(500).json({ message: 'Erro no servidor ao processar a solicitação de redefinição de senha.' });
    }
});

app.post('/api/reset-password/:token', async (req, res) => {
    try {
        const { token } = req.params; const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) { return res.status(400).json({ message: 'A nova senha deve ter pelo menos 6 caracteres.' }); }
        const user = await User.findOne({ resetPasswordToken: token, resetPasswordExpires: { $gt: Date.now() } });
        if (!user) { return res.status(400).json({ message: 'Token de redefinição de senha inválido ou expirado.' }); }
        const salt = await bcrypt.genSalt(10); user.password = await bcrypt.hash(newPassword, salt);
        user.resetPasswordToken = undefined; user.resetPasswordExpires = undefined; await user.save();
        const mailOptionsConfirm = { to: user.email, from: process.env.EMAIL_USER, subject: 'GameRivals - Sua senha foi redefinida com sucesso', html: '<p>Sua senha da conta GameRivals foi redefinida com sucesso.</p><p>Se você não fez esta alteração, por favor, entre em contato com o suporte imediatamente.</p>' };
        await transporter.sendMail(mailOptionsConfirm);
        res.status(200).json({ message: 'Sua senha foi redefinida com sucesso!' });
    } catch (error) {
        console.error('[API RESET PASSWORD] Erro ao redefinir senha:', error);
        res.status(500).json({ message: 'Erro no servidor ao redefinir a senha.' });
    }
});

// Endpoint para o Webhook do Mercado Pago (para receber notificações de pagamento)
app.post('/api/webhooks/mercadopago', async (req, res) => {
    console.log('[WEBHOOK MP] Requisição recebida para /api/webhooks/mercadopago');
    if (req.query.topic === 'payment') {
        const paymentId = req.query.id;
        try {
            const payment = await payments.get({ id: paymentId });
            const paymentStatus = payment.body.status;
            const externalReference = payment.body.external_reference;
            console.log(`[Mercado Pago Webhook] Pagamento ID: ${paymentId}, Status: ${paymentStatus}, Ref Externa: ${externalReference}`);
            if (paymentStatus === 'approved') {
                const userId = externalReference;
                const paidAmount = payment.body.transaction_amount;
                const user = await User.findById(userId);
                if (user) { user.coins += paidAmount; await user.save(); console.log(`[Mercado Pago Webhook] Saldo do usuário ${user.username} atualizado. Novo saldo: ${user.coins}.`); }
                else { console.error(`[Mercado Pago Webhook] Usuário com ID ${userId} não encontrado para atualizar saldo.`); }
            } else if (paymentStatus === 'rejected' || paymentStatus === 'cancelled') {
                console.warn(`[Mercado Pago Webhook] Pagamento ${paymentId} foi rejeitado ou cancelado.`);
            }
            res.status(200).send('Webhook recebido e processado.');
        } catch (error) {
            console.error('[Mercado Pago Webhook] Erro ao processar webhook:', error.response ? error.response.data : error.message);
            res.status(500).send('Erro interno do servidor ao processar webhook.');
        }
    } else { res.status(200).send('Webhook recebido (tópico não relevante).'); }
});