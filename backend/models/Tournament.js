// arquivo: backend/models/Tournament.js

const mongoose = require('mongoose');

const MatchSchema = new mongoose.Schema({
    player1: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    player2: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: {
        type: String,
        enum: ['pending', 'in-progress', 'completed'],
        default: 'pending'
    },
    round: { type: String, required: true },
    nextMatch: { type: mongoose.Schema.Types.ObjectId, ref: 'Match' },
    reportedResults: [{
        reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }]
});

const TournamentSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    game: { type: String, required: true, trim: true },
    console: { type: String, required: true, trim: true },
    betAmount: { type: Number, required: true, default: 0 },
    scheduledTime: { type: String },
    maxParticipants: { type: Number, required: true },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    registeredAt: { type: Date, default: Date.now },
    status: {
        type: String,
        enum: ['registration', 'in-progress', 'completed', 'cancelled'],
        default: 'registration'
    },
    bracket: [MatchSchema], // Usando o subschema para os matches
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});

module.exports = mongoose.model('Tournament', TournamentSchema);