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
  
  // Set up WhatsApp event listeners
  setupWhatsAppEventListeners();
  
  // Check WhatsApp status immediately and auto-connect if session exists
  checkAndAutoConnect();
}

/**
 * Check WhatsApp status and auto-connect if session exists
 */
async function checkAndAutoConnect() {
  try {
    console.log('Checking WhatsApp status and session...');
    const status = await window.api.getWhatsAppStatus();
    console.log('Current WhatsApp status:', status);
    
    // Update UI based on current status
    updateWhatsAppStatus(typeof status === 'object' ? status.status?.toUpperCase() || 'DISCONNECTED' : status);
    
    // Check if already connected
    if (status.isConnected) {
      // If already connected, update UI but don't try to connect again
      updateConnectedPhoneInfo();
      initialCheck = false;
    } 
    // If there's a session but not connected, and this is the initial check
    else if (status.hasExistingSession && initialCheck && !sessionDeleted) {
      console.log('Existing session found, auto-connecting...');
      showNotification('WhatsApp', 'Existing session found, connecting...', 'info');
      
      // Small delay to ensure UI is ready
      setTimeout(() => {
        connectWhatsApp(true); // true = auto-connect mode
      }, 1000);
      
      // No longer initial check
      initialCheck = false;
    } 
    // If no session or session was deleted
    else if (!status.hasExistingSession || sessionDeleted) {
      console.log('No existing session found or session was deleted, manual connection required');
      if (initialCheck) {
        showNotification('WhatsApp', 'Please connect to WhatsApp and scan the QR code', 'info');
        initialCheck = false;
      }
    }
  } catch (error) {
    console.error('Error checking WhatsApp status for auto-connect:', error);
    showNotification('WhatsApp Error', 'Failed to check WhatsApp session', 'error');
    initialCheck = false;
  }
}

/**
 * Set up event listeners for WhatsApp events
 */
function setupWhatsAppEventListeners() {
  // Remove any existing listeners to prevent duplicates
  if (window.api && window.api.removeAllListeners) {
    window.api.removeAllListeners('whatsapp-qr');
    window.api.removeAllListeners('whatsapp-ready');
    window.api.removeAllListeners('whatsapp-authenticated');
    window.api.removeAllListeners('whatsapp-disconnected');
    window.api.removeAllListeners('whatsapp-session-check');
  }
  
  // Set up event listeners
  if (window.api && window.api.on) {
    window.api.on('whatsapp-qr', (qr) => {
      showQRCode(qr);
      updateWhatsAppStatus('SCANNING');
      showNotification('WhatsApp QR Code', 'Please scan the QR code with your phone', 'info');
    });
    
    window.api.on('whatsapp-ready', () => {
      updateWhatsAppStatus('CONNECTED');
      hideQRCode();
      updateConnectedPhoneInfo();
      showNotification('WhatsApp Connected', 'WhatsApp is now connected', 'success');
      
      // Reset session deleted flag when successfully connected
      sessionDeleted = false;
    });
    
    window.api.on('whatsapp-authenticated', () => {
      updateWhatsAppStatus('AUTHENTICATED');
      hideQRCode();
      showNotification('WhatsApp Authenticated', 'Authentication successful', 'success');
      
      // Reset session deleted flag when successfully authenticated
      sessionDeleted = false;
    });
    
    window.api.on('whatsapp-disconnected', (reason) => {
      updateWhatsAppStatus('DISCONNECTED');
      hideQRCode();
      hidePhoneInfo();
      showNotification('WhatsApp Disconnected', `Disconnected: ${reason}`, 'warning');
      
      // Reset buttons when disconnected
      resetAllButtons();
    });
    
    // Listen for session check from main process
    window.api.on('whatsapp-session-check', (sessionInfo) => {
      console.log('Received WhatsApp session check:', sessionInfo);
      
      // If this is the initial load and a session exists, auto-connect
      if (initialCheck && sessionInfo.hasExistingSession && !sessionDeleted) {
        console.log('Auto-connecting to existing session...');
        // Small delay to ensure UI is ready
        setTimeout(() => {
          connectWhatsApp(true); // true = auto-connect mode
        }, 1000);
      } else if (!sessionInfo.hasExistingSession || sessionDeleted) {
        console.log('No existing session or session was deleted, manual connection required');
        updateWhatsAppStatus('DISCONNECTED');
        showNotification('WhatsApp', 'Please connect to WhatsApp and scan the QR code', 'info');
      }
      
      // Mark as no longer initial check
      initialCheck = false;
    });
  }
}

