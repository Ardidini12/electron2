/**
 * Sales Messages Module
 * Handles sales message settings, templates, and scheduled messages
 */
import { showNotification } from '../../utils/notifications.js';

// Caching DOM elements
let elements = {};
let templates = { FIRST: null, SECOND: null };
let settings = null;
let currentActiveTab = 'first-message';

// Track selected messages
let selectedMessages = new Set();

/**
 * Initialize the sales messages module
 */
export async function initSalesMessages() {
  console.log('Initializing sales messages module');
  
  try {
    // Cache DOM elements
    cacheElements();
    
    // Setup event listeners
    setupEventListeners();
    
    // Setup message status updates
    setupMessageStatusUpdates();
    
    // Load sales message settings
    await loadSalesMessageSettings();
    
    // Load sales message templates
    await loadSalesMessageTemplates();
    
    // Setup periodic refresh of scheduled messages
    setInterval(loadScheduledMessages, 60000); // Refresh every minute
    
    console.log('Sales messages module initialized successfully');
    return true;
  } catch (error) {
    console.error('Error initializing sales messages module:', error);
    showNotification('Failed to initialize sales messages: ' + error.message, 'error');
    return false;
  }
}

/**
 * Cache DOM elements for better performance
 */
function cacheElements() {
  elements = {
    // Tabs
    templatesTab: document.getElementById('templates-tab'),
    messagesTab: document.getElementById('messages-tab'),
    
    // Sales message settings
    salesMessageSettings: document.getElementById('sales-message-settings'),
    firstMessageDelay: document.getElementById('first-message-delay'),
    firstMessageDelayUnit: document.getElementById('first-message-delay-unit'),
    secondMessageDelay: document.getElementById('second-message-delay'),
    secondMessageDelayUnit: document.getElementById('second-message-delay-unit'),
    autoSchedulingEnabled: document.getElementById('auto-scheduling-enabled'),
    autoSendingEnabled: document.getElementById('auto-sending-enabled'),
    saveSettingsBtn: document.getElementById('save-sales-message-settings'),
    
    // Template tabs
    templateTabs: document.querySelectorAll('.template-tab'),
    templateContent: document.querySelectorAll('.template-pane'),
    
    // First message template
    firstMessageTab: document.getElementById('first-message-tab'),
    firstMessagePane: document.getElementById('first-message-pane'),
    firstMessageContent: document.getElementById('first-message-content'),
    firstMessageImage: document.getElementById('first-message-image'),
    firstMessageSelectImageBtn: document.getElementById('first-message-select-image'),
    firstMessageRemoveImageBtn: document.getElementById('first-message-remove-image'),
    firstMessageImagePreview: document.getElementById('first-message-image-preview'),
    saveFirstMessageTemplateBtn: document.getElementById('save-first-message-template'),
    
    // Second message template
    secondMessageTab: document.getElementById('second-message-tab'),
    secondMessagePane: document.getElementById('second-message-pane'),
    secondMessageContent: document.getElementById('second-message-content'),
    secondMessageImage: document.getElementById('second-message-image'),
    secondMessageSelectImageBtn: document.getElementById('second-message-select-image'),
    secondMessageRemoveImageBtn: document.getElementById('second-message-remove-image'),
    secondMessageImagePreview: document.getElementById('second-message-image-preview'),
    saveSecondMessageTemplateBtn: document.getElementById('save-second-message-template'),
    
    // Scheduled messages
    processPendingMessagesBtn: document.getElementById('process-pending-messages'),
    salesMessagesTable: document.getElementById('sales-messages-table'),
    salesMessagesBody: document.getElementById('sales-messages-tbody'),
    
    // Filters
    salesMessageStatusFilter: document.getElementById('sales-message-status-filter'),
    salesMessageSequenceFilter: document.getElementById('sales-message-sequence-filter'),
    
    // Select all and delete buttons
    selectAllMessagesCheckbox: document.getElementById('select-all-sales-messages'),
    deleteSelectedMessagesBtn: document.getElementById('delete-selected-sales-messages'),
    deleteAllMessagesBtn: document.getElementById('delete-all-sales-messages')
  };
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Settings
  if (elements.saveSettingsBtn) {
    elements.saveSettingsBtn.addEventListener('click', saveSalesMessageSettings);
  }
  
  // Setup toggle switch event handlers explicitly
  if (elements.autoSchedulingEnabled) {
    // Direct handler for the checkbox itself
    elements.autoSchedulingEnabled.addEventListener('change', (e) => {
      console.log('Auto scheduling toggle changed:', e.target.checked);
    });
    
    // Add parent click handler for better touch support
    const autoSchedulingParent = elements.autoSchedulingEnabled.closest('.toggle-switch');
    if (autoSchedulingParent) {
      // Remove existing listeners to prevent duplicates
      const newParent = autoSchedulingParent.cloneNode(true);
      autoSchedulingParent.parentNode.replaceChild(newParent, autoSchedulingParent);
      
      // Get the new checkbox reference
      elements.autoSchedulingEnabled = newParent.querySelector('input[type="checkbox"]');
      
      // Add new event listener
      elements.autoSchedulingEnabled.addEventListener('change', (e) => {
        console.log('Auto scheduling toggle changed:', e.target.checked);
      });
      
      // Make toggle clickable with better styling
      newParent.style.position = 'relative';
      newParent.style.zIndex = '10';
      newParent.style.pointerEvents = 'auto';
      
      // Add manual click handler that toggles the checkbox
      newParent.addEventListener('click', (e) => {
        if (e.target !== elements.autoSchedulingEnabled) {
          elements.autoSchedulingEnabled.checked = !elements.autoSchedulingEnabled.checked;
          
          // Trigger the change event
          const event = new Event('change', { bubbles: true });
          elements.autoSchedulingEnabled.dispatchEvent(event);
          
          e.preventDefault(); // Prevent default to avoid double toggling
        }
      });
    }
  }
  
  if (elements.autoSendingEnabled) {
    // Direct handler for the checkbox itself
    elements.autoSendingEnabled.addEventListener('change', (e) => {
      console.log('Auto sending toggle changed:', e.target.checked);
    });
    
    // Add parent click handler for better touch support
    const autoSendingParent = elements.autoSendingEnabled.closest('.toggle-switch');
    if (autoSendingParent) {
      // Remove existing listeners to prevent duplicates
      const newParent = autoSendingParent.cloneNode(true);
      autoSendingParent.parentNode.replaceChild(newParent, autoSendingParent);
      
      // Get the new checkbox reference
      elements.autoSendingEnabled = newParent.querySelector('input[type="checkbox"]');
      
      // Add new event listener
      elements.autoSendingEnabled.addEventListener('change', (e) => {
        console.log('Auto sending toggle changed:', e.target.checked);
      });
      
      // Make toggle clickable with better styling
      newParent.style.position = 'relative';
      newParent.style.zIndex = '10';
      newParent.style.pointerEvents = 'auto';
      
      // Add manual click handler that toggles the checkbox
      newParent.addEventListener('click', (e) => {
        if (e.target !== elements.autoSendingEnabled) {
          elements.autoSendingEnabled.checked = !elements.autoSendingEnabled.checked;
          
          // Trigger the change event
          const event = new Event('change', { bubbles: true });
          elements.autoSendingEnabled.dispatchEvent(event);
          
          e.preventDefault(); // Prevent default to avoid double toggling
        }
      });
    }
  }
  
  // Template tabs
  if (elements.templateTabs) {
    elements.templateTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        switchTemplateTab(tab.dataset.tab);
      });
    });
  }
  
  // First message template
  if (elements.saveFirstMessageTemplateBtn) {
    elements.saveFirstMessageTemplateBtn.addEventListener('click', () => {
      saveMessageTemplate('FIRST');
    });
  }
  
  if (elements.firstMessageSelectImageBtn) {
    elements.firstMessageSelectImageBtn.addEventListener('click', () => {
      selectTemplateImage('FIRST');
    });
  }
  
  if (elements.firstMessageRemoveImageBtn) {
    elements.firstMessageRemoveImageBtn.addEventListener('click', () => {
      removeTemplateImage('FIRST');
    });
  }
  
  // Second message template
  if (elements.saveSecondMessageTemplateBtn) {
    elements.saveSecondMessageTemplateBtn.addEventListener('click', () => {
      saveMessageTemplate('SECOND');
    });
  }
  
  if (elements.secondMessageSelectImageBtn) {
    elements.secondMessageSelectImageBtn.addEventListener('click', () => {
      selectTemplateImage('SECOND');
    });
  }
  
  if (elements.secondMessageRemoveImageBtn) {
    elements.secondMessageRemoveImageBtn.addEventListener('click', () => {
      removeTemplateImage('SECOND');
    });
  }
  
  // Process pending messages
  if (elements.processPendingMessagesBtn) {
    elements.processPendingMessagesBtn.addEventListener('click', processPendingMessages);
  }
  
  // Filters
  if (elements.salesMessageStatusFilter) {
    elements.salesMessageStatusFilter.addEventListener('change', loadScheduledMessages);
  }
  
  if (elements.salesMessageSequenceFilter) {
    elements.salesMessageSequenceFilter.addEventListener('change', loadScheduledMessages);
  }
  
  // Load scheduled messages on page load
  loadScheduledMessages();
  
  // Add event listener for select all checkbox
  if (elements.selectAllMessagesCheckbox) {
    elements.selectAllMessagesCheckbox.addEventListener('change', toggleSelectAllMessages);
  }
  
  // Add event listener for delete selected messages button
  if (elements.deleteSelectedMessagesBtn) {
    elements.deleteSelectedMessagesBtn.addEventListener('click', () => {
      confirmDeleteMultipleMessages('selected');
    });
  }
  
  // Add event listener for delete all messages button if it exists
  const deleteAllMessagesBtn = document.getElementById('delete-all-sales-messages');
  if (deleteAllMessagesBtn) {
    deleteAllMessagesBtn.addEventListener('click', () => {
      confirmDeleteMultipleMessages('all');
    });
  }
}

