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
    
    // Update dashboard contacts count
    updateDashboardContactsCount();
    
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
 * Update the contacts count in the dashboard
 */
async function updateDashboardContactsCount() {
  try {
    const response = await api.getContactsCount();
    const totalContactsElement = document.getElementById('total-contacts');
    if (totalContactsElement) {
      totalContactsElement.textContent = response.count;
    }
  } catch (error) {
    console.error('Error updating dashboard contacts count:', error);
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
  
  // Export buttons
  setupExportButtons();
}

/**
 * Set up export buttons for contacts
 */
function setupExportButtons() {
  // Add export buttons to the action bar if they don't exist
  const actionBar = document.querySelector('#contacts .action-bar');
  if (!actionBar) return;
  
  // Check if export buttons already exist
  if (!document.getElementById('export-json')) {
    // Create export JSON button
    const exportJsonBtn = document.createElement('button');
    exportJsonBtn.id = 'export-json';
    exportJsonBtn.className = 'secondary-btn';
    exportJsonBtn.innerHTML = '<i class="fas fa-file-export"></i> Export JSON';
    exportJsonBtn.addEventListener('click', exportContactsAsJSON);
    actionBar.appendChild(exportJsonBtn);
    
    // Create export CSV button
    const exportCsvBtn = document.createElement('button');
    exportCsvBtn.id = 'export-csv';
    exportCsvBtn.className = 'secondary-btn';
    exportCsvBtn.innerHTML = '<i class="fas fa-file-csv"></i> Export CSV';
    exportCsvBtn.addEventListener('click', exportContactsAsCSV);
    actionBar.appendChild(exportCsvBtn);
    
    // Create export Excel button
    const exportExcelBtn = document.createElement('button');
    exportExcelBtn.id = 'export-excel';
    exportExcelBtn.className = 'secondary-btn';
    exportExcelBtn.innerHTML = '<i class="fas fa-file-excel"></i> Export Excel';
    exportExcelBtn.addEventListener('click', exportContactsAsExcel);
    actionBar.appendChild(exportExcelBtn);
  }
}

/**
 * Export contacts as JSON
 */
async function exportContactsAsJSON() {
  try {
    showNotification('Info', 'Preparing JSON export...', 'info');
    const response = await api.exportContacts('json');
    if (response.success) {
      showNotification('Success', `Contacts exported to ${response.filePath}`, 'success');
    } else {
      showNotification('Error', 'Failed to export contacts', 'error');
    }
  } catch (error) {
    console.error('Error exporting contacts as JSON:', error);
    showNotification('Error', 'Failed to export contacts: ' + error.message, 'error');
  }
}

/**
 * Export contacts as CSV
 */
async function exportContactsAsCSV() {
  try {
    showNotification('Info', 'Preparing CSV export...', 'info');
    const response = await api.exportContacts('csv');
    if (response.success) {
      showNotification('Success', `Contacts exported to ${response.filePath}`, 'success');
    } else {
      showNotification('Error', 'Failed to export contacts', 'error');
    }
  } catch (error) {
    console.error('Error exporting contacts as CSV:', error);
    showNotification('Error', 'Failed to export contacts: ' + error.message, 'error');
  }
}

/**
 * Export contacts as Excel
 */
async function exportContactsAsExcel() {
  try {
    showNotification('Info', 'Preparing Excel export...', 'info');
    const response = await api.exportContacts('excel');
    if (response.success) {
      showNotification('Success', `Contacts exported to ${response.filePath}`, 'success');
    } else {
      showNotification('Error', 'Failed to export contacts', 'error');
    }
  } catch (error) {
    console.error('Error exporting contacts as Excel:', error);
    showNotification('Error', 'Failed to export contacts: ' + error.message, 'error');
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
    tableBody.innerHTML = '<tr><td colspan="7" class="text-center">No contacts available. Import contacts or add a new contact.</td></tr>';
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
      <td>${contact.name || '-'}</td>
      <td>${contact.surname || '-'}</td>
      <td>${contact.phoneNumber || '-'}</td>
      <td>${contact.email || '-'}</td>
      <td>${contact.source || 'Added manually'}</td>
      <td>
        <button class="action-btn edit-btn" data-id="${contact.id}" title="Edit Contact">
          <i class="fas fa-edit"></i>
        </button>
        <button class="action-btn delete-btn" data-id="${contact.id}" title="Delete Contact">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    `;
    
    tableBody.appendChild(row);
  });
  
  // Add event listeners to action buttons
  tableBody.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const contactId = btn.getAttribute('data-id');
      openContactModal(contactId);
    });
  });
  
  tableBody.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const contactId = btn.getAttribute('data-id');
      deleteContact(contactId);
    });
  });
  
  // Add event listeners to checkboxes
  tableBody.querySelectorAll('.contact-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const contactId = checkbox.getAttribute('data-id');
      
      if (e.target.checked) {
        selectedContactIds.add(contactId);
      } else {
        selectedContactIds.delete(contactId);
        
        // Uncheck "select all" checkbox if any individual checkbox is unchecked
        const selectAllCheckbox = document.getElementById('select-all-contacts');
        if (selectAllCheckbox && selectAllCheckbox.checked) {
          selectAllCheckbox.checked = false;
          allContactsSelected = false;
      }
      }
      
      updateDeleteSelectedButton();
    });
  });
  
  // Add pagination
  addOptimizedPagination(pagination);
}

/**
 * Add optimized pagination controls
 * @param {Object} pagination - Pagination information
 */
function addOptimizedPagination(pagination) {
  const paginationContainer = document.querySelector('#contacts .pagination-container');
  
  // Create pagination container if it doesn't exist
  if (!paginationContainer) {
    const container = document.createElement('div');
    container.className = 'pagination-container';
    
    const contactsSection = document.getElementById('contacts');
    if (contactsSection) {
      contactsSection.appendChild(container);
    }
  }
  
  // Get or create pagination container
  const paginationElement = document.querySelector('#contacts .pagination-container');
  if (!paginationElement) return;
  
  // Clear existing pagination
  paginationElement.innerHTML = '';
  
  // If there's only one page, don't show pagination
  if (pagination.totalPages <= 1) return;
  
  // Create pagination info
  const paginationInfo = document.createElement('div');
  paginationInfo.className = 'pagination-info';
  paginationInfo.textContent = `Showing ${pagination.from}-${pagination.to} of ${pagination.total} contacts`;
  
  // Create pagination controls
  const paginationControls = document.createElement('div');
  paginationControls.className = 'pagination-controls';
  
  // Previous button
  const prevButton = document.createElement('button');
  prevButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
  prevButton.disabled = pagination.currentPage === 1;
  prevButton.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadContactsPaginated();
    }
  });
  
  // Next button
  const nextButton = document.createElement('button');
  nextButton.innerHTML = '<i class="fas fa-chevron-right"></i>';
  nextButton.disabled = pagination.currentPage === pagination.totalPages;
  nextButton.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      loadContactsPaginated();
    }
  });
  
  // Page indicator
  const pageIndicator = document.createElement('span');
  pageIndicator.className = 'page-indicator';
  pageIndicator.textContent = `Page ${pagination.currentPage} of ${pagination.totalPages}`;
  
  // Assemble pagination controls
  paginationControls.appendChild(prevButton);
  paginationControls.appendChild(pageIndicator);
  paginationControls.appendChild(nextButton);
  
  // Add to pagination container
  paginationElement.appendChild(paginationInfo);
  paginationElement.appendChild(paginationControls);
}

/**
 * Update the state of the delete selected button
 */
function updateDeleteSelectedButton() {
  const deleteSelectedButton = document.getElementById('delete-selected-contacts');
  if (deleteSelectedButton) {
    if (selectedContactIds.size > 0 || allContactsSelected) {
      deleteSelectedButton.disabled = false;
    
      // Update button text to show count
      if (allContactsSelected) {
        deleteSelectedButton.innerHTML = `<i class="fas fa-trash"></i> Delete All (${totalContacts})`;
      } else {
        deleteSelectedButton.innerHTML = `<i class="fas fa-trash"></i> Delete Selected (${selectedContactIds.size})`;
      }
    } else {
      deleteSelectedButton.disabled = true;
      deleteSelectedButton.innerHTML = '<i class="fas fa-trash"></i> Delete Selected';
    }
  }
}

/**
 * Open the contact modal for adding or editing a contact
 * @param {string|null} id - The contact ID to edit, or null for a new contact
 */
async function openContactModal(id = null) {
    const modal = document.getElementById('contact-modal');
    const modalTitle = document.getElementById('contact-modal-title');
    const form = document.getElementById('contact-form');
    const saveButton = document.getElementById('save-contact');
    
    // Reset form
    form.reset();
  
    // Set modal title and contact ID
    if (id) {
        modalTitle.textContent = 'Edit Contact';
        document.getElementById('contact-id').value = id;
    
        try {
            // Get contact details
            const response = await api.getContact(id);
            let contact;
            
            // Handle different response formats
            if (response && response.success === true && response.contact) {
                // Format: { success: true, contact: {...} }
                contact = response.contact;
            } else if (response && response.id) {
                // Format: direct contact object
                contact = response;
            } else {
                // Invalid response format
                console.error('Invalid contact response format:', response);
                showNotification('Error', 'Failed to load contact details: Invalid response format', 'error');
                return;
            }
            
            // Fill form with contact details
            document.getElementById('contact-name').value = contact.name || '';
            document.getElementById('contact-surname').value = contact.surname || '';
            document.getElementById('contact-phone').value = contact.phoneNumber || '';
            document.getElementById('contact-email').value = contact.email || '';
            document.getElementById('contact-birthday').value = contact.birthday || '';
            document.getElementById('contact-source').value = contact.source || 'Added manually';
            document.getElementById('contact-notes').value = contact.notes || '';
        } catch (error) {
            console.error('Error loading contact details:', error);
            showNotification('Error', 'Failed to load contact details: ' + error.message, 'error');
        }
    } else {
        modalTitle.textContent = 'Add Contact';
        document.getElementById('contact-id').value = '';
        document.getElementById('contact-source').value = 'Added manually';
    }
  
    // Clear any previous error messages
    const phoneError = document.getElementById('phone-error');
    if (phoneError) {
        phoneError.style.display = 'none';
        phoneError.textContent = '';
    }
    
    // Show modal
    modal.style.display = 'block';
    
    // Set up event listeners for the modal
    setupContactModalEventListeners();
}

/**
 * Set up event listeners for the contact modal
 */
function setupContactModalEventListeners() {
  const modal = document.getElementById('contact-modal');
    const closeButtons = modal.querySelectorAll('.close-modal');
  const saveButton = document.getElementById('save-contact');
  const form = document.getElementById('contact-form');
  
  // Close modal when clicking close button or outside the modal
  closeButtons.forEach(button => {
    button.onclick = () => {
        modal.style.display = 'none';
    };
  });
  
  // Close modal when clicking outside the modal content
  window.onclick = (event) => {
      if (event.target === modal) {
        modal.style.display = 'none';
      }
    };
  
  // Save contact when clicking save button
  saveButton.onclick = saveContact;
  
  // Prevent form submission (we handle it with the save button)
  form.onsubmit = (e) => {
    e.preventDefault();
    saveContact();
  };
  
  // Focus on first input field
  setTimeout(() => {
    const firstInput = form.querySelector('input:not([type="hidden"])');
    if (firstInput) firstInput.focus();
  }, 100);
}

/**
 * Save contact (create or update)
 */
async function saveContact() {
  try {
    const contactId = document.getElementById('contact-id').value;
    const phoneInput = document.getElementById('contact-phone');
    const phoneError = document.getElementById('phone-error');
    
    const contactData = {
      name: document.getElementById('contact-name').value.trim(),
      surname: document.getElementById('contact-surname').value.trim(),
      phoneNumber: phoneInput.value.trim(),
      email: document.getElementById('contact-email').value.trim(),
      birthday: document.getElementById('contact-birthday').value,
      source: document.getElementById('contact-source').value,
      notes: document.getElementById('contact-notes').value.trim()
    };
    
    // Validate phone number (required)
    if (!contactData.phoneNumber) {
      phoneError.textContent = 'Phone number is required';
      phoneError.style.display = 'block';
      phoneInput.focus();
      return;
    }
    
    // Format phone number
    contactData.phoneNumber = formatPhoneNumber(contactData.phoneNumber);
    
    // Check for duplicate phone number
    try {
      const response = await api.checkDuplicatePhone(contactData.phoneNumber, contactId);
      if (response && response.isDuplicate) {
        phoneError.textContent = 'A contact with this phone number already exists';
        phoneError.style.display = 'block';
        phoneInput.focus();
        return;
      }
    } catch (error) {
      console.error('Error checking duplicate phone:', error);
    }
    
    // Create or update contact
    let response;
    let success = false;
    
    if (contactId) {
      // Update existing contact
      response = await api.updateContact(contactId, contactData);
      success = !!response; // If response exists, it was successful
    } else {
      // Create new contact
      response = await api.createContact(contactData);
      success = response && (response.success !== false); // Check success field or assume true if exists
    }
    
    // Check if the response was successful
    if (success) {
      // Close modal
      document.getElementById('contact-modal').style.display = 'none';
      
      // Show success notification
      showNotification(
        'Success', 
        contactId ? 'Contact updated successfully' : 'Contact created successfully',
        'success'
      );
      
      // Reload contacts
      await loadContactsPaginated();
      
      // Update dashboard contacts count
      updateDashboardContactsCount();
    } else {
      // Show error message
      const errorMessage = response && response.error ? response.error : 'Failed to save contact';
      
      if (response && response.code === 'DUPLICATE_PHONE') {
        phoneError.textContent = 'A contact with this phone number already exists';
        phoneError.style.display = 'block';
        phoneInput.focus();
      } else {
        showNotification('Error', errorMessage, 'error');
      }
    }
  } catch (error) {
    console.error('Error saving contact:', error);
    showNotification('Error', 'Failed to save contact: ' + error.message, 'error');
  }
}

/**
 * Delete a contact
 * @param {string} id - The contact ID to delete
 */
async function deleteContact(id) {
  try {
    // Confirm deletion
    if (!confirm('Are you sure you want to delete this contact?')) {
        return;
    }
    
    const response = await api.deleteContact(id);
    
    if (response.success) {
      showNotification('Success', 'Contact deleted successfully', 'success');
      
      // Remove from selected contacts if it was selected
      selectedContactIds.delete(id);
      
      // Reload contacts
      await loadContactsPaginated();
      
      // Update dashboard contacts count
      updateDashboardContactsCount();
      } else {
      showNotification('Error', response.message || 'Failed to delete contact', 'error');
    }
  } catch (error) {
    console.error('Error deleting contact:', error);
    showNotification('Error', 'Failed to delete contact: ' + error.message, 'error');
  }
}

/**
 * Delete selected contacts
 */
async function deleteSelectedContacts() {
  try {
    // If no contacts selected, do nothing
    if (selectedContactIds.size === 0 && !allContactsSelected) {
        return;
    }
    
    // Confirm deletion
    let confirmMessage = 'Are you sure you want to delete ';
    if (allContactsSelected) {
      confirmMessage += `all ${totalContacts} contacts?`;
      } else {
      confirmMessage += `${selectedContactIds.size} selected contact${selectedContactIds.size !== 1 ? 's' : ''}?`;
    }
    
    if (!confirm(confirmMessage)) {
      return;
    }
    
    // Show notification
    showNotification('Info', 'Deleting contacts...', 'info');
    
    // Delete contacts
    let response;
    if (allContactsSelected) {
      response = await api.deleteAllContacts();
    } else {
      response = await api.deleteContacts(Array.from(selectedContactIds));
    }
    
    if (response.success) {
      showNotification('Success', 'Contacts deleted successfully', 'success');
      
      // Clear selected contacts
      selectedContactIds.clear();
      allContactsSelected = false;
    
    // Reload contacts
      await loadContactsPaginated();
      
      // Update dashboard contacts count
      updateDashboardContactsCount();
    } else {
      showNotification('Error', response.message || 'Failed to delete contacts', 'error');
    }
  } catch (error) {
    console.error('Error deleting contacts:', error);
    showNotification('Error', 'Failed to delete contacts: ' + error.message, 'error');
  }
}

/**
 * Rebuild the contacts table if it doesn't exist
 */
function rebuildContactsTable() {
  console.log('Rebuilding contacts table...');
  
  const contactsSection = document.getElementById('contacts');
  if (!contactsSection) {
    console.error('Contacts section not found');
    return;
  }
  
  // Check if table container exists
  let tableContainer = contactsSection.querySelector('.contacts-table-container');
  if (!tableContainer) {
    // Create table container
    tableContainer = document.createElement('div');
    tableContainer.className = 'contacts-table-container';
    contactsSection.appendChild(tableContainer);
  }
  
  // Create table
  const table = document.createElement('table');
  table.className = 'data-table';
  table.id = 'contacts-table';
  
  // Create table header
  table.innerHTML = `
    <thead>
    <tr>
      <th><input type="checkbox" id="select-all-contacts"></th>
      <th>Name</th>
      <th>Surname</th>
      <th>Phone Number</th>
      <th>Email</th>
      <th>Source</th>
      <th>Actions</th>
    </tr>
    </thead>
    <tbody>
      <tr>
        <td colspan="7" class="text-center">Loading contacts...</td>
      </tr>
    </tbody>
  `;
  
  // Add table to container
  tableContainer.innerHTML = '';
  tableContainer.appendChild(table);
  
  // Create pagination container
  const paginationContainer = document.createElement('div');
  paginationContainer.className = 'pagination-container';
  contactsSection.appendChild(paginationContainer);
  
  // Set up event listeners
  setupContactsEventListeners();
  
  // Load contacts
  loadContactsPaginated();
}

/**
 * Open the import contacts modal
 */
async function openImportModal() {
  try {
    // Show the import modal
  const modal = document.getElementById('import-modal');
  if (!modal) {
      console.error('Import modal not found in the DOM');
      // Create the import modal if it doesn't exist
      createImportModal();
    return;
  }
  
    // Reset the import form
  const importForm = document.getElementById('import-form');
  if (importForm) {
    importForm.reset();
  }
  
    // Clear any previous error messages
    const errorContainer = document.getElementById('import-error');
    if (errorContainer) {
      errorContainer.style.display = 'none';
      errorContainer.textContent = '';
    }
    
    // Clear any previous file info
    const fileInfo = document.getElementById('selected-file-info');
    if (fileInfo) {
      fileInfo.textContent = '';
      fileInfo.style.display = 'none';
    }
    
    // Show the modal
  modal.style.display = 'block';
  
    // Set up event listeners for the modal
    setupImportModalEventListeners();
  } catch (error) {
    console.error('Error opening import modal:', error);
    showNotification('Error', 'Failed to open import modal: ' + error.message, 'error');
  }
}

/**
 * Create the import modal if it doesn't exist
 */
function createImportModal() {
  // Create the modal
  const modal = document.createElement('div');
  modal.id = 'import-modal';
  modal.className = 'modal';
  
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>Import Contacts</h2>
        <span class="close-modal">&times;</span>
      </div>
      <div class="modal-body">
        <p>Select a file to import contacts. Supported file types: CSV, Excel, JSON.</p>
        
        <form id="import-form">
          <div class="form-group">
            <label for="import-file-path">File:</label>
            <div class="file-input-container">
              <input type="text" id="import-file-path" readonly placeholder="No file selected">
              <button type="button" id="browse-file" class="secondary-btn">Browse</button>
            </div>
          </div>
          
          <div id="selected-file-info" class="file-info" style="display: none;"></div>
          
          <div id="import-error" class="error-message" style="display: none;"></div>
        </form>
        
        <div class="import-progress" style="display: none;">
          <div class="progress-container">
            <div id="import-progress-bar" class="progress-bar"></div>
          </div>
          <div id="import-progress-text" class="progress-text">Processing...</div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="secondary-btn close-modal">Cancel</button>
        <button type="button" id="start-import" class="primary-btn"><i class="fas fa-file-import"></i> Next: Preview Contacts</button>
      </div>
    </div>
  `;
  
  // Add to document
  document.body.appendChild(modal);
  
  // Show the modal
  modal.style.display = 'block';
  
  // Set up event listeners
  setupImportModalEventListeners();
}

/**
 * Set up event listeners for the import modal
 */
function setupImportModalEventListeners() {
  const modal = document.getElementById('import-modal');
  if (!modal) return;
  
  const closeButtons = modal.querySelectorAll('.close-modal');
  const importForm = document.getElementById('import-form');
  const fileInput = document.getElementById('import-file-path');
  const browseButton = document.getElementById('browse-file');
  const importButton = document.getElementById('start-import');
  
  // Close modal when clicking close button
  closeButtons.forEach(button => {
    button.onclick = () => {
      modal.style.display = 'none';
    };
  });
  
  // Close modal when clicking outside the modal content
  window.onclick = (event) => {
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  };
  
  // Handle browse button click
  if (browseButton) {
    browseButton.onclick = async () => {
      try {
    const result = await api.showFileDialog({
          title: 'Select Contacts File',
      filters: [
            { name: 'Contact Files', extensions: ['csv', 'xlsx', 'xls', 'json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
        if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
          
          // Make sure fileInput exists before trying to set its value
          if (fileInput) {
            fileInput.value = filePath;
            
            // Show file info
            const fileInfo = document.getElementById('selected-file-info');
            if (fileInfo) {
              const fileName = getBaseName(filePath);
              fileInfo.textContent = `Selected file: ${fileName}`;
              fileInfo.style.display = 'block';
            }
          } else {
            console.error('File input element not found (import-file-path)');
            showNotification('Error', 'File input element not found in the form', 'error');
          }
    }
  } catch (error) {
        console.error('Error selecting file:', error);
        showNotification('Error', 'Failed to select file: ' + error.message, 'error');
      }
    };
  }
  
  // Handle import button click
  if (importButton) {
    importButton.onclick = async () => {
      try {
        // Check if fileInput exists before accessing its value
        if (!fileInput) {
          console.error('File input element not found (import-file-path)');
          showNotification('Error', 'File input element not found in the form', 'error');
          return;
        }
        
        const filePath = fileInput.value ? fileInput.value.trim() : '';
        if (!filePath) {
          const errorContainer = document.getElementById('import-error');
          if (errorContainer) {
            errorContainer.textContent = 'Please select a file to import';
            errorContainer.style.display = 'block';
          }
      return;
    }
    
        // Get file extension
        const fileExtension = filePath.split('.').pop().toLowerCase();
        let fileType;
        
        switch (fileExtension) {
          case 'csv':
            fileType = 'csv';
            break;
          case 'xlsx':
          case 'xls':
            fileType = 'xlsx';
            break;
          case 'json':
            fileType = 'json';
            break;
          default:
            const errorContainer = document.getElementById('import-error');
            if (errorContainer) {
              errorContainer.textContent = 'Unsupported file type. Please select a CSV, Excel, or JSON file.';
              errorContainer.style.display = 'block';
            }
      return;
    }
    
        // Show loading state
        importButton.disabled = true;
        importButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Parsing...';
        
        // Parse the file first to show preview
    try {
      // Parse contacts from file
          const response = await api.parseContactsFile(filePath, fileType);
          
          if (response && response.success) {
            // Hide the import modal
            modal.style.display = 'none';
            
            // Process contacts for preview
            const contacts = await prepareContactsForPreview(response.contacts, getBaseName(filePath));
            
            // Show preview modal
            showImportPreview(contacts);
          } else {
            // Show error message
            const errorContainer = document.getElementById('import-error');
            if (errorContainer) {
              errorContainer.textContent = (response && response.error) ? response.error : 'Failed to parse contacts file';
              errorContainer.style.display = 'block';
            }
          }
    } catch (error) {
      console.error('Error parsing contacts file:', error);
          const errorContainer = document.getElementById('import-error');
          if (errorContainer) {
            errorContainer.textContent = 'Failed to parse contacts file: ' + error.message;
            errorContainer.style.display = 'block';
          }
        }
        
        // Reset button state
        importButton.disabled = false;
        importButton.innerHTML = '<i class="fas fa-file-import"></i> Next: Preview Contacts';
  } catch (error) {
    console.error('Error importing contacts:', error);
        
        // Reset button state
        if (importButton) {
          importButton.disabled = false;
          importButton.innerHTML = '<i class="fas fa-file-import"></i> Next: Preview Contacts';
        }
        
        // Show error message
        const errorContainer = document.getElementById('import-error');
        if (errorContainer) {
          errorContainer.textContent = 'Failed to import contacts: ' + error.message;
          errorContainer.style.display = 'block';
        }
      }
    };
  }
  
  // Set up progress event listener
  api.on('import-progress', (progress) => {
    updateImportProgress(progress);
  });
}

/**
 * Update the import progress bar and status
 * @param {Object} progress - Progress information
 */
function updateImportProgress(progress) {
  const progressBar = document.getElementById('import-progress-bar');
  const progressText = document.getElementById('import-progress-text');
  
  if (progressBar && progressText) {
    // Calculate percentage
    const percent = Math.round((progress.current / progress.total) * 100);
    
    // Update progress bar
    progressBar.style.width = `${percent}%`;
    
    // Update progress text
    progressText.textContent = `Processing ${progress.current} of ${progress.total} contacts (${percent}%)`;
  }
}

/**
 * Prepare contacts for preview by validating them
 * @param {Array} contacts - Raw contacts from file
 * @param {string} source - Source name
 * @returns {Array} - Contacts with validation info
 */
async function prepareContactsForPreview(contacts, source) {
  // First, check for duplicates within the file
  const phoneMap = new Map();
  const duplicatePhones = new Set();
  
  // First pass: identify duplicates within the file
  contacts.forEach(contact => {
    if (contact.phoneNumber && contact.phoneNumber.trim() !== '') {
      const formattedPhone = formatPhoneNumber(contact.phoneNumber);
      if (phoneMap.has(formattedPhone)) {
        duplicatePhones.add(formattedPhone);
      } else {
        phoneMap.set(formattedPhone, contact);
      }
    }
  });
  
  // Second pass: check against database and mark duplicates
  const processedContacts = await Promise.all(contacts.map(async contact => {
    // Format phone if present
    if (contact.phoneNumber && contact.phoneNumber.trim() !== '') {
      contact.phoneNumber = formatPhoneNumber(contact.phoneNumber);
    }
    
    // Set validation status
    let valid = true;
    let error = null;
    let isDuplicate = false;
    
    // Check if phone is missing
    if (!contact.phoneNumber || contact.phoneNumber.trim() === '') {
      valid = false;
      error = 'Missing phone number';
    } else {
      // Check if it's a duplicate within the file
      if (duplicatePhones.has(contact.phoneNumber)) {
        isDuplicate = true;
        error = 'Duplicate phone number in file';
      }
      
      // Check if it exists in database
      try {
        const response = await api.checkDuplicatePhone(contact.phoneNumber);
        if (response && response.isDuplicate) {
          isDuplicate = true;
          error = 'Phone number already in database';
    }
  } catch (error) {
        console.error('Error checking duplicate phone:', error);
      }
    }
    
    // Add source
    contact.source = source || 'Imported';
    
    // Add validation info
    return {
      ...contact,
      valid,
      error,
      isDuplicate,
      skip: false // Flag to mark contacts to skip during import
    };
  }));
  
  return processedContacts;
}

/**
 * Show import preview with pagination
 * @param {Array} contacts - Contacts to preview
 */
function showImportPreview(contacts) {
  // Get the source name from the first contact
  const source = contacts.length > 0 ? contacts[0].source : 'Imported';
  
  // Set up pagination variables
  const PREVIEW_PAGE_SIZE = 100; // Show 100 contacts per page
  let previewPage = 1;
  let previewTotalPages = Math.ceil(contacts.length / PREVIEW_PAGE_SIZE);
  
  // Count valid and invalid contacts
  const validCount = contacts.filter(c => c.valid && !c.skip).length;
  const invalidCount = contacts.filter(c => !c.valid && !c.skip).length;
  const skippedCount = contacts.filter(c => c.skip).length;
  
  // Get the preview modal or create it if it doesn't exist
  let modal = document.getElementById('import-preview-modal');
  
  if (!modal) {
    // Create the modal
    modal = document.createElement('div');
    modal.id = 'import-preview-modal';
    modal.className = 'modal';
    document.body.appendChild(modal);
  }
  
  // Create modal content
  modal.innerHTML = `
    <div class="modal-content import-preview-modal-content">
      <div class="modal-header">
        <h2>Import Preview (${contacts.length.toLocaleString()} contacts)</h2>
        <span class="close-modal">&times;</span>
      </div>
      <div class="modal-body">
        <p>Review your contacts before importing. ${invalidCount > 0 ? '<strong class="error-text">Issues found!</strong>' : ''}</p>
        
        <div class="import-stats-summary">
          <div class="stat-card">
            <div class="stat-value">${contacts.length.toLocaleString()}</div>
            <div class="stat-label">Total Contacts</div>
          </div>
          <div class="stat-card ${validCount > 0 ? 'valid' : ''}">
            <div class="stat-value">${validCount.toLocaleString()}</div>
            <div class="stat-label">Valid</div>
          </div>
          <div class="stat-card ${invalidCount > 0 ? 'invalid' : ''}">
            <div class="stat-value">${invalidCount.toLocaleString()}</div>
            <div class="stat-label">With Issues</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="selected-for-import-count">${validCount.toLocaleString()}</div>
            <div class="stat-label">Selected for Import</div>
          </div>
        </div>
        
        <div class="preview-actions" style="margin-bottom: 15px; display: flex; gap: 10px;">
          <button id="import-all-valid-btn" class="primary-btn" ${validCount === 0 ? 'disabled' : ''}>
            Import All Valid (${validCount.toLocaleString()})
          </button>
          <button id="skip-all-invalid-btn" class="secondary-btn" ${invalidCount === 0 ? 'disabled' : ''}>
            Skip All Invalid (${invalidCount.toLocaleString()})
          </button>
          <button id="back-to-import" class="secondary-btn">
            Back to Import
          </button>
        </div>
        
        <div class="tab-container">
          <div class="tab-header">
            <button class="preview-tab-link active" data-tab="valid-contacts-tab">Valid Contacts</button>
            <button class="preview-tab-link" data-tab="skipped-contacts-tab">Issues & Skipped</button>
          </div>
          
          <div class="tab-content">
            <div id="valid-contacts-tab" class="tab-pane active">
              <div class="preview-table-container" style="max-height: 500px; overflow-y: auto;">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th><input type="checkbox" id="select-all-preview" checked></th>
                      <th>Name</th>
                      <th>Surname</th>
                      <th>Phone Number</th>
                      <th>Email</th>
                      <th>Birthday</th>
                      <th>Source</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody id="preview-valid-tbody">
                    <tr><td colspan="9" class="text-center">Loading preview...</td></tr>
                  </tbody>
                </table>
              </div>
              <div id="valid-contacts-pagination" class="pagination-container"></div>
              <div class="bulk-actions">
                <button id="deselect-all-preview" class="secondary-btn">Deselect All</button>
                <button id="skip-selected-preview" class="secondary-btn">Skip Selected</button>
              </div>
            </div>
            
            <div id="skipped-contacts-tab" class="tab-pane">
              <div class="preview-table-container" style="max-height: 500px; overflow-y: auto;">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th><input type="checkbox" id="select-all-skipped"></th>
                      <th>Name</th>
                      <th>Surname</th>
                      <th>Phone Number</th>
                      <th>Email</th>
                      <th>Birthday</th>
                      <th>Source</th>
                      <th>Issue</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody id="preview-skipped-tbody">
                    <tr><td colspan="9" class="text-center">Loading skipped contacts...</td></tr>
                  </tbody>
                </table>
              </div>
              <div class="bulk-actions">
                <button id="move-to-valid" class="secondary-btn">Move Selected to Valid</button>
              </div>
            </div>
          </div>
        </div>
        
        <div id="large-dataset-warning" class="warning-message" style="display: none;">
          <i class="fas fa-exclamation-triangle"></i>
          <span id="large-dataset-message"></span>
        </div>
      </div>
      <div class="modal-footer">
        <div class="import-stats">
          ${contacts.length.toLocaleString()} contacts found: ${validCount.toLocaleString()} valid, ${invalidCount.toLocaleString()} with issues, ${skippedCount.toLocaleString()} skipped
        </div>
        <div class="import-actions">
          <button id="complete-import" class="primary-btn" ${validCount === 0 ? 'disabled' : ''}>
            Import ${validCount.toLocaleString()} Contacts
          </button>
        </div>
      </div>
    </div>
  `;
  
  // Show the modal
  modal.style.display = 'block';
  
  // Function to update the preview table with current page - using document fragment for performance
  function updatePreviewTable() {
    const tableBody = document.getElementById('preview-valid-tbody');
    if (!tableBody) return;
    
    // Clear existing rows
    tableBody.innerHTML = '';
    
    // Calculate page slice
    const startIdx = (previewPage - 1) * PREVIEW_PAGE_SIZE;
    const endIdx = Math.min(startIdx + PREVIEW_PAGE_SIZE, contacts.length);
    
    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();
    
    // Filter valid contacts that aren't skipped for the current page
    const validContactsForPage = contacts
      .filter(c => c.valid && !c.skip)
      .slice(startIdx, endIdx);
    
    if (validContactsForPage.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = '<td colspan="9" class="text-center">No valid contacts to display</td>';
      fragment.appendChild(emptyRow);
    } else {
      // Add rows for current page
      validContactsForPage.forEach((contact, index) => {
        const actualIndex = contacts.findIndex(c => c === contact);
        const row = document.createElement('tr');
        row.dataset.index = actualIndex;
        
        // Add classes based on contact status
        if (contact.isDuplicate) {
          row.classList.add('duplicate-contact');
        } else if (!contact.phoneNumber || contact.phoneNumber.trim() === '') {
          row.classList.add('missing-phone');
        }
        
        row.innerHTML = `
          <td><input type="checkbox" class="contact-preview-checkbox" data-index="${actualIndex}" checked></td>
          <td>${contact.name || '-'}</td>
          <td>${contact.surname || '-'}</td>
          <td>${contact.phoneNumber || '-'}</td>
          <td>${contact.email || '-'}</td>
          <td>${contact.birthday || '-'}</td>
          <td>${contact.source || '-'}</td>
          <td>
            ${contact.isDuplicate ? 
              '<span class="status-warning">Duplicate Phone</span>' : 
              !contact.phoneNumber || contact.phoneNumber.trim() === '' ?
              '<span class="status-error">Missing Phone</span>' :
              '<span class="status-valid">Valid</span>'}
          </td>
          <td>
            <button class="action-btn edit-preview-btn" data-index="${actualIndex}" title="Edit Contact">
              <i class="fas fa-edit"></i>
            </button>
            <button class="action-btn skip-preview-btn" data-index="${actualIndex}" title="Skip Contact">
              <i class="fas fa-ban"></i>
            </button>
          </td>
        `;
        
        fragment.appendChild(row);
      });
    }
    
    // Append all at once (much faster)
    tableBody.appendChild(fragment);
    
    // Update the skipped contacts tab
    updateSkippedContactsTable();
    
    // Update pagination
    updatePreviewPagination();
  }
  
  // Function to update the skipped contacts table
  function updateSkippedContactsTable() {
    // Get the table body for skipped contacts
      const skippedTableBody = document.getElementById('preview-skipped-tbody');
      if (!skippedTableBody) return;
      
    // Clear existing rows
      skippedTableBody.innerHTML = '';
    
    // Create document fragment for better performance
    const fragment = document.createDocumentFragment();
    
    // Get all invalid or skipped contacts
    const skippedContacts = contacts.filter(c => !c.valid || c.skip);
    
    if (skippedContacts.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = '<td colspan="9" class="text-center">No skipped contacts</td>';
      fragment.appendChild(emptyRow);
    } else {
      // Add rows for all skipped contacts (no pagination for skipped tab)
      skippedContacts.forEach((contact, index) => {
        const originalIndex = contacts.findIndex(c => c === contact);
        const row = document.createElement('tr');
        row.dataset.index = originalIndex;
        
        row.innerHTML = `
          <td><input type="checkbox" class="skipped-preview-checkbox" data-index="${originalIndex}"></td>
          <td>${contact.name || '-'}</td>
          <td>${contact.surname || '-'}</td>
          <td>${contact.phoneNumber || '-'}</td>
          <td>${contact.email || '-'}</td>
          <td>${contact.birthday || '-'}</td>
          <td>${contact.source || '-'}</td>
          <td><span class="status-error">${contact.error || 'Skipped'}</span></td>
          <td>
            <button class="action-btn edit-preview-btn" data-index="${originalIndex}" title="Edit Contact">
              <i class="fas fa-edit"></i>
            </button>
            <button class="action-btn restore-preview-btn" data-index="${originalIndex}" title="Move to Valid">
              <i class="fas fa-undo"></i>
            </button>
          </td>
        `;
        
        fragment.appendChild(row);
      });
    }
    
    // Append all at once
    skippedTableBody.appendChild(fragment);
  }
  
  // Function to update pagination controls
  function updatePreviewPagination() {
    const validPagination = document.getElementById('valid-contacts-pagination');
    if (!validPagination) return;
    
    // Clear existing pagination
    validPagination.innerHTML = '';
    
    // Calculate total pages for valid contacts
    const validContacts = contacts.filter(c => c.valid && !c.skip);
    const totalPages = Math.ceil(validContacts.length / PREVIEW_PAGE_SIZE);
    
    // If only one page, don't show pagination
    if (totalPages <= 1) return;
    
    // Create pagination info
    const paginationInfo = document.createElement('div');
    paginationInfo.className = 'pagination-info';
    
    // Calculate displayed range
    const startItem = (previewPage - 1) * PREVIEW_PAGE_SIZE + 1;
    const endItem = Math.min(previewPage * PREVIEW_PAGE_SIZE, validContacts.length);
    
    paginationInfo.textContent = `Showing ${startItem}-${endItem} of ${validContacts.length} valid contacts`;
    
    // Create pagination controls
    const paginationControls = document.createElement('div');
    paginationControls.className = 'pagination-controls';
      
      // Previous button
      const prevButton = document.createElement('button');
      prevButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
    prevButton.disabled = previewPage === 1;
    prevButton.addEventListener('click', () => {
      if (previewPage > 1) {
        previewPage--;
        updatePreviewTable();
      }
    });
      
      // Next button
      const nextButton = document.createElement('button');
      nextButton.innerHTML = '<i class="fas fa-chevron-right"></i>';
    nextButton.disabled = previewPage === totalPages;
    nextButton.addEventListener('click', () => {
      if (previewPage < totalPages) {
        previewPage++;
        updatePreviewTable();
      }
    });
      
      // Page indicator
      const pageIndicator = document.createElement('span');
    pageIndicator.className = 'page-indicator';
    pageIndicator.textContent = `Page ${previewPage} of ${totalPages}`;
    
    // Assemble pagination controls
    paginationControls.appendChild(prevButton);
    paginationControls.appendChild(pageIndicator);
    paginationControls.appendChild(nextButton);
    
    // Add to pagination container
    validPagination.appendChild(paginationInfo);
    validPagination.appendChild(paginationControls);
  }
  
  // Function to update the selected count
  function updateSelectedCount() {
    const selectedCount = document.querySelectorAll('.contact-preview-checkbox:checked').length;
    document.getElementById('selected-for-import-count').textContent = selectedCount.toLocaleString();
    
    // Update import button state and text
    const importButton = document.getElementById('complete-import');
    if (importButton) {
      importButton.disabled = selectedCount === 0;
      importButton.textContent = `Import ${selectedCount.toLocaleString()} Contacts`;
    }
    
    // Update stats in footer
    const validCount = contacts.filter(c => c.valid && !c.skip).length;
    const invalidCount = contacts.filter(c => !c.valid && !c.skip).length;
    const skippedCount = contacts.filter(c => c.skip).length;
    
    const statsDiv = document.querySelector('.import-stats');
    if (statsDiv) {
      statsDiv.textContent = `${contacts.length.toLocaleString()} contacts found: ${validCount.toLocaleString()} valid, ${invalidCount.toLocaleString()} with issues, ${skippedCount.toLocaleString()} skipped`;
    }
  }
  
  // Function to edit a preview contact
  function editPreviewContact(index) {
    const contact = contacts[index];
    if (!contact) return;
    
    // Create modal for editing
    const editModal = document.createElement('div');
    editModal.className = 'modal';
    editModal.id = 'edit-preview-modal';
    editModal.style.display = 'block';
    editModal.style.zIndex = '1100';
    
    editModal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>Edit Contact</h2>
          <span class="close-modal">&times;</span>
        </div>
        <div class="modal-body">
          <form id="edit-preview-form">
            <input type="hidden" id="edit-preview-index" value="${index}">
            <div class="form-group">
              <label for="edit-preview-name">Name:</label>
              <input type="text" id="edit-preview-name" value="${contact.name || ''}">
            </div>
            <div class="form-group">
              <label for="edit-preview-surname">Surname:</label>
              <input type="text" id="edit-preview-surname" value="${contact.surname || ''}">
            </div>
            <div class="form-group">
              <label for="edit-preview-phone">Phone Number: <span class="required">*</span></label>
              <input type="text" id="edit-preview-phone" value="${contact.phoneNumber || ''}" required>
              <small>International format with country code, e.g., +1234567890</small>
              <div id="edit-preview-phone-error" class="error-message" style="display: none;"></div>
            </div>
            <div class="form-group">
              <label for="edit-preview-email">Email:</label>
              <input type="email" id="edit-preview-email" value="${contact.email || ''}">
            </div>
            <div class="form-group">
              <label for="edit-preview-birthday">Birthday:</label>
              <input type="date" id="edit-preview-birthday" value="${contact.birthday || ''}">
            </div>
            <div class="form-group">
              <label for="edit-preview-source">Source:</label>
              <input type="text" id="edit-preview-source" value="${contact.source || ''}" readonly>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button id="save-preview-contact" class="primary-btn">Save</button>
          <button class="secondary-btn close-modal">Cancel</button>
        </div>
      </div>
    `;
    
    // Add to document
    document.body.appendChild(editModal);
    
    // Set up event listeners
    editModal.querySelector('.close-modal').addEventListener('click', () => {
      editModal.remove();
    });
    
    // Save button
    editModal.querySelector('#save-preview-contact').addEventListener('click', async () => {
      const phoneInput = document.getElementById('edit-preview-phone');
      const phoneError = document.getElementById('edit-preview-phone-error');
      
      // Validate phone number
      if (!phoneInput.value.trim()) {
        phoneError.textContent = 'Phone number is required';
        phoneError.style.display = 'block';
        return;
      }
      
      const formattedPhone = formatPhoneNumber(phoneInput.value.trim());
      
      // Check for duplicates
      try {
        const response = await api.checkDuplicatePhone(formattedPhone);
        if (response && response.isDuplicate) {
          phoneError.textContent = 'This phone number already exists in the database';
          phoneError.style.display = 'block';
        return;
        }
      } catch (error) {
        console.error('Error checking duplicate phone:', error);
      }
      
      // Update contact
      contacts[index].name = document.getElementById('edit-preview-name').value.trim();
      contacts[index].surname = document.getElementById('edit-preview-surname').value.trim();
      contacts[index].phoneNumber = formattedPhone;
      contacts[index].email = document.getElementById('edit-preview-email').value.trim();
      contacts[index].birthday = document.getElementById('edit-preview-birthday').value;
      
      // Update validation status
      contacts[index].valid = true;
      contacts[index].error = null;
      contacts[index].isDuplicate = false;
      contacts[index].skip = false;
      
      // Recheck all contacts for duplicates
      const phoneMap = new Map();
      const duplicatePhones = new Set();
      
      // First pass: identify duplicates within the file
      contacts.forEach((c, i) => {
        if (c.phoneNumber && c.phoneNumber.trim() !== '') {
          if (phoneMap.has(c.phoneNumber)) {
            duplicatePhones.add(c.phoneNumber);
          } else {
            phoneMap.set(c.phoneNumber, i);
          }
        }
      });
      
      // Second pass: update duplicate status
      contacts.forEach((c, i) => {
        if (c.phoneNumber && duplicatePhones.has(c.phoneNumber)) {
          c.isDuplicate = true;
          c.error = 'Duplicate phone number in file';
        } else {
          c.isDuplicate = false;
          c.error = null;
        }
      });
      
      // Update UI
      updatePreviewTable();
      updateSelectedCount();
      
      // Close modal
      editModal.remove();
    });
  }
  
  // Set up event listeners for the preview modal
  function setupPreviewEventListeners() {
    // Tab switching
    document.querySelectorAll('.preview-tab-link').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabId = e.target.getAttribute('data-tab');
        
        // Update active tab
        document.querySelectorAll('.preview-tab-link').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        
        // Show target tab content
        document.querySelectorAll('.tab-content > div').forEach(content => {
          content.classList.remove('active');
          if (content.id === tabId) {
            content.classList.add('active');
          }
        });
      });
    });
    
    // Select all button
    document.getElementById('select-all-preview').addEventListener('click', (e) => {
      document.querySelectorAll('.contact-preview-checkbox').forEach(checkbox => {
        checkbox.checked = e.target.checked;
      });
      updateSelectedCount();
    });
    
    // Deselect all button
    document.getElementById('deselect-all-preview').addEventListener('click', () => {
      document.querySelectorAll('.contact-preview-checkbox').forEach(checkbox => {
        checkbox.checked = false;
      });
      updateSelectedCount();
    });
    
    // Skip selected button
    document.getElementById('skip-selected-preview').addEventListener('click', () => {
      document.querySelectorAll('.contact-preview-checkbox:checked').forEach(checkbox => {
        const index = parseInt(checkbox.getAttribute('data-index'));
        contacts[index].skip = true;
      });
      updatePreviewTable();
      updateSelectedCount();
    });
    
    // Skip all invalid button
    document.getElementById('skip-all-invalid-btn').addEventListener('click', () => {
      // Mark all invalid contacts as skipped
      contacts.forEach((contact, index) => {
        if (!contact.valid) {
          contact.skip = true;
        }
      });
      
      // Update UI
      updatePreviewTable();
      updateSelectedCount();
    });
    
    // Import all valid button
    document.getElementById('import-all-valid-btn').addEventListener('click', () => {
      // Make sure all valid contacts are selected
      contacts.forEach((contact, index) => {
        if (contact.valid) {
          contact.skip = false;
        }
      });
      
      // Update UI
      updatePreviewTable();
      updateSelectedCount();
      
      // Trigger import
      document.getElementById('complete-import').click();
    });
    
    // Move to valid button
    document.getElementById('move-to-valid').addEventListener('click', () => {
      document.querySelectorAll('.skipped-preview-checkbox:checked').forEach(checkbox => {
        const index = parseInt(checkbox.getAttribute('data-index'));
        contacts[index].skip = false;
        if (!contacts[index].valid) {
          contacts[index].valid = true;
          contacts[index].error = null;
        }
      });
      updatePreviewTable();
      updateSelectedCount();
    });
    
    // Back to import button
    document.getElementById('back-to-import').addEventListener('click', () => {
      // Hide preview modal
      modal.style.display = 'none';
      
      // Show import modal
      document.getElementById('import-modal').style.display = 'block';
    });
  
  // Complete import button
    document.getElementById('complete-import').addEventListener('click', async () => {
      try {
        // Get selected contacts
        const selectedContacts = contacts.filter(c => c.valid && !c.skip);
        
        if (selectedContacts.length === 0) {
          showNotification('Warning', 'No contacts selected for import', 'warning');
          return;
        }
        
        // Show loading state
        const importButton = document.getElementById('complete-import');
        importButton.disabled = true;
        importButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
        
        // Import contacts
        const response = await api.importContactsFromData(selectedContacts, selectedContacts[0].source);
        
        // Hide the preview modal
        modal.style.display = 'none';
        
        if (response.success !== false) {
          // Show success notification
          showNotification(
            'Success', 
            `Imported ${response.imported} contacts (${response.duplicates} duplicates, ${response.errors} errors)`,
            'success'
          );
          
          // Reload contacts
          await loadContactsPaginated();
          
          // Update dashboard contacts count
          updateDashboardContactsCount();
        } else {
          // Show error notification
          showNotification('Error', response.message || 'Failed to import contacts', 'error');
        }
      } catch (error) {
        console.error('Error importing contacts:', error);
          showNotification('Error', 'Failed to import contacts: ' + error.message, 'error');
      }
    });
    
    // Close modal buttons
    modal.querySelectorAll('.close-modal').forEach(button => {
      button.addEventListener('click', () => {
        modal.style.display = 'none';
    });
  });
  
    // Event delegation for preview table actions
    document.addEventListener('click', (e) => {
      // Edit button
      if (e.target.closest('.edit-preview-btn')) {
        const button = e.target.closest('.edit-preview-btn');
        const index = parseInt(button.getAttribute('data-index'));
        editPreviewContact(index);
      }
      
      // Skip button
      if (e.target.closest('.skip-preview-btn')) {
        const button = e.target.closest('.skip-preview-btn');
        const index = parseInt(button.getAttribute('data-index'));
        contacts[index].skip = true;
        updatePreviewTable();
        updateSelectedCount();
      }
      
      // Restore button
      if (e.target.closest('.restore-preview-btn')) {
        const button = e.target.closest('.restore-preview-btn');
        const index = parseInt(button.getAttribute('data-index'));
        contacts[index].skip = false;
        updatePreviewTable();
        updateSelectedCount();
      }
    });
    
    // Checkbox change events
    document.addEventListener('change', (e) => {
      if (e.target.classList.contains('contact-preview-checkbox') || 
          e.target.classList.contains('skipped-preview-checkbox')) {
        updateSelectedCount();
      }
    });
  }
  
  // Initialize the preview
  updatePreviewTable();
  setupPreviewEventListeners();
  
  // Show warning for large datasets
  if (contacts.length > 1000) {
    document.getElementById('large-dataset-warning').style.display = 'block';
    document.getElementById('large-dataset-message').textContent = 
      `For performance reasons, only ${PREVIEW_PAGE_SIZE} contacts are displayed per page. All ${contacts.length.toLocaleString()} contacts will be processed during import.`;
  }
}

// Export functions for use in other modules
export {
  initContacts,
  loadContactsPaginated,
  openContactModal,
  openImportModal,
  deleteContact,
  deleteSelectedContacts
}; 