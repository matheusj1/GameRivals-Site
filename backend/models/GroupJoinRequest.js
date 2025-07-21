// arquivo: backend/models/GroupJoinRequest.js

const mongoose = require('mongoose');

const GroupJoinRequestSchema = new mongoose.Schema({
    group: { // O grupo que o usuário deseja entrar
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        required: true
    },
    requester: { // O usuário que está solicitando a entrada
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
        expires: '7d' // Solicitações pendentes expiram em 7 dias
    }
});

// Índice para garantir que não haja solicitações duplicadas (pending) do mesmo usuário para o mesmo grupo
GroupJoinRequestSchema.index({ group: 1, requester: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });

module.exports = mongoose.model('GroupJoinRequest', GroupJoinRequestSchema);