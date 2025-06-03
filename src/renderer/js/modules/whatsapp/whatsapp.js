// whatsapp.js - WhatsApp connection and status handling

import { showNotification } from '../ui/notifications.js';

// Flag to track if session was deleted (to force QR code display)
let sessionDeleted = false;
// Flag to track if we're initializing for the first time
let initialCheck = true;

/**
 * Set up WhatsApp connection UI elements
 */
function setupWhatsAppConnection() {
  const connectButton = document.getElementById('connect-whatsapp');
  const disconnectButton = document.getElementById('disconnect-whatsapp');
  const deleteSessionButton = document.getElementById('delete-session');
  
  // Also set up settings page buttons
  const settingsConnectButton = document.getElementById('settings-connect-whatsapp');
  const settingsDisconnectButton = document.getElementById('settings-disconnect-whatsapp');
  const settingsLogoutButton = document.getElementById('settings-logout-whatsapp');
  const settingsRestartButton = document.getElementById('settings-restart-whatsapp');
  
  // Connect button in sidebar
  if (connectButton) {
    connectButton.addEventListener('click', connectWhatsApp);
  }
  
  // Connect button in settings page
  if (settingsConnectButton) {
    settingsConnectButton.addEventListener('click', connectWhatsApp);
  }
  
  // Disconnect button in sidebar
  if (disconnectButton) {
    disconnectButton.addEventListener('click', () => disconnectWhatsApp(false));
  }
  
  // Disconnect button in settings page
  if (settingsDisconnectButton) {
    settingsDisconnectButton.addEventListener('click', () => disconnectWhatsApp(false));
  }
  
  // Delete session button in sidebar
  if (deleteSessionButton) {
    deleteSessionButton.addEventListener('click', () => disconnectWhatsApp(true));
  }
  
  // Logout button in settings page (same as delete session)
  if (settingsLogoutButton) {
    settingsLogoutButton.addEventListener('click', () => disconnectWhatsApp(true));
  }
  
  // Restart button in settings page
  if (settingsRestartButton) {
    settingsRestartButton.addEventListener('click', restartWhatsAppService);
  }
  
  // Always hide the sidebar phone info - we'll only use the corner display
  const phoneInfoContainer = document.getElementById('phone-info');
  if (phoneInfoContainer) {
    phoneInfoContainer.style.display = 'none';
  }
  
  // Load saved WhatsApp info from localStorage for the corner display
  loadWhatsAppInfoFromLocalStorage();
  
  // Set up WhatsApp event listeners
  setupWhatsAppEventListeners();
  
  // Add connection watchdog
  setupConnectionWatchdog();
  
  // Set up click handler for corner info
  const cornerInfo = document.getElementById('whatsapp-corner-info');
  if (cornerInfo) {
    // Variables to track if we're dragging
    let wasDragging = false;
    let dragStartTime = 0;
    
    // Check if an element was being dragged before navigating to settings
    cornerInfo.addEventListener('mousedown', () => {
      wasDragging = false;
      dragStartTime = Date.now();
    });
    
    cornerInfo.addEventListener('mousemove', () => {
      // If we've moved the mouse while holding down, we're dragging
      if (dragStartTime > 0) {
        wasDragging = true;
      }
    });
    
    // Only navigate to settings on click, not after drag
    cornerInfo.addEventListener('mouseup', (e) => {
      // Don't navigate if the target is the drag handle
      if (e.target.classList.contains('drag-handle')) {
        return;
      }
      
      // Don't navigate if the element has the dragging data attribute
      if (cornerInfo.hasAttribute('data-is-dragging')) {
        return;
      }
      
      // Only navigate if:
      // 1. We weren't dragging (just a clean click)
      // 2. Or it was a very short "drag" (under 200ms) which is likely just a click
      const clickDuration = Date.now() - dragStartTime;
      const isQuickClick = clickDuration < 200;
      
      if (!wasDragging || isQuickClick) {
        // Switch to settings tab when clicking the corner info
        const settingsSection = document.getElementById('settings');
        if (settingsSection) {
          document.querySelectorAll('.content-section.active').forEach(section => {
            section.classList.remove('active');
          });
          settingsSection.classList.add('active');
          
          document.querySelectorAll('.nav-item.active').forEach(item => {
            item.classList.remove('active');
          });
          const settingsMenuItem = document.querySelector('.nav-item[data-target="settings"]');
          if (settingsMenuItem) {
            settingsMenuItem.classList.add('active');
          }
        }
      }
      
      // Reset for next interaction
      wasDragging = false;
      dragStartTime = 0;
    });
  }
  
  // Check WhatsApp status immediately and auto-connect if session exists
  checkAndAutoConnect();
  
  // Remove any code that shows or toggles autoconnect button
  const autoconnectButton = document.getElementById('autoconnect-toggle');
  if (autoconnectButton) {
    autoconnectButton.style.display = 'none';
  }
}

/**
 * Check WhatsApp status and auto-connect if session exists
 */
async function checkAndAutoConnect() {
  try {
    console.log('Checking WhatsApp session status...');
    const status = await window.api.getWhatsAppStatus();
    
    // Update UI based on current status
    const statusString = typeof status === 'object' ? status.status?.toUpperCase() || 'DISCONNECTED' : status;
    updateWhatsAppStatus(statusString);
    
    // Check if already connected
    if (status.isConnected) {
      // Force update UI to connected state
      updateWhatsAppStatus('CONNECTED');
      hideQRCode();
      
      // Get phone info
      updateConnectedPhoneInfo();
      
      // Reset session deleted flag
      sessionDeleted = false;
      initialCheck = false;
      return; // Exit early if already connected
    } 
    
    // If there's a session but not connected, always auto-connect
    if (status.hasExistingSession && !sessionDeleted) {
      showNotification('WhatsApp', 'Existing session found, connecting...', 'info');
      
      // Show connecting status
      updateWhatsAppStatus('CONNECTING');
      
      // Connect with auto-connect flag
      connectWhatsApp(true);
    } 
    // If no session or session was deleted, show QR directly
    else if (!status.hasExistingSession || sessionDeleted) {
      // Show connecting status first
      updateWhatsAppStatus('CONNECTING');
      
      // Connect to get QR code
      connectWhatsApp(false);
      
      if (initialCheck) {
        showNotification('WhatsApp', 'Please connect to WhatsApp and scan the QR code', 'info');
        initialCheck = false;
      }
    }
  } catch (error) {
    console.error('Error checking WhatsApp status for auto-connect:', error);
    showNotification('WhatsApp Error', 'Failed to check WhatsApp session', 'error');
    initialCheck = false;
    
    // Set UI to disconnected state on error
    updateWhatsAppStatus('DISCONNECTED');
    hideQRCode();
    hidePhoneInfo();
    resetAllButtons();
  }
}

/**
 * Set up event listeners for WhatsApp events
 */
