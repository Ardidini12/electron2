// bulksender.js - Bulk Message Sender functionality
import { api } from '../utils/api.js';
import { showToast, showConfirmDialog } from '../ui/notifications.js';
import { getSettings } from '../settings/settings.js';

// Cache DOM elements
let elements = {};

// Data storage
let contacts = [];
let contactGroups = [];
let templates = [];
let selectedContacts = [];
let selectedTemplate = null;

/**
 * Initialize the bulk sender module
 */
export async function initBulkSender() {
  console.log('Initializing bulk sender module...');
  
  // Cache DOM elements
  cacheElements();
  
  // Set up event listeners
  setupEventListeners();
  
  // Load contacts and templates
  try {
    await Promise.all([
      loadContacts(),
      loadTemplates()
    ]);
    
    // Group contacts by first letter
    groupContacts();
    
    // Render contact groups
    renderContactGroups();
    
    // Update the template preview
    updateTemplatePreview();
    
    // Set up auto-refresh from scheduled view
    setupAutoRefresh();
    
    console.log('Bulk sender module initialized successfully');
  } catch (error) {
    console.error('Error initializing bulk sender module:', error);
    showToast('Error initializing bulk sender module', 'error');
  }
}

/**
 * Cache DOM elements for better performance
 */
function cacheElements() {
  elements = {
    contactGroups: document.getElementById('contact-groups'),
    selectedCount: document.getElementById('selected-count'),
    templateSelect: document.getElementById('selected-template'),
    templatePreview: document.getElementById('template-preview'),
    sendButton: document.getElementById('schedule-messages'),
    scheduleTimeCheckbox: document.getElementById('schedule-time-checkbox'),
    scheduledDateInput: document.getElementById('scheduled-date'),
    scheduledTimeInput: document.getElementById('scheduled-time'),
    goToScheduledCheckbox: document.getElementById('go-to-scheduled-checkbox'),
    cancelButton: document.getElementById('cancel-schedule')
  };
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Template selection
  if (elements.templateSelect) {
    elements.templateSelect.addEventListener('change', () => {
      const templateId = parseInt(elements.templateSelect.value);
      selectedTemplate = templates.find(t => t.id === templateId) || null;
      updateTemplatePreview();
      updateSendButton();
    });
  }
  
  // Send button
  if (elements.sendButton) {
    elements.sendButton.addEventListener('click', scheduleMessages);
  }
  
  // Schedule time checkbox
  if (elements.scheduleTimeCheckbox) {
    elements.scheduleTimeCheckbox.addEventListener('change', () => {
      updateSendButton();
    });
  }
  
  // Cancel button
  if (elements.cancelButton) {
    elements.cancelButton.addEventListener('click', resetSelection);
  }
}

/**
 * Load contacts from the backend
 */
async function loadContacts() {
  try {
    const result = await api.getContacts();
    
    if (Array.isArray(result)) {
      contacts = result;
      
      // Group contacts by source
      groupContacts();
      
      // Render contact groups
      renderContactGroups();
    }
  } catch (error) {
    console.error('Error loading contacts:', error);
    showToast('Failed to load contacts', 'error');
  }
}

/**
 * Group contacts by source
 */
function groupContacts() {
  // Reset contact groups
  contactGroups = [];
  
  // Group by source
  const sourceGroups = {};
  
  contacts.forEach(contact => {
    const source = contact.source || 'Manually Added';
    
    if (!sourceGroups[source]) {
      sourceGroups[source] = [];
    }
    
    sourceGroups[source].push(contact);
  });
  
  // Convert to array format
  Object.keys(sourceGroups).forEach(source => {
    contactGroups.push({
      name: source,
      contacts: sourceGroups[source],
      selected: false
    });
  });
  
  console.log('Contact groups:', contactGroups);
}

/**
 * Render contact groups in the UI
 */
