// settings.js - Settings management functionality
import { api } from '../utils/api.js';
import { showToast } from '../ui/notifications.js';

// Cache DOM elements
let elements = {};

// Local storage key for settings backup
const SETTINGS_STORAGE_KEY = 'bss_sender_settings';

// Settings cache - start with empty settings
let settings = {};

// Add view state tracking
let isViewActive = false;

/**
 * Load settings from localStorage (as backup)
 */
function loadSettingsFromStorage() {
  try {
    const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (storedSettings) {
      const parsed = JSON.parse(storedSettings);
      console.log('Retrieved settings from localStorage:', parsed);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch (error) {
    console.error('Error loading settings from localStorage:', error);
  }
  return null;
}

/**
 * Save settings to localStorage (as backup)
 */
function saveSettingsToStorage(settingsData) {
  try {
    if (settingsData && typeof settingsData === 'object') {
      // Extract data from dataValues if present
      let dataToStore = settingsData;
      if (settingsData.dataValues && typeof settingsData.dataValues === 'object') {
        console.log('Found dataValues in settings to store, extracting to flatten structure');
        dataToStore = { ...settingsData.dataValues };
      }
      
      // Make sure we have a clean object without circular references
      const cleanData = {
        activeDays: dataToStore.activeDays,
        startTime: dataToStore.startTime,
        endTime: dataToStore.endTime,
        messageInterval: dataToStore.messageInterval,
        isActive: dataToStore.isActive
      };
      
      // If activeDays is a string, try to parse it
      if (typeof cleanData.activeDays === 'string') {
        try {
          cleanData.activeDays = JSON.parse(cleanData.activeDays);
        } catch (e) {
          console.warn('Could not parse activeDays string, storing as is');
        }
      }
      
      // Ensure all the expected keys have values (with defaults)
      if (!Array.isArray(cleanData.activeDays)) cleanData.activeDays = [1, 2, 3, 4, 5];
      if (typeof cleanData.startTime !== 'number' || isNaN(cleanData.startTime)) cleanData.startTime = 540;
      if (typeof cleanData.endTime !== 'number' || isNaN(cleanData.endTime)) cleanData.endTime = 1020;
      if (typeof cleanData.messageInterval !== 'number' || isNaN(cleanData.messageInterval)) cleanData.messageInterval = 45;
      cleanData.isActive = !!cleanData.isActive;
      
      console.log('Saving clean settings to localStorage:', cleanData);
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(cleanData));
      console.log('Settings saved to localStorage');
    }
  } catch (error) {
    console.error('Error saving settings to localStorage:', error);
  }
}

/**
 * Extract clean settings from a potentially complex structure
 * This handles both direct settings and nested dataValues
 */
function extractCleanSettings(data) {
  if (!data || typeof data !== 'object') return null;
  
  // Start with the input data
  let sourceData = data;
  
  // Extract from dataValues if available
  if (data.dataValues && typeof data.dataValues === 'object') {
    console.log('Found dataValues, using those for clean extraction');
    sourceData = data.dataValues;
  }
  
  // Create a clean object with just the expected properties
  const cleanSettings = {
    activeDays: sourceData.activeDays,
    startTime: sourceData.startTime,
    endTime: sourceData.endTime,
    messageInterval: sourceData.messageInterval,
    isActive: sourceData.isActive
  };
  
  // Process activeDays if it's a string
  if (typeof cleanSettings.activeDays === 'string') {
    try {
      cleanSettings.activeDays = JSON.parse(cleanSettings.activeDays);
    } catch (e) {
      console.warn('Failed to parse activeDays string in extraction');
      if (cleanSettings.activeDays.match(/\d/)) {
        cleanSettings.activeDays = cleanSettings.activeDays.match(/\d/g).map(d => parseInt(d));
      } else {
        cleanSettings.activeDays = [1, 2, 3, 4, 5]; // Default
      }
    }
  }
  
  // Ensure activeDays is an array
  if (!Array.isArray(cleanSettings.activeDays)) {
    cleanSettings.activeDays = [1, 2, 3, 4, 5]; // Default
  }
  
  // Validate numeric fields
  if (typeof cleanSettings.startTime !== 'number' || isNaN(cleanSettings.startTime)) {
    cleanSettings.startTime = 540; // 9:00 AM
  }
  
  if (typeof cleanSettings.endTime !== 'number' || isNaN(cleanSettings.endTime)) {
    cleanSettings.endTime = 1020; // 5:00 PM
  }
  
  if (typeof cleanSettings.messageInterval !== 'number' || isNaN(cleanSettings.messageInterval) || cleanSettings.messageInterval < 10) {
    cleanSettings.messageInterval = 45; // 45 seconds
  }
  
  // Boolean conversion for isActive
  cleanSettings.isActive = !!cleanSettings.isActive;
  
  console.log('Extracted clean settings:', cleanSettings);
  return cleanSettings;
}

/**
 * Refresh settings and update UI - call this when navigating to settings page
 */
export async function refreshSettings() {
  console.log('Refreshing settings and updating UI...');
  
  // First mark the view as active
  isViewActive = true;
  
  try {
    // This is important - force a completely clean slate
    console.log('Resetting elements and state');
    elements = {};
    
    // Wait a moment for DOM to be ready
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Set up DOM references - retry until successful
    let elementsReady = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`Caching elements attempt ${attempt}/3`);
      elementsReady = cacheElements();
      if (elementsReady) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    if (!elementsReady) {
      console.error('Failed to cache essential elements after multiple attempts');
      showToast('Error setting up settings view', 'error');
      return;
    }
    
    // Setup event listeners - this also re-caches elements after cloning the form
    console.log('Setting up event listeners');
    setupEventListeners();
    
    // Force a fresh backend load
    console.log('Loading fresh settings from backend');
    await loadFreshSettingsFromBackend();
    
    // One final UI update with a delay to ensure all changes are applied
    setTimeout(() => {
      console.log('Performing final UI update after refresh');
      forceUpdateUI();
    }, 300);
    
    console.log('Settings refresh complete');
  } catch (error) {
    console.error('Error during settings refresh:', error);
    showToast('Error refreshing settings', 'error');
  }
}

