// arquivo: site_de_jogos/js/login-modern-script.js

import { API_BASE_URL, showNotification } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form-inner');
    const registerForm = document.getElementById('cadastro-form-inner');
    const forgotPasswordForm = document.getElementById('request-reset-form');
    const loginError = document.getElementById('login-error');
    const registerError = document.getElementById('register-error');
    const forgotPasswordError = document.getElementById('forgot-password-error');

    const togglePasswordButtons = document.querySelectorAll('.password-wrapper .toggle-password');
    togglePasswordButtons.forEach(button => {
        button.addEventListener('click', () => {
            const passwordInput = button.previousElementSibling;
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                button.textContent = '🙈';
            } else {
                passwordInput.type = 'password';
                button.textContent = '👁️';
            }
        });
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-senha').value;
        loginError.textContent = '';

        if (!email || !password) {
            loginError.textContent = 'Por favor, preencha todos os campos.';
            return;
        }

        // Aqui você adicionaria a lógica de login real
        console.log('Tentativa de login:', email, password);
        showNotification('Login simulado com sucesso!', 'success');
        // window.location.href = '/dashboard';
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('reg-username').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-senha').value;
        registerError.textContent = '';

        if (!username || !email || !password) {
            registerError.textContent = 'Por favor, preencha todos os campos.';
            return;
        }
        if (password.length < 6) {
            registerError.textContent = 'A senha deve ter pelo menos 6 caracteres.';
            return;
        }

        // Aqui você adicionaria a lógica de cadastro real
        console.log('Tentativa de cadastro:', username, email, password);
        showNotification('Cadastro simulado com sucesso! Faça login.', 'success');
        // Você pode redirecionar para a seção de login ou mostrar uma mensagem
    });

    forgotPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value;
        forgotPasswordError.textContent = '';

        if (!email) {
            forgotPasswordError.textContent = 'Por favor, insira seu e-mail.';
            return;
        }

        // Aqui você adicionaria a lógica de solicitação de recuperação de senha
        console.log('Solicitação de recuperação para:', email);
        showNotification('Link de recuperação enviado para o seu e-mail (simulado).', 'info');
        document.getElementById('forgot-password-modal').style.display = 'none';
    });

    // Lógica para mostrar/esconder o modal de "Esqueceu a Senha"
    const forgotPasswordLink = document.getElementById('show-forgot-password');
    const forgotPasswordModal = document.getElementById('forgot-password-modal');
    const closeModalButton = document.querySelector('.close-button');

    if (forgotPasswordLink && forgotPasswordModal && closeModalButton) {
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            forgotPasswordModal.style.display = 'block';
        });

        closeModalButton.addEventListener('click', () => {
            forgotPasswordModal.style.display = 'none';
        });

        window.addEventListener('click', (event) => {
            if (event.target === forgotPasswordModal) {
                forgotPasswordModal.style.display = 'none';
            }
        });
    }

    // Lógica para ir para a seção de login (opcional, já está visível)
    const showLoginLink = document.getElementById('show-login');
    if (showLoginLink) {
        showLoginLink.addEventListener('click', (e) => {
            e.preventDefault();
            // Se você quiser implementar um sistema de abas ou similar, aqui você faria a lógica
            console.log('Mostrar seção de login');
        });
    }
});