function renderContactGroups() {
  if (!elements.contactGroups) return;
  
  // Clear container
  elements.contactGroups.innerHTML = '';
  
  if (contactGroups.length === 0) {
    elements.contactGroups.innerHTML = '<p class="empty-state">No contacts available. Please add contacts first.</p>';
    return;
  }
  
  // Create elements for each group
  contactGroups.forEach((group, groupIndex) => {
    const groupElement = document.createElement('div');
    groupElement.className = 'contact-group';
    
    // Group header with checkbox
    const header = document.createElement('div');
    header.className = 'group-header';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = group.selected;
    checkbox.id = `group-${groupIndex}`;
    checkbox.dataset.groupIndex = groupIndex;
    
    // Add event listener to select/deselect all contacts in group
    checkbox.addEventListener('change', () => {
      toggleGroupSelection(groupIndex, checkbox.checked);
    });
    
    const label = document.createElement('label');
    label.htmlFor = `group-${groupIndex}`;
    label.textContent = `${group.name} (${group.contacts.length})`;
    
    header.appendChild(checkbox);
    header.appendChild(label);
    
    // Add expand/collapse functionality
    const expandBtn = document.createElement('button');
    expandBtn.className = 'expand-btn';
    expandBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
    expandBtn.setAttribute('aria-label', 'Expand contact group');
    
    expandBtn.addEventListener('click', () => {
      const contactList = groupElement.querySelector('.contact-list');
      if (contactList.style.display === 'none') {
        contactList.style.display = 'block';
        expandBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
      } else {
        contactList.style.display = 'none';
        expandBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
      }
    });
    
    header.appendChild(expandBtn);
    groupElement.appendChild(header);
    
    // Contact list (initially collapsed)
    const contactList = document.createElement('div');
    contactList.className = 'contact-list';
    contactList.style.display = 'none';
    
    // Add contacts
    group.contacts.forEach((contact, contactIndex) => {
      const contactElement = document.createElement('div');
      contactElement.className = 'contact-item';
      
      const contactCheckbox = document.createElement('input');
      contactCheckbox.type = 'checkbox';
      contactCheckbox.checked = contact.selected || false;
      contactCheckbox.id = `contact-${groupIndex}-${contactIndex}`;
      contactCheckbox.dataset.groupIndex = groupIndex;
      contactCheckbox.dataset.contactIndex = contactIndex;
      
      // Add event listener to select/deselect contact
      contactCheckbox.addEventListener('change', () => {
        toggleContactSelection(groupIndex, contactIndex, contactCheckbox.checked);
      });
      
      const contactLabel = document.createElement('label');
      contactLabel.htmlFor = `contact-${groupIndex}-${contactIndex}`;
      contactLabel.textContent = `${contact.name || ''} ${contact.surname || ''} (${contact.phoneNumber})`;
      
      contactElement.appendChild(contactCheckbox);
      contactElement.appendChild(contactLabel);
      
      contactList.appendChild(contactElement);
    });
    
    groupElement.appendChild(contactList);
    elements.contactGroups.appendChild(groupElement);
  });
  
  // Update selection count
  updateSelectionCount();
}

/**
 * Toggle selection of all contacts in a group
 * @param {number} groupIndex - Index of the group
 * @param {boolean} selected - Whether to select or deselect
 */
function toggleGroupSelection(groupIndex, selected) {
  if (!contactGroups[groupIndex]) return;
  
  // Update group selection state
  contactGroups[groupIndex].selected = selected;
  
  // Update all contacts in the group
  contactGroups[groupIndex].contacts.forEach((contact, contactIndex) => {
    // Update contact selection state
    contact.selected = selected;
    
    // Update checkbox in UI
    const checkbox = document.getElementById(`contact-${groupIndex}-${contactIndex}`);
    if (checkbox) {
      checkbox.checked = selected;
    }
  });
  
  // Update selected contacts array
  updateSelectedContacts();
  
  // Update selection count
  updateSelectionCount();
  
  // Update send button state
  updateSendButton();
}

/**
 * Toggle selection of a single contact
 * @param {number} groupIndex - Index of the group
 * @param {number} contactIndex - Index of the contact within the group
 * @param {boolean} selected - Whether to select or deselect
 */