/**
 * Force load fresh settings from backend and update UI
 */
async function loadFreshSettingsFromBackend() {
  try {
    console.log('Force loading settings from backend...');
    const result = await api.getSettings();
    
    if (result && Object.keys(result).length > 0) {
      console.log('Received settings from backend:', result);
      
      // Debug log full structure
      console.log('Settings object structure:', JSON.stringify({
        hasDataValues: !!result.dataValues,
        dataValuesType: result.dataValues ? typeof result.dataValues : 'none',
        topLevelKeys: Object.keys(result),
        dataValuesKeys: result.dataValues ? Object.keys(result.dataValues) : [],
        startTime: result.startTime,
        dataValuesStartTime: result.dataValues?.startTime,
        endTime: result.endTime, 
        dataValuesEndTime: result.dataValues?.endTime
      }));
      
      // Extract clean settings
      const cleanSettings = extractCleanSettings(result);
      
      // Update settings cache with clean settings
      settings = cleanSettings;
      console.log('Settings processed and updated:', settings);
      
      // Save to localStorage as backup
      saveSettingsToStorage(settings);
      
      // Force immediate UI update
      console.log('Forcing UI update with backend settings...');
      forceUpdateUI();
    } else {
      console.warn('No settings returned from backend');
    }
  } catch (error) {
    console.error('Error loading settings from backend:', error);
    
    // Try to load from localStorage as fallback
    const storedSettings = loadSettingsFromStorage();
    if (storedSettings) {
      console.log('Using stored settings from localStorage as fallback');
      settings = storedSettings;
      forceUpdateUI();
    }
  }
}

/**
 * Force update UI with current settings values
 */
