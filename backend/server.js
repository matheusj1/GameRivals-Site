// Arquivo: backend/server.js

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { check, validationResult } = require('express-validator');

// Modelos
const User = require('./models/User');
const Challenge = require('./models/Challenge');
const WithdrawalRequest = require('./models/WithdrawalRequest');
const PixPaymentNotification = require('./models/PixPaymentNotification');
const FriendRequest = require('./models/FriendRequest');
const Message = require('./models/Message');
const Group = require('./models/Group');
const GroupMessage = require('./models/GroupMessage');
const GroupJoinRequest = require('./models/GroupJoinRequest');
const GroupInvite = require('./models/GroupInvite');
const Notification = require('./models/Notification');

// Middleware
const auth = require('./middleware/auth');
const adminAuth = require('./middleware/adminAuth');

// NOVO: Importa o serviço de e-mail
const { sendPaymentEmail, getEmailTemplate } = require('./services/emailService');

const app = express();
const server = http.createServer(app);

// Configuração do Socket.IO
const io = new Server(server, {
    cors: {
        origin: "*", // Permite todas as origens para o socket.io
        methods: ["GET", "POST"]
    }
});

app.use(express.json());
app.use(cors());

// Variáveis de ambiente
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB conectado com sucesso.'))
    .catch(err => console.error('Erro de conexão com o MongoDB:', err));

// Mapeamento de usuários online por socket.id
let onlineUsers = {};

io.on('connection', (socket) => {
    console.log(`Novo cliente conectado: ${socket.id}`);

    socket.on('user connected', ({ username, id }) => {
        onlineUsers[socket.id] = { username, id };
        io.emit('update user list', Object.values(onlineUsers));
        console.log(`Usuário conectado: ${username} (ID: ${id})`);
    });

    socket.on('join room', (roomId) => {
        socket.join(roomId);
        console.log(`Socket ${socket.id} se juntou à sala ${roomId}`);
    });

    socket.on('leave room', (roomId) => {
        socket.leave(roomId);
        console.log(`Socket ${socket.id} saiu da sala ${roomId}`);
    });

    socket.on('chat message', async ({ senderId, receiverId, message, timestamp }) => {
        const newMessage = new Message({
            sender: senderId,
            receiver: receiverId,
            text: message,
            timestamp
        });
        await newMessage.save();

        const senderUsername = onlineUsers[socket.id] ? onlineUsers[socket.id].username : 'Desconhecido';
        const receiverSocketId = Object.keys(onlineUsers).find(key => onlineUsers[key].id === receiverId);

        if (receiverSocketId) {
            io.to(receiverSocketId).emit('chat message', {
                senderId: senderId,
                senderUsername: senderUsername,
                text: message,
                timestamp
            });
        }
        socket.emit('chat message', {
            senderId: senderId,
            senderUsername: senderUsername,
            text: message,
            timestamp
        });
    });

    socket.on('group chat message', async ({ groupId, senderId, message, timestamp }) => {
        const newGroupMessage = new GroupMessage({
            group: groupId,
            sender: senderId,
            text: message,
            timestamp
        });
        await newGroupMessage.save();
        const groupMessage = await GroupMessage.findById(newGroupMessage._id).populate('sender', 'username');
        io.to(groupId).emit('group chat message', groupMessage);
    });

    socket.on('send-notification', ({ recipientId, type, message }) => {
        const recipientSocketId = Object.keys(onlineUsers).find(key => onlineUsers[key].id === recipientId);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('receive-notification', { type, message });
        }
    });

    socket.on('disconnect', () => {
        console.log(`Cliente desconectado: ${socket.id}`);
        delete onlineUsers[socket.id];
        io.emit('update user list', Object.values(onlineUsers));
    });
});

// Rotas de API
app.get('/', (req, res) => {
    res.send('API está funcionando.');
});