function setupWhatsAppEventListeners() {
  // Phone info should only be updated on significant events, not periodically
  const lastRefresh = {
    timestamp: 0
  };
  
  // Remove existing listeners to avoid duplicates
  window.api.removeAllListeners('whatsapp-status');
  window.api.removeAllListeners('whatsapp-qr');
  window.api.removeAllListeners('whatsapp-ready');
  window.api.removeAllListeners('whatsapp-authenticated');
  window.api.removeAllListeners('whatsapp-disconnected');
  window.api.removeAllListeners('whatsapp-info');
  window.api.removeAllListeners('whatsapp-session-check');
  window.api.removeAllListeners('whatsapp-state');
  window.api.removeAllListeners('loading');
  window.api.removeAllListeners('browser-disconnected');
  window.api.removeAllListeners('whatsapp-error');
  window.api.removeAllListeners('whatsapp-suggestions');
  
  // Listen for status changes
  window.api.on('whatsapp-status', (status, reason) => {
    console.log(`WhatsApp status changed: ${status}`, reason || '');
    updateWhatsAppStatus(status);
    
    // If we got disconnected, schedule a recovery after a delay
    if (status === 'DISCONNECTED' && !sessionDeleted) {
      setTimeout(() => {
        handleConnectionRecovery();
      }, 10000); // Try recovery after 10 seconds
    }
    
    // Only refresh phone info on CONNECTED state and not too frequently
    if (status === 'CONNECTED') {
      const now = Date.now();
      if (now - lastRefresh.timestamp > 10000) { // Max once per 10 seconds
        lastRefresh.timestamp = now;
        updateConnectedPhoneInfo();
      }
    } else if (status === 'DISCONNECTED' || status === 'AUTH_FAILED') {
      hidePhoneInfo();
    }
  });
  
  // Listen for browser disconnection events
  window.api.on('browser-disconnected', () => {
    console.log('Browser disconnected event received');
    showNotification('WhatsApp Error', 'Browser disconnected, reconnecting...', 'error');
    
    // Update UI
    updateWhatsAppStatus('DISCONNECTED');
    hideQRCode();
    hidePhoneInfo();
    
    // Use the recovery function for better error handling
    setTimeout(() => {
      handleConnectionRecovery();
    }, 5000);
  });
  
  // Listen for error events
  window.api.on('whatsapp-error', (error) => {
    console.log('WhatsApp error event received:', error);
    showNotification('WhatsApp Error', error.message || 'Connection error occurred', 'error');
    
    // Update UI to show error
    updateWhatsAppStatus('ERROR');
    
    // Attempt recovery after a delay
    setTimeout(() => {
      handleConnectionRecovery();
    }, 15000);
  });
  
  // Listen for suggestion events (from automatic troubleshooting)
  window.api.on('whatsapp-suggestions', (suggestions) => {
    if (suggestions && suggestions.length > 0) {
      console.log('Received WhatsApp suggestions:', suggestions);
      
      // Format suggestions into a user-friendly message
      const suggestionsList = suggestions.map(s => `• ${s}`).join('\n');
      const message = `<strong>Troubleshooting Suggestions:</strong><br>${suggestionsList}`;
      
      // Show a notification with the suggestions
      showNotification('WhatsApp Troubleshooting', message, 'info', 15000);
    }
  });
  
  // Listen for phone info updates
  window.api.on('whatsapp-info', (phoneInfo) => {
    if (!phoneInfo || !phoneInfo.connected) {
      hidePhoneInfo();
      return;
    }
    
    const now = Date.now();
    if (now - lastRefresh.timestamp > 5000) { // Debounce updates
      lastRefresh.timestamp = now;
      
      // Store current values to check if they've changed
      const currentPhoneNumber = document.getElementById('connected-phone-number')?.textContent;
      const currentPhoneName = document.getElementById('connected-phone-name')?.textContent;
      
      // Only update if values have actually changed
      if (currentPhoneNumber !== phoneInfo.phoneNumber || 
          currentPhoneName !== phoneInfo.name) {
        console.log('Phone info event received with new data, updating UI');
        updateConnectedPhoneInfo();
      } else {
        console.log('Phone info event received but data unchanged, skipping UI update');
      }
    }
  });
  
  // QR code event
  window.api.on('whatsapp-qr', (qr) => {
    console.log('Received QR code from main process');
    
    // Always clear any existing QR code first
    const qrCodeDiv = document.getElementById('qr-code');
    if (qrCodeDiv) {
      qrCodeDiv.innerHTML = '';
    }
    
    // Only show QR if we have a valid QR code
    if (qr) {
    showQRCode(qr);
    updateWhatsAppStatus('SCANNING');
    showNotification('WhatsApp QR Code', 'Please scan the QR code with your phone', 'info');
    } else {
      // If QR is null, this could mean either:
      // 1. Already authenticated (wait for authenticated/ready event)
      // 2. Error getting QR (show disconnected state after a timeout)
      console.log('Received null QR code - waiting for other events...');
      
      // Set a timeout to check if we're still not connected after a while
      setTimeout(async () => {
        const status = await window.api.getWhatsAppStatus();
        if (!status.isConnected) {
          console.log('Still not connected after null QR, updating UI to disconnected');
          updateWhatsAppStatus('DISCONNECTED');
          
          // After showing disconnected, try to reconnect with a new QR
          setTimeout(() => {
            console.log('Attempting to reconnect and get a new QR code');
            connectWhatsApp(false);
          }, 5000);
        }
      }, 8000);
    }
  });
  
  // Listen for loading screen events
  window.api.on('loading', (data) => {
    console.log(`WhatsApp loading: ${data.percent}% - ${data.message}`);
    updateWhatsAppStatus('LOADING');
    hideQRCode();
    
    // Show a loading notification if the process takes a while
    if (data.percent < 50) {
      showNotification('WhatsApp', `Loading WhatsApp: ${data.message}`, 'info');
    }
  });
  
  // Ready event (client is fully ready)
  window.api.on('whatsapp-ready', () => {
    console.log('WhatsApp ready event received');
    updateWhatsAppStatus('CONNECTED');
    hideQRCode();
    updateConnectedPhoneInfo();
    showNotification('WhatsApp Connected', 'WhatsApp is now connected', 'success');
    
    // Reset session deleted flag when successfully connected
    sessionDeleted = false;
  });
  
  // Authentication event
  window.api.on('whatsapp-authenticated', () => {
    console.log('WhatsApp authenticated event received');
    updateWhatsAppStatus('AUTHENTICATED');
    hideQRCode();
    showNotification('WhatsApp Authenticated', 'Authentication successful', 'success');
    
    // Reset session deleted flag when successfully authenticated
    sessionDeleted = false;
  });
  
  // Disconnected event
  window.api.on('whatsapp-disconnected', (reason) => {
    console.log(`WhatsApp disconnected event received, reason: ${reason || 'unknown'}`);
    updateWhatsAppStatus('DISCONNECTED');
    hideQRCode();
    hidePhoneInfo();
    showNotification('WhatsApp Disconnected', `Disconnected: ${reason || 'Connection lost'}`, 'warning');
    
    // Reset buttons when disconnected
    resetAllButtons();
    
    // If not logout, try to reconnect after a delay
    if (reason !== 'LOGOUT' && !sessionDeleted) {
      setTimeout(() => {
        checkAndAutoConnect();
      }, 10000); // Try to reconnect after 10 seconds
    }
  });
  
  // State change event
  window.api.on('whatsapp-state', (state) => {
    console.log(`WhatsApp state changed: ${state}`);
    if (state === 'CONNECTED') {
      updateWhatsAppStatus('CONNECTED');
      hideQRCode();
      updateConnectedPhoneInfo();
    } else if (state === 'DISCONNECTED') {
      updateWhatsAppStatus('DISCONNECTED');
    }
  });
  
  // Listen for session check from main process
  window.api.on('whatsapp-session-check', (sessionInfo) => {
    console.log('WhatsApp session check received:', sessionInfo);
    
    // Update UI based on the status info we received
    if (sessionInfo.status) {
      updateWhatsAppStatus(sessionInfo.status.toUpperCase());
    }
    
    // If already connected, just update the UI
    if (sessionInfo.isConnected) {
      console.log('WhatsApp is already connected');
      updateWhatsAppStatus('CONNECTED');
      hideQRCode();
      updateConnectedPhoneInfo();
      sessionDeleted = false;
      initialCheck = false;
      return;
    }
    
    // If a session exists, always auto-connect
    if (sessionInfo.hasExistingSession && !sessionDeleted) {
      console.log('Auto-connecting to existing session...');
      // Small delay to ensure UI is ready
      setTimeout(() => {
        connectWhatsApp(true); // true = auto-connect mode
      }, 1000);
    } else if (!sessionInfo.hasExistingSession || sessionDeleted) {
      updateWhatsAppStatus('DISCONNECTED');
      // Don't show notification here, let the connection process handle it
      
      // If no session, initialize connection to get QR code
      setTimeout(() => {
        console.log('No session found, initializing connection to get QR code...');
        connectWhatsApp(false);
      }, 2000);
    }
    
    // Mark as no longer initial check
    initialCheck = false;
  });
}

