const { sequelize, models, isDatabaseInitialized } = require('../database/db');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const csvParser = require('csv-parser');
const { app } = require('electron');

const Contact = models.Contact;

/**
 * ContactController handles all contact-related operations
 */
class ContactController {
  /**
   * Check if database is initialized
   * @private
   * @throws {Error} - If database is not initialized
   */
  _checkDatabaseInitialized() {
    if (!isDatabaseInitialized()) {
      throw new Error('Database not initialized');
    }
  }

  /**
   * Get paginated contacts with search capabilities
   * @param {number} page - Page number (1-based)
   * @param {number} limit - Number of contacts per page
   * @param {string} search - Search query (optional)
   * @returns {Promise<Object>} - Paginated contacts with metadata
   */
  async getContactsPaginated(page = 1, limit = 50, search = '') {
    try {
      this._checkDatabaseInitialized();
      
      console.log(`Getting paginated contacts: page ${page}, limit ${limit}, search: "${search}"`);
      
      // Build the query conditions
      const whereConditions = {};
      
      // Apply search filter if provided
      if (search && search.trim()) {
        const searchTerm = `%${search.trim()}%`;
        whereConditions[Op.or] = [
          { name: { [Op.like]: searchTerm } },
          { surname: { [Op.like]: searchTerm } },
          { phoneNumber: { [Op.like]: searchTerm } },
          { email: { [Op.like]: searchTerm } },
          { source: { [Op.like]: searchTerm } },
          { notes: { [Op.like]: searchTerm } }
        ];
      }

      // Calculate offset
      const offset = (page - 1) * limit;

      // Get total count with optimized counting query
      const countResult = await Contact.count({
        where: whereConditions
      });
      
      // Get paginated data
      const contacts = await Contact.findAll({
        where: whereConditions,
        order: [['updatedAt', 'DESC']],
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
      
      // Convert to plain objects
      const plainContacts = contacts.map(contact => contact.toJSON());
      
      // Calculate total pages
      const totalPages = Math.ceil(countResult / limit);
      
      return {
        contacts: plainContacts,
        pagination: {
          total: countResult,
          totalPages,
          currentPage: page,
          limit,
          hasNext: page < totalPages,
          hasPrevious: page > 1
        }
      };
    } catch (error) {
      console.error('Error fetching paginated contacts:', error);
      throw error;
    }
  }

  /**
   * Get all contacts or contacts filtered by source
   * This method is optimized for cases where you need all contacts,
   * but consider using getContactsPaginated for large datasets
   * @param {string} source - Optional source filter
   * @returns {Promise<Array>} - Array of contacts
   */
  async getAllContacts(source = null) {
    try {
      this._checkDatabaseInitialized();
      
      console.log(`Getting all contacts${source ? ` with source: ${source}` : ''}`);
      
      // Build the query
      const query = {};
      
      // Add source filter if provided
      if (source) {
        query.where = { source };
      }
      
      // Add order by clause to sort contacts
      query.order = [['updatedAt', 'DESC']];
      
      // Optimize for performance - only select necessary fields
      query.attributes = ['id', 'name', 'surname', 'phoneNumber', 'email', 'source', 'createdAt', 'updatedAt'];
      
      // Find all contacts
      const contacts = await Contact.findAll(query);
      
      console.log(`Found ${contacts.length} contacts in database`);
      
      // Return the contacts as plain objects 
      return contacts.map(contact => contact.toJSON());
    } catch (error) {
      console.error('Error fetching contacts:', error);
      throw error;
    }
  }

  /**
   * Get the total count of contacts
   * @returns {Promise<Object>} - Object containing the count
   */
  async getContactsCount() {
    try {
      this._checkDatabaseInitialized();
      
      const count = await Contact.count();
      return { count };
    } catch (error) {
      console.error('Error getting contacts count:', error);
      throw error;
    }
  }

  /**
   * Export contacts to a JSON file
   * @returns {Promise<Object>} - Object with success status and file path
   */
  async exportContactsAsJson() {
    try {
      this._checkDatabaseInitialized();
      
      // Get all contacts
      const contacts = await this.getAllContacts();
      
      // Create the exports directory in the desktop db folder
      const desktopPath = app.getPath('desktop');
      const exportsDir = path.join(desktopPath, 'db', 'exports');
      if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
      }
      
      // Generate a filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(exportsDir, `contacts_${timestamp}.json`);
      
      // Write contacts to the file
      fs.writeFileSync(filePath, JSON.stringify(contacts, null, 2), 'utf8');
      
      console.log(`Exported ${contacts.length} contacts to JSON file: ${filePath}`);
      
      return {
        success: true,
        filePath,
        count: contacts.length
      };
    } catch (error) {
      console.error('Error exporting contacts as JSON:', error);
      throw error;
    }
  }

  /**
   * Export contacts to a CSV file
   * @returns {Promise<Object>} - Object with success status and file path
   */
  async exportContactsAsCsv() {
    try {
      this._checkDatabaseInitialized();
      
      // Get all contacts
      const contacts = await this.getAllContacts();
      
      // Create the exports directory in the desktop db folder
      const desktopPath = app.getPath('desktop');
      const exportsDir = path.join(desktopPath, 'db', 'exports');
      if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
      }
      
      // Generate a filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(exportsDir, `contacts_${timestamp}.csv`);
      
      // Convert contacts to CSV
      const worksheet = xlsx.utils.json_to_sheet(contacts);
      const csvContent = xlsx.utils.sheet_to_csv(worksheet);
      
      // Write CSV content to file
      fs.writeFileSync(filePath, csvContent, 'utf8');
      
      console.log(`Exported ${contacts.length} contacts to CSV file: ${filePath}`);
      
      return {
        success: true,
        filePath,
        count: contacts.length
      };
    } catch (error) {
      console.error('Error exporting contacts as CSV:', error);
      throw error;
    }
  }

