const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

// This line imports the questions. Make sure data.js is in the same folder.
const { QUESTIONS } = require("./data.js");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "https://mathemix-9c8ba.web.app", // <--- THIS IS THE CORRECT URL
        methods: ["GET", "POST"],
    },
});

const rooms = {};

// Helper to get a random question
const getRandomQuestion = (category) => {
    const questions = QUESTIONS[category];
    return questions[Math.floor(Math.random() * questions.length)];
};

// Helper function to generate a unique room code
const generateRoomCode = () => {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 7).toUpperCase();
    } while (rooms[code]); // Ensure code is unique
    return code;
};

io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    // Host creates a room
    socket.on("createRoom", ({ nickname }) => {
        const roomCode = generateRoomCode();
        socket.join(roomCode);

        const hostPlayer = { id: socket.id, nickname, score: 0 };
        rooms[roomCode] = {
            host: socket.id,
            players: [hostPlayer],
            currentQuestion: null,
            gameStarted: false,
            category: "Number & Algebra",
        };

        // Tell the host they succeeded and what their room code is
        socket.emit("roomCreated", { roomCode, players: rooms[roomCode].players });
        console.log(`${nickname} created room ${roomCode}`);
    });

    // Joiner joins an existing room
    socket.on("joinRoom", ({ roomCode, nickname }) => {
        const code = roomCode.toUpperCase();

        // Check if room exists
        if (!rooms[code]) {
            return socket.emit("error", "Room not found. Check the code and try again.");
        }
        // Check if game is in progress
        if (rooms[code].gameStarted) {
            return socket.emit("error", "Game is already in progress. Cannot join.");
        }

        socket.join(code);
        const player = { id: socket.id, nickname, score: 0 };
        rooms[code].players.push(player);

        // Tell the joiner they succeeded
        socket.emit("joinedRoom", { roomCode: code, players: rooms[code].players });
        // Tell everyone else in the room (including host) about the new player
        socket.to(code).emit("updatePlayers", rooms[code].players);

        console.log(`${nickname} joined ${code}`);
    });

    // Host starts the game
    socket.on("startGame", ({ roomCode, category }) => {
        const room = rooms[roomCode];
        if (!room || socket.id !== room.host) return;

        room.gameStarted = true;
        room.category = category;

        const question = getRandomQuestion(category);
        room.currentQuestion = question;
        room.roundStartTime = Date.now();
        room.answeredPlayers = [];

        io.to(roomCode).emit("newQuestion", {
            definition: question.definition,
            answerLength: question.answer.length,
            answerMask: question.answer.replace(/[A-Z0-9()]/g, '_')
        });
        io.to(roomCode).emit("updateLeaderboard", room.players);
    });

    // Host requests the next round
    socket.on("nextRound", ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || socket.id !== room.host) return;

        const question = getRandomQuestion(room.category);
        room.currentQuestion = question;
        room.roundStartTime = Date.now();
        room.answeredPlayers = [];

        io.to(roomCode).emit("newQuestion", {
            definition: question.definition,
            answerLength: question.answer.length,
            answerMask: question.answer.replace(/[A-Z0-9()]/g, '_')
        });
        io.to(roomCode).emit("revealAnswer", null);
    });

    // Player submits an answer
    socket.on("submitAnswer", ({ roomCode, answer }) => {
        const room = rooms[roomCode];
        if (!room || !room.currentQuestion || room.answeredPlayers.includes(socket.id)) return;

        const player = room.players.find((p) => p.id === socket.id);
        if (!player) return;

        room.answeredPlayers.push(socket.id);

        if (answer.toUpperCase() === room.currentQuestion.answer) {
            const timeTaken = (Date.now() - room.roundStartTime) / 1000;
            const score = Math.max(10, 100 - Math.floor(timeTaken * 2));
            player.score += score;
            socket.emit("answerResult", { correct: true, scoreAdded: score });

            if (room.answeredPlayers.length === room.players.length) {
                io.to(roomCode).emit("revealAnswer", room.currentQuestion.answer);
            }
        } else {
            socket.emit("answerResult", { correct: false, scoreAdded: 0 });
        }

        io.to(roomCode).emit("updateLeaderboard", room.players);
    });

    // Handle player disconnect
    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.findIndex((p) => p.id === socket.id);

            if (playerIndex > -1) {
                room.players.splice(playerIndex, 1);
                io.to(roomCode).emit("updatePlayers", room.players);

                if (room.host === socket.id && room.players.length > 0) {
                    room.host = room.players[0].id;
                    io.to(roomCode).emit("updatePlayers", room.players);
                }
                break;
            }
        }
    });
});

// Port configuration
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`WebSocket server listening on port ${PORT}`);
});