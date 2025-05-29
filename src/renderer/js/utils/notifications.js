/**
 * Show a notification to the user
 * @param {string} message - The notification message
 * @param {string} type - The notification type (success, error, info)
 */
export function showNotification(message, type = 'info') {
  // Check if notification container exists
  const container = document.getElementById('notification-container');
  if (!container) return;
  
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  
  // Add icon based on type
  let icon = 'info-circle';
  if (type === 'success') icon = 'check-circle';
  if (type === 'error') icon = 'exclamation-circle';
  
  notification.innerHTML = `
    <div class="notification-icon">
      <i class="fas fa-${icon}"></i>
    </div>
    <div class="notification-content">
      <p>${message}</p>
    </div>
    <div class="notification-close">
      <i class="fas fa-times"></i>
    </div>
  `;
  
  // Add to container
  container.appendChild(notification);
  
  // Add event listener to close button
  const closeBtn = notification.querySelector('.notification-close');
  closeBtn.addEventListener('click', () => {
    notification.remove();
  });
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();
    }
  }, 5000);
} 