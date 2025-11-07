const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

// We need the questions on the server to check answers
const { QUESTIONS } = require("./data.js");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "https://mathemix-9c8ba.web.app", // Your live React app URL
        methods: ["GET", "POST"],
    },
});

const rooms = {};

const getRandomQuestion = (category) => {
    const questions = QUESTIONS[category];
    return questions[Math.floor(Math.random() * questions.length)];
};

io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("joinRoom", ({ roomCode, nickname }) => {
        socket.join(roomCode);

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                host: socket.id,
                players: [],
                currentQuestion: null,
                gameStarted: false,
                category: "Number & Algebra", // Default category
            };
        }

        const player = { id: socket.id, nickname, score: 0 };
        rooms[roomCode].players.push(player);

        // Tell everyone in the room about the new player list
        io.to(roomCode).emit("updatePlayers", rooms[roomCode].players);
        console.log(`${nickname} joined ${roomCode}`);
    });

    // Host starts the game
    socket.on("startGame", ({ roomCode, category }) => {
        const room = rooms[roomCode];
        if (!room || socket.id !== room.host) return;

        room.gameStarted = true;
        room.category = category;

        // Pick first question
        const question = getRandomQuestion(category);
        room.currentQuestion = question;
        room.roundStartTime = Date.now();
        room.answeredPlayers = []; // Track who has answered this round

        // Send the first question to everyone
        io.to(roomCode).emit("newQuestion", {
            definition: question.definition,
            answerLength: question.answer.length,
            answerMask: question.answer.replace(/[A-Z0-9()]/g, '_') // Show spaces/etc.
        });
        // Send initial leaderboard
        io.to(roomCode).emit("updateLeaderboard", room.players);
    });

    // Host requests the next round
    socket.on("nextRound", ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || socket.id !== room.host) return;

        const question = getRandomQuestion(room.category);
        room.currentQuestion = question;
        room.roundStartTime = Date.now();
        room.answeredPlayers = []; // Reset for new round

        // Send the next question
        io.to(roomCode).emit("newQuestion", {
            definition: question.definition,
            answerLength: question.answer.length,
            answerMask: question.answer.replace(/[A-Z0-9()]/g, '_')
        });
        // Reset revealed answer
        io.to(roomCode).emit("revealAnswer", null);
    });


    // Player submits an answer
    socket.on("submitAnswer", ({ roomCode, answer }) => {
        const room = rooms[roomCode];
        if (!room || !room.currentQuestion || room.answeredPlayers.includes(socket.id)) return;

        const player = room.players.find((p) => p.id === socket.id);
        if (!player) return;

        // Mark as answered so they can't submit again
        room.answeredPlayers.push(socket.id);

        if (answer.toUpperCase() === room.currentQuestion.answer) {
            // Correct! Calculate score
            const timeTaken = (Date.now() - room.roundStartTime) / 1000; // seconds
            const score = Math.max(10, 100 - Math.floor(timeTaken * 2)); // Lose 2 pts/sec
            player.score += score;

            socket.emit("answerResult", { correct: true, scoreAdded: score });

            // Check if all players have answered
            if (room.answeredPlayers.length === room.players.length) {
                io.to(roomCode).emit("revealAnswer", room.currentQuestion.answer);
            }

        } else {
            // Wrong answer
            socket.emit("answerResult", { correct: false, scoreAdded: 0 });
        }

        // Update leaderboard for everyone
        io.to(roomCode).emit("updateLeaderboard", room.players);
    });

    // Handle player disconnect
    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        // Find room player was in
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.findIndex((p) => p.id === socket.id);

            if (playerIndex > -1) {
                room.players.splice(playerIndex, 1);
                // Tell remaining players
                io.to(roomCode).emit("updatePlayers", room.players);

                // If host disconnected, assign a new host
                if (room.host === socket.id && room.players.length > 0) {
                    room.host = room.players[0].id;
                    io.to(roomCode).emit("updatePlayers", room.players); // Emit again to update host status
                }
                break;
            }
        }
    });
});

// THIS IS THE FINAL FIX FOR RENDER
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`WebSocket server listening on port ${PORT}`);
});