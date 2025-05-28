// scheduled.js - Scheduled Messages Management
import { api } from '../utils/api.js';
import { showToast, showConfirmDialog } from '../ui/notifications.js';

// Cache DOM elements
let elements = {};

// Messages cache
let messages = [];
let currentFilter = '';

// Status color mapping
const statusColors = {
  'SCHEDULED': '#ffc107', // Yellow
  'PENDING': '#2196F3',   // Blue
  'SENT': '#4CAF50',      // Green
  'DELIVERED': '#00C853', // Brighter green
  'READ': '#8BC34A',      // Light green
  'FAILED': '#f44336'     // Red
};

/**
 * Initialize the scheduled messages module
 */
export async function initScheduled() {
  console.log('Initializing scheduled messages module...');
  
  try {
  // Cache DOM elements
  cacheElements();
    
    // Check if all required elements exist
    if (!validateElements()) {
      console.error('Required elements for scheduled messages module are missing');
      return;
    }
    
    // Initialize empty messages array
    messages = [];
  
  // Set up event listeners
  setupEventListeners();
  
    // Load messages
  await loadScheduledMessages();
    
    // Set up real-time message status updates
    setupMessageStatusUpdates();
    
    console.log('Scheduled messages module initialized successfully');
  } catch (error) {
    console.error('Error initializing scheduled messages module:', error);
    
    if (elements.messagesContainer) {
      elements.messagesContainer.innerHTML = `
        <div class="error-state">
          <i class="fas fa-exclamation-triangle"></i>
          <h3>Error initializing module</h3>
          <p>${error.message}</p>
          <button id="retry-init" class="secondary-btn">
            <i class="fas fa-sync-alt"></i> Retry
          </button>
        </div>
      `;
      
      document.getElementById('retry-init')?.addEventListener('click', initScheduled);
    }
  }
}

/**
 * Validate that all required elements exist
 * @returns {boolean} - True if all required elements exist
 */
function validateElements() {
  const requiredElements = [
    'messagesContainer',
    'statusFilter',
    'refreshButton'
  ];
  
  for (const elementName of requiredElements) {
    if (!elements[elementName]) {
      console.error(`Required element '${elementName}' not found`);
      return false;
    }
  }
  
  return true;
}

/**
 * Cache DOM elements for better performance
 */
function cacheElements() {
  elements = {
    messagesTable: document.getElementById('messages-table'),
    statusFilter: document.getElementById('status-filter'),
    refreshButton: document.getElementById('refresh-messages'),
    messagesContainer: document.getElementById('messages-container')
  };
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Refresh button
  if (elements.refreshButton) {
    elements.refreshButton.addEventListener('click', async () => {
      elements.refreshButton.classList.add('loading');
      elements.refreshButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
      await loadScheduledMessages();
      elements.refreshButton.classList.remove('loading');
      elements.refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
    });
  }
  
  // Status filter
  if (elements.statusFilter) {
    elements.statusFilter.addEventListener('change', () => {
      currentFilter = elements.statusFilter.value;
      // Store the filter in localStorage so it persists between page refreshes
      localStorage.setItem('scheduledMessagesFilter', currentFilter);
      // Apply filter without reloading from server
      renderMessages();
    });
    
    // Load saved filter if available
    const savedFilter = localStorage.getItem('scheduledMessagesFilter');
    if (savedFilter) {
      elements.statusFilter.value = savedFilter;
      currentFilter = savedFilter;
    }
  }
  
  // Set up auto-refresh timer (every 10 seconds)
  const autoRefreshInterval = setInterval(() => {
    if (document.querySelector('#scheduled.active')) {
      console.log('Auto-refreshing scheduled messages');
      loadScheduledMessages();
    }
  }, 10000);
  
  // Make sure to clear interval when navigating away
  window.addEventListener('beforeunload', () => {
    clearInterval(autoRefreshInterval);
  });
}

/**
 * Load scheduled messages from the API
 */
