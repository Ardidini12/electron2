const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { initDatabase, ensureTablesExist, waitForDatabaseReady } = require('./src/database/db');
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
    
    // Clean up any old WhatsApp session directories at startup
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      
      const desktopPath = path.join(os.homedir(), 'Desktop');
      const dbFolder = path.join(desktopPath, 'bss-sender-db');
      
      if (fs.existsSync(dbFolder)) {
        const entries = fs.readdirSync(dbFolder);
        const oldSessionDirs = entries.filter(entry => 
          entry.startsWith('whatsapp-session.old-') && 
          fs.statSync(path.join(dbFolder, entry)).isDirectory()
        );
        
        if (oldSessionDirs.length > 0) {
          console.log(`Found ${oldSessionDirs.length} old WhatsApp session directories to clean up at startup`);
          
          // Delete old session directories
          for (const dirName of oldSessionDirs) {
            const dirPath = path.join(dbFolder, dirName);
            try {
              console.log(`Removing old session directory: ${dirPath}`);
              fs.rmdirSync(dirPath, { recursive: true, force: true });
            } catch (e) {
              console.error(`Failed to remove old session directory ${dirPath}:`, e);
              
              // If removal fails, try to clear contents
              try {
                if (fs.existsSync(dirPath)) {
                  const files = fs.readdirSync(dirPath);
                  for (const file of files) {
                    const filePath = path.join(dirPath, file);
                    try {
                      const stat = fs.lstatSync(filePath);
                      if (stat.isDirectory()) {
                        fs.rmdirSync(filePath, { recursive: true });
                      } else {
                        fs.unlinkSync(filePath);
                      }
                    } catch (innerErr) {
                      console.log(`Could not remove ${filePath}:`, innerErr.message);
                    }
                  }
                }
              } catch (clearErr) {
                console.error('Error clearing directory contents:', clearErr);
              }
            }
          }
        }
      }
    } catch (cleanupErr) {
      console.error('Error during startup cleanup of old sessions:', cleanupErr);
    }
    
    // Create the main window first so we can show errors
    console.log('Creating main application window...');
    createWindow();
    
    // Initialize database with retries
    let dbInitAttempts = 0;
    const maxDbInitAttempts = 3;
    
    console.log('Initializing database...');
    while (!dbInitialized && dbInitAttempts < maxDbInitAttempts) {
      try {
        dbInitAttempts++;
        console.log(`Database initialization attempt ${dbInitAttempts}/${maxDbInitAttempts}...`);
        
        // First ensure tables exist (this is our new function to fix table issues)
        console.log('Ensuring database tables exist...');
        const tablesCreated = await ensureTablesExist();
        
        if (!tablesCreated) {
          throw new Error('Failed to create required database tables');
        }
        
        // Now do the full initialization
        await initDatabase();
        
        // Wait for database to be fully ready (max 10 seconds)
        console.log('Waiting for database to be fully ready...');
        await waitForDatabaseReady(10000);
        
        dbInitialized = true;
        console.log('Database initialized successfully');
      } catch (dbError) {
        console.error(`Database initialization error (attempt ${dbInitAttempts}/${maxDbInitAttempts}):`, dbError);
        
        if (dbInitAttempts < maxDbInitAttempts) {
          // Wait a bit before retrying
          console.log(`Waiting 2 seconds before next attempt...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          // Show error dialog on final attempt
          if (mainWindow && !mainWindow.isDestroyed()) {
            dialog.showErrorBox(
              'Database Error',
              `There was an error initializing the database: ${dbError.message}\n\nThe application will continue with limited functionality. Some features may not work properly.`
            );
          }
        }
      }
    }
    
    // Initialize scheduler and load settings (only if database is initialized)
    if (dbInitialized) {
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
        if (mainWindow && !mainWindow.isDestroyed()) {
          dialog.showErrorBox(
            'Scheduler Error',
            `Failed to start the message scheduler: ${err.message}\n\nScheduled messages may not be sent automatically.`
          );
        }
      }
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
    
    // Check for existing WhatsApp session but let the renderer decide on auto-connect
    try {
      const hasSession = whatsAppService.hasExistingSession();
      console.log(`Existing WhatsApp session check: ${hasSession ? 'Found session' : 'No session found'}`);
      
      // Get the current status to provide more complete information
      const currentStatus = whatsAppService.getStatus();
      
      // Always auto-connect if session exists (no setting dependency)
      if (hasSession && !currentStatus.isConnected) {
        console.log('Auto-connecting to WhatsApp with existing session...');
        try {
          await whatsAppService.initialize();
          console.log('WhatsApp auto-connection started');
        } catch (connError) {
          console.error('Error during WhatsApp auto-connection:', connError);
        }
      }
      
      // Get phone info (never send 'Unknown')
      let phoneInfo = { connected: false };
      try {
        phoneInfo = await whatsAppService.getConnectedPhoneInfo();
      } catch (e) {
        console.log('Could not get connected phone info during startup:', e.message);
      }
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        setTimeout(() => {
          mainWindow.webContents.send('whatsapp-session-check', { 
            hasExistingSession: hasSession,
            isConnected: currentStatus.isConnected,
            status: currentStatus.status,
            phoneInfo,
            autoConnected: hasSession
          });
        }, 3000);
      }
    } catch (err) {
      console.error('Failed to check WhatsApp session:', err);
      if (mainWindow && !mainWindow.isDestroyed()) {
        setTimeout(() => {
          mainWindow.webContents.send('whatsapp-session-check', { 
            hasExistingSession: false,
            isConnected: false,
            status: 'error',
            phoneInfo: { connected: false },
            error: err.message
          });
        }, 3000);
      }
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
  whatsAppService.removeAllListeners('whatsapp-info');
  whatsAppService.removeAllListeners('state_change');
  whatsAppService.removeAllListeners('message_status_change');
  whatsAppService.removeAllListeners('message_sent');
  whatsAppService.removeAllListeners('loading');
  
  // Set up event listeners for WhatsApp
  whatsAppService.on('qr', (qr) => {
    console.log('WhatsApp QR code received');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-qr', qr);
    }
  });
  
  // Add loading event listener
  whatsAppService.on('loading', (data) => {
    console.log(`WhatsApp loading: ${data.percent}% - ${data.message}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('loading', data);
    }
  });
  
  whatsAppService.on('ready', async () => {
    console.log('WhatsApp ready');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-ready');
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
      mainWindow.webContents.send('whatsapp-authenticated');
      mainWindow.webContents.send('whatsapp-status', 'AUTHENTICATED');
    }
  });
  
  whatsAppService.on('auth_failure', async (error) => {
    console.error('WhatsApp authentication failed:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-status', 'AUTH_FAILED', error.message);
      // Let WhatsApp service handle session deletion - it should do it automatically on auth failure
      mainWindow.webContents.send('whatsapp-qr', null); // Signal to show QR again
    }
  });
  
  whatsAppService.on('disconnected', (reason) => {
    console.log('WhatsApp disconnected, reason:', reason);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-disconnected', reason);
      mainWindow.webContents.send('whatsapp-status', 'DISCONNECTED', reason);
    }
  });
  
  whatsAppService.on('message_status_change', async (statusUpdate) => {
    try {
      console.log(`[MAIN] Received WhatsApp status update: ${statusUpdate.externalId} -> ${statusUpdate.status}`);
      
      // Update the message status in the database
      const updateResult = await messageController.updateMessageStatus(
        statusUpdate.externalId, 
        statusUpdate.status,
        statusUpdate.timestamp
      );
      
      if (!updateResult) {
        console.warn(`Unable to update message status in database: ${statusUpdate.externalId}`);
      }
      
      // Additional message data lookup for complete UI updates
      try {
        const { models } = require('./src/database/db');
        const Message = models.Message;
        const message = await Message.findOne({
          where: { externalId: statusUpdate.externalId }
        });
        
        if (message) {
          // Send the update to the renderer with complete information
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('message-status-update', {
              id: message.id,
              externalId: statusUpdate.externalId,
              status: statusUpdate.status,
              timestamp: statusUpdate.timestamp,
              deliveredTime: message.deliveredTime,
              readTime: message.readTime,
              sentTime: message.sentTime
            });
          }
        } else {
          // If message not found in DB, still send the basic update
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('message-status-update', statusUpdate);
          }
        }
      } catch (lookupError) {
        console.error('Error looking up complete message data:', lookupError);
        // Still send the basic status update if lookup fails
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('message-status-update', statusUpdate);
        }
      }
    } catch (error) {
      console.error('Error processing message status update:', error);
    }
  });
  
  whatsAppService.on('message_sent', (message) => {
    // Reduced logging for sent messages
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('message-sent', message);
    }
  });
  
  whatsAppService.on('state_change', (state) => {
    // Only log significant state changes
    if (state === 'CONNECTED' || state === 'DISCONNECTED') {
      console.log(`WhatsApp state: ${state}`);
    }
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-state', state);
    }
  });
  
  // Handle phone info updates directly from the service
  whatsAppService.on('whatsapp-info', (info) => {
    console.log('Received WhatsApp phone info update');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-info', info);
    }
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

  // Disconnect WhatsApp if connected, but keep session data
  if (whatsAppService.getStatus().isConnected) {
    try {
      await whatsAppService.disconnect(false); // false = don't delete session
    } catch (error) {
      console.error('Error disconnecting WhatsApp:', error);
    }
  }
  
  // Clean up any browser processes
  killChromiumProcesses();
});

