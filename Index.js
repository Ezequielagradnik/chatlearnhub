import { Server } from "socket.io";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { pool } from './dbconfig.js';

const app = express();
const port = 3001;

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json());
app.use(cors({
  origin: "*",
  methods: ['GET', 'POST']
}));

// Endpoint para obtener los chats de un usuario (alumno o profesor)
app.get("/api/chats", async (req, res) => {
  const { tipoUsuario, userId } = req.query;
  console.log(`tipoUsuario: ${tipoUsuario}, userId: ${userId}`);
  try {
    let query = '';
    let params = [];
    
    if (tipoUsuario === 'alumno') {
      query = `SELECT profesores."ID" AS otherUserId, profesores.nombre AS otherUserName
                FROM messages 
                JOIN profesores ON profesores."ID" = messages.idprof
                WHERE messages.idalumno = $1
                GROUP BY profesores."ID"`;
      params = [userId];
    } else if (tipoUsuario === 'profesor') {
      query = `SELECT alumnos."ID" AS otherUserId, alumnos.nombre AS otherUserName
                FROM messages 
                JOIN alumnos ON alumnos."ID" = messages.idalumno
                WHERE messages.idprof = $1
                GROUP BY alumnos."ID"`;
      params = [userId];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener los chats:", error);
    res.status(500).json({ error: "Error al obtener los chats." });
  }
});

// Endpoint para obtener mensajes en una sala específica
app.get("/api/messages", async (req, res) => {
  const { room } = req.query;
  if (!room) {
    res.status(400).json({ error: "Missing room parameter." });
    return;
  }

  const [idprof, idalumno] = room.split('-').map(Number);
  if (isNaN(idprof) || isNaN(idalumno)) {
    res.status(400).json({ error: "Invalid room format." });
    return;
  }

  try {
    const result = await pool.query(
      "SELECT content, timestamp, sender FROM messages WHERE idprof = $1 AND idalumno = $2 ORDER BY timestamp ASC",
      [idprof, idalumno]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener mensajes:", error);
    res.status(500).json({ error: "Error al obtener los mensajes." });
  }
});

// Configuración de Socket.io
io.on("connection", (socket) => {
  console.log("Usuario conectado");

  socket.on("joinRoom", async (room) => {
    try {
      socket.join(room);
      const [idprof, idalumno] = room.split('-').map(Number);
      const result = await pool.query(
        "SELECT content, timestamp, sender FROM messages WHERE idprof = $1 AND idalumno = $2 ORDER BY timestamp ASC",
        [idprof, idalumno]
      );
      socket.emit("previousMessages", result.rows);
    } catch (error) {
      console.error("Error al obtener mensajes anteriores:", error);
    }
  });

  socket.on("chat message", async (message) => {
    message.timestamp = new Date().toISOString();

    const mensajesPrevios = await pool.query(
      "SELECT * FROM messages WHERE idprof = $1 AND idalumno = $2",
      [message.idprof, message.idalumno]
    );

    if (mensajesPrevios.rowCount === 0) {
      io.emit("newChat", { idprof: message.idprof, idalumno: message.idalumno });
    }

    await pool.query(
      "INSERT INTO messages (idprof, idalumno, content, timestamp, sender) VALUES ($1, $2, $3, $4, $5)",
      [message.idprof, message.idalumno, message.content, message.timestamp, message.sender]
    );

    socket.broadcast.to(message.room).emit("chat message", {
      content: message.content,
      timestamp: message.timestamp,
      sender: message.sender
    });
  });

  socket.on("disconnect", () => {
    console.log("Usuario desconectado");
  });
});

server.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
