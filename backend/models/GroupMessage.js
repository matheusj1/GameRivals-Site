// arquivo: backend/models/GroupMessage.js

const mongoose = require('mongoose');

const GroupMessageSchema = new mongoose.Schema({
    group: { // O grupo ao qual a mensagem pertence
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        required: true
    },
    sender: { // Quem enviou a mensagem
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    username: { // Nome de usuário do remetente (para fácil exibição)
        type: String,
        required: true
    },
    avatarUrl: { // URL do avatar do remetente (para fácil exibição)
        type: String,
        default: 'http://127.0.0.1:5500/img/avatar-placeholder.png'
    },
    text: {
        type: String,
        required: true,
        trim: true,
        maxlength: 500 // Limite de caracteres para mensagens de chat
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Crie um índice para buscar mensagens por grupo e ordenar por data
GroupMessageSchema.index({ group: 1, createdAt: 1 });

module.exports = mongoose.model('GroupMessage', GroupMessageSchema);