/**
 * Connect to WhatsApp
 * @param {boolean} isAutoConnect - Whether this is an automatic connection
 */
async function connectWhatsApp(isAutoConnect = false) {
  try {
    // Prevent multiple connection attempts
    const connectButton = document.getElementById('whatsapp-connect-button');
    if (connectButton) {
      if (connectButton.disabled) {
        console.log('Connection already in progress, ignoring request');
        return;
      }
      connectButton.disabled = true;
    }
    
    // Update UI
    updateWhatsAppStatus('CONNECTING');
    
    // Don't show notification if auto-connecting
    if (!isAutoConnect) {
      showNotification('WhatsApp', 'Connecting to WhatsApp...', 'info');
    }
    
    console.log(`Connecting to WhatsApp (Auto-connect: ${isAutoConnect})`);
    
    // If session was explicitly deleted, force new QR
    const forceNewQR = sessionDeleted;
    
    // Initialize WhatsApp
    try {
      const result = await window.api.initWhatsApp(forceNewQR);
      console.log('WhatsApp initialization result:', result);
      
      // Reset session deleted flag after initialization
      if (result.success) {
        sessionDeleted = false;
      }
    } catch (initError) {
      console.error('WhatsApp initialization error:', initError);
      
      // Check if the error is related to browser disconnection
      if (initError.message && (
          initError.message.includes('browser has disconnected') || 
          initError.message.includes('Navigation failed'))) {
        
        showNotification('WhatsApp Error', 'Browser disconnected, retrying...', 'error');
        
        // Wait a bit longer before retrying to ensure resources are freed
        setTimeout(async () => {
          try {
            // First disconnect to clean up
            await window.api.disconnectWhatsApp(false);
            
            // Wait for cleanup
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Try again with fresh session
            console.log('Retrying connection after browser disconnect');
            sessionDeleted = true; // Force new QR
            updateWhatsAppStatus('CONNECTING');
            await window.api.initWhatsApp(true);
          } catch (retryError) {
            console.error('Error during reconnection after browser disconnect:', retryError);
            resetAllButtons();
            updateWhatsAppStatus('DISCONNECTED');
            showNotification('WhatsApp Error', 'Failed to reconnect after browser disconnect', 'error');
          }
        }, 5000);
        return;
      }
      
      // For other errors, just show the error
      resetAllButtons();
      updateWhatsAppStatus('DISCONNECTED');
      showNotification('WhatsApp Error', initError.message || 'Failed to connect to WhatsApp', 'error');
        return;
    }
    
    // Don't disable the button on success as it will be updated by the status handlers
    
  } catch (error) {
    console.error('Error connecting to WhatsApp:', error);
    showNotification('WhatsApp Error', error.message || 'Failed to connect to WhatsApp', 'error');
    updateWhatsAppStatus('DISCONNECTED');
    resetAllButtons();
  }
}

/**
 * Disconnect from WhatsApp
 * @param {boolean} deleteSession - Whether to delete the session data
 */
async function disconnectWhatsApp(deleteSession = false) {
  try {
    // Prevent multiple disconnection attempts
    const disconnectButton = document.getElementById('whatsapp-disconnect-button');
    const deleteSessionButton = document.getElementById('whatsapp-delete-session-button');
    const connectButton = document.getElementById('whatsapp-connect-button');
    
    if (disconnectButton) disconnectButton.disabled = true;
    if (deleteSessionButton) deleteSessionButton.disabled = true;
    if (connectButton) connectButton.disabled = true;
    
    // Update UI before operation
    updateWhatsAppStatus(deleteSession ? 'LOGGING_OUT' : 'DISCONNECTING');
    
    console.log(`Disconnecting from WhatsApp (Delete session: ${deleteSession})`);
    
    // Mark session as deleted if we're logging out
    if (deleteSession) {
      sessionDeleted = true;
      
      // Update corner info to logged out state immediately
      updateCornerWhatsAppInfo(null, 'LOGGED_OUT');
    } else {
      // Just disconnected, show disconnected state
      updateCornerWhatsAppInfo(null, 'DISCONNECTED');
    }
    
    try {
      // Disconnect from WhatsApp
      const result = await window.api.disconnectWhatsApp(deleteSession);
      console.log('WhatsApp disconnection result:', result);
    } catch (disconnectError) {
      console.error('Error during WhatsApp disconnect call:', disconnectError);
      
      // Even if disconnect API call fails, update UI to disconnected state
      // This ensures the user can try to connect again
      showNotification('WhatsApp Error', 'Error during disconnection, app state has been reset', 'warning');
    }
    
    // Always update UI to disconnected state, even if the operation failed
    updateWhatsAppStatus(deleteSession ? 'LOGGED_OUT' : 'DISCONNECTED');
    hideQRCode();
    hidePhoneInfo();
    
    // Show notification only if no error occurred
    showNotification(
      'WhatsApp', 
      deleteSession ? 'Logged out from WhatsApp' : 'Disconnected from WhatsApp',
      'info'
    );
    
    // Always reset buttons to ensure UI is usable
    resetAllButtons();
    
    // If we deleted the session, wait a moment and then reconnect to show QR code
    if (deleteSession) {
      setTimeout(() => {
        connectWhatsApp(false); // false = not auto-connect, to show QR
      }, 3000);
    }
  } catch (error) {
    console.error('Error disconnecting from WhatsApp:', error);
    showNotification('WhatsApp Error', error.message || 'Failed to disconnect from WhatsApp', 'error');
    
    // Always reset buttons on error
    resetAllButtons();
    updateWhatsAppStatus('DISCONNECTED');
  }
}

