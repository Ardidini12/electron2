const axios = require('axios');
const { Op } = require('sequelize');
const { models, sequelize } = require('../database/db');
const SalesContact = models.SalesContact;

// Configuration
const AUTH_URL = 'https://crm-api.bss.com.al/authentication/login';
const SALES_API_URL = 'https://crm-api.bss.com.al/11120/Sales';
const CREDENTIALS = {
  userName: 'Admin',
  password: 'T3aWy<[3dq07'
};
const CITIES = ['tirane', 'vlore', 'fier'];
const REFRESH_INTERVAL = 2 * 60 * 1000; // 2 minutes
const RECOVERY_DAYS = 30; // Number of days to look back for recovery

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

  async fetchSalesContacts(city, date) {
    try {
      const isAuthenticated = await this.ensureAuthenticated();
      if (!isAuthenticated) {
        throw new Error('Failed to authenticate');
      }

      const formattedDate = this.formatDate(date);
      const url = `${SALES_API_URL}?Date=${formattedDate}&PageNumber=&PageSize=&HasPhone=true&CustomerGroup=PAKICE&Town=${city}`;
      
      console.log(`Fetching sales contacts for ${city} on ${formattedDate}...`);
      
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      return {
        data: response.data,
        city,
        date: date
      };
    } catch (error) {
      console.error(`Error fetching sales contacts for ${city}:`, error.message);
      return {
        data: [],
        city,
        date: date
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
        tirane: new Set(),
        vlore: new Set(),
        fier: new Set()
      };
    }
  }

  async processSalesContacts(cityData) {
    const { data: contacts, city, date } = cityData;
    const dateKey = this.getDateKey(date);
    
    // Initialize the tracking sets for this date if they don't exist
    this.initializeProcessedIdsForDate(dateKey);
    
    const results = {
      total: contacts.length,
      created: 0,
      skipped: 0,
      duplicates: 0,
      errors: 0
    };

    for (const contact of contacts) {
      try {
        // Extract relevant data
        const businessEntity = contact.businessEntity || {};
        const phoneNumber = businessEntity.phone || '';
        const contactId = contact.id;
        const documentNumber = contact.documentNumber || '';
        
        // Skip records without a valid phone number
        if (!phoneNumber || !phoneNumber.match(/^\+?[1-9]\d{1,14}$/)) {
          results.skipped++;
          continue;
        }

        // Check if this ID has already been processed for this city and date
        if (this.processedIds[dateKey][city].has(contactId)) {
          results.duplicates++;
          continue;
        }

        // Enhanced duplicate detection: check by contact ID or document number
        const existingByContactId = await SalesContact.findOne({
          where: { contactId: contactId.toString() }
        });

        // Also check for duplicates by document number if it's provided
        let existingByDocNumber = null;
        if (documentNumber) {
          existingByDocNumber = await SalesContact.findOne({
            where: { 
              documentNumber: documentNumber,
              city: city
            }
          });
        }

        // If a duplicate is found by either method, skip this contact
        if (existingByContactId || existingByDocNumber) {
          // Add to processed IDs to prevent checking again this session
          this.processedIds[dateKey][city].add(contactId);
          results.duplicates++;
          
          // Log detail about the duplicate
          const dupSource = existingByContactId ? 'contactId' : 'documentNumber';
          console.log(`Duplicate ${dupSource} found for contact ${contactId} with document number ${documentNumber}`);
          continue;
        }
        
        // Add to processed IDs
        this.processedIds[dateKey][city].add(contactId);
        
        // Prepare data for database
        const contactData = {
          contactId: contactId.toString(), // Ensure contactId is stored as string
          name: businessEntity.name || 'Unknown',
          phoneNumber: phoneNumber,
          code: businessEntity.code || '',
          city: city,
          documentNumber: documentNumber,
          documentDate: contact.documentDate ? new Date(contact.documentDate) : null,
          shopId: businessEntity.shopId ? businessEntity.shopId.toString() : '',
          sourceData: JSON.stringify(contact)
        };

        // Create a new record
        await SalesContact.create(contactData);
        results.created++;
      } catch (error) {
        console.error('Error processing sales contact:', error.message);
        results.errors++;
      }
    }

    // Update sync status for this city
    this.syncStatus[city].lastSync = new Date();
    this.syncStatus[city].count += results.created;

    console.log(`Processed ${results.total} contacts for ${city}: ${results.created} created, ${results.duplicates} duplicates, ${results.skipped} skipped, ${results.errors} errors`);
    return results;
  }

  async startSyncProcess() {
    if (this.isRunning) {
      console.log('Sync process already running');
      return;
    }

    console.log('Starting sync process...');
    this.isRunning = true;
    try {
      // Get today's date
      const today = new Date();
      const dateKey = this.getDateKey(today);
      
      // Initialize the tracking sets for today if they don't exist
      this.initializeProcessedIdsForDate(dateKey);
      
      // Clean up old date keys (keep only the last 7 days)
      this.cleanupOldDateKeys();
      
      // Fetch for all cities in parallel
      const cityPromises = CITIES.map(city => this.fetchSalesContacts(city, today));
      const cityResults = await Promise.all(cityPromises);
      
      // Process results
      for (const cityData of cityResults) {
        await this.processSalesContacts(cityData);
      }
      
      this.lastSyncDate = new Date();
      this.nextSyncDate = new Date(Date.now() + REFRESH_INTERVAL);
      
      console.log('Sync process completed successfully');
    } catch (error) {
      console.error('Error in sync process:', error.message);
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
    console.log(`Periodic sync started with interval of ${REFRESH_INTERVAL / 1000} seconds`);
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
   * Recover sales contacts for missed days
   * This function will fetch data for a specified number of past days
   * to ensure we don't miss any sales contacts when the app wasn't running
   */
  async recoverMissedDays() {
    if (this.isRecoveryRunning) {
      console.log('Recovery process already running');
      return;
    }

    console.log(`Starting recovery process for the last ${RECOVERY_DAYS} days...`);
    this.isRecoveryRunning = true;

    try {
      // Get the date range to recover
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Get the most recent dates for each city where we have data
      const mostRecentDates = {};
      for (const city of CITIES) {
        const mostRecent = await SalesContact.findOne({
          where: { city },
          order: [['documentDate', 'DESC']],
          attributes: ['documentDate'],
          raw: true
        });
        
        if (mostRecent && mostRecent.documentDate) {
          // Start from the most recent date (inclusive)
          // Note: We're not adding +1 day to include the date itself
          const lastDate = new Date(mostRecent.documentDate);
          mostRecentDates[city] = lastDate;
        } else {
          // If no data, go back the full recovery period
          const startDate = new Date(today);
          startDate.setDate(startDate.getDate() - RECOVERY_DAYS);
          mostRecentDates[city] = startDate;
        }
      }
      
      // Get a list of dates to check for each city
      const datesToCheck = {};
      for (const city of CITIES) {
        datesToCheck[city] = [];
        const startDate = mostRecentDates[city];
        
        // Add all dates from start date (inclusive) until yesterday (inclusive)
        const currentDate = new Date(startDate);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        // Set time to beginning of the day for accurate comparison
        currentDate.setHours(0, 0, 0, 0);
        
        // Include all days from start date through yesterday
        while (currentDate <= yesterday) {
          datesToCheck[city].push(new Date(currentDate));
          currentDate.setDate(currentDate.getDate() + 1);
        }
      }
      
      // Log the recovery plan
      for (const city of CITIES) {
        const dateCount = datesToCheck[city].length;
        if (dateCount > 0) {
          const startDate = datesToCheck[city][0];
          const endDate = datesToCheck[city][dateCount - 1];
          console.log(`Recovery plan for ${city}: ${dateCount} days from ${this.formatDate(startDate)} to ${this.formatDate(endDate)}`);
        } else {
          console.log(`No recovery needed for ${city}, already up to date`);
        }
      }
      
      // Process each city and date, going from oldest to newest
      for (const city of CITIES) {
        const dates = datesToCheck[city];
        if (dates.length === 0) continue;
        
        console.log(`Starting recovery for ${city} with ${dates.length} dates to process`);
        
        // Process from oldest to newest
        for (const date of dates) {
          // Check if we should continue (in case app is shutting down)
          if (!this.isRecoveryRunning) {
            console.log('Recovery process was stopped');
            return;
          }
          
          console.log(`Recovering data for ${city} on ${this.formatDate(date)}...`);
          
          // Fetch and process contacts for this date
          const cityData = await this.fetchSalesContacts(city, date);
          const results = await this.processSalesContacts(cityData);
          
          console.log(`Recovery for ${city} on ${this.formatDate(date)}: created ${results.created} contacts`);
          
          // Small delay to avoid API rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      console.log('Recovery process completed successfully');
    } catch (error) {
      console.error('Error in recovery process:', error.message);
    } finally {
      this.isRecoveryRunning = false;
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
}

module.exports = new SalesApiController(); 