  /**
   * Export contacts to an Excel file
   * @returns {Promise<Object>} - Object with success status and file path
   */
  async exportContactsAsExcel() {
    try {
      this._checkDatabaseInitialized();
      
      // Get all contacts
      const contacts = await this.getAllContacts();
      
      // Create the exports directory in the desktop db folder
      const desktopPath = app.getPath('desktop');
      const exportsDir = path.join(desktopPath, 'db', 'exports');
      if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
      }
      
      // Generate a filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(exportsDir, `contacts_${timestamp}.xlsx`);
      
      // Create a workbook and add a worksheet
      const workbook = xlsx.utils.book_new();
      const worksheet = xlsx.utils.json_to_sheet(contacts);
      
      // Add the worksheet to the workbook
      xlsx.utils.book_append_sheet(workbook, worksheet, 'Contacts');
      
      // Write the workbook to a file
      xlsx.writeFile(workbook, filePath);
      
      console.log(`Exported ${contacts.length} contacts to Excel file: ${filePath}`);
      
      return {
        success: true,
        filePath,
        count: contacts.length
      };
    } catch (error) {
      console.error('Error exporting contacts as Excel:', error);
      throw error;
    }
  }

  /**
   * Delete all contacts from the database
   * @returns {Promise<Object>} - Object with success status and count of deleted contacts
   */
  async deleteAllContacts() {
    try {
      this._checkDatabaseInitialized();
      
      // Get the count before deletion
      const count = await Contact.count();
      
      // Delete all contacts
      await Contact.destroy({ where: {} });
      
      console.log(`Deleted all ${count} contacts from the database`);
      
      return {
        success: true,
        count
      };
    } catch (error) {
      console.error('Error deleting all contacts:', error);
      throw error;
    }
  }

  /**
   * Delete multiple contacts by ID
   * @param {Array<number>} ids - Array of contact IDs to delete
   * @returns {Promise<Object>} - Object with success status and count of deleted contacts
   */
  async deleteContacts(ids) {
    try {
      this._checkDatabaseInitialized();
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return {
          success: false,
          error: 'No valid contact IDs provided',
          count: 0
        };
      }
      
      // Delete contacts with the specified IDs
      const result = await Contact.destroy({
        where: {
          id: {
            [Op.in]: ids
          }
        }
      });
      
      console.log(`Deleted ${result} contacts with IDs: ${ids.join(', ')}`);
      
      return {
        success: true,
        count: result
      };
    } catch (error) {
      console.error('Error deleting contacts by ID:', error);
      throw error;
    }
  }

  /**
   * Get a contact by ID
   * @param {number} id - Contact ID
   * @returns {Promise<Object>} - Contact object
   */
  async getContactById(id) {
    try {
      this._checkDatabaseInitialized();
      
      const contact = await Contact.findByPk(id);
      // Return null if contact not found
      if (!contact) return null;
      
      // Convert to plain object to avoid Sequelize model issues
      return contact.toJSON();
    } catch (error) {
      console.error(`Error fetching contact with ID ${id}:`, error);
      throw error;
    }
  }

  /**
   * Get a contact by phone number
   * @param {string} phoneNumber - Phone number to search for
   * @returns {Promise<Object|null>} - Contact object or null if not found
   */
  async getContactByPhone(phoneNumber) {
    try {
      this._checkDatabaseInitialized();
      
      if (!phoneNumber) return null;
      
      // Format the phone number for consistency
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      // Find the contact with the given phone number
      const contact = await Contact.findOne({
        where: { phoneNumber: formattedPhone }
      });
      
      return contact;
    } catch (error) {
      console.error(`Error fetching contact with phone number ${phoneNumber}:`, error);
      throw error;
    }
  }

  /**
   * Create a new contact
   * @param {Object} contactData - The contact data
   * @returns {Promise<Object>} - The created contact
   */
  async createContact(contactData) {
    try {
      this._checkDatabaseInitialized();
      
      // Validate required phone number
      if (!contactData.phoneNumber) {
        return {
          success: false,
          code: 'MISSING_PHONE',
          error: 'Phone number is required'
        };
      }
      
      // Format phone number
      contactData.phoneNumber = this.formatPhoneNumber(contactData.phoneNumber);
      
      // Handle null or empty email to prevent validation errors
      if (!contactData.email || contactData.email.trim() === '') {
        contactData.email = null;
      }
      
      // Check for existing phone number
      const existingContact = await Contact.findOne({
        where: {
          phoneNumber: contactData.phoneNumber
        }
      });
      
      if (existingContact) {
        return {
          success: false,
          code: 'DUPLICATE_PHONE',
          error: 'This phone number already exists',
          contact: existingContact
        };
      }
      
      // Create contact
      const contact = await Contact.create(contactData);
      
      return {
        success: true,
        contact
      };
    } catch (error) {
      console.error('Error creating contact:', error);
      
      return {
        success: false,
        code: 'CREATION_ERROR',
        error: error.message
      };
    }
  }

  /**
   * Update an existing contact
   * @param {number} id - Contact ID
   * @param {Object} contactData - Updated contact data
   * @returns {Promise<Object>} - Updated contact
   */
  async updateContact(id, contactData) {
    try {
      this._checkDatabaseInitialized();
      
      // Validate input ID
      if (!id) {
        throw new Error(`Invalid contact ID: ${id}`);
      }
      
      // Convert string ID to number if needed
      const contactId = typeof id === 'string' ? parseInt(id, 10) : id;
      
      // Check if ID is a valid number after conversion
      if (isNaN(contactId)) {
        throw new Error(`Invalid contact ID: ${id}`);
      }
      
      console.log(`Updating contact with ID: ${contactId}`);
      
      const contact = await Contact.findByPk(contactId);
      
      if (!contact) {
        throw new Error(`Contact with ID ${contactId} not found`);
      }
      
      // Validate required fields
      if (!contactData.phoneNumber) {
        throw new Error('Phone number is required');
      }
      
      // Format phone number if it's being updated
      if (contactData.phoneNumber) {
        contactData.phoneNumber = this.formatPhoneNumber(contactData.phoneNumber);
      }
      
      // If phone number is changed, check if it already exists
      if (contactData.phoneNumber !== contact.phoneNumber) {
        const existingContact = await Contact.findOne({
          where: {
            phoneNumber: contactData.phoneNumber,
            id: { [Op.ne]: contactId } // Not equal to current contact ID
          }
        });
        
        if (existingContact) {
          throw new Error('A contact with this phone number already exists');
        }
      }
      
      // Handle empty email (convert empty string to null)
      if (contactData.email === '') {
        contactData.email = null;
      }
      
      // Update the contact and return the updated model
      await contact.update(contactData);
      console.log('Contact updated:', contact.toJSON());
      return contact;
    } catch (error) {
      console.error(`Error updating contact with ID ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete a contact
   * @param {number} id - Contact ID
   * @returns {Promise<boolean>} - True if deleted successfully
   */
  async deleteContact(id) {
    try {
      this._checkDatabaseInitialized();
      
      // Validate input ID
      if (!id) {
        throw new Error(`Invalid contact ID: ${id}`);
      }
      
      // Convert string ID to number if needed
      const contactId = typeof id === 'string' ? parseInt(id, 10) : id;
      
      // Check if ID is a valid number after conversion
      if (isNaN(contactId)) {
        throw new Error(`Invalid contact ID: ${id}`);
      }
      
      console.log(`Attempting to delete contact with ID: ${contactId}`);
      
      const contact = await Contact.findByPk(contactId);
      
      if (!contact) {
        throw new Error(`Contact with ID ${contactId} not found`);
      }
      
      await contact.destroy();
      return true;
    } catch (error) {
      console.error(`Error deleting contact with ID ${id}:`, error);
      throw error;
    }
  }

  /**
   * Import contacts from a file with optimized batch processing
   * @param {string} filePath - Path to the file
   * @param {string} fileType - Type of file (csv, xlsx, json)
   * @param {Function} progressCallback - Callback function for progress updates
   * @returns {Promise<Object>} - Import result with counts
   */
  async importContacts(filePath, fileType, progressCallback = null) {
    try {
      this._checkDatabaseInitialized();
      
      let contacts = [];
      const sourceName = path.basename(filePath);
      
      // Read contacts from file based on file type
      switch (fileType.toLowerCase()) {
        case 'csv':
          contacts = await this.readCsvFile(filePath);
          break;
        case 'xlsx':
        case 'xls':
          contacts = await this.readExcelFile(filePath);
          break;
        case 'json':
          contacts = await this.readJsonFile(filePath);
          break;
        default:
          throw new Error(`Unsupported file type: ${fileType}`);
      }
      
      // Use the optimized bulk import method
      return this.bulkImportContacts(contacts, sourceName, progressCallback);
    } catch (error) {
      console.error(`Error importing contacts from ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Import contacts in bulk with optimized batch processing
   * @param {Array<Object>} contacts - Array of contact objects
   * @param {string} sourceName - Source name to assign to contacts
   * @param {Function} progressCallback - Callback function for progress updates
   * @returns {Promise<Object>} - Import result with counts
   */
  async bulkImportContacts(contacts, sourceName, progressCallback = null) {
    try {
      this._checkDatabaseInitialized();
      
      console.log(`Starting bulk import of ${contacts.length} contacts from ${sourceName}`);
      
      // Prepare result counters
      const result = {
        total: contacts.length,
        imported: 0,
        duplicates: 0,
        errors: 0
      };
      
      // Set up progress reporting
      const reportProgress = (current) => {
        if (progressCallback) {
          progressCallback({
            current,
            total: contacts.length,
            ...result
          });
        }
      };
      
      // Initial progress report
      reportProgress(0);
      
      // Get all existing phone numbers for fast duplicate checking
      console.log('Building phone number lookup map...');
      const existingPhoneNumbers = new Set();
      
      // Use raw query for better performance with large datasets
      // Note: Sequelize pluralizes and lowercases table names by default, so we use the correct format
      const existingPhones = await sequelize.query(
        'SELECT phoneNumber FROM "Contacts"',
        { type: sequelize.QueryTypes.SELECT }
      );
      
      existingPhones.forEach(row => {
        if (row.phoneNumber) {
          existingPhoneNumbers.add(row.phoneNumber);
        }
      });
      
      console.log(`Found ${existingPhoneNumbers.size} existing phone numbers`);
      
      // Process contacts in batches for better performance
      const BATCH_SIZE = 1000;
      
      // Prepare contacts for insertion
      const validContacts = [];
      
      // Pre-process all contacts first for performance
      for (let i = 0; i < contacts.length; i++) {
        try {
          const contact = contacts[i];
          
          // Skip contacts without phone number
          if (!contact.phoneNumber) {
            result.errors++;
            continue;
          }
          
          // Format phone number
          contact.phoneNumber = this.formatPhoneNumber(contact.phoneNumber);
          
          // Skip duplicates
          if (existingPhoneNumbers.has(contact.phoneNumber)) {
            result.duplicates++;
            continue;
          }
          
          // Add to existing phone numbers to prevent duplicates within the batch
          existingPhoneNumbers.add(contact.phoneNumber);
          
          // Set source
          contact.source = sourceName;
          
          // Clean up email
          if (contact.email) {
            const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
            if (!emailPattern.test(contact.email)) {
              contact.email = null;
            }
          }
          
          // Add to valid contacts
          validContacts.push(contact);
          
          // Report progress periodically
          if ((i + 1) % 5000 === 0 || i === contacts.length - 1) {
            reportProgress(i + 1);
          }
        } catch (error) {
          console.error(`Error processing contact at index ${i}:`, error);
          result.errors++;
        }
      }
      
      // Import valid contacts in batches
      console.log(`Importing ${validContacts.length} valid contacts in batches of ${BATCH_SIZE}`);
      
      for (let i = 0; i < validContacts.length; i += BATCH_SIZE) {
        const batch = validContacts.slice(i, Math.min(i + BATCH_SIZE, validContacts.length));
        
        try {
          // Use bulkCreate for performance
          await Contact.bulkCreate(batch, { 
            ignoreDuplicates: true 
          });
          
          result.imported += batch.length;
          
          // Report progress after each batch
          reportProgress(Math.min(i + BATCH_SIZE, contacts.length));
        } catch (error) {
          console.error(`Error importing batch ${i / BATCH_SIZE + 1}:`, error);
          result.errors += batch.length;
          result.imported -= batch.length;
        }
        
        // Pause briefly between batches to prevent database overload
        if (i + BATCH_SIZE < validContacts.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      // Final progress report
      reportProgress(contacts.length);
      
      return result;
    } catch (error) {
      console.error('Error in bulk import:', error);
      throw error;
    }
  }

  /**
   * Read contacts from a CSV file
   * @param {string} filePath - Path to the CSV file
   * @returns {Promise<Array>} - Array of contacts
   */
  async readCsvFile(filePath) {
    return new Promise((resolve, reject) => {
      try {
        // First check if file exists and is accessible
        if (!fs.existsSync(filePath)) {
          return reject(new Error(`File not found: ${filePath}`));
        }
        
        // Check file access permissions
        try {
          fs.accessSync(filePath, fs.constants.R_OK);
        } catch (err) {
          return reject(new Error(`Cannot read file (permission denied): ${filePath}`));
        }
        
        const contacts = [];
        let rowCount = 0;
        
        // Create read stream with error handling
        const stream = fs.createReadStream(filePath);
        
        stream.on('error', (error) => {
          reject(new Error(`Error reading CSV file: ${error.message}`));
        });
        
        stream
          .pipe(csvParser())
          .on('data', (data) => {
            rowCount++;
            contacts.push(this.mapContactFields(data));
          })
          .on('end', () => {
            console.log(`Successfully extracted ${rowCount} rows from CSV file`);
            
            if (contacts.length === 0) {
              reject(new Error('No data could be extracted from the CSV file'));
            } else {
              resolve(contacts);
            }
          })
          .on('error', (error) => {
            reject(new Error(`Error parsing CSV: ${error.message}`));
          });
      } catch (error) {
        console.error('Error setting up CSV parsing:', error);
        reject(error);
      }
    });
  }

  /**
   * Read contacts from an Excel file
   * @param {string} filePath - Path to the Excel file
   * @returns {Promise<Array>} - Array of contacts
   */
  async readExcelFile(filePath) {
    try {
      // First check if file exists and is accessible
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      
      // Check file access permissions
      try {
        fs.accessSync(filePath, fs.constants.R_OK);
      } catch (err) {
        throw new Error(`Cannot read file (permission denied): ${filePath}`);
      }
      
      // Attempt to read the file
      let workbook;
      try {
        workbook = xlsx.readFile(filePath, { type: 'file', cellDates: true });
      } catch (err) {
        console.error('XLSX read error:', err);
        throw new Error(`Failed to read Excel file: ${err.message}`);
      }
      
      // Check if workbook has sheets
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('Excel file contains no sheets');
      }
      
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      
      // Check if sheet contains data
      if (!sheet || Object.keys(sheet).length <= 1) { // Sheet with only dimensions
        throw new Error('Excel sheet is empty');
      }
      
      // Convert to JSON
      let data;
      try {
        data = xlsx.utils.sheet_to_json(sheet);
      } catch (err) {
        throw new Error(`Failed to convert Excel to JSON: ${err.message}`);
      }
      
      // Check if data was extracted
      if (!data || !Array.isArray(data) || data.length === 0) {
        throw new Error('No data could be extracted from the Excel file');
      }
      
      console.log(`Successfully extracted ${data.length} rows from Excel file`);
      
      // Map the data to contacts format
      return data.map(row => this.mapContactFields(row));
    } catch (error) {
      console.error('Error reading Excel file:', error);
      throw error;
    }
  }

  /**
   * Read contacts from a JSON file
   * @param {string} filePath - Path to the JSON file
   * @returns {Promise<Array>} - Array of contacts
   */
  async readJsonFile(filePath) {
    try {
      // First check if file exists and is accessible
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      
      // Check file access permissions
      try {
        fs.accessSync(filePath, fs.constants.R_OK);
      } catch (err) {
        throw new Error(`Cannot read file (permission denied): ${filePath}`);
      }
      
      // Read file contents
      let fileContents;
      try {
        fileContents = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        throw new Error(`Error reading JSON file: ${err.message}`);
      }
      
      // Check if file is empty
      if (!fileContents || fileContents.trim() === '') {
        throw new Error('JSON file is empty');
      }
      
      // Parse JSON
      let data;
      try {
        data = JSON.parse(fileContents);
      } catch (err) {
        throw new Error(`Invalid JSON format: ${err.message}`);
      }
      
      // Verify data is an array
      if (!Array.isArray(data)) {
        throw new Error('JSON file must contain an array of contacts');
      }
      
      // Check if array is empty
      if (data.length === 0) {
        throw new Error('JSON file contains an empty array');
      }
      
      console.log(`Successfully extracted ${data.length} items from JSON file`);
      
      // Map the data to contacts format
      return data.map(item => this.mapContactFields(item));
    } catch (error) {
      console.error('Error reading JSON file:', error);
      throw error;
    }
  }

  /**
   * Map fields from imported data to contact model fields
   * @param {Object} data - Raw data from import
   * @returns {Object} - Mapped contact data
   */
  mapContactFields(data) {
    // Map common field variations to our model fields
    const nameFields = ['name', 'firstName', 'first_name', 'firstname'];
    const surnameFields = ['surname', 'lastName', 'last_name', 'lastname'];
    const phoneFields = ['phoneNumber', 'phone', 'phone_number', 'mobile', 'cell'];
    const emailFields = ['email', 'emailAddress', 'email_address'];
    const birthdayFields = ['birthday', 'birthdate', 'birth_date', 'dob'];
    
    const contact = {};
    
    // Find and map name
    for (const field of nameFields) {
      if (data[field]) {
        contact.name = data[field];
        break;
      }
    }
    
    // Find and map surname
    for (const field of surnameFields) {
      if (data[field]) {
        contact.surname = data[field];
        break;
      }
    }
    
    // Find and map phone number (required)
    for (const field of phoneFields) {
      if (data[field]) {
        contact.phoneNumber = data[field];
        break;
      }
    }
    
    // Find and map email
    for (const field of emailFields) {
      if (data[field]) {
        // Validate email format
        const emailValue = data[field];
        if (emailValue && typeof emailValue === 'string') {
          // Check if it's a valid email format
          const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
          if (emailPattern.test(emailValue.trim())) {
            contact.email = emailValue.trim();
          } else {
            // Invalid email format, set to null
            contact.email = null;
          }
        } else {
          contact.email = null;
        }
        break;
      }
    }
    
    // Find and map birthday
    for (const field of birthdayFields) {
      if (data[field]) {
        contact.birthday = data[field];
        break;
      }
    }
    
    return contact;
  }

  /**
   * Format phone number to ensure it has the correct international format
   * Optimized for performance with large datasets
   * @param {string} phoneNumber - Phone number to format
   * @returns {string} - Formatted phone number
   */
  formatPhoneNumber(phoneNumber) {
    // Fast path: handle undefined or null
    if (!phoneNumber) {
      return '';
    }
    
    // Fast path: ensure string type
    const phoneStr = String(phoneNumber);
    
    // Fast path: already properly formatted
    if (phoneStr.startsWith('+')) {
      return phoneStr.replace(/[^\d+]/g, '');
    }
    
    // Fast path: simple conversion to E.164 format
    return '+' + phoneStr.replace(/\D/g, '');
  }

  /**
   * Bulk delete contacts
   * @param {Array<number>} ids - Array of contact IDs to delete
   * @param {Function} progressCallback - Optional callback for progress updates
   * @returns {Promise<Object>} - Result with counts
   */
  async bulkDeleteContacts(ids, progressCallback = null) {
    try {
      this._checkDatabaseInitialized();
      
      console.log(`Starting bulk delete of ${ids.length} contacts`);
      
      // Prepare result
      const result = {
        total: ids.length,
        deleted: 0,
        errors: 0
      };
      
      // Use Sequelize's optimized bulk delete
      // This is much faster than deleting one by one
      const deleted = await Contact.destroy({
        where: {
          id: {
            [Op.in]: ids
          }
        }
      });
      
      result.deleted = deleted;
      result.errors = ids.length - deleted;
      
      // Final progress update
      if (progressCallback) {
        progressCallback(result);
      }
      
      return result;
    } catch (error) {
      console.error('Error during bulk delete:', error);
      throw error;
    }
  }
}

module.exports = new ContactController(); 