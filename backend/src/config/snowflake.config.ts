import * as fs from 'fs';
import * as crypto from 'crypto';

export default () => {
  // Load and decrypt private key like in test-connection.js
  let privateKey: string;
  
  try {
    if (process.env.SNOWFLAKE_PRIVATE_KEY) {
      // If private key is provided directly as string
      privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
    } else if (process.env.SNOWFLAKE_PRIVATE_KEY_PATH) {
      // If private key path is provided (like in test-connection.js)
      const privateKeyData = fs.readFileSync(process.env.SNOWFLAKE_PRIVATE_KEY_PATH, 'utf8');
      
      const keyObject = crypto.createPrivateKey({
        key: privateKeyData,
        passphrase: process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE
      });
      
      privateKey = keyObject.export({
        type: 'pkcs8',
        format: 'pem'
      }).toString();
    } else {
      throw new Error('Neither SNOWFLAKE_PRIVATE_KEY nor SNOWFLAKE_PRIVATE_KEY_PATH is set');
    }
  } catch (error) {
    console.error('Failed to load private key:', error.message);
    throw error;
  }

  return {
    snowflake: {
      account: process.env.SNOWFLAKE_ACCOUNT,
      user: process.env.SNOWFLAKE_USER,
      role: process.env.SNOWFLAKE_ROLE,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      database: process.env.SNOWFLAKE_DATABASE,
      schema: process.env.SNOWFLAKE_SCHEMA,
      stage: process.env.SNOWFLAKE_STAGE,
      model: process.env.SNOWFLAKE_MODEL,
      privateKey: privateKey,
      passphrase: process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE,
    },
  };
};