/**
 * Connect to WhatsApp
 * @param {boolean} isAutoConnect - Whether this is an automatic connection attempt
 */
async function connectWhatsApp(isAutoConnect = false) {
  try {
    // Show loading state in sidebar
    const connectButton = document.getElementById('connect-whatsapp');
    if (connectButton) {
      connectButton.disabled = true;
      connectButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...';
    }
    
    // Show loading state in settings page
    const settingsConnectButton = document.getElementById('settings-connect-whatsapp');
    if (settingsConnectButton) {
      settingsConnectButton.disabled = true;
      settingsConnectButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...';
    }
    
    // Clear any existing QR code
    hideQRCode();
    
    // Update status before API call
    updateWhatsAppStatus('CONNECTING');
    
    // Initialize WhatsApp - pass sessionDeleted flag to force QR if needed
    console.log(`Connecting to WhatsApp with forceNewQR: ${sessionDeleted}`);
    await window.api.initWhatsApp(sessionDeleted);
    
    // Show notification only if not auto-connecting
    if (!isAutoConnect) {
      showNotification('WhatsApp Connection', 'Connecting to WhatsApp...', 'info');
    }
  } catch (error) {
    console.error('Error connecting to WhatsApp:', error);
    showNotification('WhatsApp Error', error.message, 'error');
    
    // Reset button and status
    updateWhatsAppStatus('DISCONNECTED');
    
    // Reset all buttons
    resetAllButtons();
  }
}

/**
 * Disconnect from WhatsApp
 * @param {boolean} deleteSession - Whether to delete the session data
 */
async function disconnectWhatsApp(deleteSession = false) {
  try {
    // Update status before API call
    updateWhatsAppStatus('DISCONNECTING');
    
    // Update sidebar button
    const disconnectButton = document.getElementById('disconnect-whatsapp');
    if (disconnectButton) {
      disconnectButton.disabled = true;
      disconnectButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Disconnecting...';
    }
    
    // Update settings page button
    const settingsDisconnectButton = document.getElementById('settings-disconnect-whatsapp');
    if (settingsDisconnectButton) {
      settingsDisconnectButton.disabled = true;
      settingsDisconnectButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Disconnecting...';
    }
    
    await window.api.disconnectWhatsApp(deleteSession);
    showNotification(
      'WhatsApp Disconnected', 
      deleteSession ? 'Session data has been deleted' : 'WhatsApp has been disconnected', 
      'info'
    );
    
    // Force reset all buttons
    resetAllButtons();
    
    // Update UI status
    updateWhatsAppStatus('DISCONNECTED');
    hideQRCode();
    hidePhoneInfo();
    
    // If session was deleted, show QR code if user attempts to reconnect
    if (deleteSession) {
      sessionDeleted = true;
    }
  } catch (error) {
    console.error('Error disconnecting from WhatsApp:', error);
    showNotification('WhatsApp Error', error.message, 'error');
    
    // Force reset all buttons even on error
    resetAllButtons();
    
    // Check current status to update UI correctly
    checkWhatsAppStatus();
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
      updateSettingsPhoneInfo();
      break;
    
    case 'AUTHENTICATED':
      if (connectButton) connectButton.style.display = 'none';
      if (disconnectButton) disconnectButton.style.display = 'inline-block';
      if (logoutButton) logoutButton.style.display = 'inline-block';
      break;
    
    case 'DISCONNECTED':
      if (connectButton) {
        connectButton.style.display = 'inline-block';
        connectButton.disabled = false;
        connectButton.innerHTML = 'Connect WhatsApp';
      }
      if (disconnectButton) disconnectButton.style.display = 'none';
      if (logoutButton) logoutButton.style.display = 'none';
      if (phoneInfoContainer) phoneInfoContainer.style.display = 'none';
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
      statusIndicator.className = 'status-indicator disconnected';
  }
}

