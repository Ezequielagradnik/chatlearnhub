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
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS']
}));

// Endpoint para obtener los chats de un usuario (alumno o profesor)
app.get("/api/chats", async (req, res) => {
  const { tipoUsuario, userId } = req.query;
  console.log(`tipoUsuario: ${tipoUsuario}, userId: ${userId}`);  // Log para depuración
  try {
    let query = '';
    let params = [];
    
    if (tipoUsuario === 'alumno') {
      query = `
        SELECT profesores.ID AS otherUserId, profesores.nombre AS otherUserName, 
               MAX(messages.timestamp) AS lastMessageTimestamp, 
               MAX(messages.content) AS lastMessage
        FROM messages 
        JOIN profesores ON profesores.ID = messages.idprof
        WHERE messages.idalumno = $1
        GROUP BY profesores.ID
      `;
      params = [userId];
    } else if (tipoUsuario === 'profesor') {
      query = `
        SELECT alumnos.ID AS otherUserId, alumnos.nombre AS otherUserName, 
               MAX(messages.timestamp) AS lastMessageTimestamp, 
               MAX(messages.content) AS lastMessage
        FROM messages 
        JOIN alumnos ON alumnos.ID = messages.idalumno
        WHERE messages.idprof = $1
        GROUP BY alumnos.ID
      `;
      params = [userId];
    }

    const result = await pool.query(query, params);
    console.log(result.rows);  // Verifica el resultado de la consulta

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener los chats:", error);
    res.status(500).json({ error: "Error al obtener los chats." });
  }
});

// Endpoint para obtener mensajes en una sala específica
app.get("/api/messages", async (req, res) => {
  const { room } = req.query;
  const [idprof, idalumno] = room.split('-').map(Number);
  
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

// Endpoint para eliminar un mensaje
app.delete("/api/messages/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      "DELETE FROM messages WHERE id = $1",
      [id]
    );
    res.json({ message: "Mensaje eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar el mensaje:", error);
    res.status(500).json({ error: "Error al eliminar el mensaje." });
  }
});

// Endpoint para eliminar un chat (todos los mensajes entre un profesor y un alumno)
app.delete("/api/chats", async (req, res) => {
  const { idprof, idalumno } = req.query;

  if (!idprof || !idalumno) {
    return res.status(400).json({ error: "Se requieren idprof y idalumno" });
  }

  try {
    await pool.query(
      "DELETE FROM messages WHERE idprof = $1 AND idalumno = $2",
      [idprof, idalumno]
    );
    res.json({ message: "Chat eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar el chat:", error);
    res.status(500).json({ error: "Error al eliminar el chat." });
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
    await pool.query(
      "INSERT INTO messages (idprof, idalumno, content, timestamp, sender) VALUES ($1, $2, $3, $4, $5)",
      [message.idprof, message.idalumno, message.content, message.timestamp, message.sender]
    );

    socket.broadcast.to(message.room).emit("chat message", {
      content: message.content,
      timestamp: message.timestamp,
      sender: message.sender
    });

    // Notificar al profesor de un nuevo chat
    io.to(message.room).emit("newChat", { idprof: message.idprof, idalumno: message.idalumno });
  });

  socket.on("disconnect", () => {
    console.log("Usuario desconectado");
  });
});

server.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
