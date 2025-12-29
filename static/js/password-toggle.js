/**
 * Password Toggle Functionality
 * Adds show/hide password buttons to password input fields
 */

/**
 * Initialize password toggle functionality for all password inputs on the page
 */
function initializePasswordToggles() {
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    
    passwordInputs.forEach(input => {
        addPasswordToggle(input);
    });
}

/**
 * Add password toggle button to a specific password input
 * @param {HTMLInputElement} passwordInput - The password input element
 */
function addPasswordToggle(passwordInput) {
    // Skip if already has toggle
    if (passwordInput.parentElement.classList.contains('password-input-container')) {
        return;
    }
    
    // Create container
    const container = document.createElement('div');
    container.className = 'password-input-container';
    
    // Create toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'password-toggle-btn';
    toggleBtn.innerHTML = '👁'; // Eye icon (simplified)
    toggleBtn.title = 'Показать пароль';
    toggleBtn.setAttribute('aria-label', 'Показать пароль');
    
    // Wrap input in container
    passwordInput.parentNode.insertBefore(container, passwordInput);
    container.appendChild(passwordInput);
    container.appendChild(toggleBtn);
    
    // Add click event listener
    toggleBtn.addEventListener('click', function() {
        togglePasswordVisibility(passwordInput, toggleBtn);
    });
    
    // Add keyboard support
    toggleBtn.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            togglePasswordVisibility(passwordInput, toggleBtn);
        }
    });
}

/**
 * Toggle password visibility
 * @param {HTMLInputElement} passwordInput - The password input element
 * @param {HTMLButtonElement} toggleBtn - The toggle button element
 */
function togglePasswordVisibility(passwordInput, toggleBtn) {
    const isPassword = passwordInput.type === 'password';
    
    if (isPassword) {
        // Show password
        passwordInput.type = 'text';
        toggleBtn.innerHTML = '🙈'; // Hidden eye icon
        toggleBtn.title = 'Скрыть пароль';
        toggleBtn.setAttribute('aria-label', 'Скрыть пароль');
    } else {
        // Hide password
        passwordInput.type = 'password';
        toggleBtn.innerHTML = '👁'; // Eye icon (simplified)
        toggleBtn.title = 'Показать пароль';
        toggleBtn.setAttribute('aria-label', 'Показать пароль');
    }
    
    // Keep focus on input after toggle
    passwordInput.focus();
}

/**
 * Initialize password toggles when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', function() {
    initializePasswordToggles();
});

// Export functions for manual initialization if needed
window.passwordToggle = {
    initialize: initializePasswordToggles,
    addToggle: addPasswordToggle,
    toggle: togglePasswordVisibility
};