// arquivo: backend/services/emailService.js

const nodemailer = require('nodemailer');

// As credenciais do seu serviço de e-mail devem ser armazenadas em variáveis de ambiente
// para maior segurança. Ex:
// EMAIL_HOST=smtp.seudominio.com
// EMAIL_PORT=587
// EMAIL_USER=seu-email@seudominio.com
// EMAIL_PASS=sua-senha-de-app

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_PORT == 465, // true para 465, false para outras portas
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendPaymentEmail = async (to, subject, template) => {
    try {
        await transporter.sendMail({
            from: `"GameRivals" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html: template,
        });
        console.log(`E-mail enviado com sucesso para ${to}`);
    } catch (error) {
        console.error('Erro ao enviar e-mail:', error);
    }
};

const getEmailTemplate = (type, data) => {
    const { username, amount, date, pixKey, pixKeyType } = data;
    let subject;
    let body;

    // Use o valor do amount em centavos para formatar para reais
    const formattedAmount = (amount / 100).toFixed(2).replace('.', ',');
    const formattedDate = new Date(date).toLocaleDateString('pt-BR', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    switch (type) {
        case 'withdrawal_approved':
            subject = 'Seu pedido de saque foi APROVADO!';
            body = `
                <p>Olá, ${username}!</p>
                <p>Informamos que o seu pedido de saque no valor de <strong>R$ ${formattedAmount}</strong> foi aprovado e o pagamento está em processamento.</p>
                <p>O valor será enviado para a sua chave Pix cadastrada:</p>
                <ul>
                    <li><strong>Tipo de Chave:</strong> ${pixKeyType}</li>
                    <li><strong>Chave:</strong> ${pixKey}</li>
                </ul>
                <p>Data e Hora da Aprovação: ${formattedDate}</p>
                <p>Fique de olho na sua conta bancária!</p>
                <p>Atenciosamente,</p>
                <p>Equipe GameRivals</p>
            `;
            break;
        case 'withdrawal_rejected':
            subject = 'Seu pedido de saque foi REJEITADO.';
            body = `
                <p>Olá, ${username},</p>
                <p>Informamos que o seu pedido de saque no valor de <strong>R$ ${formattedAmount}</strong> foi rejeitado.</p>
                <p>O valor foi estornado para a sua carteira GameRivals. Por favor, verifique se os dados da sua chave Pix estão corretos e tente novamente.</p>
                <p>Data e Hora da Rejeição: ${formattedDate}</p>
                <p>Atenciosamente,</p>
                <p>Equipe GameRivals</p>
            `;
            break;
        case 'deposit_confirmed':
            subject = 'Depósito de moedas CONFIRMADO!';
            body = `
                <p>Olá, ${username}!</p>
                <p>Seu depósito de <strong>R$ ${formattedAmount}</strong> foi confirmado e as moedas equivalentes já foram adicionadas à sua carteira.</p>
                <p>Data e Hora da Confirmação: ${formattedDate}</p>
                <p>Agora você pode usar suas moedas para apostar e desafiar outros jogadores!</p>
                <p>Atenciosamente,</p>
                <p>Equipe GameRivals</p>
            `;
            break;
        default:
            return null;
    }

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
                .header { background-color: #f4f4f4; padding: 10px; text-align: center; border-bottom: 1px solid #ddd; }
                .content { padding: 20px 0; }
                .footer { text-align: center; font-size: 0.8em; color: #777; margin-top: 20px; }
                h1 { color: #555; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Notificação GameRivals</h1>
                </div>
                <div class="content">
                    ${body}
                </div>
                <div class="footer">
                    <p>Esta é uma mensagem automática. Por favor, não responda.</p>
                </div>
            </div>
        </body>
        </html>
    `;
};

module.exports = {
    sendPaymentEmail,
    getEmailTemplate
};