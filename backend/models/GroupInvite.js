// arquivo: backend/models/GroupInvite.js

const mongoose = require('mongoose');

const GroupInviteSchema = new mongoose.Schema({
    group: { // O grupo para o qual o convite foi feito
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        required: true
    },
    sender: { // Quem enviou o convite
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receiver: { // Quem recebeu o convite
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected'],
        default: 'pending'
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: '7d' // Convites pendentes expiram em 7 dias
    }
});

// Índice para garantir que não haja convites duplicados (pending) do mesmo remetente para o mesmo destinatário para o mesmo grupo
GroupInviteSchema.index({ group: 1, sender: 1, receiver: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });

module.exports = mongoose.model('GroupInvite', GroupInviteSchema);