// Create (or reset the password of) an admin account.
// Usage: npm run create-admin -- <email> <password> [name]
import '../config/env.js';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';

const [email, password, name = 'Admin'] = process.argv.slice(2);

if (!email || !password) {
  console.error('Usage: npm run create-admin -- <email> <password> [name]');
  process.exit(1);
}
if (password.length < 6) {
  console.error('Password must be at least 6 characters');
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGODB_URI);
  const hashedPassword = await bcrypt.hash(password, 10);
  const existing = await User.findOne({ email: email.toLowerCase() });

  if (existing) {
    existing.password = hashedPassword;
    existing.role = 'admin';
    existing.isActive = true;
    await existing.save();
    console.log(`✅ Updated existing user ${email} as admin`);
  } else {
    await User.create({ email, password: hashedPassword, role: 'admin', name, isActive: true });
    console.log(`✅ Created admin ${email}`);
  }
} catch (error) {
  console.error('❌ Failed to create admin:', error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