// Handler for kill browser processes request
ipcMain.on('kill-browser-processes', () => {
  killChromiumProcesses();
});

/**
 * Utility function to kill hanging Chromium processes
 */
function killChromiumProcesses() {
  try {
    // On Windows, use taskkill to clean up chrome processes
    if (process.platform === 'win32') {
      const { exec } = require('child_process');
      exec('taskkill /F /IM chrome.exe /T', (error, stdout, stderr) => {
        if (error) {
          // Error 128 means no matching processes found, which is fine
          if (error.code !== 128) {
            console.error(`Error killing Chrome processes: ${error.message}`);
          }
        }
        if (stdout) console.log(`Taskkill output: ${stdout}`);
        if (stderr) console.error(`Taskkill error: ${stderr}`);
      });
    }
    // On Linux/Mac, use pkill
    else if (process.platform === 'linux' || process.platform === 'darwin') {
      const { exec } = require('child_process');
      exec('pkill -f chrome', (error, stdout, stderr) => {
        if (error) {
          // Error code 1 means no processes matched pattern, which is fine
          if (error.code !== 1) {
            console.error(`Error killing Chrome processes: ${error.message}`);
          }
        }
      });
    }
  } catch (error) {
    console.error('Error in killChromiumProcesses:', error);
  }
}