/**
 * Load sales message settings from the backend
 */
async function loadSalesMessageSettings() {
  try {
    console.log('Loading sales message settings');
    const response = await window.api.getSalesMessageSettings();
    
    if (!response || response.error) {
      throw new Error(response?.error || 'Failed to load sales message settings');
    }
    
    // Save settings globally
    settings = response;
    console.log('Loaded settings:', settings);
    
    // Update UI
    updateSettingsUI();
    
    return settings;
  } catch (error) {
    console.error('Error loading sales message settings:', error);
    showNotification('Failed to load sales message settings: ' + error.message, 'error');
    return null;
  }
}

/**
 * Save sales message settings to the backend
 */
async function saveSalesMessageSettings() {
  try {
    // Disable the save button
    if (elements.saveSettingsBtn) {
      elements.saveSettingsBtn.disabled = true;
      elements.saveSettingsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }
    
    // Collect data from UI with safer parsing
    // Use defaults if parsing fails
    let firstMessageDelayValue = 2; // Default: 2 hours
    let firstMessageDelayUnit = 3600000; // Default: hours in milliseconds
    let secondMessageDelayValue = 6; // Default: 6 months
    let secondMessageDelayUnit = 2592000000; // Default: months in milliseconds
    
    // Parse values with fallbacks
    try {
      const parsedFirstValue = parseInt(elements.firstMessageDelayValue?.value);
      if (!isNaN(parsedFirstValue) && parsedFirstValue > 0) {
        firstMessageDelayValue = parsedFirstValue;
      }
    } catch (e) {
      console.warn('Error parsing first message delay value, using default', e);
    }
    
    try {
      const parsedFirstUnit = parseInt(elements.firstMessageDelayUnit?.value);
      if (!isNaN(parsedFirstUnit) && parsedFirstUnit > 0) {
        firstMessageDelayUnit = parsedFirstUnit;
      }
    } catch (e) {
      console.warn('Error parsing first message delay unit, using default', e);
    }
    
    try {
      const parsedSecondValue = parseInt(elements.secondMessageDelayValue?.value);
      if (!isNaN(parsedSecondValue) && parsedSecondValue > 0) {
        secondMessageDelayValue = parsedSecondValue;
      }
    } catch (e) {
      console.warn('Error parsing second message delay value, using default', e);
    }
    
    try {
      const parsedSecondUnit = parseInt(elements.secondMessageDelayUnit?.value);
      if (!isNaN(parsedSecondUnit) && parsedSecondUnit > 0) {
        secondMessageDelayUnit = parsedSecondUnit;
      }
    } catch (e) {
      console.warn('Error parsing second message delay unit, using default', e);
    }
    
    const firstMessageDelay = firstMessageDelayValue * firstMessageDelayUnit;
    const secondMessageDelay = secondMessageDelayValue * secondMessageDelayUnit;
    
    // Get checkbox values directly from the DOM elements
    // Use strict boolean conversion to ensure proper type
    const isAutoSchedulingEnabled = elements.autoSchedulingEnabled?.checked === true;
    const isAutoSendingEnabled = elements.autoSendingEnabled?.checked === true;
    
    console.log('Checkbox values before saving:', {
      autoSchedulingChecked: elements.autoSchedulingEnabled?.checked,
      autoSendingChecked: elements.autoSendingEnabled?.checked,
      isAutoSchedulingEnabled: isAutoSchedulingEnabled,
      isAutoSendingEnabled: isAutoSendingEnabled
    });
    
    // Prepare settings data
    const settingsData = {
      firstMessageDelay,
      secondMessageDelay,
      isAutoSchedulingEnabled,
      isAutoSendingEnabled
    };
    
    console.log('Saving settings:', settingsData);
    
    // Send to backend
    const response = await window.api.updateSalesMessageSettings(settingsData);
    
    if (!response || response.error) {
      throw new Error(response?.error || 'Failed to save sales message settings');
    }
    
    // Update local settings - handle both object formats
    if (response.settings) {
      settings = response.settings;
    } else {
      settings = response;
    }
    
    console.log('Settings saved successfully:', settings);
    
    // Update UI with the values that were actually saved
    updateSettingsUI();
    
    showNotification('Sales message settings saved successfully', 'success');
    
    return true;
  } catch (error) {
    console.error('Error saving sales message settings:', error);
    showNotification('Failed to save sales message settings: ' + error.message, 'error');
    return false;
  } finally {
    // Re-enable the save button
    if (elements.saveSettingsBtn) {
      elements.saveSettingsBtn.disabled = false;
      elements.saveSettingsBtn.innerHTML = '<i class="fas fa-save"></i> Save Settings';
    }
  }
}

