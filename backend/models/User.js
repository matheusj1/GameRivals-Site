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
    bio: {
        type: String,
        trim: true,
        maxlength: 150,
        default: ''
    },
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
        type: String,
        default: 'http://127.0.0.1:5500/img/avatar-placeholder.png' // URL do placeholder padrão
    },
    profileCompleted: { // Indica se o usuário já completou o perfil inicial
        type: Boolean,
        default: false
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
    ],
    // ===== NOVOS CAMPOS PARA O SISTEMA DE GRUPOS =====
    groups: [ // Grupos dos quais o usuário é membro
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Group'
        }
    ],
    receivedGroupInvites: [ // Convites de grupo que o usuário recebeu
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'GroupInvite'
        }
    ],
    sentGroupInvites: [ // Convites de grupo que o usuário enviou
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'GroupInvite'
        }
    ],
    // NOVO: Solicitações de entrada em grupo enviadas pelo usuário
    sentGroupJoinRequests: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'GroupJoinRequest' // Referencia o novo modelo GroupJoinRequest
        }
    ]
});

module.exports = mongoose.model('User', UserSchema);