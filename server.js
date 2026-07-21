const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Supabase Bilgilerin
const SUPABASE_URL = "https://dpksekpbbivsdixulejt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8kuO9R6_-JCDMIoIVz_2uA_HTpAteMS";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

app.use(express.static('public'));

// Oyundaki Aktif Oyuncular (Haritadaki Konumları)
let players = {};

io.on('connection', (socket) => {
  console.log('Yeni oyuncu bağlandı:', socket.id);

  // Oyuncu Oyuna Katıldığında
  socket.on('joinGame', async (username) => {
    // Supabase'den oyuncu verisini çek veya yeni kaydet
    let { data: player, error } = await supabase
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

    // Oyuncuyu haritada rastgele bir konuma koy
    players[socket.id] = {
      id: socket.id,
      username: username,
      x: Math.floor(Math.random() * 700) + 50,
      y: Math.floor(Math.random() * 500) + 50,
      color: '#' + Math.floor(Math.random()*16777215).toString(16),
      trophies: player ? player.trophies : 0
    };

    // Mevcut oyunculara yeni oyuncuyu haber ver
    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', players[socket.id]);
  });

  // Oyuncu Hareket Ettiğinde (Anlık Canlı Konum Güncellemesi)
  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      // Diğer tüm oyunculara hareket bilgisini gönder
      io.emit('playerMoved', players[socket.id]);
    }
  });

  // Oyuncu Ayrıldığında
  socket.on('disconnect', () => {
    console.log('Oyuncu ayrıldı:', socket.id);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`OsBrawl sunucusu ${PORT} portunda çalışıyor!`);
});
