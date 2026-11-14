import { getDatabase, getDatabasePath } from "../lib/database";

getDatabase();
console.log(`SQLite database initialized: ${getDatabasePath()}`);
