// api.js - API access utilities

// Track if we've already warned about API issues
let apiWarningShown = false;
let apiInitialized = false;

// Initialize a promise for API readiness
const apiReadyPromise = window.esmApi ? window.esmApi.waitForESMApi(3000).then(api => {
  apiInitialized = true;
  console.log('API initialized successfully');
  return api;
}).catch(error => {
  console.error('Failed to initialize API:', error);
  throw error;
}) : Promise.reject(new Error('ESM API not available'));

/**
 * Get the API instance
 * @returns {Object} The API object
 * @throws {Error} If API is not available
 */
export function getAPI() {
  if (!window.api) {
    if (!apiWarningShown) {
      console.error('API not available. Make sure the application is properly initialized.');
      apiWarningShown = true;
    }
    throw new Error('API not available. Make sure the application is properly initialized.');
  }
  return window.api;
}

/**
 * Check if the API is available
 * @returns {boolean} True if API is available
 */
export function isAPIAvailable() {
  return !!window.api;
}

/**
 * Wait for API to become available
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} The API object
 */
export async function waitForAPI(timeout = 3000) {
  try {
    // Use the pre-initialized promise
    return await apiReadyPromise;
  } catch (error) {
    console.warn('API initialization failed, attempting fallback method:', error);
    
    // Fallback method - direct check with short timeout
    return new Promise((resolve, reject) => {
      // Check if API is already available
      if (window.api) {
        resolve(window.api);
        return;
      }

      // Set up a timeout to reject the promise
      const timeoutId = setTimeout(() => {
        const errorMsg = 'API not available after timeout';
        console.error(errorMsg);
        reject(new Error(errorMsg));
      }, timeout);

      // Add event listener for API ready event
      const apiReadyHandler = () => {
        clearTimeout(timeoutId);
        resolve(window.api);
      };
      
      document.addEventListener('api-ready', apiReadyHandler, { once: true });
      
      // Also check periodically as a last resort
      const checkInterval = setInterval(() => {
        if (window.api) {
          clearTimeout(timeoutId);
          clearInterval(checkInterval);
          document.removeEventListener('api-ready', apiReadyHandler);
          resolve(window.api);
        }
      }, 20);
    });
  }
}

// Create a safe proxy for API calls
const createSafeApiProxy = () => {
  return new Proxy({}, {
    get(target, prop) {
      // Return a function that handles the method call
      return async (...args) => {
        try {
          // Get the API, waiting if necessary
          const api = await waitForAPI();
          
          // Check if the method exists
          if (typeof api[prop] !== 'function') {
            throw new Error(`API method ${prop} is not a function`);
          }
          
          // Call the method
          return await api[prop](...args);
        } catch (error) {
          console.error(`Error calling API method ${prop}:`, error);
          throw error;
        }
      };
    }
  });
};

// Export a convenience object that safely proxies all API calls
export const api = createSafeApiProxy(); 