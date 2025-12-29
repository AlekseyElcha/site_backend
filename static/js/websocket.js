// WebSocket client functionality

class ChatWebSocket {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000; // Start with 1 second
        this.maxReconnectDelay = 30000; // Max 30 seconds
        this.heartbeatInterval = null;
        this.messageQueue = [];
        this.eventListeners = {};
        
        // Bind methods
        this.connect = this.connect.bind(this);
        this.disconnect = this.disconnect.bind(this);
        this.sendMessage = this.sendMessage.bind(this);
        this.onOpen = this.onOpen.bind(this);
        this.onMessage = this.onMessage.bind(this);
        this.onClose = this.onClose.bind(this);
        this.onError = this.onError.bind(this);
    }
    
    /**
     * Connect to WebSocket server
     */
    async connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return true;
        }
        
        const userData = getUserData();
        const token = getAuthToken(); // Используем правильную функцию
        
        if (!userData || !token) {
            this.emit('error', { message: 'No authentication data' });
            return false;
        }
        
        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host;
            const wsUrl = `${protocol}//${host}/ws/${userData.login}?token=${encodeURIComponent(token)}`;
            
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = this.onOpen;
            this.ws.onmessage = this.onMessage;
            this.ws.onclose = this.onClose;
            this.ws.onerror = this.onError;
            
            return true;
            
        } catch (error) {
            console.error('WebSocket connection error:', error);
            this.emit('error', { message: 'Failed to connect to chat server' });
            return false;
        }
    }
    
    /**
     * Disconnect from WebSocket server
     */
    disconnect() {
        this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection
        
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        if (this.ws) {
            this.ws.close(1000, 'User disconnect');
            this.ws = null;
        }
        
        this.isConnected = false;
        this.emit('disconnected');
    }
    
    /**
     * Send message through WebSocket
     */
    sendMessage(message) {
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            // Queue message for later sending
            this.messageQueue.push(message);
            this.emit('error', { message: 'Not connected to chat server' });
            return false;
        }
        
        try {
            const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
            this.ws.send(messageStr);
            return true;
        } catch (error) {
            console.error('Error sending message:', error);
            this.emit('error', { message: 'Failed to send message' });
            return false;
        }
    }
    
    /**
     * Send user message to admin
     */
    sendUserMessage(content) {
        return this.sendMessage({
            type: 'user_to_admin',
            message: content
        });
    }
    
    /**
     * Send admin message to user
     */
    sendAdminMessage(content, toUser) {
        return this.sendMessage({
            type: 'admin_to_user',
            to_user: toUser,
            message: content
        });
    }
    
    /**
     * Send broadcast message (admin only)
     */
    sendBroadcast(content) {
        return this.sendMessage({
            type: 'broadcast',
            message: content
        });
    }
    
    /**
     * Request conversation history
     */
    requestConversationHistory(withUser, limit = 50, offset = 0) {
        return this.sendMessage({
            type: 'get_conversation_history',
            with_user: withUser,
            limit: limit,
            offset: offset
        });
    }
    
    /**
     * Request conversations list
     */
    requestConversations() {
        return this.sendMessage({
            type: 'get_conversations'
        });
    }
    
    /**
     * Mark messages as read
     */
    markAsRead(senderId) {
        return this.sendMessage({
            type: 'mark_as_read',
            sender_id: senderId
        });
    }
    
    /**
     * Request connected users list (admin only)
     */
    requestConnectedUsers() {
        return this.sendMessage({
            type: 'get_connected_users'
        });
    }
    
    /**
     * Send ping to server
     */
    ping() {
        return this.sendMessage({
            type: 'ping'
        });
    }
    
    /**
     * WebSocket open event handler
     */
    onOpen(event) {
        console.log('WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        
        // Start heartbeat
        this.startHeartbeat();
        
        // Send queued messages
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            this.sendMessage(message);
        }
        
        this.emit('connected');
    }
    
    /**
     * WebSocket message event handler
     */
    onMessage(event) {
        try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
            // Handle as plain text message
            this.emit('message', { type: 'text', content: event.data });
        }
    }
    
    /**
     * WebSocket close event handler
     */
    onClose(event) {
        console.log('WebSocket disconnected:', event.code, event.reason);
        this.isConnected = false;
        
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        this.emit('disconnected', { code: event.code, reason: event.reason });
        
        // Attempt to reconnect if not intentionally closed
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
        }
    }
    
    /**
     * WebSocket error event handler
     */
    onError(event) {
        console.error('WebSocket error:', event);
        this.emit('error', { message: 'WebSocket connection error' });
    }
    
    /**
     * Handle incoming messages
     */
    handleMessage(data) {
        const messageType = data.type;
        
        switch (messageType) {
            case 'welcome':
                this.emit('welcome', data);
                break;
                
            case 'user_message':
                this.emit('userMessage', data);
                break;
                
            case 'admin_message':
                this.emit('adminMessage', data);
                break;
                
            case 'admin_sent':
                this.emit('adminSent', data);
                break;
                
            case 'broadcast':
                this.emit('broadcast', data);
                break;
                
            case 'user_connected':
                this.emit('userConnected', data);
                break;
                
            case 'connected_users':
                this.emit('connectedUsers', data);
                break;
                
            case 'conversation_history':
                this.emit('conversationHistory', data);
                break;
                
            case 'conversations_list':
                this.emit('conversationsList', data);
                break;
                
            case 'offline_message':
                this.emit('offlineMessage', data);
                break;
                
            case 'offline_messages_summary':
                this.emit('offlineMessagesSummary', data);
                break;
                
            case 'pong':
                // Heartbeat response
                break;
                
            case 'error':
                this.emit('error', data);
                break;
                
            default:
                console.warn('Unknown message type:', messageType, data);
                this.emit('message', data);
        }
    }
    
    /**
     * Schedule reconnection attempt
     */
    scheduleReconnect() {
        this.reconnectAttempts++;
        
        const delay = Math.min(
            this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
            this.maxReconnectDelay
        );
        
        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(() => {
            if (this.reconnectAttempts <= this.maxReconnectAttempts) {
                this.emit('reconnecting', { attempt: this.reconnectAttempts });
                this.connect();
            } else {
                this.emit('reconnectFailed');
            }
        }, delay);
    }
    
    /**
     * Start heartbeat to keep connection alive
     */
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected) {
                this.ping();
            }
        }, 30000); // Ping every 30 seconds
    }
    
    /**
     * Add event listener
     */
    on(event, callback) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
    }
    
    /**
     * Remove event listener
     */
    off(event, callback) {
        if (this.eventListeners[event]) {
            const index = this.eventListeners[event].indexOf(callback);
            if (index > -1) {
                this.eventListeners[event].splice(index, 1);
            }
        }
    }
    
    /**
     * Emit event to listeners
     */
    emit(event, data) {
        if (this.eventListeners[event]) {
            this.eventListeners[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error('Error in event listener:', error);
                }
            });
        }
    }
    
    /**
     * Get connection status
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            readyState: this.ws ? this.ws.readyState : WebSocket.CLOSED,
            reconnectAttempts: this.reconnectAttempts
        };
    }
}

// Notification system
class NotificationManager {
    constructor() {
        this.notifications = [];
        this.soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
        this.permission = 'default';
        
        this.requestPermission();
    }
    
    /**
     * Request notification permission
     */
    async requestPermission() {
        if ('Notification' in window) {
            this.permission = await Notification.requestPermission();
        }
    }
    
    /**
     * Show notification
     */
    show(title, options = {}) {
        // Browser notification
        if (this.permission === 'granted' && document.hidden) {
            const notification = new Notification(title, {
                icon: '/static/favicon.ico',
                badge: '/static/favicon.ico',
                ...options
            });
            
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
            
            // Auto-close after 5 seconds
            setTimeout(() => notification.close(), 5000);
        }
        
        // Visual notification in app
        this.showVisualNotification(title, options.body);
        
        // Sound notification
        if (this.soundEnabled) {
            this.playNotificationSound();
        }
    }
    
    /**
     * Show visual notification in app
     */
    showVisualNotification(title, body) {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.innerHTML = `
            <div class="notification-content">
                <div class="notification-title">${title}</div>
                ${body ? `<div class="notification-body">${body}</div>` : ''}
            </div>
            <button class="notification-close">&times;</button>
        `;
        
        // Add to page
        document.body.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
        
        // Close button
        notification.querySelector('.notification-close').onclick = () => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        };
    }
    
    /**
     * Play notification sound
     */
    playNotificationSound() {
        try {
            // Create audio context for notification sound
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.2);
        } catch (error) {
            console.warn('Could not play notification sound:', error);
        }
    }
    
    /**
     * Toggle sound notifications
     */
    toggleSound() {
        this.soundEnabled = !this.soundEnabled;
        localStorage.setItem('soundEnabled', this.soundEnabled.toString());
        return this.soundEnabled;
    }
}

// Global instances
let chatWebSocket = null;
let notificationManager = null;

/**
 * Initialize WebSocket connection
 */
function initializeWebSocket() {
    if (!chatWebSocket) {
        chatWebSocket = new ChatWebSocket();
        notificationManager = new NotificationManager();
    }
    
    return chatWebSocket;
}

/**
 * Get WebSocket instance
 */
function getWebSocket() {
    return chatWebSocket;
}

/**
 * Get notification manager
 */
function getNotificationManager() {
    return notificationManager;
}

// Export for global use
window.ChatWebSocket = ChatWebSocket;
window.NotificationManager = NotificationManager;
window.initializeWebSocket = initializeWebSocket;
window.getWebSocket = getWebSocket;
window.getNotificationManager = getNotificationManager;