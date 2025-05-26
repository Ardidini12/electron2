const { ipcRenderer, contextBridge } = require('electron');

// Log when preload script starts executing
console.log('Preload script starting...');

// Wait for DOM content loaded to ensure the page is ready for API
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM content loaded in preload script, ensuring API is available');
});

// Function to safely expose API
function exposeAPI() {
  try {
    // Create the API object with all methods
    const apiObject = {
      // File operations
      showFileDialog: (options) => ipcRenderer.invoke('select-file', options),
      readFile: (path, options) => ipcRenderer.invoke('read-file', path, options),
      getAppPath: () => ipcRenderer.invoke('get-app-path'),
      getStoragePath: () => ipcRenderer.invoke('get-storage-path'),
      
      // Contact operations
      getContacts: () => ipcRenderer.invoke('get-contacts'),
      getContactsPaginated: (page, limit, search) => ipcRenderer.invoke('get-contacts-paginated', page, limit, search),
      getContact: (id) => ipcRenderer.invoke('get-contact', id),
      createContact: (contact) => ipcRenderer.invoke('add-contact', contact),
      updateContact: (id, contact) => ipcRenderer.invoke('update-contact', id, contact),
      deleteContact: (id) => ipcRenderer.invoke('delete-contact', id),
      deleteContactsBulk: (contactIds) => ipcRenderer.invoke('delete-contacts-bulk', contactIds),
      parseContactsFile: (filePath, fileType) => ipcRenderer.invoke('parse-contacts-file', filePath, fileType),
      importContactsFromData: (contacts, source) => ipcRenderer.invoke('import-contacts-from-data', contacts, source),
      exportContacts: (format, path) => ipcRenderer.invoke('export-contacts', format, path),
      checkDuplicatePhone: (phone, originalPhone) => ipcRenderer.invoke('check-duplicate-phone', phone, originalPhone),
      
      // Template operations
      getTemplates: () => ipcRenderer.invoke('get-templates'),
      getTemplate: (id) => ipcRenderer.invoke('get-template', id),
      createTemplate: (template) => ipcRenderer.invoke('create-template', template),
      updateTemplate: (id, template) => ipcRenderer.invoke('update-template', id, template),
      deleteTemplate: (id) => ipcRenderer.invoke('delete-template', id),
      
      // WhatsApp operations
      initWhatsApp: (forceNewQR = false) => ipcRenderer.invoke('init-whatsapp', forceNewQR),
      getWhatsAppStatus: () => ipcRenderer.invoke('get-whatsapp-status'),
      disconnectWhatsApp: (deleteSession) => ipcRenderer.invoke('disconnect-whatsapp', deleteSession),
      getWhatsAppInfo: () => ipcRenderer.invoke('get-whatsapp-info'),
      
      // Message operations
      sendMessage: (message) => ipcRenderer.invoke('send-message', message),
      scheduleMessages: (messages) => ipcRenderer.invoke('schedule-messages', messages),
      getScheduledMessages: () => ipcRenderer.invoke('get-scheduled-messages'),
      getScheduledMessage: (id) => ipcRenderer.invoke('get-scheduled-message', id),
      updateScheduledMessage: (id, message) => ipcRenderer.invoke('update-scheduled-message', id, message),
      deleteScheduledMessage: (id) => ipcRenderer.invoke('delete-scheduled-message', id),
      cancelScheduledMessage: (id) => ipcRenderer.invoke('cancel-scheduled-message', id),
      retryFailedMessage: (id) => ipcRenderer.invoke('retry-failed-message', id),
      
      // Settings operations
      getSettings: () => ipcRenderer.invoke('get-settings'),
      updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
      
      // Debug operations
      reloadApp: () => ipcRenderer.invoke('reload-app'),
      isApiAvailable: () => true, // This will always be true if the API is exposed
      
      // Event listeners
      on: (channel, callback) => {
        // Whitelist channels that can be listened to
        const validChannels = [
          'whatsapp-status', 
          'whatsapp-qr', 
          'whatsapp-ready',
          'whatsapp-authenticated',
          'whatsapp-disconnected',
          'whatsapp-info', 
          'whatsapp-session-check',
          'message-sent', 
          'message-error', 
          'message-status-update',
          'import-progress',
          'delete-progress',
          'export-progress'
        ];
        if (validChannels.includes(channel)) {
          // Add listener, wrapping to avoid exposing ipcRenderer
          const subscription = (event, ...args) => callback(...args);
          ipcRenderer.on(channel, subscription);
          // Return a function to remove the listener
          return () => {
            ipcRenderer.removeListener(channel, subscription);
          };
        }
      },
      removeAllListeners: (channel) => {
        const validChannels = [
          'whatsapp-status', 
          'whatsapp-qr', 
          'whatsapp-ready',
          'whatsapp-authenticated',
          'whatsapp-disconnected',
          'whatsapp-info', 
          'whatsapp-session-check',
          'message-sent', 
          'message-error', 
          'message-status-update',
          'import-progress',
          'delete-progress',
          'export-progress'
        ];
        if (validChannels.includes(channel)) {
          ipcRenderer.removeAllListeners(channel);
        }
      }
    };
    
    // Expose the API object to the renderer
    contextBridge.exposeInMainWorld('api', apiObject);
    
    // Explicitly set apiReady flag to true
    contextBridge.exposeInMainWorld('apiReady', true);
    
    // Function to dispatch API ready event
    const dispatchApiReadyEvent = () => {
      const apiReadyEvent = new CustomEvent('api-ready', { detail: { success: true } });
      document.dispatchEvent(apiReadyEvent);
      console.log('API ready event dispatched');
    };
    
    // Dispatch event immediately if document is ready, otherwise wait for DOMContentLoaded
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', dispatchApiReadyEvent);
    } else {
      dispatchApiReadyEvent();
    }
    
    console.log('API successfully exposed to renderer process');
  } catch (error) {
    console.error('Failed to expose API:', error);
    // Try to notify renderer of failure
    const dispatchApiFailedEvent = () => {
      const apiFailEvent = new CustomEvent('api-failed', { detail: { error: error.message } });
      document.dispatchEvent(apiFailEvent);
    };
    
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', dispatchApiFailedEvent);
    } else {
      dispatchApiFailedEvent();
    }
  }
}

// Expose the API immediately
exposeAPI();

// Log when preload script completes
console.log('Preload script completed'); 