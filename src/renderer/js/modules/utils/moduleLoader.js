// moduleLoader.js - Ensures proper module loading with ES modules

/**
 * Load a script module asynchronously
 * @param {string} src - The source URL of the script
 * @returns {Promise} - Resolves when the script is loaded
 */
export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = src;
    script.onload = () => resolve();
    script.onerror = (error) => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Load modules dynamically
 * @param {Array<string>} modules - Array of module paths to load
 * @returns {Promise} - Resolves when all modules are loaded
 */
export async function loadModules(modules) {
  try {
    // Load each module sequentially
    for (const modulePath of modules) {
      await loadScript(modulePath);
    }
    console.log('All modules loaded successfully');
    return true;
  } catch (error) {
    console.error('Error loading modules:', error);
    throw error;
  }
}

/**
 * Add module support for older browsers
 */
export function setupModuleSupport() {
  // Check if modules are supported
  const supportsModules = 'noModule' in document.createElement('script');
  
  if (!supportsModules) {
    console.warn('Browser does not support ES modules natively. Loading polyfill...');
    
    // You can add polyfill loading code here if needed
    // For example, loading SystemJS or other module polyfills
    
    return false;
  }
  
  return true;
}

/**
 * Dynamic import a module and handle errors
 * @param {string} modulePath - Path to the module
 * @returns {Promise} - Resolves with the module
 */
export async function importModule(modulePath) {
  try {
    return await import(modulePath);
  } catch (error) {
    console.error(`Failed to import module: ${modulePath}`, error);
    throw error;
  }
} 