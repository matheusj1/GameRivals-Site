// arquivo: site_de_jogos/js/profile.js

// Função de Notificação Reutilizável (Importada de utils.js, a declaração local foi removida)
import { showNotification, API_BASE_URL, FRONTEND_BASE_URL } from './utils.js'; // Adicionado API_BASE_URL e FRONTEND_BASE_URL

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('userId');
    const userRole = localStorage.getItem('userRole');

    // Redirecionar se não estiver logado ou se for admin
    if (!token || !userId) {
        window.location.href = 'login-split-form.html';
        return;
    }
    if (userRole === 'admin') {
        window.location.href = 'admin.html';
        return;
    }

    const profileForm = document.getElementById('profile-form');
    const usernameInput = document.getElementById('username');
    const phoneInput = document.getElementById('phone');
    const bioTextarea = document.getElementById('bio');
    const descriptionTextarea = document.getElementById('description');
    const consoleSelect = document.getElementById('console');
    const avatarUploadInput = document.getElementById('avatar-upload');
    const avatarPreview = document.getElementById('profile-avatar-preview');
    const profileError = document.getElementById('profile-error');
    const logoutButton = document.getElementById('logout-button'); // Botão de logout no header do profile.html
    const dashboardLink = document.querySelector('header nav ul li a[href="dashboard.html"]'); // Link para Dashboard

    // NOVOS ELEMENTOS DA CARTEIRA
    const walletCurrentBalanceSpan = document.getElementById('wallet-current-balance');
    const depositAmountButtons = document.querySelectorAll('.deposit-amount-btn');
    const withdrawAmountInput = document.getElementById('withdraw-amount');
    const withdrawBtn = document.getElementById('withdraw-btn');
    const walletError = document.getElementById('wallet-error');

    const pixPaymentDetailsDiv = document.getElementById('pix-payment-details');
    const pixQrCodeImg = document.getElementById('pix-qr-code');
    const pixKeyCopyInput = document.getElementById('pix-key-copy');
    const copyPixKeyBtn = document.getElementById('copy-pix-key-btn');


    // Preencher campos com dados existentes do usuário
    const fetchUserProfile = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/users/me`, {
                headers: {
                    'x-auth-token': token
                }
            });
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    showNotification('Sessão expirada. Faça login novamente.', 'error');
                    localStorage.clear();
                    setTimeout(() => window.location.href = 'login-split-form.html', 1500);
                    return;
                }
                throw new Error('Erro ao carregar perfil.');
            }
            const userData = await response.json();

            usernameInput.value = userData.username || '';
            phoneInput.value = userData.phone || '';
            bioTextarea.value = userData.bio || '';
            descriptionTextarea.value = userData.description || '';
            consoleSelect.value = userData.console || '';

            if (userData.avatarUrl) {
                avatarPreview.src = userData.avatarUrl;
            } else {
                avatarPreview.src = `${FRONTEND_BASE_URL}/img/avatar-placeholder.png`;
            }
        } catch (error) {
            console.error('Erro ao buscar perfil:', error);
            profileError.textContent = error.message;
            showNotification('Erro ao carregar seu perfil.', 'error');
        }
    };

    // NOVA FUNÇÃO: Buscar e exibir saldo da carteira
    const fetchWalletBalance = async () => {
        if (!walletCurrentBalanceSpan) return;
        walletCurrentBalanceSpan.textContent = 'Carregando...';
    
        try {
            const response = await fetch(`${API_BASE_URL}/api/users/me/stats`, {
                headers: { 'x-auth-token': token }
            });
    
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Erro ao buscar saldo da carteira.');
            }
    
            const stats = await response.json();
    
            if (stats.coins !== undefined) {
                walletCurrentBalanceSpan.textContent = stats.coins.toLocaleString('pt-BR');
            } else {
                walletCurrentBalanceSpan.textContent = '0';
            }
    
            // Atualiza o saldo também no header do dashboard/perfil
            const coinBalanceDesktop = document.getElementById('coin-balance-desktop');
            const coinBalanceMobile = document.getElementById('coin-balance-mobile');
            if (coinBalanceDesktop) coinBalanceDesktop.textContent = stats.coins.toLocaleString('pt-BR');
            if (coinBalanceMobile) coinBalanceMobile.textContent = stats.coins.toLocaleString('pt-BR');
    
        } catch (error) {
            console.error('Erro ao buscar saldo da carteira:', error);
            walletCurrentBalanceSpan.textContent = 'Erro';
            showNotification(`Erro: ${error.message}`, 'error');
        }
    };


    await fetchUserProfile();
    await fetchWalletBalance();


    // Pré-visualização da imagem do avatar
    avatarUploadInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                avatarPreview.src = e.target.result;
            };
            reader.readAsDataURL(file);
        } else {
            avatarPreview.src = `${FRONTEND_BASE_URL}/img/avatar-placeholder.png`;
        }
    });

    // Lógica de submissão do formulário de perfil
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        profileError.textContent = '';

        const formData = new FormData();
        formData.append('username', usernameInput.value);
        formData.append('phone', phoneInput.value);
        formData.append('bio', bioTextarea.value);
        formData.append('description', descriptionTextarea.value);
        formData.append('console', consoleSelect.value);

        if (avatarUploadInput.files.length > 0) {
            formData.append('avatar', avatarUploadInput.files[0]);
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/users/profile`, {
                method: 'PATCH',
                headers: {
                    'x-auth-token': token
                },
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                profileError.textContent = data.message || 'Erro ao salvar perfil.';
                showNotification(data.message || 'Erro ao salvar perfil.', 'error');
            } else {
                showNotification('Perfil salvo com sucesso!', 'success');
                if (data.user.username) {
                    localStorage.setItem('username', data.user.username);
                    usernameInput.value = data.user.username;
                }
                if (data.user.avatarUrl) {
                    localStorage.setItem('avatarUrl', data.user.avatarUrl);
                    avatarPreview.src = data.user.avatarUrl;
                }
                localStorage.setItem('profileCompleted', data.user.profileCompleted);

                if (data.user.profileCompleted) {
                    setTimeout(() => {
                        window.location.href = 'dashboard.html';
                    }, 1500);
                } else {
                    fetchUserProfile();
                }
            }
        } catch (error) {
            console.error('Erro ao salvar perfil:', error);
            profileError.textContent = 'Não foi possível conectar ao servidor.';
            showNotification('Não foi possível conectar ao servidor.', 'error');
        }
    });

    // LÓGICA DE DEPÓSITO VIA PIX
    depositAmountButtons.forEach(button => {
        button.addEventListener('click', async () => {
            walletError.textContent = '';
            pixPaymentDetailsDiv.style.display = 'none';

            const amount = parseInt(button.dataset.amount);
            const depositCard = button.closest('.deposit-card');
            let notifyButton = document.getElementById('pix-notify-payment-btn');
            if (notifyButton) {
                notifyButton.remove();
            }

            if (amount === 10) {
                const pixKey = '00020126360014BR.GOV.BCB.PIX0114+5511972519097520400005303986540510.005802BR5923Matheus Jose dos Santos6009SAO PAULO62140510aUom3cX4yZ63041BB7';
                const qrCodeUrl = 'https://github.com/matheusj1/GameRivals-Site/raw/main/img/10%20reais.jpeg'; // CORRIGIDO PARA O LINK BRUTO DO GITHUB
                
                pixQrCodeImg.src = qrCodeUrl;
                pixKeyCopyInput.value = pixKey;
                pixPaymentDetailsDiv.style.display = 'block';

                // Cria o novo botão de notificação
                notifyButton = document.createElement('button');
                notifyButton.id = 'pix-notify-payment-btn';
                notifyButton.className = 'cta-button form-submit-btn';
                notifyButton.textContent = 'Já paguei, me notifique';
                notifyButton.style.marginTop = '20px';
                depositCard.appendChild(notifyButton);

                notifyButton.addEventListener('click', async () => {
                    try {
                        const response = await fetch(`${API_BASE_URL}/api/payment/notify-pix`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-auth-token': token
                            },
                            body: JSON.stringify({ amount, userId })
                        });

                        const data = await response.json();
                        if (response.ok) {
                            showNotification(data.message, 'success');
                            notifyButton.disabled = true;
                            notifyButton.textContent = 'Notificação enviada!';
                        } else {
                            showNotification(data.message || 'Erro ao enviar notificação.', 'error');
                        }
                    } catch (error) {
                        console.error('Erro ao enviar notificação de Pix:', error);
                        showNotification('Não foi possível conectar ao servidor.', 'error');
                    }
                });

            } else {
                // Lógica para outros botões (se houver) ou apenas mostrar um aviso
                showNotification(`Nenhuma chave Pix configurada para ${amount} moedas.`, 'info');
            }
        });
    });

    // Lógica para copiar a chave Pix
    if (copyPixKeyBtn && pixKeyCopyInput) {
        copyPixKeyBtn.addEventListener('click', () => {
            pixKeyCopyInput.select();
            pixKeyCopyInput.setSelectionRange(0, 99999);
            document.execCommand('copy');
            showNotification('Chave Pix copiada!', 'info');
        });
    }

    // Lógica de saque (simulado)
    if (withdrawBtn && withdrawAmountInput) {
        withdrawBtn.addEventListener('click', async () => {
            walletError.textContent = '';
            const amount = parseInt(withdrawAmountInput.value);

            if (isNaN(amount) || amount <= 0) {
                walletError.textContent = 'Por favor, insira um valor de saque válido (maior que 0).';
                return;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/api/wallet/withdraw`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-auth-token': token
                    },
                    body: JSON.stringify({ amount })
                });

                const data = await response.json();

                if (!response.ok) {
                    walletError.textContent = data.message || 'Erro ao processar saque.';
                    showNotification(data.message || 'Erro ao sacar moedas.', 'error');
                } else {
                    showNotification(data.message, 'success');
                    walletCurrentBalanceSpan.textContent = data.newBalance.toLocaleString('pt-BR');
                    withdrawAmountInput.value = '';
                    const coinBalanceDesktop = document.getElementById('coin-balance-desktop');
                    const coinBalanceMobile = document.getElementById('coin-balance-mobile');
                    if (coinBalanceDesktop) coinBalanceDesktop.textContent = data.newBalance.toLocaleString('pt-BR');
                    if (coinBalanceMobile) coinBalanceMobile.textContent = data.newBalance.toLocaleString('pt-BR');
                }
            } catch (error) {
                console.error('Erro ao sacar moedas:', error);
                walletError.textContent = 'Não foi possível conectar ao servidor.';
                showNotification('Não foi possível conectar ao servidor.', 'error');
            }
        });
    }


    // Logout
    if (logoutButton) {
        logoutButton.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.clear();
            showNotification('Você foi desconectado com sucesso.', 'info');
            setTimeout(() => { window.location.href = 'login-split-form.html'; }, 1000);
        });
    }

    // Link para Dashboard
    if (dashboardLink) {
        dashboardLink.addEventListener('click', (e) => {
            const profileCompletedStatus = localStorage.getItem('profileCompleted');
            if (profileCompletedStatus === 'false') {
                e.preventDefault();
                showNotification('Por favor, complete seu perfil antes de ir para o Dashboard.', 'info');
            }
        });
    }


    // Modal de seleção de tema
    const themeModal = document.getElementById('theme-selection-modal-backdrop');
    const openThemeModalBtn = document.getElementById('open-theme-modal-btn');
    const closeThemeModalBtn = themeModal?.querySelector('.close-modal-btn');

    if (openThemeModalBtn) {
        openThemeModalBtn.addEventListener('click', () => {
            if (themeModal) themeModal.classList.add('active');
        });
    }

    if (closeThemeModalBtn && themeModal) {
        closeThemeModalBtn.addEventListener('click', () => {
            themeModal.classList.remove('active');
        });
    }

    // Carrega o tema salvo ao iniciar
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    const radio = document.querySelector(`input[name="theme"][value="${savedTheme}"]`);
    if (radio) radio.checked = true;

    // Inicializa o ano no rodapé
    const yearSpan = document.getElementById('currentYear');
    if (yearSpan) { yearSpan.textContent = new Date().getFullYear(); }
});