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

app.get("/", (req, res) => {
  res.send("Proyecto Learnhub está funcionando!");
});

// Middleware para JSON y CORS
app.use(express.json());
app.use(cors({
  origin: "*",
  methods: ['GET', 'POST', 'OPTIONS']
}));

// Escuchar el evento de conexión de Socket.IO
io.on('connection', (socket) => {
  console.log("Usuario conectado");

  // Evento para unirse a una sala
  socket.on("joinRoom", async (room) => {
    try {
      console.log(`El usuario se unió a la sala: ${room}`);
      socket.join(room);

      const [idprof, idalumno] = room.split('-').map(Number);

      const result = await pool.query(
        "SELECT * FROM messages WHERE idprof = $1 AND idalumno = $2 ORDER BY timestamp ASC",
        [idprof, idalumno]
      );

      socket.emit("previousMessages", result.rows);
    } catch (error) {
      console.error("Error al obtener mensajes anteriores:", error);
    }
  });

  // Manejar el evento de mensaje
  socket.on("chat message", async (message) => {
    console.log('Mensaje recibido en el backend:', message);
    message.timestamp = new Date().toISOString();

    const sender = message.idprof === parseInt(message.senderId) ? 'profesor' : 'alumno';
    message.sender = sender;

    await pool.query(
      "INSERT INTO messages (idprof, idalumno, content, timestamp, sender) VALUES ($1, $2, $3, $4, $5)",
      [message.idprof, message.idalumno, message.content, message.timestamp, sender]
    );

    socket.broadcast.to(message.room).emit("chat message", message);
    console.log(`Mensaje reenviado a la sala: ${message.room}`);
  });

  socket.on("disconnect", () => {
    console.log("Usuario desconectado");
  });
});

// Endpoint para eliminar un chat (elimina todos los mensajes relacionados con idprof y idalumno)
app.delete('/api/chats', async (req, res) => {
  const { idprof, idalumno } = req.body;
  if (!idprof || !idalumno) {
    return res.status(400).json({ error: "Faltan datos necesarios para eliminar el chat." });
  }

  try {
    await pool.query("DELETE FROM messages WHERE idprof = $1 AND idalumno = $2", [idprof, idalumno]);
    res.status(200).json({ message: "Chat eliminado correctamente." });
  } catch (error) {
    console.error("Error al eliminar el chat:", error);
    res.status(500).json({ error: "Error al eliminar el chat." });
  }
});

// Endpoint para obtener los chats de un usuario
app.get('/api/chats', async (req, res) => {
  const { tipoUsuario, userId } = req.query;
  try {
    let query = `
      SELECT messages.id, messages.idprof, messages.idalumno, messages.content, messages.timestamp, 
             CASE 
                 WHEN $1 = 'profesor' THEN alumnos.nombre || ' ' || alumnos.apellido 
                 ELSE profesores.nombre || ' ' || profesores.apellido 
             END AS otherUserName
      FROM messages
      LEFT JOIN profesores ON messages.idprof = profesores."ID"
      LEFT JOIN alumnos ON messages.idalumno = alumnos."ID"
      WHERE ($1 = 'profesor' AND messages.idprof = $2) OR ($1 = 'alumno' AND messages.idalumno = $2)
      GROUP BY messages.id, messages.idprof, messages.idalumno, alumnos.nombre, alumnos.apellido, profesores.nombre, profesores.apellido
      ORDER BY messages.timestamp DESC;
    `;

    const values = [tipoUsuario, userId];
    const { rows } = await pool.query(query, values);

    const chats = rows.map(row => ({
      otherUserName: row.otherUserName,
      idprof: row.idprof,
      idalumno: row.idalumno,
      lastMessage: row.content,
      timestamp: row.timestamp
    }));

    res.json(chats);
  } catch (error) {
    console.error("Error al obtener chats:", error);
    res.status(500).json({ message: "Error al obtener los chats" });
  }
});

// Iniciar el servidor
server.listen(port, () => {
  console.log(`Servidor Socket.IO y Express escuchando en el puerto ${port}`);
});
