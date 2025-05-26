// contacts.js - Contact management functionality

import { showNotification } from '../ui/notifications.js';
import { formatPhoneNumber, createCellContentHTML } from '../utils/helpers.js';
import { api, waitForAPI } from '../utils/api.js';

// Module state
let contacts = [];
let currentPage = 1;
const pageSize = 100; // Increased for better performance
let totalPages = 1;
let totalContacts = 0;
let isLoading = false;
let currentSearchQuery = '';
let selectedContactIds = new Set();
let allContactsSelected = false;

/**
 * Simple utility to get the base name from a file path (cross-platform)
 * @param {string} filePath - The full file path
 * @returns {string} - The base file name
 */
function getBaseName(filePath) {
  if (!filePath) return '';
  // Handle both Windows and Unix-style paths
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1];
}

/**
 * Initialize the contacts section
 */
async function initContacts() {
  console.log('Initializing contacts section...');
  
  try {
    // Wait for API to be available
    await waitForAPI();
    
    // Set up event listeners
    setupContactsEventListeners();
    
    // Check if contacts table exists
    const contactsTable = document.getElementById('contacts-table');
    if (!contactsTable) {
      console.error('Contacts table not found in the DOM');
      // Try to rebuild the table
      rebuildContactsTable();
    } else {
      console.log('Contacts table found in the DOM');
      
      // Check if the tbody exists
      const tableBody = contactsTable.querySelector('tbody');
      if (!tableBody) {
        console.error('Contacts table body not found in the DOM');
        // Try to rebuild the table
        rebuildContactsTable();
      } else {
        console.log('Contacts table body found in the DOM');
        // Load contacts directly
        console.log('Loading contacts during initialization...');
        loadContactsPaginated();
      }
    }
  } catch (error) {
    console.error('Error initializing contacts:', error);
    showNotification('Error', 'Failed to initialize contacts: ' + error.message, 'error');
  }
}

/**
 * Set up event listeners for contacts section
 */
function setupContactsEventListeners() {
  // Add contact button
  const addContactButton = document.getElementById('add-contact');
  if (addContactButton) {
    // Remove existing event listeners to prevent duplicates
    const newAddButton = addContactButton.cloneNode(true);
    addContactButton.parentNode.replaceChild(newAddButton, addContactButton);
    newAddButton.addEventListener('click', () => openContactModal());
  }
  
  // Import contacts button
  const importContactsButton = document.getElementById('import-contacts');
  if (importContactsButton) {
    // Remove existing event listeners to prevent duplicates
    const newImportButton = importContactsButton.cloneNode(true);
    importContactsButton.parentNode.replaceChild(newImportButton, importContactsButton);
    newImportButton.addEventListener('click', openImportModal);
  }
  
  // Delete selected contacts button
  const deleteSelectedButton = document.getElementById('delete-selected-contacts');
  if (deleteSelectedButton) {
    // Remove existing event listeners to prevent duplicates
    const newDeleteButton = deleteSelectedButton.cloneNode(true);
    deleteSelectedButton.parentNode.replaceChild(newDeleteButton, deleteSelectedButton);
    newDeleteButton.addEventListener('click', deleteSelectedContacts);
  }
  
  // Search contacts input
  const searchInput = document.getElementById('contact-search');
  if (searchInput) {
    // Remove existing event listeners to prevent duplicates
    const newSearchInput = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(newSearchInput, searchInput);
    
    // Debounce search to prevent too many requests
    let searchTimeout;
    newSearchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        currentSearchQuery = e.target.value;
        currentPage = 1; // Reset to first page on search
        loadContactsPaginated();
      }, 300);
    });
  }
  
  // Set up select all checkbox
  const selectAllCheckbox = document.getElementById('select-all-contacts');
  if (selectAllCheckbox) {
    // Remove existing event listeners to prevent duplicates
    const newSelectAllCheckbox = selectAllCheckbox.cloneNode(true);
    selectAllCheckbox.parentNode.replaceChild(newSelectAllCheckbox, selectAllCheckbox);
    
    newSelectAllCheckbox.addEventListener('change', () => {
      if (newSelectAllCheckbox.checked) {
        allContactsSelected = true;
        document.querySelectorAll('.contact-checkbox').forEach(checkbox => {
          checkbox.checked = true;
          selectedContactIds.add(checkbox.getAttribute('data-id'));
        });
      } else {
        allContactsSelected = false;
        selectedContactIds.clear();
        document.querySelectorAll('.contact-checkbox').forEach(checkbox => {
          checkbox.checked = false;
        });
      }
      updateDeleteSelectedButton();
    });
  }
}

/**
 * Load contacts from the database with pagination and search
 */
async function loadContactsPaginated() {
  try {
    isLoading = true;
    
    // Wait for API to be available
    await waitForAPI();
    
    // Show loading state
    const tableBody = document.querySelector('#contacts-table tbody');
    if (tableBody) {
      tableBody.innerHTML = '<tr><td colspan="7" class="text-center">Loading contacts...</td></tr>';
    }
    
    // Get paginated contacts from the API
    const response = await api.getContactsPaginated(currentPage, pageSize, currentSearchQuery);
    
    // Update state
    contacts = response.contacts;
    totalPages = response.pagination.totalPages;
    totalContacts = response.pagination.total;
    
    // If current page is greater than total pages and total pages > 0, go to last page
    if (currentPage > totalPages && totalPages > 0) {
      currentPage = totalPages;
      // Reload with corrected page number
      return loadContactsPaginated();
    }
    
    console.log(`Loaded ${contacts.length} contacts (page ${currentPage}/${totalPages}, total: ${totalContacts})`);
    
    // Display contacts
    displayPaginatedContacts(contacts, response.pagination);
    
    // Update the "Delete Selected" button state
    updateDeleteSelectedButton();
    
    // Reset select all checkbox state if needed
    const selectAllCheckbox = document.getElementById('select-all-contacts');
    if (selectAllCheckbox && !allContactsSelected) {
      selectAllCheckbox.checked = false;
    }
    
    isLoading = false;
  } catch (error) {
    console.error('Error loading contacts:', error);
    showNotification('Error', 'Failed to load contacts: ' + error.message, 'error');
    isLoading = false;
  }
}

/**
 * Display paginated contacts in the table
 * @param {Array} contactsToDisplay - The contacts to display
 * @param {Object} pagination - Pagination information
 */
function displayPaginatedContacts(contactsToDisplay, pagination) {
  console.log(`Displaying ${contactsToDisplay.length} contacts in table (Page ${pagination.currentPage}/${pagination.totalPages})`);
  
  const tableBody = document.querySelector('#contacts-table tbody');
  if (!tableBody) {
    console.error('Contacts table body not found for display');
    return;
  }
  
  // Clear the table
  tableBody.innerHTML = '';
  
  // If no contacts, show a message
  if (contactsToDisplay.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="7" class="text-center">No contacts found</td></tr>';
    return;
  }
  
  // Add each contact to the table
  contactsToDisplay.forEach(contact => {
    const row = document.createElement('tr');
    
    // Check if contact is selected
    const isChecked = selectedContactIds.has(contact.id.toString()) || allContactsSelected;
    
    // Create each cell
    row.innerHTML = `
      <td><input type="checkbox" class="contact-checkbox" data-id="${contact.id}" ${isChecked ? 'checked' : ''}></td>
      <td>${contact.name || ''}</td>
      <td>${contact.surname || ''}</td>
      <td>${contact.phoneNumber || ''}</td>
      <td>${contact.email || ''}</td>
      <td>${contact.source || 'Added manually'}</td>
      <td>
        <button class="action-btn edit-btn" data-id="${contact.id}">
          <i class="fas fa-edit"></i>
        </button>
        <button class="action-btn delete-btn" data-id="${contact.id}">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    `;
    
    tableBody.appendChild(row);
  });
  
  // Add event listeners to delete buttons
  document.querySelectorAll('.delete-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-id');
      if (!id) return;
      
      if (confirm('Are you sure you want to delete this contact?')) {
        try {
          await api.deleteContact(id);
          showNotification('Contact Deleted', 'Contact has been deleted successfully', 'success');
          loadContactsPaginated(); // Reload the current page
        } catch (error) {
          showNotification('Error deleting contact', error.message, 'error');
        }
      }
    });
  });
  
  // Add event listeners to edit buttons
  document.querySelectorAll('.edit-btn').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-id');
      if (id) openContactModal(id);
    });
  });
  
  // Add event listeners to contact checkboxes
  document.querySelectorAll('.contact-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      const id = checkbox.getAttribute('data-id');
      if (checkbox.checked) {
        selectedContactIds.add(id);
      } else {
        selectedContactIds.delete(id);
        allContactsSelected = false;
        // Uncheck "select all" if any individual checkbox is unchecked
        const selectAllCheckbox = document.getElementById('select-all-contacts');
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
      }
      updateDeleteSelectedButton();
    });
  });
  
  // Add pagination
  addOptimizedPagination(pagination);
}

