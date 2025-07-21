// arquivo: site_de_jogos/js/utils.js
export const API_BASE_URL = 'https://gamerivals-site.onrender.com'; // URL fixa do backend
// NOVO: Define a URL base da API dinamicamente para desenvolvimento local e Render
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001' // Para desenvolvimento local
    : 'https://gamerivals-site.onrender.com'; // **MUDE PARA A URL DO SEU SERVIÇO DE BACKEND NO RENDER**

// Função de Notificação Reutilizável
export function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    if (!container) {
        console.error('Container de notificação não encontrado.');
        return;
    }
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    container.appendChild(notification);

    // Adiciona a classe para iniciar a animação de saída após um tempo
    setTimeout(() => {
        notification.classList.add('slideOut');
        // Remove o elemento após a animação de saída
        notification.addEventListener('animationend', () => {
            notification.remove();
        });
    }, 3500); // Exibe por 3.5 segundos antes de iniciar a saída
}

// Função para obter o caminho do ícone do console
export const getConsoleIconPath = (consoleName) => {
    // Caminhos para as imagens de ícones do console, relativos aos arquivos HTML
    switch (consoleName) {
        case 'PS5':
        case 'PS4':
            return 'img/ps-icon.png';
        case 'XBOX Series':
        case 'Xbox One':
            return 'img/xbox-icon.png';
        case 'PC':
        return 'img/pc-icon.png';
        case 'Nintendo Switch':
            return 'img/nintendo-icon.png';
        default:
            return ''; // Retorna vazio se não houver correspondência
    }
};

// NOVO: Exporte a URL base da API para que outros módulos possam usá-la
export { API_BASE_URL };