// arquivo: site_de_jogos/js/profile.js

// Função para aplicar o tema (copiada do main.js e modificada para ser local)
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
}

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
    const bioTextarea = document.getElementById('bio');
    const descriptionTextarea = document.getElementById('description');
    const consoleSelect = document.getElementById('console');
    const profileInitialPreview = document.getElementById('profile-initial-preview');
    const profileError = document.getElementById('profile-error');

    // Seletor para os botões de logout, agora pegando ambos por ID
    const logoutButtonDesktop = document.getElementById('logout-button-desktop');
    const logoutButtonMobile = document.getElementById('logout-button-mobile');
    
    const dashboardLink = document.querySelector('header nav ul li a[href="dashboard.html"]');

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

    // NOVOS ELEMENTOS DOS MODAIS DE SAQUE
    const withdrawModalBackdrop = document.getElementById('withdraw-modal-backdrop');
    const withdrawModal = document.getElementById('withdraw-modal');
    const withdrawPixForm = document.getElementById('withdraw-pix-form');
    const withdrawAmountDisplay = document.getElementById('withdraw-amount-display');
    const pixKeyTypeSelect = document.getElementById('pix-key-type');
    const pixKeyValueInput = document.getElementById('pix-key-value');
    const withdrawPixError = document.getElementById('withdraw-pix-error');
    const withdrawSuccessModalBackdrop = document.getElementById('withdraw-success-modal-backdrop');

    // NOVOS ELEMENTOS DE TEMA
    const themeModal = document.getElementById('theme-selection-modal-backdrop');
    const saveThemeButton = document.getElementById('save-theme-button');
    const openThemeModalBtn = document.getElementById('open-theme-modal-btn');
    const closeThemeModalBtn = themeModal?.querySelector('.close-modal-btn');
    // const themeSelector = document.getElementById('profile-theme-selector'); // REMOVIDO: Era a provável causa do bug


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
            bioTextarea.value = userData.bio || '';
            descriptionTextarea.value = userData.description || '';
            consoleSelect.value = userData.console || '';

            if (profileInitialPreview) {
                profileInitialPreview.textContent = userData.username ? userData.username.charAt(0).toUpperCase() : '';
            }
            
            // Adicionado: Atualiza o inicial do avatar mobile também
            const userInitialMobile = document.getElementById('user-initial-mobile');
            if (userInitialMobile) {
                userInitialMobile.textContent = userData.username ? userData.username.charAt(0).toUpperCase() : '';
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

    // Lógica de submissão do formulário de perfil
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        profileError.textContent = '';

        const formData = {
            username: usernameInput.value,
            bio: bioTextarea.value,
            description: descriptionTextarea.value,
            console: consoleSelect.value
        };

        try {
            const response = await fetch(`${API_BASE_URL}/api/users/profile`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'x-auth-token': token
                },
                body: JSON.stringify(formData)
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
                    profileInitialPreview.textContent = data.user.username.charAt(0).toUpperCase();
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
                const qrCodeUrl = 'https://github.com/matheusj1/GameRivals-Site/raw/main/img/10%20reais.jpeg';
                
                pixQrCodeImg.src = qrCodeUrl;
                pixKeyCopyInput.value = pixKey;
                pixPaymentDetailsDiv.style.display = 'block';

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
            } else if (amount === 20) { // NOVO: Lógica para o pagamento de 20 moedas
                const pixKey = '00020126360014BR.GOV.BCB.PIX0114+5511972519097520400005303986540520.005802BR5923Matheus Jose dos Santos6009SAO PAULO62140510pTNOooDFeP630433B5';
                const qrCodeUrl = 'img/20-reais-pix.png';
                
                pixQrCodeImg.src = qrCodeUrl;
                pixKeyCopyInput.value = pixKey;
                pixPaymentDetailsDiv.style.display = 'block';

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

            } else if (amount === 50) {
                const pixKey = '00020126360014BR.GOV.BCB.PIX0114+5511972519097520400005303986540550.005802BR5923Matheus Jose dos Santos6009SAO PAULO62140510MuARDyORmu630461B8';
                const qrCodeUrl = 'img/50-reais-pix.png';

                pixQrCodeImg.src = qrCodeUrl;
                pixKeyCopyInput.value = pixKey;
                pixPaymentDetailsDiv.style.display = 'block';

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
            } else if (amount === 100) {
                const pixKey = '00020126360014BR.GOV.BCB.PIX0114+55119725190975204000053039865406100.005802BR5923Matheus Jose dos Santos6009SAO PAULO621405103EzQ96Wskb63044EEE';
                const qrCodeUrl = 'img/100-reais-pix.png';

                pixQrCodeImg.src = qrCodeUrl;
                pixKeyCopyInput.value = pixKey;
                pixPaymentDetailsDiv.style.display = 'block';

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
            } else if (amount === 1000) {
                const pixKey = '00020126360014BR.GOV.BCB.PIX0114+551197251909752040000530398654071000.005802BR5923Matheus Jose dos Santos6009SAO PAULO62140510BAZXWlITcd63046A51';
                const qrCodeUrl = 'img/1000-reais-pix.png';
                
                pixQrCodeImg.src = qrCodeUrl;
                pixKeyCopyInput.value = pixKey;
                pixPaymentDetailsDiv.style.display = 'block';

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
            const currentBalance = parseInt(walletCurrentBalanceSpan.textContent.replace(/\./g, ''));

            if (isNaN(amount) || amount <= 0) {
                walletError.textContent = 'Por favor, insira um valor de saque válido (maior que 0).';
                return;
            }
            if (amount > currentBalance) {
                walletError.textContent = 'Você não tem saldo suficiente para este saque.';
                return;
            }

            // Abre o modal de saque
            withdrawAmountDisplay.textContent = amount;
            withdrawModalBackdrop.classList.add('active');
        });
    }

    // Lógica para o formulário de saque Pix
    if (withdrawPixForm) {
        withdrawPixForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            withdrawPixError.textContent = '';

            const amount = parseInt(withdrawAmountInput.value);
            const pixKeyType = pixKeyTypeSelect.value;
            const pixKeyValue = pixKeyValueInput.value.trim();

            if (!pixKeyType || !pixKeyValue) {
                withdrawPixError.textContent = 'Por favor, preencha todos os campos.';
                return;
            }

            try {
                // Nova rota de backend para solicitar saque
                const response = await fetch(`${API_BASE_URL}/api/wallet/withdraw-request`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-auth-token': token
                    },
                    body: JSON.stringify({ amount, pixKeyType, pixKeyValue })
                });

                const data = await response.json();

                if (!response.ok) {
                    withdrawPixError.textContent = data.message || 'Erro ao solicitar saque.';
                    showNotification(data.message || 'Erro ao solicitar saque.', 'error');
                } else {
                    withdrawModalBackdrop.classList.remove('active');
                    document.getElementById('confirmed-withdraw-amount').textContent = amount;
                    withdrawSuccessModalBackdrop.classList.add('active');
                    // Limpa o formulário de saque
                    withdrawPixForm.reset();
                    withdrawAmountInput.value = '';
                    fetchWalletBalance();
                }
            } catch (error) {
                console.error('Erro ao solicitar saque:', error);
                withdrawPixError.textContent = 'Não foi possível conectar ao servidor.';
                showNotification('Não foi possível conectar ao servidor.', 'error');
            }
        });
    }

    // Lógica para fechar os modais de saque
    if (withdrawModalBackdrop) {
        const closeBtn = withdrawModalBackdrop.querySelector('.close-modal-btn');
        closeBtn.addEventListener('click', () => withdrawModalBackdrop.classList.remove('active'));
        withdrawModalBackdrop.addEventListener('click', (e) => {
            if (e.target === withdrawModalBackdrop) withdrawModalBackdrop.classList.remove('active');
        });
    }

    if (withdrawSuccessModalBackdrop) {
        const closeBtn = withdrawSuccessModalBackdrop.querySelector('.close-modal-btn');
        closeBtn.addEventListener('click', () => {
            withdrawSuccessModalBackdrop.classList.remove('active');
            location.reload(); // Recarrega a página para atualizar o saldo e os desafios
        });
        withdrawSuccessModalBackdrop.addEventListener('click', (e) => {
            if (e.target === withdrawSuccessModalBackdrop) {
                withdrawSuccessModalBackdrop.classList.remove('active');
                location.reload();
            }
        });
    }

    // Lógica de Logout - Agora aplicável a ambos os botões
    const handleLogout = (e) => {
        e.preventDefault();
        localStorage.clear();
        showNotification('Você foi desconectado com sucesso.', 'info');
        setTimeout(() => { window.location.href = 'login-split-form.html'; }, 1000);
    };

    if (logoutButtonDesktop) {
        logoutButtonDesktop.addEventListener('click', handleLogout);
    }
    if (logoutButtonMobile) {
        logoutButtonMobile.addEventListener('click', handleLogout);
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
    
    
    if (openThemeModalBtn) {
        openThemeModalBtn.addEventListener('click', () => {
            if (themeModal) themeModal.classList.add('active');
            // Garante que o rádio correto esteja marcado ao abrir
            const savedTheme = localStorage.getItem('theme') || 'light';
            const radio = document.querySelector(`input[name="theme"][value="${savedTheme}"]`);
            if (radio) radio.checked = true;
            // Garante que a pré-visualização seja o tema salvo, caso o usuário tenha saído sem salvar antes
            document.documentElement.setAttribute('data-theme', savedTheme);
        });
    }

    if (closeThemeModalBtn && themeModal) {
        closeThemeModalBtn.addEventListener('click', () => {
            themeModal.classList.remove('active');
            // Garante que o tema ativo seja re-aplicado se o usuário não salvou
            const currentTheme = localStorage.getItem('theme') || 'light';
            document.documentElement.setAttribute('data-theme', currentTheme);
        });
    }
    
    // NOVO: Adiciona a lógica para salvar o tema (CORRIGIDO)
    // A correção foi feita na condição e na forma de buscar o radio button selecionado.
    if (saveThemeButton && themeModal) { 
        saveThemeButton.addEventListener('click', () => {
            // Busca o radio button com name="theme" que está checado em qualquer lugar
            const selectedRadio = document.querySelector('input[name="theme"]:checked'); 
            
            if (selectedRadio) {
                const selectedTheme = selectedRadio.value;
                applyTheme(selectedTheme); // Usa a função local applyTheme para setar o data-theme e salvar no localStorage
                showNotification(`Tema '${selectedTheme === 'dark' ? 'Escuro' : 'Claro'}' salvo com sucesso!`, 'success');
                themeModal.classList.remove('active');
            } else {
                 showNotification('Selecione um tema para salvar.', 'error');
            }
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