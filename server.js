const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let players = [];
let phase = "waiting";
let votes = {};
let nightKill = null;
let protectedLastNight = null;
let protectedTonight = null;
let witchHealUsed = false;
let witchKillUsed = false;
let trialCandidates = [];

function alivePlayers() {
  return players.filter(p => p.alive);
}

function wolvesAlive() {
  return players.filter(p => p.alive && p.role === "Sói").length;
}

function villagersAlive() {
  return players.filter(p => p.alive && p.role !== "Sói").length;
}

function assignRoles() {
  const N = players.length;
  const wolfCount = Math.floor(N / 3);

  let roles = [];

  for (let i = 0; i < wolfCount; i++) roles.push("Sói");
  roles.push("Bảo Vệ");
  roles.push("Phù Thủy");

  while (roles.length < N) roles.push("Dân");

  roles.sort(() => Math.random() - 0.5);

  players.forEach((p, i) => {
    p.role = roles[i];
    p.alive = true;
  });
}

function checkWin() {
  const wolves = wolvesAlive();
  const villagers = villagersAlive();

  if (wolves === 0) {
    io.emit("gameOver", "Dân thắng");
    resetGame();
  }

  if (wolves >= villagers) {
    io.emit("gameOver", "Sói thắng");
    resetGame();
  }
}

function resetGame() {
  phase = "waiting";
  players = [];
}

function timer(seconds, next) {
  let time = seconds;
  io.emit("timer", time);
  const t = setInterval(() => {
    time--;
    io.emit("timer", time);
    if (time <= 0) {
      clearInterval(t);
      next();
    }
  }, 1000);
}

function startNight() {
  phase = "protect";
  votes = {};
  nightKill = null;
  protectedTonight = null;

  io.emit("phase", "Bảo Vệ chọn");
  timer(15, wolfPhase);
}

function wolfPhase() {
  phase = "wolf";
  votes = {};
  io.emit("phase", "Sói chọn");
  timer(15, witchPhase);
}

function witchPhase() {
  phase = "witch";
  io.emit("witchInfo", nightKill);
  timer(15, resolveNight);
}

function resolveNight() {
  let victim = nightKill;

  if (victim === protectedTonight) victim = null;

  if (victim) {
    const p = players.find(x => x.id === victim);
    if (p) p.alive = false;
  }

  protectedLastNight = protectedTonight;

  startDay(victim);
}

function startDay(victim) {
  phase = "announce";
  io.emit("dayResult", victim);
  checkWin();
  phase = "discussion";
  io.emit("phase", "Thảo luận");
  timer(90, startVote);
}

function startVote() {
  phase = "vote";
  votes = {};
  io.emit("phase", "Vote");
  timer(15, resolveVote);
}

function resolveVote() {
  let count = {};
  for (let v in votes) count[votes[v]] = (count[votes[v]] || 0) + 1;

  let max = 0;
  let top = [];
  for (let id in count) {
    if (count[id] > max) {
      max = count[id];
      top = [id];
    } else if (count[id] === max) {
      top.push(id);
    }
  }

  if (top.length === 1) {
    eliminate(top[0]);
  } else if (top.length === 2) {
    trialCandidates = top;
    startTrial();
  } else {
    startNight();
  }
}

function startTrial() {
  phase = "trial1";
  io.emit("trialStart", trialCandidates[0]);
  timer(30, () => {
    phase = "trial2";
    io.emit("trialStart", trialCandidates[1]);
    timer(30, trialVote);
  });
}

function trialVote() {
  phase = "trialVote";
  votes = {};
  io.emit("phase", "Vote xử tử / tha");
  timer(15, resolveTrialVote);
}

function resolveTrialVote() {
  let kill = 0;
  let spare = 0;

  for (let v in votes) {
    if (votes[v] === "kill") kill++;
    else spare++;
  }

  if (kill > spare) {
    eliminate(trialCandidates[0]);
  } else {
    startNight();
  }
}

function eliminate(id) {
  const p = players.find(x => x.id === id);
  if (p) p.alive = false;
  io.emit("eliminated", id);
  checkWin();
  startNight();
}

io.on("connection", socket => {

  socket.on("join", name => {
    players.push({ id: socket.id, name, alive: true });
    io.emit("players", players);
  });

  socket.on("start", () => {
    if (players.length >= 5) {
      assignRoles();
      players.forEach(p => {
        io.to(p.id).emit("role", p.role);
      });
      startNight();
    }
  });

  socket.on("protect", target => {
    if (target !== protectedLastNight)
      protectedTonight = target;
  });

  socket.on("wolfKill", target => {
    nightKill = target;
  });

  socket.on("witchAction", data => {
    if (data.type === "heal" && !witchHealUsed) {
      nightKill = null;
      witchHealUsed = true;
    }
    if (data.type === "kill" && !witchKillUsed) {
      const p = players.find(x => x.id === data.target);
      if (p) p.alive = false;
      witchKillUsed = true;
    }
  });

  socket.on("vote", target => {
    votes[socket.id] = target;
  });

  socket.on("chat", msg => {
    if (phase === "discussion") {
      io.emit("chat", msg);
    }
  });

});

server.listen(3000);