/**
 * Add optimized pagination controls to the contacts table
 * @param {Object} pagination - Pagination information
 */
function addOptimizedPagination(pagination) {
  // Create pagination container if it doesn't exist
  let paginationContainer = document.querySelector('.pagination-container');
  if (!paginationContainer) {
    paginationContainer = document.createElement('div');
    paginationContainer.className = 'pagination-container';
    const contactsTable = document.getElementById('contacts-table');
    if (contactsTable && contactsTable.parentNode) {
      contactsTable.parentNode.appendChild(paginationContainer);
    }
  }
  
  // Clear pagination container
  paginationContainer.innerHTML = '';
  
  // Create pagination controls
  const pagination_el = document.createElement('div');
  pagination_el.className = 'pagination';
  
  // First page button
  const firstButton = document.createElement('button');
  firstButton.innerHTML = '<i class="fas fa-angle-double-left"></i>';
  firstButton.disabled = pagination.currentPage === 1;
  firstButton.addEventListener('click', () => {
    currentPage = 1;
    loadContactsPaginated();
  });
  pagination_el.appendChild(firstButton);
  
  // Previous button
  const prevButton = document.createElement('button');
  prevButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
  prevButton.disabled = !pagination.hasPrevious;
  prevButton.addEventListener('click', () => {
    if (pagination.hasPrevious) {
      currentPage--;
      loadContactsPaginated();
    }
  });
  pagination_el.appendChild(prevButton);
  
  // Page indicator
  const pageIndicator = document.createElement('span');
  pageIndicator.textContent = `Page ${pagination.currentPage} of ${pagination.totalPages} (${pagination.total} contacts)`;
  pagination_el.appendChild(pageIndicator);
  
  // Next button
  const nextButton = document.createElement('button');
  nextButton.innerHTML = '<i class="fas fa-chevron-right"></i>';
  nextButton.disabled = !pagination.hasNext;
  nextButton.addEventListener('click', () => {
    if (pagination.hasNext) {
      currentPage++;
      loadContactsPaginated();
    }
  });
  pagination_el.appendChild(nextButton);
  
  // Last page button
  const lastButton = document.createElement('button');
  lastButton.innerHTML = '<i class="fas fa-angle-double-right"></i>';
  lastButton.disabled = pagination.currentPage === pagination.totalPages;
  lastButton.addEventListener('click', () => {
    currentPage = pagination.totalPages;
    loadContactsPaginated();
  });
  pagination_el.appendChild(lastButton);
  
  // Add pagination to container
  paginationContainer.appendChild(pagination_el);
  
  // Add page size info
  const pageSizeInfo = document.createElement('div');
  pageSizeInfo.className = 'pagination-info';
  pageSizeInfo.innerHTML = `<span>Showing ${pageSize} contacts per page</span>`;
  paginationContainer.appendChild(pageSizeInfo);
}

/**
 * Update the "Delete Selected" button state
 */
function updateDeleteSelectedButton() {
  const deleteSelectedButton = document.getElementById('delete-selected-contacts');
  
  if (deleteSelectedButton) {
    const selectedCount = allContactsSelected ? totalContacts : selectedContactIds.size;
    
    if (selectedCount > 0) {
      deleteSelectedButton.removeAttribute('disabled');
      
      // Change button text based on selection
      if (allContactsSelected) {
        deleteSelectedButton.innerHTML = `<i class="fas fa-trash"></i> Delete All (${totalContacts})`;
        deleteSelectedButton.classList.add('warning');
      } else {
        deleteSelectedButton.innerHTML = `<i class="fas fa-trash"></i> Delete Selected (${selectedCount})`;
        deleteSelectedButton.classList.remove('warning');
      }
    } else {
      deleteSelectedButton.setAttribute('disabled', 'disabled');
      deleteSelectedButton.innerHTML = '<i class="fas fa-trash"></i> Delete Selected';
      deleteSelectedButton.classList.remove('warning');
    }
  }
}

/**
 * Open contact modal for adding or editing a contact
 * @param {string|null} id - The contact ID to edit, or null for a new contact
 */
async function openContactModal(id = null) {
  try {
    // Wait for API to be available
    await waitForAPI();
    
    const modal = document.getElementById('contact-modal');
    const modalTitle = document.getElementById('contact-modal-title');
    const contactForm = document.getElementById('contact-form');
    
    if (!modal || !modalTitle || !contactForm) {
      console.error('Contact modal elements not found');
      return;
    }
    
    // Reset form
    contactForm.reset();
    
    // Update modal title
    modalTitle.textContent = id ? 'Edit Contact' : 'Add Contact';
    
    // Set contact ID if editing
    const contactIdField = document.getElementById('contact-id');
    if (contactIdField) {
      contactIdField.value = id || '';
    }
    
    // If editing, populate form with contact data
    if (id) {
      console.log(`Fetching contact data for ID: ${id}`);
      const contact = await api.getContact(id);
      console.log('Contact data received:', contact);
      
      if (contact) {
        // Populate form fields
        const fields = [
          { id: 'contact-name', value: contact.name || '' },
          { id: 'contact-surname', value: contact.surname || '' },
          { id: 'contact-phone', value: contact.phoneNumber || '' },
          { id: 'contact-email', value: contact.email || '' },
          { id: 'contact-birthday', value: contact.birthday || '' },
          { id: 'contact-source', value: contact.source || 'Added manually' },
          { id: 'contact-notes', value: contact.notes || '' }
        ];
        
        console.log('Setting form fields:', fields);
        
        fields.forEach(field => {
          const element = document.getElementById(field.id);
          if (element) {
            console.log(`Setting ${field.id} to "${field.value}"`);
            element.value = field.value;
            
            // Ensure the field is editable
            element.disabled = false;
            element.readOnly = field.id === 'contact-source' ? true : false; // Only source should be readonly
          } else {
            console.error(`Element not found: ${field.id}`);
          }
        });
      } else {
        showNotification('Error', 'Contact not found', 'error');
        return;
      }
    } else {
      // Set default values for new contact
      const sourceField = document.getElementById('contact-source');
      if (sourceField) {
        sourceField.value = 'Added manually';
      }
      
      // Ensure all fields are editable
      const formFields = contactForm.querySelectorAll('input, textarea, select');
      formFields.forEach(field => {
        field.disabled = false;
        field.readOnly = false;
      });
    }
    
    // Show modal
    modal.style.display = 'block';
    
    // Add event listeners to close buttons
    const closeButtons = modal.querySelectorAll('.close-modal');
    closeButtons.forEach(button => {
      // Remove existing event listeners
      const newCloseButton = button.cloneNode(true);
      button.parentNode.replaceChild(newCloseButton, button);
      
      newCloseButton.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    });
    
    // Set up save button
    const saveButton = document.getElementById('save-contact');
    if (saveButton) {
      // Remove existing event listeners
      const newSaveButton = saveButton.cloneNode(true);
      saveButton.parentNode.replaceChild(newSaveButton, saveButton);
      
      // Add new event listener
      newSaveButton.addEventListener('click', saveContact);
    }
    
    // Outside click to close
    window.onclick = function(event) {
      if (event.target === modal) {
        modal.style.display = 'none';
      }
    };
  } catch (error) {
    console.error('Error opening contact modal:', error);
    showNotification('Error', 'Failed to open contact form: ' + error.message, 'error');
  }
}

/**
 * Save contact from form
 */