export async function loadScheduledMessages() {
  try {
    console.log('Loading scheduled messages...');
    
    // Show loading state
    elements.messagesContainer.innerHTML = `
      <div class="loading-spinner">
        <i class="fas fa-spinner fa-spin"></i>
        <p>Loading scheduled messages...</p>
      </div>
    `;
    
    // Fetch messages from API
    const response = await window.api.getScheduledMessages();
    
    // Check if response is valid
    if (!Array.isArray(response)) {
      console.error('Invalid response from getScheduledMessages:', response);
      throw new Error('Failed to load scheduled messages');
    }
    
    console.log(`Loaded ${response.length} scheduled messages`);
    
    // Store messages
    messages = response || [];
    
    // Sort messages by scheduled time (newest first)
    messages.sort((a, b) => new Date(b.scheduledTime) - new Date(a.scheduledTime));
    
    // Render messages
    renderMessages();
  } catch (error) {
    console.error('Error loading scheduled messages:', error);
    
    // Show error state
    elements.messagesContainer.innerHTML = `
      <div class="error-state">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Error loading messages</h3>
        <p>${error.message}</p>
        <button id="retry-load-messages" class="secondary-btn">
          <i class="fas fa-sync-alt"></i> Retry
        </button>
      </div>
    `;
    
    // Add retry button event listener
    document.getElementById('retry-load-messages')?.addEventListener('click', loadScheduledMessages);
  }
}

// Expose the refresh function globally so it can be called from other modules
window.refreshScheduledMessages = loadScheduledMessages;

/**
 * Filter messages based on the current filter
 * @returns {Array} - Filtered messages
 */
function filterMessages() {
  if (!messages || messages.length === 0) {
    return [];
  }
  
  // If no filter is selected, return all messages
  if (!currentFilter || currentFilter === 'ALL') {
    return messages;
  }
  
  // Filter messages by status - more efficiently
  return messages.filter(message => message.status === currentFilter);
}

/**
 * Render messages to the UI
 */
