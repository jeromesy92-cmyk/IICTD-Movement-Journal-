import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import multer from 'multer';
import fs from 'fs';
import { UserData } from './src/App';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("movement_journal.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_number TEXT UNIQUE,
    username TEXT UNIQUE,
    password TEXT,
    full_name TEXT,
    position TEXT,
    division TEXT,
    district TEXT,
    base_office TEXT,
    role TEXT, -- 'System Administrator', 'Network Administrator', 'Senior Field Engineer', 'Field Engineer'
    supervisor_id INTEGER,
    status TEXT DEFAULT 'active',
    avatar_url TEXT,
    email TEXT,
    phone_number TEXT,
    location TEXT,
    date_of_birth TEXT,
    language TEXT,
    locale TEXT,
    first_day_of_week TEXT,
    website TEXT,
    online_status TEXT DEFAULT 'Online',
    status_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supervisor_id) REFERENCES users(id)
  );
`);

// Migration for existing roles
try {
  db.prepare("UPDATE users SET role = 'System Administrator' WHERE role = 'admin'").run();
  db.prepare("UPDATE users SET role = 'Senior Field Engineer' WHERE role = 'supervisor'").run();
  db.prepare("UPDATE users SET role = 'Field Engineer' WHERE role = 'staff'").run();
} catch (e) {
  console.error("Migration error:", e);
}

try {
  db.prepare("ALTER TABLE users ADD COLUMN division TEXT").run();
} catch (e) {
  // Column likely exists
}

try {
  db.prepare("ALTER TABLE users ADD COLUMN base_office TEXT").run();
} catch (e) {
  // Column likely exists
}

try {
  db.prepare("ALTER TABLE users ADD COLUMN id_number TEXT UNIQUE").run();
} catch (e) {
  // Column likely exists
}

try {
  db.prepare("ALTER TABLE movements ADD COLUMN assigned_supervisor_id INTEGER").run();
} catch (e) {
  // Column likely exists
}

try { db.prepare("ALTER TABLE users ADD COLUMN avatar_url TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN email TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN phone_number TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN location TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN date_of_birth TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN language TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN locale TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN first_day_of_week TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN website TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN x_handle TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN fediverse_handle TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN organisation TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN profile_role TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN headline TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN about TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN online_status TEXT DEFAULT 'Online'").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN status_message TEXT").run(); } catch (e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER,
    date TEXT,
    time_in TEXT,
    time_out TEXT,
    division TEXT,
    district TEXT,
    area TEXT,
    branch TEXT,
    purpose TEXT,
    transport_mode TEXT,
    accomplishments TEXT,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'completed'
    supervisor_remarks TEXT,
    approved_by INTEGER,
    assigned_supervisor_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (staff_id) REFERENCES users(id),
    FOREIGN KEY (approved_by) REFERENCES users(id),
    FOREIGN KEY (assigned_supervisor_id) REFERENCES users(id)
  );

  -- Add due_date column to movements table
  try {
    db.prepare("ALTER TABLE movements ADD COLUMN due_date TEXT").run();
  } catch (e) {
    // Column likely exists
  }

  CREATE TABLE IF NOT EXISTS knowledge_base (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    category TEXT,
    type TEXT, -- 'pdf', 'word', 'excel', 'link'
    content TEXT, -- URL or description
    version TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    message TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT,
    details TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Seed initial admin if not exists
const adminExists = db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
if (!adminExists) {
  db.prepare(`
    INSERT INTO users (username, password, full_name, position, role, status)
    VALUES ('admin', 'admin123', 'Administrator', 'IT Manager', 'System Administrator', 'active')
  `).run();
} else {
  // Update existing default admin name if it's still "System Administrator"
  db.prepare(`
    UPDATE users SET full_name = 'Administrator' WHERE username = 'admin' AND full_name = 'System Administrator'
  `).run();
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Serve uploaded files statically
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
  }
  app.use('/uploads', express.static(uploadsDir));

  // --- API Routes ---

  // Audit Logs
  app.get("/api/audit", (req, res) => {
    const logs = db.prepare(`
      SELECT a.*, u.full_name 
      FROM audit_logs a 
      LEFT JOIN users u ON a.user_id = u.id 
      ORDER BY a.timestamp DESC 
      LIMIT 100
    `).all();
    res.json(logs);
  });

  app.get("/api/users/:id/activity", (req, res) => {
    const { id } = req.params;
    const logs = db.prepare(`
      SELECT * FROM audit_logs 
      WHERE user_id = ? 
      ORDER BY timestamp DESC 
      LIMIT 50
    `).all(id);
    res.json(logs);
  });

  const logAction = (userId: number | null, action: string, details: string) => {
    db.prepare("INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)").run(userId, action, details);
  };

  // Notifications
  app.get("/api/notifications/:userId", (req, res) => {
    const { userId } = req.params;
    const notifications = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC").all(userId);
    res.json(notifications);
  });

  app.put("/api/notifications/:id/read", (req, res) => {
    const { id } = req.params;
    db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(id);
    res.json({ success: true });
  });

  app.put("/api/notifications/bulk/read", (req, res) => {
    const { ids } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid notification IDs" });
    }

    try {
      const updateTransaction = db.transaction(() => {
        for (const id of ids) {
          db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(id);
        }
      });

      updateTransaction();
      res.json({ success: true });
    } catch (e: any) {
      console.error(`[BULK READ NOTIFICATIONS] Error updating notifications:`, e);
      res.status(500).json({ success: false, message: "Failed to update notifications: " + e.message });
    }
  });

  app.post("/api/notifications/bulk/delete", (req, res) => {
    const { ids } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid notification IDs" });
    }

    try {
      const deleteTransaction = db.transaction(() => {
        for (const id of ids) {
          db.prepare("DELETE FROM notifications WHERE id = ?").run(id);
        }
      });

      deleteTransaction();
      res.json({ success: true });
    } catch (e: any) {
      console.error(`[BULK DELETE NOTIFICATIONS] Error deleting notifications:`, e);
      res.status(500).json({ success: false, message: "Failed to delete notifications: " + e.message });
    }
  });

  app.delete("/api/notifications/bulk", (req, res) => {
    const { ids } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid notification IDs" });
    }

    try {
      const deleteTransaction = db.transaction(() => {
        for (const id of ids) {
          db.prepare("DELETE FROM notifications WHERE id = ?").run(id);
        }
      });

      deleteTransaction();
      res.json({ success: true });
    } catch (e: any) {
      console.error(`[BULK DELETE NOTIFICATIONS] Error deleting notifications:`, e);
      res.status(500).json({ success: false, message: "Failed to delete notifications: " + e.message });
    }
  });

  app.get("/api/reports/stats", (req, res) => {
    const totalMovements = db.prepare("SELECT COUNT(*) as count FROM movements").get() as any;
    const activeUsers = db.prepare("SELECT COUNT(DISTINCT staff_id) as count FROM movements").get() as any;
    const pendingApprovals = db.prepare("SELECT COUNT(*) as count FROM movements WHERE status = 'pending'").get() as any;
    const completedMovements = db.prepare("SELECT COUNT(*) as count FROM movements WHERE status = 'approved'").get() as any;

    res.json({
      totalMovements: totalMovements.count,
      activeUsers: activeUsers.count,
      pendingApprovals: pendingApprovals.count,
      completedMovements: completedMovements.count
    });
  });

  app.get("/api/reports/by-division", (req, res) => {
    const data = db.prepare(`
      SELECT division, COUNT(*) as count 
      FROM movements 
      WHERE division IS NOT NULL 
      GROUP BY division 
      ORDER BY count DESC
    `).all();
    res.json(data);
  });

  app.get("/api/reports/over-time", (req, res) => {
    const { range } = req.query; // 'daily', 'weekly', 'monthly'
    let dateFormat = '%Y-%m-%d';
    
    if (range === 'monthly') {
      dateFormat = '%Y-%m';
    } else if (range === 'weekly') {
      dateFormat = '%Y-%W';
    }

    const data = db.prepare(`
      SELECT strftime(?, date) as date, COUNT(*) as count 
      FROM movements 
      GROUP BY date 
      ORDER BY date ASC 
      LIMIT 30
    `).all(dateFormat);
    res.json(data);
  });

  app.get("/api/reports/top-users", (req, res) => {
    const data = db.prepare(`
      SELECT u.full_name, COUNT(m.id) as count 
      FROM movements m
      JOIN users u ON m.staff_id = u.id
      GROUP BY m.staff_id 
      ORDER BY count DESC 
      LIMIT 5
    `).all();
    res.json(data);
  });

  // Auth (Simplified for demo)
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ? AND password = ?").get(username, password) as any;
    if (user) {
      logAction(user.id, "LOGIN", `User ${username} logged in`);
      res.json({ success: true, user });
    } else {
      res.status(401).json({ success: false, message: "Invalid credentials" });
    }
  });

  app.post("/api/reset-password", (req, res) => {
    const { username } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
    if (user) {
      // In a real application, you would send an email with a reset link here.
      // For this demo, we'll just log the action and return success.
      logAction(user.id, "PASSWORD_RESET_REQUEST", `Password reset requested for user ${username}`);
      res.json({ success: true, message: "Password reset instructions sent to your email" });
    } else {
      // To prevent username enumeration, we still return success even if the user doesn't exist
      res.json({ success: true, message: "If the username exists, password reset instructions have been sent." });
    }
  });

  // Users
  app.get("/api/users", (req, res) => {
    const users = db.prepare(`
      SELECT u.*, s.full_name as supervisor_name 
      FROM users u 
      LEFT JOIN users s ON u.supervisor_id = s.id
    `).all();
    
    // Convert district string to array for frontend
    const usersWithDistrictArray = users.map(user => ({
      ...user,
      district: user.district ? user.district.split(',') : []
    }));

    res.json(usersWithDistrictArray);
  });

  app.post("/api/users", (req, res) => {
    const { id_number, username, password, full_name, division, district, base_office, role, supervisor_id, current_user_id } = req.body;
    const districtString = Array.isArray(district) ? district.join(',') : district;
    try {
      const final_supervisor_id = supervisor_id === '' ? null : supervisor_id;
      const result = db.prepare(`
        INSERT INTO users (id_number, username, password, full_name, division, district, base_office, role, supervisor_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id_number, username, password, full_name, division, districtString, base_office, role, final_supervisor_id);
      
      logAction(current_user_id || result.lastInsertRowid, "USER_CREATED", `Created user ${username} (${role})`);
      
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message });
    }
  });

  app.put("/api/users/:id", (req, res) => {
    const { id } = req.params;
    const { 
      id_number, username, password, full_name, division, district, base_office, 
      role, supervisor_id, status, email, phone_number, location, date_of_birth, 
      language, locale, first_day_of_week, website, x_handle, fediverse_handle,
      organisation, profile_role, headline, about, online_status, status_message,
      current_user_id
    } = req.body;
    const districtString = Array.isArray(district) ? district.join(',') : district;
    
    try {
      if (online_status && status_message !== undefined) {
        // Just updating online status and message
        db.prepare("UPDATE users SET online_status = ?, status_message = ? WHERE id = ?").run(online_status, status_message, id);
      } else if (status && Object.keys(req.body).length === 1) {
        // Just updating user active/inactive status
        db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, id);
        logAction(parseInt(id), "USER_STATUS_UPDATE", `User status updated to ${status}`);
      } else {
        // Updating user details
        let query = `
          UPDATE users SET 
            id_number = ?,
            username = ?,
            full_name = ?,
            division = ?,
            district = ?,
            base_office = ?,
            role = ?,
            supervisor_id = ?,
            email = ?,
            phone_number = ?,
            location = ?,
            date_of_birth = ?,
            language = ?,
            locale = ?,
            first_day_of_week = ?,
            website = ?,
            x_handle = ?,
            fediverse_handle = ?,
            organisation = ?,
            profile_role = ?,
            headline = ?,
            about = ?
        `;
        let params = [
          id_number, username, full_name, division, districtString, base_office, role, supervisor_id || null,
          email, phone_number, location, date_of_birth, language, locale, first_day_of_week, website,
          x_handle, fediverse_handle, organisation, profile_role, headline, about
        ];

        if (password) {
          query += `, password = ?`;
          params.push(password);
        }

        query += ` WHERE id = ?`;
        params.push(id);

        db.prepare(query).run(...params);
        logAction(current_user_id || parseInt(id), "USER_UPDATED", `Updated profile for ${username || 'user ' + id}`);
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message });
    }
  });

  app.delete("/api/users/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const { current_user_id } = req.body;
    
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    console.log(`[DELETE] Attempting to delete user ${id}`);

    try {
      const userToDelete = db.prepare("SELECT username FROM users WHERE id = ?").get(id) as any;
      const username = userToDelete ? userToDelete.username : 'Unknown';

      const deleteTransaction = db.transaction(() => {
        // 1. Delete movements created by this user
        db.prepare("DELETE FROM movements WHERE staff_id = ?").run(id);

        // 2. Set supervisor_id to NULL for users managed by this user
        db.prepare("UPDATE users SET supervisor_id = NULL WHERE supervisor_id = ?").run(id);

        // 3. Set assigned_supervisor_id to NULL for movements assigned to this user
        db.prepare("UPDATE movements SET assigned_supervisor_id = NULL WHERE assigned_supervisor_id = ?").run(id);

        // 4. Set approved_by to NULL for movements approved by this user
        db.prepare("UPDATE movements SET approved_by = NULL WHERE approved_by = ?").run(id);
        
        // 5. Delete audit logs for this user
        db.prepare("DELETE FROM audit_logs WHERE user_id = ?").run(id);

        // 6. Delete knowledge base entries created by this user
        db.prepare("DELETE FROM knowledge_base WHERE created_by = ?").run(id);

        // 7. Finally delete the user
        const result = db.prepare("DELETE FROM users WHERE id = ?").run(id);
        
        return result;
      });

      const result = deleteTransaction();
      
      if (result.changes > 0) {
        console.log(`[DELETE] User ${id} deleted successfully`);
        logAction(current_user_id || null, "USER_DELETED", `Deleted user ${username} (ID: ${id})`);
        res.json({ success: true });
      } else {
        console.log(`[DELETE] User ${id} not found`);
        res.status(404).json({ success: false, message: "User not found" });
      }
    } catch (e: any) {
      console.error(`[DELETE] Error deleting user ${id}:`, e);
      res.status(500).json({ success: false, message: "Failed to delete user: " + e.message });
    }
  });

  app.delete("/api/users/bulk", (req, res) => {
    const { ids } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid user IDs" });
    }

    try {
      const deleteTransaction = db.transaction(() => {
        for (const id of ids) {
          // 1. Delete movements created by this user
          db.prepare("DELETE FROM movements WHERE staff_id = ?").run(id);

          // 2. Set supervisor_id to NULL for users managed by this user
          db.prepare("UPDATE users SET supervisor_id = NULL WHERE supervisor_id = ?").run(id);

          // 3. Set assigned_supervisor_id to NULL for movements assigned to this user
          db.prepare("UPDATE movements SET assigned_supervisor_id = NULL WHERE assigned_supervisor_id = ?").run(id);

          // 4. Set approved_by to NULL for movements approved by this user
          db.prepare("UPDATE movements SET approved_by = NULL WHERE approved_by = ?").run(id);
          
          // 5. Delete audit logs for this user
          db.prepare("DELETE FROM audit_logs WHERE user_id = ?").run(id);

          // 6. Delete knowledge base entries created by this user
          db.prepare("DELETE FROM knowledge_base WHERE created_by = ?").run(id);

          // 7. Finally delete the user
          db.prepare("DELETE FROM users WHERE id = ?").run(id);
        }
      });

      deleteTransaction();
      res.json({ success: true });
    } catch (e: any) {
      console.error(`[DELETE BULK] Error deleting users:`, e);
      res.status(500).json({ success: false, message: "Failed to delete users: " + e.message });
    }
  });

  app.put("/api/users/bulk/status", (req, res) => {
    const { ids, status } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0 || !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid request parameters" });
    }

    try {
      const updateTransaction = db.transaction(() => {
        for (const id of ids) {
          db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, id);
        }
      });

      updateTransaction();
      res.json({ success: true });
    } catch (e: any) {
      console.error(`[UPDATE BULK STATUS] Error updating users:`, e);
      res.status(500).json({ success: false, message: "Failed to update users: " + e.message });
    }
  });

  // Avatar Upload
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
    }
  });

  const upload = multer({ storage: storage });

  app.post('/api/users/:id/avatar', upload.single('avatar'), (req, res) => {
    const { id } = req.params;
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }
    const avatarUrl = `/uploads/${req.file.filename}`;

    try {
      db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, id);
      const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      res.json({ success: true, user: updatedUser });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.delete('/api/users/:id/avatar', (req, res) => {
    const { id } = req.params;
    try {
      // First, get the current avatar_url to delete the file
      const user = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(id) as UserData;
      if (user && user.avatar_url) {
        const filePath = path.join(__dirname, user.avatar_url);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      // Then, update the database
      db.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').run(id);
      const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      res.json({ success: true, user: updatedUser });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Movements
  app.get("/api/movements", (req, res) => {
    const { staff_id, supervisor_id, role } = req.query;
    let query = `
      SELECT m.*, u.full_name as staff_name, u.position, u.district as user_district,
             s.full_name as assigned_supervisor_name
      FROM movements m
      JOIN users u ON m.staff_id = u.id
      LEFT JOIN users s ON m.assigned_supervisor_id = s.id
    `;
    const params: any[] = [];

    if (role === 'Field Engineer') {
      query += " WHERE m.staff_id = ?";
      params.push(staff_id);
    } else if (role === 'Senior Field Engineer' || role === 'Network Engineer (Field Operations)') {
      // Fetch user's districts
      const user = db.prepare("SELECT district FROM users WHERE id = ?").get(staff_id) as any;
      const userDistricts = user?.district ? user.district.split(',') : [];

      // See own movements OR movements assigned to them OR movements by their direct reports (if not assigned to someone else)
      // OR unassigned movements in their districts
      query += ` WHERE m.staff_id = ? 
                 OR m.assigned_supervisor_id = ? 
                 OR (u.supervisor_id = ? AND m.assigned_supervisor_id IS NULL) 
                 OR m.approved_by = ?`;
      params.push(staff_id, supervisor_id, supervisor_id, supervisor_id);

      if (userDistricts.length > 0) {
        const districtPlaceholders = userDistricts.map(() => '?').join(',');
        query += ` OR (m.district IN (${districtPlaceholders}) AND m.assigned_supervisor_id IS NULL)`;
        params.push(...userDistricts);
      }
    }
    // Admins see all

    query += " ORDER BY m.date DESC, m.created_at DESC";
    const movements = db.prepare(query).all(...params);
    res.json(movements);
  });

  app.put("/api/movements/:id/claim", (req, res) => {
    const { id } = req.params;
    const { supervisor_id } = req.body;
    
    const result = db.prepare(`
      UPDATE movements SET assigned_supervisor_id = ?, status = 'assigned'
      WHERE id = ? AND assigned_supervisor_id IS NULL
    `).run(supervisor_id, id);

    if (result.changes > 0) {
      logAction(supervisor_id, "MOVEMENT_CLAIMED", `Claimed movement #${id}`);
      res.json({ success: true });
    } else {
      res.status(400).json({ success: false, message: "Movement already assigned or not found" });
    }
  });

  app.get("/api/movements/next-id", (req, res) => {
    const result = db.prepare("SELECT MAX(id) as maxId FROM movements").get() as any;
    const nextId = (result.maxId || 0) + 1;
    res.json({ nextId });
  });

  app.post("/api/movements", (req, res) => {
    const { staff_id, date, time_in, time_out, division, district, area, branch, purpose, accomplishments, due_date } = req.body;
    const result = db.prepare(`
      INSERT INTO movements (staff_id, date, time_in, time_out, division, district, area, branch, purpose, accomplishments, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(staff_id, date, time_in, time_out, division, district, area, branch, purpose, accomplishments, due_date);

    // Notify all system administrators
    const admins = db.prepare("SELECT id FROM users WHERE role = 'System Administrator'").all();
    const message = `A new Entry has been submitted (Movement #${result.lastInsertRowid}).`;
    const insertNotification = db.prepare("INSERT INTO notifications (user_id, message) VALUES (?, ?)");
    admins.forEach((admin: any) => {
      insertNotification.run(admin.id, message);
    });

    logAction(staff_id, "MOVEMENT_CREATED", `Created movement #${result.lastInsertRowid} for ${date}`);

    res.json({ success: true, id: result.lastInsertRowid });
  });

  app.put("/api/movements/:id/assign", (req, res) => {
    const { id } = req.params;
    const { assigned_supervisor_id } = req.body;
    db.prepare(`
      UPDATE movements SET assigned_supervisor_id = ?, status = 'assigned'
      WHERE id = ?
    `).run(assigned_supervisor_id, id);

    // Notify the assigned supervisor
    const message = `A new Entry has been assigned to you (Movement #${id}).`;
    db.prepare("INSERT INTO notifications (user_id, message) VALUES (?, ?)").run(assigned_supervisor_id, message);

    logAction(null, "MOVEMENT_ASSIGNED", `Assigned movement #${id} to supervisor ${assigned_supervisor_id}`);

    res.json({ success: true });
  });

  app.put("/api/movements/:id/acknowledge", (req, res) => {
    const { id } = req.params;
    db.prepare(`
      UPDATE movements SET status = 'acknowledged'
      WHERE id = ?
    `).run(id);

    // Notify all senior field engineers
    const supervisors = db.prepare("SELECT id FROM users WHERE role = 'Senior Field Engineer'").all();
    const message = `Movement #${id} has been acknowledged and is ready for assignment.`;
    const insertNotification = db.prepare("INSERT INTO notifications (user_id, message) VALUES (?, ?)");
    supervisors.forEach((supervisor: any) => {
      insertNotification.run(supervisor.id, message);
    });

    logAction(null, "MOVEMENT_ACKNOWLEDGED", `Movement #${id} acknowledged`);

    res.json({ success: true });
  });

  app.put("/api/movements/:id/approve", (req, res) => {
    const { id } = req.params;
    const { supervisor_id, remarks, status } = req.body;
    db.prepare(`
      UPDATE movements SET status = ?, supervisor_remarks = ?, approved_by = ?
      WHERE id = ?
    `).run(status, remarks, supervisor_id, id);
    
    logAction(supervisor_id, status === 'approved' ? "MOVEMENT_APPROVED" : "MOVEMENT_REJECTED", `Movement #${id} ${status} by supervisor ${supervisor_id}`);
    
    res.json({ success: true });
  });

  app.delete("/api/movements/:id", (req, res) => {
    const { id } = req.params;
    db.prepare("DELETE FROM movements WHERE id = ?").run(id);
    logAction(null, "MOVEMENT_DELETED", `Deleted movement #${id}`);
    res.json({ success: true });
  });

  app.put("/api/movements/:id", (req, res) => {
    const { id } = req.params;
    const { date, time_in, time_out, division, district, area, branch, purpose, accomplishments, due_date } = req.body;

    try {
      db.prepare(`
        UPDATE movements SET
          date = ?,
          time_in = ?,
          time_out = ?,
          division = ?,
          district = ?,
          area = ?,
          branch = ?,
          purpose = ?,
          accomplishments = ?,
          due_date = ?
        WHERE id = ?
      `).run(date, time_in, time_out, division, district, area, branch, purpose, accomplishments, due_date, id);
      logAction(null, "MOVEMENT_UPDATED", `Updated movement #${id}`);
      res.json({ success: true });
    } catch (e: any) {
      console.error(`[UPDATE MOVEMENT] Error updating movement #${id}:`, e);
      res.status(500).json({ success: false, message: "Failed to update movement: " + e.message });
    }
  });

  app.delete("/api/movements/bulk", (req, res) => {
    const { ids } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid movement IDs" });
    }

    try {
      const deleteTransaction = db.transaction(() => {
        for (const id of ids) {
          db.prepare("DELETE FROM movements WHERE id = ?").run(id);
        }
      });

      deleteTransaction();
      res.json({ success: true });
    } catch (e: any) {
      console.error(`[DELETE BULK MOVEMENTS] Error deleting movements:`, e);
      res.status(500).json({ success: false, message: "Failed to delete movements: " + e.message });
    }
  });

  app.put("/api/movements/bulk/acknowledge", (req, res) => {
    const { ids } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid movement IDs" });
    }

    try {
      const updateTransaction = db.transaction(() => {
        for (const id of ids) {
          db.prepare("UPDATE movements SET status = 'acknowledged' WHERE id = ?").run(id);
        }
      });

      updateTransaction();
      res.json({ success: true });
    } catch (e: any) {
      console.error(`[ACKNOWLEDGE BULK MOVEMENTS] Error acknowledging movements:`, e);
      res.status(500).json({ success: false, message: "Failed to acknowledge movements: " + e.message });
    }
  });

  // Knowledge Base
  app.get("/api/kb", (req, res) => {
    const items = db.prepare("SELECT * FROM knowledge_base ORDER BY created_at DESC").all();
    res.json(items);
  });

  app.post("/api/kb", (req, res) => {
    const { title, category, type, content, version, created_by } = req.body;
    const result = db.prepare(`
      INSERT INTO knowledge_base (title, category, type, content, version, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(title, category, type, content, version, created_by);
    res.json({ success: true, id: result.lastInsertRowid });
  });

  // Dashboard Stats
  app.get("/api/stats", (req, res) => {
    const { timeframe = 'daily', user_id, role } = req.query;
    
    let baseQuery = "FROM movements m";
    let params: any[] = [];
    
    if (role === 'Field Engineer') {
      baseQuery += " WHERE m.staff_id = ?";
      params.push(user_id);
    } else if (role === 'Senior Field Engineer' || role === 'Network Engineer (Field Operations)') {
      baseQuery += " LEFT JOIN users u ON m.staff_id = u.id WHERE m.assigned_supervisor_id = ? OR (u.supervisor_id = ? AND m.assigned_supervisor_id IS NULL) OR m.approved_by = ?";
      params.push(user_id, user_id, user_id);
    }

    const totalMovements = db.prepare(`SELECT COUNT(*) as count ${baseQuery}`).get(...params) as any;
    const pendingApprovals = db.prepare(`SELECT COUNT(*) as count ${baseQuery} ${params.length ? 'AND' : 'WHERE'} m.status = 'pending'`).get(...params) as any;
    const approvedMovements = db.prepare(`SELECT COUNT(*) as count ${baseQuery} ${params.length ? 'AND' : 'WHERE'} m.status = 'approved'`).get(...params) as any;
    const rejectedMovements = db.prepare(`SELECT COUNT(*) as count ${baseQuery} ${params.length ? 'AND' : 'WHERE'} m.status = 'rejected'`).get(...params) as any;
    const unassignedEntries = db.prepare(`SELECT COUNT(*) as count ${baseQuery} ${params.length ? 'AND' : 'WHERE'} (m.division IS NULL OR m.division = '')`).get(...params) as any;
    const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users").get() as any;
    
    const totalForPerformance = approvedMovements.count + rejectedMovements.count;
    const performancePercentage = totalForPerformance > 0 
      ? Math.round((approvedMovements.count / totalForPerformance) * 100) 
      : 100; // Default to 100 if no processed movements
    
    const districtStats = db.prepare(`
      SELECT u.district, COUNT(m.id) as count
      FROM users u
      LEFT JOIN movements m ON u.id = m.staff_id
      WHERE u.district IS NOT NULL
      GROUP BY u.district
    `).all();

    const divisionStats = db.prepare(`
      SELECT division, COUNT(*) as count
      FROM movements
      WHERE division IS NOT NULL
      GROUP BY division
    `).all();

    let trendQuery = "";
    if (timeframe === 'year') {
      trendQuery = `
        SELECT strftime('%Y', date) as date, COUNT(*) as count
        FROM movements
        GROUP BY date
        ORDER BY date DESC
        LIMIT 5
      `;
    } else if (timeframe === 'month') {
      trendQuery = `
        SELECT strftime('%Y-%m', date) as date, COUNT(*) as count
        FROM movements
        GROUP BY date
        ORDER BY date DESC
        LIMIT 12
      `;
    } else {
      // daily
      trendQuery = `
        SELECT date, COUNT(*) as count
        FROM movements
        GROUP BY date
        ORDER BY date DESC
        LIMIT 7
      `;
    }

    let movementTrends = db.prepare(trendQuery).all().reverse();

    // Fill in gaps for trends
    const now = new Date();
    if (timeframe === 'daily') {
      const filledTrends = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const existing = movementTrends.find((t: any) => t.date === dateStr);
        filledTrends.push({
          date: dateStr,
          count: existing ? existing.count : 0
        });
      }
      movementTrends = filledTrends;
    } else if (timeframe === 'month') {
      const filledTrends = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthStr = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        const existing = movementTrends.find((t: any) => t.date === monthStr);
        filledTrends.push({
          date: monthStr,
          count: existing ? existing.count : 0
        });
      }
      movementTrends = filledTrends;
    } else if (timeframe === 'year') {
      const filledTrends = [];
      for (let i = 4; i >= 0; i--) {
        const yearStr = (now.getFullYear() - i).toString();
        const existing = movementTrends.find((t: any) => t.date === yearStr);
        filledTrends.push({
          date: yearStr,
          count: existing ? existing.count : 0
        });
      }
      movementTrends = filledTrends;
    }
    
    res.json({
      totalMovements: totalMovements.count,
      pendingApprovals: pendingApprovals.count,
      approvedMovements: approvedMovements.count,
      rejectedMovements: rejectedMovements.count,
      performancePercentage,
      unassignedEntries: unassignedEntries.count,
      totalUsers: totalUsers.count,
      districtStats,
      divisionStats,
      movementTrends
    });
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
