const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ScheduleSettings = sequelize.define('ScheduleSettings', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    // Active days (1-7, Monday is 1, Sunday is 7)
    activeDays: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: JSON.stringify([1, 2, 3, 4, 5]), // Default to Monday-Friday
      
      // Custom getter to parse the JSON array
      get() {
        const value = this.getDataValue('activeDays');
        if (!value) return [1, 2, 3, 4, 5]; // Default if null
        
        try {
          if (Array.isArray(value)) return value;
          return typeof value === 'string' ? JSON.parse(value) : [1, 2, 3, 4, 5];
        } catch (e) {
          console.error('Error parsing activeDays in getter:', e, 'Value:', value);
          return [1, 2, 3, 4, 5]; // Default on error
        }
      },
      
      // Custom setter to stringify the array
      set(val) {
        try {
          if (!val) {
            this.setDataValue('activeDays', JSON.stringify([1, 2, 3, 4, 5]));
            return;
          }
          
          if (Array.isArray(val)) {
            this.setDataValue('activeDays', JSON.stringify(val));
          } else if (typeof val === 'string') {
            // Check if it's already JSON string
            try {
              JSON.parse(val);
              this.setDataValue('activeDays', val);
            } catch (e) {
              // It's not a valid JSON string, so stringify it
              this.setDataValue('activeDays', JSON.stringify([1, 2, 3, 4, 5]));
            }
          } else {
            // Unknown type, use default
            this.setDataValue('activeDays', JSON.stringify([1, 2, 3, 4, 5]));
          }
        } catch (e) {
          console.error('Error in activeDays setter:', e, 'Value:', val);
          this.setDataValue('activeDays', JSON.stringify([1, 2, 3, 4, 5]));
        }
      }
    },
    
    // Start time in minutes from midnight (e.g., 9:00 AM = 9*60 = 540)
    startTime: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 540 // 9:00 AM
    },
    
    // End time in minutes from midnight (e.g., 5:00 PM = 17*60 = 1020)
    endTime: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1020 // 5:00 PM
    },
    
    // Interval between messages in seconds
    messageInterval: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 45 // 45 seconds
    },
    
    // Whether scheduling is active
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false // Default to inactive
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
  }, {
    // Explicitly set the table name to avoid pluralization issues
    tableName: 'ScheduleSettings',
    // Don't pluralize table names
    freezeTableName: true,
    timestamps: true
  });
  
  // Add a hook to ensure activeDays is always serialized correctly when saving
  ScheduleSettings.beforeSave((instance, options) => {
    try {
      // Make sure activeDays is properly serialized
      const activeDays = instance.activeDays;
      if (Array.isArray(activeDays)) {
        instance.setDataValue('activeDays', JSON.stringify(activeDays));
      }
    } catch (error) {
      console.error('Error in ScheduleSettings beforeSave hook:', error);
    }
  });
  
  // Add a hook to ensure activeDays is always an array when retrieving
  ScheduleSettings.afterFind((instances, options) => {
    if (!instances) return instances;
    
    if (!Array.isArray(instances)) {
      instances = [instances];
    }
    
    instances.forEach(instance => {
      try {
        // Parse activeDays if it's a string
        const activeDays = instance.getDataValue('activeDays');
        if (typeof activeDays === 'string') {
          try {
            const parsed = JSON.parse(activeDays);
            if (Array.isArray(parsed)) {
              instance.activeDays = parsed;
            } else {
              instance.activeDays = [1, 2, 3, 4, 5];
            }
          } catch (e) {
            console.error('Error parsing activeDays in afterFind:', e);
            instance.activeDays = [1, 2, 3, 4, 5];
          }
        }
      } catch (error) {
        console.error('Error processing instance in afterFind hook:', error);
      }
    });
  });
  
  return ScheduleSettings;
}; 