function renderMessages() {
  // Clear the messages container
  elements.messagesContainer.innerHTML = '';
  
  if (!messages || messages.length === 0) {
    elements.messagesContainer.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-calendar-alt"></i>
        <h3>No scheduled messages</h3>
        <p>Your scheduled messages will appear here.</p>
      </div>
    `;
    return;
  }
  
  // Filter messages based on the current filter
  const filteredMessages = filterMessages();
  
  if (filteredMessages.length === 0) {
    elements.messagesContainer.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-filter"></i>
        <h3>No ${currentFilter.toLowerCase()} messages</h3>
        <p>No messages match your current filter.</p>
        <button id="clear-filter" class="secondary-btn">Clear Filter</button>
      </div>
    `;
    
    // Add event listener to clear filter button
    document.getElementById('clear-filter')?.addEventListener('click', () => {
      elements.statusFilter.value = 'ALL';
      currentFilter = 'ALL';
      localStorage.setItem('scheduledMessagesFilter', 'ALL');
      renderMessages();
    });
    
    return;
  }
  
  // Sort messages by scheduled time (newest first for better UX)
  filteredMessages.sort((a, b) => new Date(b.scheduledTime) - new Date(a.scheduledTime));
  
  // Use DocumentFragment for better performance when adding multiple elements
  const fragment = document.createDocumentFragment();
  
  filteredMessages.forEach(message => {
    // Get message timestamps
    const scheduledTime = new Date(message.scheduledTime);
    // Use updatedAt as a substitute for sentTime
    const sentTime = (message.status === 'SENT' || message.status === 'DELIVERED' || message.status === 'READ') 
                    ? new Date(message.updatedAt) 
                    : null;
    const contact = message.Contact || {};
    const template = message.Template || {};
    
    // Determine status class and icon
    let statusClass = '';
    let statusIcon = '';
    
    switch(message.status) {
      case 'SENT':
        statusClass = 'sent';
        statusIcon = 'fa-check';
        break;
      case 'DELIVERED':
      case 'DELIVERED_TO_SERVER':
        statusClass = 'delivered';
        statusIcon = 'fa-check-double';
        break;
      case 'READ':
        statusClass = 'read';
        statusIcon = 'fa-check-double read';
        break;
      case 'FAILED':
        statusClass = 'failed';
        statusIcon = 'fa-times';
        break;
      case 'PENDING':
        statusClass = 'pending';
        statusIcon = 'fa-clock';
        break;
      case 'SCHEDULED':
        statusClass = 'scheduled';
        statusIcon = 'fa-calendar';
        break;
      case 'CANCELED':
        statusClass = 'canceled';
        statusIcon = 'fa-ban';
        break;
      default:
        statusClass = 'unknown';
        statusIcon = 'fa-question';
    }
    
    // Create a message card with data attributes for status updates
    const messageCard = document.createElement('div');
    messageCard.className = `message-card ${statusClass}`;
    messageCard.dataset.id = message.id;
    
    // Add external ID for status updates if available
    if (message.externalId) {
      messageCard.dataset.externalId = message.externalId;
    }
    
    messageCard.innerHTML = `
      <div class="message-header">
        <div class="message-recipient">
          <i class="fas fa-user"></i>
          <span>${contact.name || ''} ${contact.surname || ''}</span>
          <span class="phone-number">${contact.phoneNumber || 'Unknown'}</span>
        </div>
        <div class="message-status-container">
          <i class="status-icon fas ${statusIcon}"></i>
          <span class="message-status ${statusClass}">${message.status}</span>
        </div>
      </div>
      <div class="message-content">
        <p>${message.contentSnapshot || 'No content'}</p>
        ${message.imagePathSnapshot ? 
          `<div class="message-image">
            <img src="file://${message.imagePathSnapshot}" alt="Message image">
          </div>` : ''
        }
      </div>
      <div class="message-footer">
        <div class="message-times">
          <div class="time-item">
            <i class="fas fa-calendar-alt"></i>
            <span class="message-time">${scheduledTime.toLocaleDateString()} ${scheduledTime.toLocaleTimeString()}</span>
          </div>
          ${sentTime ? 
            `<div class="time-item">
              <i class="fas fa-paper-plane"></i>
              <span class="message-time" data-update-type="status">${sentTime.toLocaleDateString()} ${sentTime.toLocaleTimeString()}</span>
            </div>` : ''
          }
        </div>
        <div class="message-actions">
          ${message.status === 'SCHEDULED' || message.status === 'PENDING' ? 
            `<button class="btn btn-sm btn-danger cancel-btn" data-id="${message.id}" title="Cancel this message">
              <i class="fas fa-times"></i> Cancel
            </button>` : ''
          }
          ${message.status === 'FAILED' ? 
            `<button class="btn btn-sm btn-primary retry-btn" data-id="${message.id}" title="Retry sending this message">
              <i class="fas fa-redo"></i> Retry
            </button>` : ''
          }
          <button class="btn btn-sm btn-info view-btn" data-id="${message.id}" title="View message details">
            <i class="fas fa-eye"></i> View
          </button>
        </div>
      </div>
    `;
    
    // Add the message card to the fragment
    fragment.appendChild(messageCard);
  });
  
  // Add all cards to the container at once (more efficient)
  elements.messagesContainer.appendChild(fragment);
  
  // Setup event listeners for the newly created buttons
  setupMessageCardButtons();
  
  // Add counter at the top
  const counterDiv = document.createElement('div');
  counterDiv.className = 'messages-counter';
  counterDiv.innerHTML = `
    <span>Showing ${filteredMessages.length} ${currentFilter !== 'ALL' ? currentFilter.toLowerCase() : ''} message${filteredMessages.length !== 1 ? 's' : ''}</span>
    ${currentFilter !== 'ALL' ? `<button id="show-all-messages" class="secondary-btn">Show All</button>` : ''}
  `;
  
  // Insert counter at the beginning of the container
  elements.messagesContainer.insertBefore(counterDiv, elements.messagesContainer.firstChild);
  
  // Add event listener to "Show All" button if present
  document.getElementById('show-all-messages')?.addEventListener('click', () => {
    elements.statusFilter.value = 'ALL';
    currentFilter = 'ALL';
    localStorage.setItem('scheduledMessagesFilter', 'ALL');
    renderMessages();
  });
}

/**
 * Format date and time for display
 * @param {Date} date - Date object to format
 * @returns {string} Formatted date and time
 */
function formatDateTime(date) {
  if (!date || isNaN(date.getTime())) return 'Invalid date';
  
  const options = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  };
  
  return date.toLocaleString(undefined, options);
}

/**
 * Cancel a scheduled message
 * @param {number} id - Message ID
 */
