const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { initDatabase } = require('./src/database/db');
const contactController = require('./src/controllers/ContactController');
const templateController = require('./src/controllers/TemplateController');
const messageController = require('./src/controllers/MessageController');
const whatsAppService = require('./src/services/WhatsAppService');
const fs = require('fs');
const { promisify } = require('util');
const readFileAsync = promisify(fs.readFile); // Use promisify instead of fs/promises for compatibility

// Initialize the configuration store
const store = new Store();

// Global reference to main window
let mainWindow;

// Initialize the database
let dbInitialized = false;

// Helper function to format phone numbers to E.164 format
function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber) return '';
  
  // Convert to string if it's not already
  phoneNumber = phoneNumber.toString();
  
  // Remove all non-digit characters except the leading +
  let formatted = phoneNumber.replace(/[^\d+]/g, '');
  
  // If it doesn't start with +, add it (assuming international format)
  if (!formatted.startsWith('+')) {
    formatted = '+' + formatted;
  }
  
  console.log(`Phone number formatted: ${phoneNumber} -> ${formatted}`);
  return formatted;
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      // Add a preload script
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets/icon.png')
  });

  // Enable ES modules in Electron
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com"]
      }
    });
  });

  // Wait for the window to be ready before loading content
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Window failed to load:', errorCode, errorDescription);
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Try to reload after a short delay
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          console.log('Attempting to reload window after failure...');
          mainWindow.loadFile('src/renderer/index.html');
        }
      }, 1000);
    }
  });

  // Load the index.html file
  mainWindow.loadFile('src/renderer/index.html');

  // Open DevTools in development environment
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Emitted when the window is closed
  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

// Initialize the database, then create window when ready
app.whenReady().then(async () => {
  try {
    console.log('Electron app is ready, initializing components...');
    
    // Initialize database
    console.log('Initializing database...');
    await initDatabase();
    dbInitialized = true;
    console.log('Database initialized successfully');
    
    // Initialize scheduler and load settings
    try {
      console.log('Loading settings and initializing scheduler...');
      // Explicitly load settings first to ensure they're initialized
      const settings = await messageController.getSettings();
      console.log('Initial settings loaded:', settings);
      
      // Start message scheduler with loaded settings
      await messageController.startScheduler();
      console.log('Message scheduler started successfully');
    } catch (err) {
      console.error('Failed to start message scheduler:', err);
    }
    
    // Set up WhatsApp event listeners
    console.log('Setting up WhatsApp event listeners...');
    setupWhatsAppEventListeners();
    
    // Set protocol handler for loading ES modules
    console.log('Registering vite protocol handler...');
    protocol.registerBufferProtocol('vite', async (request, respond) => {
      try {
        let pathName = new URL(request.url).pathname;
        pathName = decodeURI(pathName);
        
        const data = await readFileAsync(path.join(__dirname, pathName));
        let mimeType = 'text/javascript';
        const filename = path.basename(pathName);
        
        if (filename.endsWith('.js')) {
          mimeType = 'text/javascript';
        } else if (filename.endsWith('.css')) {
          mimeType = 'text/css';
        } else if (filename.endsWith('.html')) {
          mimeType = 'text/html';
        } else if (filename.endsWith('.json')) {
          mimeType = 'application/json';
        }
        
        respond({
          mimeType,
          data
        });
      } catch (error) {
        console.error(`Failed to read file for path "${pathName}"`, error);
        respond(404);
      }
    });
    
    // Create the main window
    console.log('Creating main application window...');
    createWindow();
    
    // Check for existing WhatsApp session but let the renderer decide on auto-connect
    try {
      const hasSession = whatsAppService.hasExistingSession();
      console.log(`Existing WhatsApp session check: ${hasSession ? 'Found session' : 'No session found'}`);
      
      // Instead of auto-connecting here, we'll let the renderer handle this
      // based on the status information
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Wait a moment for the window to be ready
        setTimeout(() => {
          mainWindow.webContents.send('whatsapp-session-check', { 
            hasExistingSession: hasSession 
          });
        }, 3000);
      }
    } catch (err) {
      console.error('Failed to check WhatsApp session:', err);
    }

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    
    console.log('Application initialization completed successfully');
  } catch (err) {
    console.error('Failed to initialize application:', err);
    
    // Try to show an error dialog
    try {
      dialog.showErrorBox(
        'Application Initialization Failed',
        `The application failed to initialize properly: ${err.message}\n\nPlease restart the application.`
      );
    } catch (dialogErr) {
      console.error('Failed to show error dialog:', dialogErr);
    }
    
    // Force quit the app after a short delay
    setTimeout(() => app.quit(), 3000);
  }
});