/**
 * Update the settings UI with current values
 */
function updateSettingsUI() {
  if (!settings) return;
  
  console.log('Updating settings UI with:', settings);
  
  // Extract actual values from the settings object (handle both direct and Sequelize objects)
  const settingsData = settings.dataValues ? settings.dataValues : settings;
  
  // First message delay
  if (elements.firstMessageDelayValue && elements.firstMessageDelayUnit) {
    // Find the best unit to display the delay
    let value = 2; // Default value
    let unit = 3600000; // Default unit (hours)
    
    // Ensure the delay is a valid number
    const firstDelay = parseInt(settingsData.firstMessageDelay);
    
    if (!isNaN(firstDelay) && firstDelay > 0) {
      if (firstDelay % 2592000000 === 0) {
        // Display in months
        value = firstDelay / 2592000000;
        unit = 2592000000;
      } else if (firstDelay % 604800000 === 0) {
        // Display in weeks
        value = firstDelay / 604800000;
        unit = 604800000;
      } else if (firstDelay % 86400000 === 0) {
        // Display in days
        value = firstDelay / 86400000;
        unit = 86400000;
      } else if (firstDelay % 3600000 === 0) {
        // Display in hours
        value = firstDelay / 3600000;
        unit = 3600000;
      } else if (firstDelay % 60000 === 0) {
        // Display in minutes
        value = firstDelay / 60000;
        unit = 60000;
      } else if (firstDelay % 1000 === 0) {
        // Display in seconds
        value = firstDelay / 1000;
        unit = 1000;
      } else {
        // Default to hours for odd values
        value = Math.max(1, Math.round(firstDelay / 3600000));
        unit = 3600000;
      }
    }
    
    elements.firstMessageDelayValue.value = value;
    elements.firstMessageDelayUnit.value = unit;
  }
  
  // Second message delay
  if (elements.secondMessageDelayValue && elements.secondMessageDelayUnit) {
    // Find the best unit to display the delay
    let value = 6; // Default value
    let unit = 2592000000; // Default unit (months)
    
    // Ensure the delay is a valid number
    const secondDelay = parseInt(settingsData.secondMessageDelay);
    
    if (!isNaN(secondDelay) && secondDelay > 0) {
      if (secondDelay % 2592000000 === 0) {
        // Display in months
        value = secondDelay / 2592000000;
        unit = 2592000000;
      } else if (secondDelay % 604800000 === 0) {
        // Display in weeks
        value = secondDelay / 604800000;
        unit = 604800000;
      } else if (secondDelay % 86400000 === 0) {
        // Display in days
        value = secondDelay / 86400000;
        unit = 86400000;
      } else if (secondDelay % 3600000 === 0) {
        // Display in hours
        value = secondDelay / 3600000;
        unit = 3600000;
      } else if (secondDelay % 60000 === 0) {
        // Display in minutes
        value = secondDelay / 60000;
        unit = 60000;
      } else if (secondDelay % 1000 === 0) {
        // Display in seconds
        value = secondDelay / 1000;
        unit = 1000;
      } else {
        // Default to months for odd values
        value = Math.max(1, Math.round(secondDelay / 2592000000));
        unit = 2592000000;
      }
    }
    
    elements.secondMessageDelayValue.value = value;
    elements.secondMessageDelayUnit.value = unit;
  }
  
  // Auto-scheduling toggle - fix checkbox state
  if (elements.autoSchedulingEnabled) {
    console.log('Setting auto-scheduling toggle to:', Boolean(settingsData.isAutoSchedulingEnabled));
    elements.autoSchedulingEnabled.checked = Boolean(settingsData.isAutoSchedulingEnabled);
    
    // Ensure the toggle is clickable - fix any z-index issues
    const autoSchedulingParent = elements.autoSchedulingEnabled.closest('.toggle-switch');
    if (autoSchedulingParent) {
      autoSchedulingParent.style.position = 'relative';
      autoSchedulingParent.style.zIndex = '10';
      autoSchedulingParent.style.pointerEvents = 'auto';
    }
  }
  
  // Auto-sending toggle - fix checkbox state
  if (elements.autoSendingEnabled) {
    console.log('Setting auto-sending toggle to:', Boolean(settingsData.isAutoSendingEnabled));
    elements.autoSendingEnabled.checked = Boolean(settingsData.isAutoSendingEnabled);
    
    // Ensure the toggle is clickable - fix any z-index issues
    const autoSendingParent = elements.autoSendingEnabled.closest('.toggle-switch');
    if (autoSendingParent) {
      autoSendingParent.style.position = 'relative';
      autoSendingParent.style.zIndex = '10';
      autoSendingParent.style.pointerEvents = 'auto';
    }
  }
}