async function cancelMessage(id) {
  try {
    // Confirm with user
    const confirmed = await showConfirmDialog(
      'Cancel Message',
      'Are you sure you want to cancel this scheduled message?',
      'Cancel Message',
      'Keep Scheduled'
    );
    
    if (!confirmed) return;
    
    // Send cancellation request
    const result = await api.cancelScheduledMessage(id);
    
    if (result && result.success) {
      showToast('Message cancelled successfully', 'success');
      
      // Reload messages
      await loadScheduledMessages();
    } else {
      showToast('Failed to cancel message', 'error');
    }
  } catch (error) {
    console.error('Error cancelling message:', error);
    showToast(`Error: ${error.message}`, 'error');
  }
}

/**
 * Retry a failed message
 * @param {number} id - Message ID
 */
async function retryMessage(id) {
  try {
    // Confirm with user
    const confirmed = await showConfirmDialog(
      'Retry Message',
      'Are you sure you want to retry this failed message?',
      'Retry',
      'Cancel'
    );
    
    if (!confirmed) return;
    
    // Send retry request
    const result = await api.retryFailedMessage(id);
    
    if (result && result.success) {
      showToast('Message queued for retry', 'success');
      
      // Reload messages
      await loadScheduledMessages();
    } else {
      showToast('Failed to retry message', 'error');
    }
  } catch (error) {
    console.error('Error retrying message:', error);
    showToast(`Error: ${error.message}`, 'error');
  }
}

/**
 * View message details
 * @param {Object} message - Message object
 */
