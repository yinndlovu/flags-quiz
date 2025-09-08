const { Server } = require("socket.io");
const countries = require("../data/countries");

let queue = [];
let games = new Map();

function generateQuestions(num) {
  const selectedIndices = [];
  while (selectedIndices.length < num) {
    const idx = Math.floor(Math.random() * countries.length);

    if (!selectedIndices.includes(idx)) {
      selectedIndices.push(idx);
    }
  }
  return selectedIndices.map((idx) => countries[idx]);
}

function startNextQuestion(gameId) {
  const game = games.get(gameId);

  if (!game || game.currentQuestion >= 10) {
    endGame(gameId);
    return;
  }

  const question = game.questions[game.currentQuestion];
  const flagUrl = `https://flagsapi.com/${question.code}/flat/64.png`;

  game.players[0].io.to(gameId).emit("newQuestion", {
    flagUrl,
    questionNum: game.currentQuestion + 1,
  });

  let answered = false;

  const answerHandlers = game.players.map((player, index) => {
    const handler = (ans) => {
      if (answered) {
        return;
      }

      if (ans.toLowerCase().trim() === question.name.toLowerCase()) {
        answered = true;
        clearTimeout(timeout);
        cleanup();
        game.scores[index]++;
        game.players[0].io.to(gameId).emit("correctAnswer", {
          playerId: player.id,
          correct: question.name,
        });
        game.currentQuestion++;
        setTimeout(() => startNextQuestion(gameId), 2000);
      } else {
        player.emit("wrongAnswer");
      }
    };
    player.on("answer", handler);
    return handler;
  });

  const cleanup = () => {
    game.players.forEach((player, i) =>
      player.off("answer", answerHandlers[i])
    );
  };

  const timeoutCallback = () => {
    if (!answered) {
      cleanup();
      game.players[0].io.to(gameId).emit("timeUp", { correct: question.name });
      game.currentQuestion++;
      startNextQuestion(gameId);
    }
  };

  const timeout = setTimeout(timeoutCallback, 15000);
}

function endGame(gameId) {
  const game = games.get(gameId);

  if (!game) {
    return;
  }

  const results = {
    player1: { id: game.players[0].id, score: game.scores[0] },
    player2: { id: game.players[1].id, score: game.scores[1] },
  };

  game.players[0].io.to(gameId).emit("gameEnd", results);
  games.delete(gameId);
}

module.exports = (server) => {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    socket.on("joinGame", () => {
      queue.push(socket);
      
      if (queue.length >= 2) {
        const player1 = queue.shift();
        const player2 = queue.shift();
        const gameId = Math.random().toString(36).substr(2, 9);
        const questions = generateQuestions(10);

        games.set(gameId, {
          players: [player1, player2],
          scores: [0, 0],
          currentQuestion: 0,
          questions,
          io,
        });

        player1.join(gameId);
        player2.join(gameId);

        player1.emit("gameStart", { gameId, opponentId: player2.id });
        player2.emit("gameStart", { gameId, opponentId: player1.id });

        startNextQuestion(gameId);
      } else {
        socket.emit("waitingForOpponent");
      }
    });

    socket.on("disconnect", () => {
      queue = queue.filter((s) => s !== socket);

      for (const [gameId, game] of games.entries()) {
        if (game.players.includes(socket)) {
          io.to(gameId).emit("opponentDisconnected");
          endGame(gameId);
        }
      }
    });
  });
};
