// User chat interface functionality

let chatWS = null;
let notificationMgr = null;
let currentUser = null;
let messageHistory = [];
let unreadCount = 0;

/**
 * Initialize user chat interface
 */
function initializeUserChat() {
    currentUser = getUserData();
    if (!currentUser) {
        window.location.href = '/static/login.html';
        return;
    }
    
    // Загружаем сохраненную историю из localStorage
    loadStoredHistory();
    
    // Update UI with user info
    updateUserInfo();
    
    // Initialize WebSocket
    chatWS = initializeWebSocket();
    notificationMgr = getNotificationManager();
    
    // Setup event listeners
    setupWebSocketListeners();
    setupUIListeners();
    
    // Connect to WebSocket
    connectToChat();
}

/**
 * Update user information display
 */
function updateUserInfo() {
    const userNameEl = document.getElementById('userName');
    const userRoleEl = document.getElementById('userRole');
    
    if (userNameEl) {
        userNameEl.textContent = `${currentUser.first_name} ${currentUser.last_name}`;
    }
    
    if (userRoleEl) {
        userRoleEl.textContent = currentUser.is_admin ? 'Администратор' : 'Пользователь';
        userRoleEl.className = currentUser.is_admin ? 'user-role admin' : 'user-role';
    }
}

/**
 * Setup WebSocket event listeners
 */
function setupWebSocketListeners() {
    if (!chatWS) return;
    
    chatWS.on('connected', () => {
        updateConnectionStatus('online', 'Подключен');
        // Автоматически загружаем историю при подключении
        setTimeout(() => {
            loadMessageHistory();
        }, 1000);
    });
    
    chatWS.on('disconnected', () => {
        updateConnectionStatus('offline', 'Отключен');
    });
    
    chatWS.on('reconnecting', (data) => {
        updateConnectionStatus('reconnecting', `Переподключение... (${data.attempt})`);
    });
    
    chatWS.on('reconnectFailed', () => {
        updateConnectionStatus('offline', 'Ошибка подключения');
        showAlert('Не удалось подключиться к серверу чата', 'error');
    });
    
    chatWS.on('welcome', (data) => {
        console.log('Welcome message:', data);
        addSystemMessage(`Добро пожаловать, ${data.user_data.name}!`);
    });
    
    chatWS.on('adminMessage', (data) => {
        addMessage({
            content: data.message,
            sender: data.from,
            senderName: data.from_name || data.from,
            timestamp: data.timestamp,
            type: 'received'
        });
        
        // Show notification if page is not visible
        if (document.hidden) {
            notificationMgr.show('Новое сообщение от администратора', {
                body: data.message
            });
        }
        
        // Mark as read after a short delay
        setTimeout(() => {
            chatWS.markAsRead(data.from);
        }, 1000);
    });
    
    chatWS.on('broadcast', (data) => {
        addBroadcastMessage(data.message, data.from_name || data.from, data.timestamp);
        
        // Show notification
        if (document.hidden) {
            notificationMgr.show('Объявление', {
                body: data.message
            });
        }
    });
    
    chatWS.on('conversationHistory', (data) => {
        displayMessageHistory(data.messages);
    });
    
    chatWS.on('error', (data) => {
        console.error('WebSocket error:', data);
        showAlert(data.message || 'Ошибка соединения с чатом', 'error');
    });
    
    chatWS.on('offlineMessage', (data) => {
        console.log('Received offline message:', data);
        addMessage({
            content: data.message,
            sender: data.from,
            senderName: data.from_name || data.from,
            timestamp: data.timestamp,
            type: data.message_type === 'admin_message' ? 'received' : 'sent',
            isOffline: true
        });
    });
    
    chatWS.on('offlineMessagesSummary', (data) => {
        console.log('Offline messages summary:', data);
        if (data.count > 0) {
            addSystemMessage(`📬 ${data.message}`, 'info');
            showAlert(`Получено ${data.count} новых сообщений`, 'info');
        }
    });
}

/**
 * Setup UI event listeners
 */
function setupUIListeners() {
    // Message input
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const charCount = document.getElementById('charCount');
    
    if (messageInput) {
        messageInput.addEventListener('input', () => {
            const length = messageInput.value.length;
            charCount.textContent = `${length}/1000`;
            
            // Enable/disable send button
            sendBtn.disabled = length === 0 || !chatWS || !chatWS.isConnected;
        });
        
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }
    
    // Send button
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }
    
    // Load history button
    const loadHistoryBtn = document.getElementById('loadHistoryBtn');
    if (loadHistoryBtn) {
        loadHistoryBtn.addEventListener('click', loadMessageHistory);
    }
    
    // Logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }
}