// Set up event listeners for WhatsApp service
function setupWhatsAppEventListeners() {
  // Remove any existing listeners to prevent duplicates
  whatsAppService.removeAllListeners('qr');
  whatsAppService.removeAllListeners('ready');
  whatsAppService.removeAllListeners('authenticated');
  whatsAppService.removeAllListeners('disconnected');
  whatsAppService.removeAllListeners('auth_failure');
  whatsAppService.removeAllListeners('message_ack');
  
  // Set up event listeners for WhatsApp
  whatsAppService.on('qr', (qr) => {
    console.log('WhatsApp QR code received, forwarding to renderer');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-qr', qr);
    }
  });
  
  whatsAppService.on('ready', async () => {
    console.log('WhatsApp ready event received, forwarding to renderer');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-ready');
      
      // Send status update
      mainWindow.webContents.send('whatsapp-status', 'CONNECTED');
      
      // Get and send the phone info after ready event
      try {
        if (whatsAppService.getStatus().isConnected) {
          const phoneInfo = await whatsAppService.getConnectedPhoneInfo();
          console.log('Sending phone info to renderer:', phoneInfo);
          mainWindow.webContents.send('whatsapp-info', phoneInfo);
        }
      } catch (error) {
        console.error('Error getting phone info after ready event:', error);
      }
    }
  });
  
  whatsAppService.on('authenticated', () => {
    console.log('WhatsApp authenticated event received, forwarding to renderer');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-authenticated');
      // Send status update
      mainWindow.webContents.send('whatsapp-status', 'AUTHENTICATED');
    }
  });
  
  whatsAppService.on('auth_failure', (error) => {
    console.error('WhatsApp authentication failed:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-auth-failure', error);
      // Send status update
      mainWindow.webContents.send('whatsapp-status', 'AUTH_FAILURE');
    }
  });
  
  whatsAppService.on('disconnected', (reason) => {
    console.log('WhatsApp disconnected event received, forwarding to renderer with reason:', reason);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-disconnected', reason);
      // Send status update
      mainWindow.webContents.send('whatsapp-status', 'DISCONNECTED');
    }
  });
  
  whatsAppService.on('message_ack', (messageId, ack) => {
    let status;
    
    // Map WhatsApp ACK values to our status values
    switch(ack) {
      case 1: status = 'SENT'; break;
      case 2: status = 'DELIVERED'; break;
      case 3: status = 'READ'; break;
      default: status = 'SENT'; // Default to sent for any other value
    }
    
    // Ensure messageId is a string or number, not an object
    let messageIdToUse = messageId;
    if (typeof messageId === 'object') {
      // If messageId is an object, try to extract the actual ID
      if (messageId.id) {
        messageIdToUse = messageId.id;
      } else if (messageId._serialized) {
        messageIdToUse = messageId._serialized;
      } else {
        console.error('Unable to extract message ID from object:', messageId);
        return; // Skip update if we can't get a valid ID
      }
    }
    
    // Update message status in database
    messageController.updateMessageStatus(messageIdToUse, status)
      .then(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('message-status-update', { messageId: messageIdToUse, status });
        }
      })
      .catch(error => {
        console.error(`Error updating message status for ID ${messageIdToUse}:`, error);
      });
  });
}

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Clean up when app is quitting
app.on('will-quit', async () => {
  // Stop message scheduler
  messageController.stopScheduler();

  // Disconnect WhatsApp if connected
  if (whatsAppService.getStatus().isConnected) {
    try {
      await whatsAppService.disconnect();
    } catch (error) {
      console.error('Error disconnecting WhatsApp:', error);
    }
  }
});