function viewMessageDetails(message) {
  // Create modal element
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  
  // Create modal content
  const modalContent = document.createElement('div');
  modalContent.className = 'modal-content';
  
  // Create header
  const header = document.createElement('div');
  header.className = 'modal-header';
  
  const title = document.createElement('h2');
  title.textContent = 'Message Details';
  
  const closeBtn = document.createElement('span');
  closeBtn.className = 'close-modal';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  
  header.appendChild(title);
  header.appendChild(closeBtn);
  
  // Create body
  const body = document.createElement('div');
  body.className = 'modal-body';
  
  // Contact info
  const contactInfo = document.createElement('div');
  contactInfo.className = 'detail-group';
  
  const contactLabel = document.createElement('h3');
  contactLabel.textContent = 'Contact';
  
  const contactValue = document.createElement('p');
  if (message.Contact) {
    contactValue.textContent = `${message.Contact.name || ''} ${message.Contact.surname || ''} (${message.Contact.phoneNumber})`;
  } else {
    contactValue.textContent = message.phoneNumber || 'Unknown';
  }
  
  contactInfo.appendChild(contactLabel);
  contactInfo.appendChild(contactValue);
  
  // Template info
  const templateInfo = document.createElement('div');
  templateInfo.className = 'detail-group';
  
  const templateLabel = document.createElement('h3');
  templateLabel.textContent = 'Template';
  
  const templateValue = document.createElement('p');
  templateValue.textContent = message.templateNameSnapshot || (message.Template ? message.Template.name : 'Unknown');
  
  templateInfo.appendChild(templateLabel);
  templateInfo.appendChild(templateValue);
  
  // Message content
  const contentInfo = document.createElement('div');
  contentInfo.className = 'detail-group';
  
  const contentLabel = document.createElement('h3');
  contentLabel.textContent = 'Message Content';
  
  const contentValue = document.createElement('div');
  contentValue.className = 'message-content';
  
  // Always use content snapshot, never the current template content
  if (message.contentSnapshot) {
    contentValue.innerHTML = message.contentSnapshot;
  } else {
    contentValue.textContent = 'No content available';
  }
  
  contentInfo.appendChild(contentLabel);
  contentInfo.appendChild(contentValue);
  
  // Image preview
  let imageInfo = null;
  if (message.imagePathSnapshot) {
    imageInfo = document.createElement('div');
    imageInfo.className = 'detail-group';
    
    const imageLabel = document.createElement('h3');
    imageLabel.textContent = 'Attached Image';
    
    const imageValue = document.createElement('div');
    imageValue.className = 'message-image';
    
    const image = document.createElement('img');
    image.src = message.imagePathSnapshot;
    image.alt = 'Message image';
    image.style.maxWidth = '100%';
    image.style.maxHeight = '200px';
    
    imageValue.appendChild(image);
    
    imageInfo.appendChild(imageLabel);
    imageInfo.appendChild(imageValue);
  }
  
  // Status info
  const statusInfo = document.createElement('div');
  statusInfo.className = 'detail-group';
  
  const statusLabel = document.createElement('h3');
  statusLabel.textContent = 'Status';
  
  const statusValue = document.createElement('div');
  const statusBadge = document.createElement('span');
  statusBadge.className = 'status-badge';
  statusBadge.textContent = message.status;
  statusBadge.style.backgroundColor = statusColors[message.status] || '#999';
  statusValue.appendChild(statusBadge);
  
  statusInfo.appendChild(statusLabel);
  statusInfo.appendChild(statusValue);
  
  // Timing info
  const timingInfo = document.createElement('div');
  timingInfo.className = 'detail-group';
  
  const timingLabel = document.createElement('h3');
  timingLabel.textContent = 'Timing Information';
  
  const timingValue = document.createElement('div');
  timingValue.className = 'timing-info';
  
  const scheduleDate = new Date(message.scheduledTime);
  
  let timingHTML = `<p><strong>Scheduled:</strong> ${formatDateTime(scheduleDate)}</p>`;
  
  // For sent status, use the updatedAt as a sent time approximation
  if (message.status === 'SENT' || message.status === 'DELIVERED' || message.status === 'READ') {
    const sentDate = new Date(message.updatedAt);
    timingHTML += `<p><strong>Sent:</strong> ${formatDateTime(sentDate)}</p>`;
  }
  
  if (message.deliveredTime) {
    const deliveredDate = new Date(message.deliveredTime);
    timingHTML += `<p><strong>Delivered:</strong> ${formatDateTime(deliveredDate)}</p>`;
  }
  
  if (message.readTime) {
    const readDate = new Date(message.readTime);
    timingHTML += `<p><strong>Read:</strong> ${formatDateTime(readDate)}</p>`;
  }
  
  timingValue.innerHTML = timingHTML;
  
  timingInfo.appendChild(timingLabel);
  timingInfo.appendChild(timingValue);
  
  // Error info
  let errorInfo = null;
  if (message.status === 'FAILED' && message.errorMessage) {
    errorInfo = document.createElement('div');
    errorInfo.className = 'detail-group error-group';
    
    const errorLabel = document.createElement('h3');
    errorLabel.textContent = 'Error Information';
    
    const errorValue = document.createElement('p');
    errorValue.textContent = message.errorMessage;
    errorValue.style.color = '#f44336';
    
    errorInfo.appendChild(errorLabel);
    errorInfo.appendChild(errorValue);
  }
  
  // Add all sections to body
  body.appendChild(contactInfo);
  body.appendChild(templateInfo);
  body.appendChild(contentInfo);
  if (imageInfo) body.appendChild(imageInfo);
  body.appendChild(statusInfo);
  body.appendChild(timingInfo);
  if (errorInfo) body.appendChild(errorInfo);
  
  // Create footer with actions
  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  
  // Add action buttons based on status
  if (message.status === 'SCHEDULED' || message.status === 'PENDING') {
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'danger-btn';
    cancelBtn.textContent = 'Cancel Message';
    cancelBtn.addEventListener('click', async () => {
      await cancelMessage(message.id);
      document.body.removeChild(modal);
    });
    footer.appendChild(cancelBtn);
  }
  
  if (message.status === 'FAILED') {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'primary-btn';
    retryBtn.textContent = 'Retry Message';
    retryBtn.addEventListener('click', async () => {
      await retryMessage(message.id);
      document.body.removeChild(modal);
    });
    footer.appendChild(retryBtn);
  }
  
  const closeButton = document.createElement('button');
  closeButton.className = 'secondary-btn';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  footer.appendChild(closeButton);
  
  // Assemble modal
  modalContent.appendChild(header);
  modalContent.appendChild(body);
  modalContent.appendChild(footer);
  modal.appendChild(modalContent);
  
  // Add close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
  
  // Add to body
  document.body.appendChild(modal);
}

/**
 * Update the status of a message in the UI
 * @param {Object} update - Status update object
 */