/**
 * Connect to chat WebSocket
 */
async function connectToChat() {
    updateConnectionStatus('connecting', 'Подключение...');
    
    try {
        const connected = await chatWS.connect();
        if (!connected) {
            updateConnectionStatus('offline', 'Ошибка подключения');
            showAlert('Не удалось подключиться к серверу чата', 'error');
        }
    } catch (error) {
        console.error('Connection error:', error);
        updateConnectionStatus('offline', 'Ошибка подключения');
        showAlert('Ошибка подключения к серверу', 'error');
    }
}

/**
 * Send message to admin
 */
function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const sendText = document.getElementById('sendText');
    const sendSpinner = document.getElementById('sendSpinner');
    
    if (!messageInput || !messageInput.value.trim()) {
        return;
    }
    
    const content = messageInput.value.trim();
    
    // Show loading state
    sendBtn.disabled = true;
    sendText.classList.add('hidden');
    sendSpinner.classList.remove('hidden');
    
    try {
        // Send message via WebSocket
        const success = chatWS.sendUserMessage(content);
        
        if (success) {
            // Add message to UI immediately
            addMessage({
                content: content,
                sender: currentUser.login,
                senderName: `${currentUser.first_name} ${currentUser.last_name}`,
                timestamp: new Date().toISOString(),
                type: 'sent'
            });
            
            // Clear input
            messageInput.value = '';
            document.getElementById('charCount').textContent = '0/1000';
            
            // Focus input
            messageInput.focus();
        } else {
            showAlert('Не удалось отправить сообщение', 'error');
        }
    } catch (error) {
        console.error('Send message error:', error);
        showAlert('Ошибка отправки сообщения', 'error');
    } finally {
        // Hide loading state
        sendBtn.disabled = false;
        sendText.classList.remove('hidden');
        sendSpinner.classList.add('hidden');
    }
}

/**
 * Load message history
 */
function loadMessageHistory() {
    if (!chatWS || !chatWS.isConnected) {
        showAlert('Нет соединения с сервером', 'error');
        return;
    }
    
    // Request conversation history with admin
    chatWS.requestConversationHistory('admin', 50, 0);
}

/**
 * Load stored message history from localStorage
 */
function loadStoredHistory() {
    try {
        const storedHistory = localStorage.getItem(`chatHistory_${currentUser.login}`);
        if (storedHistory) {
            messageHistory = JSON.parse(storedHistory);
            displayStoredMessages();
        }
    } catch (error) {
        console.error('Error loading stored history:', error);
        messageHistory = [];
    }
}

/**
 * Save message history to localStorage
 */
function saveHistoryToStorage() {
    try {
        localStorage.setItem(`chatHistory_${currentUser.login}`, JSON.stringify(messageHistory));
    } catch (error) {
        console.error('Error saving history to storage:', error);
    }
}

/**
 * Display stored messages
 */
function displayStoredMessages() {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    
    // Clear existing messages
    messagesContainer.innerHTML = '';
    
    if (messageHistory.length === 0) {
        messagesContainer.innerHTML = `
            <div class="message-info">
                Добро пожаловать в чат! Здесь вы можете общаться с администраторами.
            </div>
        `;
        return;
    }
    
    // Display stored messages
    messageHistory.forEach(message => {
        addMessageToUI(message, false); // false = don't save to storage again
    });
}

/**
 * Add message to UI (helper function)
 */
function addMessageToUI(message, saveToStorage = true) {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    
    const messageEl = document.createElement('div');
    messageEl.className = `message ${message.type}`;
    
    // Add offline indicator class if needed
    if (message.isOffline) {
        messageEl.classList.add('offline-message');
    }
    
    // Format time using Moscow timezone
    const { timeStr, dateStr } = formatChatTime(message.timestamp);
    
    // Add offline indicator
    const offlineIndicator = message.isOffline ? '<span class="offline-indicator">📬</span>' : '';
    
    messageEl.innerHTML = `
        <div class="message-bubble">
            ${escapeHtml(message.content)}
        </div>
        <div class="message-info">
            <span class="message-sender">${escapeHtml(message.senderName)}</span>
            <span class="message-time">${dateStr} ${timeStr}</span>
            ${offlineIndicator}
        </div>
    `;
    
    messagesContainer.appendChild(messageEl);
    scrollToBottom();
    
    // Store in history and save to localStorage
    if (saveToStorage) {
        messageHistory.push(message);
        saveHistoryToStorage();
    }
}