// ----- IPC HANDLERS -----

// --- File Selection ---
ipcMain.handle('select-file', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

// --- Contact Management ---
ipcMain.handle('get-contacts', async () => {
  if (!dbInitialized) throw new Error('Database not initialized');
  return await contactController.getAllContacts();
});

ipcMain.handle('get-contact', async (event, id) => {
  if (!dbInitialized) throw new Error('Database not initialized');
  return await contactController.getContactById(id);
});

ipcMain.handle('get-contacts-paginated', async (event, page, limit, search) => {
  if (!dbInitialized) throw new Error('Database not initialized');
  
  // Default values
  page = parseInt(page || 1);
  limit = parseInt(limit || 50);
  
  // Get paginated contacts
  return await contactController.getContactsPaginated(page, limit, search);
});

ipcMain.handle('add-contact', async (event, contact) => {
  if (!dbInitialized) throw new Error('Database not initialized');
  return await contactController.createContact(contact);
});

ipcMain.handle('update-contact', async (event, id, contact) => {
  if (!dbInitialized) throw new Error('Database not initialized');
  return await contactController.updateContact(id, contact);
});

ipcMain.handle('delete-contact', async (event, id) => {
  if (!dbInitialized) throw new Error('Database not initialized');
  return await contactController.deleteContact(id);
});

// New optimized bulk delete handler
ipcMain.handle('delete-contacts-bulk', async (event, contactIds) => {
  if (!dbInitialized) throw new Error('Database not initialized');
  
  console.log(`Starting bulk delete of ${contactIds.length} contacts`);
  console.time('delete-contacts');
  
  // Set up progress tracking
  const progressCallback = (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('delete-progress', progress);
    }
  };
  
  try {
    // Use the optimized bulk delete method
    const result = await contactController.bulkDeleteContacts(contactIds, progressCallback);
    
    console.timeEnd('delete-contacts');
    console.log(`Delete complete: ${result.deleted} deleted, ${result.errors} errors`);
    
    return result;
  } catch (error) {
    console.error('Error during bulk delete:', error);
    throw error;
  }
});

// Check for duplicate phone number
ipcMain.handle('check-duplicate-phone', async (event, phone, originalPhone = null) => {
  if (!dbInitialized) throw new Error('Database not initialized');
  
  try {
    // Format the phone number
    const formattedPhone = formatPhoneNumber(phone);
    const formattedOriginal = originalPhone ? formatPhoneNumber(originalPhone) : null;
    
    // Check for existing phone number
    const existingContact = await contactController.getContactByPhone(formattedPhone);
    
    // If editing a contact, exclude the current contact from duplicate check
    if (existingContact && formattedOriginal && formattedPhone === formattedOriginal) {
      return false; // Not a duplicate if it's the same contact
    }
    
    return !!existingContact; // Return true if duplicate exists, false otherwise
  } catch (error) {
    console.error('Error checking for duplicate phone:', error);
    throw error;
  }
});

ipcMain.handle('import-contacts', async (event, filePath, fileType) => {
  if (!dbInitialized) throw new Error('Database not initialized');
  
  // Set up progress tracking
  const progressCallback = (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('import-progress', progress);
    }
  };
  
  return await contactController.importContacts(filePath, fileType, progressCallback);
});