/**
 * Update connected phone information in the sidebar
 */
async function updateConnectedPhoneInfo() {
  try {
    const phoneInfo = await window.api.getWhatsAppInfo();
    console.log('Phone info received:', phoneInfo);
    
    if (!phoneInfo || !phoneInfo.connected) {
      hidePhoneInfo();
      return;
    }
    
    // Update sidebar phone info
    const phoneInfoContainer = document.getElementById('phone-info');
    if (phoneInfoContainer) {
      phoneInfoContainer.style.display = 'flex';
      
      // Update phone information
      const phoneNumberElem = document.getElementById('connected-phone-number');
      const phoneNameElem = document.getElementById('connected-phone-name');
      
      if (phoneNumberElem) {
        phoneNumberElem.textContent = phoneInfo.phoneNumber || 'Unknown';
      }
      
      if (phoneNameElem) {
        phoneNameElem.textContent = phoneInfo.name || 'Unknown';
      }
      
      // Update profile picture if available
      const profilePic = document.getElementById('connected-profile-pic');
      if (profilePic && phoneInfo.profilePictureUrl) {
        profilePic.src = phoneInfo.profilePictureUrl;
        profilePic.style.display = 'block';
      } else if (profilePic) {
        profilePic.style.display = 'none';
      }
    }
    
    // Also update settings page phone info
    updateSettingsPhoneInfo(phoneInfo);
    
  } catch (error) {
    console.error('Error updating phone info:', error);
    hidePhoneInfo();
  }
}

/**
 * Update connected phone information in the settings page
 * @param {Object} phoneInfo - Phone information object (optional)
 */
async function updateSettingsPhoneInfo(phoneInfo = null) {
  try {
    // If phone info wasn't provided, fetch it
    if (!phoneInfo) {
      phoneInfo = await window.api.getWhatsAppInfo();
    }
    
    if (!phoneInfo || !phoneInfo.connected) {
      // Hide settings page phone info
      const settingsPhoneInfo = document.getElementById('settings-phone-info');
      if (settingsPhoneInfo) {
        settingsPhoneInfo.style.display = 'none';
      }
      return;
    }
    
    // Update settings page phone info
    const settingsPhoneInfo = document.getElementById('settings-phone-info');
    const settingsPhoneText = document.getElementById('settings-connected-phone');
    
    if (settingsPhoneInfo && settingsPhoneText) {
      settingsPhoneInfo.style.display = 'block';
      settingsPhoneText.textContent = `${phoneInfo.name || 'Unknown'} (${phoneInfo.phoneNumber || 'Unknown'})`;
    }
  } catch (error) {
    console.error('Error updating settings phone info:', error);
    
    // Hide settings page phone info
    const settingsPhoneInfo = document.getElementById('settings-phone-info');
    if (settingsPhoneInfo) {
      settingsPhoneInfo.style.display = 'none';
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

// Export WhatsApp functions
export {
  setupWhatsAppConnection,
  connectWhatsApp,
  disconnectWhatsApp,
  updateWhatsAppStatus,
  updateConnectedPhoneInfo,
  hidePhoneInfo,
  showQRCode,
  hideQRCode,
  checkWhatsAppStatus,
  checkAndAutoConnect,
  resetAllButtons
}; 