/**
 * Reset all WhatsApp connection buttons to their default state
 */
function resetAllButtons() {
  // Reset sidebar buttons
  const connectButton = document.getElementById('connect-whatsapp');
  const disconnectButton = document.getElementById('disconnect-whatsapp');
  const deleteSessionButton = document.getElementById('delete-session');
  
  if (connectButton) {
    connectButton.disabled = false;
    connectButton.innerHTML = '<i class="fas fa-plug"></i> Connect WhatsApp';
    connectButton.style.display = 'inline-block';
  }
  
  if (disconnectButton) {
    disconnectButton.disabled = false;
    disconnectButton.innerHTML = '<i class="fas fa-unlink"></i> Disconnect';
    disconnectButton.style.display = 'none';
  }
  
  if (deleteSessionButton) {
    deleteSessionButton.disabled = false;
    deleteSessionButton.style.display = 'none';
  }
  
  // Reset settings page buttons
  const settingsConnectButton = document.getElementById('settings-connect-whatsapp');
  const settingsDisconnectButton = document.getElementById('settings-disconnect-whatsapp');
  const settingsLogoutButton = document.getElementById('settings-logout-whatsapp');
  const settingsRestartButton = document.getElementById('settings-restart-whatsapp');
  
  if (settingsConnectButton) {
    settingsConnectButton.disabled = false;
    settingsConnectButton.innerHTML = 'Connect WhatsApp';
    settingsConnectButton.style.display = 'inline-block';
  }
  
  if (settingsDisconnectButton) {
    settingsDisconnectButton.disabled = false;
    settingsDisconnectButton.innerHTML = 'Disconnect';
    settingsDisconnectButton.style.display = 'none';
  }
  
  if (settingsLogoutButton) {
    settingsLogoutButton.disabled = false;
    settingsLogoutButton.style.display = 'none';
  }
  
  if (settingsRestartButton) {
    settingsRestartButton.disabled = false;
    settingsRestartButton.style.display = 'none';
  }
}

/**
 * Update the WhatsApp status UI
 * @param {string} status - The WhatsApp connection status
 */
function updateWhatsAppStatus(status) {
  console.log('WhatsApp status updated:', status);
  
  // Update status in sidebar
  updateSidebarStatus(status);
  
  // Update status in settings page
  updateSettingsStatus(status);
  
  // Update corner info status (don't need to pass phone info, it will be retrieved if needed)
  const cornerInfo = document.getElementById('whatsapp-corner-info');
  if (cornerInfo) {
    if (status === 'CONNECTED' || status === 'READY') {
      // For connected state, let's get the latest phone info
      updateConnectedPhoneInfo();
    } else {
      // For other states, just pass the status to update the UI accordingly
      updateCornerWhatsAppInfo(null, status);
    }
  }
}

/**
 * Update the WhatsApp status in the sidebar
 * @param {string} status - The WhatsApp connection status
 */
function updateSidebarStatus(status) {
  // Get UI elements
  const statusElement = document.getElementById('whatsapp-status');
  const statusIndicator = document.querySelector('.whatsapp-status .status-indicator');
  const connectButton = document.getElementById('connect-whatsapp');
  const disconnectButton = document.getElementById('disconnect-whatsapp');
  const deleteSessionButton = document.getElementById('delete-session');
  const qrContainer = document.getElementById('qr-container');
  
  if (!statusElement) return;
  
  // Update status text
  statusElement.textContent = status;
  
  // Update status indicator class
  if (statusIndicator) {
    statusIndicator.className = 'status-indicator';
    statusIndicator.classList.add(status.toLowerCase());
  }
  
  switch (status) {
    case 'CONNECTED':
    case 'READY':
      if (connectButton) connectButton.style.display = 'none';
      if (disconnectButton) disconnectButton.style.display = 'inline-block';
      if (deleteSessionButton) deleteSessionButton.style.display = 'inline-block';
      if (qrContainer) qrContainer.style.display = 'none';
      updateConnectedPhoneInfo();
      break;
    
    case 'AUTHENTICATED':
      if (connectButton) connectButton.style.display = 'none';
      if (disconnectButton) disconnectButton.style.display = 'inline-block';
      if (deleteSessionButton) deleteSessionButton.style.display = 'inline-block';
      if (qrContainer) qrContainer.style.display = 'none';
      break;
    
    case 'DISCONNECTED':
      if (connectButton) {
        connectButton.style.display = 'inline-block';
        connectButton.disabled = false;
        connectButton.innerHTML = '<i class="fas fa-plug"></i> Connect WhatsApp';
      }
      if (disconnectButton) disconnectButton.style.display = 'none';
      if (deleteSessionButton) deleteSessionButton.style.display = 'none';
      if (qrContainer) qrContainer.style.display = 'none';
      hidePhoneInfo();
      break;
    
    case 'CONNECTING':
      if (connectButton) {
        connectButton.disabled = true;
        connectButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...';
      }
      break;
      
    case 'DISCONNECTING':
      if (disconnectButton) {
        disconnectButton.disabled = true;
        disconnectButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Disconnecting...';
      }
      break;
    
    case 'SCANNING':
      if (connectButton) {
        connectButton.disabled = true;
        connectButton.innerHTML = '<i class="fas fa-qrcode"></i> Scan QR Code';
      }
      if (disconnectButton) disconnectButton.style.display = 'inline-block';
      break;
    
    default:
      if (statusIndicator) {
        statusIndicator.className = 'status-indicator disconnected';
      }
  }
}

/**
 * Update the WhatsApp status in the settings page
 * @param {string} status - The WhatsApp connection status
 */
