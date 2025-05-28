// Main Application JavaScript
// This is the entry point for the renderer process

// Import module loader
import { setupModuleSupport } from './modules/utils/moduleLoader.js';
import { waitForAPI, isAPIAvailable } from './modules/utils/api.js';

// Global state
let appInitialized = false;
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 3;

// Listen for API ready event
document.addEventListener('api-ready', () => {
  console.log('Received api-ready event in app.js');
  if (!appInitialized) {
    initializeApp();
  }
});

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('DOM content loaded, initializing application...');
    
    // Setup module support
    setupModuleSupport();
    
    // Set up reload button immediately
    setupReloadButton();
    
    // Initialize the application
    await initializeApp();
  } catch (error) {
    console.error('Failed to initialize application:', error);
    showErrorScreen(error);
  }
});

/**
 * Initialize the application with retry capability
 */
async function initializeApp() {
  try {
    initializationAttempts++;
    console.log(`Initialization attempt ${initializationAttempts}/${MAX_INIT_ATTEMPTS}`);
    
    // Initialize ESM wrapper
    const esmContext = window.esmApi.initESM();
    console.log('ESM context initialized:', esmContext.isNodeEnvironment ? 'Node environment' : 'Browser environment');
    
    // Wait for API to be available with a shorter timeout
    const timeout = 3000;
    console.log(`Waiting for API to be available (timeout: ${timeout}ms)...`);
    
    // Try to wait for API
    try {
      await waitForAPI(timeout);
    } catch (apiError) {
      console.error('Error waiting for API:', apiError);
      
      // Check if API is available despite the error
      if (!isAPIAvailable()) {
        if (initializationAttempts < MAX_INIT_ATTEMPTS) {
          console.log(`API not available, retrying initialization (attempt ${initializationAttempts}/${MAX_INIT_ATTEMPTS})...`);
          // Use setTimeout to give a small delay before retry
          setTimeout(() => initializeApp(), 200);
          return;
        }
        throw new Error('API not available after multiple attempts');
      }
    }
    
    console.log('API is available:', window.api ? 'Yes' : 'No');
    
    // Import modules dynamically to ensure they load correctly
    console.log('Loading application modules...');
    const modules = await loadAppModules();
    
    // Initialize the application with loaded modules
    console.log('Modules loaded, starting application...');
    startApp(modules);
    
    appInitialized = true;
    
    // Hide loading screen if it's still visible
    showApp();
  } catch (error) {
    console.error(`Application initialization failed (attempt ${initializationAttempts}/${MAX_INIT_ATTEMPTS}):`, error);
    
    // Retry initialization if we haven't reached the maximum attempts
    if (initializationAttempts < MAX_INIT_ATTEMPTS) {
      console.log('Retrying application initialization...');
      // Use setTimeout to give a small delay before retry
      setTimeout(() => initializeApp(), 500);
      return;
    }
    
    throw error;
  }
}

/**
 * Load all application modules
 */