/**
 * Add message to chat display
 */
function addMessage(message) {
    addMessageToUI(message, true);
}

/**
 * Add system message
 */
function addSystemMessage(content, type = 'info') {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    
    const messageEl = document.createElement('div');
    messageEl.className = `system-message ${type}`;
    messageEl.textContent = content;
    
    messagesContainer.appendChild(messageEl);
    scrollToBottom();
}

/**
 * Add broadcast message
 */
function addBroadcastMessage(content, sender, timestamp) {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    
    const messageEl = document.createElement('div');
    messageEl.className = 'broadcast-message';
    
    const timeStr = new Date(timestamp).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    messageEl.innerHTML = `
        <div class="broadcast-label">📢 Объявление</div>
        <div class="broadcast-content">${escapeHtml(content)}</div>
        <div class="broadcast-info">
            <small>От: ${escapeHtml(sender)} в ${timeStr}</small>
        </div>
    `;
    
    messagesContainer.appendChild(messageEl);
    scrollToBottom();
}

/**
 * Display message history
 */
function displayMessageHistory(messages) {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    
    // Не очищаем существующие сообщения, а объединяем с историей
    const existingMessages = messageHistory.slice(); // копия текущих сообщений
    
    // Очищаем массив истории для перезаписи
    messageHistory = [];
    
    // Добавляем исторические сообщения
    messages.forEach(msg => {
        const messageType = msg.sender_id === currentUser.login ? 'sent' : 'received';
        
        const message = {
            content: msg.content,
            sender: msg.sender_id,
            senderName: messageType === 'sent' ? 
                `${currentUser.first_name} ${currentUser.last_name}` : 
                'Администратор',
            timestamp: msg.timestamp,
            type: messageType
        };
        
        messageHistory.push(message);
    });
    
    // Добавляем существующие сообщения (если они не дублируются)
    existingMessages.forEach(existingMsg => {
        const isDuplicate = messageHistory.some(histMsg => 
            histMsg.content === existingMsg.content && 
            histMsg.timestamp === existingMsg.timestamp &&
            histMsg.sender === existingMsg.sender
        );
        
        if (!isDuplicate) {
            messageHistory.push(existingMsg);
        }
    });
    
    // Сортируем по времени
    messageHistory.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // Очищаем контейнер и отображаем все сообщения
    messagesContainer.innerHTML = '';
    
    if (messageHistory.length === 0) {
        addSystemMessage('История сообщений пуста. Начните общение!');
    } else {
        messageHistory.forEach(message => {
            addMessageToUI(message, false); // false = не сохранять повторно
        });
    }
    
    // Сохраняем обновленную историю
    saveHistoryToStorage();
}

/**
 * Update connection status display
 */
function updateConnectionStatus(status, text) {
    const statusEl = document.getElementById('connectionStatus');
    const textEl = document.getElementById('connectionText');
    
    if (statusEl) {
        statusEl.className = `status ${status}`;
    }
    
    if (textEl) {
        textEl.textContent = text;
    }
    
    // Update send button state
    const sendBtn = document.getElementById('sendBtn');
    const messageInput = document.getElementById('messageInput');
    
    if (sendBtn && messageInput) {
        const hasText = messageInput.value.trim().length > 0;
        sendBtn.disabled = status !== 'online' || !hasText;
    }
}

/**
 * Scroll chat to bottom
 */
function scrollToBottom() {
    const messagesContainer = document.getElementById('chatMessages');
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

/**
 * Show alert message
 */
function showAlert(message, type) {
    // Create alert element
    const alertEl = document.createElement('div');
    alertEl.className = `alert alert-${type}`;
    alertEl.textContent = message;
    
    // Add to page
    const container = document.querySelector('.container');
    if (container) {
        container.insertBefore(alertEl, container.firstChild);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (alertEl.parentNode) {
                alertEl.parentNode.removeChild(alertEl);
            }
        }, 5000);
    }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Handle page visibility change
 */
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && chatWS && chatWS.isConnected) {
        // Mark messages as read when page becomes visible
        chatWS.markAsRead('admin');
    }
});

/**
 * Handle page unload
 */
window.addEventListener('beforeunload', () => {
    if (chatWS) {
        chatWS.disconnect();
    }
});

// Export functions for global use
window.chatInterface = {
    initializeUserChat,
    sendMessage,
    loadMessageHistory,
    addMessage,
    addSystemMessage,
    addBroadcastMessage
};