/**
 * Database Setup and Seed Script
 * 
 * This script will:
 * 1. Create the database if it doesn't exist
 * 2. Create/sync database tables if they don't exist
 * 3. Seed a default user for testing
 * 
 * Usage: node scripts/setupDb.js
 */

require('dotenv').config();
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');

// Parse connection string to extract database name
function parseConnectionString(connectionString) {
  const url = new URL(connectionString);
  return {
    host: url.hostname,
    port: url.port || 5432,
    username: url.username,
    password: url.password,
    database: url.pathname.slice(1), // Remove leading '/'
  };
}

// Create database if it doesn't exist
async function createDatabaseIfNotExists() {
  const config = parseConnectionString(process.env.SEQ_CONNECTION);
  
  // Connect to default 'postgres' database first
  const adminSequelize = new Sequelize({
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    database: 'postgres', // Connect to default postgres database
    dialect: 'postgres',
    dialectModule: require('pg'),
    logging: false,
  });

  try {
    await adminSequelize.authenticate();
    
    // Check if database exists
    const [results] = await adminSequelize.query(
      `SELECT 1 FROM pg_database WHERE datname = '${config.database}'`
    );
    
    if (results.length === 0) {
      console.log(`📦 Creating database "${config.database}"...`);
      await adminSequelize.query(`CREATE DATABASE "${config.database}"`);
      console.log(`✅ Database "${config.database}" created successfully!\n`);
    } else {
      console.log(`ℹ️  Database "${config.database}" already exists.\n`);
    }
  } finally {
    await adminSequelize.close();
  }
}

// Initialize Sequelize connection
let sequelize;
let User, Todo;

// Define models function (called after sequelize is initialized)
function defineModels() {
  // Define User model
  User = sequelize.define('user', {
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  });

  // Define Todo model
  Todo = sequelize.define('todo', {
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    time: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    text: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    checked: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    }
  });

  // Define associations (optional but recommended)
  User.hasMany(Todo, { foreignKey: 'user_id' });
  Todo.belongsTo(User, { foreignKey: 'user_id' });
}

// Hash password function
async function hashPassword(password) {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}

// Seed data
const seedUsers = [
  {
    username: 'admin',
    password: 'admin123', // Will be hashed
  },
  {
    username: 'testuser',
    password: 'test123', // Will be hashed
  },
];

// Helper to format date as DD-MM-YYYY
function formatDate(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

// Get dates for seeding
const today = new Date();
const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);
const nextWeek = new Date(today);
nextWeek.setDate(nextWeek.getDate() + 7);

const seedTodos = [
  {
    text: 'Welcome to TaskFlow!',
    time: formatDate(today),
    checked: false,
  },
  {
    text: 'Try creating a new task',
    time: formatDate(tomorrow),
    checked: false,
  },
  {
    text: 'Mark this as completed',
    time: formatDate(nextWeek),
    checked: true,
  },
];

// Main setup function
async function setupDatabase() {
  try {
    // Step 1: Create database if it doesn't exist
    console.log('🔌 Checking database...');
    await createDatabaseIfNotExists();

    // Step 2: Connect to the target database
    sequelize = new Sequelize(process.env.SEQ_CONNECTION, {
      dialectModule: require('pg'),
      logging: false,
    });

    // Define models after connection
    defineModels();

    // Test database connection
    console.log('🔌 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully!\n');

    // Sync all models (create tables if they don't exist)
    console.log('📦 Syncing database models...');
    await sequelize.sync({ alter: true }); // Use { force: true } to drop and recreate tables
    console.log('✅ Database tables created/updated successfully!\n');

    // Check if users already exist
    const existingUserCount = await User.count();
    
    if (existingUserCount === 0) {
      console.log('🌱 Seeding users...');
      
      for (const userData of seedUsers) {
        const hashedPassword = await hashPassword(userData.password);
        const user = await User.create({
          username: userData.username,
          password: hashedPassword,
        });
        console.log(`   ✅ Created user: ${userData.username} (ID: ${user.id})`);

        // Add sample todos for the first user (admin)
        if (userData.username === 'admin') {
          console.log('   🌱 Adding sample todos for admin user...');
          for (const todoData of seedTodos) {
            await Todo.create({
              ...todoData,
              user_id: user.id,
            });
          }
          console.log(`   ✅ Created ${seedTodos.length} sample todos for admin`);
        }
      }
      
      console.log('\n✅ Database seeding completed!\n');
    } else {
      console.log(`ℹ️  Found ${existingUserCount} existing user(s). Skipping seed.\n`);
    }

    // Display seeded credentials
    console.log('═══════════════════════════════════════════');
    console.log('📋 TEST CREDENTIALS:');
    console.log('═══════════════════════════════════════════');
    seedUsers.forEach(user => {
      console.log(`   Username: ${user.username}`);
      console.log(`   Password: ${user.password}`);
      console.log('   ---');
    });
    console.log('═══════════════════════════════════════════\n');

    // Show table info
    console.log('📊 Database Tables:');
    const tables = await sequelize.getQueryInterface().showAllTables();
    tables.forEach(table => console.log(`   - ${table}`));
    
    console.log('\n🎉 Setup complete!');
    
  } catch (error) {
    console.error('❌ Error setting up database:', error.message);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 Make sure your PostgreSQL server is running.');
    }
    if (error.message.includes('does not exist')) {
      console.log('\n💡 The database might not exist. Create it first with:');
      console.log('   createdb your_database_name');
    }
    
    process.exit(1);
  } finally {
    await sequelize.close();
    console.log('\n🔌 Database connection closed.');
  }
}

// Run the setup
setupDatabase();
