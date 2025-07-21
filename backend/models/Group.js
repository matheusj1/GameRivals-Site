// arquivo: backend/models/Group.js

const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        minlength: 3,
        maxlength: 50
    },
    description: {
        type: String,
        trim: true,
        maxlength: 500,
        default: ''
    },
    members: [ // Referência aos usuários que são membros do grupo
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    ],
    admin: { // O criador ou administrador principal do grupo
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    // NOVO: Solicitações de entrada em grupo recebidas pelo grupo
    receivedJoinRequests: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'GroupJoinRequest' // Referencia o novo modelo GroupJoinRequest
        }
    ]
});

module.exports = mongoose.model('Group', GroupSchema);