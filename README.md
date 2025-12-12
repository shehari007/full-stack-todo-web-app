<div align="center">
  
  ![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)
  ![Build](https://img.shields.io/badge/build-passing-brightgreen?style=for-the-badge)
  ![React](https://img.shields.io/badge/React-18.3-61DAFB?style=for-the-badge&logo=react&logoColor=white)
  ![Node.js](https://img.shields.io/badge/Node.js-LTS-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
  ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)

  <br/>
  <img src="https://github.com/shehari007/full-stack-todo-web-app/blob/main/Frontend/public/main-logo.png?raw=true" height="180px" width="180px" alt="TaskFlow Logo">
  
  # TaskFlow
  
  **A modern, full-stack task management application built for productivity**
  
  [Live Demo](https://todo-web-app-flame.vercel.app/login) · [Report Bug](https://github.com/shehari007/full-stack-todo-web-app/issues) · [Request Feature](https://github.com/shehari007/full-stack-todo-web-app/issues)

</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🌓 **Light/Dark Theme** | Toggle between light and dark modes with persistent preference |
| 🔐 **JWT Authentication** | Secure user authentication with JSON Web Tokens |
| 📊 **Dashboard Analytics** | Visual stats cards showing task completion metrics |
| 📅 **Smart Date Display** | Relative dates (Today, Tomorrow, Overdue) with color coding |
| 🔍 **Advanced Filtering** | Filter tasks by date range, status, and search text |
| 📱 **Responsive Design** | Optimized for desktop, tablet, and mobile devices |
| 📄 **PDF Export** | Download your task list as a formatted PDF |
| ⚡ **Real-time Updates** | Instant feedback with themed notifications |

---

## � Security Features

| Feature | Description |
|---------|-------------|
| 🛡️ **Rate Limiting** | Protection against brute force attacks (100 req/min general, 10 req/15min for auth) |
| 🔐 **Security Headers** | X-Frame-Options, X-XSS-Protection, X-Content-Type-Options, Referrer-Policy |
| 🧹 **Input Sanitization** | SQL injection prevention on all inputs |
| 📦 **Request Size Limiting** | 10KB max body size to prevent payload attacks |
| 🔑 **Password Hashing** | Bcrypt with secure salt rounds |
| 🎫 **JWT Tokens** | Secure token-based authentication with expiration |

---

## ⚡ Performance Optimizations

| Optimization | Description |
|-------------|-------------|
| 🗂️ **MVC Architecture** | Clean separation with Controllers, Routes, and Middleware |
| 🔄 **RESTful API** | Standard REST endpoints (`/api/auth/*`, `/api/todos/*`) |
| 📊 **Query Optimization** | Selective attributes in Sequelize queries |
| 🌐 **CORS Caching** | 24-hour preflight cache with `maxAge` |
| 🚀 **Trust Proxy** | Proper IP detection behind reverse proxies |
| 🔧 **Global Error Handler** | Centralized error handling with proper status codes |

---

## 🛠️ Tech Stack

**Frontend:**
- React 18.3 with React Router v6
- Ant Design 5 Component Library
- Day.js for date handling
- Axios for API requests
- CSS Variables for theming

**Backend:**
- Node.js with Express.js
- Sequelize ORM
- PostgreSQL Database
- JWT & Bcrypt for authentication
- Custom rate limiting middleware

---

## 📡 API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/register` | User registration |

### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/todos` | Get all tasks |
| GET | `/api/todos/:id` | Get single task |
| POST | `/api/todos` | Create task |
| PUT | `/api/todos/:id` | Update task |
| PATCH | `/api/todos/:id/check` | Toggle task status |
| DELETE | `/api/todos/:id` | Delete task |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Server status |
| GET | `/api/health` | Health check with uptime |

---

## 🚀 Getting Started

### Prerequisites

- Node.js (LTS version recommended)
- PostgreSQL database
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/shehari007/full-stack-todo-web-app.git
   cd full-stack-todo-web-app
   ```

2. **Setup Backend**
   ```bash
   cd Server
   npm install
   ```
   
   Create a `.env` file with your configuration:
   ```env
   PORT=8000
   JWT_KEY=your_jwt_secret_key
   
   # CORS Settings
   ALLOWED_ORIGINS=http://localhost:3000
   ALLOWED_METHODS=GET,POST,PUT,PATCH,DELETE
   
   # Database Connection
   SEQ_CONNECTION=postgres://user:password@localhost:5432/taskflow
   ```

3. **Initialize Database**
   ```bash
   npm run db:setup
   ```
   This creates the database, tables, and seeds sample data.

4. **Start Backend Server**
   ```bash
   npm start
   ```

5. **Setup Frontend** (in a new terminal)
   ```bash
   cd Frontend
   npm install
   ```
   
   Create a `.env` file:
   ```env
   REACT_APP_BASE_URL=http://localhost:8000
   ```
   
   ```bash
   npm start
   ```

6. **Access the Application**
   
   Open [http://localhost:3000](http://localhost:3000) in your browser.
   
   **Default login credentials:**
   - Email: `admin@taskflow.com`
   - Password: `admin123`

---

## 📁 Project Structure

```
full-stack-todo-web-app/
├── Frontend/
│   ├── public/
│   └── src/
│       ├── components/       # Reusable UI components
│       │   ├── common/       # Empty states, loaders
│       │   ├── modals/       # CRUD modals
│       │   ├── PDFDownloader/
│       │   └── todo/         # TodoList component
│       ├── context/          # Theme context provider
│       ├── layout/           # Header, Footer, MainLayout
│       ├── pages/            # Auth & Dashboard pages
│       ├── styles/           # Global CSS with theme variables
│       └── utils/            # API services & date utilities
│
└── Server/
    ├── controllers/          # Auth & Todo controllers
    ├── middleware/           # Auth, Rate limiter, Security, Error handler
    ├── models/               # Sequelize models
    ├── routes/               # API route definitions
    ├── scripts/              # Database setup & seeding
    └── utils/                # Validation, JWT, Password hashing
```

---

## 🌐 Deployment

### Vercel Deployment

The project includes `vercel.json` for serverless deployment:

1. Deploy the Server folder as a Vercel serverless function
2. Deploy the Frontend as a static site
3. Use [Supabase](https://supabase.com/) or [Vercel Postgres](https://vercel.com/storage/postgres) for the database

### Environment Variables

**Frontend (Vercel):**
```
REACT_APP_BASE_URL=https://your-api-domain.vercel.app
```

**Backend (Vercel):**
```
JWT_KEY=your_production_jwt_secret
ALLOWED_ORIGINS=https://your-frontend-domain.vercel.app
ALLOWED_METHODS=GET,POST,PUT,PATCH,DELETE
SEQ_CONNECTION=your_postgres_connection_string
```

---

## 📸 Screenshots

<div align="center">
  <i>Light Mode Dashboard</i>
  <br/><br/>
  <i>Dark Mode with Task Management</i>
</div>

---

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  
  **Enjoyed TaskFlow?**
  
  <a href="https://www.buymeacoffee.com/shehari007">
    <img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee">
  </a>
  
  <br/><br/>
  
  Made with ❤️ by [Muhammad Sheharyar Butt](https://github.com/shehari007)

</div>



