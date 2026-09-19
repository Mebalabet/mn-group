const readline = require('readline');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const db = require('../db');

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });

    if (!hidden) {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    process.stdout.write(question);
    let value = '';
    const onData = (char) => {
      char = String(char);
      if (char === '\n' || char === '\r') {
        process.stdin.setRawMode(false);
        process.stdin.off('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(value);
      } else if (char === '\u0003') {
        process.exit(1);
      } else if (char === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.on('data', onData);
  });
}

(async () => {
  try {
    const name = await ask('Admin name: ');
    const email = (await ask('Admin email: ')).toLowerCase();
    const password = await ask('Admin password (12+ characters): ', true);

    if (!name || !email || password.length < 12) {
      throw new Error('Name, email, and a password of at least 12 characters are required.');
    }

    const existing = await db.findUserByEmail(email);
    const passwordHash = await bcrypt.hash(password, 12);

    if (existing) {
      if (existing.role === 'admin') {
        console.log('[admin] This account is already an admin.');
        process.exit(0);
      }

      if (typeof db.promoteUserByEmail !== 'function') {
        throw new Error('Database adapter does not support secure admin promotion yet.');
      }

      await db.promoteUserByEmail(email);
      await db.insertAuditLog({ id: randomUUID(), userId: existing.id, action: 'admin.promoted', details: { email, via: 'create-admin script' }, createdAt: new Date().toISOString() });
      console.log('[admin] Existing account promoted to admin.');
    } else {
      const newAdmin = {
        id: randomUUID(),
        name,
        email,
        passwordHash,
        role: 'admin',
        createdAt: new Date().toISOString()
      };
      await db.insertUser(newAdmin);
      await db.insertAuditLog({ id: randomUUID(), userId: newAdmin.id, action: 'admin.created', details: { email, via: 'create-admin script' }, createdAt: new Date().toISOString() });
      console.log('[admin] New admin account created.');
    }
  } catch (err) {
    console.error('[admin] Failed:', err.message);
    process.exitCode = 1;
  }
})();