function updateSettingsStatus(status) {
  // Get settings page elements
  const statusElement = document.getElementById('settings-whatsapp-status-text');
  const statusIndicator = document.getElementById('settings-whatsapp-status');
  const connectButton = document.getElementById('settings-connect-whatsapp');
  const disconnectButton = document.getElementById('settings-disconnect-whatsapp');
  const logoutButton = document.getElementById('settings-logout-whatsapp');
  const restartButton = document.getElementById('settings-restart-whatsapp');
  const phoneInfoContainer = document.getElementById('settings-phone-info');
  
  if (!statusElement || !statusIndicator) return;
  
  // Update status text
  statusElement.textContent = status;
  
  // Update status indicator class
  statusIndicator.className = 'status-indicator';
  statusIndicator.classList.add(status.toLowerCase());
  
  switch (status) {
    case 'CONNECTED':
    case 'READY':
      if (connectButton) connectButton.style.display = 'none';
      if (disconnectButton) disconnectButton.style.display = 'inline-block';
      if (logoutButton) logoutButton.style.display = 'inline-block';
      if (restartButton) restartButton.style.display = 'inline-block';
      updateSettingsPhoneInfo();
      break;
    
    case 'AUTHENTICATED':
      if (connectButton) connectButton.style.display = 'none';
      if (disconnectButton) disconnectButton.style.display = 'inline-block';
      if (logoutButton) logoutButton.style.display = 'inline-block';
      if (restartButton) restartButton.style.display = 'inline-block';
      break;
    
    case 'ERROR':
    case 'MAX_RESTARTS_EXCEEDED':
      if (connectButton) connectButton.style.display = 'inline-block';
      if (disconnectButton) disconnectButton.style.display = 'none';
      if (logoutButton) logoutButton.style.display = 'inline-block';
      if (restartButton) restartButton.style.display = 'inline-block';
      if (phoneInfoContainer) phoneInfoContainer.style.display = 'none';
      
      // For serious errors, highlight the restart button
      if (restartButton) {
        restartButton.classList.add('btn-warning');
        restartButton.innerHTML = '<i class="fas fa-sync-alt"></i> Repair Connection';
      }
      break;
    
    case 'DISCONNECTED':
      if (connectButton) {
        connectButton.style.display = 'inline-block';
        connectButton.disabled = false;
        connectButton.innerHTML = 'Connect WhatsApp';
      }
      if (disconnectButton) disconnectButton.style.display = 'none';
      if (logoutButton) logoutButton.style.display = 'none';
      if (restartButton) restartButton.style.display = 'none';
      if (phoneInfoContainer) phoneInfoContainer.style.display = 'none';
      break;
    
    case 'CONNECTING':
      if (connectButton) {
        connectButton.disabled = true;
        connectButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...';
      }
      if (restartButton) restartButton.style.display = 'none';
      break;
      
    case 'DISCONNECTING':
      if (disconnectButton) {
        disconnectButton.disabled = true;
        disconnectButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Disconnecting...';
      }
      if (restartButton) restartButton.style.display = 'none';
      break;
    
    case 'SCANNING':
      if (connectButton) {
        connectButton.disabled = true;
        connectButton.innerHTML = '<i class="fas fa-qrcode"></i> Scan QR Code';
      }
      if (disconnectButton) disconnectButton.style.display = 'inline-block';
      if (restartButton) restartButton.style.display = 'none';
      break;
    
    default:
      statusIndicator.className = 'status-indicator disconnected';
  }
}

/**
 * Update connected phone information in the sidebar
 */
function updateConnectedPhoneInfo() {
  window.api.getWhatsAppInfo()
    .then(phoneInfo => {
      // Store current values to check if they've changed
      const currentPhoneNumber = document.getElementById('connected-phone-number')?.textContent;
      const currentPhoneName = document.getElementById('connected-phone-name')?.textContent;
      const currentProfilePic = document.getElementById('connected-profile-pic')?.src;
      
      if (!phoneInfo || !phoneInfo.connected || !phoneInfo.phoneNumber || !phoneInfo.name) {
        console.warn('Phone info missing or incomplete:', phoneInfo);
        hidePhoneInfo();
        return;
      }
      
      // Only update if values have actually changed
      const hasChanged = 
        currentPhoneNumber !== phoneInfo.phoneNumber ||
        currentPhoneName !== phoneInfo.name ||
        (phoneInfo.profilePictureUrl && currentProfilePic !== phoneInfo.profilePictureUrl);
      
      if (!hasChanged) {
        console.log('Phone info unchanged, skipping UI update');
        // Even if sidebar doesn't need updating, make sure corner info is displayed
        updateCornerWhatsAppInfo(phoneInfo);
        return;
      }
      
      // Update UI with new values
      console.log('Phone info changed, updating UI');
      updateWhatsAppStatus('CONNECTED');
      hideQRCode();
      
      // We're not showing the sidebar phone info anymore, only using corner display
      // But keep the code for backwards compatibility
      const phoneInfoContainer = document.getElementById('phone-info');
      if (phoneInfoContainer) {
        // Always keep this hidden now
        phoneInfoContainer.style.display = 'none';
        
        // Still update the values in case other code references them
        const phoneNumberElem = document.getElementById('connected-phone-number');
        const phoneNameElem = document.getElementById('connected-phone-name');
        if (phoneNumberElem) phoneNumberElem.textContent = phoneInfo.phoneNumber;
        if (phoneNameElem) phoneNameElem.textContent = phoneInfo.name;
        
        const profilePic = document.getElementById('connected-profile-pic');
        if (profilePic && phoneInfo.profilePictureUrl) {
          profilePic.src = phoneInfo.profilePictureUrl;
          // Keep hidden
          profilePic.style.display = 'none';
        } else if (profilePic) {
          profilePic.style.display = 'none';
        }
      }
      
      // Update corner WhatsApp info - this is the only display we'll show now
      updateCornerWhatsAppInfo(phoneInfo);
      
      // Only update settings UI if values changed
      updateSettingsPhoneInfo(phoneInfo);
      
      // Save phone info to localStorage for persistence
      saveWhatsAppInfoToLocalStorage(phoneInfo);
      
      // Update buttons
      const connectButton = document.getElementById('connect-whatsapp');
      const disconnectButton = document.getElementById('disconnect-whatsapp');
      const deleteSessionButton = document.getElementById('delete-session');
      if (connectButton) connectButton.style.display = 'none';
      if (disconnectButton) disconnectButton.style.display = 'inline-block';
      if (deleteSessionButton) deleteSessionButton.style.display = 'inline-block';
      
      const settingsConnectButton = document.getElementById('settings-connect-whatsapp');
      const settingsDisconnectButton = document.getElementById('settings-disconnect-whatsapp');
      const settingsLogoutButton = document.getElementById('settings-logout-whatsapp');
      const settingsRestartButton = document.getElementById('settings-restart-whatsapp');
      if (settingsConnectButton) settingsConnectButton.style.display = 'none';
      if (settingsDisconnectButton) settingsDisconnectButton.style.display = 'inline-block';
      if (settingsLogoutButton) settingsLogoutButton.style.display = 'inline-block';
      if (settingsRestartButton) settingsRestartButton.style.display = 'inline-block';
    })
    .catch(error => {
      console.error('Error fetching phone info:', error);
      hidePhoneInfo();
      
      // Try to load cached info from localStorage
      loadWhatsAppInfoFromLocalStorage();
    });
}

