// arquivo: site_de_jogos/js/profile.js

// Função de Notificação Reutilizável (Importada de utils.js, a declaração local foi removida)
import { showNotification, API_BASE_URL, FRONTEND_BASE_URL } from './utils.js'; // Adicionado API_BASE_URL e FRONTEND_BASE_URL

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('userId');
    const userRole = localStorage.getItem('userRole');

    // Redirecionar se não estiver logado ou se for admin
    if (!token || !userId) {
        window.location.href = 'login.html';
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
    // Removidos: depositAmountInput e depositBtn
    const depositAmountButtons = document.querySelectorAll('.deposit-amount-btn'); // NOVO: Selecionar todos os botões de valor fixo
    const withdrawAmountInput = document.getElementById('withdraw-amount');
    const withdrawBtn = document.getElementById('withdraw-btn');
    const walletError = document.getElementById('wallet-error');

    const pixPaymentDetailsDiv = document.getElementById('pix-payment-details'); // NOVO
    const pixQrCodeImg = document.getElementById('pix-qr-code'); // NOVO
    const pixKeyCopyInput = document.getElementById('pix-key-copy'); // NOVO
    const copyPixKeyBtn = document.getElementById('copy-pix-key-btn'); // NOVO


    // Preencher campos com dados existentes do usuário
    const fetchUserProfile = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/users/me`, { // Atualizado
                headers: {
                    'x-auth-token': token
                }
            });
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    showNotification('Sessão expirada. Faça login novamente.', 'error');
                    localStorage.clear();
                    setTimeout(() => window.location.href = 'login.html', 1500);
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
                avatarPreview.src = `${FRONTEND_BASE_URL}/img/avatar-placeholder.png`; // Atualizado
            }
        } catch (error) {
            console.error('Erro ao buscar perfil:', error);
            profileError.textContent = error.message;
            showNotification('Erro ao carregar seu perfil.', 'error');
        }
    };

    // NOVA FUNÇÃO: Buscar e exibir saldo da carteira
    const fetchWalletBalance = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/users/me/stats`, { // Atualizado
                headers: { 'x-auth-token': token }
            });
            if (!response.ok) throw new Error('Erro ao buscar saldo da carteira.');
            const stats = await response.json();
            if (walletCurrentBalanceSpan && stats.coins !== undefined) {
                walletCurrentBalanceSpan.textContent = stats.coins.toLocaleString('pt-BR');
            }
            // Atualiza o saldo também no header do dashboard/perfil
            const coinBalanceDesktop = document.getElementById('coin-balance-desktop');
            const coinBalanceMobile = document.getElementById('coin-balance-mobile');
            if (coinBalanceDesktop) coinBalanceDesktop.textContent = stats.coins.toLocaleString('pt-BR');
            if (coinBalanceMobile) coinBalanceMobile.textContent = stats.coins.toLocaleString('pt-BR');

        } catch (error) {
            console.error('Erro ao buscar saldo da carteira:', error);
            if (walletCurrentBalanceSpan) {
                walletCurrentBalanceSpan.textContent = 'Erro ao carregar';
            }
            showNotification('Erro ao carregar saldo da carteira.', 'error');
        }
    };


    await fetchUserProfile(); // Carrega os dados do perfil ao entrar na página
    await fetchWalletBalance(); // Carrega o saldo da carteira


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
            avatarPreview.src = `${FRONTEND_BASE_URL}/img/avatar-placeholder.png`; // Retorna ao placeholder se nenhum arquivo for selecionado
        }
    });

    // Lógica de submissão do formulário de perfil
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        profileError.textContent = ''; // Limpa mensagens de erro anteriores

        const formData = new FormData();
        formData.append('username', usernameInput.value); // O username pode ter sido mudado
        formData.append('phone', phoneInput.value);
        formData.append('bio', bioTextarea.value);
        formData.append('description', descriptionTextarea.value);
        formData.append('console', consoleSelect.value);

        // Se uma nova imagem foi selecionada, anexe-a ao FormData
        if (avatarUploadInput.files.length > 0) {
            formData.append('avatar', avatarUploadInput.files[0]);
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/users/profile`, { // Atualizado
                method: 'PATCH',
                headers: {
                    'x-auth-token': token
                    // Não defina 'Content-Type': 'application/json' quando usar FormData com upload de arquivo
                },
                body: formData // Envia o FormData diretamente
            });

            const data = await response.json();

            if (!response.ok) {
                profileError.textContent = data.message || 'Erro ao salvar perfil.';
                showNotification(data.message || 'Erro ao salvar perfil.', 'error');
            } else {
                showNotification('Perfil salvo com sucesso!', 'success');
                // Atualiza o localStorage com o novo username e avatarUrl, se aplicável
                if (data.user.username) {
                    localStorage.setItem('username', data.user.username);
                    usernameInput.value = data.user.username; // Atualiza o campo com o nome do banco
                }
                if (data.user.avatarUrl) {
                    localStorage.setItem('avatarUrl', data.user.avatarUrl); // Salva o novo URL do avatar
                    avatarPreview.src = data.user.avatarUrl;
                }
                localStorage.setItem('profileCompleted', data.user.profileCompleted); // Atualiza status do perfil

                // Se o perfil foi recém-completado, redireciona para o dashboard
                if (data.user.profileCompleted) { // Já está completo ou acabou de ser
                    setTimeout(() => {
                        window.location.href = 'dashboard.html';
                    }, 1500);
                } else {
                    // Se por algum motivo não marcou como completo, apenas recarrega os dados
                    fetchUserProfile();
                }
            }
        } catch (error) {
            console.error('Erro ao salvar perfil:', error);
            profileError.textContent = 'Não foi possível conectar ao servidor.';
            showNotification('Não foi possível conectar ao servidor.', 'error');
        }
    });

    // LÓGICA DE DEPÓSITO VIA MERCADO PAGO (PIX)
    depositAmountButtons.forEach(button => {
        button.addEventListener('click', async () => {
            walletError.textContent = '';
            pixPaymentDetailsDiv.style.display = 'none'; // Esconde detalhes antigos
            const amount = parseInt(button.dataset.amount);

            if (isNaN(amount) || amount <= 0) {
                walletError.textContent = 'Valor de depósito inválido. Contate o suporte.';
                return;
            }

            showNotification(`Iniciando pagamento de ${amount} moedas...`, 'info');

            try {
                const response = await fetch(`${API_BASE_URL}/api/payment/deposit-mp`, { // Atualizado
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-auth-token': token
                    },
                    body: JSON.stringify({ amount, payment_method: 'pix' }) // Sempre Pix por enquanto
                });

                const data = await response.json();

                if (!response.ok) {
                    walletError.textContent = data.message || 'Erro ao iniciar pagamento.';
                    showNotification(data.message || 'Erro ao iniciar pagamento.', 'error');
                } else {
                    showNotification(data.message, 'success');
                    // A decisão de exibir Pix direto ou redirecionar
                    if (data.type === 'pix_direct') {
                        if (data.qrCodeBase64) {
                            pixQrCodeImg.src = `data:image/jpeg;base64,${data.qrCodeBase64}`; // Exibir QR Code Base64
                        } else if (data.qrCodeUrl) {
                            pixQrCodeImg.src = data.qrCodeUrl; // Ou a URL direta do QR Code
                        }
                        
                        pixKeyCopyInput.value = data.pixKey; // Chave Pix Copia e Cola
                        pixPaymentDetailsDiv.style.display = 'block'; // Mostrar a seção Pix
                    } else if (data.type === 'redirect' && data.redirectUrl) {
                        window.location.href = data.redirectUrl; // Redirecionar para o checkout do MP
                    } else {
                        showNotification('Resposta de pagamento inesperada. Tente novamente.', 'error');
                        console.error('Resposta de pagamento inesperada:', data);
                    }
                }
            } catch (error) {
                console.error('Erro ao iniciar pagamento Mercado Pago:', error);
                walletError.textContent = 'Não foi possível conectar ao servidor de pagamentos.';
                showNotification('Não foi possível conectar ao servidor de pagamentos.', 'error');
            }
        });
    });

    // Lógica para copiar a chave Pix
    if (copyPixKeyBtn && pixKeyCopyInput) {
        copyPixKeyBtn.addEventListener('click', () => {
            pixKeyCopyInput.select();
            pixKeyCopyInput.setSelectionRange(0, 99999); // Para mobile
            document.execCommand('copy');
            showNotification('Chave Pix copiada!', 'info');
        });
    }

    // Lógica para lidar com o status do pagamento na URL após redirecionamento do MP
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment_status');
    if (paymentStatus) {
        if (paymentStatus === 'success' || paymentStatus === 'approved') {
            showNotification('Pagamento aprovado! Seu saldo será atualizado em breve.', 'success');
            // O webhook já deveria ter atualizado o saldo. Apenas buscamos de novo.
            fetchWalletBalance(); 
        } else if (paymentStatus === 'pending') {
            showNotification('Pagamento pendente. Aguardando confirmação.', 'info');
        } else if (paymentStatus === 'failure' || paymentStatus === 'rejected') {
            showNotification('Pagamento falhou ou foi rejeitado. Tente novamente.', 'error');
        }
        // Limpar parâmetros da URL para não mostrar a mensagem novamente em um refresh
        history.replaceState(null, '', window.location.pathname);
    }


    // LÓGICA DE SAQUE (SIMULADO)
    if (withdrawBtn && withdrawAmountInput) {
        withdrawBtn.addEventListener('click', async () => {
            walletError.textContent = '';
            const amount = parseInt(withdrawAmountInput.value);

            if (isNaN(amount) || amount <= 0) {
                walletError.textContent = 'Por favor, insira um valor de saque válido (maior que 0).';
                return;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/api/wallet/withdraw`, { // Atualizado
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
                    withdrawAmountInput.value = ''; // Limpa o input
                    // Opcional: Atualizar o saldo também no header do dashboard/perfil
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
            setTimeout(() => { window.location.href = 'login.html'; }, 1000);
        });
    }

    // Link para Dashboard (para garantir que funciona mesmo antes de profileCompleted ser true)
    if (dashboardLink) {
        dashboardLink.addEventListener('click', (e) => {
            const profileCompletedStatus = localStorage.getItem('profileCompleted');
            if (profileCompletedStatus === 'false') {
                e.preventDefault(); // Impede a navegação padrão se o perfil não estiver completo
                showNotification('Por favor, complete seu perfil antes de ir para o Dashboard.', 'info');
            }
            // Se profileCompleted for 'true' (ou null/undefined, significando que é admin ou algum erro, mas a verificação já pegou), o link funcionará normalmente
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

    // Modifique a lógica de pagamento Pix para:
    depositAmountButtons.forEach(button => {
        button.addEventListener('click', async () => {
            walletError.textContent = '';
            pixPaymentDetailsDiv.style.display = 'none';
            const amount = parseInt(button.dataset.amount);

            if (isNaN(amount) || amount <= 0) {
                walletError.textContent = 'Valor de depósito inválido.';
                return;
            }

            showNotification(`Processando pagamento de ${amount} moedas...`, 'info');

            try {
                const response = await fetch(`${API_BASE_URL}/api/payment/deposit-mp`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-auth-token': token
                    },
                    body: JSON.stringify({ amount, payment_method: 'pix' })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.message || 'Erro ao iniciar pagamento');
                }

                // Verifica se há URL de redirecionamento
                if (data.redirectUrl) {
                    window.location.href = data.redirectUrl;
                    return;
                }

                // Se não houver redirecionamento, mostra detalhes Pix
                if (data.qrCodeBase64) {
                    pixQrCodeImg.src = `data:image/png;base64,${data.qrCodeBase64}`;
                } else if (data.qrCodeUrl) {
                    pixQrCodeImg.src = data.qrCodeUrl;
                }
                
                if (data.pixKey) {
                    pixKeyCopyInput.value = data.pixKey;
                    pixPaymentDetailsDiv.style.display = 'block';
                }

            } catch (error) {
                console.error('Erro no pagamento:', error);
                walletError.textContent = error.message;
                showNotification(error.message, 'error');
            }
        });
    });

    // Inicializa o ano no rodapé
    const yearSpan = document.getElementById('currentYear');
    if (yearSpan) { yearSpan.textContent = new Date().getFullYear(); }
});
