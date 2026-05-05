require('dotenv').config();
const bcrypt = require('bcryptjs');

async function main() {
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = await bcrypt.hash(password, 10);
  console.log('Add this to your .env file:');
  console.log(`ADMIN_PASSWORD_HASH=${hash}`);
}

main();
