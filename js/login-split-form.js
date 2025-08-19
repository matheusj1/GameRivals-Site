// arquivo: site_de_jogos/js/login-split-form.js

import { API_BASE_URL, showNotification } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {

    const splitContainer = document.getElementById('login-split-container');
    const showRegisterLink = document.getElementById('show-register');
    const showLoginLink = document.getElementById('show-login');
    const showForgotPasswordLink = document.getElementById('show-forgot-password-link');
    const forgotPasswordModal = document.getElementById('forgot-password-modal');
    const closeModalBtn = forgotPasswordModal.querySelector('.close-modal-btn');

    // Funções para alternar entre login e cadastro
    showRegisterLink.addEventListener('click', (e) => {
        e.preventDefault();
        splitContainer.classList.add('register-active');
    });

    showLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        splitContainer.classList.remove('register-active');
    });
    
    // Funções para o modal de "Esqueci a Senha"
    showForgotPasswordLink.addEventListener('click', (e) => {
        e.preventDefault();
        forgotPasswordModal.classList.add('active');
    });

    closeModalBtn.addEventListener('click', () => {
        forgotPasswordModal.classList.remove('active');
    });

    window.addEventListener('click', (event) => {
        if (event.target === forgotPasswordModal) {
            forgotPasswordModal.classList.remove('active');
        }
    });

    // Lógica de autenticação e navegação (como nos seus arquivos anteriores)
    const loginForm = document.getElementById('login-form-inner');
    const registerForm = document.getElementById('cadastro-form-inner');
    const forgotPasswordForm = document.getElementById('request-reset-form');

    const loginError = document.getElementById('login-error');
    const registerError = document.getElementById('register-error');
    const forgotPasswordError = document.getElementById('forgot-password-error');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-senha').value;
        loginError.textContent = '';
        if (!email || !password) {
            loginError.textContent = 'Por favor, preencha todos os campos.';
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await response.json();
            if (!response.ok) {
                loginError.textContent = data.message || 'Ocorreu um erro no login.';
            } else {
                showNotification('Login bem-sucedido! Redirecionando...', 'success');
                localStorage.setItem('token', data.token);
                localStorage.setItem('username', data.username);
                localStorage.setItem('userId', data.userId);
                localStorage.setItem('userRole', data.userRole);
                localStorage.setItem('profileCompleted', data.profileCompleted);
                setTimeout(() => {
                    if (data.userRole === 'admin') {
                        window.location.href = 'admin.html';
                    } else if (data.profileCompleted === false) {
                        window.location.href = 'profile.html';
                    } else {
                        window.location.href = 'dashboard.html';
                    }
                }, 1000);
            }
        } catch (error) {
            console.error('Frontend: Erro ao conectar ou processar login:', error);
            loginError.textContent = 'Não foi possível conectar ao servidor.';
        }
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('reg-username').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-senha').value;
        const confirmarSenha = document.getElementById('reg-confirmar-senha'); // Adicionei aqui
        registerError.textContent = '';
        if (!username || !email || !password) {
            registerError.textContent = 'Por favor, preencha todos os campos.';
            return;
        }
        // ... (resto da sua lógica de cadastro)
    });

    // Lógica para mostrar/esconder senha
    const togglePasswordButtons = document.querySelectorAll('.toggle-password');
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
    
    // Lógica para o formulário de "Esqueci a Senha"
    forgotPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value;
        forgotPasswordError.textContent = '';

        if (!email) {
            forgotPasswordError.textContent = 'Por favor, insira seu e-mail.';
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            const data = await response.json();

            if (!response.ok) {
                forgotPasswordError.textContent = data.message || 'Erro ao solicitar redefinição.';
            } else {
                showNotification(data.message, 'info');
                forgotPasswordModal.classList.remove('active');
            }
        } catch (error) {
            console.error('Frontend: Erro ao solicitar reset de senha:', error);
            forgotPasswordError.textContent = 'Não foi possível conectar ao servidor.';
        }
    });
});