// api.js - API access utilities

// Track if we've already warned about API issues
let apiWarningShown = false;
let apiInitialized = false;

// Initialize a promise for API readiness
const apiReadyPromise = window.esmApi ? window.esmApi.waitForESMApi(3000).then(api => {
  apiInitialized = true;
  console.log('API initialized successfully');
  return api;
}).catch(error => {
  console.error('Failed to initialize API:', error);
  throw error;
}) : Promise.reject(new Error('ESM API not available'));

/**
 * Get the API instance
 * @returns {Object} The API object
 * @throws {Error} If API is not available
 */
export function getAPI() {
  if (!window.api) {
    if (!apiWarningShown) {
      console.error('API not available. Make sure the application is properly initialized.');
      apiWarningShown = true;
    }
    throw new Error('API not available. Make sure the application is properly initialized.');
  }
  return window.api;
}

/**
 * Check if the API is available
 * @returns {boolean} True if API is available
 */
export function isAPIAvailable() {
  return !!window.api;
}

/**
 * Wait for API to become available
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} The API object
 */
export async function waitForAPI(timeout = 3000) {
  try {
    // Use the pre-initialized promise
    return await apiReadyPromise;
  } catch (error) {
    console.warn('API initialization failed, attempting fallback method:', error);
    
    // Fallback method - direct check with short timeout
    return new Promise((resolve, reject) => {
      // Check if API is already available
      if (window.api) {
        resolve(window.api);
        return;
      }

      // Set up a timeout to reject the promise
      const timeoutId = setTimeout(() => {
        const errorMsg = 'API not available after timeout';
        console.error(errorMsg);
        reject(new Error(errorMsg));
      }, timeout);

      // Add event listener for API ready event
      const apiReadyHandler = () => {
        clearTimeout(timeoutId);
        resolve(window.api);
      };
      
      document.addEventListener('api-ready', apiReadyHandler, { once: true });
      
      // Also check periodically as a last resort
      const checkInterval = setInterval(() => {
        if (window.api) {
          clearTimeout(timeoutId);
          clearInterval(checkInterval);
          document.removeEventListener('api-ready', apiReadyHandler);
          resolve(window.api);
        }
      }, 20);
    });
  }
}