/**
 * Save WhatsApp info to localStorage for persistence
 * @param {Object} phoneInfo - Phone information object
 */
function saveWhatsAppInfoToLocalStorage(phoneInfo) {
  if (!phoneInfo || !phoneInfo.connected) return;
  
  try {
    const infoToSave = {
      phoneNumber: phoneInfo.phoneNumber,
      name: phoneInfo.name,
      profilePictureUrl: phoneInfo.profilePictureUrl || '',
      lastConnected: new Date().toISOString()
    };
    
    localStorage.setItem('whatsappInfo', JSON.stringify(infoToSave));
    console.log('Saved WhatsApp info to localStorage');
  } catch (error) {
    console.error('Error saving WhatsApp info to localStorage:', error);
  }
}

/**
 * Load WhatsApp info from localStorage
 */
function loadWhatsAppInfoFromLocalStorage() {
  try {
    const savedInfo = localStorage.getItem('whatsappInfo');
    if (!savedInfo) return;
    
    const phoneInfo = JSON.parse(savedInfo);
    console.log('Loaded WhatsApp info from localStorage:', phoneInfo);
    
    // Update corner info with saved data
    updateCornerWhatsAppInfo(phoneInfo);
    
    return phoneInfo;
  } catch (error) {
    console.error('Error loading WhatsApp info from localStorage:', error);
    return null;
  }
}

/**
 * Update the corner WhatsApp info display
 * @param {Object} phoneInfo - Phone information object
 * @param {string} status - Connection status (optional)
 */
function updateCornerWhatsAppInfo(phoneInfo, status = null) {
  const cornerInfo = document.getElementById('whatsapp-corner-info');
  const cornerPhoneName = document.getElementById('corner-phone-name');
  const cornerPhoneNumber = document.getElementById('corner-phone-number');
  const cornerProfilePic = document.getElementById('corner-profile-pic');
  
  if (!cornerInfo || !cornerPhoneName || !cornerPhoneNumber || !cornerProfilePic) return;
  
  // Always make sure the corner info is visible
  cornerInfo.style.display = 'block';
  
  // Remove all status classes first
  cornerInfo.classList.remove('connected', 'disconnected', 'logged-out');
  
  // Apply status-based styling
  if (status === 'LOGGED_OUT' || sessionDeleted) {
    cornerInfo.classList.add('logged-out');
    cornerPhoneName.textContent = 'Not Connected';
    cornerPhoneNumber.textContent = 'Logged out';
    cornerProfilePic.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OTYgNTEyIj48cGF0aCBmaWxsPSIjZDJkMmQyIiBkPSJNMjQ4IDhDMTExIDggMCAxMTkgMCAyNTZzMTExIDI0OCAyNDggMjQ4IDI0OC0xMTEgMjQ4LTI0OFMzODUgOCAyNDggOHptMCA5NmM0OC42IDAgODggMzkuNCA4OCA4OHMtMzkuNCA4OC04OCA4OC04OC0zOS40LTg4LTg4IDM5LjQtODggODgtODh6bTAgMzQ0Yy01OC43IDAtMTExLjMtMjYuNi0xNDYuNS02OC4yIDE4LjgtMzUuNCA1OC43LTU5LjggMTAzLjgtNTkuOCAxMS44IDAgMjMuMiAzLjIgMzMuMyA4LjkgMjEuMSAxMS45IDQ1LjEgMTEuOSA2Ni4zIDBDMzE0LjggMzIxLjIgMzI2LjIgMzE4IDMzOCAzMThjNDUuMSAwIDg1IDI0LjQgMTAzLjggNTkuOEMzNTkuMyA0MjEuNCAzMDYuNyA0NDggMjQ4IDQ0OHoiLz48L3N2Zz4=';
    return;
  } 
  else if (status === 'DISCONNECTED' || !phoneInfo || !phoneInfo.phoneNumber) {
    cornerInfo.classList.add('disconnected');
    cornerPhoneName.textContent = 'Disconnected';
    cornerPhoneNumber.textContent = 'Tap to reconnect';
    // Use gray WhatsApp icon
    cornerProfilePic.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OTYgNTEyIj48cGF0aCBmaWxsPSIjOGU4ZThlIiBkPSJNMjQ4IDhDMTExIDggMCAxMTkgMCAyNTZzMTExIDI0OCAyNDggMjQ4IDI0OC0xMTEgMjQ4LTI0OFMzODUgOCAyNDggOHptMCA5NmM0OC42IDAgODggMzkuNCA4OCA4OHMtMzkuNCA4OC04OCA4OC04OC0zOS40LTg4LTg4IDM5LjQtODggODgtODh6bTAgMzQ0Yy01OC43IDAtMTExLjMtMjYuNi0xNDYuNS02OC4yIDE4LjgtMzUuNCA1OC43LTU5LjggMTAzLjgtNTkuOCAxMS44IDAgMjMuMiAzLjIgMzMuMyA4LjkgMjEuMSAxMS45IDQ1LjEgMTEuOSA2Ni4zIDBDMzE0LjggMzIxLjIgMzI2LjIgMzE4IDMzOCAzMThjNDUuMSAwIDg1IDI0LjQgMTAzLjggNTkuOEMzNTkuMyA0MjEuNCAzMDYuNyA0NDggMjQ4IDQ0OHoiLz48L3N2Zz4=';
      return;
    }
  else {
    // Connected state
    cornerInfo.classList.add('connected');
    
    // Update the corner info with phone data
    cornerPhoneName.textContent = phoneInfo.name || 'Unknown';
    cornerPhoneNumber.textContent = phoneInfo.phoneNumber || '';
    
    // Set profile picture
    if (phoneInfo.profilePictureUrl) {
      cornerProfilePic.src = phoneInfo.profilePictureUrl;
    } else {
      // Default WhatsApp profile icon
      cornerProfilePic.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OTYgNTEyIj48cGF0aCBmaWxsPSIjZmZmZmZmIiBkPSJNMjQ4IDhDMTExIDggMCAxMTkgMCAyNTZzMTExIDI0OCAyNDggMjQ4IDI0OC0xMTEgMjQ4LTI0OFMzODUgOCAyNDggOHptMCA5NmM0OC42IDAgODggMzkuNCA4OCA4OHMtMzkuNCA4OC04OCA4OC04OC0zOS40LTg4LTg4IDM5LjQtODggODgtODh6bTAgMzQ0Yy01OC43IDAtMTExLjMtMjYuNi0xNDYuNS02OC4yIDE4LjgtMzUuNCA1OC43LTU5LjggMTAzLjgtNTkuOCAxMS44IDAgMjMuMiAzLjIgMzMuMyA4LjkgMjEuMSAxMS45IDQ1LjEgMTEuOSA2Ni4zIDBDMzE0LjggMzIxLjIgMzI2LjIgMzE4IDMzOCAzMThjNDUuMSAwIDg1IDI0LjQgMTAzLjggNTkuOEMzNTkuMyA0MjEuNCAzMDYuNyA0NDggMjQ4IDQ0OHoiLz48L3N2Zz4=';
    }
  }
}

