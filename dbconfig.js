import pg from "pg";

const { Pool } = pg;



export const pool = new Pool({
    user: "default",
    host: "ep-late-dream-a47fp0wv-pooler.us-east-1.aws.neon.tech",
    database: "verceldb",
    password: "ha1HAPemuLj2" ,
    port: 5432,
    ssl: true
});