function toggleContactSelection(groupIndex, contactIndex, selected) {
  if (!contactGroups[groupIndex] || !contactGroups[groupIndex].contacts[contactIndex]) return;
  
  // Update contact selection state
  contactGroups[groupIndex].contacts[contactIndex].selected = selected;
  
  // Check if all contacts in the group are selected
  const allSelected = contactGroups[groupIndex].contacts.every(contact => contact.selected);
  
  // Update group checkbox
  const groupCheckbox = document.getElementById(`group-${groupIndex}`);
  if (groupCheckbox) {
    groupCheckbox.checked = allSelected;
  }
  
  // Update group selection state
  contactGroups[groupIndex].selected = allSelected;
  
  // Update selected contacts array
  updateSelectedContacts();
  
  // Update selection count
  updateSelectionCount();
  
  // Update send button state
  updateSendButton();
}

/**
 * Update the array of selected contacts
 */
function updateSelectedContacts() {
  selectedContacts = [];
  
  contactGroups.forEach(group => {
    group.contacts.forEach(contact => {
      if (contact.selected) {
        selectedContacts.push(contact);
      }
    });
  });
}

/**
 * Update the selection count display
 */
function updateSelectionCount() {
  if (elements.selectedCount) {
    elements.selectedCount.textContent = selectedContacts.length;
  }
}

/**
 * Load templates from the backend
 */
async function loadTemplates() {
  try {
    const result = await api.getTemplates();
    
    if (Array.isArray(result)) {
      templates = result;
      
      // Populate template select
      populateTemplateSelect();
    }
  } catch (error) {
    console.error('Error loading templates:', error);
    showToast('Failed to load templates', 'error');
  }
}

/**
 * Populate the template select dropdown
 */
function populateTemplateSelect() {
  if (!elements.templateSelect) return;
  
  // Clear select
  elements.templateSelect.innerHTML = '<option value="">-- Select Template --</option>';
  
  if (templates.length === 0) {
    elements.templateSelect.innerHTML += '<option disabled>No templates available</option>';
    return;
  }
  
  // Add template options
  templates.forEach(template => {
    const option = document.createElement('option');
    option.value = template.id;
    option.textContent = template.name;
    elements.templateSelect.appendChild(option);
  });
}

/**
 * Update the template preview
 */
function updateTemplatePreview() {
  if (!elements.templatePreview) return;
  
  if (!selectedTemplate) {
    // Show placeholder
    elements.templatePreview.innerHTML = `
      <div class="preview-placeholder">
        <i class="fas fa-file-alt"></i>
        <p>Select a template to preview</p>
      </div>
    `;
    return;
  }
  
  // Create a personalized version of the template for preview
  let previewContent = selectedTemplate.content;
  
  // Show the preview with variables replaced (use sample data)
  previewContent = personalizeTemplatePreview(previewContent);
  
  // Show template preview
  let previewHTML = `
    <div class="preview-content">
      <h3>${selectedTemplate.name}</h3>
      <div class="preview-message">${previewContent}</div>
  `;
  
  // Add image if available
  if (selectedTemplate.imagePath) {
    previewHTML += `
      <div class="preview-image">
        <img src="${selectedTemplate.imagePath}" alt="Template image">
      </div>
    `;
  }
  
  // Show a note about personalization
  previewHTML += `
    <div class="personalization-note">
      <i class="fas fa-info-circle"></i>
      <span>Variables like {name}, {phone}, etc. will be replaced with each contact's actual data.</span>
    </div>
  `;
  
  previewHTML += '</div>';
  
  elements.templatePreview.innerHTML = previewHTML;
}

/**
 * Personalize template content with sample data for preview
 * @param {string} content - Template content with placeholders
 * @returns {string} - Personalized content for preview
 */
