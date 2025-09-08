const { Server } = require("socket.io");
const countries = require("../data/countries");

let queue = [];
let games = new Map();

function normalizeName(s) {
  if (!s) {
    return "";
  }

  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/^[\s]*the\s+/, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIASES = new Map([
  ["uk", "united kingdom"],
  ["u k", "united kingdom"],
  ["great britain", "united kingdom"],
  ["britain", "united kingdom"],

  ["usa", "united states of america"],
  ["u s a", "united states of america"],
  ["us", "united states of america"],
  ["u s", "united states of america"],
  ["united states", "united states of america"],

  ["uae", "united arab emirates"],
  ["u a e", "united arab emirates"],

  ["netherlands", "netherlands"],
  ["bahamas", "bahamas"],
  ["gambia", "gambia"],
  ["cabo verde", "cabo verde"],
  ["cape verde", "cabo verde"],

  ["ivory coast", "cote divoire"],
  ["cote divoire", "cote divoire"],

  ["czech republic", "czechia"],
  ["russia", "russian federation"],
  ["south korea", "korea republic of"],
  ["north korea", "korea democratic peoples republic of"],
  ["swaziland", "eswatini"],
  ["vatican", "holy see"],
  ["bolivia", "bolivia plurinational state of"],
  ["moldova", "moldova republic of"],
  ["laos", "lao peoples democratic republic"],
  ["brunei", "brunei darussalam"],
  ["iran", "iran islamic republic of"],
  ["tanzania", "tanzania united republic of"],
  ["palestine", "palestine state of"],
  ["syria", "syrian arab republic"],
  ["macedonia", "republic of north macedonia"],
]);

function canonicalize(s) {
  const n = normalizeName(s);
  return ALIASES.get(n) || n;
}

function isAnswerCorrect(answer, correct) {
  const a = canonicalize(answer);
  const c = canonicalize(correct);

  if (!a || !c) {
    return false;
  }
  
  if (a === c) {
    return true;
  }

  if (a.length >= 3 && new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(c)) {
    return true;
  }

  if (c.length >= 3 && new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(a)) {
    return true;
  }

  return false;
}

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

  game.io.to(gameId).emit("newQuestion", {
    flagUrl,
    questionNum: game.currentQuestion + 1,
  });

  let answered = false;

  const answerHandlers = game.players.map((player, index) => {
    const handler = (ans) => {
      if (answered) {
        return;
      }

      if (isAnswerCorrect(ans, question.name)) {
        answered = true;
        clearTimeout(timeout);
        cleanup();
        game.scores[index]++;
        game.io.to(gameId).emit("correctAnswer", {
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
      game.io.to(gameId).emit("timeUp", { correct: question.name });
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

  game.io.to(gameId).emit("gameEnd", results);
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
