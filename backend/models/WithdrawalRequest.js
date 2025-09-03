// arquivo: backend/models/WithdrawalRequest.js

const mongoose = require('mongoose');

const WithdrawalRequestSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 1
    },
    pixKeyType: {
        type: String,
        enum: ['email', 'cpf', 'phone', 'cnpj'],
        required: true
    },
    pixKeyValue: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    processedAt: {
        type: Date
    }
});

module.exports = mongoose.model('WithdrawalRequest', WithdrawalRequestSchema);