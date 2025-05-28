// notifications.js - Notification system

/**
 * Set up notification system styles and container
 */
function setupNotifications() {
  console.log('Setting up notification system...');
  
  // Create notifications container if it doesn't exist
  if (!document.getElementById('notifications-container')) {
    const container = document.createElement('div');
    container.id = 'notifications-container';
    document.body.appendChild(container);
  }
  
  // Add notification styles if they don't exist
  if (!document.getElementById('notification-styles')) {
    addNotificationStyles();
  }
}

/**
 * Show a notification message
 * @param {string} title - The notification title
 * @param {string} message - The notification message
 * @param {string} type - The notification type (info, success, warning, error)
 * @param {number} timeout - The timeout in milliseconds
 */
function showNotification(title, message, type = 'info', timeout = 5000) {
  // Get or create the notifications container
  let container = document.getElementById('notifications-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notifications-container';
    document.body.appendChild(container);
  }
  
  // Create the notification element
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  
  // Get icon based on type
  let icon = 'info-circle';
  if (type === 'success') icon = 'check-circle';
  if (type === 'warning') icon = 'exclamation-triangle';
  if (type === 'error') icon = 'times-circle';
  
  // Set notification content
  notification.innerHTML = `
    <div class="notification-icon">
      <i class="fas fa-${icon}"></i>
    </div>
    <div class="notification-content">
      <div class="notification-title">${title}</div>
      <div class="notification-message">${message}</div>
    </div>
    <div class="notification-close">
      <i class="fas fa-times"></i>
    </div>
  `;
  
  // Add close button event
  const closeButton = notification.querySelector('.notification-close');
  closeButton.addEventListener('click', () => {
    removeNotification(notification);
  });
  
  // Add to container
  container.appendChild(notification);
  
  // Set timeout to auto-remove
  if (timeout > 0) {
    setTimeout(() => {
      removeNotification(notification);
    }, timeout);
  }
  
  // Animate in
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  return notification;
}

/**
 * Show a simple toast notification (shorthand for showNotification)
 * @param {string} message - The toast message
 * @param {string} type - The toast type (info, success, warning, error)
 * @param {number} timeout - The timeout in milliseconds
 */
function showToast(message, type = 'info', timeout = 3000) {
  return showNotification(type.charAt(0).toUpperCase() + type.slice(1), message, type, timeout);
}

/**
 * Remove a notification with animation
 * @param {HTMLElement} notification - The notification element to remove
 */
function removeNotification(notification) {
  if (!notification) return;
  
  // Animate out
  notification.classList.remove('show');
  
  // Remove after animation
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 300);
}

/**
 * Get notification color based on type
 * @param {string} type - The notification type
 * @returns {string} - The color hex code
 */
function getNotificationColor(type) {
  switch (type) {
    case 'success': return '#2ecc71';
    case 'warning': return '#f39c12';
    case 'error': return '#e74c3c';
    default: return '#3498db'; // info
  }
}

/**
 * Show a confirmation dialog
 * @param {string} title - The dialog title
 * @param {string} message - The dialog message
 * @param {string} confirmText - Text for confirm button
 * @param {string} cancelText - Text for cancel button
 * @returns {Promise<boolean>} - Resolves to true if confirmed, false if canceled
 */
function showConfirmDialog(title, message, confirmText = 'Confirm', cancelText = 'Cancel') {
  return new Promise((resolve) => {
    // Create modal backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.style.position = 'fixed';
    backdrop.style.top = '0';
    backdrop.style.left = '0';
    backdrop.style.width = '100%';
    backdrop.style.height = '100%';
    backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    backdrop.style.zIndex = '9999';
    backdrop.style.display = 'flex';
    backdrop.style.justifyContent = 'center';
    backdrop.style.alignItems = 'center';
    
    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.style.backgroundColor = 'white';
    dialog.style.borderRadius = '8px';
    dialog.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
    dialog.style.width = '350px';
    dialog.style.maxWidth = '90%';
    dialog.style.padding = '20px';
    
    // Create dialog content
    dialog.innerHTML = `
      <div class="dialog-header" style="margin-bottom: 15px;">
        <h3 style="margin: 0; font-size: 18px;">${title}</h3>
      </div>
      <div class="dialog-body" style="margin-bottom: 20px;">
        <p style="margin: 0; color: #555;">${message}</p>
      </div>
      <div class="dialog-footer" style="display: flex; justify-content: flex-end; gap: 10px;">
        <button id="dialog-cancel" class="btn-cancel" style="padding: 8px 12px; background-color: #f1f1f1; border: none; border-radius: 4px; cursor: pointer;">${cancelText}</button>
        <button id="dialog-confirm" class="btn-confirm" style="padding: 8px 12px; background-color: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">${confirmText}</button>
      </div>
    `;
    
    // Add dialog to backdrop
    backdrop.appendChild(dialog);
    
    // Add backdrop to body
    document.body.appendChild(backdrop);
    
    // Handle confirm click
    const confirmBtn = dialog.querySelector('#dialog-confirm');
    confirmBtn.addEventListener('click', () => {
      document.body.removeChild(backdrop);
      resolve(true);
    });
    
    // Handle cancel click
    const cancelBtn = dialog.querySelector('#dialog-cancel');
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(backdrop);
      resolve(false);
    });
    
    // Handle click outside dialog
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        document.body.removeChild(backdrop);
        resolve(false);
      }
    });
  });
}

/**
 * Add notification styles to the document
 */
function addNotificationStyles() {
  // Add notification styles if they don't exist
  if (!document.getElementById('notification-styles')) {
    const style = document.createElement('style');
    style.id = 'notification-styles';
    style.textContent = `
      #notifications-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        max-width: 350px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      
      .notification {
        display: flex;
        background-color: white;
        border-radius: 8px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        padding: 15px;
        margin-bottom: 10px;
        transform: translateX(120%);
        opacity: 0;
        transition: transform 0.3s ease, opacity 0.3s ease;
        border-left: 4px solid #3498db;
      }
      
      .notification.show {
        transform: translateX(0);
        opacity: 1;
      }
      
      .notification.info { border-left-color: #3498db; }
      .notification.success { border-left-color: #2ecc71; }
      .notification.warning { border-left-color: #f39c12; }
      .notification.error { border-left-color: #e74c3c; }
      
      .notification-icon {
        display: flex;
        align-items: center;
        margin-right: 12px;
        font-size: 20px;
      }
      
      .notification.info .notification-icon { color: #3498db; }
      .notification.success .notification-icon { color: #2ecc71; }
      .notification.warning .notification-icon { color: #f39c12; }
      .notification.error .notification-icon { color: #e74c3c; }
      
      .notification-content {
        flex: 1;
      }
      
      .notification-title {
        font-weight: bold;
        margin-bottom: 4px;
      }
      
      .notification-message {
        font-size: 0.9em;
        word-break: break-word;
      }
      
      .notification-close {
        cursor: pointer;
        display: flex;
        align-items: center;
        padding-left: 12px;
        color: #aaa;
      }
      
      .notification-close:hover {
        color: #555;
      }
    `;
    document.head.appendChild(style);
  }
}

// Export functions
export {
  setupNotifications,
  showNotification,
  showToast,
  showConfirmDialog
}; 