function forceUpdateUI() {
  // Make sure we have fresh element references
  const elementsFound = cacheElements();
  if (!elementsFound) {
    console.error('Cannot update UI - critical elements missing');
    return false;
  }
  
  console.log('Force updating UI with settings:', settings);
  
  try {
    // CRITICAL: Properly handle activeDays
    if (settings.activeDays && elements.activeDaysCheckboxes) {
      // Parse activeDays if it's a string (which often happens from backend)
      let activeDays = settings.activeDays;
      
      console.log('Raw activeDays value:', activeDays, 'type:', typeof activeDays);
      
      // Convert string to array if needed
      if (typeof activeDays === 'string') {
        try {
          // Try standard JSON parse first
          activeDays = JSON.parse(activeDays);
          console.log('Successfully parsed activeDays JSON string to array:', activeDays);
        } catch (e) {
          console.error('Failed to parse activeDays string using JSON.parse:', e);
          
          // Try regex extraction of numbers
          if (activeDays.match(/\d/)) {
            activeDays = activeDays.match(/\d/g).map(d => parseInt(d));
            console.log('Extracted days using regex:', activeDays);
          } else {
            console.warn('Could not extract days from string, using empty array');
            activeDays = [];
          }
        }
      }
      
      // Ensure we have an array at this point
      if (!Array.isArray(activeDays)) {
        console.warn('activeDays is still not an array after processing:', activeDays);
        activeDays = [];
      }
      
      console.log('Final processed activeDays for UI update:', activeDays);
      
      // Clear all checkboxes first
      elements.activeDaysCheckboxes.forEach(checkbox => {
        checkbox.checked = false;
      });
      
      // Then set the correct ones
      elements.activeDaysCheckboxes.forEach(checkbox => {
        const dayValue = parseInt(checkbox.value);
        if (activeDays.includes(dayValue)) {
          checkbox.checked = true;
          console.log(`Setting day ${dayValue} checkbox to checked`);
        } else {
          console.log(`Day ${dayValue} not in activeDays, leaving unchecked`);
        }
      });
    } else {
      console.warn('No activeDays found in settings or no checkboxes found:', 
                  'activeDays:', settings.activeDays, 
                  'checkboxes:', elements.activeDaysCheckboxes?.length);
    }
    
    // Helper to extract time values from settings, handling different data formats
    const extractTimeValue = (fieldName, defaultValue) => {
      // Log to help debug
      console.log(`Extracting ${fieldName} from settings:`, {
        directValue: settings[fieldName],
        directValueType: typeof settings[fieldName],
        fromDataValues: settings.dataValues ? settings.dataValues[fieldName] : 'no dataValues',
        fromNestedDataValues: settings.dataValues?.dataValues ? settings.dataValues.dataValues[fieldName] : 'no nested dataValues'
      });
      
      let value = settings[fieldName];
      
      // Try to extract from nested structures if direct value is not usable
      if (value === undefined || value === null) {
        if (settings.dataValues && settings.dataValues[fieldName] !== undefined) {
          value = settings.dataValues[fieldName];
          console.log(`Found ${fieldName} in dataValues:`, value);
        }
      }
      
      // Parse string value if needed
      if (typeof value === 'string' && value.match(/^\d+$/)) {
        value = parseInt(value);
        console.log(`Parsed string ${fieldName} to number:`, value);
      }
      
      // Return valid number or default
      if (typeof value === 'number' && !isNaN(value)) {
        return value;
      }
      
      console.warn(`Invalid ${fieldName}, using default:`, defaultValue);
      return defaultValue;
    };
    
    // Format time function with validation
    const formatTime = (minutes) => {
      // Verify minutes is a valid number
      if (typeof minutes !== 'number' || isNaN(minutes) || minutes < 0 || minutes >= 24 * 60) {
        console.warn('Invalid time value:', minutes);
        return '09:00'; // Default fallback
      }
      
      // Calculate hours and minutes
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      
      // Format with leading zeros
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    };
    
    // Set time values using the helper - with defaults
    const startTime = extractTimeValue('startTime', 540); // Default 9:00 AM
    const endTime = extractTimeValue('endTime', 1020); // Default 5:00 PM
    const messageInterval = extractTimeValue('messageInterval', 45); // Default 45 seconds
    
    // Set start time
    if (elements.startTime) {
      const startTimeFormatted = formatTime(startTime);
      elements.startTime.value = startTimeFormatted;
      console.log(`Set start time input to: ${startTimeFormatted} (from ${startTime} minutes)`);
    } else {
      console.warn('Start time element not found');
    }
    
    // Set end time
    if (elements.endTime) {
      const endTimeFormatted = formatTime(endTime);
      elements.endTime.value = endTimeFormatted;
      console.log(`Set end time input to: ${endTimeFormatted} (from ${endTime} minutes)`);
    } else {
      console.warn('End time element not found');
    }
    
    // Set message interval
    if (elements.messageInterval) {
      elements.messageInterval.value = messageInterval;
      console.log(`Set message interval to: ${messageInterval}`);
    } else {
      console.warn('Message interval element not found');
    }
    
    // Helper to extract boolean values
    const extractBooleanValue = (fieldName, defaultValue) => {
      console.log(`Extracting boolean ${fieldName} from settings:`, {
        directValue: settings[fieldName],
        directValueType: typeof settings[fieldName],
        fromDataValues: settings.dataValues ? settings.dataValues[fieldName] : 'no dataValues'
      });
      
      let value = settings[fieldName];
      
      // Try to extract from nested structures if direct value is not usable
      if (value === undefined || value === null) {
        if (settings.dataValues && settings.dataValues[fieldName] !== undefined) {
          value = settings.dataValues[fieldName];
          console.log(`Found ${fieldName} in dataValues:`, value);
        }
      }
      
      // Convert different formats to boolean
      if (typeof value === 'string') {
        return value.toLowerCase() === 'true' || value === '1';
      }
      
      if (typeof value === 'number') {
        return value === 1;
      }
      
      if (typeof value === 'boolean') {
        return value;
      }
      
      console.warn(`Invalid ${fieldName}, using default:`, defaultValue);
      return defaultValue;
    };
    
    // Set active status
    const isActiveValue = extractBooleanValue('isActive', false);
    if (elements.isActive) {
      elements.isActive.checked = isActiveValue;
      console.log(`Set is active to: ${isActiveValue}`);
    } else {
      console.warn('Is active element not found - please check HTML structure');
    }
    
    // Ensure save button is reset
    if (elements.saveButton) {
      elements.saveButton.disabled = false;
      elements.saveButton.textContent = 'Save Settings';
    }
    
    // Debug validation - log what's actually set in the DOM
    if (elements.activeDaysCheckboxes) {
      const checkedDays = [];
      elements.activeDaysCheckboxes.forEach(checkbox => {
        if (checkbox.checked) {
          checkedDays.push(parseInt(checkbox.value));
        }
      });
      console.log('Final DOM state - checked days:', checkedDays);
    }
    
    console.log('Final DOM state - time settings:', {
      startTime: elements.startTime?.value || 'element not found',
      endTime: elements.endTime?.value || 'element not found',
      messageInterval: elements.messageInterval?.value || 'element not found',
      isActive: elements.isActive?.checked || 'element not found'
    });
    
    console.log('UI update complete');
    return true;
  } catch (error) {
    console.error('Error updating UI:', error);
    
    // Reset save button even on error
    if (elements.saveButton) {
      elements.saveButton.disabled = false;
      elements.saveButton.textContent = 'Save Settings';
    }
    
    return false;
  }
}

