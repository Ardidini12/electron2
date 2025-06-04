const axios = require('axios');
const { Op } = require('sequelize');
const { models, sequelize } = require('../database/db');
const SalesContact = models.SalesContact;
const salesMessageController = require('./SalesMessageController');

// Configuration
const AUTH_URL = 'https://crm-api.bss.com.al/authentication/login';
const SALES_API_URL = 'https://crm-api.bss.com.al';
const CREDENTIALS = {
  userName: 'Admin',
  password: 'T3aWy<[3dq07'
};
const CITIES = ['tirane', 'vlore', 'fier'];
const REFRESH_INTERVAL = 10 * 1000; // 10 seconds
const RECOVERY_DAYS = 30; // Number of days to look back for recovery

// Add debug option to log API responses
const DEBUG_API = true;

class SalesApiController {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiration = null;
    this.timer = null;
    this.isRunning = false;
    this.lastSyncDate = null;
    this.nextSyncDate = null;
    this.syncStatus = {
      tirane: { lastSync: null, count: 0 },
      vlore: { lastSync: null, count: 0 },
      fier: { lastSync: null, count: 0 }
    };
    this.processedIds = {};
    this.isRecoveryRunning = false;
    
    console.log('SalesApiController initialized, isRunning:', this.isRunning);
  }

  async authenticate() {
    try {
      console.log('Authenticating with Sales API...');
      const response = await axios.post(AUTH_URL, CREDENTIALS, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      this.accessToken = response.data.accessToken;
      this.refreshToken = response.data.refreshToken;
      this.tokenExpiration = new Date();
      this.tokenExpiration.setHours(this.tokenExpiration.getHours() + 8); // Token valid for 8 hours

      console.log('Authentication successful');
      return true;
    } catch (error) {
      console.error('Authentication failed:', error.message);
      return false;
    }
  }

  isTokenValid() {
    if (!this.accessToken || !this.tokenExpiration) return false;
    const now = new Date();
    return now < this.tokenExpiration;
  }

  async ensureAuthenticated() {
    if (!this.isTokenValid()) {
      return await this.authenticate();
    }
    return true;
  }

  /**
   * Fetch sales contacts from API
   * @param {string} city - City name
   * @param {Date} date - Date to fetch
   * @returns {Promise<Object>} - Fetched data
   */
  async fetchSalesContacts(city, date) {
    try {
      // Ensure we have a valid token
      await this.ensureAuthenticated();
      
      // Format date for API
      const formattedDate = this.formatDate(date);
      
      console.log(`Fetching sales contacts for ${city} on ${formattedDate}...`);
      
      // Make API request - using the correct URL format with proper parameters
      const url = `${SALES_API_URL}/11120/Sales?Date=${formattedDate}&PageNumber=1&PageSize=100&HasPhone=true&CustomerGroup=PAKICE&ItemParentGroup=K1&Detailed=false&Town=${city}`;
      console.log(`Requesting: ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`
        },
        // Add timeout to prevent hanging requests
        timeout: 15000
      });
      
      // Log detailed API response for debugging
      if (DEBUG_API) {
        console.log(`API Response status: ${response.status}`);
        console.log(`API Response data length: ${response.data ? (Array.isArray(response.data) ? response.data.length : 'Not an array') : 'No data'}`);
        
        // Log full sample of the response data for debugging
        if (response.data && response.data.length > 0) {
          console.log('Response data sample:', JSON.stringify(response.data[0]));
        } else if (response.data) {
          console.log('Response data:', JSON.stringify(response.data).substring(0, 500));
        }
      }
      
      if (response.status !== 200) {
        throw new Error(`API request failed with status ${response.status}`);
      }
      
      const data = response.data;
      
      // Validate that data is an array
      if (!Array.isArray(data)) {
        console.error(`API response is not an array: ${typeof data}`);
        if (DEBUG_API && data) {
          console.log('Response data sample:', JSON.stringify(data).substring(0, 200));
        }
        // Return empty contacts as a fallback
        return {
          city,
          date,
          contacts: []
        };
      }
      
      // Return structured data - FIXED the property mapping to match the actual API response
      const contacts = data
        .filter(contact => contact && (
          (contact.businessEntity && contact.businessEntity.phone) ||
          (contact.businessEntity && contact.businessEntity.mobile)
        ))
        .map(contact => ({
          id: contact.id,
          name: contact.businessEntity?.name || 'Unknown',
          phone: contact.businessEntity?.phone || contact.businessEntity?.mobile || '',
          code: contact.businessEntity?.code || '',
          documentNumber: contact.documentNumber || '',
          documentDate: contact.documentDate || null,
          shopId: contact.businessEntity?.shopId || null,
          city: contact.businessEntity?.town || city
        }));
      
      console.log(`Retrieved ${contacts.length} contacts for ${city} on ${formattedDate}`);
      
      return {
        city,
        date,
        contacts
      };
    } catch (error) {
      console.error(`Error fetching sales contacts for ${city} on ${this.formatDate(date)}:`, error);
      // Return empty contacts array instead of throwing
      return {
        city,
        date,
        contacts: []
      };
    }
  }

  formatDate(date) {
    const d = new Date(date);
    const month = ('0' + (d.getMonth() + 1)).slice(-2);
    const day = ('0' + d.getDate()).slice(-2);
    const year = d.getFullYear();
    return `${month}/${day}/${year}`;
  }

  getDateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  initializeProcessedIdsForDate(dateKey) {
    if (!this.processedIds[dateKey]) {
      this.processedIds[dateKey] = {
        tirane: [],
        vlore: [],
        fier: []
      };
    }
  }

  /**
   * Process and save sales contacts from API
   * @param {Object} cityData - City data with contacts
   * @returns {Promise<Object>} - Processing results
   */
  async processSalesContacts(cityData) {
    if (!cityData || !cityData.city || !cityData.date || !cityData.contacts) {
      return { total: 0, created: 0, duplicates: 0, skipped: 0, errors: 0, autoScheduled: 0 };
    }
    
    const { city, date, contacts } = cityData;
    console.log(`Processing ${contacts.length} contacts for ${city}`);
    
    // Empty array check - provide better logging
    if (contacts.length === 0) {
      console.log(`No contacts found for ${city} on ${this.formatDate(date)} - this may be normal for today's data or the API returned no results`);
      return { total: 0, created: 0, duplicates: 0, skipped: 0, errors: 0, autoScheduled: 0 };
    }
    
    // Check if we need to track processed IDs
    const dateKey = this.getDateKey(date);
    if (!this.processedIds[dateKey]) {
      this.initializeProcessedIdsForDate(dateKey);
    }
    
    // Get sales message settings to check if auto-scheduling is enabled
    const settings = await salesMessageController.getSettings();
    const autoSchedulingEnabled = settings.isAutoSchedulingEnabled;
    
    // Process each contact
    let created = 0;
    let duplicates = 0;
    let skipped = 0;
    let errors = 0;
    let autoScheduled = 0;
    
    // Log settings status
    console.log(`Processing with auto-scheduling: ${autoSchedulingEnabled ? 'enabled' : 'disabled'}`);
    
    for (const contact of contacts) {
      try {
        // Skip contacts we've already processed for this date
        if (this.processedIds[dateKey][city].includes(contact.id)) {
          skipped++;
          continue;
        }
        
        // Add to processed IDs list
        this.processedIds[dateKey][city].push(contact.id);
        
        // Format phone number
        const formattedPhone = this.formatPhoneNumber(contact.phone);
        
        // Check if the contact already exists in the database by contactId only
        const existingContact = await SalesContact.findOne({
          where: { contactId: contact.id }
        });
        
        if (existingContact) {
          // If contact already exists, just update the record if needed
          const updatedFields = {};
          let needsUpdate = false;
          
          // Only update fields if they've changed
          if (existingContact.name !== contact.name) {
            updatedFields.name = contact.name;
            needsUpdate = true;
          }
          
          if (existingContact.city !== city) {
            updatedFields.city = city;
            needsUpdate = true;
          }
          
          if (existingContact.documentNumber !== contact.documentNumber) {
            updatedFields.documentNumber = contact.documentNumber;
            needsUpdate = true;
          }
          
          if (existingContact.documentDate !== new Date(contact.documentDate)) {
            updatedFields.documentDate = new Date(contact.documentDate);
            needsUpdate = true;
          }
          
          if (existingContact.code !== contact.code) {
            updatedFields.code = contact.code;
            needsUpdate = true;
          }
          
          if (existingContact.shopId !== contact.shopId) {
            updatedFields.shopId = contact.shopId;
            needsUpdate = true;
          }
          
          if (needsUpdate) {
            await existingContact.update(updatedFields);
          }
          
          duplicates++;
          console.log(`Contact already exists: ${contact.name} (${formattedPhone})`);
        } else {
          // Create new sales contact
          try {
            console.log(`Creating new contact: ${contact.name} (${formattedPhone}) with ID ${contact.id}`);
            const newContact = await SalesContact.create({
              contactId: contact.id,
              name: contact.name || 'Unknown',
              phoneNumber: formattedPhone,
              code: contact.code || null,
              city: contact.city || city,
              documentNumber: contact.documentNumber || null,
              documentDate: contact.documentDate ? new Date(contact.documentDate) : null,
              shopId: contact.shopId || null,
              sourceData: JSON.stringify(contact),
              imported: false
            });
            
            created++;
            
            // Schedule messages if auto-scheduling is enabled
            if (autoSchedulingEnabled) {
              try {
                console.log(`=== AUTO-SCHEDULING === Attempting to schedule messages for ${newContact.name} (${newContact.phoneNumber})`);
                const schedulingResult = await salesMessageController.handleNewSalesContact(newContact);
                
                // Add detailed logging of the scheduling result
                if (schedulingResult.scheduled) {
                  autoScheduled++;
                  console.log(`=== AUTO-SCHEDULING SUCCESS === Auto-scheduled messages for ${newContact.name} (${newContact.phoneNumber})`);
                  console.log(`  First Message: ${schedulingResult.firstMessage ? 'Created (ID: ' + schedulingResult.firstMessage.id + ')' : 'Failed'}`);
                  console.log(`  Second Message: ${schedulingResult.secondMessage ? 'Created (ID: ' + schedulingResult.secondMessage.id + ')' : 'Failed'}`);
                  
                  // Mark as imported if auto-scheduled
                  await newContact.update({ 
                    imported: true,
                    importedAt: new Date()
                  });
                } else {
                  console.log(`=== AUTO-SCHEDULING SKIPPED === No messages auto-scheduled for ${newContact.name} (${newContact.phoneNumber})`);
                  console.log(`  Reason: ${schedulingResult.message || 'No reason provided'}`);
                  if (schedulingResult.error) {
                    console.log(`  Error: ${schedulingResult.error}`);
                  }
                }
              } catch (schedulingError) {
                console.error(`=== AUTO-SCHEDULING ERROR === Failed to schedule messages for contact ${contact.id}:`, schedulingError);
              }
            } else {
              console.log(`=== AUTO-SCHEDULING DISABLED === Not scheduling messages for ${newContact.name} (${newContact.phoneNumber})`);
            }
          } catch (createError) {
            // If it's a unique constraint error, count as duplicate
            if (createError.name === 'SequelizeUniqueConstraintError') {
              duplicates++;
              console.log(`Duplicate detected during create: ${contact.name} (${formattedPhone})`);
            } else {
              errors++;
              console.error(`Error creating contact ${contact.id}:`, createError);
            }
          }
        }
      } catch (error) {
        errors++;
        console.error(`Error processing contact ${contact.id}:`, error);
      }
    }
    
    console.log(`Processed ${contacts.length} contacts for ${city}: ${created} created, ${duplicates} duplicates, ${skipped} skipped, ${errors} errors, ${autoScheduled} auto-scheduled`);
    
    return { 
      total: contacts.length, 
      created, 
      duplicates, 
      skipped, 
      errors,
      autoScheduled
    };
  }

  /**
   * Start the sync process
   * @returns {Promise<Object>} - Sync result
   */
  async startSyncProcess() {
    if (this.isRunning) {
      console.log('Sync process already running');
      return { success: false, message: 'Sync process already running' };
    }
    
    this.isRunning = true;
    console.log('Starting sync process...');
    
    try {
      // Get today's date
      const today = new Date();
      
      // Get available cities
      const cities = this.getAvailableCities();
      
      // Create promises for each city
      const cityPromises = cities.map(async (city) => {
        try {
          // Fetch contacts for the city
          const cityData = await this.fetchSalesContacts(city, today);
          
          // Skip if no contacts were found or if there was an error
          if (!cityData || !cityData.contacts || cityData.contacts.length === 0) {
            console.log(`No contacts found for ${city} or there was an error`);
            return { 
              city, 
              result: { 
                total: 0, 
                created: 0, 
                duplicates: 0, 
                skipped: 0, 
                errors: 0, 
                autoScheduled: 0 
              } 
            };
          }
          
          // Process the fetched contacts
          const result = await this.processSalesContacts(cityData);
          
          // Update sync status
          this.syncStatus[city] = {
            lastSync: new Date(),
            count: (this.syncStatus[city]?.count || 0) + result.created
          };
          
          return { city, result };
        } catch (error) {
          console.error(`Error syncing city ${city}:`, error);
          return { 
            city, 
            error: error.message,
            result: { 
              total: 0, 
              created: 0, 
              duplicates: 0, 
              skipped: 0, 
              errors: 0, 
              autoScheduled: 0 
            } 
          };
        }
      });
      
      // Run all city promises
      const results = await Promise.all(cityPromises);
      
      // Save the last sync time
      this.lastSyncDate = new Date();
      
      // Clean up old date keys to prevent memory leaks
      this.cleanupOldDateKeys();
      
      console.log('Sync process completed successfully');
      return { success: true, results };
    } catch (error) {
      console.error('Error during sync process:', error);
      return { success: false, error: error.message };
    } finally {
      this.isRunning = false;
      console.log('Sync process ended, isRunning set to false');
    }
  }

  cleanupOldDateKeys() {
    const today = new Date();
    const dateKeys = Object.keys(this.processedIds);
    
    // Keep only the last 7 days of data
    dateKeys.forEach(dateKey => {
      const dateParts = dateKey.split('-');
      const dateObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
      
      // If older than 7 days, remove
      const diffDays = Math.floor((today - dateObj) / (1000 * 60 * 60 * 24));
      if (diffDays > 7) {
        delete this.processedIds[dateKey];
      }
    });
  }

  startPeriodicSync() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    
    console.log('Starting periodic sync process...');
    
    // First, try to recover any missed days
    this.recoverMissedDays();
    
    // Start immediate sync for today
    this.startSyncProcess();
    
    // Set up interval
    this.timer = setInterval(() => {
      console.log('Timer triggered, starting sync process...');
      this.startSyncProcess();
    }, REFRESH_INTERVAL);
    
    this.nextSyncDate = new Date(Date.now() + REFRESH_INTERVAL);
    console.log(`Periodic sync started with interval of ${REFRESH_INTERVAL / 1000} seconds (${REFRESH_INTERVAL} ms)`);
    console.log('Next sync scheduled for:', this.nextSyncDate);
  }

  stopPeriodicSync() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.nextSyncDate = null;
      console.log('Periodic sync stopped');
    }
  }

  async getSalesContacts(options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        city = null,
        search = null,
        sortBy = 'documentDate',
        sortOrder = 'DESC',
        startDate = null,
        endDate = null
      } = options;
      
      const offset = (page - 1) * limit;
      
      // Build the where clause based on filters
      const where = {};
      
      if (city) {
        where.city = city;
      }
      
      if (startDate && endDate) {
        where.documentDate = {
          [Op.between]: [new Date(startDate), new Date(endDate)]
        };
      } else if (startDate) {
        where.documentDate = {
          [Op.gte]: new Date(startDate)
        };
      } else if (endDate) {
        where.documentDate = {
          [Op.lte]: new Date(endDate)
        };
      }
      
      // Handle search
      if (search) {
        where[Op.or] = [
          { name: { [Op.like]: `%${search}%` } },
          { phoneNumber: { [Op.like]: `%${search}%` } },
          { code: { [Op.like]: `%${search}%` } },
          { documentNumber: { [Op.like]: `%${search}%` } }
        ];
      }
      
      // Query with pagination
      const { rows, count } = await SalesContact.findAndCountAll({
        where,
        limit,
        offset,
        order: [[sortBy, sortOrder]],
        raw: true
      });
      
      return {
        data: rows,
        pagination: {
          total: count,
          page,
          limit,
          pages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      console.error('Error getting sales contacts:', error.message);
      throw error;
    }
  }

  async getSalesSummary() {
    try {
      // Get total counts by city
      const cityCounts = await SalesContact.findAll({
        attributes: [
          'city', 
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('MAX', sequelize.col('createdAt')), 'lastRecord']
        ],
        group: ['city'],
        raw: true
      });
      
      // Get today's count
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayCount = await SalesContact.count({
        where: {
          createdAt: {
            [Op.gte]: today
          }
        }
      });
      
      // Format city data
      const cityData = {};
      CITIES.forEach(city => {
        const cityInfo = cityCounts.find(c => c.city === city) || { count: 0, lastRecord: null };
        cityData[city] = {
          count: parseInt(cityInfo.count || 0),
          lastSync: cityInfo.lastRecord ? new Date(cityInfo.lastRecord) : null
        };
      });
      
      return {
        totalRecords: cityCounts.reduce((sum, city) => sum + parseInt(city.count || 0), 0),
        todayCount,
        cities: cityData
      };
    } catch (error) {
      console.error('Error getting sales summary:', error.message);
      return {
        totalRecords: 0,
        todayCount: 0,
        cities: CITIES.reduce((obj, city) => ({ ...obj, [city]: { count: 0, lastSync: null } }), {})
      };
    }
  }

  async deleteSalesContacts(ids) {
    try {
      const result = await SalesContact.destroy({
        where: {
          id: {
            [Op.in]: ids
          }
        }
      });
      
      return {
        success: true,
        deleted: result
      };
    } catch (error) {
      console.error('Error deleting sales contacts:', error.message);
      throw error;
    }
  }

  async deleteAllSalesContacts() {
    try {
      const result = await SalesContact.destroy({
        where: {},
        truncate: true
      });
      
      // Clear the processed IDs cache
      this.processedIds = {};
      
      return {
        success: true,
        message: 'All sales contacts deleted'
      };
    } catch (error) {
      console.error('Error deleting all sales contacts:', error.message);
      throw error;
    }
  }

  async getSyncStatus() {
    // Get a summary of data from the database
    const summary = await this.getSalesSummary();
    
    const status = {
      isRunning: this.isRunning,
      lastSync: this.lastSyncDate,
      nextSync: this.nextSyncDate,
      syncStatus: this.syncStatus,
      summary,
      isAuthenticated: this.isTokenValid(),
      isRecoveryRunning: this.isRecoveryRunning
    };
    
    console.log('Getting sync status:', status.isRunning);
    return status;
  }

  // Get available cities for filtering
  getAvailableCities() {
    return CITIES;
  }

  /**
   * Recover missed days by checking the last N days
   * @returns {Promise<Object>} - Recovery result
   */
  async recoverMissedDays() {
    try {
      // Don't run recovery if it's already running
      if (this.isRecoveryRunning) {
        console.log('Recovery process already running');
        return { success: false, message: 'Recovery already running' };
      }
      
      this.isRecoveryRunning = true;
      
      // Calculate date range for recovery
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Create a plan of dates to recover for each city
      const recoveryPlan = {};
      const needsRecovery = false;
      
      // Check each city
      for (const city of CITIES) {
        const lastSync = this.syncStatus[city].lastSync;
        
        // Skip if we already have synced today
        if (lastSync && lastSync.toDateString() === today.toDateString()) {
          console.log(`No recovery needed for ${city}, already synced today`);
          recoveryPlan[city] = [];
          continue;
        }
        
        // If we've never synced, or haven't synced in over RECOVERY_DAYS, just do today
        if (!lastSync || (today - lastSync) / (1000 * 60 * 60 * 24) > RECOVERY_DAYS) {
          recoveryPlan[city] = [new Date(today)];
          console.log(`Recovery plan for ${city}: 1 day (today only) - no previous sync data available`);
          continue;
        }
        
        // Calculate all the days we need to recover
        const startDate = new Date(lastSync);
        startDate.setDate(startDate.getDate() + 1); // Start from the day after last sync
        startDate.setHours(0, 0, 0, 0);
        
        // Skip if last sync was today
        if (startDate > today) {
          console.log(`No recovery needed for ${city}, already up to date`);
          recoveryPlan[city] = [];
          continue;
        }
        
        // Add all days from start date to yesterday
        const dates = [];
        let currentDate = new Date(startDate);
        
        while (currentDate < today) {
          dates.push(new Date(currentDate));
          currentDate.setDate(currentDate.getDate() + 1);
        }
        
        recoveryPlan[city] = dates;
        console.log(`Recovery plan for ${city}: ${dates.length} days from ${this.formatDate(startDate)} to ${this.formatDate(new Date(today.getTime() - 24 * 60 * 60 * 1000))}`);
        
        if (dates.length > 0) {
          needsRecovery = true;
        }
      }
      
      // If no recovery needed, return early
      if (!needsRecovery) {
        console.log('No recovery needed for any cities');
        this.isRecoveryRunning = false;
        return { success: true, message: 'No recovery needed' };
      }
      
      // Process each city
      const recoveryResults = {};
      
      for (const city of CITIES) {
        const dates = recoveryPlan[city];
        recoveryResults[city] = { processed: 0, created: 0 };
        
        // Skip if no dates to process
        if (!dates || dates.length === 0) {
          continue;
        }
        
        console.log(`Starting recovery for ${city} with ${dates.length} dates to process`);
        
        // Process each date
        for (const date of dates) {
          try {
            console.log(`Recovering data for ${city} on ${this.formatDate(date)}...`);
            
            // Fetch and process data for this date
            const cityData = await this.fetchSalesContacts(city, date);
            
            // Skip if no contacts
            if (!cityData || !cityData.contacts || cityData.contacts.length === 0) {
              console.log(`No contacts found for ${city} on ${this.formatDate(date)}`);
              continue;
            }
            
            const result = await this.processSalesContacts(cityData);
            
            recoveryResults[city].processed += result.total;
            recoveryResults[city].created += result.created;
            
            console.log(`Recovery for ${city} on ${this.formatDate(date)}: created ${result.created} contacts`);
            
            // Small delay between requests
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            console.error(`Error recovering data for ${city} on ${this.formatDate(date)}:`, error);
            // Continue with next date despite errors
          }
        }
        
        // Update last sync date if we processed at least one date
        if (dates.length > 0) {
          this.syncStatus[city].lastSync = new Date();
        }
      }
      
      console.log('Recovery process completed successfully');
      
      this.isRecoveryRunning = false;
      return { success: true, results: recoveryResults };
    } catch (error) {
      console.error('Error in recovery process:', error);
      this.isRecoveryRunning = false;
      return { success: false, error: error.message };
    }
  }

  /**
   * Manually trigger recovery process for a specific date range
   * @param {Date} startDate - Start date for recovery
   * @param {Date} endDate - End date for recovery (defaults to yesterday)
   */
  async manualRecovery(startDate, endDate = null) {
    if (this.isRecoveryRunning) {
      return { 
        success: false, 
        message: 'Recovery process already running' 
      };
    }

    try {
      // Validate dates
      if (!startDate) {
        return { 
          success: false, 
          message: 'Start date is required' 
        };
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // If no end date specified, use yesterday
      if (!endDate) {
        endDate = new Date(today);
        endDate.setDate(endDate.getDate() - 1);
      }
      
      // Convert to Date objects if they're strings
      if (typeof startDate === 'string') startDate = new Date(startDate);
      if (typeof endDate === 'string') endDate = new Date(endDate);
      
      // Ensure dates are set to start of day for accurate comparison
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(0, 0, 0, 0);
      
      // Validate date range
      if (startDate > endDate) {
        return { 
          success: false, 
          message: 'Start date must be before end date' 
        };
      }
      
      if (endDate >= today) {
        endDate = new Date(today);
        endDate.setDate(endDate.getDate() - 1);
        endDate.setHours(0, 0, 0, 0);
      }
      
      console.log(`Starting manual recovery from ${this.formatDate(startDate)} to ${this.formatDate(endDate)}...`);
      this.isRecoveryRunning = true;
      
      // Prepare dates to check for each city
      const datesToCheck = {};
      for (const city of CITIES) {
        datesToCheck[city] = [];
        const currentDate = new Date(startDate);
        
        // Include all days from start date through end date (inclusive)
        while (currentDate <= endDate) {
          datesToCheck[city].push(new Date(currentDate));
          currentDate.setDate(currentDate.getDate() + 1);
        }
      }
      
      // Process each city and date
      const results = {
        totalProcessed: 0,
        totalCreated: 0,
        byCity: {}
      };
      
      for (const city of CITIES) {
        results.byCity[city] = {
          processed: 0,
          created: 0
        };
        
        const dates = datesToCheck[city];
        for (const date of dates) {
          // Check if we should continue
          if (!this.isRecoveryRunning) {
            console.log('Manual recovery process was stopped');
            return {
              success: false,
              message: 'Recovery process was stopped',
              results
            };
          }
          
          // Fetch and process contacts for this date
          const cityData = await this.fetchSalesContacts(city, date);
          const dateResults = await this.processSalesContacts(cityData);
          
          results.totalProcessed += dateResults.total;
          results.totalCreated += dateResults.created;
          results.byCity[city].processed += dateResults.total;
          results.byCity[city].created += dateResults.created;
          
          // Small delay to avoid API rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      console.log('Manual recovery process completed successfully');
      console.log(`Processed ${results.totalProcessed} contacts, created ${results.totalCreated} new contacts`);
      
      return {
        success: true,
        message: 'Recovery completed successfully',
        results
      };
    } catch (error) {
      console.error('Error in manual recovery process:', error.message);
      return {
        success: false,
        message: `Error during recovery: ${error.message}`
      };
    } finally {
      this.isRecoveryRunning = false;
    }
  }

  // Format phone number to E.164 format
  formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';
    
    // Convert to string if it's not already
    phoneNumber = phoneNumber.toString();
    
    // Remove all non-digit characters except the leading +
    let formatted = phoneNumber.replace(/[^\d+]/g, '');
    
    // If it doesn't start with +, add it (assuming international format)
    if (!formatted.startsWith('+')) {
      formatted = '+' + formatted;
    }
    
    return formatted;
  }

  // Add method to get sales message settings
  async getSalesMessageSettings() {
    try {
      const settings = await salesMessageController.getSettings();
      return {
        success: true,
        ...settings
      };
    } catch (error) {
      console.error('Error getting sales message settings:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Add method to update sales message settings
  async updateSalesMessageSettings(settingsData) {
    try {
      console.log('Updating sales message settings:', settingsData);
      
      // Ensure boolean values are properly converted
      if (settingsData.isAutoSchedulingEnabled !== undefined) {
        settingsData.isAutoSchedulingEnabled = Boolean(settingsData.isAutoSchedulingEnabled);
      }
      
      if (settingsData.isAutoSendingEnabled !== undefined) {
        settingsData.isAutoSendingEnabled = Boolean(settingsData.isAutoSendingEnabled);
      }
      
      console.log('Processed settings data:', settingsData);
      
      const settings = await salesMessageController.updateSettings(settingsData);
      return {
        success: true,
        settings: settings
      };
    } catch (error) {
      console.error('Error updating sales message settings:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Add method to get sales message templates
  async getSalesMessageTemplates() {
    try {
      const templates = await salesMessageController.getTemplates();
      return {
        success: true,
        templates
      };
    } catch (error) {
      console.error('Error getting sales message templates:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Add method to update sales message template
  async updateSalesMessageTemplate(type, templateData) {
    try {
      console.log(`Updating ${type} template:`, templateData);
      const result = await salesMessageController.updateTemplate(type, templateData);
      return result;
    } catch (error) {
      console.error('Error updating sales message template:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Add method to get scheduled sales messages
  async getScheduledSalesMessages(page = 1, limit = 20, status = null) {
    try {
      const result = await salesMessageController.getScheduledMessages(page, limit, status);
      return {
        success: true,
        ...result
      };
    } catch (error) {
      console.error('Error getting scheduled sales messages:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Add method to delete sales messages
  async deleteSalesMessages(ids) {
    try {
      const result = await salesMessageController.deleteMessages(ids);
      return result;
    } catch (error) {
      console.error('Error deleting sales messages:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new SalesApiController(); 