// ----- IPC HANDLERS -----

// --- File Selection ---
ipcMain.handle('select-file', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

// Additional file dialog handler (alias for select-file)
ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

// --- Contact Management ---
ipcMain.handle('get-contacts', async () => {
  try {
    // Wait for database to be ready before proceeding
    const { waitForDatabaseReady } = require('./src/database/db');
    await waitForDatabaseReady(5000);
    
    // Now get contacts
  return await contactController.getAllContacts();
  } catch (error) {
    console.error('Error in get-contacts handler:', error);
    throw error;
  }
});

ipcMain.handle('get-contact', async (event, id) => {
  return await contactController.getContactById(id);
});

ipcMain.handle('get-contacts-paginated', async (event, page, limit, search) => {
  try {
    // Wait for database to be ready before proceeding
    const { waitForDatabaseReady } = require('./src/database/db');
    await waitForDatabaseReady(5000);
    
  // Default values
  page = parseInt(page || 1);
  limit = parseInt(limit || 50);
  
  // Get paginated contacts
  return await contactController.getContactsPaginated(page, limit, search);
  } catch (error) {
    console.error('Error in get-contacts-paginated handler:', error);
    throw error;
  }
});

ipcMain.handle('add-contact', async (event, contact) => {
  return await contactController.createContact(contact);
});

ipcMain.handle('update-contact', async (event, id, contact) => {
  return await contactController.updateContact(id, contact);
});

ipcMain.handle('delete-contact', async (event, id) => {
  return await contactController.deleteContact(id);
});

// New optimized bulk delete handler
ipcMain.handle('delete-contacts-bulk', async (event, contactIds) => {
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
ipcMain.handle('import-contacts-from-data', async (event, contacts, source) => {
  console.log(`Starting import of ${contacts.length} contacts from data`);
  console.time('import-contacts');
  
  // Set up progress tracking
  const progressCallback = (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('import-progress', progress);
    }
  };
  
  try {
    // Use the optimized bulk import method
    const result = await contactController.bulkImportContacts(contacts, source, progressCallback);
    
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
    return await templateController.getAllTemplates();
  } catch (error) {
    console.error('Error in get-templates handler:', error);
    throw error;
  }
});

// Template handler aliases
ipcMain.handle('get-template', async (event, id) => {
  try {
    const result = await templateController.getTemplateById(id);
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    return result.template;
  } catch (error) {
    console.error('Error in get-template handler:', error);
    throw error;
  }
});

ipcMain.handle('create-template', async (event, template) => {
  try {
    if (!template.name || !template.content) {
      throw new Error('Template name and content are required');
    }
    
    let imageData = null;
    if (template.imagePath) {
      imageData = await fs.promises.readFile(template.imagePath);
      delete template.imagePath;
    }
    
    const result = await templateController.createTemplate(template, imageData);
    
    // Check if there was an error creating the template
    if (!result.success) {
      throw new Error(result.error);
    }
    
    // Return the full result object including any warnings
    return result;
  } catch (error) {
    console.error('Error in create-template handler:', error);
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
    
    const result = await templateController.createTemplate(template, imageData);
    
    // Check if there was an error creating the template
    if (!result.success) {
      throw new Error(result.error);
    }
    
    return result.template;
  } catch (error) {
    console.error('Error in add-template handler:', error);
    throw error;
  }
});

ipcMain.handle('update-template', async (event, id, template) => {
  try {
    if (!template.name || !template.content) {
      throw new Error('Template name and content are required');
    }
    
    const result = await templateController.updateTemplate(id, template);
    
    // Check if there was an error updating the template
    if (!result.success) {
      throw new Error(result.error);
    }
    
    // Return the full result object including any warnings
    return result;
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
    console.log(`Session check in init-whatsapp handler: ${hasSession ? 'Found existing session' : 'No session found'}`);
    
    // If forcing new QR and a session exists, delete it first
    if (forceNewQR && hasSession) {
      console.log('Force new QR requested, deleting existing session first');
      await whatsAppService.deleteSessionData();
    }
    
    // Check if already connected
    const currentStatus = whatsAppService.getStatus();
    if (currentStatus.isConnected && !forceNewQR) {
      console.log('WhatsApp is already connected, skipping initialization');
      
      // Still send status update to ensure UI is in sync
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('whatsapp-status', 'CONNECTED');
        
        // Also send phone info if available
        try {
          const phoneInfo = await whatsAppService.getConnectedPhoneInfo();
          mainWindow.webContents.send('whatsapp-info', phoneInfo);
        } catch (infoError) {
          console.error('Error getting phone info for connected client:', infoError);
        }
      }
      
      return { 
        success: true,
        isConnected: true,
        hasExistingSession: true,
        message: 'WhatsApp is already connected'
      };
    }
    
    // Initialize WhatsApp client
    try {
      await whatsAppService.initialize();
    } catch (error) {
      console.error('Error initializing WhatsApp client:', error);
      
      // Check if this is a browser disconnection or navigation error
      if (error.message && (
          error.message.includes('browser has disconnected') || 
          error.message.includes('Navigation failed') ||
          error.message.includes('Browser closed'))) {
        
        // Notify the renderer about browser disconnection
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('browser-disconnected');
        }
      }
      
      throw error;
    }
    
    // Return status with session info
    return { 
      success: true,
      hasExistingSession: whatsAppService.hasExistingSession(),
      isConnected: whatsAppService.getStatus().isConnected
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
      return { connected: false };
    }
    try {
      const phoneInfo = await whatsAppService.getConnectedPhoneInfo();
      
      // Cache the phone info in case we need it later
      global.cachedWhatsAppInfo = phoneInfo;
      
      return { ...phoneInfo, connected: true };
    } catch (phoneInfoError) {
      console.error('Error in get-whatsapp-info handler when getting phone info:', phoneInfoError);
      
      // Return cached info if available
      if (global.cachedWhatsAppInfo) {
        console.log('Returning cached WhatsApp info');
        return { ...global.cachedWhatsAppInfo, connected: true };
      }
      
      return { connected: false };
    }
  } catch (error) {
    console.error('Error in get-whatsapp-info handler:', error);
    
    // Return cached info if available
    if (global.cachedWhatsAppInfo) {
      console.log('Returning cached WhatsApp info after error');
      return { ...global.cachedWhatsAppInfo, connected: true };
    }
    
    return { connected: false };
  }
});