/**
 * Initialize the settings module
 */
export async function initSettings() {
  console.log('Initializing settings module...');
  
  try {
    // Force refresh settings from backend and update UI
    await refreshSettings();
    console.log('Settings module initialized successfully');
  } catch (error) {
    console.error('Error initializing settings module:', error);
    showToast('Failed to initialize settings', 'error');
  }
}

/**
 * Clean up when leaving settings view
 */
export function destroySettings() {
  console.log('Cleaning up settings module...');
  
  // Just mark the view as inactive, but keep the settings data
  isViewActive = false;
  
  // Don't clear elements cache or event listeners
  // This was causing the settings to reset when navigating back
  
  console.log('Settings cleanup complete, current settings:', settings);
}

/**
 * Full view setup routine
 */
async function setupSettingsView() {
  console.log('Setting up settings view...');
  
  // Try up to 3 times with delays
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`Setup attempt ${attempt}/3`);
    
    if (!isViewActive) {
      console.log('View no longer active, stopping setup');
      return;
    }
    
    const success = cacheElements();
    if (success) {
      setupEventListeners();
        console.log('Settings view setup complete');
        return;
      }
      
    if (attempt < 3) {
      console.log(`Setup attempt ${attempt} failed, retrying in 300ms...`);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  console.error('Failed to setup settings view after 3 attempts');
}

/**
 * Cache DOM elements for better performance
 */
function cacheElements() {
  console.log('Caching settings form elements');
  
  // Cache elements with simple selectors
  elements = {
    settingsForm: document.getElementById('schedule-settings-form'),
    activeDaysCheckboxes: Array.from(document.querySelectorAll('input[name="settings-active-days"]')),
    startTime: document.getElementById('settings-start-time'),
    endTime: document.getElementById('settings-end-time'),
    messageInterval: document.getElementById('settings-message-interval'),
    isActive: document.getElementById('settings-is-active'),
    saveButton: document.getElementById('save-settings-btn'),
    whatsappStatus: document.getElementById('settings-whatsapp-status'),
    whatsappStatusText: document.getElementById('settings-whatsapp-status-text'),
    connectButton: document.getElementById('settings-connect-whatsapp'),
    disconnectButton: document.getElementById('settings-disconnect-whatsapp'),
    logoutButton: document.getElementById('settings-logout-whatsapp'),
    qrContainer: document.getElementById('settings-qr-container'),
    connectedPhone: document.getElementById('settings-connected-phone'),
    phoneInfo: document.getElementById('settings-phone-info'),
    disconnectWhatsAppBtn: document.getElementById('disconnect-whatsapp-btn'),
    logoutWhatsAppBtn: document.getElementById('logout-whatsapp-btn'),
    refreshBtn: document.getElementById('reload-phone-info')
  };
  
  // Try alternative selectors if primary ones failed
  if (!elements.isActive) {
    console.warn('isActive element not found with primary ID, trying alternatives');
    const alternativeActive = document.querySelector('input[name="settings-is-active"]');
    if (alternativeActive) {
      console.log('Found isActive with alternative selector');
      elements.isActive = alternativeActive;
    } else {
      console.error('Could not find isActive element with any selector');
    }
  }
  
  // Log what we found
  console.log('Elements cached:', {
    formFound: !!elements.settingsForm,
    activeDaysCount: elements.activeDaysCheckboxes?.length || 0,
    startTimeFound: !!elements.startTime,
    endTimeFound: !!elements.endTime,
    messageIntervalFound: !!elements.messageInterval,
    isActiveFound: !!elements.isActive,
    saveButtonFound: !!elements.saveButton
  });
  
  // Return success status - isActive is no longer required for success
  return !!(elements.settingsForm && elements.startTime && elements.endTime && elements.saveButton);
}

/**
 * Set up event listeners for settings
 */