/**
 * Hide the phone information UI
 */
function hidePhoneInfo() {
  // Hide sidebar phone info
  const phoneInfoContainer = document.getElementById('phone-info');
  if (phoneInfoContainer) {
    phoneInfoContainer.style.display = 'none';
  }
  
  // Hide settings page phone info
  const settingsPhoneInfo = document.getElementById('settings-phone-info');
  if (settingsPhoneInfo) {
    settingsPhoneInfo.style.display = 'none';
  }
  
  // We intentionally don't hide the corner info here
  // The corner info persists as the only WhatsApp info display
}

/**
 * Show QR code for WhatsApp Web login
 * @param {string} qr - The QR code data
 */
function showQRCode(qr) {
  // Get both QR containers - the one in settings and the one in sidebar
  const sidebarQrContainer = document.getElementById('qr-container');
  const settingsQrContainer = document.getElementById('settings-qr-container');
  const qrCodeDiv = document.getElementById('qr-code');
  
  // Check if we have the settings QR container
  if (settingsQrContainer && qrCodeDiv) {
    // Show the settings QR container
    settingsQrContainer.style.display = 'block';
    
    // Clear previous QR code
    qrCodeDiv.innerHTML = '';
    
    // Create a canvas element for the QR code
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    qrCodeDiv.appendChild(canvas);
    
    // Generate QR code in the settings section
    if (window.QRCode) {
      window.QRCode.toCanvas(canvas, qr, { width: 256 }, error => {
        if (error) {
          console.error('Error generating QR code in settings:', error);
          showNotification('QR Code Error', 'Failed to generate QR code', 'error');
        }
      });
    } else {
      console.error('QRCode library not loaded');
      showNotification('QR Code Error', 'QR code library not loaded', 'error');
    }
  }
  
  // For backwards compatibility, also update the sidebar QR if it exists
  if (sidebarQrContainer) {
    // Hide the sidebar QR container - we only want to show it in settings now
    sidebarQrContainer.style.display = 'none';
  }
  
  // Ensure the settings section is visible when QR code is shown
  const settingsSection = document.getElementById('settings');
  if (settingsSection && !settingsSection.classList.contains('active')) {
    // Activate the settings section
    document.querySelectorAll('.content-section.active').forEach(section => {
      section.classList.remove('active');
    });
    settingsSection.classList.add('active');
    
    // Also update the sidebar menu selection
    document.querySelectorAll('.sidebar-menu li.active').forEach(item => {
      item.classList.remove('active');
    });
    const settingsMenuItem = document.querySelector('.sidebar-menu li[data-section="settings"]');
    if (settingsMenuItem) {
      settingsMenuItem.classList.add('active');
    }
    
    // Show notification to inform user
    showNotification('WhatsApp QR Code', 'Please scan the QR code in the Settings section', 'info');
  }
}

/**
 * Hide the QR code UI
 */
function hideQRCode() {
  // Hide both QR containers
  const sidebarQrContainer = document.getElementById('qr-container');
  const settingsQrContainer = document.getElementById('settings-qr-container');
  
  if (sidebarQrContainer) {
    sidebarQrContainer.style.display = 'none';
  }
  
  if (settingsQrContainer) {
    settingsQrContainer.style.display = 'none';
  }
}

/**
 * Check the current WhatsApp connection status
 */
async function checkWhatsAppStatus() {
  try {
    const statusResponse = await window.api.getWhatsAppStatus();
    console.log('WhatsApp status check response:', statusResponse);
    
    // Convert status object to string if needed
    let status = statusResponse;
    if (typeof statusResponse === 'object') {
      if (statusResponse.isConnected) {
        status = 'CONNECTED';
      } else if (statusResponse.status === 'qr_received') {
        status = 'SCANNING';
      } else if (statusResponse.status === 'authenticated') {
        status = 'AUTHENTICATED';
      } else if (statusResponse.status === 'disconnected') {
        status = 'DISCONNECTED';
      } else {
        status = statusResponse.status?.toUpperCase() || 'DISCONNECTED';
      }
      
      // Store session status for later reference
      if (statusResponse.hasExistingSession === false) {
        sessionDeleted = true;
      }
    }
    
    updateWhatsAppStatus(status);
    
    // If connected, update phone info
    if (status === 'CONNECTED') {
      updateConnectedPhoneInfo();
    }
    
    return statusResponse;
  } catch (error) {
    console.error('Error checking WhatsApp status:', error);
    updateWhatsAppStatus('DISCONNECTED');
    return { status: 'DISCONNECTED', isConnected: false, hasExistingSession: false };
  }
}

/**
 * Update connected phone information in the settings page
 * @param {Object} phoneInfo - Phone information object (optional)
 */
async function updateSettingsPhoneInfo(phoneInfo = null) {
  try {
    if (!phoneInfo) {
      phoneInfo = await window.api.getWhatsAppInfo();
    }
    const isConnected = phoneInfo?.connected && phoneInfo.phoneNumber && phoneInfo.name;
    const settingsPhoneInfo = document.getElementById('settings-phone-info');
    const settingsPhoneText = document.getElementById('settings-connected-phone');
    if (!isConnected) {
      if (settingsPhoneInfo) settingsPhoneInfo.style.display = 'none';
      return;
    }
    if (settingsPhoneInfo && settingsPhoneText) {
      settingsPhoneInfo.style.display = 'block';
      settingsPhoneText.textContent = `${phoneInfo.name} (${phoneInfo.phoneNumber})`;
    }
  } catch (error) {
    console.error('Error updating settings phone info:', error);
    const settingsPhoneInfo = document.getElementById('settings-phone-info');
    if (settingsPhoneInfo) settingsPhoneInfo.style.display = 'none';
  }
}

/**
 * Manually refresh phone information
 */
async function refreshPhoneInfo() {
  try {
    // Show loading state
    const refreshButton = document.getElementById('refresh-phone-info');
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    }
    
    // Show loading state in settings too
    const settingsRefreshButton = document.getElementById('reload-phone-info');
    if (settingsRefreshButton) {
      settingsRefreshButton.disabled = true;
      settingsRefreshButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    }
    
    // Call the API to refresh phone info
    await window.api.refreshWhatsAppInfo();
    
    // Wait a moment for the info to be processed
    setTimeout(async () => {
      // Update the UI with the new info
      await updateConnectedPhoneInfo();
      
      // Reset refresh button
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i>';
      }
      
      // Reset settings refresh button
      if (settingsRefreshButton) {
        settingsRefreshButton.disabled = false;
        settingsRefreshButton.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
      }
    }, 1000);
  } catch (error) {
    console.error('Error refreshing phone info:', error);
    
    // Reset refresh button on error
    const refreshButton = document.getElementById('refresh-phone-info');
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i>';
    }
    
    // Reset settings refresh button on error
    const settingsRefreshButton = document.getElementById('reload-phone-info');
    if (settingsRefreshButton) {
      settingsRefreshButton.disabled = false;
      settingsRefreshButton.innerHTML = '<i class="fas fa-sync-alt"></i> Retry';
    }
  }
}

