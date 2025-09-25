// arquivo: site_de_jogos/js/theme-switch.js

document.querySelectorAll('.theme-option input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', function() {
        const selectedTheme = this.value;
        // Aplica o tema diretamente ao elemento raiz para feedback visual imediato
        document.documentElement.setAttribute('data-theme', selectedTheme);
    });
});