async function loadAppModules() {
  try {
    const [
      dashboardModule,
      notificationsModule,
      whatsAppModule,
      contactsModule,
      helpersModule,
      templatesModule,
      settingsModule,
      bulkSenderModule,
      scheduledModule
    ] = await Promise.all([
      import('./modules/dashboard/dashboard.js'),
      import('./modules/ui/notifications.js'),
      import('./modules/whatsapp/whatsapp.js'),
      import('./modules/contacts/contacts.js'),
      import('./modules/utils/helpers.js'),
      import('./modules/templates/templates.js'),
      import('./modules/settings/settings.js'),
      import('./modules/bulksender/bulksender.js'),
      import('./modules/scheduled/scheduled.js')
    ]);
    
    return {
      // Dashboard functions
      initDashboard: dashboardModule.initDashboard,
      updateDashboardStats: dashboardModule.updateDashboardStats,
      loadRecentActivity: dashboardModule.loadRecentActivity,
      
      // Notifications functions
      setupNotifications: notificationsModule.setupNotifications,
      showNotification: notificationsModule.showNotification,
      
      // WhatsApp functions
      setupWhatsAppConnection: whatsAppModule.setupWhatsAppConnection,
      checkWhatsAppStatus: whatsAppModule.checkWhatsAppStatus,
      updateWhatsAppStatus: whatsAppModule.updateWhatsAppStatus,
      
      // Contacts functions
      initContacts: contactsModule.initContacts,
      loadContactsPaginated: contactsModule.loadContactsPaginated,
      openContactModal: contactsModule.openContactModal,
      openImportModal: contactsModule.openImportModal,
      deleteContact: contactsModule.deleteContact,
      deleteSelectedContacts: contactsModule.deleteSelectedContacts,
      
      // Templates functions
      initTemplates: templatesModule.initTemplates,
      loadTemplates: templatesModule.loadTemplates,
      
      // Settings functions
      initSettings: settingsModule.initSettings,
      refreshSettings: settingsModule.refreshSettings,
      loadSettings: settingsModule.loadSettings,
      getSettings: settingsModule.getSettings,
      updateWhatsAppStatusInSettings: settingsModule.updateWhatsAppStatus,
      destroySettings: settingsModule.destroySettings,
      
      // Bulk Sender functions
      initBulkSender: bulkSenderModule.initBulkSender,
      refreshBulkSender: bulkSenderModule.refreshBulkSender,
      
      // Scheduled Messages functions
      initScheduled: scheduledModule.initScheduled,
      loadScheduledMessages: scheduledModule.loadScheduledMessages,
      updateMessageStatus: scheduledModule.updateMessageStatus,
      
      // Helpers
      helpers: helpersModule
    };
  } catch (error) {
    console.error('Error loading modules:', error);
    throw new Error(`Failed to load application modules: ${error.message}`);
  }
}

/**
 * Start the application with loaded modules
 */
function startApp(modules) {
  console.log('Initializing application components...');
  
  // Set up navigation
  setupNavigation(modules);
  
  // Initialize notifications
  modules.setupNotifications();
  
  // Initialize each section
  modules.initDashboard();
  modules.initContacts();
  modules.initTemplates();
  modules.initSettings();
  modules.initBulkSender();
  modules.initScheduled();
  
  // Set up WhatsApp connection
  modules.setupWhatsAppConnection();
  
  // Check WhatsApp status
  modules.checkWhatsAppStatus();
  
  // Set up event listener for message status updates
  window.api.on('message-status-update', (update) => {
    modules.updateMessageStatus(update);
  });
  
  // Show a notification that the app has started
  modules.showNotification('Application Started', 'BSSender has been initialized successfully.', 'success', 3000);
}

/**
 * Show error screen when initialization fails
 */