async function saveContact() {
  try {
    // Wait for API to be available
    await waitForAPI();
    
    // Get form data
    const id = document.getElementById('contact-id')?.value;
    const name = document.getElementById('contact-name')?.value || '';
    const surname = document.getElementById('contact-surname')?.value || '';
    const phoneNumber = document.getElementById('contact-phone')?.value || '';
    const email = document.getElementById('contact-email')?.value || '';
    const birthday = document.getElementById('contact-birthday')?.value || '';
    const source = document.getElementById('contact-source')?.value || 'Added manually';
    const notes = document.getElementById('contact-notes')?.value || '';
    
    // Validate required fields
    if (!phoneNumber) {
      showNotification('Validation Error', 'Phone number is required', 'error');
      return;
    }
    
    // Format phone number
    const formattedPhone = formatPhoneNumber(phoneNumber);
    
    // Create contact data object
    const contactData = {
      name,
      surname,
      phoneNumber: formattedPhone,
      email: email || null, // Use null for empty email
      birthday: birthday || null,
      source: source || 'Added manually',
      notes: notes || null
    };
    
    console.log('Saving contact data:', contactData);
    
    // Save contact
    if (id) {
      // Update existing contact
      const result = await api.updateContact(id, contactData);
      if (result) {
        showNotification('Contact Updated', 'Contact has been updated successfully', 'success');
      } else {
        throw new Error('Failed to update contact');
      }
    } else {
      // Create new contact
      const result = await api.createContact(contactData);
      if (result && result.success) {
        showNotification('Contact Added', 'New contact has been created successfully', 'success');
      } else if (result && result.code === 'DUPLICATE_PHONE') {
        showNotification('Duplicate Phone', 'A contact with this phone number already exists', 'error');
        return;
      } else {
        throw new Error(result?.error || 'Failed to create contact');
      }
    }
    
    // Close modal
    const modal = document.getElementById('contact-modal');
    if (modal) {
      modal.style.display = 'none';
    }
    
    // Reload contacts
    loadContactsPaginated();
  } catch (error) {
    console.error('Error saving contact:', error);
    showNotification('Error', 'Failed to save contact: ' + error.message, 'error');
  }
}

/**
 * Rebuild the contacts table if it's missing
 */
