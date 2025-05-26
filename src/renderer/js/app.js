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
      helpersModule
    ] = await Promise.all([
      import('./modules/dashboard/dashboard.js'),
      import('./modules/ui/notifications.js'),
      import('./modules/whatsapp/whatsapp.js'),
      import('./modules/contacts/contacts.js'),
      import('./modules/utils/helpers.js')
    ]);
    
    return {
      initDashboard: dashboardModule.initDashboard,
      updateDashboardStats: dashboardModule.updateDashboardStats,
      loadRecentActivity: dashboardModule.loadRecentActivity,
      setupNotifications: notificationsModule.setupNotifications,
      showNotification: notificationsModule.showNotification,
      setupWhatsAppConnection: whatsAppModule.setupWhatsAppConnection,
      checkWhatsAppStatus: whatsAppModule.checkWhatsAppStatus,
      updateWhatsAppStatus: whatsAppModule.updateWhatsAppStatus,
      initContacts: contactsModule.initContacts,
      loadContacts: contactsModule.loadContacts,
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
  
  // Set up WhatsApp connection
  modules.setupWhatsAppConnection();
  
  // Check WhatsApp status
  modules.checkWhatsAppStatus();
  
  // Show a notification that the app has started
  modules.showNotification('Application Started', 'BSS Sender has been initialized successfully.', 'success', 3000);
}

/**
 * Show error screen when initialization fails
 */
function showErrorScreen(error) {
  document.body.innerHTML = `
    <div style="padding: 20px; text-align: center;">
      <h1>Error Loading Application</h1>
      <p>There was an error loading the application modules. Please try restarting the application.</p>
      <pre style="background: #f8f8f8; padding: 10px; text-align: left; overflow: auto; max-height: 200px;">${error.message}</pre>
      <div style="margin-top: 20px;">
        <button id="reload-app-error" style="padding: 10px 20px; margin-right: 10px; cursor: pointer; background: #4CAF50; color: white; border: none; border-radius: 4px;">
          Reload Application
        </button>
        <button id="force-reload-app" style="padding: 10px 20px; cursor: pointer; background: #f44336; color: white; border: none; border-radius: 4px;">
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
  
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetId = item.getAttribute('data-target');
      
      // Update active navigation item
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      
      console.log(`Navigation: switching to section "${targetId}"`);
      
      // Show target section
      sections.forEach(section => {
        section.classList.remove('active');
        
        if (section.id === targetId) {
          section.classList.add('active');
          console.log(`Section "${targetId}" is now active`);
          
          // If we're switching to contacts, force reload them
          if (targetId === 'contacts') {
            console.log('Contacts section activated, reloading contacts...');
            setTimeout(() => {
              modules.loadContacts();
            }, 100); // Small delay to ensure DOM is updated
          }
          
          // If we're switching to dashboard, update stats
          if (targetId === 'dashboard') {
            console.log('Dashboard section activated, updating stats...');
            modules.updateDashboardStats();
            modules.loadRecentActivity();
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
    
    if (targetId === 'contacts') {
      // Ensure contacts are loaded on initial page load if contacts section is active
      setTimeout(() => {
        modules.loadContacts();
      }, 500); // Longer delay for initial page load
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
