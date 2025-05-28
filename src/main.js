// Set up event listeners for WhatsApp service
function setupWhatsAppEventListeners() {
  // Remove any existing listeners to prevent duplicates
  whatsAppService.removeAllListeners('qr');
  whatsAppService.removeAllListeners('ready');
  whatsAppService.removeAllListeners('authenticated');
  whatsAppService.removeAllListeners('disconnected');
  whatsAppService.removeAllListeners('auth_failure');
  whatsAppService.removeAllListeners('message_ack');
  whatsAppService.removeAllListeners('message_status_change');
  whatsAppService.removeAllListeners('whatsapp-info');
  
  // Set up event listeners for WhatsApp
  whatsAppService.on('qr', (qr) => {
    console.log('WhatsApp QR code received');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-qr', qr);
    }
  });
  
  whatsAppService.on('ready', async () => {
    console.log('WhatsApp ready');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-status', 'CONNECTED');
      // Get and send the phone info after ready event
      try {
        const phoneInfo = await whatsAppService.getConnectedPhoneInfo();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('whatsapp-info', phoneInfo);
        }
      } catch (error) {
        console.error('Error getting phone info after ready event:', error);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('whatsapp-info', { connected: false });
        }
      }
    }
  });
  
  whatsAppService.on('authenticated', () => {
    console.log('WhatsApp authenticated');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-status', 'AUTHENTICATED');
    }
  });
  
  whatsAppService.on('auth_failure', async (error) => {
    console.error('WhatsApp authentication failed:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-status', 'AUTH_FAILED', error.message);
      // Force QR by deleting session
      await whatsAppService.deleteSessionData();
      mainWindow.webContents.send('whatsapp-qr', null); // Signal to show QR again
    }
  });
  
  whatsAppService.on('disconnected', (reason) => {
    console.log('WhatsApp disconnected');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-status', 'DISCONNECTED', reason);
    }
  });
  
  // Handle message status change events from WhatsApp service
  whatsAppService.on('message_status_change', async (statusUpdate) => {
    console.log(`Message status change: ${statusUpdate.externalId} -> ${statusUpdate.status}`);
    try {
      // Update the message status in the database
      await messageController.updateMessageStatus(statusUpdate.externalId, statusUpdate.status);
      
      // Send the update to the renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('message-status-update', {
          externalId: statusUpdate.externalId,
          status: statusUpdate.status,
          timestamp: statusUpdate.timestamp
        });
      }
    } catch (error) {
      console.error('Error updating message status:', error);
    }
  });
  
  whatsAppService.on('message_sent', (message) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('message-sent', message);
    }
  });
  
  whatsAppService.on('state_change', (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-state', state);
    }
  });
  
  // Handle phone info updates directly from the service
  whatsAppService.on('whatsapp-info', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-info', info);
    }
  });
} 