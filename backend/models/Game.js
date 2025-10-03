// arquivo: backend/models/Game.js

const mongoose = require('mongoose');

const GameSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    iconUrl: {
        type: String,
        default: '/img/game-icon-placeholder.png' // Placeholder padrão
    },
    supportedConsoles: [
        {
            type: String,
            enum: ['PS5', 'PS4', 'XBOX Series', 'Xbox One', 'PC', 'Nintendo Switch'],
            required: true
        }
    ],
    isActive: {
        type: Boolean,
        default: true
    }
});

module.exports = mongoose.model('Game', GameSchema);