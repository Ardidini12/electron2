// dashboard.js - Dashboard functionality

import { showNotification } from '../ui/notifications.js';
import { api, waitForAPI } from '../utils/api.js';

/**
 * Initialize the dashboard
 */
async function initDashboard() {
  try {
    // Wait for API to be available
    await waitForAPI();
    
    // Update dashboard stats
    updateDashboardStats();
    
    // Load recent activity
    loadRecentActivity();
  } catch (error) {
    console.error('Error initializing dashboard:', error);
    showNotification('Error', 'Failed to initialize dashboard: ' + error.message, 'error');
  }
}

/**
 * Update dashboard stats cards with latest counts
 */
async function updateDashboardStats() {
  try {
    // Wait for API to be available if needed
    await waitForAPI();
    
    // Get counts
    const contacts = await api.getContacts();
    const templates = await api.getTemplates();
    const messages = await api.getScheduledMessages();
    
    // Update dashboard cards
    document.getElementById('total-contacts').textContent = contacts.length;
    document.getElementById('total-templates').textContent = templates.length;
    
    // Count sent messages
    const sentMessages = messages.filter(m => m.status === 'SENT' || m.status === 'DELIVERED' || m.status === 'READ');
    document.getElementById('total-sent').textContent = sentMessages.length;
    
    // Count scheduled messages
    const scheduledMessages = messages.filter(m => m.status === 'SCHEDULED' || m.status === 'PENDING');
    document.getElementById('total-scheduled').textContent = scheduledMessages.length;
  } catch (error) {
    console.error('Error updating dashboard stats:', error);
    showNotification('Error updating dashboard', error.message, 'error');
  }
}

/**
 * Load recent activity feed
 */
async function loadRecentActivity() {
  try {
    // Wait for API to be available if needed
    await waitForAPI();
    
    // Get recent messages
    const messages = await api.getScheduledMessages();
    const recentActivity = document.getElementById('recent-activity');
    
    if (!recentActivity) {
      console.error('Recent activity container not found');
      return;
    }
    
    recentActivity.innerHTML = '';
    
    // Sort messages by date, newest first
    const sortedMessages = messages.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    
    // Take the 10 most recent
    const recentMessages = sortedMessages.slice(0, 10);
    
    // Create activity items
    recentMessages.forEach(message => {
      const activityItem = document.createElement('div');
      activityItem.className = 'activity-item';
      
      // Determine icon class based on status
      let iconClass = 'scheduled';
      if (message.status === 'SENT' || message.status === 'DELIVERED' || message.status === 'READ') {
        iconClass = 'sent';
      } else if (message.status === 'FAILED') {
        iconClass = 'failed';
      }
      
      // Format date
      const date = new Date(message.updatedAt);
      const formattedDate = date.toLocaleString();
      
      // Create content
      activityItem.innerHTML = `
        <div class="activity-icon ${iconClass}">
          <i class="fas ${iconClass === 'sent' ? 'fa-check' : iconClass === 'failed' ? 'fa-times' : 'fa-clock'}"></i>
        </div>
        <div class="activity-content">
          <p>Message to ${message.Contact ? (message.Contact.name || message.Contact.phoneNumber) : 'Unknown'} (${message.status})</p>
          <span class="activity-time">${formattedDate}</span>
        </div>
      `;
      
      recentActivity.appendChild(activityItem);
    });
    
    // If no messages, show a message
    if (recentMessages.length === 0) {
      recentActivity.innerHTML = '<p class="text-center">No recent activity</p>';
    }
  } catch (error) {
    console.error('Error loading activity:', error);
    showNotification('Error loading activity', error.message, 'error');
  }
}

// Export dashboard functions
export {
  initDashboard,
  updateDashboardStats,
  loadRecentActivity
}; 