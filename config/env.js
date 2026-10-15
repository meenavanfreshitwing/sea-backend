// Imported first by entry points so every module sees .env values
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve relative to the project root so it works from any working directory
dotenv.config({ path: path.join(__dirname, '../.env'), quiet: true });