// Rota de registro
app.post('/api/register', [
    check('username', 'O nome de usuário é obrigatório.').not().isEmpty(),
    check('email', 'Por favor, inclua um e-mail válido.').isEmail(),
    check('password', 'A senha deve ter 6 ou mais caracteres.').isLength({ min: 6 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;

    try {
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: 'Este e-mail já está registrado.' });
        }

        user = new User({
            username,
            email,
            password,
        });

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);

        await user.save();

        const payload = {
            user: {
                id: user.id
            }
        };

        jwt.sign(
            payload,
            JWT_SECRET,
            { expiresIn: '5h' },
            (err, token) => {
                if (err) throw err;
                res.status(201).json({ token, user: { id: user.id, username: user.username, role: user.role } });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota de login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        let user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Credenciais inválidas.' });
        }

        if (!user.isActive) {
            return res.status(403).json({ message: 'Sua conta está desativada. Por favor, entre em contato com o suporte.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Credenciais inválidas.' });
        }

        const payload = {
            user: {
                id: user.id
            }
        };

        jwt.sign(
            payload,
            JWT_SECRET,
            { expiresIn: '5h' },
            (err, token) => {
                if (err) throw err;
                res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota de busca de usuários (pública)
app.get('/api/users/search', async (req, res) => {
    const { q } = req.query;
    try {
        if (!q) {
            return res.status(400).json({ message: 'A busca é obrigatória.' });
        }
        const users = await User.find({
            username: { $regex: new RegExp(q, 'i') }
        }).select('-password -email -role -createdAt -isActive');
        res.json(users);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para o painel do usuário
app.get('/api/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para atualizar moedas do usuário
app.patch('/api/users/update-coins', auth, async (req, res) => {
    const { amount } = req.body;
    if (typeof amount !== 'number') {
        return res.status(400).json({ message: 'Valor inválido.' });
    }
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        user.coins = amount;
        await user.save();
        res.json({ message: 'Moedas atualizadas com sucesso.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota de criação de desafio
app.post('/api/challenges', auth, async (req, res) => {
    const { game, console, betAmount } = req.body;
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        if (user.coins < betAmount) {
            return res.status(400).json({ message: 'Saldo insuficiente para a aposta.' });
        }

        const newChallenge = new Challenge({
            createdBy: req.user.id,
            game,
            console,
            betAmount
        });

        user.coins -= betAmount;
        await user.save();
        await newChallenge.save();
        res.status(201).json(newChallenge);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para aceitar desafio
app.patch('/api/challenges/:id/accept', auth, async (req, res) => {
    try {
        const challenge = await Challenge.findById(req.params.id);
        if (!challenge) {
            return res.status(404).json({ message: 'Desafio não encontrado.' });
        }
        if (challenge.status !== 'open') {
            return res.status(400).json({ message: 'Desafio não está aberto para ser aceito.' });
        }
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        if (user.coins < challenge.betAmount) {
            return res.status(400).json({ message: 'Saldo insuficiente para aceitar o desafio.' });
        }

        user.coins -= challenge.betAmount;
        challenge.opponent = req.user.id;
        challenge.status = 'accepted';

        await user.save();
        await challenge.save();
        res.json({ message: 'Desafio aceito com sucesso.', challenge });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para disputar desafio
app.patch('/api/challenges/:id/dispute', auth, async (req, res) => {
    try {
        const challenge = await Challenge.findById(req.params.id);
        if (!challenge) {
            return res.status(404).json({ message: 'Desafio não encontrado.' });
        }
        if (challenge.status !== 'accepted' && challenge.status !== 'completed') {
            return res.status(400).json({ message: 'Apenas desafios aceitos ou completos podem ser disputados.' });
        }
        if (challenge.status === 'disputed') {
            return res.status(400).json({ message: 'Este desafio já está em disputa.' });
        }

        const user = req.user.id;
        if (challenge.createdBy.toString() !== user && challenge.opponent.toString() !== user) {
            return res.status(403).json({ message: 'Você não tem permissão para disputar este desafio.' });
        }

        challenge.status = 'disputed';
        await challenge.save();

        res.json({ message: 'Disputa registrada com sucesso. A equipe de administração irá analisar.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota de conclusão de desafio (privado, apenas para os participantes)
app.patch('/api/challenges/:id/complete', auth, async (req, res) => {
    try {
        const challenge = await Challenge.findById(req.params.id);
        if (!challenge) {
            return res.status(404).json({ message: 'Desafio não encontrado.' });
        }
        if (challenge.status !== 'accepted') {
            return res.status(400).json({ message: 'Desafio não está em andamento.' });
        }

        const user = req.user.id;
        const { winnerId } = req.body;

        if (challenge.createdBy.toString() !== user && challenge.opponent.toString() !== user) {
            return res.status(403).json({ message: 'Você não tem permissão para concluir este desafio.' });
        }

        if (winnerId !== challenge.createdBy.toString() && winnerId !== challenge.opponent.toString()) {
            return res.status(400).json({ message: 'Vencedor inválido.' });
        }

        const winner = await User.findById(winnerId);
        const loserId = winnerId === challenge.createdBy.toString() ? challenge.opponent : challenge.createdBy;
        const loser = await User.findById(loserId);

        if (!winner || !loser) {
            return res.status(404).json({ message: 'Vencedor ou perdedor não encontrado.' });
        }

        winner.wins += 1;
        loser.losses += 1;
        winner.coins += challenge.betAmount * 2;
        challenge.winner = winnerId;
        challenge.status = 'completed';

        await winner.save();
        await loser.save();
        await challenge.save();

        res.json({ message: 'Desafio concluído com sucesso.', winnerUsername: winner.username });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para buscar desafios
app.get('/api/challenges', auth, async (req, res) => {
    try {
        const challenges = await Challenge.find({
            $or: [{ createdBy: req.user.id }, { opponent: req.user.id }],
            status: { $in: ['open', 'accepted', 'completed', 'disputed'] }
        })
        .populate('createdBy', 'username')
        .populate('opponent', 'username')
        .populate('winner', 'username')
        .sort({ createdAt: -1 });

        res.json(challenges);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rotas de Amizade
app.post('/api/friends/add/:friendId', auth, async (req, res) => {
    try {
        const user = req.user.id;
        const friend = req.params.friendId;

        if (user === friend) {
            return res.status(400).json({ message: 'Você não pode adicionar a si mesmo.' });
        }
        
        // Verifica se a amizade já existe
        const existingFriendship = await User.findOne({ _id: user, friends: friend });
        if (existingFriendship) {
            return res.status(400).json({ message: 'Vocês já são amigos.' });
        }

        // Verifica se já existe uma solicitação pendente
        const existingRequest = await FriendRequest.findOne({ sender: user, receiver: friend, status: 'pending' });
        if (existingRequest) {
            return res.status(400).json({ message: 'Solicitação de amizade já enviada.' });
        }

        // Verifica se existe uma solicitação de volta (o outro usuário te enviou primeiro)
        const reciprocalRequest = await FriendRequest.findOne({ sender: friend, receiver: user, status: 'pending' });
        if (reciprocalRequest) {
            return res.status(400).json({ message: 'Este usuário já te enviou uma solicitação de amizade.' });
        }

        const newRequest = new FriendRequest({
            sender: user,
            receiver: friend
        });
        await newRequest.save();

        // Salva a notificação
        const newNotification = new Notification({
            recipient: friend,
            type: 'friend_request',
            message: `Você recebeu uma nova solicitação de amizade.`,
            meta: {
                senderId: user
            }
        });
        await newNotification.save();
        
        res.json({ message: 'Solicitação de amizade enviada.' });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para aceitar uma solicitação de amizade
app.patch('/api/friends/accept/:requestId', auth, async (req, res) => {
    try {
        const requestId = req.params.requestId;
        const request = await FriendRequest.findById(requestId);

        if (!request) {
            return res.status(404).json({ message: 'Solicitação não encontrada.' });
        }

        if (request.receiver.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Acesso negado.' });
        }

        const user1 = await User.findById(request.sender);
        const user2 = await User.findById(request.receiver);

        if (!user1 || !user2) {
            return res.status(404).json({ message: 'Usuários não encontrados.' });
        }

        user1.friends.push(user2._id);
        user2.friends.push(user1._id);

        await user1.save();
        await user2.save();

        request.status = 'accepted';
        await request.save();

        // Salva a notificação de aceitação
        const newNotification = new Notification({
            recipient: user1._id,
            type: 'friend_accepted',
            message: `${user2.username} aceitou sua solicitação de amizade!`,
            meta: {
                accepterId: user2._id
            }
        });
        await newNotification.save();
        
        res.json({ message: 'Solicitação de amizade aceita.' });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para rejeitar uma solicitação de amizade
app.patch('/api/friends/reject/:requestId', auth, async (req, res) => {
    try {
        const requestId = req.params.requestId;
        const request = await FriendRequest.findById(requestId);

        if (!request) {
            return res.status(404).json({ message: 'Solicitação não encontrada.' });
        }

        if (request.receiver.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Acesso negado.' });
        }
        
        request.status = 'rejected';
        await request.save();
        
        res.json({ message: 'Solicitação de amizade rejeitada.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para remover um amigo
app.patch('/api/friends/remove/:friendId', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const friend = await User.findById(req.params.friendId);

        if (!user || !friend) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        user.friends.pull(friend._id);
        friend.friends.pull(user._id);

        await user.save();
        await friend.save();

        res.json({ message: 'Amigo removido.' });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para buscar solicitações de amizade pendentes
app.get('/api/friends/requests', auth, async (req, res) => {
    try {
        const requests = await FriendRequest.find({ receiver: req.user.id, status: 'pending' }).populate('sender', 'username');
        res.json(requests);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rotas de Grupos de Desafio
app.post('/api/groups', auth, async (req, res) => {
    const { name, game, description } = req.body;
    try {
        const newGroup = new Group({
            name,
            game,
            description,
            creator: req.user.id,
            members: [req.user.id]
        });
        await newGroup.save();
        res.status(201).json(newGroup);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para buscar grupos
app.get('/api/groups', async (req, res) => {
    try {
        const groups = await Group.find().populate('creator', 'username').populate('members', 'username');
        res.json(groups);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para buscar detalhes de um grupo
app.get('/api/groups/:id', async (req, res) => {
    try {
        const group = await Group.findById(req.params.id)
            .populate('creator', 'username')
            .populate('members', 'username');

        if (!group) {
            return res.status(404).json({ message: 'Grupo não encontrado.' });
        }

        res.json(group);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para solicitar entrada em um grupo
app.post('/api/groups/:id/join', auth, async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group) {
            return res.status(404).json({ message: 'Grupo não encontrado.' });
        }
        if (group.members.includes(req.user.id)) {
            return res.status(400).json({ message: 'Você já é membro deste grupo.' });
        }
        
        const existingRequest = await GroupJoinRequest.findOne({ group: group._id, requester: req.user.id });
        if (existingRequest) {
            return res.status(400).json({ message: 'Você já solicitou a entrada neste grupo.' });
        }

        const joinRequest = new GroupJoinRequest({
            group: group._id,
            requester: req.user.id
        });
        await joinRequest.save();

        const newNotification = new Notification({
            recipient: group.creator,
            type: 'group_join_request',
            message: `Nova solicitação para entrar em seu grupo "${group.name}".`,
            meta: {
                groupId: group._id
            }
        });
        await newNotification.save();
        
        res.json({ message: 'Solicitação para entrar no grupo enviada.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para aceitar solicitação de entrada
app.patch('/api/groups/join-requests/:requestId/accept', adminAuth, async (req, res) => {
    try {
        const request = await GroupJoinRequest.findById(req.params.requestId);
        if (!request) {
            return res.status(404).json({ message: 'Solicitação não encontrada.' });
        }

        const group = await Group.findById(request.group);
        if (!group) {
            return res.status(404).json({ message: 'Grupo não encontrado.' });
        }
        
        if (group.members.includes(request.requester)) {
             return res.status(400).json({ message: 'O usuário já é membro.' });
        }

        group.members.push(request.requester);
        await group.save();
        await request.deleteOne(); // Usa deleteOne() em vez de remove()

        res.json({ message: 'Usuário adicionado ao grupo.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rotas de convite para grupos
app.post('/api/groups/:groupId/invite/:userId', auth, async (req, res) => {
    try {
        const { groupId, userId } = req.params;
        const group = await Group.findById(groupId);
        if (!group) {
            return res.status(404).json({ message: 'Grupo não encontrado.' });
        }
        if (group.creator.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Apenas o criador pode convidar membros.' });
        }
        if (group.members.includes(userId)) {
            return res.status(400).json({ message: 'Este usuário já é membro do grupo.' });
        }

        const newInvite = new GroupInvite({
            group: groupId,
            recipient: userId,
            sender: req.user.id
        });
        await newInvite.save();

        const newNotification = new Notification({
            recipient: userId,
            type: 'group_invite',
            message: `Você foi convidado para o grupo "${group.name}".`,
            meta: {
                groupId: group._id,
                senderId: req.user.id
            }
        });
        await newNotification.save();

        res.json({ message: 'Convite enviado com sucesso.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

app.patch('/api/groups/invites/:inviteId/accept', auth, async (req, res) => {
    try {
        const invite = await GroupInvite.findById(req.params.inviteId);
        if (!invite) {
            return res.status(404).json({ message: 'Convite não encontrado.' });
        }
        if (invite.recipient.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Acesso negado.' });
        }

        const group = await Group.findById(invite.group);
        if (!group) {
            return res.status(404).json({ message: 'Grupo não encontrado.' });
        }
        if (group.members.includes(req.user.id)) {
            return res.status(400).json({ message: 'Você já é membro deste grupo.' });
        }

        group.members.push(req.user.id);
        await group.save();
        await invite.deleteOne();

        res.json({ message: 'Você aceitou o convite e agora é membro do grupo.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para buscar notificações
app.get('/api/notifications', auth, async (req, res) => {
    try {
        const notifications = await Notification.find({ recipient: req.user.id }).sort({ createdAt: -1 }).limit(20);
        res.json(notifications);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para deletar notificação
app.delete('/api/notifications/:id', auth, async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.id);
        if (!notification) {
            return res.status(404).json({ message: 'Notificação não encontrada.' });
        }
        if (notification.recipient.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Acesso negado.' });
        }
        await notification.deleteOne();
        res.json({ message: 'Notificação deletada com sucesso.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para marcar notificação como lida
app.patch('/api/notifications/:id/read', auth, async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.id);
        if (!notification) {
            return res.status(404).json({ message: 'Notificação não encontrada.' });
        }
        if (notification.recipient.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Acesso negado.' });
        }
        notification.isRead = true;
        await notification.save();
        res.json({ message: 'Notificação marcada como lida.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota para gerar token de redefinição de senha
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado com este e-mail.' });
        }

        const resetToken = user.createPasswordResetToken();
        await user.save();

        const resetURL = `https://gamerivals-site.onrender.com/reset-password.html?token=${resetToken}`;
        const subject = 'Redefinição de Senha GameRivals';
        const template = `
            <p>Olá, ${user.username},</p>
            <p>Você solicitou uma redefinição de senha para sua conta GameRivals.</p>
            <p>Por favor, clique no link abaixo para redefinir sua senha:</p>
            <p><a href="${resetURL}">Redefinir Senha</a></p>
            <p>Se você não solicitou esta redefinição, por favor, ignore este e-mail.</p>
            <p>Atenciosamente,</p>
            <p>Equipe GameRivals</p>
        `;

        await sendPaymentEmail(user.email, subject, template);

        res.json({ message: 'E-mail de redefinição de senha enviado.' });
    } catch (err) {
        console.error('Erro ao processar pedido de redefinição de senha:', err);
        res.status(500).send('Erro do servidor.');
    }
});

// Rotas do Painel de Admin
app.get('/api/admin/dashboard-stats', adminAuth, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalChallenges = await Challenge.countDocuments();
        const completedChallenges = await Challenge.countDocuments({ status: 'completed' });
        const disputedChallenges = await Challenge.countDocuments({ status: 'disputed' });
        const totalCoinsBet = (await Challenge.aggregate([
            { $group: { _id: null, total: { $sum: "$betAmount" } } }
        ]))[0]?.total || 0;
        
        const onlineUsersCount = Object.keys(onlineUsers).length;

        res.json({
            totalUsers,
            onlineUsersCount,
            totalChallenges,
            completedChallenges,
            disputedChallenges,
            totalCoinsBet
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 }).select('-password');
        res.json(users);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

app.patch('/api/admin/users/:id/update-coins', adminAuth, async (req, res) => {
    const { coins } = req.body;
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        if (typeof coins !== 'number' || coins < 0) {
            return res.status(400).json({ message: 'Valor de moedas inválido.' });
        }
        user.coins = coins;
        await user.save();
        res.json({ message: `Saldo do usuário ${user.username} atualizado para ${user.coins} moedas.` });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

app.patch('/api/admin/users/:id/toggle-active', adminAuth, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        user.isActive = !user.isActive;
        await user.save();
        res.json({ message: `Conta do usuário ${user.username} ${user.isActive ? 'ativada' : 'desativada'} com sucesso.` });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

app.get('/api/admin/challenges', adminAuth, async (req, res) => {
    try {
        const challenges = await Challenge.find()
            .populate('createdBy', 'username')
            .populate('opponent', 'username')
            .populate('winner', 'username')
            .sort({ createdAt: -1 });
        res.json(challenges);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

app.patch('/api/admin/challenges/:id/cancel', adminAuth, async (req, res) => {
    try {
        const challenge = await Challenge.findById(req.params.id);
        if (!challenge) {
            return res.status(404).json({ message: 'Desafio não encontrado.' });
        }
        if (challenge.status === 'completed' || challenge.status === 'disputed') {
            return res.status(400).json({ message: 'Não é possível cancelar um desafio concluído ou em disputa.' });
        }

        // Devolve o valor apostado aos usuários
        const creator = await User.findById(challenge.createdBy);
        creator.coins += challenge.betAmount;
        await creator.save();

        if (challenge.opponent) {
            const opponent = await User.findById(challenge.opponent);
            opponent.coins += challenge.betAmount;
            await opponent.save();
        }

        challenge.status = 'canceled';
        await challenge.save();

        res.json({ message: 'Desafio cancelado. O valor da aposta foi devolvido aos jogadores.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

app.patch('/api/admin/challenges/:id/resolve-dispute', adminAuth, async (req, res) => {
    const { winnerId } = req.body;
    try {
        const challenge = await Challenge.findById(req.params.id);
        if (!challenge) {
            return res.status(404).json({ message: 'Desafio não encontrado.' });
        }
        if (challenge.status !== 'disputed') {
            return res.status(400).json({ message: 'Este desafio não está em disputa.' });
        }
        
        const winner = await User.findById(winnerId);
        if (!winner) {
            return res.status(404).json({ message: 'Vencedor não encontrado.' });
        }

        const loserId = winnerId === challenge.createdBy.toString() ? challenge.opponent : challenge.createdBy;
        const loser = await User.findById(loserId);

        if (!loser) {
            return res.status(404).json({ message: 'Perdedor não encontrado.' });
        }

        winner.wins += 1;
        loser.losses += 1;
        winner.coins += challenge.betAmount * 2;
        challenge.winner = winnerId;
        challenge.status = 'completed';
        
        await winner.save();
        await loser.save();
        await challenge.save();

        res.json({ message: `Disputa resolvida. ${winner.username} foi declarado o vencedor.` });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rotas de Saques
app.post('/api/withdrawals', auth, async (req, res) => {
    const { amount, pixKeyType, pixKeyValue } = req.body;
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        if (user.coins < amount) {
            return res.status(400).json({ message: 'Saldo insuficiente para o saque.' });
        }
        
        // Converte o valor de reais para centavos para garantir precisão
        const amountInCents = Math.round(amount * 100);

        const newWithdrawal = new WithdrawalRequest({
            userId: user._id,
            amount: amountInCents, // Armazena em centavos
            pixKeyType,
            pixKeyValue,
            status: 'pending'
        });

        // Deduz as moedas do usuário
        user.coins -= amount;
        await user.save();
        await newWithdrawal.save();

        res.status(201).json({ message: 'Solicitação de saque enviada com sucesso. Aguarde aprovação.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota de Admin para buscar saques pendentes
app.get('/api/admin/pending-withdrawals', adminAuth, async (req, res) => {
    try {
        const withdrawals = await WithdrawalRequest.find({ status: 'pending' }).populate('userId', 'username email cpf');
        res.json(withdrawals);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// NOVO: Rota de Admin para APROVAR saque e enviar e-mail
app.patch('/api/admin/withdrawals/:id/approve', adminAuth, async (req, res) => {
    try {
        const withdrawal = await WithdrawalRequest.findById(req.params.id).populate('userId', 'username email');
        if (!withdrawal) {
            return res.status(404).json({ message: 'Solicitação de saque não encontrada.' });
        }
        if (withdrawal.status !== 'pending') {
            return res.status(400).json({ message: 'Esta solicitação já foi processada.' });
        }
        
        withdrawal.status = 'approved';
        withdrawal.processedAt = Date.now();
        await withdrawal.save();

        // Envia o e-mail de aprovação
        const templateData = {
            username: withdrawal.userId.username,
            amount: withdrawal.amount,
            date: withdrawal.processedAt,
            pixKey: withdrawal.pixKeyValue,
            pixKeyType: withdrawal.pixKeyType
        };
        const template = getEmailTemplate('withdrawal_approved', templateData);
        await sendPaymentEmail(withdrawal.userId.email, 'Seu saque foi aprovado!', template);

        res.json({ message: 'Saque aprovado com sucesso. Notificação enviada por e-mail.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// NOVO: Rota de Admin para REJEITAR saque e enviar e-mail
app.patch('/api/admin/withdrawals/:id/reject', adminAuth, async (req, res) => {
    try {
        const withdrawal = await WithdrawalRequest.findById(req.params.id).populate('userId', 'username email');
        if (!withdrawal) {
            return res.status(404).json({ message: 'Solicitação de saque não encontrada.' });
        }
        if (withdrawal.status !== 'pending') {
            return res.status(400).json({ message: 'Esta solicitação já foi processada.' });
        }
        
        const user = await User.findById(withdrawal.userId._id);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        
        // Estorna o valor para o saldo do usuário
        user.coins += (withdrawal.amount / 100);
        await user.save();
        
        withdrawal.status = 'rejected';
        withdrawal.processedAt = Date.now();
        await withdrawal.save();

        // Envia o e-mail de rejeição
        const templateData = {
            username: user.username,
            amount: withdrawal.amount,
            date: withdrawal.processedAt
        };
        const template = getEmailTemplate('withdrawal_rejected', templateData);
        await sendPaymentEmail(user.email, 'Seu saque foi rejeitado.', template);

        res.json({ message: 'Saque rejeitado. Valor estornado para o usuário e notificação enviada por e-mail.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});


// Rota para o usuário notificar pagamento via Pix
app.post('/api/notify-pix-payment', auth, async (req, res) => {
    const { amount } = req.body;
    if (typeof amount !== 'number') {
        return res.status(400).json({ message: 'Valor inválido.' });
    }
    
    try {
        // Converte o valor de reais para centavos
        const amountInCents = Math.round(amount * 100);
        
        const newNotification = new PixPaymentNotification({
            userId: req.user.id,
            amount: amountInCents,
            status: 'pending'
        });
        await newNotification.save();
        
        res.status(201).json({ message: 'Notificação de pagamento enviada para verificação do administrador.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Rota de Admin para buscar pagamentos Pix pendentes
app.get('/api/admin/pending-pix', adminAuth, async (req, res) => {
    try {
        const pendingPayments = await PixPaymentNotification.find({ status: 'pending' }).populate('userId', 'username email');
        res.json(pendingPayments);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// NOVO: Rota de Admin para CONFIRMAR pagamento Pix e enviar e-mail
app.patch('/api/admin/confirm-pix/:paymentId', adminAuth, async (req, res) => {
    try {
        const payment = await PixPaymentNotification.findById(req.params.paymentId).populate('userId', 'username email');
        if (!payment) {
            return res.status(404).json({ message: 'Pagamento não encontrado.' });
        }
        if (payment.status !== 'pending') {
            return res.status(400).json({ message: 'Este pagamento já foi processado.' });
        }
        
        const user = await User.findById(payment.userId._id);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        const amountInCoins = payment.amount / 100;
        user.coins += amountInCoins;
        await user.save();
        
        payment.status = 'completed';
        payment.processedAt = Date.now();
        await payment.save();
        
        // Envia o e-mail de confirmação
        const templateData = {
            username: user.username,
            amount: payment.amount,
            date: payment.processedAt
        };
        const template = getEmailTemplate('deposit_confirmed', templateData);
        await sendPaymentEmail(user.email, 'Depósito de moedas confirmado!', template);

        res.json({ message: 'Pagamento Pix confirmado. Moedas adicionadas ao usuário e notificação enviada por e-mail.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro do servidor.');
    }
});

// Servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, '..')));

// Redirecionar todas as outras rotas para o index.html (para SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));