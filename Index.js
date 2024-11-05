import { Server } from "socket.io";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import {pool} from './dbconfig.js';


app.get("/", (req, res) => {
  res.send("Proyecto Learnhub está funcionando!");
});


const app = express();
const port = 3000;

app.listen(port, () => {
    console.log(`Learnhub escuchando en el puerto ${port}!`);
  });
  
  
  
// Middleware para JSON y CORS
app.use(express.json());
app.use(cors({
  origin: "*", // origen permitido
  methods: ['GET', 'POST', 'OPTIONS']
}));

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// CHAT: 
io.on('connection', (socket) => {
  console.log("Usuario conectado");

  socket.on("disconnect", () => {
    console.log("Usuario desconectado");
  });
});

// Manejador POST para guardar un mensaje y emitirlo con Socket.IO
app.post('/api/messages', async (req, res) => {
  const { idprof, idalumno, content } = req.body;
  if (!idprof || !idalumno || !content) {
    return res.status(400).json({ error: "Faltan datos necesarios para el mensaje." });
  }

  try {
    const result = await pool.query(
      "INSERT INTO messages (idprof, idalumno, content, timestamp) VALUES ($1, $2, $3, NOW()) RETURNING id",
      [idprof, idalumno, content]
    );
    const messageId = result.rows[0].id;

    io.emit("chat message", {
      id: messageId,
      idprof,
      idalumno,
      content,
      timestamp: new Date()
    });

    res.status(201).json({ id: messageId });
  } catch (error) {
    console.error("Error al guardar el mensaje:", error);
    res.status(500).json({ error: "Error al guardar el mensaje." });
  }
});

app.get('/api/messages', async (req, res) => {
  const { idprof, idalumno } = req.query;
  try {
    const result = await pool.query(
      "SELECT * FROM messages WHERE idprof = $1 AND idalumno = $2 ORDER BY timestamp ASC",
      [idprof, idalumno]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener mensajes:", error);
    res.status(500).json({ error: "Error al obtener mensajes" });
  }
});

app.get('/api/chats', async (req, res) => {
  const { userId, tipoUsuario } = req.query;

  try {
    const query = `
      SELECT 
        CASE 
            WHEN m.idprof = p."ID" THEN p.nombre || ' ' || p.apellido
            WHEN m.idalumno = a."ID" THEN a.nombre || ' ' || a.apellido
        END AS nombre,
        m.idprof, m.idalumno
      FROM messages m
      LEFT JOIN profesores p ON m.idprof = p."ID"
      LEFT JOIN alumnos a ON m.idalumno = a."ID"
      WHERE ${tipoUsuario === 'profesor' ? 'm.idprof' : 'm.idalumno'} = $1
      GROUP BY m.idprof, m.idalumno, p."ID", a."ID", p.nombre, p.apellido, a.nombre, a.apellido
    `;

    const result = await pool.query(query, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener la lista de chats:", error);
    res.status(500).json({ error: "Error al obtener la lista de chats" });
  }
});


