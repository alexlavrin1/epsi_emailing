/**
 * Loads environment variables from .env.local if present, falling back to .env.
 * require() this once at the top of any entry point instead of calling
 * dotenv directly — dotenv's own .config() only reads a file named exactly ".env".
 */
const fs = require('fs');
const path = require('path');

const envLocalPath = path.resolve(process.cwd(), '.env.local');
const envPath = fs.existsSync(envLocalPath) ? envLocalPath : path.resolve(process.cwd(), '.env');

require('dotenv').config({ path: envPath });
