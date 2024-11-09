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

      // Desestructurar idprof e idalumno del room
      const [idprof, idalumno] = room.split('-').map(Number);


      // Consultar los mensajes anteriores
      const result = await pool.query(
        "SELECT * FROM messages WHERE idprof = $1 AND idalumno = $2 ORDER BY timestamp ASC",
        [idprof, idalumno]
      );

      // Enviar los mensajes antiguos solo al socket que se acaba de conectar
      socket.emit("previousMessages", result.rows);
    } catch (error) {
      console.error("Error al obtener mensajes anteriores:", error);
    }
  });

  // Manejar el evento de mensaje
  socket.on("chat message", async (message) => {
    console.log('Mensaje recibido en el backend:', message);
    message.timestamp = new Date().toISOString();

    // Determinar el remitente y agregarlo al mensaje
    const sender = message.idprof === parseInt(message.senderId) ? 'profesor' : 'alumno';
    message.sender = sender;
    

     // Guardar el mensaje en la base de datos
     await pool.query(
     "INSERT INTO messages (idprof, idalumno, content, timestamp, sender) VALUES ($1, $2, $3, $4, $5)",
     [message.idprof, message.idalumno, message.content, message.timestamp, sender]
     );

    // Emitir el mensaje a todos los usuarios en la sala excepto al que lo envió
    socket.broadcast.to(message.room).emit("chat message", message);
    console.log(`Mensaje reenviado a la sala: ${message.room}`);
  });


  // Manejar la desconexión del usuario
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
    console.log(messageId)

     // Determina el remitente con una verificación explícita
     const sender = senderId === idprof ? 'profesor' : senderId === idalumno ? 'alumno' : null;

     if (!sender) {
       return res.status(400).json({ error: "El ID del remitente no coincide con ninguno de los IDs." });
     }

    // Emite el mensaje a la sala específica
    io.to(req.body.room).emit("chat message", {
      id: messageId,
      idprof,
      idalumno,
      content,
      timestamp: new Date(),
      sender, 
      room: req.body.room
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

// Endpoint para eliminar un mensaje específico por ID
app.delete('/api/messages/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query("DELETE FROM messages WHERE id = $1", [id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Mensaje no encontrado" });
    }
    
    res.status(200).json({ message: "Mensaje eliminado correctamente." });
  } catch (error) {
    console.error("Error al eliminar el mensaje:", error);
    res.status(500).json({ error: "Error al eliminar el mensaje." });
  }
});


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

server.listen(port, () => {
  console.log(`Servidor Socket.IO y Express escuchando en el puerto ${port}`);
});