function setupEventListeners() {
  // Ensure elements are cached
  if (!elements.settingsForm) {
    console.warn('Settings form not found, attempting to recache elements');
    cacheElements();
    
    // If still not found, schedule another attempt
    if (!elements.settingsForm) {
      console.warn('Settings form still not found, scheduling another attempt');
      setTimeout(setupEventListeners, 500);
      return;
    }
  }
  
  // Use a safer approach to replace the form with a clean copy
  try {
    console.log('Setting up form submission event listener');
    
    // Create a form copy without events
  if (elements.settingsForm) {
      const oldForm = elements.settingsForm;
      
      // Create a new form element
      const newForm = document.createElement('form');
      newForm.id = oldForm.id;
      newForm.className = oldForm.className;
      newForm.innerHTML = oldForm.innerHTML;
      
      // Replace old form with new one
      if (oldForm.parentNode) {
        oldForm.parentNode.replaceChild(newForm, oldForm);
      }
      
      // Update our reference
      elements.settingsForm = newForm;
    
      // Re-cache elements after form replacement
      cacheElements();
    }
    
    // Clean up any existing listeners (cleanup before adding)
  if (elements.saveButton) {
      console.log('Setting up save button click handler instead of form submit');
      
      // Remove existing listeners (clone and replace technique)
      const oldButton = elements.saveButton;
      const newButton = oldButton.cloneNode(true);
      if (oldButton.parentNode) {
        oldButton.parentNode.replaceChild(newButton, oldButton);
      }
      
      // Update our reference
      elements.saveButton = newButton;
      
      // Add click event to save button instead of submit to form
      elements.saveButton.addEventListener('click', async (e) => {
      e.preventDefault();
        
        // Check if saving is already in progress
        if (elements.saveButton.disabled || 
            elements.saveButton.textContent === 'Saving...' ||
            elements.settingsForm.classList.contains('saving')) {
          console.warn('Save already in progress, ignoring click');
          return;
        }
        
        console.log('Save button clicked, initiating save');
        
        // Disable button immediately to prevent double-clicks
        elements.saveButton.disabled = true;
        elements.saveButton.textContent = 'Saving...';
        
        // Mark form as saving
        elements.settingsForm.classList.add('saving');
        
        // Call save function
        await saveSettings();
      });
      
      console.log('Save button click handler set up successfully');
  } else {
      console.error('Save button not found, falling back to form submit');
      
      // Form submit handler as fallback
      const handleFormSubmit = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Settings form submitted');
        
        // Prevent double submission
        if (e.target.classList.contains('saving')) {
          console.warn('Form is already saving, ignoring submission');
          return;
        }
        
        // Disable form immediately
        e.target.classList.add('saving');
        
        // Call save
        await saveSettings();
      };
      
      // Add single event listener to form
      if (elements.settingsForm) {
        // Remove existing handler by cloning
        const oldForm = elements.settingsForm;
        const newForm = oldForm.cloneNode(true);
        if (oldForm.parentNode) {
          oldForm.parentNode.replaceChild(newForm, oldForm);
        }
        
        // Update reference and re-cache elements
        elements.settingsForm = newForm;
        cacheElements();
        
        // Add new handler
        elements.settingsForm.addEventListener('submit', handleFormSubmit);
    }
  }
  
  // WhatsApp connection buttons
  if (elements.connectButton) {
    elements.connectButton.addEventListener('click', connectWhatsApp);
  }
  
  if (elements.disconnectButton) {
    elements.disconnectButton.addEventListener('click', disconnectWhatsApp);
  }
  
  if (elements.logoutButton) {
    elements.logoutButton.addEventListener('click', logoutWhatsApp);
  }
  
  // Disconnect WhatsApp button
  if (elements.disconnectWhatsAppBtn) {
    elements.disconnectWhatsAppBtn.addEventListener('click', async () => {
      await disconnectWhatsApp();
    });
  }
  
  // Logout WhatsApp button
  if (elements.logoutWhatsAppBtn) {
    elements.logoutWhatsAppBtn.addEventListener('click', async () => {
      await logoutWhatsApp();
    });
    }
  } catch (error) {
    console.error('Error setting up event listeners:', error);
  }
  
  console.log('Event listeners setup complete');
}

/**
 * Load settings from backend
 * @param {boolean} forceFresh - Force a fresh load from backend regardless of view state
 */
export async function loadSettings(forceFresh = false) {
  if (!isViewActive && !forceFresh) {
    console.log('View not active, skipping settings load');
    return;
  }
  
  try {
    console.log('Loading settings from backend...');
    const result = await api.getSettings();
    
    if (result && Object.keys(result).length > 0) {
      console.log('Received settings from backend:', result);
      
      // Extract clean settings
      const cleanSettings = extractCleanSettings(result);
      
      // Update settings cache with clean settings
      settings = cleanSettings;
      
      console.log('Settings updated from backend:', settings);
      
      // Save to localStorage as backup
      saveSettingsToStorage(settings);
      
      // Always update UI when view is active OR when forced
      if (isViewActive || forceFresh) {
        console.log('Updating UI after loading settings...');
      updateSettingsUI();
      }
    } else {
      console.warn('No settings returned from backend, trying localStorage');
      
      // Try to load from localStorage
      const storedSettings = loadSettingsFromStorage();
      if (storedSettings) {
        console.log('Using stored settings from localStorage instead');
        settings = storedSettings;
        
        // Update UI with stored settings
        if (isViewActive || forceFresh) {
          console.log('Updating UI with stored settings...');
        updateSettingsUI();
        }
      } else {
        console.log('No settings found in backend or localStorage');
      }
    }
  } catch (error) {
    console.error('Error loading settings from backend:', error);
    
    // Try to load from localStorage as fallback
    const storedSettings = loadSettingsFromStorage();
    if (storedSettings) {
      console.log('Using stored settings from localStorage as fallback after error');
      settings = storedSettings;
      
      // Update UI with stored settings
      if (isViewActive || forceFresh) {
        console.log('Updating UI with fallback settings...');
      updateSettingsUI();
      }
    }
  }
}

