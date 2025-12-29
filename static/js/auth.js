// Authentication utilities

/**
 * Login user with credentials
 */
async function loginUser(login, password) {
    try {
        // Create URL-encoded form data
        const formData = new URLSearchParams();
        formData.append('login', login);
        formData.append('password', password);
        
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok && data.success && data.access_token) {
            // Store token
            localStorage.setItem('authToken', data.access_token);
            
            // Store complete user data from server response
            if (data.user) {
                localStorage.setItem('userData', JSON.stringify(data.user));
            } else {
                // Fallback to basic user data if server doesn't provide full data
                const userData = {
                    login: login,
                    is_admin: false,
                    first_name: login,
                    last_name: '',
                    patronymic: '',
                    address: '',
                    flat: 0,
                    id: login
                };
                
                // Try to get more info from token if possible
                try {
                    const tokenParts = data.access_token.split('.');
                    if (tokenParts.length === 3) {
                        const payload = JSON.parse(atob(tokenParts[1]));
                        if (payload.is_admin !== undefined) {
                            userData.is_admin = Boolean(payload.is_admin);
                        }
                    }
                } catch (e) {
                    console.log('Could not decode token, using basic data');
                }
                
                localStorage.setItem('userData', JSON.stringify(userData));
            }
            
            return {
                success: true,
                token: data.access_token,
                userData: data.user || JSON.parse(localStorage.getItem('userData'))
            };
        } else {
            return {
                success: false,
                message: data.detail || 'Неверный логин или пароль'
            };
        }
    } catch (error) {
        console.error('Login error:', error);
        return {
            success: false,
            message: 'Ошибка соединения с сервером'
        };
    }
}

/**
 * Logout user
 */
function logout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userData');
    window.location.href = '/static/login.html';
}

/**
 * Check if user is authenticated
 */
function checkAuth() {
    const token = localStorage.getItem('authToken');
    const userData = localStorage.getItem('userData');
    
    if (!token || !userData) {
        return false;
    }
    
    try {
        // Basic token validation (check if it's not expired)
        const tokenParts = token.split('.');
        if (tokenParts.length !== 3) {
            return false;
        }
        
        const payload = JSON.parse(atob(tokenParts[1]));
        const currentTime = Math.floor(Date.now() / 1000);
        
        // Check if token is expired
        if (payload.exp && payload.exp < currentTime) {
            logout();
            return false;
        }
        
        return true;
    } catch (e) {
        // If token is malformed, consider it invalid
        logout();
        return false;
    }
}

/**
 * Get stored user data
 */
function getUserData() {
    const userData = localStorage.getItem('userData');
    if (userData) {
        try {
            return JSON.parse(userData);
        } catch (e) {
            return null;
        }
    }
    return null;
}

/**
 * Get stored auth token
 */
function getAuthToken() {
    return localStorage.getItem('authToken');
}

/**
 * Check if current user is admin
 */
function isAdmin() {
    const userData = getUserData();
    return userData && userData.is_admin;
}

/**
 * Make authenticated API request
 */
async function authenticatedFetch(url, options = {}) {
    const token = getAuthToken();
    
    if (!token) {
        throw new Error('No authentication token');
    }
    
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    const response = await fetch(url, {
        ...options,
        headers
    });
    
    // If unauthorized, redirect to login
    if (response.status === 401 || response.status === 403) {
        logout();
        return;
    }
    
    return response;
}

/**
 * Refresh user data from server
 */
async function refreshUserData() {
    try {
        const userData = getUserData();
        if (!userData) return false;
        
        // Make request to get updated user data
        const response = await authenticatedFetch(`/ops/user/${userData.id}`);
        
        if (response && response.ok) {
            const updatedData = await response.json();
            localStorage.setItem('userData', JSON.stringify(updatedData));
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Error refreshing user data:', error);
        return false;
    }
}

// Auto-refresh token periodically (every 30 minutes)
setInterval(() => {
    if (checkAuth()) {
        refreshUserData();
    }
}, 30 * 60 * 1000);

// Export functions for use in other scripts
window.authUtils = {
    loginUser,
    logout,
    checkAuth,
    getUserData,
    getAuthToken,
    isAdmin,
    authenticatedFetch,
    refreshUserData
};
/**
 * Validate email format
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Login user with email validation
 */
async function loginUserWithValidation(login, password) {
    // Validate email format
    if (!isValidEmail(login)) {
        throw new Error('Пожалуйста, введите корректный email адрес');
    }
    
    try {
        // Use JSON endpoint with Pydantic validation
        const response = await fetch('/auth/login_json', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                login: login,
                password: password
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success && data.access_token) {
            // Store token
            localStorage.setItem('authToken', data.access_token);
            
            // Store complete user data from server response
            if (data.user) {
                localStorage.setItem('userData', JSON.stringify(data.user));
            }
            
            return data;
        } else {
            throw new Error(data.detail || 'Ошибка авторизации');
        }
    } catch (error) {
        if (error.message.includes('validation')) {
            throw new Error('Неверный формат email адреса');
        }
        throw error;
    }
}

// Make functions available globally
window.isValidEmail = isValidEmail;
window.loginUserWithValidation = loginUserWithValidation;