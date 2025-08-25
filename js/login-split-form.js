// arquivo: site_de_jogos/js/login-split-form.js

import { API_BASE_URL, showNotification } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {

    const splitContainer = document.getElementById('login-split-container');
    const loginFormWrapper = document.querySelector('.login-half');
    const registerFormWrapper = document.querySelector('.register-half');
    const showRegisterLink = document.getElementById('show-register');
    const showLoginLink = document.getElementById('show-login');
    const showForgotPasswordLink = document.getElementById('show-forgot-password-link');
    const forgotPasswordModal = document.getElementById('forgot-password-modal');
    const closeModalBtn = forgotPasswordModal.querySelector('.close-modal-btn');
    
    // Funções para alternar entre login e cadastro
    // MODIFICADO: Lógica para telas menores
    const showForm = (formToShow) => {
        if (window.innerWidth <= 768) {
            const forms = [loginFormWrapper, registerFormWrapper];
            forms.forEach(form => form.classList.remove('active-form'));
            formToShow.classList.add('active-form');
        } else {
            if (formToShow === registerFormWrapper) {
                splitContainer.classList.add('register-active');
            } else {
                splitContainer.classList.remove('register-active');
            }
        }
    };

    // Lógica inicial para exibir o formulário correto em telas pequenas
    if (window.innerWidth <= 768) {
        showForm(loginFormWrapper);
    }

    showRegisterLink.addEventListener('click', (e) => {
        e.preventDefault();
        showForm(registerFormWrapper);
    });

    showLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        showForm(loginFormWrapper);
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
        const fullName = document.getElementById('reg-full-name').value;
        const cpf = document.getElementById('reg-cpf').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-senha').value;
        const confirmarSenha = document.getElementById('reg-confirmar-senha').value;
        registerError.textContent = '';
        if (!username || !fullName || !cpf || !email || !password || !confirmarSenha) {
            registerError.textContent = 'Por favor, preencha todos os campos.';
            return;
        }
        if (password !== confirmarSenha) {
            registerError.textContent = 'As senhas não coincidem!';
            return;
        }
        if (password.length < 6) {
            registerError.textContent = 'A senha deve ter pelo menos 6 caracteres.';
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, fullName, cpf, email, password }),
            });

            const data = await response.json();

            if (!response.ok) {
                registerError.textContent = data.message || 'Ocorreu um erro.';
            } else {
                showNotification('Cadastro realizado com sucesso! Faça o login.', 'success');
                registerForm.reset();
                showForm(loginFormWrapper); // Volta para o formulário de login
            }
        } catch (error) {
            console.error('Frontend: Erro ao conectar ou processar cadastro:', error);
            registerError.textContent = 'Não foi possível conectar ao servidor.';
        }
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
    
    // NOVO: Máscara para o campo de CPF
    const cpfInput = document.getElementById('reg-cpf');
    if (cpfInput) {
        cpfInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, ''); // Remove tudo que não é dígito
            value = value.slice(0, 11); // Limita a 11 dígitos
            if (value.length > 9) {
                value = value.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
            } else if (value.length > 6) {
                value = value.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1.$2.$3');
            } else if (value.length > 3) {
                value = value.replace(/^(\d{3})(\d{3})$/, '$1.$2');
            }
            e.target.value = value;
        });
    }
});