/**
 * Save settings to backend
 */
async function saveSettings() {
  // Variable to hold original button text for restoration
  let originalText = '';
  
  // First check if a save is already in progress
  if (elements.settingsForm && elements.settingsForm.classList.contains('saving')) {
    console.log('Save already in progress but forcing a new save (overriding)');
    // We'll continue anyway, forcing a new save
  }
  
  // Store the original button text
  if (elements.saveButton) {
    originalText = elements.saveButton.textContent;
  }
  
  try {
    console.log('Saving settings...');
    
    // Disable button immediately
    if (elements.saveButton) {
      elements.saveButton.disabled = true;
      elements.saveButton.textContent = 'Saving...';
    }
    
    // Mark form as saving to prevent duplicate submissions
    if (elements.settingsForm) {
      elements.settingsForm.classList.add('saving');
    }
    
    // Refresh elements before collecting values
    cacheElements();
    
    // Validate we have current elements
    if (!elements.activeDaysCheckboxes || !elements.startTime || !elements.endTime) {
      console.error('Critical elements missing, recaching...');
      cacheElements();
      
      // Check again after recaching
      if (!elements.activeDaysCheckboxes || !elements.startTime || !elements.endTime) {
        throw new Error('Unable to find critical form elements');
      }
    }
    
    // Collect and validate form values
    // Get active days from checkboxes
    const activeDays = [];
    elements.activeDaysCheckboxes.forEach(checkbox => {
      if (checkbox.checked) {
        const day = parseInt(checkbox.value);
        if (!isNaN(day)) {
          activeDays.push(day);
        }
      }
    });
    
    console.log('Collected active days from form:', activeDays);
    
    // If no days selected, show error
    if (activeDays.length === 0) {
      showToast('Please select at least one active day', 'error');
      throw new Error('No active days selected');
    }
    
    // Convert time inputs to minutes - handle empty values
    let startTime = 540; // Default 9:00 AM
    let endTime = 1020;  // Default 5:00 PM
    
    if (elements.startTime && elements.startTime.value) {
      const startTimeParts = elements.startTime.value.split(':');
      if (startTimeParts.length >= 2) {
        startTime = (parseInt(startTimeParts[0]) * 60) + parseInt(startTimeParts[1] || 0);
      }
    }
    
    if (elements.endTime && elements.endTime.value) {
      const endTimeParts = elements.endTime.value.split(':');
      if (endTimeParts.length >= 2) {
        endTime = (parseInt(endTimeParts[0]) * 60) + parseInt(endTimeParts[1] || 0);
      }
    }
    
    // Validate time range
    if (startTime >= endTime) {
      showToast('End time must be after start time', 'error');
      throw new Error('End time must be after start time');
    }
    
    // Get message interval with fallback
    let messageInterval = 45; // Default
    if (elements.messageInterval && elements.messageInterval.value) {
      const interval = parseInt(elements.messageInterval.value);
      if (!isNaN(interval) && interval >= 10) {
        messageInterval = interval;
      }
    }
    
    // Get active status
    const isActive = elements.isActive ? elements.isActive.checked : false;
    
    // Prepare settings object
    const updatedSettings = {
      activeDays,
      startTime,
      endTime,
      messageInterval,
      isActive
    };
    
    console.log('Submitting settings update:', updatedSettings);
    
    // Show single notification for saving
    showToast('Saving settings...', 'info');
    
    // Try to save settings
    let result = null;
    
    try {
      // Try primary API method
      if (window.api && window.api.updateSettings) {
        console.log('Using primary API method to save settings');
        result = await window.api.updateSettings(updatedSettings);
      } else {
        throw new Error('Primary API not available');
      }
    } catch (primaryError) {
      console.error('Error with primary save method:', primaryError);
      
      // Try fallback method
      try {
        console.log('Attempting fallback save method...');
        result = await api.updateSettings(updatedSettings);
      } catch (fallbackError) {
        console.error('Fallback save method also failed:', fallbackError);
        throw new Error('All save methods failed');
      }
    }
    
    // Process result
    if (result) {
      console.log('Settings update successful, received:', result);
      
      // Debug log structure of result
      console.log('Result object structure:', JSON.stringify({
        hasDataValues: !!result.dataValues,
        dataValuesType: result.dataValues ? typeof result.dataValues : 'none',
        topLevelKeys: Object.keys(result),
        dataValuesKeys: result.dataValues ? Object.keys(result.dataValues) : [],
        startTime: result.startTime,
        dataValuesStartTime: result.dataValues?.startTime,
        endTime: result.endTime, 
        dataValuesEndTime: result.dataValues?.endTime
      }));
      
      // Extract clean settings from result
      const cleanResult = extractCleanSettings(result);
      
      // Update settings cache with clean result
      settings = cleanResult;
      
      // Save to localStorage as backup
      saveSettingsToStorage(settings);
      
      // Force update UI with new settings
      forceUpdateUI();
      
      // Show single success notification
      showToast('Settings saved successfully', 'success');
      
      // Return true to indicate success
      return true;
    } else {
      throw new Error('No result returned from backend');
    }
  } catch (error) {
    console.error('Save error:', error);
    showToast(`Save failed: ${error.message}`, 'error');
    return false;
  } finally {
    // ALWAYS reset the save button and form state, no matter what happened
    console.log('Resetting save button and form state');
    
    // Wait a moment before resetting to ensure UI updates properly
    setTimeout(() => {
    if (elements.saveButton) {
        try {
      elements.saveButton.disabled = false;
      elements.saveButton.textContent = originalText || 'Save Settings';
        } catch (e) {
          console.error('Error resetting save button:', e);
        }
      }
      
      if (elements.settingsForm) {
        try {
          elements.settingsForm.classList.remove('saving');
    } catch (e) {
          console.error('Error removing saving class from form:', e);
    }
  }
  
      console.log('Save button and form state fully reset');
    }, 300);
  }
}

