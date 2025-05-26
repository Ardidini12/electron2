// helpers.js - Common utility functions

// Import path module if available (in Electron environment)
const path = window.require ? window.require('path') : { basename: (filePath) => filePath.split(/[\\/]/).pop() };

/**
 * Format a phone number to a standardized format
 * @param {string} phoneNumber - The phone number to format
 * @returns {string} - The formatted phone number
 */
function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber) return '';
  
  // Remove all non-numeric characters
  let cleaned = phoneNumber.replace(/\D/g, '');
  
  // Ensure it starts with a + if it doesn't already
  if (!cleaned.startsWith('+')) {
    // If it starts with a country code (common ones like 1, 44, 91, etc.), add +
    if (/^(1|7|20|27|30|31|32|33|34|36|39|40|41|43|44|45|46|47|48|49|51|52|53|54|55|56|57|58|60|61|62|63|64|65|66|81|82|84|86|90|91|92|93|94|95|98|212|213|216|218|220|221|222|223|224|225|226|227|228|229|230|231|232|233|234|235|236|237|238|239|240|241|242|243|244|245|246|247|248|249|250|251|252|253|254|255|256|257|258|260|261|262|263|264|265|266|267|268|269|290|291|297|298|299|350|351|352|353|354|355|356|357|358|359|370|371|372|373|374|375|376|377|378|379|380|381|382|383|385|386|387|389|420|421|423|500|501|502|503|504|505|506|507|508|509|590|591|592|593|594|595|596|597|598|599|670|672|673|674|675|676|677|678|679|680|681|682|683|685|686|687|688|689|690|691|692|850|852|853|855|856|870|880|886|960|961|962|963|964|965|966|967|968|970|971|972|973|974|975|976|977|992|993|994|995|996|998)\d+$/.test(cleaned)) {
      cleaned = '+' + cleaned;
    } else if (cleaned.length >= 10) {
      // Add default + for any long enough number
      cleaned = '+' + cleaned;
    }
  }
  
  return cleaned;
}

/**
 * Normalize a phone number by removing non-numeric characters
 * @param {string} phone - The phone number to normalize
 * @returns {string} - The normalized phone number
 */
function normalizePhoneNumber(phone) {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

/**
 * Check if a contact object is empty (has no name, surname, email, or birthday)
 * @param {Object} contact - The contact object to check
 * @returns {boolean} - True if the contact is empty
 */
function isEmptyContact(contact) {
  return !contact.name && !contact.surname && !contact.email && !contact.birthday;
}

/**
 * Create HTML content for a cell with optional required indicator
 * @param {string} value - The value to display
 * @param {boolean} isRequired - Whether the field is required
 * @returns {string} - The HTML content
 */
function createCellContentHTML(value, isRequired = false) {
  if (!value && isRequired) {
    return `<span class="missing-required">${value || ''} <span class="required-indicator">*</span></span>`;
  }
  return value || '';
}

/**
 * Create HTML for a birthday cell with proper formatting
 * @param {string} birthday - The birthday value
 * @returns {string} - The formatted HTML
 */
function createBirthdayCellHTML(birthday) {
  if (!birthday) return '';
  
  try {
    // Convert to Date object
    const date = new Date(birthday);
    // Format as YYYY-MM-DD
    return date.toISOString().split('T')[0];
  } catch (error) {
    console.error('Error formatting birthday:', error);
    return birthday;
  }
}

/**
 * Debounce a function to limit how often it runs
 * @param {Function} func - The function to debounce
 * @param {number} wait - The time to wait in milliseconds
 * @returns {Function} - The debounced function
 */
function debounce(func, wait = 300) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Export all helper functions
export {
  path,
  formatPhoneNumber,
  normalizePhoneNumber,
  isEmptyContact,
  createCellContentHTML,
  createBirthdayCellHTML,
  debounce
}; 