// API extension methods
const apiExtensions = {
  /**
   * Get the total count of contacts
   * @returns {Promise<Object>} Response with count
   */
  async getContactsCount() {
    const api = await waitForAPI();
    try {
      const response = await api.getContactsCount();
      return { success: true, count: response.count };
    } catch (error) {
      console.error('Error getting contacts count:', error);
      return { success: false, error: error.message, count: 0 };
    }
  },

  /**
   * Export contacts in the specified format
   * @param {string} format - The export format ('json', 'csv', or 'excel')
   * @returns {Promise<Object>} Response with success status and file path
   */
  async exportContacts(format) {
    const api = await waitForAPI();
    try {
      // Call the appropriate API method based on format
      let response;
      switch (format.toLowerCase()) {
        case 'json':
          response = await api.exportContactsJson();
          break;
        case 'csv':
          response = await api.exportContactsCsv();
          break;
        case 'excel':
          response = await api.exportContactsExcel();
          break;
        default:
          throw new Error(`Unsupported export format: ${format}`);
      }
      
      return {
        success: true,
        filePath: response.filePath,
        format: format
      };
    } catch (error) {
      console.error(`Error exporting contacts as ${format}:`, error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * Delete all contacts
   * @returns {Promise<Object>} Response with success status
   */
  async deleteAllContacts() {
    const api = await waitForAPI();
    try {
      const response = await api.deleteAllContacts();
      return { success: true, count: response.count };
    } catch (error) {
      console.error('Error deleting all contacts:', error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * Delete multiple contacts by ID
   * @param {Array<string|number>} ids - Array of contact IDs to delete
   * @returns {Promise<Object>} Response with success status
   */
  async deleteContacts(ids) {
    const api = await waitForAPI();
    try {
      const response = await api.deleteContacts(ids);
      return { success: true, count: response.count };
    } catch (error) {
      console.error('Error deleting contacts:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Get all templates
   * @returns {Promise<Array>} Array of templates
   */
  async getTemplates() {
    const api = await waitForAPI();
    try {
      const response = await api.getTemplates();
      return response;
    } catch (error) {
      console.error('Error getting templates:', error);
      throw error;
    }
  },

  /**
   * Get a template by ID
   * @param {number} id - Template ID
   * @returns {Promise<Object>} Template object
   */
  async getTemplateById(id) {
    const api = await waitForAPI();
    try {
      return await api.getTemplate(id);
    } catch (error) {
      console.error(`Error getting template with ID ${id}:`, error);
      throw error;
    }
  },

  /**
   * Create a new template
   * @param {Object} templateData - Template data (name, content, imagePath)
   * @returns {Promise<Object>} Created template
   */
  async addTemplate(templateData) {
    const api = await waitForAPI();
    try {
      return await api.createTemplate(templateData);
    } catch (error) {
      console.error('Error creating template:', error);
      throw error;
    }
  },

  /**
   * Update an existing template
   * @param {number} id - Template ID
   * @param {Object} templateData - Updated template data (name, content, newImagePath)
   * @returns {Promise<Object>} Updated template
   */
  async updateTemplate(id, templateData) {
    const api = await waitForAPI();
    try {
      return await api.updateTemplate(id, templateData);
    } catch (error) {
      console.error(`Error updating template with ID ${id}:`, error);
      throw error;
    }
  },

  /**
   * Delete a template by ID
   * @param {number} id - Template ID
   * @returns {Promise<boolean>} True if deleted successfully
   */
  async deleteTemplate(id) {
    const api = await waitForAPI();
    try {
      return await api.deleteTemplate(id);
    } catch (error) {
      console.error(`Error deleting template with ID ${id}:`, error);
      throw error;
    }
  },

  /**
   * Show a file open dialog using Electron's dialog
   * @param {Object} options - Dialog options
   * @returns {Promise<Object>} Selected file information
   */
  async showOpenDialog(options) {
    const api = await waitForAPI();
    try {
      return await api.showOpenDialog(options);
    } catch (error) {
      console.error('Error showing file dialog:', error);
      throw error;
    }
  },

  /**
   * Select a file using the system's file dialog (alias for showOpenDialog)
   * @param {Object} options - File dialog options
   * @returns {Promise<Object>} Selected file information
   */
  async selectFile(options) {
    return this.showOpenDialog(options);
  },

  /**
   * Get the application settings
   * @returns {Promise<Object>} Settings object
   */
  async getSettings() {
    const api = await waitForAPI();
    try {
      console.log('Fetching settings from main process...');
      const settings = await api.getSettings();
      console.log('Settings received from main process:', settings);
      
      // Process settings to ensure proper format
      if (settings) {
        // Ensure activeDays is an array
        if (settings.activeDays && typeof settings.activeDays === 'string') {
          try {
            settings.activeDays = JSON.parse(settings.activeDays);
          } catch (e) {
            console.error('Error parsing activeDays in API:', e);
            settings.activeDays = [1, 2, 3, 4, 5]; // Default to Mon-Fri
          }
        }
        
        // If activeDays is not an array at this point, set default
        if (!Array.isArray(settings.activeDays)) {
          settings.activeDays = [1, 2, 3, 4, 5];
        }
      }
      
      return settings;
    } catch (error) {
      console.error('Error getting settings:', error);
      throw error;
    }
  },
  
  /**
   * Update the application settings
   * @param {Object} settings - The settings object to update
   * @returns {Promise<Object>} Updated settings
   */
  async updateSettings(settings) {
    const api = await waitForAPI();
    try {
      console.log('Sending settings update to main process:', settings);
      
      // Ensure activeDays is properly formatted before sending
      const settingsToSend = { ...settings };
      
      // Make sure activeDays is an array
      if (settingsToSend.activeDays) {
        if (!Array.isArray(settingsToSend.activeDays)) {
          if (typeof settingsToSend.activeDays === 'string') {
            try {
              settingsToSend.activeDays = JSON.parse(settingsToSend.activeDays);
            } catch (e) {
              console.error('Error parsing activeDays string:', e);
              settingsToSend.activeDays = [1, 2, 3, 4, 5]; // Default
            }
          } else {
            settingsToSend.activeDays = [1, 2, 3, 4, 5]; // Default
          }
        }
      }
      
      const updatedSettings = await api.updateSettings(settingsToSend);
      console.log('Settings updated successfully, received:', updatedSettings);
      
      // Process received settings
      if (updatedSettings) {
        // Ensure activeDays is an array
        if (updatedSettings.activeDays && typeof updatedSettings.activeDays === 'string') {
          try {
            updatedSettings.activeDays = JSON.parse(updatedSettings.activeDays);
          } catch (e) {
            console.error('Error parsing activeDays in update response:', e);
            updatedSettings.activeDays = [1, 2, 3, 4, 5];
          }
        }
        
        // If activeDays is not an array at this point, set default
        if (!Array.isArray(updatedSettings.activeDays)) {
          updatedSettings.activeDays = [1, 2, 3, 4, 5];
        }
      }
      
      return updatedSettings;
    } catch (error) {
      console.error('Error updating settings:', error);
      throw error;
    }
  }
};

// Create a safe proxy for API calls
const createSafeApiProxy = () => {
  return new Proxy({}, {
    get(target, prop) {
      // Check if we have an extension method
      if (apiExtensions[prop]) {
        return apiExtensions[prop];
      }
      
      // Return a function that handles the method call
      return async (...args) => {
        try {
          // Get the API, waiting if necessary
          const api = await waitForAPI();
          
          // Check if the method exists
          if (typeof api[prop] !== 'function') {
            throw new Error(`API method ${prop} is not a function`);
          }
          
          // Call the method
          return await api[prop](...args);
        } catch (error) {
          console.error(`Error calling API method ${prop}:`, error);
          throw error;
        }
      };
    }
  });
};

// Export a convenience object that safely proxies all API calls
export const api = createSafeApiProxy(); 