function personalizeTemplatePreview(content) {
  if (!content) return '';
  
  try {
    // Replace placeholders with sample data for preview
    let personalized = content;
    
    // Sample replacement values for preview
    const replacements = {
      '{name}': '<span class="variable-preview">[Contact Name]</span>',
      '{surname}': '<span class="variable-preview">[Contact Surname]</span>',
      '{fullname}': '<span class="variable-preview">[Full Name]</span>',
      '{full_name}': '<span class="variable-preview">[Full Name]</span>',
      '{phone}': '<span class="variable-preview">[Phone Number]</span>',
      '{phone_number}': '<span class="variable-preview">[Phone Number]</span>',
      '{email}': '<span class="variable-preview">[Email Address]</span>',
      '{source}': '<span class="variable-preview">[Contact Source]</span>',
      '{notes}': '<span class="variable-preview">[Notes]</span>',
      '{date}': new Date().toLocaleDateString(),
      '{time}': new Date().toLocaleTimeString(),
      '{datetime}': new Date().toLocaleString(),
      '{day}': ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()],
      '{month}': ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][new Date().getMonth()],
      '{year}': new Date().getFullYear().toString()
    };
    
    // Apply replacements
    for (const [placeholder, value] of Object.entries(replacements)) {
      // Use a regex that ignores case for more flexibility
      const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      personalized = personalized.replace(regex, value);
    }
    
    return personalized;
  } catch (error) {
    console.error('Error personalizing preview content:', error);
    return content; // Return original content if personalization fails
  }
}

/**
 * Update the state of the send button
 */
function updateSendButton() {
  if (!elements.sendButton) return;
  
  const canSend = selectedContacts.length > 0 && selectedTemplate !== null;
  
  elements.sendButton.disabled = !canSend;
  
  if (canSend) {
    elements.sendButton.classList.add('primary-btn');
    elements.sendButton.classList.remove('disabled-btn');
  } else {
    elements.sendButton.classList.remove('primary-btn');
    elements.sendButton.classList.add('disabled-btn');
  }
}

/**
 * Update all UI elements
 */
function updateUI() {
  updateSelectionCount();
  updateTemplatePreview();
  updateSendButton();
}

/**
 * Calculate the next available send time based on settings
 * @returns {Date} The next available send time
 */
async function calculateNextSendTime() {
  // Get current settings
  const appSettings = await getSettings();
  
  // Start with current time
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();
  const currentDay = now.getDay() === 0 ? 7 : now.getDay(); // Convert Sunday from 0 to 7
  
  // Check if current day is in active days
  const isActiveDay = appSettings.activeDays.includes(currentDay);
  
  // Check if current time is within sending hours
  const isWithinHours = currentTime >= appSettings.startTime && currentTime < appSettings.endTime;
  
  // If both conditions are met, use current time
  if (isActiveDay && isWithinHours) {
    return now;
  }
  
  // Otherwise, calculate next available time
  let nextDay = currentDay;
  let daysToAdd = 0;
  
  // Find the next active day
  while (!appSettings.activeDays.includes(nextDay)) {
    daysToAdd++;
    nextDay = ((nextDay) % 7) + 1;
    if (daysToAdd > 7) {
      // Safety check to prevent infinite loop
      throw new Error('No active days configured in settings');
    }
  }
  
  // Create date for next active day at start time
  const nextDate = new Date();
  nextDate.setDate(now.getDate() + daysToAdd);
  
  // Set time to start time
  const startHours = Math.floor(appSettings.startTime / 60);
  const startMinutes = appSettings.startTime % 60;
  nextDate.setHours(startHours, startMinutes, 0, 0);
  
  return nextDate;
}

/**
 * Set up auto-refresh to check for message status updates
 */
function setupAutoRefresh() {
  // Listen for message status updates from the main process
  window.api.on('message-status-update', () => {
    // If we're in the scheduled view, refresh that module
    if (document.querySelector('#scheduled.active')) {
      console.log('Auto-refreshing scheduled messages from bulk sender module');
      
      // If the scheduled module has a refresh function, call it
      if (window.refreshScheduledMessages) {
        window.refreshScheduledMessages();
      }
    }
  });
  
  // Listen for message sent events
  window.api.on('message-sent', () => {
    // Refresh the view to show the updated status
    if (document.querySelector('#scheduled.active')) {
      console.log('Message sent, refreshing scheduled view');
      if (window.refreshScheduledMessages) {
        window.refreshScheduledMessages();
      }
    }
  });
}

/**
 * Schedule messages for sending
 */
