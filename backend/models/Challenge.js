// arquivo: backend/models/Challenge.js

const mongoose = require('mongoose');

const ChallengeSchema = new mongoose.Schema({
    game: { type: String, required: true, trim: true },
    console: { type: String, required: true, trim: true },
    betAmount: { type: Number, required: true },
    status: {
        type: String,
        required: true,
        // Adicionamos o status 'disputed' (em análise)
        enum: ['open', 'accepted', 'completed', 'disputed', 'cancelled'],
        default: 'open'
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    opponent: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    
    // O campo 'winner' agora será preenchido apenas quando houver um acordo
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    
    // ===== NOVO CAMPO PARA ARMAZENAR RESULTADOS =====
    // Este será um array, guardando o que cada jogador reportou.
    results: [
        {
            reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            // NOVO: Campo para armazenar a evidência (link ou texto)
            evidence: { type: String, trim: true, default: '' }
        }
    ],

    createdAt: { type: Date, default: Date.now }
});

ChallengeSchema.index(
    { createdAt: 1 },
    { 
        expireAfterSeconds: 600, // 10 minutos
        partialFilterExpression: { status: 'open' } 
    }
);

module.exports = mongoose.model('Challenge', ChallengeSchema);