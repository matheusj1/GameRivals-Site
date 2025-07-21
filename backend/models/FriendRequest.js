// arquivo: backend/models/FriendRequest.js

const mongoose = require('mongoose');

const FriendRequestSchema = new mongoose.Schema({
    sender: { // Quem enviou a solicitação
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receiver: { // Quem recebeu a solicitação
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

// Índice para garantir que não haja solicitações duplicadas (pending) entre os mesmos dois usuários
FriendRequestSchema.index({ sender: 1, receiver: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });

module.exports = mongoose.model('FriendRequest', FriendRequestSchema);