/**
 * Load sales message templates from the backend
 */
async function loadSalesMessageTemplates() {
  try {
    console.log('Loading sales message templates');
    const response = await window.api.getSalesMessageTemplates();
    
    if (!response || response.error) {
      throw new Error(response?.error || 'Failed to load sales message templates');
    }
    
    // Store templates in a more accessible way
    templates = {
      FIRST: response.templates.find(t => t.messageType === 'FIRST') || null,
      SECOND: response.templates.find(t => t.messageType === 'SECOND') || null
    };
    
    console.log('Loaded templates:', templates);
    
    // Update the UI with loaded templates
    updateTemplatesUI();
    
    return templates;
  } catch (error) {
    console.error('Error loading sales message templates:', error);
    showNotification('Failed to load message templates: ' + error.message, 'error');
    
    // Initialize empty templates if needed
    templates = templates || { FIRST: null, SECOND: null };
    
    return templates;
  }
}

/**
 * Switch between template tabs
 * @param {string} tabName - Tab name to switch to
 */
function switchTemplateTab(tabName) {
  if (!tabName) return;
  
  currentActiveTab = tabName;
  
  // Update tab buttons
  elements.templateTabs.forEach(tab => {
    if (tab.dataset.tab === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
  
  // Update tab panes
  elements.templateContent.forEach(pane => {
    if (pane.id === `${tabName}-pane`) {
      pane.classList.add('active');
    } else {
      pane.classList.remove('active');
    }
  });
}

/**
 * Update templates UI with current template data
 */
function updateTemplatesUI() {
  // Update First Message template UI
  if (elements.firstMessageContent && templates.FIRST) {
    elements.firstMessageContent.value = templates.FIRST.content || '';
  }
  
  // Update Second Message template UI
  if (elements.secondMessageContent && templates.SECOND) {
    elements.secondMessageContent.value = templates.SECOND.content || '';
  }
}

/**
 * Save a message template
 * @param {string} type - Message type (FIRST or SECOND)
 */
async function saveMessageTemplate(type) {
  try {
    console.log(`Saving ${type} message template`);
    
    // Get appropriate content element based on type
    const contentElement = type === 'FIRST' 
      ? elements.firstMessageContent
      : elements.secondMessageContent;
      
    if (!contentElement) {
      throw new Error(`Content element not found for ${type} message`);
    }
    
    // Get content
    const content = contentElement.value.trim();
    
    // Validate content
    if (!content) {
      throw new Error('Message content cannot be empty');
    }
    
    // Show loading state
    const saveButton = type === 'FIRST'
      ? elements.saveFirstMessageTemplateBtn
      : elements.saveSecondMessageTemplateBtn;
      
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }
    
    // Send to backend - removing image support
    const templateData = {
      content
    };
    
    const result = await window.api.updateSalesMessageTemplate(type, templateData);
    
    if (!result || !result.success) {
      throw new Error(result?.error || 'Failed to save template');
    }
    
    // Show success notification
    showNotification(`${type} message template saved successfully`, 'success');
    
    // Restore button state
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.innerHTML = '<i class="fas fa-save"></i> Save Template';
    }
    
    console.log(`${type} message template saved:`, result);
    
    // Return the result
    return result;
  } catch (error) {
    console.error(`Error saving ${type} message template:`, error);
    showNotification(`Error: ${error.message}`, 'error');
    
    // Restore button state for the appropriate button
    const saveButton = type === 'FIRST'
      ? elements.saveFirstMessageTemplateBtn
      : elements.saveSecondMessageTemplateBtn;
      
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.innerHTML = '<i class="fas fa-save"></i> Save Template';
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Select template image
 * @param {string} type - Template type (FIRST or SECOND)
 */
function selectTemplateImage(type) {
  // Implementation of selectTemplateImage function
}

/**
 * Remove template image
 * @param {string} type - Template type (FIRST or SECOND)
 */
function removeTemplateImage(type) {
  // Implementation of removeTemplateImage function
}

/**
 * Process pending messages
 */
async function processPendingMessages() {
  try {
    // Disable the button
    if (elements.processPendingMessagesBtn) {
      elements.processPendingMessagesBtn.disabled = true;
      elements.processPendingMessagesBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    }
    
    console.log('Processing pending sales messages...');
    const response = await window.api.processPendingSalesMessages();
    
    if (!response || response.error) {
      throw new Error(response?.error || 'Failed to process pending sales messages');
    }
    
    console.log('Process pending messages response:', response);
    
    // Show notification based on result
    if (response.processed > 0) {
      showNotification(`Successfully processed ${response.processed} sales message(s)`, 'success');
      
      // If we have errors, show them too
      if (response.errors > 0) {
        showNotification(`${response.errors} message(s) failed to send`, 'warning');
      }
    } else if (response.reason === 'WhatsApp not connected') {
      // Special case for WhatsApp not connected
      showNotification('WhatsApp is not connected. Please connect WhatsApp before sending messages.', 'error');
    } else if (response.reason) {
      // Show information about why no messages were processed
      showNotification(`No messages processed: ${response.reason}`, 'info');
    } else if (response.error) {
      // Show error
      showNotification(`Error processing messages: ${response.error}`, 'error');
    } else {
      // Generic message if no details available
      showNotification('No pending messages to process', 'info');
    }
    
    // Refresh the messages list
    loadScheduledMessages();
    
    return true;
  } catch (error) {
    console.error('Error processing pending messages:', error);
    showNotification(`Failed to process pending messages: ${error.message}`, 'error');
    return false;
  } finally {
    // Re-enable the button
    if (elements.processPendingMessagesBtn) {
      elements.processPendingMessagesBtn.disabled = false;
      elements.processPendingMessagesBtn.innerHTML = '<i class="fas fa-play"></i> Process Pending';
    }
  }
}

/**
 * Load scheduled messages
 */
async function loadScheduledMessages() {
  try {
    console.log('Loading scheduled sales messages');
    
    // Get status filter if available
    const statusFilter = elements.salesMessageStatusFilter ? elements.salesMessageStatusFilter.value : null;
    const sequenceFilter = elements.salesMessageSequenceFilter ? elements.salesMessageSequenceFilter.value : null;
    
    console.log(`Filters applied - Status: ${statusFilter || 'All'}, Sequence: ${sequenceFilter || 'All'}`);
    
    // Get messages from backend (page 1, limit 100)
    const response = await window.api.getScheduledSalesMessages(1, 100, statusFilter);
    
    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to load scheduled messages');
    }
    
    const { messages, pagination } = response;
    console.log(`Loaded ${messages.length} scheduled messages, total: ${pagination.total}`);
    
    // Get messages container - CORRECTED ID
    const messagesContainer = document.getElementById('sales-messages-tbody');
    if (!messagesContainer) {
      console.error('Sales scheduled messages container not found');
      return;
    }
    
    // Clear existing messages
    messagesContainer.innerHTML = '';
    
    // Filter messages by sequence if needed
    let filteredMessages = messages;
    if (sequenceFilter) {
      filteredMessages = messages.filter(message => message.messageSequence === sequenceFilter);
      console.log(`Filtered to ${filteredMessages.length} ${sequenceFilter} messages`);
    }
    
    // Check if there are any messages
    if (filteredMessages.length === 0) {
      messagesContainer.innerHTML = `
        <tr>
          <td colspan="8" class="empty-state">
            <div class="messages-empty-state">
              <i class="fas fa-inbox"></i>
              <p>No scheduled messages found</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }
    
    // Sort messages by scheduled time
    filteredMessages.sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));
    
    // Create message rows
    filteredMessages.forEach(message => {
      const contact = message.SalesContact || {};
      const scheduledTime = new Date(message.scheduledTime);
      const sentTime = message.sentTime ? new Date(message.sentTime) : null;
      
      // Format phone number for display
      const phoneNumber = contact.phoneNumber || 'Unknown';
      const formattedPhone = phoneNumber.replace(/^\+/, ''); // Remove leading +
      
      // Create a table row for the message
      const messageRow = document.createElement('tr');
      messageRow.className = `message-row ${message.status.toLowerCase()}`;
      messageRow.dataset.id = message.id;
      
      // Add externalId to dataset if it exists
      if (message.externalId) {
        messageRow.dataset.externalId = message.externalId;
      }
      
      messageRow.innerHTML = `
        <td>
          <input type="checkbox" class="select-message" data-id="${message.id}">
        </td>
        <td>${contact.name || 'Unknown'}</td>
        <td>${formattedPhone}</td>
        <td><span class="badge ${message.messageSequence}">${message.messageSequence}</span></td>
        <td><span class="badge status-${message.status.toLowerCase()}">${message.status}</span></td>
        <td>${scheduledTime.toLocaleString()}</td>
        <td>${sentTime ? sentTime.toLocaleString() : '-'}</td>
        <td>
          <button class="action-btn view-message" data-id="${message.id}" title="View Message">
            <i class="fas fa-eye"></i>
          </button>
          <button class="action-btn delete-message" data-id="${message.id}" title="Delete Message">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      `;
      
      // Add message row to container
      messagesContainer.appendChild(messageRow);
    });
    
    console.log(`Rendered ${filteredMessages.length} message rows`);
    
    // Add click event to view message buttons
    const viewButtons = messagesContainer.querySelectorAll('.view-message');
    viewButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const messageId = button.dataset.id;
        viewMessageDetails(messageId);
      });
    });
    
    // Add click event to delete message buttons
    const deleteButtons = messagesContainer.querySelectorAll('.delete-message');
    deleteButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const messageId = button.dataset.id;
        confirmDeleteMessage(messageId);
      });
    });
    
    // Clear selected messages when loading new data
    selectedMessages.clear();
    updateDeleteMessagesButton();
    
    // After adding message rows to container
    // Add click handlers for checkboxes
    setupMessageCheckboxListeners();
    
    return true;
  } catch (error) {
    console.error('Error loading scheduled messages:', error);
    // Show error in UI
    const messagesContainer = document.getElementById('sales-messages-tbody');
    if (messagesContainer) {
      messagesContainer.innerHTML = `
        <tr>
          <td colspan="8" class="empty-state">
            <div class="messages-empty-state error">
              <i class="fas fa-exclamation-triangle"></i>
              <p>Error loading messages: ${error.message}</p>
            </div>
          </td>
        </tr>
      `;
    }
    return false;
  }
}

/**
 * View message details
 * @param {string} messageId - Message ID
 */
function viewMessageDetails(messageId) {
  console.log(`Viewing details for message ${messageId}`);
  
  // Find the message in the table
  const messageRow = document.querySelector(`.message-row[data-id="${messageId}"]`);
  if (!messageRow) {
    showNotification('Error', 'Message not found', 'error');
    return;
  }
  
  // Get message details from the row
  const contactName = messageRow.cells[1].textContent;
  const phoneNumber = messageRow.cells[2].textContent;
  const messageType = messageRow.cells[3].querySelector('.badge').textContent;
  const status = messageRow.cells[4].querySelector('.badge').textContent;
  const scheduledTime = messageRow.cells[5].textContent;
  const sentTime = messageRow.cells[6].textContent;
  
  // Prepare modal content
  const modalContent = `
    <dl>
      <dt>Contact:</dt>
      <dd>${contactName}</dd>
      
      <dt>Phone:</dt>
      <dd>${phoneNumber}</dd>
      
      <dt>Type:</dt>
      <dd><span class="badge ${messageType}">${messageType}</span></dd>
      
      <dt>Status:</dt>
      <dd><span class="badge status-${status.toLowerCase()}">${status}</span></dd>
      
      <dt>Scheduled:</dt>
      <dd>${scheduledTime}</dd>
      
      <dt>Sent:</dt>
      <dd>${sentTime === '-' ? 'Not sent yet' : sentTime}</dd>
    </dl>
  `;
  
  // Set modal content
  const modalDetailsContainer = document.getElementById('sales-message-details');
  if (modalDetailsContainer) {
    modalDetailsContainer.innerHTML = modalContent;
    
    // Show the modal
    const modal = document.getElementById('view-sales-message-modal');
    if (modal) {
      modal.classList.add('visible');
      
      // Add event listener to close button
      const closeButtons = modal.querySelectorAll('.close-modal');
      closeButtons.forEach(button => {
        button.addEventListener('click', () => {
          modal.classList.remove('visible');
        });
      });
    }
  }
}

/**
 * Confirm deletion of a message
 * @param {string} messageId - Message ID
 */
function confirmDeleteMessage(messageId) {
  console.log(`Confirming deletion of message ${messageId}`);
  
  // Find the message in the table
  const messageRow = document.querySelector(`.message-row[data-id="${messageId}"]`);
  if (!messageRow) {
    showNotification('Error', 'Message not found', 'error');
    return;
  }
  
  // Get contact name from the row
  const contactName = messageRow.cells[1].textContent;
  const phoneNumber = messageRow.cells[2].textContent;
  
  // Set confirmation message
  const confirmMessage = document.getElementById('delete-sales-messages-message');
  if (confirmMessage) {
    confirmMessage.textContent = `Are you sure you want to delete the message for ${contactName} (${phoneNumber})?`;
  }
  
  // Show confirmation modal
  const modal = document.getElementById('delete-sales-messages-modal');
  if (modal) {
    modal.classList.add('visible');
    
    // Handle close button
    const closeButtons = modal.querySelectorAll('.close-modal');
    closeButtons.forEach(button => {
      button.addEventListener('click', () => {
        modal.classList.remove('visible');
      });
    });
    
    // Handle confirm button
    const confirmButton = document.getElementById('confirm-delete-sales-messages');
    if (confirmButton) {
      // Remove existing listeners
      const newConfirmButton = confirmButton.cloneNode(true);
      confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);
      
      // Add new listener
      newConfirmButton.addEventListener('click', async () => {
        try {
          // Disable button during deletion
          newConfirmButton.disabled = true;
          newConfirmButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
          
          // Delete the message
          const response = await window.api.deleteSalesMessages([messageId]);
          
          if (!response || !response.success) {
            throw new Error(response?.error || 'Failed to delete message');
          }
          
          // Show success notification
          showNotification('Success', 'Message deleted successfully', 'success');
          
          // Reload messages
          await loadScheduledMessages();
          
          // Close modal
          modal.classList.remove('visible');
        } catch (error) {
          console.error('Error deleting message:', error);
          showNotification('Error', `Failed to delete message: ${error.message}`, 'error');
        } finally {
          // Re-enable button
          newConfirmButton.disabled = false;
          newConfirmButton.innerHTML = 'Delete';
        }
      });
    }
  }
}

/**
 * Toggle select all messages
 */
function toggleSelectAllMessages() {
  if (!elements.selectAllMessagesCheckbox) return;
  
  const isChecked = elements.selectAllMessagesCheckbox.checked;
  console.log('Toggle select all messages:', isChecked);
  
  // Get all message checkboxes
  const checkboxes = document.querySelectorAll('.select-message');
  
  // Clear selected messages if unchecking all
  if (!isChecked) {
    selectedMessages.clear();
  }
  
  // Update all checkboxes
  checkboxes.forEach(checkbox => {
    checkbox.checked = isChecked;
    
    const id = parseInt(checkbox.dataset.id);
    if (isChecked) {
      selectedMessages.add(id);
    } else {
      selectedMessages.delete(id);
    }
    
    // Update row styling
    const row = checkbox.closest('tr');
    if (row) {
      if (isChecked) {
        row.classList.add('selected');
      } else {
        row.classList.remove('selected');
      }
    }
  });
  
  console.log(`Selected messages after toggle: ${selectedMessages.size}`);
  
  // Update the delete button state
  updateDeleteMessagesButton();
}

/**
 * Update the state of the select all checkbox
 */
function updateSelectAllCheckbox() {
  if (!elements.selectAllMessagesCheckbox) return;
  
  const checkboxes = document.querySelectorAll('.select-message');
  const checkedCount = document.querySelectorAll('.select-message:checked').length;
  
  if (checkboxes.length === 0) {
    elements.selectAllMessagesCheckbox.checked = false;
    elements.selectAllMessagesCheckbox.indeterminate = false;
  } else if (checkedCount === 0) {
    elements.selectAllMessagesCheckbox.checked = false;
    elements.selectAllMessagesCheckbox.indeterminate = false;
  } else if (checkedCount === checkboxes.length) {
    elements.selectAllMessagesCheckbox.checked = true;
    elements.selectAllMessagesCheckbox.indeterminate = false;
  } else {
    elements.selectAllMessagesCheckbox.checked = false;
    elements.selectAllMessagesCheckbox.indeterminate = true;
  }
}

/**
 * Update the state of the delete selected messages button
 */
function updateDeleteMessagesButton() {
  if (!elements.deleteSelectedMessagesBtn) return;
  elements.deleteSelectedMessagesBtn.disabled = selectedMessages.size === 0;
  
  // Update button text with count
  if (selectedMessages.size > 0) {
    elements.deleteSelectedMessagesBtn.textContent = `Delete Selected (${selectedMessages.size})`;
  } else {
    elements.deleteSelectedMessagesBtn.textContent = 'Delete Selected';
  }
}

/**
 * Setup message checkbox listeners
 */
function setupMessageCheckboxListeners() {
  const checkboxes = document.querySelectorAll('.select-message');
  
  checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      const id = parseInt(checkbox.dataset.id);
      
      if (checkbox.checked) {
        selectedMessages.add(id);
      } else {
        selectedMessages.delete(id);
      }
      
      // Update row styling
      const row = checkbox.closest('tr');
      if (row) {
        if (checkbox.checked) {
          row.classList.add('selected');
        } else {
          row.classList.remove('selected');
        }
      }
      
      // Update the select all checkbox state
      updateSelectAllCheckbox();
      
      // Update the delete button state
      updateDeleteMessagesButton();
    });
  });
}

/**
 * Confirm deletion of multiple messages
 * @param {string} type - Type of deletion ('selected' or 'all')
 */
function confirmDeleteMultipleMessages(type) {
  const modal = document.getElementById('delete-sales-messages-modal');
  const message = document.getElementById('delete-sales-messages-message');
  
  if (!modal || !message) return;
  
  // Clear any existing event listeners
  const closeButtons = modal.querySelectorAll('.close-modal');
  closeButtons.forEach(btn => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
  });
  
  const confirmBtn = document.getElementById('confirm-delete-sales-messages');
  if (confirmBtn) {
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    
    // Add event listener to the new confirm button
    const newConfirmBtnElement = document.getElementById('confirm-delete-sales-messages');
    if (newConfirmBtnElement) {
      newConfirmBtnElement.addEventListener('click', () => {
        deleteMultipleMessages(type);
      });
    }
  }
  
  if (type === 'selected') {
    message.textContent = `Are you sure you want to delete ${selectedMessages.size} selected messages?`;
  } else {
    message.textContent = 'Are you sure you want to delete ALL scheduled messages? This action cannot be undone.';
  }
  
  // Set the delete type
  modal.dataset.deleteType = type;
  
  // Show the modal
  modal.classList.add('visible');
  
  // Add close event listeners
  const newCloseButtons = modal.querySelectorAll('.close-modal');
  newCloseButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      modal.classList.remove('visible');
    });
  });
}

/**
 * Delete multiple messages
 * @param {string} type - Type of deletion ('selected' or 'all')
 */
async function deleteMultipleMessages(type) {
  const modal = document.getElementById('delete-sales-messages-modal');
  if (!modal) return;
  
  // Disable confirm button to prevent double clicks
  const confirmBtn = document.getElementById('confirm-delete-sales-messages');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
  }
  
  try {
    let result;
    
    if (type === 'selected' && selectedMessages.size > 0) {
      console.log(`Deleting ${selectedMessages.size} selected messages`);
      
      // Convert Set to Array for the API call
      const selectedIds = Array.from(selectedMessages);
      result = await window.api.deleteSalesMessages(selectedIds);
    } else if (type === 'all') {
      console.log('Deleting all scheduled messages');
      
      // Get all message IDs from the table
      const messageIds = [];
      const messageRows = document.querySelectorAll('.message-row');
      messageRows.forEach(row => {
        const id = parseInt(row.dataset.id);
        if (!isNaN(id)) {
          messageIds.push(id);
        }
      });
      
      if (messageIds.length === 0) {
        throw new Error('No messages found to delete');
      }
      
      console.log(`Found ${messageIds.length} messages to delete`);
      result = await window.api.deleteSalesMessages(messageIds);
    } else {
      throw new Error('Invalid delete type or no messages selected');
    }
    
    if (!result || !result.success) {
      throw new Error(result?.error || 'Failed to delete messages');
    }
    
    console.log('Delete result:', result);
    
    // Show success notification
    const count = result.count || 0;
    const message = `Successfully deleted ${count} message${count !== 1 ? 's' : ''}`;
    showNotification(message, 'success');
    
    // Clear selected messages
    selectedMessages.clear();
    
    // Close the modal
    modal.classList.remove('visible');
    
    // Reload the messages
    await loadScheduledMessages();
  } catch (error) {
    console.error('Error deleting messages:', error);
    showNotification('Error: ' + error.message, 'error');
    
    // Re-enable the confirm button
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Delete';
    }
  }
}

/**
 * Update the status of a message in the UI
 * @param {Object} update - Status update object
 */
function updateMessageStatus(update) {
  if (!update || !update.externalId) {
    console.warn('Invalid status update received:', update);
    return;
  }
  
  console.log(`[Sales] Received status update: ${update.externalId} -> ${update.status}`, update);
  
  // Find the message row by ID if provided, or by externalId
  const messageRow = update.id 
    ? document.querySelector(`.message-row[data-id="${update.id}"]`)
    : document.querySelector(`.message-row[data-external-id="${update.externalId}"]`);
  
  if (!messageRow) {
    console.log(`No UI element found for message ${update.externalId}, may need to refresh view`);
    return;
  }
  
  // Update the status badge
  const statusBadge = messageRow.querySelector('.badge.status-SCHEDULED, .badge.status-PENDING, .badge.status-SENDING, .badge.status-SENT, .badge.status-DELIVERED, .badge.status-READ, .badge.status-FAILED, .badge.status-CANCELED');
  
  if (statusBadge) {
    // Remove old status class
    statusBadge.classList.forEach(cls => {
      if (cls.startsWith('status-')) {
        statusBadge.classList.remove(cls);
      }
    });
    
    // Add new status class and update text
    statusBadge.classList.add(`status-${update.status.toLowerCase()}`);
    statusBadge.textContent = update.status;
  }
  
  // Update row class to reflect status
  messageRow.className = messageRow.className.replace(/scheduled|pending|sending|sent|delivered|read|failed|canceled/g, '');
  messageRow.classList.add(update.status.toLowerCase());
  
  // Update timestamp cell for specific statuses
  const timestampCell = messageRow.cells[6]; // Sent time column
  
  if (timestampCell && (update.status === 'SENT' || update.status === 'DELIVERED' || update.status === 'READ')) {
    const timestamp = update.timestamp || new Date();
    timestampCell.textContent = new Date(timestamp).toLocaleString();
  }
}

/**
 * Setup message status update handler
 */
function setupMessageStatusUpdates() {
  // Listen for status updates from the main process
  window.api.on('message-status-update', updateMessageStatus);
}