require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Supabase Bağlantısı (Güvenli)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.use(express.static('public'));

// Oyun Dünyası Ayarları
const MAP_SIZE = 30;
const WALLS = [
  { x: -10, z: -10, w: 20, d: 2 }, // Üst duvar
  { x: -10, z: 8, w: 20, d: 2 },   // Alt duvar
  { x: -12, z: -10, w: 2, d: 20 }, // Sol duvar
  { x: 10, z: -10, w: 2, d: 20 },  // Sağ duvar
  { x: -4, z: -2, w: 8, d: 1.5 },  // Orta engel
  { x: -1, z: -8, w: 1.5, d: 6 }
];

let players = {};
let bullets = [];
let bulletIdCounter = 0;

// Yardımcı: İki nokta arası mesafe
function distance(p1, p2) {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.z - p2.z) ** 2);
}

// Yardımcı: Çizgi ile duvar kesişimi (basit AABB kontrolü)
function lineIntersectsWall(x1, z1, x2, z2, wall) {
  let left = wall.x - wall.w / 2;
  let right = wall.x + wall.w / 2;
  let top = wall.z - wall.d / 2;
  let bottom = wall.z + wall.d / 2;

  // Hızlı kaba test: çizginin iki ucu da duvarın aynı tarafındaysa kesişmez
  if ((x1 < left && x2 < left) || (x1 > right && x2 > right) ||
      (z1 < top && z2 < top) || (z1 > bottom && z2 > bottom)) {
    return false;
  }
  return true; // Tam kesişim testi yapmadık, oyun için yeterli
}

// Mermi çarpışma ve hareket döngüsü
function updateBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];
    
    // Mermiyi hareket ettir
    bullet.x += bullet.vx;
    bullet.z += bullet.vz;
    bullet.life--;

    // Duvar çarpışması
    let hitWall = false;
    for (let wall of WALLS) {
      if (bullet.x > wall.x - wall.w/2 && bullet.x < wall.x + wall.w/2 &&
          bullet.z > wall.z - wall.d/2 && bullet.z < wall.z + wall.d/2) {
        hitWall = true;
        break;
      }
    }

    if (hitWall || bullet.life <= 0) {
      bullets.splice(i, 1);
      io.emit('bulletDestroyed', bullet.id);
      continue;
    }

    // Oyuncu çarpışması
    for (let id in players) {
      const player = players[id];
      if (!player.isAlive || id === bullet.ownerId) continue;

      if (distance(bullet, player) < 1.5) {
        // Hasar ver
        player.health -= bullet.damage;
        io.emit('playerDamaged', { id, health: player.health });

        // Öldü mü?
        if (player.health <= 0) {
          player.isAlive = false;
          player.health = 0;
          player.deaths = (player.deaths || 0) + 1;

          // Öldüren kişiye kupa
          if (players[bullet.ownerId]) {
            players[bullet.ownerId].kills = (players[bullet.ownerId].kills || 0) + 1;
          }

          io.emit('playerKilled', { victimId: id, killerId: bullet.ownerId });

          // Supabase kupa güncelleme (async)
          updateTrophyInDB(id, -3);
          if (bullet.ownerId && players[bullet.ownerId]) {
            updateTrophyInDB(bullet.ownerId, 5);
          }

          // 3 saniye sonra yeniden doğur
          setTimeout(() => respawnPlayer(id), 3000);
        }

        bullets.splice(i, 1);
        io.emit('bulletDestroyed', bullet.id);
        break;
      }
    }
  }
}

async function updateTrophyInDB(socketId, delta) {
  const player = players[socketId];
  if (!player) return;
  
  const { data: dbPlayer } = await supabase
    .from('players')
    .select('trophies')
    .eq('username', player.username)
    .single();

  if (dbPlayer) {
    const newTrophies = Math.max(0, (dbPlayer.trophies || 0) + delta);
    player.trophies = newTrophies;
    await supabase
      .from('players')
      .update({ trophies: newTrophies })
      .eq('username', player.username);
    
    io.to(socketId).emit('trophyUpdate', newTrophies);
  }
}

function respawnPlayer(id) {
  if (players[id]) {
    players[id].isAlive = true;
    players[id].health = players[id].maxHealth;
    players[id].x = (Math.random() - 0.5) * 20;
    players[id].z = (Math.random() - 0.5) * 20;
    io.emit('playerRespawned', players[id]);
  }
}

