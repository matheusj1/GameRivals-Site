// arquivo: backend/middleware/adminAuth.js

const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Importa o modelo de Usuário

async function adminAuth(req, res, next) {
    // Pega o token do cabeçalho da requisição
    const token = req.header('x-auth-token');

    // Verifica se não há token
    if (!token) {
        return res.status(401).json({ message: 'Nenhum token, autorização negada.' });
    }

    try {
        // Verifica se o token é válido
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'seu_segredo_jwt_padrao');

        // Adiciona o usuário (que estava no payload do token) ao objeto da requisição
        req.user = decoded;

        // NOVO: Busca o usuário no banco de dados para verificar o papel
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        // Verifica se o usuário é um administrador
        if (user.role !== 'admin') {
            return res.status(403).json({ message: 'Acesso negado. Apenas administradores.' });
        }

        // Se for admin, passa para a próxima etapa
        next();
    } catch (e) {
        // Loga o erro do JWT para depuração
        console.error("Erro na autenticação de admin:", e.message);
        res.status(400).json({ message: 'Token inválido ou expirado.' });
    }
}

module.exports = adminAuth;