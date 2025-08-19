// arquivo: site_de_jogos/js/main.js
import { API_BASE_URL, showNotification } from './utils.js';

// Função para aplicar o tema (light ou dark) - Mantida para compatibilidade
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
}

// Função para carregar o tema salvo ou o padrão
function loadTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        applyTheme(savedTheme);
    } else {
        applyTheme('light');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadTheme();

    const token = localStorage.getItem('token');
    const currentPage = window.location.pathname.split('/').pop();
    const profileCompleted = localStorage.getItem('profileCompleted');
    const userRole = localStorage.getItem('userRole');

    // Lógica de redirecionamento inicial
    if (token) {
        if (userRole === 'admin') {
            if (currentPage !== 'admin.html') {
                window.location.href = 'admin.html';
            }
            return;
        }
        if (profileCompleted === 'false' && currentPage !== 'profile.html') {
            showNotification('Por favor, complete seu perfil para continuar.', 'info');
            window.location.href = 'profile.html';
            return;
        } else if (profileCompleted === 'true' && currentPage === 'profile.html') {
        } else if (currentPage === 'login.html' || currentPage === 'index.html' || currentPage === '') {
            window.location.href = 'dashboard.html';
            return;
        }
    } else {
        if (currentPage !== 'login.html' && currentPage !== 'index.html' && currentPage !== '' && currentPage !== 'profile.html') {
            window.location.href = 'login.html';
            return;
        }
    }

    // Lógica do Menu Hambúrguer
    const hamburgerMenu = document.querySelector('.hamburger-menu');
    const mainNavLinks = document.querySelector('#main-nav-links');
    const body = document.body;

    if (hamburgerMenu && mainNavLinks && body) {
        hamburgerMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            mainNavLinks.classList.toggle('mobile-nav-active');
            hamburgerMenu.classList.toggle('active');
            body.classList.toggle('mobile-nav-open');
            hamburgerMenu.setAttribute('aria-expanded', mainNavLinks.classList.contains('mobile-nav-active'));
        });

        document.addEventListener('click', (e) => {
            if (mainNavLinks.classList.contains('mobile-nav-active') && !mainNavLinks.contains(e.target) && !hamburgerMenu.contains(e.target)) {
                mainNavLinks.classList.remove('mobile-nav-active');
                hamburgerMenu.classList.remove('active');
                body.classList.remove('mobile-nav-open');
                hamburgerMenu.setAttribute('aria-expanded', 'false');
            }
        });

        mainNavLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                if (mainNavLinks.classList.contains('mobile-nav-active')) {
                    mainNavLinks.classList.remove('mobile-nav-active');
                    hamburgerMenu.classList.remove('active');
                    body.classList.remove('mobile-nav-open');
                    hamburgerMenu.setAttribute('aria-expanded', 'false');
                }
            });
        });
    } else {
        console.error('Elementos do menu hambúrguer ou body não encontrados no DOM.');
    }

    const authContainer = document.querySelector('#auth-container');
    const loginFormWrapper = document.getElementById('login-form');
    const cadastroFormWrapper = document.getElementById('cadastro-form');
    const forgotPasswordFormWrapper = document.getElementById('forgot-password-form');
    const resetPasswordFormWrapper = document.getElementById('reset-password-form');

    if (authContainer) {
        const showRegisterLink = document.querySelector('#show-register-link');
        const showLoginLink = document.querySelector('#show-login-link');
        const forgotPasswordLink = document.querySelector('#forgot-password-link');
        const backToLoginLink = document.querySelector('#back-to-login-link');
        const backToLoginFromResetLink = document.querySelector('#back-to-login-from-reset-link');

        const showForm = (formToShow) => {
            const forms = [loginFormWrapper, cadastroFormWrapper, forgotPasswordFormWrapper, resetPasswordFormWrapper];
            forms.forEach(form => form.classList.remove('active-form'));
            formToShow.classList.add('active-form');
        };

        const urlParams = new URLSearchParams(window.location.search);
        const resetTokenFromUrl = urlParams.get('resetToken');

        if (resetTokenFromUrl) {
            document.getElementById('reset-token-field').value = resetTokenFromUrl;
            showForm(resetPasswordFormWrapper);
            showNotification('Por favor, defina sua nova senha.', 'info');
        } else {
            showForm(loginFormWrapper);
        }

        showRegisterLink.addEventListener('click', (e) => {
            e.preventDefault();
            showForm(cadastroFormWrapper);
        });
        showLoginLink.addEventListener('click', (e) => {
            e.preventDefault();
            showForm(loginFormWrapper);
        });
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            showForm(forgotPasswordFormWrapper);
        });
        backToLoginLink.addEventListener('click', (e) => {
            e.preventDefault();
            showForm(loginFormWrapper);
        });
        backToLoginFromResetLink.addEventListener('click', (e) => {
            e.preventDefault();
            showForm(loginFormWrapper);
        });

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

        const loginForm = document.getElementById('login-form-inner');
        const loginError = document.getElementById('login-error');

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-senha').value;
            loginError.textContent = '';

            if (!email || !password) {
                loginError.textContent = 'Todos os campos são obrigatórios!';
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

                    try {
                        localStorage.setItem('token', data.token);
                        localStorage.setItem('username', data.username);
                        localStorage.setItem('userId', data.userId);
                        localStorage.setItem('userRole', data.userRole);
                        localStorage.setItem('profileCompleted', data.profileCompleted);

                    } catch (storageError) {
                        console.error('Frontend: Erro ao salvar no Local Storage:', storageError);
                        showNotification('Erro ao salvar dados de sessão. Tente novamente.', 'error');
                        return;
                    }

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
                loginError.textContent = 'Não foi possível conectar ao servidor ou processar a resposta.';
            }
        });

        const cadastroForm = document.getElementById('cadastro-form-inner');
        const registerError = document.getElementById('register-error');

        cadastroForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('reg-username').value;
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-senha').value;
            const confirmarSenha = document.getElementById('reg-confirmar-senha').value;
            registerError.textContent = '';

            if (!username || !email || !password || !confirmarSenha) {
                registerError.textContent = 'Todos os campos são obrigatórios!';
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
                    body: JSON.stringify({ username, email, password }),
                });

                const data = await response.json();

                if (!response.ok) {
                    registerError.textContent = data.message || 'Ocorreu um erro.';
                } else {
                    showNotification('Cadastro realizado com sucesso! Faça o login.', 'success');
                    cadastroForm.reset();
                    showForm(loginFormWrapper);
                }
            } catch (error) {
                console.error('Frontend: Erro ao conectar ou processar cadastro:', error);
                registerError.textContent = 'Não foi possível conectar ao servidor.';
            }
        });

        const requestResetForm = document.getElementById('request-reset-form');
        const forgotPasswordError = document.getElementById('forgot-password-error');

        requestResetForm.addEventListener('submit', async (e) => {
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
                    requestResetForm.reset();
                }
            } catch (error) {
                console.error('Frontend: Erro ao solicitar reset de senha:', error);
                forgotPasswordError.textContent = 'Não foi possível conectar ao servidor.';
            }
        });

        const doResetForm = document.getElementById('do-reset-form');
        const resetPasswordError = document.getElementById('reset-password-error');

        doResetForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newPassword = document.getElementById('new-password').value;
            const confirmNewPassword = document.getElementById('confirm-new-password').value;
            const resetToken = document.getElementById('reset-token-field').value;
            resetPasswordError.textContent = '';

            if (!newPassword || !confirmNewPassword || !resetToken) {
                resetPasswordError.textContent = 'Todos os campos são obrigatórios.';
                return;
            }
            if (newPassword !== confirmNewPassword) {
                resetPasswordError.textContent = 'As senhas não coincidem!';
                return;
            }
            if (newPassword.length < 6) {
                resetPasswordError.textContent = 'A nova senha deve ter pelo menos 6 caracteres.';
                return;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/api/reset-password/${resetToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newPassword })
                });

                const data = await response.json();

                if (!response.ok) {
                    resetPasswordError.textContent = data.message || 'Erro ao redefinir a senha.';
                } else {
                    showNotification(data.message, 'success');
                    doResetForm.reset();
                    showForm(loginFormWrapper);
                }
            } catch (error) {
                console.error('Frontend: Erro ao redefinir senha:', error);
                resetPasswordError.textContent = 'Não foi possível conectar ao servidor.';
            }
        });
    }

    const yearSpan = document.getElementById('currentYear');
    if (yearSpan) { yearSpan.textContent = new Date().getFullYear(); }

    function carregarCarteira() {}
});