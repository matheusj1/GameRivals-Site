const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true
    },
    text: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    // ESTA OPÇÃO CRIA UMA COLEÇÃO COM LIMITE (CAPPED COLLECTION)
    capped: {
        size: 102400,   // Tamanho máximo da coleção em bytes (100 KB)
        max: 200,       // Número máximo de mensagens
        autoIndexId: true
    }
});

module.exports = mongoose.model('Message', MessageSchema);