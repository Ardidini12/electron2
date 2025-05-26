const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Contact = sequelize.define('Contact', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    surname: {
      type: DataTypes.STRING,
      allowNull: true
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        // Validate phone number format (international format with country code)
        is: /^\+?[1-9]\d{1,14}$/
      }
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isEmailOrEmpty(value) {
          // If email is null or undefined or empty string, it's valid
          if (value === null || value === undefined || value === '') {
            return true; // Valid - empty is allowed
          }
          
          // Otherwise, validate as a proper email
          const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
          if (!emailRegex.test(value)) {
            throw new Error('Email format is invalid');
          }
        }
      }
    },
    birthday: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    source: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'Added manually'
    },
    // Additional field to store metadata or notes about the contact
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    // Track when the contact was created and last updated
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  });

  return Contact;
}; 