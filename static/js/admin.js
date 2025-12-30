// Admin panel functionality

let adminWS = null;
let notificationMgr = null;
let currentAdmin = null;
let connectedUsers = [];
let selectedUser = null;
let conversationHistory = {};

/**
 * Initialize admin panel
 */
function initializeAdminPanel() {
    currentAdmin = getUserData();
    if (!currentAdmin || !currentAdmin.is_admin) {
        window.location.href = '/static/chat.html';
        return;
    }
    
    // Загружаем сохраненные данные
    loadStoredAdminData();
    
    // Update UI with admin info
    updateAdminInfo();
    
    // Initialize WebSocket
    adminWS = initializeWebSocket();
    notificationMgr = getNotificationManager();
    
    // Setup event listeners
    setupWebSocketListeners();
    setupUIListeners();
    
    // Connect to WebSocket
    connectToChat();
}

/**
 * Update admin information display
 */
function updateAdminInfo() {
    const userNameEl = document.getElementById('userName');
    const userRoleEl = document.getElementById('userRole');
    
    if (userNameEl) {
        userNameEl.textContent = `${currentAdmin.first_name} ${currentAdmin.last_name}`;
    }
    
    if (userRoleEl) {
        userRoleEl.textContent = 'Администратор';
        userRoleEl.className = 'user-role admin';
    }
}

/**
 * Load stored admin data from localStorage
 */
function loadStoredAdminData() {
    try {
        // Загружаем историю разговоров
        const storedConversations = localStorage.getItem(`adminConversations_${currentAdmin.login}`);
        if (storedConversations) {
            conversationHistory = JSON.parse(storedConversations);
            console.log('Loaded conversation history from localStorage:', Object.keys(conversationHistory));
        } else {
            console.log('No stored conversation history found');
        }
        
        // Загружаем последнего выбранного пользователя
        const lastSelectedUser = localStorage.getItem(`adminLastUser_${currentAdmin.login}`);
        if (lastSelectedUser) {
            console.log('Last selected user:', lastSelectedUser);
            // Будем выбирать пользователя после загрузки списка пользователей
            setTimeout(() => {
                if (connectedUsers.find(u => u.user_id === lastSelectedUser)) {
                    console.log('Auto-selecting last user:', lastSelectedUser);
                    selectUser(lastSelectedUser);
                }
            }, 2000);
        }
    } catch (error) {
        console.error('Error loading stored admin data:', error);
        conversationHistory = {};
    }
}

/**
 * Save admin data to localStorage
 */
function saveAdminDataToStorage() {
    try {
        const conversationCount = Object.keys(conversationHistory).reduce((total, userId) => {
            return total + (conversationHistory[userId] ? conversationHistory[userId].length : 0);
        }, 0);
        
        console.log(`Saving ${conversationCount} total messages for ${Object.keys(conversationHistory).length} users`);
        
        localStorage.setItem(`adminConversations_${currentAdmin.login}`, JSON.stringify(conversationHistory));
        if (selectedUser) {
            localStorage.setItem(`adminLastUser_${currentAdmin.login}`, selectedUser);
        }
    } catch (error) {
        console.error('Error saving admin data to storage:', error);
    }
}

/**
 * Setup WebSocket event listeners
 */
