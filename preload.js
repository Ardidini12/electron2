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
      showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
      selectFile: (options) => ipcRenderer.invoke('select-file', options),
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
      importContacts: (filePath, fileType) => ipcRenderer.invoke('import-contacts', filePath, fileType),
      exportContacts: (format) => {
        switch (format.toLowerCase()) {
          case 'json':
            return ipcRenderer.invoke('export-contacts-json');
          case 'csv':
            return ipcRenderer.invoke('export-contacts-csv');
          case 'excel':
            return ipcRenderer.invoke('export-contacts-excel');
          default:
            return Promise.reject(new Error(`Unsupported export format: ${format}`));
        }
      },
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
      refreshWhatsAppInfo: () => ipcRenderer.invoke('refresh-whatsapp-info'),
      setAutoConnectWhatsApp: (enabled) => ipcRenderer.invoke('set-auto-connect-whatsapp', enabled),
      getAutoConnectWhatsApp: () => ipcRenderer.invoke('get-auto-connect-whatsapp'),
      checkWhatsAppRequirements: () => ipcRenderer.invoke('check-whatsapp-requirements'),
      resetWhatsAppSession: () => ipcRenderer.invoke('reset-whatsapp-session'),
      repairWhatsAppConnection: () => ipcRenderer.invoke('repair-whatsapp-connection'),
      getWhatsAppDiagnostics: () => ipcRenderer.invoke('get-whatsapp-diagnostics'),
      restartWhatsAppService: () => ipcRenderer.invoke('restart-whatsapp-service'),
      
      // Sales API operations
      getSalesContacts: (options) => ipcRenderer.invoke('get-sales-contacts', options),
      startSalesSync: () => ipcRenderer.invoke('start-sales-sync'),
      stopSalesSync: () => ipcRenderer.invoke('stop-sales-sync'),
      getSalesSyncStatus: () => ipcRenderer.invoke('get-sales-sync-status'),
      deleteSalesContacts: (ids) => ipcRenderer.invoke('delete-sales-contacts', ids),
      deleteAllSalesContacts: () => ipcRenderer.invoke('delete-all-sales-contacts'),
      getAvailableCities: () => ipcRenderer.invoke('get-available-cities'),
      manualSalesRecovery: (startDate, endDate) => ipcRenderer.invoke('manual-sales-recovery', startDate, endDate),
      
      // Sales message operations
      getSalesMessageSettings: () => ipcRenderer.invoke('get-sales-message-settings'),
      updateSalesMessageSettings: (settings) => ipcRenderer.invoke('update-sales-message-settings', settings),
      getSalesMessageTemplates: () => ipcRenderer.invoke('get-sales-message-templates'),
      updateSalesMessageTemplate: (type, template) => ipcRenderer.invoke('update-sales-message-template', type, template),
      getScheduledSalesMessages: (page, limit, status) => ipcRenderer.invoke('get-scheduled-sales-messages', page, limit, status),
      deleteSalesMessages: (ids) => ipcRenderer.invoke('delete-sales-messages', ids),
      processPendingSalesMessages: () => ipcRenderer.invoke('process-pending-sales-messages'),
      processPendingMessages: () => ipcRenderer.invoke('process-pending-sales-messages'),
      
      // Message operations
      getScheduledMessages: (status) => ipcRenderer.invoke('get-scheduled-messages', status),
      getScheduledMessage: (id) => ipcRenderer.invoke('get-scheduled-message', id),
      updateScheduledMessage: (id, message) => ipcRenderer.invoke('update-scheduled-message', id, message),
      deleteScheduledMessage: (id) => ipcRenderer.invoke('delete-scheduled-message', id),
      cancelScheduledMessage: (id) => ipcRenderer.invoke('cancel-scheduled-message', id),
      retryMessage: (id) => ipcRenderer.invoke('retry-message', id),
      scheduleMessages: (config) => ipcRenderer.invoke('schedule-messages', config),
      deleteMessages: (ids) => ipcRenderer.invoke('delete-messages', ids),
      
      // Settings operations
      getSettings: () => ipcRenderer.invoke('get-settings'),
      updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
      
      // Debug operations
      reloadApp: () => ipcRenderer.invoke('reload-app'),
      isApiAvailable: () => true, // This will always be true if the API is exposed
      
      // Database management
      resetDatabase: () => ipcRenderer.invoke('reset-database'),
      recoverDatabase: () => ipcRenderer.invoke('recover-database'),
      
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
          'whatsapp-error',
          'whatsapp-suggestions',
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
          'whatsapp-error',
          'whatsapp-suggestions',
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
      },
      
      // Contacts
      getContactsPaginated: (page, limit, search) => ipcRenderer.invoke('get-contacts-paginated', page, limit, search),
      getContact: (id) => ipcRenderer.invoke('get-contact', id),
      createContact: (contact) => ipcRenderer.invoke('add-contact', contact),
      updateContact: (id, contact) => ipcRenderer.invoke('update-contact', id, contact),
      deleteContact: (id) => ipcRenderer.invoke('delete-contact', id),
      importContacts: (filePath, fileType) => ipcRenderer.invoke('import-contacts', filePath, fileType),
      getContactsCount: () => ipcRenderer.invoke('get-contacts-count'),
      exportContactsJson: () => ipcRenderer.invoke('export-contacts-json'),
      exportContactsCsv: () => ipcRenderer.invoke('export-contacts-csv'),
      exportContactsExcel: () => ipcRenderer.invoke('export-contacts-excel'),
      deleteAllContacts: () => ipcRenderer.invoke('delete-all-contacts'),
      deleteContacts: (ids) => ipcRenderer.invoke('delete-contacts', ids),
      parseContactsFile: (filePath, fileType) => ipcRenderer.invoke('parse-contacts-file', filePath, fileType),
      importContactsFromData: (contacts, source) => ipcRenderer.invoke('import-contacts-from-data', contacts, source)
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