function showErrorScreen(error) {
  // Check if this is a database error
  const isDatabaseError = error.message && (
    error.message.includes('database') ||
    error.message.includes('SQLITE_ERROR') ||
    error.message.includes('no such column') ||
    error.message.includes('table') ||
    error.message.includes('sequelize')
  );
  
  const errorTitle = isDatabaseError ? 'Database Error Detected' : 'Error Loading Application';
  const errorDescription = isDatabaseError 
    ? 'There was an error with the database. This might be due to schema changes or a corrupted database file.' 
    : 'There was an error loading the application modules. Please try restarting the application.';
  
  document.body.innerHTML = `
    <div style="padding: 20px; text-align: center;">
      <h1>${errorTitle}</h1>
      <p>${errorDescription}</p>
      <pre style="background: #f8f8f8; padding: 10px; text-align: left; overflow: auto; max-height: 200px;">${error.message}</pre>
      <div style="margin-top: 20px; display: flex; flex-direction: ${isDatabaseError ? 'column' : 'row'}; gap: 10px; justify-content: center;">
        <button id="reload-app-error" style="padding: 10px 20px; cursor: pointer; background: #4CAF50; color: white; border: none; border-radius: 4px;">
          Reload Application
        </button>
        
        ${isDatabaseError ? `
          <button id="recover-database" style="padding: 10px 20px; margin-top: 10px; cursor: pointer; background: #2196F3; color: white; border: none; border-radius: 4px;">
            Recover Database (Keeps Data)
          </button>
          <button id="reset-database" style="padding: 10px 20px; margin-top: 10px; cursor: pointer; background: #FF9800; color: white; border: none; border-radius: 4px;">
            Reset Database (WARNING: Deletes All Data)
          </button>
          <p style="margin-top: 15px; color: #f44336; font-weight: bold;">
            Only use Reset Database as a last resort if Recovery doesn't work
          </p>
        ` : ''}
        
        <button id="force-reload-app" style="padding: 10px 20px; margin-top: ${isDatabaseError ? '20px' : '0'}; cursor: pointer; background: #f44336; color: white; border: none; border-radius: 4px;">
          Force Reload
        </button>
      </div>
    </div>
  `;
  
  // Add event listener to reload button
  const reloadButton = document.getElementById('reload-app-error');
  if (reloadButton) {
    reloadButton.addEventListener('click', () => {
      if (window.api && window.api.reloadApp) {
        window.api.reloadApp().catch(() => window.location.reload());
      } else {
        window.location.reload();
      }
    });
  }
  
  // Add database recovery button handler
  if (isDatabaseError) {
    const recoverButton = document.getElementById('recover-database');
    if (recoverButton && window.api && window.api.recoverDatabase) {
      recoverButton.addEventListener('click', async () => {
        try {
          recoverButton.disabled = true;
          recoverButton.textContent = 'Recovering...';
          
          const result = await window.api.recoverDatabase();
          
          if (result && result.success) {
            alert('Database recovered successfully. The application will now reload.');
            window.location.reload();
          } else {
            alert(`Recovery failed: ${result.error || 'Unknown error'}`);
            recoverButton.disabled = false;
            recoverButton.textContent = 'Recover Database (Keeps Data)';
          }
        } catch (error) {
          alert(`Error during recovery: ${error.message}`);
          recoverButton.disabled = false;
          recoverButton.textContent = 'Recover Database (Keeps Data)';
        }
      });
    }
    
    const resetButton = document.getElementById('reset-database');
    if (resetButton && window.api && window.api.resetDatabase) {
      resetButton.addEventListener('click', async () => {
        if (confirm('WARNING: This will delete all your data and reset the database to factory defaults. Are you absolutely sure?')) {
          try {
            resetButton.disabled = true;
            resetButton.textContent = 'Resetting...';
            
            const result = await window.api.resetDatabase();
            
            if (result && result.success) {
              alert('Database reset successfully. The application will now reload.');
              window.location.reload();
            } else {
              alert(`Reset failed: ${result.error || 'Unknown error'}`);
              resetButton.disabled = false;
              resetButton.textContent = 'Reset Database (WARNING: Deletes All Data)';
            }
          } catch (error) {
            alert(`Error during reset: ${error.message}`);
            resetButton.disabled = false;
            resetButton.textContent = 'Reset Database (WARNING: Deletes All Data)';
          }
        }
      });
    }
  }
  
  // Add event listener to force reload button
  const forceReloadButton = document.getElementById('force-reload-app');
  if (forceReloadButton) {
    forceReloadButton.addEventListener('click', () => {
      window.location.reload(true); // Force reload from server
    });
  }
}

/**
 * Set up navigation system
 */
