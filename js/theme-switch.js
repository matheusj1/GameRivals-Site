document.querySelectorAll('.theme-option input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', function() {
        if (this.value === 'dark') {
            document.body.classList.add('theme-dark');
        } else {
            document.body.classList.remove('theme-dark');
        }
    });
});