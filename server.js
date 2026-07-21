const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Supabase Bağlantısı
const SUPABASE_URL = "https://dpksekpbbivsdixulejt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8kuO9R6_-JCDMIoIVz_2uA_HTpAteMS";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

app.use(express.static('public'));

let players = {};

io.on('connection', (socket) => {
  console.log('Yeni oyuncu katıldı:', socket.id);

  socket.on('joinGame', async (data) => {
    const { username, brawler } = data;

    // Supabase kayıt/yükleme kontrolü
    let { data: player } = await supabase
      .from('players')
      .select('*')
      .eq('username', username)
      .single();

    if (!player) {
      const { data: newPlayer } = await supabase
        .from('players')
        .insert([{ username: username, trophies: 0, gems: 10, coins: 100 }])
        .select()
        .single();
      player = newPlayer;
    }

    players[socket.id] = {
      id: socket.id,
      username: username,
      brawler: brawler || 'Shelly',
      x: (Math.random() - 0.5) * 20,
      z: (Math.random() - 0.5) * 20,
      rotation: 0,
      trophies: player ? player.trophies : 0
    };

    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', players[socket.id]);
  });

  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].z = movementData.z;
      players[socket.id].rotation = movementData.rotation;
      
      io.emit('playerMoved', players[socket.id]);
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`OsBrawl 3D Sunucusu ${PORT} portunda çalışıyor!`);
});
