// arquivo: backend/middleware/auth.js

const jwt = require('jsonwebtoken');

function auth(req, res, next) {
    // Pega o token do cabeçalho da requisição
    const token = req.header('x-auth-token');

    // Verifica se não há token
    if (!token) {
        return res.status(401).json({ message: 'Nenhum token, autorização negada.' });
    }

    try {
        // Verifica se o token é válido
        // CORRIGIDO: Removido o segredo padrão inseguro.
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Adiciona o usuário (que estava no payload do token) ao objeto da requisição
        req.user = decoded;

        // Passa para a próxima etapa (a lógica da rota em si)
        next();
    } catch (e) {
        res.status(400).json({ message: 'Token inválido.' });
    }
}

module.exports = auth;