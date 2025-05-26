// esm-wrapper.js - Ensures ES modules work correctly in Electron

/**
 * This file ensures ES modules work correctly in the Electron environment.
 * It wraps Electron APIs to make them available to ES modules.
 */

// Initialize API state using a self-executing function to avoid global namespace pollution
(function() {
  // Create safe variables that won't conflict with read-only properties
  const apiCallbacks = [];
  let apiPromiseResolve = null;
  
  // Create a promise that resolves when the API is ready
  const apiPromise = new Promise((resolve) => {
    // Check if API is already available
    if (window.api) {
      resolve(window.api);
    } else {
      // Store the resolve function to call it when API becomes available
      apiPromiseResolve = resolve;
    }
  });

  // Listen for custom events from preload script
  document.addEventListener('api-ready', (event) => {
    console.log('Received api-ready event in ESM wrapper');
    
    // Call all callbacks
    while (apiCallbacks.length > 0) {
      try {
        const callback = apiCallbacks.shift();
        callback(window.api);
      } catch (err) {
        console.error('Error in API ready callback:', err);
      }
    }
    
    // Resolve the promise
    if (apiPromiseResolve) {
      apiPromiseResolve(window.api);
    }
  });

  document.addEventListener('api-failed', (event) => {
    console.error('API initialization failed:', event.detail.error);
  });

  // Function to call when API is ready
  function onApiReady(callback) {
    if (window.api) {
      callback(window.api);
    } else {
      apiCallbacks.push(callback);
    }
  }

  // Check for API availability with fewer attempts and more efficient polling
  function checkApiAvailability(attempts = 0, maxAttempts = 10) {
    if (window.api) {
      console.log('API is available in ESM context');
      
      // Call all callbacks
      while (apiCallbacks.length > 0) {
        try {
          const callback = apiCallbacks.shift();
          callback(window.api);
        } catch (err) {
          console.error('Error in API ready callback:', err);
        }
      }
      
      // Resolve the promise
      if (apiPromiseResolve) {
        apiPromiseResolve(window.api);
      }
      
      return;
    }
    
    if (attempts >= maxAttempts) {
      console.error(`API not available after ${maxAttempts} attempts`);
      return;
    }
    
    // Only log occasionally to reduce console spam
    if (attempts % 5 === 0) {
      console.log(`Waiting for API to be available in ESM context... (attempt ${attempts}/${maxAttempts})`);
    }
    
    setTimeout(() => checkApiAvailability(attempts + 1, maxAttempts), 50);
  }

  // Create a proxy for the API that waits for it to be available
  const apiProxy = new Proxy({}, {
    get(target, prop) {
      // Return a function that handles the method call
      return async (...args) => {
        // Wait for API to be available
        const api = await apiPromise;
        if (!api || typeof api[prop] !== 'function') {
          throw new Error(`API method ${prop} is not available`);
        }
        // Call the actual method
        return api[prop](...args);
      };
    }
  });

  // Initialize function to ensure the wrapper has loaded
  function initESM() {
    return {
      isNodeEnvironment: !!window.api,
      api: window.api || apiProxy
    };
  }

  // Function to wait for API
  function waitForESMApi(timeout = 3000) {
    return new Promise((resolve, reject) => {
      if (window.api) {
        resolve(window.api);
        return;
      }
      
      // Set up timeout
      const timeoutId = setTimeout(() => {
        reject(new Error('API not available after timeout in ESM context'));
      }, timeout);
      
      // Use the promise with a timeout race
      apiPromise.then(api => {
        clearTimeout(timeoutId);
        resolve(api);
      });
    });
  }
  
  // Start checking for API availability
  checkApiAvailability();
  
  // Expose functions to window
  window.esmApi = {
    initESM,
    waitForESMApi,
    onApiReady
  };
  
  console.log('ESM wrapper initialized');
})(); 