// site_de_jogos/backend/models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    wins: {
        type: Number,
        default: 0
    },
    losses: {
        type: Number,
        default: 0
    },
    coins: {
        type: Number,
        default: 1000
    },
    role: { // Campo para papel (user/admin)
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    isActive: { // Campo para ativar/desativar conta
        type: Boolean,
        default: true
    },
    resetPasswordToken: String, // Token para redefinição de senha
    resetPasswordExpires: Date,  // Expiração do token de redefinição

    // ===== NOVOS CAMPOS PARA O PERFIL =====
    phone: {
        type: String,
        trim: true,
        default: ''
    },
    // bio: { // REMOVIDO A PEDIDO
    //     type: String,
    //     trim: true,
    //     maxlength: 150,
    //     default: ''
    // },
    description: {
        type: String,
        trim: true,
        maxlength: 500,
        default: ''
    },
    console: {
        type: String,
        enum: ['PS5', 'PS4', 'XBOX Series', 'Xbox One', 'PC', 'Nintendo Switch', ''],
        default: ''
    },
    avatarUrl: { // URL para a foto de perfil
        // ATUALIZADO: URL do placeholder padrão agora é um caminho relativo
        type: String,
        default: '/img/avatar-placeholder.png'
    },
    profileCompleted: { // Indica se o usuário já completou o perfil inicial
        type: Boolean,
        default: false
    },
    // NOVO CAMPO: Timestamp da última alteração do username
    lastUsernameChange: { 
        type: Date 
    },
    // ===== NOVOS CAMPOS PARA O SISTEMA DE AMIGOS =====
    friends: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    ],
    sentFriendRequests: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FriendRequest' // Referencia o novo modelo FriendRequest
        }
    ],
    receivedFriendRequests: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FriendRequest' // Referencia o novo modelo FriendRequest
        }
    ],
    // Campo para armazenar usuários bloqueados (mantido como está no server.js atual)
    blockedUsers: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    ]
    // ===== NOVOS CAMPOS PARA O SISTEMA DE GRUPOS REMOVIDOS =====
    // groups: [...]
    // receivedGroupInvites: [...]
    // sentGroupInvites: [...]
    // sentGroupJoinRequests: [...]
});

module.exports = mongoose.model('User', UserSchema);