/**
 * Update settings UI elements with current settings
 */
function updateSettingsUI() {
  console.log('Updating UI with settings:', settings);
  
  // Force fresh element references and wait a bit for DOM
  setTimeout(() => {
  cacheElements();
  
    // Verify we have the elements
    if (!elements.startTime || !elements.endTime) {
      console.warn('Time elements not found, retrying...');
      setTimeout(() => {
        cacheElements();
        performUIUpdate();
      }, 100);
      return;
    }
    
    performUIUpdate();
  }, 50);
}

/**
 * Perform the actual UI update
 */
function performUIUpdate() {
  console.log('Performing UI update with settings:', settings);
  
  // Update checkboxes
  if (elements.activeDaysCheckboxes && elements.activeDaysCheckboxes.length > 0) {
    elements.activeDaysCheckboxes.forEach(checkbox => {
      const dayValue = parseInt(checkbox.value);
      checkbox.checked = settings.activeDays?.includes(dayValue) || false;
      console.log(`Day ${dayValue}: ${checkbox.checked}`);
    });
  } else {
    console.warn('Active days checkboxes not found');
  }
  
  // Update time inputs with proper formatting
  const formatTime = (minutes) => {
    if (typeof minutes !== 'number' || isNaN(minutes)) {
      console.warn('Invalid time value:', minutes);
      return ''; // Return empty string instead of default
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };
  
  if (elements.startTime) {
    const startTimeFormatted = formatTime(settings.startTime);
    elements.startTime.value = startTimeFormatted;
    console.log(`Start time set to: ${startTimeFormatted} (from ${settings.startTime} minutes)`);
  } else {
    console.warn('Start time element not found');
  }
  
  if (elements.endTime) {
    const endTimeFormatted = formatTime(settings.endTime);
    elements.endTime.value = endTimeFormatted;
    console.log(`End time set to: ${endTimeFormatted} (from ${settings.endTime} minutes)`);
  } else {
    console.warn('End time element not found');
  }
  
  // Update other fields
  if (elements.messageInterval) {
    elements.messageInterval.value = settings.messageInterval || '';
    console.log(`Message interval set to: ${settings.messageInterval}`);
  } else {
    console.warn('Message interval element not found');
  }
  
  if (elements.isActive) {
    elements.isActive.checked = settings.isActive || false;
    console.log(`Is active set to: ${settings.isActive}`);
  } else {
    console.warn('Is active element not found - please check HTML structure');
  }
  
  console.log('UI update complete');
}

/**
 * Get the current settings
 * @returns {Object} Current settings
 */
export function getSettings() {
  return { ...settings };
}

/**
 * Connect to WhatsApp
 */
async function connectWhatsApp() {
  try {
    await api.initWhatsApp();
    showToast('Connecting to WhatsApp...', 'info');
  } catch (error) {
    console.error('Error connecting to WhatsApp:', error);
    showToast(`Error: ${error.message}`, 'error');
  }
}

/**
 * Disconnect from WhatsApp
 */
async function disconnectWhatsApp() {
  try {
    await api.disconnectWhatsApp(false);
    showToast('Disconnected from WhatsApp', 'info');
  } catch (error) {
    console.error('Error disconnecting from WhatsApp:', error);
    showToast(`Error: ${error.message}`, 'error');
  }
}

/**
 * Logout from WhatsApp (disconnect and delete session)
 */
async function logoutWhatsApp() {
  try {
    await api.disconnectWhatsApp(true);
    showToast('Logged out from WhatsApp', 'info');
  } catch (error) {
    console.error('Error logging out from WhatsApp:', error);
    showToast(`Error: ${error.message}`, 'error');
  }
}

/**
 * Update WhatsApp status in settings page
 * @param {string} status - WhatsApp status
 * @param {Object} info - Phone info
 */
export function updateWhatsAppStatus(status, info) {
  const statusDisplay = document.getElementById('whatsapp-status-display');
  const qrContainer = document.getElementById('settings-qr-container');
  const connectBtn = document.getElementById('settings-connect-whatsapp');
  const disconnectBtn = document.getElementById('settings-disconnect-whatsapp');
  const logoutBtn = document.getElementById('settings-logout-whatsapp');
  const refreshBtn = document.getElementById('reload-phone-info');
  
  if (!statusDisplay) return;
  
  // Clear previous status classes
  statusDisplay.classList.remove('connected', 'disconnected', 'connecting');
  
  // Update status display
  switch (status) {
    case 'CONNECTED':
      statusDisplay.textContent = 'Connected';
      statusDisplay.classList.add('connected');
      
      // Hide QR code if showing
      if (qrContainer) qrContainer.style.display = 'none';
      
      // Update buttons
      if (connectBtn) connectBtn.style.display = 'none';
      if (disconnectBtn) disconnectBtn.style.display = 'inline-block';
      if (logoutBtn) logoutBtn.style.display = 'inline-block';
    
      // Show refresh button if it doesn't exist
      if (!refreshBtn && info && (info.phoneNumber === 'Unknown' || info.name === 'Unknown')) {
        const buttonContainer = disconnectBtn.parentElement;
        
        // Create refresh button
        const newRefreshBtn = document.createElement('button');
        newRefreshBtn.id = 'reload-phone-info';
        newRefreshBtn.className = 'secondary-btn';
        newRefreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
        newRefreshBtn.title = 'Refresh phone information';
        
        // Add event listener
        newRefreshBtn.addEventListener('click', async () => {
          try {
            // Show loading state
            newRefreshBtn.disabled = true;
            newRefreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
            
            // Call API to refresh phone info
            await window.api.refreshWhatsAppInfo();
            
            // Wait a moment for the info to be processed
            setTimeout(async () => {
              const updatedInfo = await window.api.getWhatsAppInfo();
              updateWhatsAppStatus('CONNECTED', updatedInfo);
              
              // Reset button state
              newRefreshBtn.disabled = false;
              newRefreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
            }, 1000);
          } catch (error) {
            console.error('Error refreshing phone info:', error);
            
            // Reset button state
            newRefreshBtn.disabled = false;
            newRefreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Retry';
          }
        });
        
        // Add to DOM
        buttonContainer.appendChild(newRefreshBtn);
      } else if (refreshBtn && info && info.phoneNumber !== 'Unknown' && info.name !== 'Unknown') {
        // Remove refresh button if we have proper info
        refreshBtn.remove();
      }
      
      break;
    case 'DISCONNECTED':
      statusDisplay.textContent = 'Disconnected';
      statusDisplay.classList.add('disconnected');
      
      // Hide QR code if showing
      if (qrContainer) qrContainer.style.display = 'none';
      
      // Update buttons
      if (connectBtn) connectBtn.style.display = 'inline-block';
      if (disconnectBtn) disconnectBtn.style.display = 'none';
      if (logoutBtn) logoutBtn.style.display = 'none';
      
      // Remove refresh button if it exists
      if (refreshBtn) refreshBtn.remove();
      
      break;
    case 'CONNECTING':
    case 'INITIALIZING':
    case 'NEED_SCAN':
      statusDisplay.textContent = 'Connecting...';
      statusDisplay.classList.add('connecting');
    
    // Update buttons
      if (connectBtn) connectBtn.style.display = 'none';
      if (disconnectBtn) disconnectBtn.style.display = 'inline-block';
      if (logoutBtn) logoutBtn.style.display = 'none';
      
      // Remove refresh button if it exists
      if (refreshBtn) refreshBtn.remove();
      
      break;
    default:
      statusDisplay.textContent = status;
      statusDisplay.classList.add('disconnected');
    
    // Update buttons
      if (connectBtn) connectBtn.style.display = 'inline-block';
      if (disconnectBtn) disconnectBtn.style.display = 'none';
      if (logoutBtn) logoutBtn.style.display = 'none';
      
      // Remove refresh button if it exists
      if (refreshBtn) refreshBtn.remove();
  }
}

// Reset database function
async function resetDatabase() {
  // Show confirmation dialog
  const confirmed = confirm(
    'WARNING: This will reset the database and delete all data!\n\n' +
    'This should only be used if you are experiencing database errors.\n\n' +
    'The application will reload after the reset.\n\n' +
    'Are you sure you want to continue?'
  );
  
  if (!confirmed) return;
  
  try {
    // Show loading state
    const resetBtn = document.getElementById('reset-database-btn');
    if (resetBtn) {
      resetBtn.disabled = true;
      resetBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';
    }
    
    // Call API to reset database
    const result = await window.api.resetDatabase();
    
    if (result.success) {
      alert('Database reset successfully. The application will now reload.');
      // Reload the application
      window.api.reloadApp();
    } else {
      alert(`Error resetting database: ${result.error}`);
      // Reset button state
      if (resetBtn) {
        resetBtn.disabled = false;
        resetBtn.innerHTML = 'Reset Database';
      }
    }
  } catch (error) {
    console.error('Error resetting database:', error);
    alert(`Error resetting database: ${error.message}`);
    
    // Reset button state
    const resetBtn = document.getElementById('reset-database-btn');
    if (resetBtn) {
      resetBtn.disabled = false;
      resetBtn.innerHTML = 'Reset Database';
    }
  }
} 