// Sunucu tick (saniyede 30 kez)
setInterval(() => {
  updateBullets();
  // Mermi pozisyonlarını client'lara gönder
  io.emit('bulletsUpdate', bullets);
}, 1000 / 30);

io.on('connection', (socket) => {
  console.log('Katıldı:', socket.id);

  socket.on('joinGame', async (data) => {
    const { username, brawler } = data;

    // Veritabanından oyuncuyu bul / oluştur
    let { data: dbPlayer } = await supabase
      .from('players')
      .select('*')
      .eq('username', username)
      .single();

    if (!dbPlayer) {
      const { data: newPlayer } = await supabase
        .from('players')
        .insert([{ username, trophies: 0, gems: 10, coins: 100 }])
        .select()
        .single();
      dbPlayer = newPlayer;
    }

    // Brawler'a göre max can
    let maxHealth = 100;
    if (brawler === 'Colt') maxHealth = 80;
    if (brawler === 'El Primo') maxHealth = 140;

    players[socket.id] = {
      id: socket.id,
      username: username,
      brawler: brawler,
      x: (Math.random() - 0.5) * 20,
      z: (Math.random() - 0.5) * 20,
      rotation: 0,
      health: maxHealth,
      maxHealth: maxHealth,
      isAlive: true,
      trophies: dbPlayer.trophies,
      kills: 0,
      deaths: 0
    };

    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', players[socket.id]);
    socket.emit('trophyUpdate', dbPlayer.trophies);
  });

  socket.on('playerMovement', (data) => {
    if (players[socket.id] && players[socket.id].isAlive) {
      let newX = data.x;
      let newZ = data.z;
      
      // Duvar sınır kontrolü (basit)
      let blocked = false;
      for (let wall of WALLS) {
        if (newX > wall.x - wall.w/2 - 0.6 && newX < wall.x + wall.w/2 + 0.6 &&
            newZ > wall.z - wall.d/2 - 0.6 && newZ < wall.z + wall.d/2 + 0.6) {
          blocked = true;
          break;
        }
      }
      
      if (!blocked) {
        players[socket.id].x = newX;
        players[socket.id].z = newZ;
        players[socket.id].rotation = data.rotation;
        io.emit('playerMoved', players[socket.id]);
      }
    }
  });

  socket.on('shoot', (targetData) => {
    const shooter = players[socket.id];
    if (!shooter || !shooter.isAlive) return;

    const brawler = shooter.brawler;
    const direction = targetData.direction || { x: Math.sin(shooter.rotation), z: Math.cos(shooter.rotation) };
    
    // Brawler'a özel atış mantığı
    switch (brawler) {
      case 'Colt':
        for (let i = 0; i < 3; i++) {
          setTimeout(() => {
            createBullet(socket.id, direction, 0.8, 35, 25);
          }, i * 80);
        }
        break;
      case 'Shelly':
        for (let i = -1; i <= 1; i++) {
          const angleOffset = i * 0.15;
          const dir = {
            x: direction.x * Math.cos(angleOffset) - direction.z * Math.sin(angleOffset),
            z: direction.x * Math.sin(angleOffset) + direction.z * Math.cos(angleOffset)
          };
          createBullet(socket.id, dir, 0.5, 35, 20);
        }
        break;
      case 'El Primo':
        // Yakın dövüş alan hasarı
        for (let id in players) {
          if (id !== socket.id && players[id].isAlive) {
            if (distance(shooter, players[id]) < 2.5) {
              players[id].health -= 30;
              io.emit('playerDamaged', { id, health: players[id].health });
              if (players[id].health <= 0) {
                players[id].isAlive = false;
                io.emit('playerKilled', { victimId: id, killerId: socket.id });
                updateTrophyInDB(id, -3);
                updateTrophyInDB(socket.id, 5);
                setTimeout(() => respawnPlayer(id), 3000);
              }
            }
          }
        }
        io.emit('elPrimoPunch', { x: shooter.x, z: shooter.z });
        break;
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

function createBullet(ownerId, dir, speed, damage, range) {
  const id = ++bulletIdCounter;
  const owner = players[ownerId];
  const bullet = {
    id: id,
    ownerId: ownerId,
    x: owner.x,
    z: owner.z,
    vx: dir.x * speed,
    vz: dir.z * speed,
    damage: damage,
    life: range,
    brawler: owner.brawler
  };
  bullets.push(bullet);
  io.emit('bulletCreated', bullet);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`OsBrawl Sunucusu ${PORT} portunda aktif!`);
});