function rebuildContactsTable() {
  console.log('Rebuilding contacts table...');
  
  const contactsSection = document.getElementById('contacts');
  if (!contactsSection) {
    console.error('Contacts section not found in the DOM');
    return;
  }
  
  // Check if the table container exists
  let tableContainer = contactsSection.querySelector('.contacts-table-container');
  if (!tableContainer) {
    tableContainer = document.createElement('div');
    tableContainer.className = 'contacts-table-container';
    contactsSection.appendChild(tableContainer);
  }
  
  // Create table
  const table = document.createElement('table');
  table.className = 'data-table';
  table.id = 'contacts-table';
  
  // Create table header
  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th><input type="checkbox" id="select-all-contacts"></th>
      <th>Name</th>
      <th>Surname</th>
      <th>Phone Number</th>
      <th>Email</th>
      <th>Source</th>
      <th>Actions</th>
    </tr>
  `;
  table.appendChild(thead);
  
  // Create table body
  const tbody = document.createElement('tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="text-center">Loading contacts...</td></tr>';
  table.appendChild(tbody);
  
  // Add table to container
  tableContainer.innerHTML = '';
  tableContainer.appendChild(table);
  
  // Load contacts
  loadContactsPaginated();
}

/**
 * Open import modal for importing contacts
 */
function openImportModal() {
  const modal = document.getElementById('import-modal');
  if (!modal) {
    console.error('Import modal not found');
    return;
  }
  
  // Reset form
  const importForm = document.getElementById('import-form');
  if (importForm) {
    importForm.reset();
  }
  
  // Reset file path display
  const filePathDisplay = document.getElementById('import-file-path');
  if (filePathDisplay) {
    filePathDisplay.value = '';
  }
  
  // Create hidden input for file path if it doesn't exist
  let filePathInput = document.getElementById('file-path');
  if (!filePathInput) {
    filePathInput = document.createElement('input');
    filePathInput.type = 'hidden';
    filePathInput.id = 'file-path';
    importForm.appendChild(filePathInput);
  }
  
  // Show modal
  modal.style.display = 'block';
  
  // Add event listeners
  const closeButtons = modal.querySelectorAll('.close-modal');
  closeButtons.forEach(button => {
    // Remove existing event listeners to prevent duplicates
    const newCloseButton = button.cloneNode(true);
    button.parentNode.replaceChild(newCloseButton, button);
    
    newCloseButton.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  });
  
  // Browse button
  const browseButton = document.getElementById('browse-file');
  if (browseButton) {
    // Remove existing event listeners
    const newBrowseButton = browseButton.cloneNode(true);
    browseButton.parentNode.replaceChild(newBrowseButton, browseButton);
    
    // Add new event listener
    newBrowseButton.addEventListener('click', browseFile);
  }
  
  // Import button
  const importButton = document.getElementById('start-import');
  if (importButton) {
    // Remove existing event listeners
    const newImportButton = importButton.cloneNode(true);
    importButton.parentNode.replaceChild(newImportButton, importButton);
    
    // Add new event listener
    newImportButton.addEventListener('click', importContacts);
  }
  
  // Outside click to close
  window.onclick = function(event) {
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  };
}

/**
 * Browse for a file to import
 */
async function browseFile() {
  try {
    // Wait for API to be available
    await waitForAPI();
    
    const result = await api.showFileDialog({
      title: 'Select File to Import',
      buttonLabel: 'Import',
      filters: [
        { name: 'CSV Files', extensions: ['csv'] },
        { name: 'Excel Files', extensions: ['xlsx', 'xls'] },
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      console.log('File selection canceled');
      return;
    }
    
    const filePath = result.filePaths[0];
    console.log('Selected file:', filePath);
    
    // Display selected file path
    const filePathDisplay = document.getElementById('import-file-path');
    if (filePathDisplay) {
      filePathDisplay.value = filePath;
    }
    
    // Store file path in hidden input
    const filePathInput = document.getElementById('file-path');
    if (filePathInput) {
      filePathInput.value = filePath;
    }
  } catch (error) {
    console.error('Error browsing for file:', error);
    showNotification('Error', 'Failed to browse for file: ' + error.message, 'error');
  }
}

/**
 * Import contacts from the selected file
 */
async function importContacts() {
  try {
    // Wait for API to be available
    await waitForAPI();
    
    // Get file path
    const filePathInput = document.getElementById('file-path');
    if (!filePathInput || !filePathInput.value) {
      showNotification('No File Selected', 'Please select a file to import', 'warning');
      return;
    }
    
    const filePath = filePathInput.value;
    const fileExt = filePath.split('.').pop().toLowerCase();
    
    // Validate file extension
    if (!['csv', 'xlsx', 'xls', 'json'].includes(fileExt)) {
      showNotification('Invalid File', 'Please select a CSV, Excel, or JSON file', 'error');
      return;
    }
    
    // Show progress container
    const progressContainer = document.getElementById('import-progress-container');
    if (progressContainer) {
      progressContainer.style.display = 'block';
    }
    
    // Reset preview stats
    const statsElements = [
      'preview-total-count', 
      'preview-valid-count',
      'preview-duplicates-count', 
      'preview-missing-count',
      'preview-issues-count',
      'selected-for-import-count'
    ];
    
    statsElements.forEach(id => {
      const element = document.getElementById(id);
      if (element) element.textContent = '0';
    });
    
    // Reset preview tables
    const previewTables = ['preview-valid-tbody', 'preview-skipped-tbody'];
    previewTables.forEach(id => {
      const element = document.getElementById(id);
      if (element) element.innerHTML = '<tr><td colspan="9" class="text-center">Loading...</td></tr>';
    });
    
    // Reset pagination containers
    const paginationContainers = ['valid-contacts-pagination', 'skipped-contacts-pagination'];
    paginationContainers.forEach(id => {
      const element = document.getElementById(id);
      if (element) element.innerHTML = '';
    });
    
    // Parse file and show preview
    try {
      // Parse contacts from file
      const result = await api.parseContactsFile(filePath, fileExt);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to parse file');
      }
      
      console.log(`Parsed ${result.contacts.length} contacts from file`);
      
      // Show import preview
      await showImportPreview(result.contacts, filePath, fileExt);
      
    } catch (error) {
      console.error('Error parsing contacts file:', error);
      showNotification('Error', 'Failed to parse contacts file: ' + error.message, 'error');
      
      // Hide progress container
      if (progressContainer) {
        progressContainer.style.display = 'none';
      }
    }
  } catch (error) {
    console.error('Error importing contacts:', error);
    showNotification('Error', 'Failed to import contacts: ' + error.message, 'error');
  }
}

/**
 * Delete selected contacts
 */
async function deleteSelectedContacts() {
  try {
    // Wait for API to be available
    await waitForAPI();
    
    // Get selected contact IDs
    let contactIds = [];
    
    if (allContactsSelected) {
      // If all contacts are selected, we need a different approach
      if (confirm(`Are you sure you want to delete ALL ${totalContacts} contacts? This cannot be undone.`)) {
        // For full dataset deletion, we need to get all contact IDs
        // We'll do this in batches to avoid memory issues
        
        // First ask the user if they're really sure
        if (!confirm(`FINAL WARNING: This will permanently delete ALL ${totalContacts} contacts from your database. This action CANNOT be undone.`)) {
          return;
        }
        
        // Show loading notification
        showNotification('Deleting Contacts', 'Preparing to delete all contacts...', 'info');
        
        // Get all contacts (this might take time but it's a necessary step)
        const allContacts = await api.getContacts();
        contactIds = allContacts.map(contact => contact.id);
      } else {
        return;
      }
    } else {
      // Get selected contact IDs from the Set
      contactIds = Array.from(selectedContactIds);
      
      // Confirm deletion
      if (!confirm(`Are you sure you want to delete ${contactIds.length} selected contacts?`)) {
        return;
      }
    }
    
    if (contactIds.length === 0) {
      showNotification('No Contacts Selected', 'Please select contacts to delete', 'warning');
      return;
    }
    
    // Show delete in progress notification
    showNotification('Deleting Contacts', `Deleting ${contactIds.length} contacts...`, 'info');
    
    // Create a progress dialog
    const progressDialog = document.createElement('div');
    progressDialog.className = 'progress-dialog';
    progressDialog.innerHTML = `
      <div class="progress-content">
        <h3>Deleting Contacts</h3>
        <p>Deleting <span id="delete-count">${contactIds.length}</span> contacts...</p>
        <div class="progress-bar-container">
          <div id="delete-progress-bar" class="progress-bar" style="width: 0%"></div>
        </div>
        <p id="delete-status">0% complete</p>
      </div>
    `;
    document.body.appendChild(progressDialog);
    
    // Set up progress handler
    const updateProgress = (progress) => {
      const percent = Math.round((progress.deleted + progress.errors) / progress.total * 100);
      const progressBar = document.getElementById('delete-progress-bar');
      const statusText = document.getElementById('delete-status');
      
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (statusText) statusText.textContent = `${percent}% complete (${progress.deleted} deleted, ${progress.errors} errors)`;
    };
    
    // Listen for progress updates
    const progressListener = (event, progress) => {
      updateProgress(progress);
    };
    
    if (window.api && window.api.on) {
      window.api.on('delete-progress', progressListener);
    }
    
    try {
      // Use the optimized bulk delete method
      const result = await api.deleteContactsBulk(contactIds);
      
      // Remove progress dialog
      document.body.removeChild(progressDialog);
      
      // Remove progress listener
      if (window.api && window.api.removeAllListeners) {
        window.api.removeAllListeners('delete-progress');
      }
      
      // Show success notification
      showNotification(
        'Contacts Deleted',
        `Successfully deleted ${result.deleted} contacts. ${result.errors > 0 ? `${result.errors} contacts could not be deleted.` : ''}`,
        result.errors > 0 ? 'warning' : 'success'
      );
      
      // Reset selection
      selectedContactIds.clear();
      allContactsSelected = false;
      
      // Reset select all checkbox
      const selectAllCheckbox = document.getElementById('select-all-contacts');
      if (selectAllCheckbox) {
        selectAllCheckbox.checked = false;
      }
      
      // Reload contacts to get updated count
      loadContactsPaginated();
    } catch (error) {
      // Remove progress dialog in case of error
      document.body.removeChild(progressDialog);
      
      // Remove progress listener
      if (window.api && window.api.removeAllListeners) {
        window.api.removeAllListeners('delete-progress');
      }
      
      console.error('Error deleting selected contacts:', error);
      showNotification('Error', 'Failed to delete contacts: ' + error.message, 'error');
    }
  } catch (error) {
    console.error('Error deleting selected contacts:', error);
    showNotification('Error', 'Failed to delete contacts: ' + error.message, 'error');
  }
}

/**
 * Show import preview for contacts
 * @param {Array} contacts - Array of contacts to preview
 * @param {string} filePath - Path to the import file
 * @param {string} fileExt - File extension
 */
async function showImportPreview(contacts, filePath, fileExt) {
  try {
    console.log(`Showing import preview for ${contacts.length} contacts from ${filePath}`);
    
    // Hide the import modal
    const importModal = document.getElementById('import-modal');
    if (importModal) {
      importModal.style.display = 'none';
    }
    
    // Show the preview modal
    const previewModal = document.getElementById('import-preview-modal');
    if (!previewModal) {
      console.error('Preview modal not found');
      return;
    }
    
    // Reset and show the modal
    previewModal.style.display = 'block';
    
    // Process contacts for preview
    const validContacts = [];
    const skippedContacts = [];
    let duplicatesCount = 0;
    let missingPhoneCount = 0;
    let otherIssuesCount = 0;
    
    // Get existing phone numbers for duplicate checking
    const existingContacts = await api.getContacts();
    const existingPhones = new Set(existingContacts.map(c => c.phoneNumber));
    
    // First pass: identify duplicates within the file itself
    const filePhoneMap = new Map(); // Map to track phone numbers within the file
    const duplicateIndices = new Set(); // Set to track indices of duplicate contacts
    
    // Identify duplicates within the file
    contacts.forEach((contact, index) => {
      if (contact.phoneNumber) {
        const formattedPhone = formatPhoneNumber(contact.phoneNumber);
        if (filePhoneMap.has(formattedPhone)) {
          // This is a duplicate within the file
          duplicateIndices.add(index);
          duplicateIndices.add(filePhoneMap.get(formattedPhone));
        } else {
          filePhoneMap.set(formattedPhone, index);
        }
      }
    });
    
    // Second pass: process each contact
    contacts.forEach((contact, index) => {
      // Clone the contact to avoid modifying the original
      const processedContact = { ...contact, _index: index };
      
      // Check for required fields
      if (!processedContact.phoneNumber) {
        processedContact._skipReason = 'Missing phone number';
        processedContact._status = 'error';
        skippedContacts.push(processedContact);
        missingPhoneCount++;
        return;
      }
      
      // Format phone number
      processedContact.phoneNumber = formatPhoneNumber(processedContact.phoneNumber);
      
      // Check for duplicates with existing contacts
      if (existingPhones.has(processedContact.phoneNumber)) {
        processedContact._skipReason = 'Duplicate with existing contact';
        processedContact._status = 'duplicate-existing';
        skippedContacts.push(processedContact);
        duplicatesCount++;
        return;
      }
      
      // Check for duplicates within the file
      if (duplicateIndices.has(index)) {
        // Mark as duplicate but still keep in valid contacts (user can choose which to keep)
        processedContact._isDuplicate = true;
        processedContact._status = 'duplicate-file';
        processedContact._selected = true; // Selected by default
        validContacts.push(processedContact);
        return;
      }
      
      // Add to valid contacts
      processedContact._status = 'valid';
      processedContact._selected = true; // Selected by default
      validContacts.push(processedContact);
      
      // Add to existing phones to prevent further duplicates
      existingPhones.add(processedContact.phoneNumber);
    });
    
    // Update stats
    document.getElementById('preview-total-count').textContent = contacts.length;
    document.getElementById('preview-valid-count').textContent = validContacts.length;
    document.getElementById('preview-duplicates-count').textContent = duplicatesCount + duplicateIndices.size / 2;
    document.getElementById('preview-missing-count').textContent = missingPhoneCount;
    document.getElementById('preview-issues-count').textContent = otherIssuesCount;
    document.getElementById('selected-for-import-count').textContent = validContacts.filter(c => c._selected).length;
    
    // Define pagination variables for valid contacts
    const validContactsState = {
      pageSize: 100,
      currentPage: 1,
      totalPages: Math.ceil(validContacts.length / 100)
    };
    
    // Define pagination variables for skipped contacts
    const skippedContactsState = {
      pageSize: 100,
      currentPage: 1,
      totalPages: Math.ceil(skippedContacts.length / 100)
    };
    
    // Function to render contacts table with pagination
    const renderValidContactsTable = (page = 1) => {
      const validTableBody = document.getElementById('preview-valid-tbody');
      if (!validTableBody) return;
      
      validTableBody.innerHTML = '';
      validContactsState.currentPage = page;
      
      if (validContacts.length === 0) {
        validTableBody.innerHTML = '<tr><td colspan="9" class="text-center">No valid contacts found</td></tr>';
        return;
      }
      
      // Calculate start and end indices for the current page
      const startIndex = (page - 1) * validContactsState.pageSize;
      const endIndex = Math.min(startIndex + validContactsState.pageSize, validContacts.length);
      
      // Update select all checkbox state
      const selectAllCheckbox = document.getElementById('select-all-preview-contacts');
      if (selectAllCheckbox) {
        // Check if all visible contacts on this page are selected
        const allVisibleSelected = validContacts
          .slice(startIndex, endIndex)
          .every(contact => contact._selected);
        
        selectAllCheckbox.checked = allVisibleSelected;
      }
      
      // Render contacts for the current page
      for (let i = startIndex; i < endIndex; i++) {
        const contact = validContacts[i];
        const row = document.createElement('tr');
        
        // Add a class if this is a duplicate
        if (contact._isDuplicate) {
          row.classList.add('duplicate-row');
        }
        
        row.innerHTML = `
          <td><input type="checkbox" class="preview-contact-checkbox" data-index="${contact._index}" ${contact._selected ? 'checked' : ''}></td>
          <td>${contact.name || ''}</td>
          <td>${contact.surname || ''}</td>
          <td class="${contact._isDuplicate ? 'duplicate-cell' : ''}">${contact.phoneNumber || ''}</td>
          <td>${contact.email || ''}</td>
          <td>${contact.birthday || ''}</td>
          <td>${contact.source || 'Imported'}</td>
          <td>
            <span class="status-badge ${contact._isDuplicate ? 'warning' : 'valid'}">
              ${contact._isDuplicate ? 'Duplicate' : 'Valid'}
            </span>
          </td>
          <td>
            <button class="action-btn skip-btn" data-index="${contact._index}" title="Skip this contact">
              <i class="fas fa-ban"></i>
            </button>
          </td>
        `;
        
        validTableBody.appendChild(row);
      }
      
      // Add pagination controls
      renderValidPagination();
      
      // Reattach event listeners for the new checkboxes
      document.querySelectorAll('.preview-contact-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
          const index = parseInt(checkbox.getAttribute('data-index'));
          const contact = validContacts.find(c => c._index === index);
          if (contact) {
            contact._selected = checkbox.checked;
            updateSelectedCount(validContacts);
          }
        });
      });
      
      // Reattach event listeners for skip buttons
      document.querySelectorAll('.skip-btn').forEach(button => {
        button.addEventListener('click', () => {
          const index = parseInt(button.getAttribute('data-index'));
          const contactIndex = validContacts.findIndex(c => c._index === index);
          if (contactIndex !== -1) {
            const contact = validContacts[contactIndex];
            contact._selected = false;
            contact._skipReason = 'Manually skipped';
            contact._status = 'skipped';
            
            // Move from valid to skipped
            skippedContacts.push(contact);
            validContacts.splice(contactIndex, 1);
            
            // Update stats
            document.getElementById('preview-valid-count').textContent = validContacts.length;
            document.getElementById('preview-issues-count').textContent = ++otherIssuesCount;
            updateSelectedCount(validContacts);
            
            // Update pagination state
            validContactsState.totalPages = Math.ceil(validContacts.length / validContactsState.pageSize);
            skippedContactsState.totalPages = Math.ceil(skippedContacts.length / skippedContactsState.pageSize);
            
            // Re-render tables
            renderValidContactsTable(Math.min(validContactsState.currentPage, validContactsState.totalPages || 1));
            renderSkippedContactsTable(1);
          }
        });
      });
      
      // Setup select all checkbox for current page
      if (selectAllCheckbox) {
        selectAllCheckbox.removeEventListener('change', handleSelectAllCurrentPage);
        selectAllCheckbox.addEventListener('change', handleSelectAllCurrentPage);
      }
    };
    
    // Handler for select all checkbox
    const handleSelectAllCurrentPage = (event) => {
      const isChecked = event.target.checked;
      const startIndex = (validContactsState.currentPage - 1) * validContactsState.pageSize;
      const endIndex = Math.min(startIndex + validContactsState.pageSize, validContacts.length);
      
      // Update all contacts on the current page
      for (let i = startIndex; i < endIndex; i++) {
        validContacts[i]._selected = isChecked;
      }
      
      // Update checkboxes on current page
      document.querySelectorAll('.preview-contact-checkbox').forEach(checkbox => {
        checkbox.checked = isChecked;
      });
      
      updateSelectedCount(validContacts);
    };
    
    // Function to render skipped contacts table with pagination
    const renderSkippedContactsTable = (page = 1) => {
      const skippedTableBody = document.getElementById('preview-skipped-tbody');
      if (!skippedTableBody) return;
      
      skippedTableBody.innerHTML = '';
      skippedContactsState.currentPage = page;
      
      if (skippedContacts.length === 0) {
        skippedTableBody.innerHTML = '<tr><td colspan="9" class="text-center">No skipped contacts</td></tr>';
        return;
      }
      
      // Calculate start and end indices for the current page
      const startIndex = (page - 1) * skippedContactsState.pageSize;
      const endIndex = Math.min(startIndex + skippedContactsState.pageSize, skippedContacts.length);
      
      // Update select all checkbox state
      const selectAllSkippedCheckbox = document.getElementById('select-all-skipped-contacts');
      if (selectAllSkippedCheckbox) {
        // Check if all visible contacts on this page are selected
        const allVisibleSelected = skippedContacts
          .slice(startIndex, endIndex)
          .every(contact => contact._selected);
        
        selectAllSkippedCheckbox.checked = allVisibleSelected;
        
        // Add event listener for the select all checkbox
        selectAllSkippedCheckbox.removeEventListener('change', handleSelectAllSkippedCurrentPage);
        selectAllSkippedCheckbox.addEventListener('change', handleSelectAllSkippedCurrentPage);
      }
      
      // Render contacts for the current page
      for (let i = startIndex; i < endIndex; i++) {
        const contact = skippedContacts[i];
        const row = document.createElement('tr');
        
        // Initialize _selected property if not set
        if (contact._selected === undefined) {
          contact._selected = false;
        }
        
        // Add row class based on status
        if (contact._status === 'duplicate-existing') {
          row.classList.add('duplicate-row');
        } else if (contact._status === 'error') {
          row.classList.add('error-row');
        }
        
        row.innerHTML = `
          <td><input type="checkbox" class="skipped-contact-checkbox" data-index="${contact._index}" ${contact._selected ? 'checked' : ''}></td>
          <td>${contact.name || ''}</td>
          <td>${contact.surname || ''}</td>
          <td>${contact.phoneNumber || ''}</td>
          <td>${contact.email || ''}</td>
          <td>${contact.birthday || ''}</td>
          <td>${contact.source || 'Imported'}</td>
          <td>${contact._skipReason || 'Unknown issue'}</td>
          <td>
            <button class="action-btn restore-btn" data-index="${contact._index}" title="Move to valid contacts">
              <i class="fas fa-arrow-left"></i>
            </button>
          </td>
        `;
        
        skippedTableBody.appendChild(row);
      }
      
      // Add pagination controls
      renderSkippedPagination();
      
      // Add event listeners to checkboxes
      document.querySelectorAll('.skipped-contact-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
          const index = parseInt(checkbox.getAttribute('data-index'));
          const contact = skippedContacts.find(c => c._index === index);
          if (contact) {
            contact._selected = checkbox.checked;
            
            // Update select all checkbox state
            if (selectAllSkippedCheckbox) {
              const allChecked = Array.from(document.querySelectorAll('.skipped-contact-checkbox')).every(cb => cb.checked);
              selectAllSkippedCheckbox.checked = allChecked;
            }
          }
        });
      });
      
      // Add event listeners for restore buttons
      document.querySelectorAll('.restore-btn').forEach(button => {
        button.addEventListener('click', () => {
          const index = parseInt(button.getAttribute('data-index'));
          const contactIndex = skippedContacts.findIndex(c => c._index === index);
          
          if (contactIndex !== -1) {
            const contact = skippedContacts[contactIndex];
            
            // Move from skipped to valid
            contact._status = 'valid';
            contact._selected = true; // Select by default when restored
            validContacts.push(contact);
            skippedContacts.splice(contactIndex, 1);
            
            // Update stats
            document.getElementById('preview-valid-count').textContent = validContacts.length;
            if (contact._skipReason === 'Missing phone number') {
              missingPhoneCount--;
            } else if (contact._status === 'duplicate-existing') {
              duplicatesCount--;
            } else {
              otherIssuesCount--;
            }
            document.getElementById('preview-duplicates-count').textContent = duplicatesCount;
            document.getElementById('preview-missing-count').textContent = missingPhoneCount;
            document.getElementById('preview-issues-count').textContent = otherIssuesCount;
            
            updateSelectedCount(validContacts);
            
            // Update pagination state
            validContactsState.totalPages = Math.ceil(validContacts.length / validContactsState.pageSize);
            skippedContactsState.totalPages = Math.ceil(skippedContacts.length / skippedContactsState.pageSize);
            
            // Re-render tables
            renderValidContactsTable(validContactsState.currentPage);
            renderSkippedContactsTable(Math.min(skippedContactsState.currentPage, skippedContactsState.totalPages || 1));
          }
        });
      });
    };
    
    // Handler for select all checkbox for skipped contacts
    const handleSelectAllSkippedCurrentPage = (event) => {
      const isChecked = event.target.checked;
      const startIndex = (skippedContactsState.currentPage - 1) * skippedContactsState.pageSize;
      const endIndex = Math.min(startIndex + skippedContactsState.pageSize, skippedContacts.length);
      
      // Update all skipped contacts on the current page
      for (let i = startIndex; i < endIndex; i++) {
        skippedContacts[i]._selected = isChecked;
      }
      
      // Update checkboxes on current page
      document.querySelectorAll('.skipped-contact-checkbox').forEach(checkbox => {
        checkbox.checked = isChecked;
      });
    };
    
    // Function to render pagination for valid contacts
    const renderValidPagination = () => {
      const paginationContainer = document.getElementById('valid-contacts-pagination');
      if (!paginationContainer) return;
      
      paginationContainer.innerHTML = '';
      
      // Always show pagination info, even for single page
      const pagination = document.createElement('div');
      pagination.className = 'pagination preview-pagination';
      
      // First page button
      const firstButton = document.createElement('button');
      firstButton.innerHTML = '<i class="fas fa-angle-double-left"></i>';
      firstButton.disabled = validContactsState.currentPage === 1;
      firstButton.addEventListener('click', () => renderValidContactsTable(1));
      pagination.appendChild(firstButton);
      
      // Previous button
      const prevButton = document.createElement('button');
      prevButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
      prevButton.disabled = validContactsState.currentPage === 1;
      prevButton.addEventListener('click', () => 
        renderValidContactsTable(validContactsState.currentPage - 1)
      );
      pagination.appendChild(prevButton);
      
      // Page indicator
      const pageIndicator = document.createElement('span');
      pageIndicator.textContent = `Page ${validContactsState.currentPage} of ${validContactsState.totalPages} (${validContacts.length} contacts)`;
      pagination.appendChild(pageIndicator);
      
      // Next button
      const nextButton = document.createElement('button');
      nextButton.innerHTML = '<i class="fas fa-chevron-right"></i>';
      nextButton.disabled = validContactsState.currentPage >= validContactsState.totalPages;
      nextButton.addEventListener('click', () => 
        renderValidContactsTable(validContactsState.currentPage + 1)
      );
      pagination.appendChild(nextButton);
      
      // Last page button
      const lastButton = document.createElement('button');
      lastButton.innerHTML = '<i class="fas fa-angle-double-right"></i>';
      lastButton.disabled = validContactsState.currentPage >= validContactsState.totalPages;
      lastButton.addEventListener('click', () => 
        renderValidContactsTable(validContactsState.totalPages)
      );
      pagination.appendChild(lastButton);
      
      // Add page size info
      const pageSizeInfo = document.createElement('div');
      pageSizeInfo.className = 'pagination-info';
      pageSizeInfo.innerHTML = `<span>Showing ${validContactsState.pageSize} contacts per page</span>`;
      
      paginationContainer.appendChild(pagination);
      paginationContainer.appendChild(pageSizeInfo);
    };
    
    // Function to render pagination for skipped contacts
    const renderSkippedPagination = () => {
      const paginationContainer = document.getElementById('skipped-contacts-pagination');
      if (!paginationContainer) return;
      
      paginationContainer.innerHTML = '';
      
      // Always show pagination info, even for single page
      const pagination = document.createElement('div');
      pagination.className = 'pagination preview-pagination';
      
      // First page button
      const firstButton = document.createElement('button');
      firstButton.innerHTML = '<i class="fas fa-angle-double-left"></i>';
      firstButton.disabled = skippedContactsState.currentPage === 1;
      firstButton.addEventListener('click', () => renderSkippedContactsTable(1));
      pagination.appendChild(firstButton);
      
      // Previous button
      const prevButton = document.createElement('button');
      prevButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
      prevButton.disabled = skippedContactsState.currentPage === 1;
      prevButton.addEventListener('click', () => 
        renderSkippedContactsTable(skippedContactsState.currentPage - 1)
      );
      pagination.appendChild(prevButton);
      
      // Page indicator
      const pageIndicator = document.createElement('span');
      pageIndicator.textContent = `Page ${skippedContactsState.currentPage} of ${skippedContactsState.totalPages} (${skippedContacts.length} contacts)`;
      pagination.appendChild(pageIndicator);
      
      // Next button
      const nextButton = document.createElement('button');
      nextButton.innerHTML = '<i class="fas fa-chevron-right"></i>';
      nextButton.disabled = skippedContactsState.currentPage >= skippedContactsState.totalPages;
      nextButton.addEventListener('click', () => 
        renderSkippedContactsTable(skippedContactsState.currentPage + 1)
      );
      pagination.appendChild(nextButton);
      
      // Last page button
      const lastButton = document.createElement('button');
      lastButton.innerHTML = '<i class="fas fa-angle-double-right"></i>';
      lastButton.disabled = skippedContactsState.currentPage >= skippedContactsState.totalPages;
      lastButton.addEventListener('click', () => 
        renderSkippedContactsTable(skippedContactsState.totalPages)
      );
      pagination.appendChild(lastButton);
      
      // Add page size info
      const pageSizeInfo = document.createElement('div');
      pageSizeInfo.className = 'pagination-info';
      pageSizeInfo.innerHTML = `<span>Showing ${skippedContactsState.pageSize} contacts per page</span>`;
      
      paginationContainer.appendChild(pagination);
      paginationContainer.appendChild(pageSizeInfo);
    };
    
    // Initial render of both tables
    renderValidContactsTable(1);
    renderSkippedContactsTable(1);
    
    // Set up event listeners for the preview modal including special buttons
    setupPreviewEventListeners(validContacts, skippedContacts, filePath, fileExt, renderValidContactsTable, renderSkippedContactsTable, validContactsState, skippedContactsState);
    
  } catch (error) {
    console.error('Error showing import preview:', error);
    showNotification('Error', 'Failed to show import preview: ' + error.message, 'error');
  }
}

/**
 * Set up event listeners for the import preview modal
 * @param {Array} validContacts - Array of valid contacts
 * @param {Array} skippedContacts - Array of skipped contacts
 * @param {string} filePath - Path to the import file
 * @param {string} fileExt - File extension
 * @param {Function} renderValidContactsTable - Function to render valid contacts table
 * @param {Function} renderSkippedContactsTable - Function to render skipped contacts table
 * @param {Object} validContactsState - Pagination state for valid contacts
 * @param {Object} skippedContactsState - Pagination state for skipped contacts
 */
function setupPreviewEventListeners(validContacts, skippedContacts, filePath, fileExt, renderValidContactsTable, renderSkippedContactsTable, validContactsState, skippedContactsState) {
  const previewModal = document.getElementById('import-preview-modal');
  
  // Tab switching
  const validTabBtn = document.getElementById('valid-tab-btn');
  const skippedTabBtn = document.getElementById('skipped-tab-btn');
  const validTab = document.getElementById('valid-contacts-tab');
  const skippedTab = document.getElementById('skipped-contacts-tab');
  
  if (validTabBtn && skippedTabBtn && validTab && skippedTab) {
    // Remove existing event listeners
    const newValidTabBtn = validTabBtn.cloneNode(true);
    const newSkippedTabBtn = skippedTabBtn.cloneNode(true);
    
    validTabBtn.parentNode.replaceChild(newValidTabBtn, validTabBtn);
    skippedTabBtn.parentNode.replaceChild(newSkippedTabBtn, skippedTabBtn);
    
    // Add new event listeners
    newValidTabBtn.addEventListener('click', () => {
      newValidTabBtn.classList.add('active');
      newSkippedTabBtn.classList.remove('active');
      validTab.classList.add('active');
      skippedTab.classList.remove('active');
    });
    
    newSkippedTabBtn.addEventListener('click', () => {
      newValidTabBtn.classList.remove('active');
      newSkippedTabBtn.classList.add('active');
      validTab.classList.remove('active');
      skippedTab.classList.add('active');
    });
  }
  
  // Select/deselect all buttons
  const selectAllBtn = document.getElementById('select-all-preview');
  const deselectAllBtn = document.getElementById('deselect-all-preview');
  
  if (selectAllBtn && deselectAllBtn) {
    // Remove existing event listeners
    const newSelectAllBtn = selectAllBtn.cloneNode(true);
    const newDeselectAllBtn = deselectAllBtn.cloneNode(true);
    
    selectAllBtn.parentNode.replaceChild(newSelectAllBtn, selectAllBtn);
    deselectAllBtn.parentNode.replaceChild(newDeselectAllBtn, deselectAllBtn);
    
    // Add new event listeners
    newSelectAllBtn.addEventListener('click', () => {
      // Select all contacts across all pages
      validContacts.forEach(contact => {
        contact._selected = true;
      });
      
      // Update checkboxes on current page
      document.querySelectorAll('.preview-contact-checkbox').forEach(checkbox => {
        checkbox.checked = true;
      });
      
      // Update select all checkbox
      const selectAllCheckbox = document.getElementById('select-all-preview-contacts');
      if (selectAllCheckbox) {
        selectAllCheckbox.checked = true;
      }
      
      updateSelectedCount(validContacts);
    });
    
    newDeselectAllBtn.addEventListener('click', () => {
      // Deselect all contacts across all pages
      validContacts.forEach(contact => {
        contact._selected = false;
      });
      
      // Update checkboxes on current page
      document.querySelectorAll('.preview-contact-checkbox').forEach(checkbox => {
        checkbox.checked = false;
      });
      
      // Update select all checkbox
      const selectAllCheckbox = document.getElementById('select-all-preview-contacts');
      if (selectAllCheckbox) {
        selectAllCheckbox.checked = false;
      }
      
      updateSelectedCount(validContacts);
    });
  }
  
  // Move to Valid button for skipped contacts
  const moveToValidBtn = document.getElementById('move-to-valid');
  if (moveToValidBtn) {
    // Remove existing event listeners
    const newMoveToValidBtn = moveToValidBtn.cloneNode(true);
    moveToValidBtn.parentNode.replaceChild(newMoveToValidBtn, moveToValidBtn);
    
    // Add new event listener
    newMoveToValidBtn.addEventListener('click', () => {
      // Find selected skipped contacts
      const selectedSkipped = skippedContacts.filter(c => c._selected);
      
      if (selectedSkipped.length === 0) {
        showNotification('No Contacts Selected', 'Please select skipped contacts to move', 'warning');
        return;
      }
      
      // Confirm action
      if (!confirm(`Are you sure you want to move ${selectedSkipped.length} skipped contacts to the valid list?`)) {
        return;
      }
      
      // Update counters
      let missingPhoneFixed = 0;
      let duplicatesFixed = 0;
      let otherIssuesFixed = 0;
      
      // Move selected contacts to valid
      selectedSkipped.forEach(contact => {
        // Find and remove from skipped contacts
        const index = skippedContacts.findIndex(c => c._index === contact._index);
        if (index !== -1) {
          skippedContacts.splice(index, 1);
          
          // Update reason and status
          contact._status = 'valid';
          contact._selected = true; // Select by default when restored
          
          // Count by type
          if (contact._skipReason === 'Missing phone number') {
            missingPhoneFixed++;
          } else if (contact._skipReason === 'Duplicate with existing contact' || 
                     contact._skipReason === 'Duplicate phone number (auto-skipped)') {
            duplicatesFixed++;
          } else {
            otherIssuesFixed++;
          }
          
          // Clear the skip reason
          delete contact._skipReason;
          
          // Add to valid
          validContacts.push(contact);
        }
      });
      
      // Update stats
      document.getElementById('preview-valid-count').textContent = validContacts.length;
      
      // Adjust issue counters
      const missingPhoneCount = parseInt(document.getElementById('preview-missing-count').textContent) - missingPhoneFixed;
      const duplicatesCount = parseInt(document.getElementById('preview-duplicates-count').textContent) - duplicatesFixed;
      const otherIssuesCount = parseInt(document.getElementById('preview-issues-count').textContent) - otherIssuesFixed;
      
      document.getElementById('preview-missing-count').textContent = missingPhoneCount;
      document.getElementById('preview-duplicates-count').textContent = duplicatesCount;
      document.getElementById('preview-issues-count').textContent = otherIssuesCount;
      
      // Update pagination state
      validContactsState.totalPages = Math.ceil(validContacts.length / validContactsState.pageSize);
      skippedContactsState.totalPages = Math.ceil(skippedContacts.length / skippedContactsState.pageSize);
      
      // Re-render tables
      renderValidContactsTable(validContactsState.currentPage);
      renderSkippedContactsTable(Math.min(skippedContactsState.currentPage, skippedContactsState.totalPages || 1));
      
      // Update selected count
      updateSelectedCount(validContacts);
      
      // Show notification
      showNotification('Contacts Restored', `${selectedSkipped.length} contacts moved to valid list`, 'success');
    });
  }
  
  // Skip selected button
  const skipSelectedBtn = document.getElementById('skip-selected-preview');
  if (skipSelectedBtn) {
    // Remove existing event listeners
    const newSkipSelectedBtn = skipSelectedBtn.cloneNode(true);
    skipSelectedBtn.parentNode.replaceChild(newSkipSelectedBtn, skipSelectedBtn);
    
    // Add new event listener
    newSkipSelectedBtn.addEventListener('click', () => {
      // Find selected contacts
      const selectedContacts = validContacts.filter(c => c._selected);
      
      if (selectedContacts.length === 0) {
        showNotification('No Contacts Selected', 'Please select contacts to skip', 'warning');
        return;
      }
      
      // Confirm action
      if (!confirm(`Are you sure you want to skip ${selectedContacts.length} selected contacts?`)) {
        return;
      }
      
      // Move selected contacts to skipped
      let duplicatesSkipped = 0;
      selectedContacts.forEach(contact => {
        // Find and remove from valid contacts
        const index = validContacts.findIndex(c => c._index === contact._index);
        if (index !== -1) {
          validContacts.splice(index, 1);
          
          // Update reason and status
          contact._selected = false;
          contact._skipReason = 'Manually skipped';
          contact._status = 'skipped';
          
          // Add to skipped
          skippedContacts.push(contact);
          
          // Count if it was a duplicate
          if (contact._isDuplicate) {
            duplicatesSkipped++;
          }
        }
      });
      
      // Update stats
      document.getElementById('preview-valid-count').textContent = validContacts.length;
      document.getElementById('preview-issues-count').textContent = parseInt(document.getElementById('preview-issues-count').textContent) + selectedContacts.length - duplicatesSkipped;
      
      // Update pagination state
      validContactsState.totalPages = Math.ceil(validContacts.length / validContactsState.pageSize);
      skippedContactsState.totalPages = Math.ceil(skippedContacts.length / skippedContactsState.pageSize);
      
      // Re-render tables
      renderValidContactsTable(Math.min(validContactsState.currentPage, validContactsState.totalPages || 1));
      renderSkippedContactsTable(1);
      
      // Update selected count
      updateSelectedCount(validContacts);
      
      // Show notification
      showNotification('Contacts Skipped', `${selectedContacts.length} contacts moved to skipped list`, 'success');
    });
  }
  
  // Skip duplicates button
  const skipDuplicatesBtn = document.getElementById('skip-duplicates-preview');
  if (skipDuplicatesBtn) {
    // Remove existing event listeners
    const newSkipDuplicatesBtn = skipDuplicatesBtn.cloneNode(true);
    skipDuplicatesBtn.parentNode.replaceChild(newSkipDuplicatesBtn, skipDuplicatesBtn);
    
    // Add new event listener
    newSkipDuplicatesBtn.addEventListener('click', () => {
      // Find duplicates
      const duplicateContacts = validContacts.filter(c => c._isDuplicate);
      
      if (duplicateContacts.length === 0) {
        showNotification('No Duplicates', 'There are no duplicate contacts to skip', 'info');
        return;
      }
      
      // Confirm action
      if (!confirm(`Are you sure you want to skip all ${duplicateContacts.length} duplicate contacts?`)) {
        return;
      }
      
      // Move duplicate contacts to skipped
      duplicateContacts.forEach(contact => {
        // Find and remove from valid contacts
        const index = validContacts.findIndex(c => c._index === contact._index);
        if (index !== -1) {
          validContacts.splice(index, 1);
          
          // Update reason and status
          contact._selected = false;
          contact._skipReason = 'Duplicate phone number (auto-skipped)';
          contact._status = 'duplicate-file';
          
          // Add to skipped
          skippedContacts.push(contact);
        }
      });
      
      // Update stats
      document.getElementById('preview-valid-count').textContent = validContacts.length;
      document.getElementById('preview-duplicates-count').textContent = parseInt(document.getElementById('preview-duplicates-count').textContent);
      
      // Update pagination state
      validContactsState.totalPages = Math.ceil(validContacts.length / validContactsState.pageSize);
      skippedContactsState.totalPages = Math.ceil(skippedContacts.length / skippedContactsState.pageSize);
      
      // Re-render tables
      renderValidContactsTable(Math.min(validContactsState.currentPage, validContactsState.totalPages || 1));
      renderSkippedContactsTable(1);
      
      // Update selected count
      updateSelectedCount(validContacts);
      
      // Show notification
      showNotification('Duplicates Skipped', `${duplicateContacts.length} duplicate contacts moved to skipped list`, 'success');
    });
  }
  
  // Skip all button
  const skipAllBtn = document.getElementById('skip-all-preview');
  if (skipAllBtn) {
    // Remove existing event listeners
    const newSkipAllBtn = skipAllBtn.cloneNode(true);
    skipAllBtn.parentNode.replaceChild(newSkipAllBtn, skipAllBtn);
    
    // Add new event listener
    newSkipAllBtn.addEventListener('click', () => {
      if (validContacts.length === 0) {
        showNotification('No Contacts', 'There are no contacts to skip', 'warning');
        return;
      }
      
      // Confirm action
      if (!confirm(`Are you sure you want to skip ALL ${validContacts.length} contacts? This will move everything to the skipped list.`)) {
        return;
      }
      
      // Move all contacts to skipped
      while (validContacts.length > 0) {
        const contact = validContacts.pop();
        contact._selected = false;
        contact._skipReason = 'Manually skipped (skip all)';
        contact._status = 'skipped';
        skippedContacts.push(contact);
      }
      
      // Update stats
      document.getElementById('preview-valid-count').textContent = '0';
      document.getElementById('preview-issues-count').textContent = parseInt(document.getElementById('preview-issues-count').textContent) + skippedContacts.length;
      
      // Update pagination state
      validContactsState.totalPages = 0;
      skippedContactsState.totalPages = Math.ceil(skippedContacts.length / skippedContactsState.pageSize);
      
      // Re-render tables
      renderValidContactsTable(1);
      renderSkippedContactsTable(1);
      
      // Update selected count
      updateSelectedCount(validContacts);
      
      // Show notification
      showNotification('All Contacts Skipped', 'All contacts have been moved to the skipped list', 'success');
    });
  }
  
  // Complete import button
  const completeImportBtn = document.getElementById('complete-import');
  if (completeImportBtn) {
    // Remove existing event listeners
    const newCompleteImportBtn = completeImportBtn.cloneNode(true);
    completeImportBtn.parentNode.replaceChild(newCompleteImportBtn, completeImportBtn);
    
    // Add new event listener
    newCompleteImportBtn.addEventListener('click', async () => {
      try {
        // Get selected contacts
        const selectedContacts = validContacts.filter(c => c._selected);
        
        if (selectedContacts.length === 0) {
          showNotification('No Contacts Selected', 'Please select at least one contact to import', 'warning');
          return;
        }
        
        // Confirm import for large datasets
        if (selectedContacts.length > 1000) {
          if (!confirm(`You are about to import ${selectedContacts.length} contacts. This might take some time. Continue?`)) {
            return;
          }
        }
        
        // Clean up contacts for import (remove internal properties)
        const cleanContacts = selectedContacts.map(({ _index, _status, _selected, _skipReason, _isDuplicate, ...contact }) => ({
          ...contact,
          source: contact.source || getBaseName(filePath)
        }));
        
        // Close the preview modal
        previewModal.style.display = 'none';
        
        // Show loading notification
        showNotification('Importing Contacts', `Importing ${cleanContacts.length} contacts...`, 'info');
        
        // Create progress dialog
        const progressDialog = document.createElement('div');
        progressDialog.className = 'progress-dialog';
        progressDialog.innerHTML = `
          <div class="progress-content">
            <h3>Importing Contacts</h3>
            <p>Importing <span id="import-count">${cleanContacts.length}</span> contacts...</p>
            <div class="progress-bar-container">
              <div id="import-progress-bar" class="progress-bar" style="width: 0%"></div>
            </div>
            <p id="import-status">0% complete</p>
          </div>
        `;
        document.body.appendChild(progressDialog);
        
        // Set up progress handler
        const progressListener = (event, progress) => {
          const percent = Math.round((progress.imported + progress.duplicates + progress.errors) / progress.total * 100);
          const progressBar = document.getElementById('import-progress-bar');
          const statusText = document.getElementById('import-status');
          
          if (progressBar) progressBar.style.width = `${percent}%`;
          if (statusText) {
            statusText.textContent = `${percent}% complete (${progress.imported} imported, ${progress.duplicates} duplicates, ${progress.errors} errors)`;
          }
        };
        
        if (window.api && window.api.on) {
          window.api.on('import-progress', progressListener);
        }
        
        try {
          // Start import
          const result = await api.importContactsFromData(cleanContacts, filePath);
          
          // Remove progress dialog
          document.body.removeChild(progressDialog);
          
          // Remove progress listener
          if (window.api && window.api.removeAllListeners) {
            window.api.removeAllListeners('import-progress');
          }
          
          // Show success notification
          showNotification(
            'Import Complete',
            `Successfully imported ${result.imported} contacts. ${result.duplicates > 0 ? `${result.duplicates} duplicates skipped.` : ''} ${result.errors > 0 ? `${result.errors} errors.` : ''}`,
            result.errors > 0 ? 'warning' : 'success'
          );
          
          // Reload contacts
          loadContactsPaginated();
        } catch (error) {
          // Remove progress dialog in case of error
          document.body.removeChild(progressDialog);
          
          // Remove progress listener
          if (window.api && window.api.removeAllListeners) {
            window.api.removeAllListeners('import-progress');
          }
          
          console.error('Error during import:', error);
          showNotification('Error', 'Failed to import contacts: ' + error.message, 'error');
        }
      } catch (error) {
        console.error('Error completing import:', error);
        showNotification('Error', 'Failed to complete import: ' + error.message, 'error');
      }
    });
  }
  
  // Close buttons
  const closeButtons = previewModal.querySelectorAll('.close-modal');
  closeButtons.forEach(button => {
    // Remove existing event listeners
    const newCloseButton = button.cloneNode(true);
    button.parentNode.replaceChild(newCloseButton, button);
    
    newCloseButton.addEventListener('click', () => {
      previewModal.style.display = 'none';
    });
  });
  
  // Back button
  const backButton = document.getElementById('back-to-import');
  if (backButton) {
    // Remove existing event listeners
    const newBackButton = backButton.cloneNode(true);
    backButton.parentNode.replaceChild(newBackButton, backButton);
    
    newBackButton.addEventListener('click', () => {
      previewModal.style.display = 'none';
      
      const importModal = document.getElementById('import-modal');
      if (importModal) {
        importModal.style.display = 'block';
      }
    });
  }
  
  // Outside click to close
  window.onclick = function(event) {
    if (event.target === previewModal) {
      previewModal.style.display = 'none';
    }
  };
}

/**
 * Update the selected contacts count in the import preview
 * @param {Array} validContacts - Array of valid contacts
 */
function updateSelectedCount(validContacts) {
  const selectedCount = validContacts.filter(c => c._selected).length;
  const selectedCountElement = document.getElementById('selected-for-import-count');
  if (selectedCountElement) {
    selectedCountElement.textContent = selectedCount;
  }
}

// Export contacts module functions
export {
  initContacts,
  loadContactsPaginated,
  openContactModal,
  saveContact,
  openImportModal,
  browseFile,
  importContacts,
  deleteSelectedContacts,
  showImportPreview,
  setupPreviewEventListeners,
  updateSelectedCount
}; 