// Add handler for refreshing WhatsApp phone info
ipcMain.handle('refresh-whatsapp-info', async () => {
  try {
    if (!whatsAppService.getStatus().isConnected) {
      return { 
        success: false, 
        error: 'WhatsApp is not connected',
        phoneInfo: { phoneNumber: 'Unknown', name: 'Unknown', connected: false }
      };
    }
    
    console.log('Refreshing WhatsApp phone info...');
    const phoneInfo = await whatsAppService.getConnectedPhoneInfo();
    
    return { 
      success: true, 
      phoneInfo 
    };
  } catch (error) {
    console.error('Error refreshing WhatsApp phone info:', error);
    
    return { 
      success: false, 
      error: error.message,
      phoneInfo: { 
        phoneNumber: 'Unknown', 
        name: 'Unknown', 
        connected: whatsAppService.getStatus().isConnected 
      }
    };
  }
});

// --- Message Scheduling ---
ipcMain.handle('schedule-messages', async (event, config) => {
  try {
    console.log('Received request to schedule messages:', config);
    
    // Schedule the messages
    const result = await messageController.scheduleMessages(config);
    
    // If messages were scheduled successfully, ensure the scheduler is running
    if (result.success && result.scheduledCount > 0) {
      await messageController.startScheduler();
    }
    
    return result;
  } catch (error) {
    console.error('Error handling schedule-messages:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('get-scheduled-messages', async (event, status) => {
  try {
    // Wait for database to be ready before proceeding
    const { waitForDatabaseReady } = require('./src/database/db');
    await waitForDatabaseReady(5000);
    
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

// Add new handler for deleting messages
ipcMain.handle('delete-messages', async (event, ids) => {
  try {
    return await messageController.deleteMessages(ids);
  } catch (error) {
    console.error('Error deleting messages:', error);
    return { success: false, error: error.message };
  }
});

// --- Settings Management ---
ipcMain.handle('get-settings', async () => {
  try {
    console.log('===== SETTINGS GET REQUEST =====');
    
    // Get settings from controller
    const settings = await messageController.getSettings();
    console.log('Retrieved settings from controller:', JSON.stringify(settings));
    
    // Ensure activeDays is an array before returning
    if (settings && typeof settings.activeDays === 'string') {
      try {
        settings.activeDays = JSON.parse(settings.activeDays);
      } catch (e) {
        console.error('Error parsing activeDays in handler:', e);
        settings.activeDays = [1, 2, 3, 4, 5];
      }
    }
    
    if (settings && !Array.isArray(settings.activeDays)) {
      settings.activeDays = [1, 2, 3, 4, 5];
    }
    
    console.log('Final settings being sent to renderer:', JSON.stringify(settings));
    console.log('===== SETTINGS GET COMPLETE =====');
    return settings;
  } catch (error) {
    console.error('Error in get-settings handler:', error);
    
    // Return default settings on error
    const defaultSettings = {
      activeDays: [1, 2, 3, 4, 5],
      startTime: 9 * 60,
      endTime: 17 * 60,
      messageInterval: 45,
      isActive: false
    };
    
    console.log('Returning default settings due to error');
    return defaultSettings;
  }
});

ipcMain.handle('update-settings', async (event, settings) => {
  try {
    console.log('===== SETTINGS UPDATE REQUEST =====');
    console.log('Received settings update request:', JSON.stringify(settings));
    
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
    
    // Process and validate activeDays
    let processedSettings = { ...settings };
    
    // Ensure activeDays is properly formatted
    if (!Array.isArray(processedSettings.activeDays)) {
      if (typeof processedSettings.activeDays === 'string') {
        try {
          processedSettings.activeDays = JSON.parse(processedSettings.activeDays);
          console.log('Parsed activeDays from string:', processedSettings.activeDays);
        } catch (e) {
          console.error('Error parsing activeDays string:', e);
          processedSettings.activeDays = [1, 2, 3, 4, 5]; // Default to Mon-Fri
        }
      } else {
        console.error('activeDays must be an array, using default');
        processedSettings.activeDays = [1, 2, 3, 4, 5];
      }
    }
    
    // Validate activeDays is now an array
    if (!Array.isArray(processedSettings.activeDays)) {
      console.error('activeDays is still not an array after processing, using default');
      processedSettings.activeDays = [1, 2, 3, 4, 5];
    }
    
    // Ensure all times are valid numbers
    processedSettings.startTime = parseInt(processedSettings.startTime);
    processedSettings.endTime = parseInt(processedSettings.endTime);
    processedSettings.messageInterval = parseInt(processedSettings.messageInterval);
    
    if (isNaN(processedSettings.startTime) || isNaN(processedSettings.endTime) || isNaN(processedSettings.messageInterval)) {
      console.error('Time values must be valid numbers');
      throw new Error('Time values must be valid numbers');
    }
    
    console.log('Processed settings before update:', JSON.stringify(processedSettings));
    
    // Update settings
    const updatedSettings = await messageController.updateSettings(processedSettings);
    console.log('Settings updated successfully, returning to renderer:', JSON.stringify(updatedSettings));
    console.log('===== SETTINGS UPDATE COMPLETE =====');
    
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

// Add the IPC handlers for contact export functionality
ipcMain.handle('export-contacts-json', async () => {
  try {
    return await contactController.exportContactsAsJson();
  } catch (error) {
    console.error('Error exporting contacts as JSON:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('export-contacts-csv', async () => {
  try {
    return await contactController.exportContactsAsCsv();
  } catch (error) {
    console.error('Error exporting contacts as CSV:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('export-contacts-excel', async () => {
  try {
    return await contactController.exportContactsAsExcel();
  } catch (error) {
    console.error('Error exporting contacts as Excel:', error);
    return { success: false, error: error.message };
  }
});

// Add handler for resetting the database (for recovery)
ipcMain.handle('reset-database', async () => {
  try {
    console.log('Reset database requested from renderer');
    
    // Stop scheduler first
    messageController.stopScheduler();
    
    // Reset the database
    const { resetDatabase } = require('./src/database/db');
    await resetDatabase();
    
    // Reinitialize database and start scheduler
    await initDatabase();
    await messageController.startScheduler();
    
    console.log('Database reset completed successfully');
    return { 
      success: true, 
      message: 'Database reset successfully. The application will reload.'
    };
  } catch (error) {
    console.error('Error resetting database:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
});

// Add handler for recovering the database without resetting
ipcMain.handle('recover-database', async () => {
  try {
    console.log('Database recovery requested from renderer');
    
    // Stop scheduler first
    messageController.stopScheduler();
    
    // Recover the database
    const { recoverDatabase } = require('./src/database/db');
    const recovered = await recoverDatabase();
    
    if (!recovered) {
      throw new Error('Database recovery failed, please try resetting the database');
    }
    
    // Reinitialize database and start scheduler
    await initDatabase();
    await messageController.startScheduler();
    
    console.log('Database recovery completed successfully');
    return { 
      success: true, 
      message: 'Database recovered successfully. The application will reload.'
    };
  } catch (error) {
    console.error('Error recovering database:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
});

ipcMain.handle('get-contacts-count', async () => {
  try {
    return await contactController.getContactsCount();
  } catch (error) {
    console.error('Error getting contacts count:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-all-contacts', async () => {
  try {
    return await contactController.deleteAllContacts();
  } catch (error) {
    console.error('Error deleting all contacts:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-contacts', async (event, ids) => {
  try {
    return await contactController.deleteContacts(ids);
  } catch (error) {
    console.error('Error deleting contacts:', error);
    return { success: false, error: error.message };
  }
});