async function scheduleMessages() {
  try {
    // Validate template selection
    if (!selectedTemplate) {
      showToast('Please select a template', 'error');
      return;
    }
    
    // Validate contact selection
    if (selectedContacts.length === 0) {
      showToast('Please select at least one contact', 'error');
      return;
    }
    
    // Get scheduling options
    const schedulingOptions = {};
    
    // Use the settings time as default if available
    let scheduledTime = new Date();
    
    // If scheduling for later and inputs exist, use those values
    if (elements.scheduleTimeCheckbox && elements.scheduleTimeCheckbox.checked) {
      if (elements.scheduledDateInput && elements.scheduledTimeInput) {
        const dateValue = elements.scheduledDateInput.value;
        const timeValue = elements.scheduledTimeInput.value;
        
        if (!dateValue || !timeValue) {
          showToast('Please select a date and time for scheduling', 'error');
          return;
        }
        
        scheduledTime = new Date(`${dateValue}T${timeValue}`);
        
        if (isNaN(scheduledTime.getTime())) {
          showToast('Invalid date or time format', 'error');
          return;
        }
      }
    }
    
    // Show confirmation dialog
    const confirmed = await showConfirmDialog(
      'Schedule Messages',
      `Are you sure you want to schedule ${selectedContacts.length} message(s) using template "${selectedTemplate.name}"?`,
      'Schedule',
      'Cancel'
    );
    
    if (!confirmed) return;
    
    // Disable buttons to prevent double-sending
    if (elements.sendButton) elements.sendButton.disabled = true;
    if (elements.cancelButton) elements.cancelButton.disabled = true;
    
    // Show sending status
    showToast(`Scheduling ${selectedContacts.length} messages...`, 'info');
    
    // Schedule messages
    const result = await api.scheduleMessages({
      contacts: selectedContacts,
      templateId: selectedTemplate.id,
      scheduledTime: scheduledTime.toISOString()
    });
    
    // Re-enable buttons
    if (elements.sendButton) elements.sendButton.disabled = false;
    if (elements.cancelButton) elements.cancelButton.disabled = false;
    
    if (result.success) {
      showToast(`Successfully scheduled ${result.scheduledCount} messages`, 'success');
      
      // Reset selection
      resetSelection();
      
      // Switch to scheduled view if checkbox is checked
      if (elements.goToScheduledCheckbox && elements.goToScheduledCheckbox.checked) {
        document.querySelectorAll('.nav-item').forEach(item => {
          item.classList.remove('active');
        });
        
        document.querySelectorAll('.content-section').forEach(section => {
          section.classList.remove('active');
        });
        
        const scheduledMenuItem = document.querySelector('.nav-item[data-section="scheduled"]');
        if (scheduledMenuItem) scheduledMenuItem.classList.add('active');
        
        const scheduledSection = document.getElementById('scheduled');
        if (scheduledSection) scheduledSection.classList.add('active');
        
        // Refresh the scheduled view
        if (window.refreshScheduledMessages) {
          window.refreshScheduledMessages();
        }
      } else {
        // If not switching views, refresh current view
        refreshBulkSender();
      }
    } else {
      showToast(`Error scheduling messages: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Error scheduling messages:', error);
    showToast(`Error scheduling messages: ${error.message}`, 'error');
    
    // Re-enable buttons
    if (elements.sendButton) elements.sendButton.disabled = false;
    if (elements.cancelButton) elements.cancelButton.disabled = false;
  }
}

/**
 * Reset contact selection
 */
function resetSelection() {
  // Reset selected contacts
  selectedContacts = [];
  
  // Reset contact groups
  contactGroups.forEach(group => {
    group.selected = false;
    group.contacts.forEach(contact => {
      contact.selected = false;
    });
  });
  
  // Reset UI
  renderContactGroups();
  updateUI();
}

/**
 * Refresh bulk sender data
 */
export async function refreshBulkSender() {
  await Promise.all([
    loadContacts(),
    loadTemplates()
  ]);
  
  // Reset selection
  resetSelection();
  
  // Update UI
  updateUI();
} 