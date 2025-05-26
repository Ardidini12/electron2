const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ScheduleSettings = sequelize.define('ScheduleSettings', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    // Days of the week to send messages (stored as JSON array)
    activeDays: {
      type: DataTypes.TEXT, // Use TEXT instead of STRING for better storage of JSON data
      allowNull: false,
      defaultValue: JSON.stringify([1, 2, 3, 4, 5]), // Monday to Friday by default
      get() {
        const value = this.getDataValue('activeDays');
        if (!value) return [1, 2, 3, 4, 5]; // Default if null
        
        try {
          return JSON.parse(value);
        } catch (e) {
          console.error('Error parsing activeDays:', e);
          return [1, 2, 3, 4, 5]; // Default if parsing fails
        }
      },
      set(value) {
        if (Array.isArray(value)) {
          this.setDataValue('activeDays', JSON.stringify(value));
        } else if (typeof value === 'string') {
          try {
            // Try to parse in case it's already a JSON string
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              this.setDataValue('activeDays', value); // Already a JSON string
            } else {
              this.setDataValue('activeDays', JSON.stringify([1, 2, 3, 4, 5])); // Default
            }
          } catch (e) {
            // Not a valid JSON string, store as default
            this.setDataValue('activeDays', JSON.stringify([1, 2, 3, 4, 5]));
          }
        } else {
          // Default
          this.setDataValue('activeDays', JSON.stringify([1, 2, 3, 4, 5]));
        }
      }
    },
    // Start time (in 24-hour format, stored as minutes from midnight)
    startTime: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 9 * 60, // 9:00 AM by default
      validate: {
        min: 0,
        max: 24 * 60 - 1 // 23:59
      }
    },
    // End time (in 24-hour format, stored as minutes from midnight)
    endTime: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 17 * 60, // 5:00 PM by default
      validate: {
        min: 0,
        max: 24 * 60 - 1 // 23:59
      }
    },
    // Interval between messages (in seconds)
    messageInterval: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 45, // 45 seconds by default
      validate: {
        min: 10 // Minimum 10 seconds to avoid rate limiting
      }
    },
    // Flag to enable/disable sending
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    // Track when the settings were created and last updated
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  });
  
  return ScheduleSettings;
}; 