/**
 * Set up a connection watchdog that periodically checks WhatsApp connection
 * and automatically attempts to recover if disconnected
 */
function setupConnectionWatchdog() {
  // Check connection every 3 minutes
  const watchdogInterval = 3 * 60 * 1000;
  
  console.log('Setting up WhatsApp connection watchdog');
  
  // Set up the interval
  const watchdogTimer = setInterval(async () => {
    try {
      // Get current status
      const status = await window.api.getWhatsAppStatus();
      console.log('Watchdog checking WhatsApp status:', status);
      
      // If connected, just verify it's actually connected by getting info
      if (status.isConnected) {
        try {
          const phoneInfo = await window.api.getWhatsAppInfo();
          if (!phoneInfo || !phoneInfo.connected) {
            console.log('Watchdog detected false connected state, reconnecting...');
            await handleConnectionRecovery();
          } else {
            console.log('Watchdog confirmed WhatsApp is properly connected');
          }
        } catch (error) {
          console.error('Watchdog error checking phone info:', error);
          await handleConnectionRecovery();
        }
      } 
      // If not connected but session exists, try to reconnect
      else if (status.hasExistingSession && !sessionDeleted) {
        console.log('Watchdog detected disconnected state with existing session, reconnecting...');
        await handleConnectionRecovery();
      }
    } catch (error) {
      console.error('Watchdog error checking WhatsApp status:', error);
    }
  }, watchdogInterval);
  
  // Store the timer ID on the window object so it persists
  window.whatsappWatchdogTimer = watchdogTimer;
  
  // Also create a more aggressive recovery check that runs every 15 minutes
  const deepRecoveryInterval = 15 * 60 * 1000;
  
  const deepRecoveryTimer = setInterval(async () => {
    try {
      // Get current status
      const status = await window.api.getWhatsAppStatus();
      
      // If disconnected for any reason, try a deep recovery
      if (!status.isConnected) {
        console.log('Deep recovery process initiating after prolonged disconnection');
        await performDeepRecovery();
      }
    } catch (error) {
      console.error('Deep recovery check error:', error);
    }
  }, deepRecoveryInterval);
  
  // Store the timer ID
  window.whatsappDeepRecoveryTimer = deepRecoveryTimer;
}

/**
 * Handle connection recovery in case of disconnection
 */
async function handleConnectionRecovery() {
  try {
    console.log('Starting WhatsApp connection recovery process');
    
    // First try a simple reconnect
    updateWhatsAppStatus('RECONNECTING');
    
    // Use the repair connection feature
    const result = await window.api.repairWhatsAppConnection();
    console.log('Repair connection result:', result);
    
    if (result && result.success) {
      showNotification('WhatsApp', 'Connection successfully repaired', 'success');
      updateWhatsAppStatus('CONNECTED');
      return true;
    }
    
    // If simple reconnect failed, try a full reconnect
    console.log('Simple repair failed, trying full reconnect');
    
    // Disconnect first (without deleting session)
    await window.api.disconnectWhatsApp(false);
    
    // Wait a moment for cleanup
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Try to connect again
    await connectWhatsApp(true);
    
    return true;
  } catch (error) {
    console.error('Error during connection recovery:', error);
    showNotification('WhatsApp Error', 'Failed to recover connection, will retry later', 'error');
    return false;
  }
}

/**
 * Perform deep recovery for more serious connection issues
 */
async function performDeepRecovery() {
  try {
    console.log('Starting deep recovery process');
    
    // Show notification
    showNotification('WhatsApp', 'Performing deep connection recovery...', 'info');
    
    // First, reset the WhatsApp session entirely
    await window.api.resetWhatsAppSession();
    
    // Wait for a moment to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    // Now initiate a fresh connection
    await window.api.initWhatsApp(true);
    
    // Show success notification
    showNotification('WhatsApp', 'Deep recovery process completed', 'success');
    
    return true;
  } catch (error) {
    console.error('Error during deep recovery:', error);
    showNotification('WhatsApp Error', 'Deep recovery failed, will retry later', 'error');
    return false;
  }
}

/**
 * Manually restart the WhatsApp service when there are connection issues
 */
async function restartWhatsAppService() {
  try {
    // Update UI
    const restartButton = document.getElementById('settings-restart-whatsapp');
    if (restartButton) {
      restartButton.disabled = true;
      restartButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Repairing...';
    }
    
    // Show notification
    showNotification('WhatsApp', 'Repairing WhatsApp connection...', 'info');
    
    // Call the main process to restart the service
    const result = await window.api.restartWhatsAppService();
    
    // Process result
    if (result && result.success) {
      showNotification('WhatsApp', 'WhatsApp connection repaired successfully', 'success');
      
      // Reset UI
      if (restartButton) {
        restartButton.disabled = false;
        restartButton.innerHTML = '<i class="fas fa-sync-alt"></i> Restart Service';
        restartButton.classList.remove('btn-warning');
      }
      
      // Check status after a delay
      setTimeout(async () => {
        await checkWhatsAppStatus();
      }, 5000);
    } else {
      showNotification('WhatsApp Error', result.error || 'Failed to repair connection', 'error');
      
      // Reset UI but keep warning style
      if (restartButton) {
        restartButton.disabled = false;
        restartButton.innerHTML = '<i class="fas fa-sync-alt"></i> Retry Repair';
      }
    }
  } catch (error) {
    console.error('Error restarting WhatsApp service:', error);
    showNotification('WhatsApp Error', error.message || 'Failed to restart service', 'error');
    
    // Reset button
    const restartButton = document.getElementById('settings-restart-whatsapp');
    if (restartButton) {
      restartButton.disabled = false;
      restartButton.innerHTML = '<i class="fas fa-sync-alt"></i> Retry Repair';
    }
  }
}

// Export WhatsApp functions
export {
  setupWhatsAppConnection,
  connectWhatsApp,
  disconnectWhatsApp,
  updateWhatsAppStatus,
  updateConnectedPhoneInfo,
  refreshPhoneInfo,
  hidePhoneInfo,
  showQRCode,
  hideQRCode,
  checkWhatsAppStatus,
  checkAndAutoConnect,
  resetAllButtons,
  updateCornerWhatsAppInfo,
  loadWhatsAppInfoFromLocalStorage,
  saveWhatsAppInfoToLocalStorage,
  setupConnectionWatchdog,
  handleConnectionRecovery,
  performDeepRecovery,
  restartWhatsAppService
}; 