function setupWebSocketListeners() {
    if (!adminWS) return;
    
    adminWS.on('connected', () => {
        updateConnectionStatus('online', 'Подключен');
        loadConnectedUsers();
        // Загружаем сохраненные данные из localStorage
        loadStoredAdminData();
    });
    
    adminWS.on('disconnected', () => {
        updateConnectionStatus('offline', 'Отключен');
    });
    
    adminWS.on('reconnecting', (data) => {
        updateConnectionStatus('reconnecting', `Переподключение... (${data.attempt})`);
    });
    
    adminWS.on('reconnectFailed', () => {
        updateConnectionStatus('offline', 'Ошибка подключения');
        showAlert('Не удалось подключиться к серверу чата', 'error');
    });
    
    adminWS.on('welcome', (data) => {
        console.log('Admin welcome:', data);
    });
    
    adminWS.on('userMessage', (data) => {
        console.log('Received user message:', data);
        // New message from user
        addMessageToChat(data.from, {
            content: data.message,
            sender: data.from,
            senderName: data.from_name || data.from,
            timestamp: data.timestamp,
            type: 'received'
        });
        
        // Update user list with unread indicator
        updateUserUnreadCount(data.from, 1);
        
        // Show notification
        if (document.hidden || selectedUser !== data.from) {
            notificationMgr.show(`Сообщение от ${data.from_name || data.from}`, {
                body: data.message
            });
        }
        
        // Auto-select user if none selected
        if (!selectedUser) {
            selectUser(data.from);
        }
    });
    
    adminWS.on('adminSent', (data) => {
        console.log('Admin sent message:', data);
        // Message sent by another admin (not this one) - add to UI
        if (data.from !== currentAdmin.login && data.to === selectedUser) {
            addMessageToChat(data.to, {
                content: data.message,
                sender: data.from,
                senderName: data.from_name || data.from,
                timestamp: data.timestamp,
                type: 'sent'
            });
        }
    });
    
    adminWS.on('userConnected', (data) => {
        console.log('User connected:', data);
        addUserToList(data.user_id, data.user_name, true);
        showAlert(`Пользователь ${data.user_name} подключился`, 'info');
    });
    
    adminWS.on('connectedUsers', (data) => {
        console.log('📥 Connected users event received');
        console.log('Data:', data);
        console.log('Users array:', data.users);
        console.log('Users count:', data.users ? data.users.length : 'undefined');
        
        // Update debug info immediately
        setTimeout(updateDebugInfo, 100);
        
        updateUsersList(data.users);
    });
    
    adminWS.on('conversationHistory', (data) => {
        displayConversationHistory(data.with_user, data.messages);
    });
    
    adminWS.on('error', (data) => {
        console.error('WebSocket error:', data);
        showAlert(data.message || 'Ошибка соединения с чатом', 'error');
    });
    
    adminWS.on('offlineMessage', (data) => {
        console.log('Admin received offline message:', data);
        // Add to conversation history
        addMessageToChat(data.from, {
            content: data.message,
            sender: data.from,
            senderName: data.from_name || data.from,
            timestamp: data.timestamp,
            type: data.message_type === 'user_message' ? 'received' : 'sent',
            isOffline: true
        });
    });
    
    adminWS.on('offlineMessagesSummary', (data) => {
        console.log('Admin offline messages summary:', data);
        if (data.count > 0) {
            showAlert(`📬 Получено ${data.count} новых сообщений`, 'info');
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
            sendBtn.disabled = length === 0 || !selectedUser || !adminWS || !adminWS.isConnected;
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
        loadHistoryBtn.addEventListener('click', () => {
            if (selectedUser) {
                loadConversationHistory(selectedUser);
            }
        });
    }

    // Refresh chat button
    const refreshChatBtn = document.getElementById('refreshChatBtn');
    if (refreshChatBtn) {
        refreshChatBtn.addEventListener('click', () => {
            if (selectedUser) {
                console.log('Manually refreshing chat for:', selectedUser);
                rebuildConversationUI(selectedUser);
                debugChatState();
            }
        });
    }

    // User info button
    const userInfoBtn = document.getElementById('userInfoBtn');
    if (userInfoBtn) {
        userInfoBtn.addEventListener('click', () => {
            if (selectedUser) {
                showUserInfo(selectedUser);
            }
        });
    }

    // Archive button
    const archiveBtn = document.getElementById('archiveBtn');
    if (archiveBtn) {
        archiveBtn.addEventListener('click', () => {
            if (selectedUser) {
                showArchiveModal(selectedUser);
            }
        });
    }

    // Refresh users button
    const refreshUsersBtn = document.getElementById('refreshUsersBtn');
    if (refreshUsersBtn) {
        refreshUsersBtn.addEventListener('click', loadConnectedUsers);
    }
    
    // Broadcast button
    const broadcastBtn = document.getElementById('broadcastBtn');
    if (broadcastBtn) {
        broadcastBtn.addEventListener('click', showBroadcastModal);
    }
    
    // Reset DB button
    const resetDbBtn = document.getElementById('resetDbBtn');
    if (resetDbBtn) {
        resetDbBtn.addEventListener('click', showResetDbModal);
    }
    
    // Clear cache button
    const clearCacheBtn = document.getElementById('clearCacheBtn');
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', clearUserCache);
    }
    
    // Modal event listeners
    setupModalListeners();
    
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
 * Setup modal event listeners
 */
function setupModalListeners() {
    // Broadcast modal
    const broadcastModal = document.getElementById('broadcastModal');
    const closeBroadcastModal = document.getElementById('closeBroadcastModal');
    const cancelBroadcast = document.getElementById('cancelBroadcast');
    const sendBroadcast = document.getElementById('sendBroadcast');
    
    if (closeBroadcastModal) {
        closeBroadcastModal.addEventListener('click', hideBroadcastModal);
    }
    
    if (cancelBroadcast) {
        cancelBroadcast.addEventListener('click', hideBroadcastModal);
    }
    
    if (sendBroadcast) {
        sendBroadcast.addEventListener('click', sendBroadcastMessage);
    }
    
    // Reset DB modal
    const resetDbModal = document.getElementById('resetDbModal');
    const closeResetDbModal = document.getElementById('closeResetDbModal');
    const cancelResetDb = document.getElementById('cancelResetDb');
    const confirmResetDb = document.getElementById('confirmResetDb');
    
    if (closeResetDbModal) {
        closeResetDbModal.addEventListener('click', hideResetDbModal);
    }
    
    if (cancelResetDb) {
        cancelResetDb.addEventListener('click', hideResetDbModal);
    }
    
    if (confirmResetDb) {
        confirmResetDb.addEventListener('click', resetDatabase);
    }
    
    // Close modals on background click
    if (broadcastModal) {
        broadcastModal.addEventListener('click', (e) => {
            if (e.target === broadcastModal) {
                hideBroadcastModal();
            }
        });
    }
    
    if (resetDbModal) {
        resetDbModal.addEventListener('click', (e) => {
            if (e.target === resetDbModal) {
                hideResetDbModal();
            }
        });
    }
    
    // User Info modal
    const userInfoModal = document.getElementById('userInfoModal');
    const closeUserInfoModal = document.getElementById('closeUserInfoModal');
    const closeUserInfo = document.getElementById('closeUserInfo');
    
    if (closeUserInfoModal) {
        closeUserInfoModal.addEventListener('click', hideUserInfoModal);
    }
    
    if (closeUserInfo) {
        closeUserInfo.addEventListener('click', hideUserInfoModal);
    }
    
    if (userInfoModal) {
        userInfoModal.addEventListener('click', (e) => {
            if (e.target === userInfoModal) {
                hideUserInfoModal();
            }
        });
    }
    
    // Archive modal
    const archiveModal = document.getElementById('archiveModal');
    const closeArchiveModal = document.getElementById('closeArchiveModal');
    const cancelArchive = document.getElementById('cancelArchive');
    const confirmArchive = document.getElementById('confirmArchive');
    
    if (closeArchiveModal) {
        closeArchiveModal.addEventListener('click', hideArchiveModal);
    }
    
    if (cancelArchive) {
        cancelArchive.addEventListener('click', hideArchiveModal);
    }
    
    if (confirmArchive) {
        confirmArchive.addEventListener('click', archiveConversation);
    }
    
    if (archiveModal) {
        archiveModal.addEventListener('click', (e) => {
            if (e.target === archiveModal) {
                hideArchiveModal();
            }
        });
    }
}

/**
 * Connect to chat WebSocket
 */
async function connectToChat() {
    updateConnectionStatus('connecting', 'Подключение...');
    
    try {
        const connected = await adminWS.connect();
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
 * Load connected users
 */
function loadConnectedUsers() {
    if (!adminWS || !adminWS.isConnected) {
        return;
    }
    
    adminWS.requestConnectedUsers();
}

/**
 * Update users list
 */
async function updateUsersList(users) {
    console.log('🔄 updateUsersList called with:', users);
    
    connectedUsers = users || [];
    const usersList = document.getElementById('usersList');
    
    if (!usersList) {
        console.log('❌ usersList element not found!');
        return;
    }
    
    console.log(`📝 Processing ${connectedUsers.length} users`);
    
    // Get archived conversations
    let archivedUsers = [];
    try {
        const token = getAuthToken();
        if (token) {
            const response = await fetch('/ops/archived_conversations', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                archivedUsers = data.archived_users || [];
                console.log(`📁 Found ${archivedUsers.length} archived conversations`);
            }
        }
    } catch (error) {
        console.error('Error fetching archived conversations:', error);
    }
    
    // Separate active and archived users
    const activeUsers = connectedUsers.filter(user => 
        !archivedUsers.some(archived => archived.user_id === user.user_id)
    );
    
    // Sort active users by last activity (most recent first)
    activeUsers.sort((a, b) => {
        const aHistory = conversationHistory[a.user_id] || [];
        const bHistory = conversationHistory[b.user_id] || [];
        
        const aLastMessage = aHistory.length > 0 ? new Date(aHistory[aHistory.length - 1].timestamp) : new Date(0);
        const bLastMessage = bHistory.length > 0 ? new Date(bHistory[bHistory.length - 1].timestamp) : new Date(0);
        
        // Connected users get priority, then by last message time
        if (a.connected !== b.connected) {
            return b.connected - a.connected; // Connected first
        }
        
        return bLastMessage - aLastMessage; // Most recent first
    });
    
    const totalUsers = activeUsers.length + archivedUsers.length;
    
    if (totalUsers === 0) {
        console.log('📝 No users - showing empty state');
        usersList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <div>Нет подключенных пользователей</div>
            </div>
        `;
        return;
    }
    
    console.log(`📝 Rendering ${activeUsers.length} active + ${archivedUsers.length} archived users`);
    usersList.innerHTML = '';
    
    // Add active users first (sorted by activity)
    activeUsers.forEach((user, index) => {
        console.log(`👤 Creating active user ${index + 1}:`, user);
        
        const userEl = document.createElement('div');
        userEl.className = 'user-item';
        userEl.dataset.userId = user.user_id;
        
        if (selectedUser === user.user_id) {
            userEl.classList.add('active');
        }
        
        userEl.innerHTML = `
            <span class="status ${user.connected ? 'online' : 'offline'}"></span>
            <div class="user-info">
                <div class="user-name">${escapeHtml(user.name)}</div>
                <div class="user-details">
                    <div class="user-login">@${escapeHtml(user.user_id)}</div>
                    <div class="user-status">${user.connected ? 'В сети' : 'Не в сети'}</div>
                </div>
            </div>
            <div class="unread-badge hidden">0</div>
        `;
        
        userEl.addEventListener('click', () => selectUser(user.user_id));
        usersList.appendChild(userEl);
    });
    
    // Add separator if there are archived users
    if (archivedUsers.length > 0 && activeUsers.length > 0) {
        const separator = document.createElement('div');
        separator.className = 'users-separator';
        separator.innerHTML = `
            <div class="separator-line"></div>
            <div class="separator-text">📁 Архивированные беседы</div>
            <div class="separator-line"></div>
        `;
        usersList.appendChild(separator);
    }
    
    // Add archived users at the bottom
    archivedUsers.forEach((user, index) => {
        console.log(`📁 Creating archived user ${index + 1}:`, user);
        
        const userEl = document.createElement('div');
        userEl.className = 'user-item archived';
        userEl.dataset.userId = user.user_id;
        
        if (selectedUser === user.user_id) {
            userEl.classList.add('active');
        }
        
        // Check if user is currently connected
        const connectedUser = connectedUsers.find(u => u.user_id === user.user_id);
        const isConnected = connectedUser ? connectedUser.connected : false;
        
        // Show unread count for archived conversations
        const unreadCount = user.unread_count || 0;
        const unreadBadge = unreadCount > 0 ? 
            `<div class="unread-badge archived-unread">${unreadCount}</div>` : 
            `<div class="unread-badge hidden">0</div>`;
        
        userEl.innerHTML = `
            <span class="status archived-status">📁</span>
            <div class="user-info">
                <div class="user-name archived-name">${escapeHtml(user.name)}</div>
                <div class="user-details">
                    <div class="user-login">@${escapeHtml(user.user_id)}</div>
                    <div class="user-status archived-status-text">Архивировано</div>
                </div>
            </div>
            ${unreadBadge}
            <div class="archive-indicator">📁</div>
        `;
        
        userEl.addEventListener('click', () => selectUser(user.user_id, true));
        usersList.appendChild(userEl);
    });
    
    console.log('✅ Users list updated successfully');
}

/**
 * Add user to list
 */
function addUserToList(userId, userName, isConnected) {
    const existingUser = connectedUsers.find(u => u.user_id === userId);
    
    if (existingUser) {
        existingUser.connected = isConnected;
        existingUser.name = userName;
    } else {
        connectedUsers.push({
            user_id: userId,
            name: userName,
            connected: isConnected
        });
    }
    
    updateUsersList(connectedUsers);
}

/**
 * Select user for chat
 */
function selectUser(userId, isArchived = false) {
    console.log(`Selecting user: ${userId} (archived: ${isArchived})`);
    
    selectedUser = userId;
    
    // Сохраняем выбор в localStorage
    saveAdminDataToStorage();
    
    // Update UI
    const userItems = document.querySelectorAll('.user-item');
    userItems.forEach(item => {
        if (item.dataset.userId === userId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    
    // Update chat header
    const user = connectedUsers.find(u => u.user_id === userId);
    const chatTitle = document.getElementById('chatTitle');
    const selectedUserName = document.getElementById('selectedUserName');
    const selectedUserSpan = document.getElementById('selectedUser');
    
    if (chatTitle) {
        const userName = user ? user.name : userId;
        chatTitle.textContent = isArchived ? `📁 ${userName}` : `Чат с ${userName}`;
    }
    
    if (selectedUserName) {
        const userName = user ? user.name : userId;
        selectedUserName.textContent = userName;
        selectedUserSpan.classList.remove('hidden');
    }
    
    // Enable controls (always enabled, even for archived)
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const loadHistoryBtn = document.getElementById('loadHistoryBtn');
    const refreshChatBtn = document.getElementById('refreshChatBtn');
    const userInfoBtn = document.getElementById('userInfoBtn');
    const archiveBtn = document.getElementById('archiveBtn');
    
    if (messageInput) {
        messageInput.disabled = false; // Always enabled
        const userName = user ? user.name : userId;
        messageInput.placeholder = `Сообщение для ${userName}...`;
    }
    
    if (loadHistoryBtn) {
        loadHistoryBtn.disabled = false;
    }
    
    if (refreshChatBtn) {
        refreshChatBtn.disabled = false;
    }
    
    if (userInfoBtn) {
        userInfoBtn.disabled = false;
    }
    
    // Update archive button
    if (archiveBtn) {
        archiveBtn.disabled = false;
        archiveBtn.textContent = isArchived ? 'Разархивировать беседу' : 'Архивировать беседу';
        archiveBtn.className = isArchived ? 'btn btn-success' : 'btn btn-warning';
    }
    
    // Update send button state
    if (sendBtn && messageInput) {
        sendBtn.disabled = messageInput.value.trim().length === 0 || !adminWS || !adminWS.isConnected;
    }
    
    // Clear unread count
    updateUserUnreadCount(userId, 0, true);
    
    // Load conversation normally (no special handling for archived)
    displayConversation(userId);
    
    // Автоматически загружаем историю только если её совсем нет
    const currentMessages = conversationHistory[userId] || [];
    if (currentMessages.length === 0) {
        console.log(`No messages for ${userId}, loading history...`);
        setTimeout(() => {
            loadConversationHistory(userId);
        }, 500);
    } else {
        console.log(`Found ${currentMessages.length} messages for ${userId}, not loading history`);
    }
}

/**
 * Send message to selected user
 */
function sendMessage() {
    if (!selectedUser) return;
    
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
        const success = adminWS.sendAdminMessage(content, selectedUser);
        
        if (success) {
            // Add message to UI immediately for better UX
            addMessageToChat(selectedUser, {
                content: content,
                sender: currentAdmin.login,
                senderName: `${currentAdmin.first_name} ${currentAdmin.last_name}`,
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
 * Load conversation history
 */
function loadConversationHistory(userId) {
    if (!adminWS || !adminWS.isConnected || !userId) {
        return;
    }
    
    adminWS.requestConversationHistory(userId, 50, 0);
}

/**
 * Display conversation
 */
function displayConversation(userId) {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    
    console.log(`=== Displaying conversation for ${userId} ===`);
    
    const messages = conversationHistory[userId] || [];
    console.log(`Found ${messages.length} messages for ${userId}`);
    
    // Только очищаем если контейнер пустой или если это принудительная перерисовка
    const shouldRebuild = messagesContainer.children.length === 0 || 
                         messagesContainer.children.length !== messages.length;
    
    if (shouldRebuild) {
        console.log(`Rebuilding conversation UI (${messagesContainer.children.length} -> ${messages.length} messages)`);
        messagesContainer.innerHTML = '';
        
        if (messages.length === 0) {
            messagesContainer.innerHTML = `
                <div class="message-info">
                    Начните общение с пользователем или загрузите историю сообщений.
                </div>
            `;
            
            // Автоматически загружаем историю если её нет
            setTimeout(() => {
                console.log(`Auto-loading history for ${userId}`);
                loadConversationHistory(userId);
            }, 500);
        } else {
            console.log(`Rendering ${messages.length} messages`);
            messages.forEach((message, index) => {
                console.log(`  ${index + 1}. [${message.type}] ${message.senderName}: ${message.content.substring(0, 30)}...`);
                addMessageToUI(message);
            });
            scrollToBottom();
        }
    } else {
        console.log(`Conversation UI already up to date (${messages.length} messages)`);
    }
}

/**
 * Display conversation history
 */
function displayConversationHistory(userId, messages) {
    if (!conversationHistory[userId]) {
        conversationHistory[userId] = [];
    }
    
    console.log(`Loading history for ${userId}, ${messages.length} messages from server`);
    
    // Добавляем исторические сообщения, избегая дубликатов
    let addedCount = 0;
    messages.forEach(msg => {
        const messageType = msg.sender_id === currentAdmin.login ? 'sent' : 'received';
        const senderName = messageType === 'sent' ? 
            `${currentAdmin.first_name} ${currentAdmin.last_name}` : 
            (connectedUsers.find(u => u.user_id === msg.sender_id)?.name || msg.sender_id);
        
        const message = {
            content: msg.content,
            sender: msg.sender_id,
            senderName: senderName,
            timestamp: msg.timestamp,
            type: messageType
        };
        
        // Проверяем, нет ли уже такого сообщения
        const existingMessage = conversationHistory[userId].find(existing => 
            existing.content === message.content && 
            existing.timestamp === message.timestamp &&
            existing.sender === message.sender
        );
        
        if (!existingMessage) {
            conversationHistory[userId].push(message);
            addedCount++;
        }
    });
    
    // Сортируем сообщения по времени
    conversationHistory[userId].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    console.log(`Added ${addedCount} new messages. Total messages for ${userId}: ${conversationHistory[userId].length}`);
    
    // Сохраняем в localStorage
    saveAdminDataToStorage();
    
    // Update display if this user is selected - FORCE rebuild
    if (selectedUser === userId) {
        console.log(`Rebuilding UI after loading history for ${userId}`);
        rebuildConversationUI(userId);
    }
}

/**
 * Add message to chat history
 */
function addMessageToChat(userId, message) {
    if (!conversationHistory[userId]) {
        conversationHistory[userId] = [];
    }
    
    // Проверяем, не добавляем ли мы дубликат
    const existingMessage = conversationHistory[userId].find(msg => 
        msg.content === message.content && 
        msg.timestamp === message.timestamp &&
        msg.sender === message.sender
    );
    
    if (!existingMessage) {
        conversationHistory[userId].push(message);
        console.log(`Added message to history for ${userId}:`, message.content.substring(0, 50));
        
        // Сохраняем в localStorage
        saveAdminDataToStorage();
        
        // Добавляем сообщение в UI ТОЛЬКО если этот пользователь выбран
        if (selectedUser === userId) {
            console.log(`Adding message to UI for selected user ${userId}`);
            addMessageToUI(message);
        } else {
            console.log(`Message added to history but user ${userId} not selected (current: ${selectedUser})`);
        }
    } else {
        console.log(`Duplicate message not added for ${userId}`);
    }
}

/**
 * Add message to UI
 */
function addMessageToUI(message) {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    
    const messageEl = document.createElement('div');
    messageEl.className = `message ${message.type}`;
    
    // Add offline indicator class if needed
    if (message.isOffline) {
        messageEl.classList.add('offline-message');
    }
    
    // Add archived indicator class if needed
    if (message.is_archived) {
        messageEl.classList.add('archived-message');
    }
    
    // Format time using Moscow timezone
    const { timeStr, dateStr } = formatChatTime(message.timestamp);
    
    // Определяем иконку для типа сообщения
    let senderIcon = '';
    let senderClass = '';
    
    if (message.type === 'sent') {
        senderIcon = '👨‍💼'; // Админ
        senderClass = 'admin-message';
    } else {
        senderIcon = '👤'; // Пользователь
        senderClass = 'user-message';
    }
    
    // Add offline and archived indicators
    const offlineIndicator = message.isOffline ? '<span class="offline-indicator">📬</span>' : '';
    const archivedIndicator = message.is_archived ? '<span class="archived-indicator">📁</span>' : '';
    
    messageEl.innerHTML = `
        <div class="message-bubble">
            ${escapeHtml(message.content)}
        </div>
        <div class="message-info">
            <span class="message-sender-icon">${senderIcon}</span>
            <span class="message-sender ${senderClass}">${escapeHtml(message.senderName)}</span>
            <span class="message-time">${dateStr} ${timeStr}</span>
            ${offlineIndicator}
            ${archivedIndicator}
        </div>
    `;
    
    messagesContainer.appendChild(messageEl);
    scrollToBottom();
}

/**
 * Update user unread count
 */
function updateUserUnreadCount(userId, increment, reset = false) {
    const userItem = document.querySelector(`[data-user-id="${userId}"]`);
    if (!userItem) return;
    
    const badge = userItem.querySelector('.unread-badge');
    if (!badge) return;
    
    let currentCount = parseInt(badge.textContent) || 0;
    
    if (reset) {
        currentCount = 0;
    } else {
        currentCount += increment;
    }
    
    if (currentCount > 0) {
        badge.textContent = currentCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

/**
 * Show broadcast modal
 */
function showBroadcastModal() {
    const modal = document.getElementById('broadcastModal');
    const messageInput = document.getElementById('broadcastMessage');
    
    if (modal) {
        modal.classList.remove('hidden');
    }
    
    if (messageInput) {
        messageInput.value = '';
        messageInput.focus();
    }
}

/**
 * Hide broadcast modal
 */
function hideBroadcastModal() {
    const modal = document.getElementById('broadcastModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

/**
 * Send broadcast message
 */
function sendBroadcastMessage() {
    const messageInput = document.getElementById('broadcastMessage');
    const sendBtn = document.getElementById('sendBroadcast');
    
    if (!messageInput || !messageInput.value.trim()) {
        showAlert('Введите сообщение для рассылки', 'error');
        return;
    }
    
    const content = messageInput.value.trim();
    
    sendBtn.disabled = true;
    
    try {
        const success = adminWS.sendBroadcast(content);
        
        if (success) {
            showAlert('Сообщение отправлено всем пользователям', 'success');
            hideBroadcastModal();
        } else {
            showAlert('Не удалось отправить сообщение', 'error');
        }
    } catch (error) {
        console.error('Broadcast error:', error);
        showAlert('Ошибка отправки сообщения', 'error');
    } finally {
        sendBtn.disabled = false;
    }
}

/**
 * Show reset database modal
 */
function showResetDbModal() {
    const modal = document.getElementById('resetDbModal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

/**
 * Hide reset database modal
 */
function hideResetDbModal() {
    const modal = document.getElementById('resetDbModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

/**
 * Reset database
 */
async function resetDatabase() {
    const confirmBtn = document.getElementById('confirmResetDb');
    
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Сброс...';
    
    try {
        const response = await fetch('/ops/setup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        if (response.ok) {
            showAlert('База данных успешно сброшена', 'success');
            
            // Clear user cache after database reset
            try {
                const token = getAuthToken();
                if (token) {
                    await fetch('/ops/clear_user_cache', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    console.log('User cache cleared after database reset');
                }
            } catch (cacheError) {
                console.error('Failed to clear cache after DB reset:', cacheError);
            }
            
            hideResetDbModal();
            
            // Refresh page after a delay
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } else {
            const error = await response.json();
            showAlert(error.detail || 'Ошибка сброса базы данных', 'error');
        }
    } catch (error) {
        console.error('Reset database error:', error);
        showAlert('Ошибка соединения с сервером', 'error');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Да, сбросить БД';
    }
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
 * Force rebuild conversation UI
 */
function rebuildConversationUI(userId) {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    
    console.log(`Force rebuilding UI for ${userId}`);
    
    // Очищаем контейнер
    messagesContainer.innerHTML = '';
    
    const messages = conversationHistory[userId] || [];
    
    if (messages.length === 0) {
        messagesContainer.innerHTML = `
            <div class="message-info">
                Начните общение с пользователем или загрузите историю сообщений.
            </div>
        `;
    } else {
        // Добавляем все сообщения
        messages.forEach(message => {
            addMessageToUI(message);
        });
        scrollToBottom();
    }
    
    console.log(`Rebuilt UI with ${messages.length} messages`);
}

/**
 * Debug function to check chat state
 */
function debugChatState() {
    console.log('=== Chat Debug Info ===');
    console.log('Selected user:', selectedUser);
    console.log('Connected users:', connectedUsers);
    console.log('Conversation history keys:', Object.keys(conversationHistory));
    
    if (selectedUser && conversationHistory[selectedUser]) {
        console.log(`Messages for ${selectedUser}:`, conversationHistory[selectedUser].length);
        conversationHistory[selectedUser].forEach((msg, index) => {
            console.log(`  ${index + 1}. [${msg.type}] ${msg.senderName}: ${msg.content.substring(0, 50)}...`);
        });
    }
    
    console.log('LocalStorage keys:', Object.keys(localStorage).filter(key => key.includes('admin')));
    console.log('========================');
}

// Add to window for easy access from console
window.debugChatState = debugChatState;
window.rebuildConversationUI = rebuildConversationUI;
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Escape HTML to prevent XSS
 */
window.addEventListener('beforeunload', () => {
    if (adminWS) {
        adminWS.disconnect();
    }
});

// Export functions for global use
window.adminPanel = {
    initializeAdminPanel,
    selectUser,
    sendMessage,
    sendBroadcastMessage,
    resetDatabase
};

/**
 * Update debug information
 */
function updateDebugInfo() {
    const debugDiv = document.getElementById('debugInfo');
    if (!debugDiv) return;
    
    const info = {
        wsConnected: adminWS ? adminWS.isConnected : false,
        wsExists: !!adminWS,
        connectedUsersCount: connectedUsers ? connectedUsers.length : 0,
        selectedUser: selectedUser || 'none',
        conversationKeys: Object.keys(conversationHistory).length,
        currentAdmin: currentAdmin ? currentAdmin.login : 'none'
    };
    
    debugDiv.innerHTML = `
        WS: ${info.wsConnected ? '✅' : '❌'} | 
        Users: ${info.connectedUsersCount} | 
        Selected: ${info.selectedUser} | 
        Admin: ${info.currentAdmin}
    `;
}

// Auto-update debug info every 5 seconds
setInterval(updateDebugInfo, 5000);

// Make function available globally
window.updateDebugInfo = updateDebugInfo;

/**
 * Show user info modal
 */
async function showUserInfo(userId) {
    const modal = document.getElementById('userInfoModal');
    const content = document.getElementById('userInfoContent');
    
    if (!modal || !content) return;
    
    // Show modal with loading state
    content.innerHTML = '<div class="loading-message">Загрузка информации о пользователе...</div>';
    modal.classList.remove('hidden');
    
    try {
        // Get auth token
        const token = getAuthToken();
        if (!token) {
            throw new Error('Нет токена авторизации');
        }
        
        // Fetch user info from API
        const response = await fetch(`/ops/user_info_by_login/${userId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Ошибка сервера: ${response.status}`);
        }
        
        const userInfo = await response.json();
        displayUserInfo(userInfo);
        
    } catch (error) {
        console.error('Error fetching user info:', error);
        content.innerHTML = `
            <div class="error-message">
                <p>❌ Ошибка загрузки информации о пользователе</p>
                <p>${error.message}</p>
            </div>
        `;
    }
}

/**
 * Hide user info modal
 */
function hideUserInfoModal() {
    const modal = document.getElementById('userInfoModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

/**
 * Display user information in modal
 */
function displayUserInfo(userInfo) {
    const content = document.getElementById('userInfoContent');
    if (!content) return;
    
    // Format the user information
    const roleClass = userInfo.is_admin ? 'admin-badge' : 'user-badge';
    const roleText = userInfo.is_admin ? 'Администратор' : 'Пользователь';
    
    content.innerHTML = `
        <div class="user-info-grid">
            <div class="user-info-item">
                <div class="user-info-label">ID пользователя</div>
                <div class="user-info-value">${escapeHtml(userInfo.id || 'N/A')}</div>
            </div>
            
            <div class="user-info-item">
                <div class="user-info-label">Логин</div>
                <div class="user-info-value">${escapeHtml(userInfo.login || 'N/A')}</div>
            </div>
            
            <div class="user-info-item">
                <div class="user-info-label">Имя</div>
                <div class="user-info-value">${escapeHtml(userInfo.first_name || 'N/A')}</div>
            </div>
            
            <div class="user-info-item">
                <div class="user-info-label">Фамилия</div>
                <div class="user-info-value">${escapeHtml(userInfo.last_name || 'N/A')}</div>
            </div>
            
            <div class="user-info-item">
                <div class="user-info-label">Отчество</div>
                <div class="user-info-value">${escapeHtml(userInfo.patronymic || 'N/A')}</div>
            </div>
            
            <div class="user-info-item">
                <div class="user-info-label">Роль</div>
                <div class="user-info-value">
                    <span class="${roleClass}">${roleText}</span>
                </div>
            </div>
            
            <div class="user-info-item">
                <div class="user-info-label">Адрес</div>
                <div class="user-info-value">${escapeHtml(userInfo.address || 'N/A')}</div>
            </div>
            
            <div class="user-info-item">
                <div class="user-info-label">Квартира</div>
                <div class="user-info-value">${userInfo.flat || 'N/A'}</div>
            </div>
        </div>
        
        <div class="user-info-stats">
            <h4>📊 Статистика сообщений</h4>
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-number">${userInfo.total_messages || 0}</span>
                    <span class="stat-label">Всего сообщений</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">${userInfo.sent_messages || 0}</span>
                    <span class="stat-label">Отправлено</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">${userInfo.received_messages || 0}</span>
                    <span class="stat-label">Получено</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">${userInfo.unread_messages || 0}</span>
                    <span class="stat-label">Непрочитанных</span>
                </div>
            </div>
        </div>
        
        ${userInfo.last_activity ? `
            <div class="user-info-item">
                <div class="user-info-label">Последняя активность</div>
                <div class="user-info-value">${formatChatTime(userInfo.last_activity).dateStr} ${formatChatTime(userInfo.last_activity).timeStr}</div>
            </div>
        ` : ''}
    `;
}

// Make functions available globally
window.showUserInfo = showUserInfo;
window.hideUserInfoModal = hideUserInfoModal;

/**
 * Show archive conversation modal
 */
function showArchiveModal(userId) {
    const modal = document.getElementById('archiveModal');
    const userNameSpan = document.getElementById('archiveUserName');
    
    if (!modal) return;
    
    // Find user name
    const user = connectedUsers.find(u => u.user_id === userId);
    const userName = user ? user.name : userId;
    
    if (userNameSpan) {
        userNameSpan.textContent = userName;
    }
    
    modal.classList.remove('hidden');
}

/**
 * Hide archive conversation modal
 */
function hideArchiveModal() {
    const modal = document.getElementById('archiveModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

/**
 * Archive conversation with selected user
 */
async function archiveConversation() {
    if (!selectedUser) return;
    
    // Check if conversation is already archived
    const userItem = document.querySelector(`[data-user-id="${selectedUser}"]`);
    const isCurrentlyArchived = userItem && userItem.classList.contains('archived');
    
    if (isCurrentlyArchived) {
        // If already archived, unarchive instead
        await unarchiveConversation(selectedUser);
        return;
    }
    
    const confirmBtn = document.getElementById('confirmArchive');
    
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Архивирование...';
    }
    
    try {
        // Get auth token
        const token = getAuthToken();
        if (!token) {
            throw new Error('Нет токена авторизации');
        }
        
        // Send archive request
        const response = await fetch(`/ops/archive_conversation/${selectedUser}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Ошибка архивирования');
        }
        
        const result = await response.json();
        
        // Show success message
        showAlert(`✅ ${result.message}. Архивировано сообщений: ${result.archived_messages}`, 'success');
        
        // Update users list to move user to archived section
        await updateUsersList(connectedUsers);
        
        // Update archive button
        const archiveBtn = document.getElementById('archiveBtn');
        if (archiveBtn) {
            archiveBtn.textContent = 'Разархивировать беседу';
            archiveBtn.className = 'btn btn-success';
        }
        
        // Update chat title to show archive status
        const chatTitle = document.getElementById('chatTitle');
        if (chatTitle) {
            const user = connectedUsers.find(u => u.user_id === selectedUser);
            const userName = user ? user.name : selectedUser;
            chatTitle.textContent = `📁 ${userName}`;
        }
        
        // Hide modal
        hideArchiveModal();
        
    } catch (error) {
        console.error('Archive conversation error:', error);
        showAlert(`❌ Ошибка архивирования: ${error.message}`, 'error');
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Архивировать';
        }
    }
}

/**
 * Unarchive conversation with user
 */
async function unarchiveConversation(userId) {
    try {
        // Get auth token
        const token = getAuthToken();
        if (!token) {
            throw new Error('Нет токена авторизации');
        }
        
        // Send unarchive request
        const response = await fetch(`/ops/unarchive_conversation/${userId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Ошибка разархивирования');
        }
        
        const result = await response.json();
        
        // Show success message
        showAlert(`✅ ${result.message}. Разархивировано сообщений: ${result.unarchived_messages}`, 'success');
        
        // Update users list to move user back to active section
        await updateUsersList(connectedUsers);
        
        // Update archive button
        const archiveBtn = document.getElementById('archiveBtn');
        if (archiveBtn) {
            archiveBtn.textContent = 'Архивировать беседу';
            archiveBtn.className = 'btn btn-warning';
        }
        
        // Update chat title to remove archive status
        const chatTitle = document.getElementById('chatTitle');
        if (chatTitle) {
            const user = connectedUsers.find(u => u.user_id === userId);
            const userName = user ? user.name : userId;
            chatTitle.textContent = `Чат с ${userName}`;
        }
        
        // Reload conversation history to show all messages
        setTimeout(() => {
            loadConversationHistory(userId);
        }, 1000);
        
    } catch (error) {
        console.error('Unarchive conversation error:', error);
        showAlert(`❌ Ошибка разархивирования: ${error.message}`, 'error');
    }
}

// Make functions available globally
window.showArchiveModal = showArchiveModal;
window.hideArchiveModal = hideArchiveModal;
window.archiveConversation = archiveConversation;
window.unarchiveConversation = unarchiveConversation;

/**
 * Clear user cache
 */
async function clearUserCache() {
    const clearCacheBtn = document.getElementById('clearCacheBtn');
    
    if (clearCacheBtn) {
        clearCacheBtn.disabled = true;
        clearCacheBtn.textContent = 'Очистка...';
    }
    
    try {
        // Get auth token
        const token = getAuthToken();
        if (!token) {
            throw new Error('Нет токена авторизации');
        }
        
        // Send clear cache request
        const response = await fetch('/ops/clear_user_cache', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Ошибка очистки кэша');
        }
        
        const result = await response.json();
        
        // Show success message
        showAlert(`✅ ${result.message}`, 'success');
        
        // Refresh users list
        setTimeout(() => {
            loadConnectedUsers();
        }, 1000);
        
    } catch (error) {
        console.error('Clear cache error:', error);
        showAlert(`❌ Ошибка очистки кэша: ${error.message}`, 'error');
    } finally {
        if (clearCacheBtn) {
            clearCacheBtn.disabled = false;
            clearCacheBtn.textContent = 'Очистить кэш';
        }
    }
}

// Make function available globally
window.clearUserCache = clearUserCache;