// Parse contacts from file without importing
ipcMain.handle('parse-contacts-file', async (event, filePath, fileType) => {
  if (!dbInitialized) throw new Error('Database not initialized');
  
  try {
    console.log(`Parsing contacts from ${filePath} (${fileType})`);
    console.time('parse-contacts');
    
    // Parse the file based on its type
    let contacts = [];
    
    switch (fileType.toLowerCase()) {
      case 'csv':
        contacts = await contactController.readCsvFile(filePath);
        break;
      case 'xlsx':
      case 'xls':
        contacts = await contactController.readExcelFile(filePath);
        break;
      case 'json':
        contacts = await contactController.readJsonFile(filePath);
        break;
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }
    
    console.timeEnd('parse-contacts');
    console.log(`Successfully parsed ${contacts.length} contacts from file`);
    
    // For extremely large datasets, add a warning flag but still return all data
    // The renderer will handle pagination appropriately
    const isLargeDataset = contacts.length > 5000;
    
    // Return with success field for renderer to check
    return {
      success: true,
      contacts: contacts,
      isLargeDataset: isLargeDataset,
      totalCount: contacts.length
    };
  } catch (error) {
    console.error(`Error parsing contacts file: ${error.message}`, error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Import contacts from pre-processed data
ipcMain.handle('import-contacts-from-data', async (event, contacts, sourcePath) => {
  if (!dbInitialized) throw new Error('Database not initialized');
  
  console.log(`Starting import of ${contacts.length} contacts`);
  console.time('import-contacts');
  
  const sourceName = path.basename(sourcePath);
  
  // Set up progress tracking
  const progressCallback = (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('import-progress', progress);
    }
  };
  
  try {
    // Use the optimized bulk import method
    const result = await contactController.bulkImportContacts(contacts, sourceName, progressCallback);
    
    console.timeEnd('import-contacts');
    console.log(`Import complete: ${result.imported} imported, ${result.duplicates} duplicates, ${result.errors} errors`);
    
    return result;
  } catch (error) {
    console.error('Error during bulk import:', error);
    throw error;
  }
});

// --- Template Management ---
ipcMain.handle('get-templates', async () => {
  try {
    // Check if database is initialized
    if (!dbInitialized) {
      return [];
    }
    return await templateController.getAllTemplates();
  } catch (error) {
    console.error('Error in get-templates handler:', error);
    throw error;
  }
});

ipcMain.handle('add-template', async (event, template) => {
  try {
    let imageData = null;
    
    // Handle image if provided
    if (template.imagePath) {
      imageData = template.imagePath;
      delete template.imagePath;
    }
    
    return await templateController.createTemplate(template, imageData);
  } catch (error) {
    console.error('Error in add-template handler:', error);
    throw error;
  }
});

ipcMain.handle('update-template', async (event, id, template) => {
  try {
    let imageData = null;
    
    // Handle image if provided
    if (template.newImagePath) {
      imageData = template.newImagePath;
      delete template.newImagePath;
    }
    
    return await templateController.updateTemplate(id, template, imageData);
  } catch (error) {
    console.error('Error in update-template handler:', error);
    throw error;
  }
});

ipcMain.handle('delete-template', async (event, id) => {
  try {
    return await templateController.deleteTemplate(id);
  } catch (error) {
    console.error('Error in delete-template handler:', error);
    throw error;
  }
});

// --- WhatsApp Connection ---
ipcMain.handle('init-whatsapp', async (event, forceNewQR = false) => {
  try {
    console.log(`Initializing WhatsApp with forceNewQR: ${forceNewQR}`);
    
    // Check if session exists
    const hasSession = whatsAppService.hasExistingSession();
    
    // If forcing new QR and a session exists, delete it first
    if (forceNewQR && hasSession) {
      console.log('Force new QR requested, deleting existing session first');
      await whatsAppService.deleteSessionData();
    }
    
    // Initialize WhatsApp client
    await whatsAppService.initialize();
    
    // Return status with session info
    return { 
      success: true,
      hasExistingSession: whatsAppService.hasExistingSession()
    };
  } catch (error) {
    console.error('Error in init-whatsapp handler:', error);
    throw error;
  }
});

ipcMain.handle('connect-whatsapp', async () => {
  try {
    // Initialize WhatsApp client
    await whatsAppService.initialize();
    
    // Event listeners are already set up in setupWhatsAppEventListeners()
    
    return { success: true };
  } catch (error) {
    console.error('Error in connect-whatsapp handler:', error);
    throw error;
  }
});

ipcMain.handle('disconnect-whatsapp', async (event, deleteSession = false) => {
  try {
    await whatsAppService.disconnect(deleteSession);
    return { success: true };
  } catch (error) {
    console.error('Error in disconnect-whatsapp handler:', error);
    throw error;
  }
});

ipcMain.handle('get-whatsapp-status', () => {
  try {
    const status = whatsAppService.getStatus();
    return {
      ...status,
      hasExistingSession: whatsAppService.hasExistingSession()
    };
  } catch (error) {
    console.error('Error in get-whatsapp-status handler:', error);
    throw error;
  }
});

ipcMain.handle('get-connected-phone-info', async () => {
  try {
    if (!whatsAppService.getStatus().isConnected) {
      return { phoneNumber: null, name: null, connected: false };
    }
    const phoneInfo = await whatsAppService.getConnectedPhoneInfo();
    return { ...phoneInfo, connected: true };
  } catch (error) {
    console.error('Error in get-connected-phone-info handler:', error);
    return { phoneNumber: null, name: null, connected: false };
  }
});

ipcMain.handle('get-whatsapp-info', async () => {
  try {
    if (!whatsAppService.getStatus().isConnected) {
      return { phoneNumber: null, name: null, connected: false };
    }
    const phoneInfo = await whatsAppService.getConnectedPhoneInfo();
    return { ...phoneInfo, connected: true };
  } catch (error) {
    console.error('Error in get-whatsapp-info handler:', error);
    return { phoneNumber: null, name: null, connected: false };
  }
});

// --- Message Scheduling ---
ipcMain.handle('schedule-messages', async (event, config) => {
  try {
    // If using settings schedule but no scheduleTime was provided,
    // this is okay because the controller will use settings
    return await messageController.scheduleMessages(config);
  } catch (error) {
    console.error('Error in schedule-messages handler:', error);
    throw error;
  }
});

ipcMain.handle('get-scheduled-messages', async (event, status) => {
  try {
    // Check if database is initialized
    if (!dbInitialized) {
      return [];
    }
    return await messageController.getScheduledMessages(status);
  } catch (error) {
    console.error('Error in get-scheduled-messages handler:', error);
    throw error;
  }
});

ipcMain.handle('cancel-scheduled-message', async (event, id) => {
  try {
    return await messageController.cancelScheduledMessage(id);
  } catch (error) {
    console.error('Error in cancel-scheduled-message handler:', error);
    throw error;
  }
});

// --- Settings Management ---
ipcMain.handle('get-settings', async () => {
  try {
    // Check if database is initialized
    if (!dbInitialized) {
      // Return default settings
      return {
        activeDays: [1, 2, 3, 4, 5],
        startTime: 9 * 60,
        endTime: 17 * 60,
        messageInterval: 45,
        isActive: false
      };
    }
    return await messageController.getSettings();
  } catch (error) {
    console.error('Error in get-settings handler:', error);
    throw error;
  }
});

ipcMain.handle('update-settings', async (event, settings) => {
  try {
    console.log('Received settings update request:', settings);
    
    // Validate settings object
    if (!settings) {
      throw new Error('Invalid settings object');
    }
    
    // Ensure all required fields are present
    const requiredFields = ['activeDays', 'startTime', 'endTime', 'messageInterval', 'isActive'];
    for (const field of requiredFields) {
      if (settings[field] === undefined) {
        console.error(`Missing required field: ${field}`);
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    // Validate activeDays is an array
    if (!Array.isArray(settings.activeDays)) {
      console.error('activeDays must be an array');
      throw new Error('activeDays must be an array');
    }
    
    // Ensure all times are valid numbers
    if (isNaN(settings.startTime) || isNaN(settings.endTime) || isNaN(settings.messageInterval)) {
      console.error('Time values must be valid numbers');
      throw new Error('Time values must be valid numbers');
    }
    
    // Update settings
    const updatedSettings = await messageController.updateSettings(settings);
    console.log('Settings updated successfully:', updatedSettings);
    
    return updatedSettings;
  } catch (error) {
    console.error('Error in update-settings handler:', error);
    throw error;
  }
});

// Add this to the IPC handlers section
ipcMain.handle('reload-app', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.reload();
    return { success: true };
  }
  return { success: false, error: 'Main window not available' };
});