export function updateMessageStatus(update) {
  if (!update || !update.externalId) {
    console.warn('Invalid status update received:', update);
    return;
  }
  
  console.log('Message status update received:', update);
  
  // Find the message element by externalId
  const messageElement = document.querySelector(`.message-card[data-external-id="${update.externalId}"]`);
  
  // Update the status in the messages array too
  const messageIndex = messages.findIndex(m => m.externalId === update.externalId);
  if (messageIndex !== -1) {
    messages[messageIndex].status = update.status;
    
    // Add timestamp if provided
    if (update.timestamp) {
      messages[messageIndex].updatedAt = update.timestamp;
    }
  }
  
  if (!messageElement) {
    console.log('Message element not found for:', update.externalId);
    // Message might not be displayed yet, refresh the view
    renderMessages();
    return;
  }
  
  // Update the status text
  const statusElement = messageElement.querySelector('.message-status');
  if (statusElement) {
    statusElement.textContent = update.status;
    statusElement.className = 'message-status ' + update.status.toLowerCase();
  }
  
  // Update the status icon
  const statusIconElement = messageElement.querySelector('.status-icon');
  if (statusIconElement) {
    // Update the icon based on status
    let iconClass = 'fa-clock';
    
    switch(update.status) {
      case 'SENT':
        iconClass = 'fa-check';
        break;
      case 'DELIVERED':
      case 'DELIVERED_TO_SERVER':
        iconClass = 'fa-check-double';
        break;
      case 'READ':
        iconClass = 'fa-check-double read';
        break;
      case 'FAILED':
        iconClass = 'fa-times';
        break;
      case 'PENDING':
        iconClass = 'fa-clock';
        break;
      case 'SCHEDULED':
        iconClass = 'fa-calendar';
        break;
      case 'CANCELED':
        iconClass = 'fa-ban';
        break;
    }
    
    statusIconElement.className = 'status-icon fas ' + iconClass;
  }
  
  // Update timestamp if provided
  if (update.timestamp) {
    const timeElement = messageElement.querySelector('.message-time[data-update-type="status"]');
    if (timeElement) {
      const time = new Date(update.timestamp);
      timeElement.textContent = `${time.toLocaleDateString()} ${time.toLocaleTimeString()}`;
      timeElement.title = `Status updated at: ${time.toLocaleString()}`;
    }
  }
  
  // If this is a final status (DELIVERED, READ, FAILED), update UI accordingly
  if (['DELIVERED', 'READ', 'FAILED'].includes(update.status)) {
    messageElement.classList.add('status-final');
  }
  
  // Update the card class based on the new status
  messageElement.className = `message-card ${update.status.toLowerCase()}`;
}

/**
 * Set up event listeners for message card buttons
 */
function setupMessageCardButtons() {
  // Cancel buttons
  document.querySelectorAll('.cancel-btn').forEach(button => {
    const messageId = button.dataset.id;
    button.addEventListener('click', () => cancelMessage(messageId));
  });
  
  // Retry buttons
  document.querySelectorAll('.retry-btn').forEach(button => {
    const messageId = button.dataset.id;
    button.addEventListener('click', () => retryMessage(messageId));
  });
  
  // View buttons
  document.querySelectorAll('.view-btn').forEach(button => {
    const messageId = button.dataset.id;
    if (messageId) {
      button.addEventListener('click', () => {
        // Find the message by ID, safely handling potential type mismatches
        const message = messages.find(m => {
          if (!m || !m.id) return false;
          return String(m.id) === String(messageId);
        });
        
        if (message) {
          viewMessageDetails(message);
        } else {
          console.warn(`Message with ID ${messageId} not found in messages array`);
        }
      });
    }
  });
}

/**
 * Set up real-time message status updates
 */
function setupMessageStatusUpdates() {
  // Listen for message status updates from the main process
  window.api.on('message-status-update', (update) => {
    console.log('Message status update received:', update);
    updateMessageStatus(update);
  });
  
  // Listen for new messages being sent
  window.api.on('message-sent', (message) => {
    console.log('Message sent notification received:', message);
    
    // Check if the message is already in our list
    const exists = messages.some(m => m.id === message.id);
    
    if (!exists) {
      // Add the new message to our list
      messages.unshift(message);
      // Refresh the display
      renderMessages();
    } else {
      // Just update the status
      updateMessageStatus({
        externalId: message.externalId,
        status: message.status,
        timestamp: message.updatedAt || new Date()
      });
    }
  });
} 