function setupNavigation(modules) {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.content-section');
  
  // Track the currently active section
  let currentActiveSection = document.querySelector('.content-section.active')?.id || null;
  
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetId = item.getAttribute('data-target');
      const prevSection = currentActiveSection;
      currentActiveSection = targetId;
      
      // Update active navigation item
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      
      console.log(`Navigation: switching from "${prevSection}" to "${targetId}"`);
      
      // Clean up previous section if needed
      if (prevSection === 'settings' && targetId !== 'settings') {
        // Clean up settings when navigating away
        console.log('Cleaning up settings module on navigation away');
        try {
          modules.destroySettings();
        } catch (error) {
          console.error('Error cleaning up settings module:', error);
        }
      }
      
      // Show target section
      sections.forEach(section => {
        section.classList.remove('active');
        
        if (section.id === targetId) {
          section.classList.add('active');
          console.log(`Section "${targetId}" is now active`);
          
          // Perform section-specific actions when activated
          switch (targetId) {
            case 'contacts':
              console.log('Contacts section activated, reloading contacts...');
              setTimeout(() => {
                modules.loadContactsPaginated();
              }, 100); // Small delay to ensure DOM is updated
              break;
            
            case 'templates':
              console.log('Templates section activated, reloading templates...');
              setTimeout(() => {
                modules.loadTemplates();
              }, 100); // Small delay to ensure DOM is updated
              break;
            
            case 'dashboard':
              console.log('Dashboard section activated, updating stats...');
              modules.updateDashboardStats();
              modules.loadRecentActivity();
              break;
            
            case 'bulk-sender':
              console.log('Bulk Sender section activated, refreshing data...');
              setTimeout(() => {
                modules.refreshBulkSender();
              }, 100); // Small delay to ensure DOM is updated
              break;
            
            case 'scheduled':
              console.log('Scheduled Messages section activated, loading messages...');
              setTimeout(() => {
                modules.loadScheduledMessages();
              }, 100); // Small delay to ensure DOM is updated
              break;
            
            case 'settings':
              console.log('Settings section activated, refreshing settings...');
              // Force settings refresh when entering the view
              setTimeout(async () => {
                try {
                  // Use refreshSettings instead of initSettings for more reliable UI updates
                  if (modules.refreshSettings) {
                    await modules.refreshSettings();
                    console.log('Settings refreshed successfully upon tab activation');
                  } else {
                    // Fallback to init if refresh not available
                    await modules.initSettings();
                    console.log('Settings initialized successfully upon tab activation');
                  }
                } catch (error) {
                  console.error('Error refreshing settings upon tab activation:', error);
                }
              }, 100); // Small delay to ensure DOM is updated
              break;
          }
        }
      });
    });
  });
  
  // Check if we need to initialize the default section
  const currentActiveNav = document.querySelector('.nav-item.active');
  if (currentActiveNav) {
    const targetId = currentActiveNav.getAttribute('data-target');
    console.log(`Initial active section: "${targetId}"`);
    
    // Perform section-specific initialization based on the active section
    switch (targetId) {
      case 'contacts':
      // Ensure contacts are loaded on initial page load if contacts section is active
      setTimeout(() => {
        modules.loadContactsPaginated();
      }, 500); // Longer delay for initial page load
        break;
      
      case 'templates':
        setTimeout(() => {
          modules.loadTemplates();
        }, 500);
        break;
      
      case 'bulk-sender':
        setTimeout(() => {
          modules.refreshBulkSender();
        }, 500);
        break;
      
      case 'scheduled':
        setTimeout(() => {
          modules.loadScheduledMessages();
        }, 500);
        break;
      
      case 'settings':
        setTimeout(() => {
          // Use refreshSettings instead of initSettings for more reliable UI updates
          if (modules.refreshSettings) {
            modules.refreshSettings();
          } else {
            modules.initSettings();
          }
        }, 500);
        break;
    }
  }
}

/**
 * Set up reload button functionality
 */
function setupReloadButton() {
  const reloadButton = document.getElementById('reload-app');
  if (reloadButton) {
    reloadButton.addEventListener('click', () => {
      console.log('Reloading application...');
      if (window.api && window.api.reloadApp) {
        window.api.reloadApp()
          .then(result => {
            console.log('Reload request result:', result);
          })
          .catch(error => {
            console.error('Failed to reload app:', error);
          });
      } else {
        console.error('Reload API not available');
        // Fallback to location.reload()
        window.location.reload();
      }
    });
  }
}

/**
 * Show the app and hide loading screen
 */
function showApp() {
  const appContainer = document.querySelector('.app-container');
  const loadingScreen = document.getElementById('app-loading');
  
  if (appContainer && loadingScreen) {
    appContainer.classList.add('loaded');
    setTimeout(() => {
      loadingScreen.style.display = 'none';
    }, 500);
  }
}

// Export any functions that might need to be accessed from HTML
window.app = {
  showNotification: (...args) => {
    import('./modules/ui/notifications.js').then(module => {
      module.showNotification(...args);
    }).catch(error => {
      console.error('Failed to load notifications module:', error);
    });
  }
};
