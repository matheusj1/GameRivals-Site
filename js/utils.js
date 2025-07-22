// arquivo: site_de_jogos/js/utils.js
export const API_BASE_URL = 'https://gamerivals-site.onrender.com';
export const FRONTEND_BASE_URL = 'https://matheusj1.github.io/GameRivals-Site'; // Adicionado para uso em URLs de frontend

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